/**
 * SPORTSIX 小程序接口。小程序端只通过这个云函数读写数据，数据库集合不对小程序端开放。
 *
 * 调用：wx.cloud.callFunction({ name: 'api', data: { action, ...参数 } })
 * 返回：{ ok: true, data } 或 { ok: false, code }
 *
 * 集合（形状见 docs/05-dev-plan.md 末尾，说明见 cloudfunctions/README.md）：
 *   members    会员      _id 用 openid
 *   events     活动
 *   signups    报名      _id 用 openid_活动id
 *   reminders  提醒      _id 用 openid_活动id
 *   plans      补给计划  _id 用 openid，只保存最近一份
 *   point_logs 积分记录  每次加减积分记一条；第一次用到时云函数自己建这个集合
 *   settings   设置      目前只有一条 _id 为 notice 的记录（公告）；第一次用到时云函数自己建这个集合
 *
 *   admin_web  电脑端后台的登录码、登录凭证；第一次用到时云函数自己建这个集合
 *   news_subs  新活动通知的订阅  _id 用 openid，每人一条；第一次用到时云函数自己建这个集合
 *
 * 运营后台的接口（admin 开头）只给管理员用：会员记录上有 admin: true，在云开发控制台里手动加。
 *
 * 电脑端后台是一个网页（web-admin/），没有微信身份。它的调用走「未登录访问」：
 *   1. 管理员在小程序的运营后台里取一个一次性的登录码（adminWebCode）；
 *   2. 网页用登录码换一个登录凭证（webLogin），之后每次调用都带上（webToken）；
 *   3. 没有微信身份的调用只认 webLogin 和 WEB_ACTIONS 里列的后台接口，别的一概不处理。
 *   counters   计数      只有一条 _id 为 memberNo 的记录，存下一个会员编号；第一次用到时云函数自己建这个集合
 */
const crypto = require('crypto');
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const fail = (code) => { const e = new Error(code); e.code = code; return e; };
const ms = (d) => (d ? new Date(d).getTime() : null);

async function findById(name, id) {
  const res = await db.collection(name).where({ _id: id }).limit(1).get();
  return res.data[0] || null;
}

const SEQ_ID = 'memberNo';
const MEMBER_NO_START = 100001;
/** 注册送的积分。页面上的说法在 reference/content/member.json 和 messages.json，改的时候一起改 */
const WELCOME_POINTS = 500;
const NICKNAME_MAX = 20;

/**
 * 发一个会员编号：按注册先后递增的数字，从 100001 起。
 * 下一个号存在 counters 集合里 _id 为 memberNo 的那条记录上。取号用「按旧值更新」：
 * 只有记录上的号还是刚读到的那个时才更新成功，两个人同时注册不会拿到同一个号。
 */
async function nextMemberNo() {
  for (let i = 0; i < 8; i++) {
    let cur;
    try {
      cur = await findById('counters', SEQ_ID);
    } catch (e) {
      // 集合还没建：第一次用到时自己建（已经有了会报错，忽略），然后重读
      try { await db.createCollection('counters'); } catch (e2) { /* 已存在 */ }
      continue;
    }
    if (!cur) {
      // 建计数记录。别人刚好先建了会报重复，忽略后重读
      try { await db.collection('counters').add({ data: { _id: SEQ_ID, next: MEMBER_NO_START } }); } catch (e) { /* 已存在 */ }
      continue;
    }
    const res = await db.collection('counters').where({ _id: SEQ_ID, next: cur.next }).update({ data: { next: cur.next + 1 } });
    if (res.stats.updated) return String(cur.next);
  }
  return null;
}

/**
 * 把会员记录补齐：
 * - 没有编号的（编号规则定下来之前注册的，或注册时取号失败的）补发一个；
 * - 没领过注册积分的（送积分的规则定下来之前注册的）补送一次。
 * 两样都用「还没有标记」做更新条件（numbered、welcomeBonus）：同一个会员的两个请求同时进来时只有一个写得进去，
 * 另一个改用库里已经写好的那份，所以编号不会被后来的请求换掉，积分也不会送两次。没写进去的那个号空着不再用。
 * 补不上不影响别的功能，下次进入时再补。
 */
async function ensureMember(member) {
  if (!member) return member;
  let m = member;
  // 两件事各管各的：发编号出了问题，不能连带着把积分也跳过
  try {
    if (!m.welcomeBonus) {
      const res = await db.collection('members').where({ _id: m._id, welcomeBonus: _.exists(false) })
        .update({ data: { points: _.inc(WELCOME_POINTS), welcomeBonus: true } });
      if (res.stats.updated) await logPoints(m._id, WELCOME_POINTS, 'welcome');
      m = await findById('members', m._id) || m;
    }
  } catch (e) {
    console.error('ensureMember welcomeBonus', e);
  }
  try {
    if (!m.memberNo) {
      const no = await nextMemberNo();
      if (no) {
        await db.collection('members').where({ _id: m._id, numbered: _.exists(false) })
          .update({ data: { memberNo: no, numbered: true } });
        m = await findById('members', m._id) || m;
      }
    }
  } catch (e) {
    console.error('ensureMember memberNo', e);
  }
  return m;
}

/**
 * 记一条积分记录（积分页上列出来的那些）。reason 是原因：'welcome' 是注册赠送，其他的直接写给用户看的文字。
 * 集合第一次用到时自己建。记不上不影响积分本身。
 */
async function logPoints(openid, delta, reason, by) {
  const data = { openid: openid, delta: delta, reason: reason, createdAt: db.serverDate() };
  // 运营手动调整的，记下是哪位管理员操作的
  if (by) data.by = by;
  try {
    await db.collection('point_logs').add({ data: data });
  } catch (e) {
    try {
      await db.createCollection('point_logs');
      await db.collection('point_logs').add({ data: data });
    } catch (e2) {
      console.error('logPoints', e2);
    }
  }
}

/** 整理一段用户或运营填的文字：去掉控制字符和首尾空格，截到 max 个字。multiline 为真时保留换行 */
function cleanText(v, max, multiline) {
  const s = String(v == null ? '' : v)
    .replace(multiline ? /[\u0000-\u0009\u000b-\u001f\u007f\u2028\u2029]/g : /[\u0000-\u001f\u007f\u2028\u2029]/g, '').trim();
  return Array.from(s).slice(0, max).join('');
}

/** 昵称：去掉换行等控制字符和首尾空格，最多 20 个字 */
const cleanNickname = (v) => cleanText(v, NICKNAME_MAX);

/* ---------- 电脑端后台的登录 ---------- */

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
/** 登录码 5 分钟内有效，只能用一次 */
const WEB_CODE_TTL = 5 * 60 * 1000;
/**
 * 登录码 12 位数字。网页没有微信身份，分不清谁是谁，所以没法「输错几次就锁」：
 * 那样任何人乱输几次就能把所有管理员挡在外面。改成靠位数防猜：一万亿种里只有刚取的那一个是对的，
 * 又只管 5 分钟，就算每秒猜上千次也基本猜不中。输错不记数、不写库，乱输的人什么都改变不了。
 */
const WEB_CODE_DIGITS = 12;
/** 登录一次管 12 小时 */
const WEB_SESSION_TTL = 12 * 3600 * 1000;
/** 没有微信身份（网页）时能调的接口。登录码只在小程序里取，不在这里 */
const WEB_ACTIONS = ['webMe', 'webLogout', 'adminEvents', 'adminSaveEvent', 'adminSetEventStatus', 'adminNotifyEvent', 'adminNotice', 'adminSaveNotice',
  'adminFindMember', 'adminAdjustPoints', 'adminUploadCover', 'adminFileUrls'];

/** admin_web 集合里的一条记录。集合还没建时当作没有 */
async function webDoc(id) {
  try { return await findById('admin_web', id); } catch (e) { return null; }
}
/** 写 admin_web 集合里的一条记录。集合第一次用到时自己建 */
async function webSet(id, data) {
  try {
    await db.collection('admin_web').doc(id).set({ data: data });
  } catch (e) {
    await db.createCollection('admin_web');
    await db.collection('admin_web').doc(id).set({ data: data });
  }
}

/** 随机的 n 位数字。每一位从随机字节里取，250 以上的字节丢掉，这样十个数字出现的机会一样 */
function randomDigits(n) {
  let out = '';
  while (out.length < n) {
    const bytes = crypto.randomBytes(n * 2);
    for (let i = 0; i < bytes.length && out.length < n; i++) if (bytes[i] < 250) out += String(bytes[i] % 10);
  }
  return out;
}

/**
 * 网页用登录码换登录凭证。登录码和凭证在库里都只存摘要，库里的数据被人看到也登录不了。
 * 输错了只是登录不上，不记数也不写库（原因见 WEB_CODE_DIGITS 的说明）。
 */
async function webLogin(event) {
  const now = Date.now();
  const code = String(event.code == null ? '' : event.code).replace(/\D/g, '');
  const id = 'c_' + sha(code);
  const doc = code.length === WEB_CODE_DIGITS ? await webDoc(id) : null;
  let ok = !!doc && doc.kind === 'code' && doc.used === false && doc.expiresAt > now;
  if (ok) {
    // 条件更新：同一个登录码被两个请求同时拿来用，只有一个能成
    const res = await db.collection('admin_web').where({ _id: id, used: false }).update({ data: { used: true } });
    ok = res.stats.updated > 0;
  }
  // 取登录码之后被撤掉管理员的，也登录不了
  const member = ok ? await findById('members', doc.openid) : null;
  if (!ok || !member || member.admin !== true) throw fail('bad_code');
  const token = crypto.randomBytes(32).toString('hex');
  await webSet('s_' + sha(token), { kind: 'session', openid: doc.openid, expiresAt: now + WEB_SESSION_TTL, createdAt: db.serverDate() });
  return { token: token, expiresAt: now + WEB_SESSION_TTL, name: member.nickname || '' };
}

/** 登录凭证 → 是哪位管理员（openid）。凭证不对或过期返回 null */
async function webSession(token) {
  if (!token || typeof token !== 'string') return null;
  const s = await webDoc('s_' + sha(token));
  if (!s || s.kind !== 'session' || !(s.expiresAt > Date.now())) return null;
  return s.openid;
}

/** 图片的头几个字节 → 扩展名。只收 JPEG、PNG、WebP */
function imageExt(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.slice(0, 8).toString('hex') === '89504e470d0a1a0a') return 'png';
  if (buf.length > 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return '';
}

/* ---------- 运营后台 ---------- */

/** 只有管理员能调 admin 开头的接口 */
async function requireAdmin(openid) {
  const m = await findById('members', openid);
  if (!m || m.admin !== true) throw fail('forbidden');
  return m;
}

const EVENT_TYPES = ['赛事', '试用装', '抽奖'];

/**
 * 运营后台看到的活动：比小程序里多了状态、已报名人数和「新活动通知」发到哪一步了。
 * notify 为 null 是还没通知过；status 是 pending（在发）或 done（发完了），sent、failed 是发到和没发到的人数。
 */
function adminEventView(e) {
  return Object.assign(eventView(e), {
    status: e.status === 'published' ? 'published' : 'draft',
    signupCount: e.signupCount || 0,
    notify: e.notifyStatus ? { status: e.notifyStatus === 'done' ? 'done' : 'pending', at: ms(e.notifyAt), sent: e.notifySent || 0, failed: e.notifyFailed || 0 } : null
  });
}

/* ---------- 新活动通知 ---------- */

/** 这位用户的订阅记录。集合还没建时当作没有 */
async function newsDoc(openid) {
  try { return await findById('news_subs', openid); } catch (e) { return null; }
}
/** 现在有多少人订阅着、还没收到通知。集合还没建时是 0 */
async function newsWaiting() {
  try { return (await db.collection('news_subs').where({ sent: false }).count()).total; } catch (e) { return 0; }
}

/** 把后台表单交上来的活动整理成要存的数据。时间是毫秒时间戳，没填的存 null（页面上不显示那一项） */
function eventData(input) {
  const e = input || {};
  const time = (v) => (typeof v === 'number' && isFinite(v) && v > 0 ? new Date(v) : null);
  const data = {
    type: EVENT_TYPES.indexOf(e.type) >= 0 ? e.type : '',
    title: cleanText(e.title, 40),
    status: e.status === 'published' ? 'published' : 'draft',
    date: time(e.date),
    city: cleanText(e.city, 20),
    venue: cleanText(e.venue, 40),
    quota: Number.isInteger(e.quota) && e.quota > 0 ? e.quota : null,
    quotaText: cleanText(e.quotaText, 20),
    signupStart: time(e.signupStart),
    signupEnd: time(e.signupEnd),
    memberSignupStart: time(e.memberSignupStart),
    drawAt: time(e.drawAt),
    cover: cleanText(e.cover, 500),
    intro: cleanText(e.intro, 1000, true)
  };
  if (!data.type) throw fail('bad_type');
  if (!data.title) throw fail('missing_title');
  if (!data.date) throw fail('missing_date');
  if (data.signupStart && data.signupEnd && data.signupEnd <= data.signupStart) throw fail('bad_signup_time');
  return data;
}

/**
 * 活动的已报名人数比报名记录的条数少时，补到和记录一样多（以前不限名额时报的名没记数，属于这种情况）。
 * 只往上补，不往下减：有人正在报名时，人数已经加了一、报名记录还没写进去，这时人数比记录多一个是正常的，
 * 要是按记录条数改回去，就把他占的名额抹掉了，名额会多放出去一个。
 * 人数偏多的情况（报名中途出错多占了名额）不在这里处理，最坏是空出一个名额，不会超额。
 */
async function raiseSignupCount(eventId) {
  await db.collection('events').where({ _id: eventId, signupCount: _.exists(false) }).update({ data: { signupCount: 0 } });
  const n = (await db.collection('signups').where({ eventId: eventId }).count()).total;
  if (n > 0) await db.collection('events').where({ _id: eventId, signupCount: _.lt(n) }).update({ data: { signupCount: n } });
}

/** 公告。集合还没建时当作没有 */
async function readNotice() {
  try { return await findById('settings', 'notice'); } catch (e) { return null; }
}
/** 给小程序的公告：开着并且有内容才给。version 是最后一次保存的时间，小程序每个版本只弹一次 */
function noticeView(n) {
  if (!n || !n.enabled || !(n.title || n.content)) return null;
  return { version: ms(n.updatedAt) || 0, title: n.title || '', content: n.content || '' };
}

/** 运营后台查到的会员：手机号打码，不带 openid（之后用会员编号指人） */
function adminMemberView(m) {
  const v = memberView(m);
  return { memberNo: v.memberNo, nickname: v.nickname, phoneMasked: v.phoneMasked, points: v.points || 0 };
}

/** 返回给小程序端的会员信息：手机号只给打码后的 */
function memberView(m) {
  if (!m) return null;
  const phone = String(m.phone || '');
  return {
    nickname: m.nickname || '',
    // 管理员才有这一项：小程序据此显示「运营后台」的入口。真正的权限检查在各个 admin 接口里
    admin: m.admin === true,
    phoneMasked: phone.length >= 7 ? phone.slice(0, 3) + '****' + phone.slice(-4) : '',
    memberNo: m.memberNo || null,
    points: typeof m.points === 'number' ? m.points : null,
    createdAt: ms(m.createdAt)
  };
}

/** 返回给小程序端的活动：时间一律转成毫秒时间戳 */
function eventView(e) {
  return {
    id: e._id,
    type: e.type,
    title: e.title,
    date: ms(e.date),
    city: e.city || '',
    venue: e.venue || '',
    quota: typeof e.quota === 'number' ? e.quota : null,
    quotaText: e.quotaText || '',
    signupStart: ms(e.signupStart),
    signupEnd: ms(e.signupEnd),
    memberSignupStart: ms(e.memberSignupStart),
    drawAt: ms(e.drawAt),
    cover: e.cover || '',
    intro: e.intro || ''
  };
}

/** 会员报名从 memberSignupStart 开始；没填就用 signupStart */
const signupOpensAt = (e) => ms(e.memberSignupStart) || ms(e.signupStart);

const PLAN_KEYS = { sport: 'string', scene: 'string', start: 'string', minutes: 'number', kg: 'number', caffeineSensitive: 'boolean', hot: 'boolean', firstTime: 'boolean' };

const actions = {
  /** 进入小程序时取一次：会员、补给计划、已设提醒和已报名的活动 id */
  async bootstrap(event, openid) {
    const member = await ensureMember(await findById('members', openid));
    const plan = member ? await findById('plans', openid) : null;
    const reminders = await db.collection('reminders').where({ openid: openid, sent: false }).limit(100).get();
    const signups = await db.collection('signups').where({ openid: openid }).limit(100).get();
    const news = await newsDoc(openid);
    return {
      member: memberView(member),
      // 订阅了新活动通知、还没收到：活动页上的按钮显示「已订阅」。收到一条之后要再点一次才有下一条
      news: !!news && news.sent === false,
      // 运营在后台设的公告，打开小程序时弹一次
      notice: noticeView(await readNotice()),
      plan: plan ? { input: plan.input, savedAt: ms(plan.savedAt) } : null,
      reminders: reminders.data.map((r) => r.eventId),
      signups: signups.data.map((s) => s.eventId)
    };
  },

  /** 注册：用手机号快速验证组件给的 code 换手机号，建会员。已注册的直接返回。isNew 表示这次是不是新建的会员。 */
  async register(event, openid) {
    const existing = await findById('members', openid);
    if (existing) return { member: memberView(await ensureMember(existing)), isNew: false };
    if (!event.code) throw fail('missing_code');
    let info;
    try {
      const res = await cloud.openapi.phonenumber.getPhoneNumber({ code: event.code });
      info = res.phoneInfo || res.phone_info;
    } catch (e) {
      console.error('getPhoneNumber', e);
      throw fail('phone_failed');
    }
    if (!info || !info.purePhoneNumber) throw fail('phone_failed');
    // 注册送 WELCOME_POINTS 积分；编号在建好会员后发，取号失败不影响注册，下次进入时补发
    const doc = {
      openid: openid, phone: info.purePhoneNumber, countryCode: info.countryCode || '', nickname: '',
      memberNo: null, points: WELCOME_POINTS, welcomeBonus: true, createdAt: db.serverDate()
    };
    // 用 add 而不是 set：同一个人的两个注册请求同时进来时，后到的那个写不进去，不会把先建好的记录（连同编号）盖掉
    let created = true;
    try {
      await db.collection('members').add({ data: Object.assign({ _id: openid }, doc) });
    } catch (e) {
      created = false;
      if (!(await findById('members', openid))) throw e;
    }
    if (created) await logPoints(openid, WELCOME_POINTS, 'welcome');
    return { member: memberView(await ensureMember(await findById('members', openid))), isNew: created };
  },

  /** 积分页：当前积分和最近 50 条积分记录（新的在前） */
  async points(event, openid) {
    const member = await ensureMember(await findById('members', openid));
    if (!member) throw fail('not_member');
    let logs = [];
    try {
      const res = await db.collection('point_logs').where({ openid: openid }).orderBy('createdAt', 'desc').limit(50).get();
      logs = res.data.map((l) => ({ id: l._id, delta: l.delta, reason: l.reason, at: ms(l.createdAt) }));
    } catch (e) { /* 集合还没建：没有记录 */ }
    // 送过注册积分但没记上（记录功能上线之前送的，或当时没记成）：补一条给页面看，不写库
    if (member.welcomeBonus && !logs.some((l) => l.reason === 'welcome')) {
      logs.push({ id: 'welcome', delta: WELCOME_POINTS, reason: 'welcome', at: ms(member.createdAt) });
    }
    return { member: memberView(member), logs: logs };
  },

  /** 改昵称。昵称是用户在昵称输入框里自己填的（可以一键选用微信昵称），内容安全由微信的输入框组件检测。 */
  async setNickname(event, openid) {
    if (!(await findById('members', openid))) throw fail('not_member');
    const nickname = cleanNickname(event.nickname);
    if (!nickname) throw fail('bad_nickname');
    await db.collection('members').doc(openid).update({ data: { nickname: nickname } });
    return { member: memberView(await findById('members', openid)) };
  },

  /** 保存补给计划（只留最近一份）。input 是公式的输入，result 是支数等摘要。 */
  async savePlan(event, openid) {
    if (!(await findById('members', openid))) throw fail('not_member');
    const input = {};
    for (const k of Object.keys(PLAN_KEYS)) {
      if (!event.input || typeof event.input[k] !== PLAN_KEYS[k]) throw fail('bad_input');
      input[k] = event.input[k];
    }
    // 天气是后加的输入，旧版本的小程序不会带
    if (typeof event.input.weather === 'string') input.weather = event.input.weather;
    const r = event.result || {};
    const result = { total: Number(r.total) || 0, gelCount: Number(r.gelCount) || 0, proCount: Number(r.proCount) || 0 };
    await db.collection('plans').doc(openid).set({ data: { openid: openid, input: input, result: result, savedAt: db.serverDate() } });
    return { plan: { input: input, savedAt: Date.now() } };
  },

  /** 即将开始的活动：已发布、活动日期还没过（留一天余量） */
  async events() {
    const res = await db.collection('events')
      .where({ status: 'published', date: _.gte(new Date(Date.now() - 24 * 3600 * 1000)) })
      .orderBy('date', 'asc').limit(50).get();
    return { events: res.data.map(eventView) };
  },

  /* ---------- 运营后台（只给管理员） ---------- */

  /** 全部活动，含没上架的和已经过期的，新的在前 */
  async adminEvents(event, openid) {
    await requireAdmin(openid);
    // 一次最多取 100 条，活动多了就接着往后取，取全为止（上限 2000 场）
    const all = [];
    for (let page = 0; page < 20; page++) {
      const res = await db.collection('events').orderBy('date', 'desc').skip(page * 100).limit(100).get();
      all.push(...res.data);
      if (res.data.length < 100) break;
    }
    // newsWaiting：现在点「通知」能发给多少人
    return { events: all.map(adminEventView), newsWaiting: await newsWaiting() };
  },

  /**
   * 把一场活动通知给订阅了「新活动通知」的人。这里只是登记，真正的发送由 remind 云函数分批做（每 5 分钟一次）。
   * 每场活动只能通知一次：订阅消息一次授权只有一条额度，重复通知会把大家的额度白白用掉。
   * 只通知登记这一刻之前订阅的人；之后才订阅的人已经能在活动页看到这场活动，留着额度等下一场。
   */
  async adminNotifyEvent(event, openid) {
    await requireAdmin(openid);
    const id = String(event.id || '');
    const e = await findById('events', id);
    if (!e) throw fail('not_found');
    if (e.status !== 'published') throw fail('not_published');
    if (ms(e.date) && ms(e.date) < Date.now()) throw fail('event_ended');
    if (e.notifyStatus) throw fail('notified');
    // 上一场的通知还在发：现在订阅着的人马上要被那一场用掉，这时再登记一场，实际发不到几个人，还白用掉这场的一次机会
    const busy = await db.collection('events').where({ status: 'published', notifyStatus: 'pending' }).count();
    if (busy.total) throw fail('notify_busy');
    const waiting = await newsWaiting();
    if (!waiting) throw fail('no_subscribers');
    // 条件更新：两位管理员同时点，只有一个登记得上
    const res = await db.collection('events').where({ _id: id, notifyStatus: _.exists(false) })
      .update({ data: { notifyStatus: 'pending', notifyAt: db.serverDate(), notifyBy: openid, notifySent: 0, notifyFailed: 0 } });
    if (!res.stats.updated) throw fail('notified');
    return { event: adminEventView(await findById('events', id)), waiting: waiting };
  },

  /** 新建或修改活动。带 id 是修改，不带是新建 */
  async adminSaveEvent(event, openid) {
    await requireAdmin(openid);
    const data = eventData(event.event);
    let id = event.id ? String(event.id) : '';
    if (id) {
      if (!(await findById('events', id))) throw fail('not_found');
      await db.collection('events').doc(id).update({ data: Object.assign(data, { updatedAt: db.serverDate() }) });
      // 有名额限制时，已报名人数不能比报名记录少（以前不限名额时报的名可能没记数）
      if (data.quota) await raiseSignupCount(id);
    } else {
      const res = await db.collection('events').add({ data: Object.assign(data, { signupCount: 0, createdAt: db.serverDate(), updatedAt: db.serverDate() }) });
      id = res._id;
    }
    return { event: adminEventView(await findById('events', id)) };
  },

  /** 上架、下架。下架后小程序里不再显示，报名和提醒的记录保留 */
  async adminSetEventStatus(event, openid) {
    await requireAdmin(openid);
    const id = String(event.id || '');
    if (!(await findById('events', id))) throw fail('not_found');
    const status = event.status === 'published' ? 'published' : 'draft';
    await db.collection('events').doc(id).update({ data: { status: status, updatedAt: db.serverDate() } });
    return { event: adminEventView(await findById('events', id)) };
  },

  /** 读公告（后台编辑用，不管开没开都返回） */
  async adminNotice(event, openid) {
    await requireAdmin(openid);
    const n = await readNotice();
    return { notice: { title: (n && n.title) || '', content: (n && n.content) || '', enabled: !!(n && n.enabled) } };
  },

  /** 保存公告。每次保存都算一个新版本，开着的话每位用户下次打开小程序时再弹一次 */
  async adminSaveNotice(event, openid) {
    await requireAdmin(openid);
    const n = event.notice || {};
    const data = { title: cleanText(n.title, 20), content: cleanText(n.content, 200, true), enabled: !!n.enabled, updatedAt: db.serverDate(), updatedBy: openid };
    if (data.enabled && !data.title && !data.content) throw fail('missing_content');
    try {
      await db.collection('settings').doc('notice').set({ data: data });
    } catch (e) {
      // 集合还没建：建好再写
      await db.createCollection('settings');
      await db.collection('settings').doc('notice').set({ data: data });
    }
    return { notice: { title: data.title, content: data.content, enabled: data.enabled } };
  },

  /** 小程序里取电脑端后台的登录码：12 位数字，5 分钟内有效，只能用一次 */
  async adminWebCode(event, openid) {
    await requireAdmin(openid);
    const code = randomDigits(WEB_CODE_DIGITS);
    await webSet('c_' + sha(code), { kind: 'code', openid: openid, used: false, expiresAt: Date.now() + WEB_CODE_TTL, createdAt: db.serverDate() });
    return { code: code, expiresIn: WEB_CODE_TTL / 1000 };
  },

  /** 电脑端后台：凭证还管不管用，登录的是谁 */
  async webMe(event, openid) {
    const m = await requireAdmin(openid);
    return { name: m.nickname || '', memberNo: m.memberNo || '' };
  },

  /** 电脑端后台：退出登录，这个凭证作废 */
  async webLogout(event, openid) {
    if (event.webToken) await db.collection('admin_web').doc('s_' + sha(event.webToken)).update({ data: { expiresAt: 0 } });
    return {};
  },

  /**
   * 电脑端后台传活动头图：网页把图片压好，用 base64 交上来，这里存进云存储的 events/ 目录。
   * 只收 JPEG、PNG、WebP，最大 2MB。返回 fileID（活动的 cover 存它）和一个临时的访问地址（网页上预览用）。
   */
  async adminUploadCover(event, openid) {
    await requireAdmin(openid);
    const buf = Buffer.from(String(event.data || ''), 'base64');
    if (!buf.length) throw fail('missing_file');
    if (buf.length > 2 * 1024 * 1024) throw fail('file_too_large');
    const ext = imageExt(buf);
    if (!ext) throw fail('bad_file');
    const name = 'events/' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.' + ext;
    const up = await cloud.uploadFile({ cloudPath: name, fileContent: buf });
    const urls = await cloud.getTempFileURL({ fileList: [up.fileID] });
    return { fileID: up.fileID, url: (urls.fileList[0] && urls.fileList[0].tempFileURL) || '' };
  },

  /** 电脑端后台：把云存储的 fileID 换成能在网页上显示的临时地址。一次最多 50 个 */
  async adminFileUrls(event, openid) {
    await requireAdmin(openid);
    const ids = (Array.isArray(event.ids) ? event.ids : []).filter((x) => typeof x === 'string' && x.indexOf('cloud://') === 0).slice(0, 50);
    if (!ids.length) return { urls: {} };
    const res = await cloud.getTempFileURL({ fileList: ids });
    const urls = {};
    (res.fileList || []).forEach((f) => { if (f.tempFileURL) urls[f.fileID] = f.tempFileURL; });
    return { urls: urls };
  },

  /** 按手机号或会员编号找会员 */
  async adminFindMember(event, openid) {
    await requireAdmin(openid);
    const q = String(event.query || '').replace(/\s/g, '');
    if (!q) throw fail('missing_query');
    let res = await db.collection('members').where({ memberNo: q }).limit(1).get();
    if (!res.data.length) res = await db.collection('members').where({ phone: q }).limit(1).get();
    if (!res.data.length) throw fail('not_found');
    return { member: adminMemberView(await ensureMember(res.data[0])) };
  },

  /** 给某位会员加减积分，并记一条积分记录。减的时候积分不够会失败，不会减成负数 */
  async adminAdjustPoints(event, openid) {
    await requireAdmin(openid);
    const res = await db.collection('members').where({ memberNo: String(event.memberNo || '') }).limit(1).get();
    const target = res.data[0];
    if (!event.memberNo || !target) throw fail('not_found');
    const delta = Number(event.delta);
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100000) throw fail('bad_delta');
    const reason = cleanText(event.reason, 30);
    if (!reason) throw fail('missing_reason');
    const cond = { _id: target._id };
    if (delta < 0) cond.points = _.gte(-delta);
    const done = await db.collection('members').where(cond).update({ data: { points: _.inc(delta) } });
    if (!done.stats.updated) throw fail('insufficient');
    await logPoints(target._id, delta, reason, openid);
    return { member: adminMemberView(await findById('members', target._id)) };
  },

  /** 「提醒我」：用户授权了一次性订阅消息之后登记，报名开放时由 remind 云函数发送 */
  async remind(event, openid) {
    const e = await findById('events', event.eventId);
    if (!e || e.status !== 'published') throw fail('not_found');
    if (!event.templateId) throw fail('missing_template');
    await db.collection('reminders').doc(openid + '_' + e._id).set({
      data: { openid: openid, eventId: e._id, templateId: String(event.templateId), sent: false, createdAt: db.serverDate() }
    });
    return { eventId: e._id };
  },

  /**
   * 「有新活动通知我」：用户授权了一次性订阅消息之后登记。运营在后台点「通知」时，由 remind 云函数给每人发一条。
   * 每人只有一条记录（_id 是 openid）：一次授权只有一条额度，收到一条之后要再点一次才有下一条。
   */
  async subscribeNews(event, openid) {
    if (!event.templateId) throw fail('missing_template');
    const data = { openid: openid, templateId: String(event.templateId), sent: false, status: 'waiting', subscribedAt: db.serverDate() };
    try {
      await db.collection('news_subs').doc(openid).set({ data: data });
    } catch (e) {
      // 集合还没建：建好再写
      await db.createCollection('news_subs');
      await db.collection('news_subs').doc(openid).set({ data: data });
    }
    return { news: true };
  },

  /**
   * 报名：要先是会员；在报名时间内；有名额限制时不超额。
   * 先用条件更新占名额，再写报名记录。任何一步中断，signupCount 只会多不会少，所以不会超额（最坏是空出一个名额）。
   */
  async signup(event, openid) {
    if (!(await findById('members', openid))) throw fail('not_member');
    const e = await findById('events', event.eventId);
    if (!e || e.status !== 'published') throw fail('not_found');
    const now = Date.now();
    const opens = signupOpensAt(e);
    if (opens && now < opens) throw fail('not_open');
    if (e.signupEnd && now > ms(e.signupEnd)) throw fail('closed');

    const id = openid + '_' + e._id;
    if (await findById('signups', id)) return { eventId: e._id, already: true };

    // 不管限不限名额，已报名人数都记：后台要显示，以后给活动加名额限制时这个数也得是对的
    if (typeof e.signupCount !== 'number') await db.collection('events').where({ _id: e._id, signupCount: _.exists(false) }).update({ data: { signupCount: 0 } });
    if (typeof e.quota === 'number') {
      // 条件更新：只有还没满时才加一，避免并发超额
      const res = await db.collection('events').where({ _id: e._id, signupCount: _.lt(e.quota) }).update({ data: { signupCount: _.inc(1) } });
      if (!res.stats.updated) throw fail('full');
    } else {
      await db.collection('events').where({ _id: e._id }).update({ data: { signupCount: _.inc(1) } });
    }
    // 报名记录带上本次请求的标记，写入出错时靠它分清是哪种情况
    const token = Date.now().toString(36) + Math.random().toString(36).slice(2);
    try {
      await db.collection('signups').add({ data: { _id: id, openid: openid, eventId: e._id, token: token, createdAt: db.serverDate() } });
    } catch (err) {
      const existing = await findById('signups', id);
      // 记录在，而且是这次请求写的：写入其实成功了，只是响应丢了。名额已经占上，不能退。
      if (existing && existing.token === token) return { eventId: e._id, already: false };
      // 记录在，但是别的请求写的（同一个人并发点了两次），或者确实没写进去：把这次多占的名额还回去
      await db.collection('events').where({ _id: e._id }).update({ data: { signupCount: _.inc(-1) } });
      if (existing) return { eventId: e._id, already: true };
      throw err;
    }
    return { eventId: e._id, already: false };
  }
};

exports.main = async (event) => {
  let OPENID = '';
  try { OPENID = cloud.getWXContext().OPENID || ''; } catch (e) { /* 网页来的调用没有微信身份 */ }
  const action = event && event.action;
  const handler = actions[action];
  try {
    // 没有微信身份：只有电脑端后台的网页会这样调。只认登录，和带着登录凭证调后台接口
    if (!OPENID) {
      if (action === 'webLogin') return { ok: true, data: await webLogin(event || {}) };
      if (!handler) return { ok: false, code: 'unknown_action' };
      if (WEB_ACTIONS.indexOf(action) < 0) return { ok: false, code: 'no_openid' };
      const admin = await webSession(event.webToken);
      if (!admin) return { ok: false, code: 'web_expired' };
      return { ok: true, data: await handler(event, admin) };
    }
    if (!handler) return { ok: false, code: 'unknown_action' };
    return { ok: true, data: await handler(event, OPENID) };
  } catch (e) {
    if (e && e.code && typeof e.code === 'string') return { ok: false, code: e.code };
    console.error(event.action, e);
    return { ok: false, code: 'server_error' };
  }
};
