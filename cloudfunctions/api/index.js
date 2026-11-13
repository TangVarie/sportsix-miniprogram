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
 *   inbox      给某位用户的站内消息（报名被取消、活动取消）；下次打开小程序时弹出来。第一次用到时云函数自己建这个集合
 *   past_events 往期的赞助赛事  活动页「往期」里的照片卡；第一次用到时云函数自己建这个集合，并放进 PAST_SEED 里的几场
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
// 订阅消息的内容。和 remind/template.js 是同一份（云函数之间不能共用文件，改一处要把另一处也改了，npm test 会核对）
const template = require('./template.js');

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
const WEB_ACTIONS = ['webMe', 'webLogout', 'adminEvents', 'adminSaveEvent', 'adminSetEventStatus', 'adminNotifyEvent', 'adminSignups', 'adminCancelSignup', 'adminCancelEvent', 'adminPastEvents', 'adminSavePast', 'adminDeletePast', 'adminNotice', 'adminSaveNotice',
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
    // 整场取消了的活动：后台列表上标出来
    cancelled: e.cancelled === true,
    signupCount: e.signupCount || 0,
    notify: e.notifyStatus ? { status: e.notifyStatus === 'done' ? 'done' : 'pending', at: ms(e.notifyAt), sent: e.notifySent || 0, failed: e.notifyFailed || 0 } : null
  });
}

/* ---------- 往期的赞助赛事 ---------- */

/**
 * 集合第一次建好时放进去的几场，和 reference/content/events.json 的 past 是同一份（tools/test-cloud.js 会核对）。
 * image 是 assets/ 开头的资源路径，小程序和网页各自拼上资源前缀；后台新加的赛事存的是云存储的 fileID。
 */
const PAST_SEED = [
  { year: '2026', name: '韩国汉江跑步节', nameEn: 'Hangang Running Festival', image: 'assets/photos/endorsement/2026-hangang-running-festival.jpg' },
  { year: '2026', name: '乌兰巴托马拉松', nameEn: 'Ulaanbaatar Marathon', image: 'assets/photos/endorsement/2026-ulaanbaatar-marathon.jpg' },
  { year: '2026', name: '蔚州九峰越野赛', nameEn: 'APTRC 亚太越野跑锦标赛', image: 'assets/photos/endorsement/2026-ulju-nine-peaks-trail.jpg' },
  { year: '2025', name: '韩国自由跑', nameEn: 'Hangang StyleRun', image: 'assets/photos/endorsement/2025-hangang-stylerun.jpg' }
];

/**
 * 全部往期赛事，年份新的在前，同一年里按 order 从小到大（新加的排在这一年的最前面）。
 *
 * 第一次用到时建集合、放进 PAST_SEED。初始的几场用固定的 _id（seed-1、seed-2……），而且赛事从不真的删掉记录，
 * 删除只是打上 deleted: true。所以「把缺的初始赛事补上」这件事什么时候做、做几遍都一样：
 * 记录在（哪怕已经标成删除）就加不进去，运营删掉的不会被放回来；上次放到一半出错的，这次接着补齐。
 * 补完重读一遍，还不齐就报错，不把残缺的列表交出去。
 */
async function listPast() {
  const col = () => db.collection('past_events');
  const read = async () => {
    const all = [];
    for (let page = 0; page < 10; page++) {
      const res = await col().skip(page * 100).limit(100).get();
      all.push(...res.data);
      if (res.data.length < 100) break;
    }
    return all;
  };
  const seedId = (i) => 'seed-' + (i + 1);
  let all;
  try {
    all = await read();
  } catch (e) {
    // 集合还没建（建好再读），或者读取一时出错（集合已经有了，再读一次，还不行就报错）
    try { await db.createCollection('past_events'); } catch (e2) { /* 集合已经有了 */ }
    all = await read();
  }
  if (!PAST_SEED.every((s, i) => all.some((p) => p._id === seedId(i)))) {
    for (let i = 0; i < PAST_SEED.length; i++) {
      if (all.some((p) => p._id === seedId(i))) continue;
      try {
        await col().add({ data: Object.assign({ _id: seedId(i), order: i, createdAt: db.serverDate() }, PAST_SEED[i]) });
      } catch (e) { /* 记录已经在了（另一个请求刚放进去），或者这次没写成：下面重读一遍再看齐不齐 */ }
    }
    all = await read();
    if (!PAST_SEED.every((s, i) => all.some((p) => p._id === seedId(i)))) throw fail('server_error');
  }
  return all.filter((p) => p.deleted !== true)
    .sort((a, b) => (String(b.year).localeCompare(String(a.year))) || ((a.order || 0) - (b.order || 0)))
    // home：放不放在首页「众多专业机构选择 SPORTSIX 产品」那一排里。没设过的（包括初始的几场）按放算
    .map((p) => ({ id: p._id, year: p.year || '', name: p.name || '', nameEn: p.nameEn || '', image: p.image || '', home: p.home !== false }));
}

/** 后台表单交上来的往期赛事 → 要存的数据 */
function pastData(input) {
  const p = input || {};
  const data = { year: cleanText(p.year, 4), name: cleanText(p.name, 30), nameEn: cleanText(p.nameEn, 60), image: cleanText(p.image, 500), home: p.home !== false };
  if (!/^(19|20)\d{2}$/.test(data.year)) throw fail('bad_year');
  if (!data.name) throw fail('missing_name');
  if (!data.image) throw fail('missing_image');
  return data;
}

/* ---------- 新活动通知 ---------- */

/** 这位用户的订阅记录。集合还没建时当作没有 */
async function newsDoc(openid) {
  try { return await findById('news_subs', openid); } catch (e) { return null; }
}
/** 现在点「通知」能发给多少人：订阅着、还没划给哪场活动的。集合还没建时是 0 */
async function newsWaiting() {
  try { return (await db.collection('news_subs').where({ sent: false, eventId: '' }).count()).total; } catch (e) { return 0; }
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
    intro: cleanText(e.intro, 1000, true),
    // 报名要用多少积分（0 是不用积分），和报名的人有事找谁（显示在活动详情里）
    cost: Number.isInteger(e.cost) && e.cost > 0 ? e.cost : 0,
    contact: cleanText(e.contact, 100)
  };
  if (data.cost > 1000000) throw fail('bad_cost');
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
    intro: e.intro || '',
    cost: costOf(e),
    contact: e.contact || ''
  };
}

/** 这场活动报名要用多少积分（没设就是 0） */
function costOf(e) {
  return Number.isInteger(e.cost) && e.cost > 0 ? e.cost : 0;
}

/* ---------- 站内消息 ---------- */

/** 事务里要写的集合得先在：没有就建。每个云函数实例里每个集合只查一次 */
const ensured = {};
async function ensureCollection(name) {
  if (ensured[name]) return;
  try {
    await db.collection(name).limit(1).get();
  } catch (e) {
    try { await db.createCollection(name); } catch (e2) { /* 别的请求刚建好 */ }
  }
  ensured[name] = true;
}

/**
 * 撤掉一个人在一场活动里的报名：删掉报名记录，名额让出来，报名用的积分退回去，并给他留一条消息。
 * 这几步放在一个事务里，要么都做成要么都没做：不会出现记录删了积分却没退的情况，中途出错可以再点一次。
 * 两位管理员同时取消同一个人，只有一个事务删得到记录，积分不会退两次。
 * @param why 'signup'（管理员取消了他的报名）或 'event'（整场活动取消了）
 * @returns 这次有没有撤掉
 */
async function removeSignup(openid, e, why, by) {
  const id = openid + '_' + e._id;
  const s = await findById('signups', id);
  if (!s) return false;
  const cost = Number.isInteger(s.cost) && s.cost > 0 ? s.cost : 0;
  const refund = cost ? '，' + cost + ' 积分已退回' : '';
  const contact = e.contact ? '有疑问请联系 ' + e.contact + '。' : '';
  const notice = why === 'event'
    ? { title: '活动取消', content: '「' + e.title + '」取消了，你的报名已撤销' + refund + '。' + contact }
    : { title: '报名已取消', content: '你在「' + e.title + '」的报名已被取消' + refund + '。' + contact };
  await ensureCollection('inbox');
  if (cost) await ensureCollection('point_logs');
  let removed = false;
  try {
    await db.runTransaction(async (t) => {
      removed = false;
      // 在事务里再读一次这条报名：上面读到之后，它可能已经被另一个请求撤掉，他又重新报了一次（积分数可能不一样了）。
      // 只撤上面读到的那一次报名（token 对得上），不碰他后来重新报的
      let now = null;
      try { now = (await t.collection('signups').doc(id).get()).data; } catch (err) { now = null; }
      if (!now || now.token !== s.token) return;
      const rm = await t.collection('signups').doc(id).remove();
      if (!rm.stats.removed) return;
      const ev = (await t.collection('events').doc(e._id).get()).data;
      if (ev.signupCount >= 1) await t.collection('events').doc(e._id).update({ data: { signupCount: _.inc(-1) } });
      if (cost) {
        await t.collection('members').doc(openid).update({ data: { points: _.inc(cost) } });
        const log = { openid: openid, delta: cost, reason: '退回「' + e.title + '」的报名积分', createdAt: db.serverDate() };
        if (by) log.by = by;
        await t.collection('point_logs').add({ data: log });
      }
      await t.collection('inbox').add({ data: { openid: openid, title: notice.title, content: notice.content, read: false, createdAt: db.serverDate() } });
      removed = true;
    });
  } catch (err) {
    // 那一次报名还在：这次没做成，什么都没变，把错误交出去，再点一次就行。
    // 不在了（或者已经是他重新报的另一次）：别的请求刚撤掉，或者这次其实做成了只是结果没传回来。两种情况积分都已经退好，按「没什么可撤的」处理
    const left = await findById('signups', id);
    if (left && left.token === s.token) throw err;
    return false;
  }
  if (!removed) return false;
  // 报名时同意了订阅的：用那一条额度发一条微信的服务通知。发不出去（他后来关了订阅等）不影响别的，站内消息已经留好了
  if (s.templateId) {
    try {
      await cloud.openapi.subscribeMessage.send({
        touser: openid,
        templateId: s.templateId,
        page: template.page(e),
        miniprogramState: template.miniprogramState,
        lang: 'zh_CN',
        data: template.data(e, ms(e.memberSignupStart) || ms(e.signupStart) || Date.now(), (why === 'event' ? '活动已取消' : '你的报名已取消') + (cost ? '，积分已退回' : ''))
      });
    } catch (err) {
      console.error('cancel notice', id, err && (err.errCode || err.errMsg || err.message));
    }
  }
  return true;
}

/** 报名名单一次最多读多少页（每页 100 人） */
const ROSTER_PAGES = 50;

/** 报名的事务和别人的撞上时，一共试几次 */
const SIGNUP_TRIES = 4;

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
    // 还没看过的站内消息（报名被取消、活动取消），小程序拿到后逐条弹出来
    let inbox = [];
    try {
      const res = await db.collection('inbox').where({ openid: openid, read: false }).orderBy('createdAt', 'asc').limit(10).get();
      inbox = res.data.map((m) => ({ id: m._id, title: m.title || '', content: m.content || '' }));
    } catch (e) { /* 集合还没建：没有消息 */ }
    return {
      inbox: inbox,
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

  /** 站内消息看过了：标成已读，下次不再弹 */
  async readInbox(event, openid) {
    const ids = (Array.isArray(event.ids) ? event.ids : []).filter((x) => typeof x === 'string').slice(0, 20);
    for (const id of ids) {
      try { await db.collection('inbox').where({ _id: id, openid: openid }).update({ data: { read: true } }); } catch (e) { /* 集合还没建 */ }
    }
    return {};
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

  /** 活动页「往期」里的赞助赛事 */
  async pastEvents() {
    return { past: await listPast() };
  },

  /* ---------- 运营后台（只给管理员） ---------- */

  /**
   * 一场活动的报名名单：昵称、会员编号、手机号、用了多少积分、什么时候报的，早报的在前。
   * 这里给的是完整手机号：运营要靠它联系报名的人（隐私政策里写了手机号会用于就活动事项联系）。
   */
  async adminSignups(event, openid) {
    await requireAdmin(openid);
    const e = await findById('events', String(event.id || ''));
    if (!e) throw fail('not_found');
    const all = [];
    for (let page = 0; page < ROSTER_PAGES; page++) {
      const res = await db.collection('signups').where({ eventId: e._id }).skip(page * 100).limit(100).get();
      all.push(...res.data);
      if (res.data.length < 100) break;
    }
    // 名单最多给 ROSTER_PAGES × 100 人。超出时 total 比 signups 多，页面上要说明没显示全
    const total = all.length < ROSTER_PAGES * 100 ? all.length : (await db.collection('signups').where({ eventId: e._id }).count()).total;
    all.sort((a, b) => (ms(a.createdAt) || 0) - (ms(b.createdAt) || 0));
    const members = {};
    for (let i = 0; i < all.length; i += 100) {
      const res = await db.collection('members').where({ _id: _.in(all.slice(i, i + 100).map((s) => s.openid)) }).limit(100).get();
      res.data.forEach((m) => { members[m._id] = m; });
    }
    return {
      event: adminEventView(e),
      total: total,
      signups: all.map((s) => {
        const m = members[s.openid] || {};
        return { memberNo: m.memberNo || '', nickname: m.nickname || '', phone: m.phone || '', cost: Number.isInteger(s.cost) ? s.cost : 0, at: ms(s.createdAt) };
      })
    };
  },

  /** 取消某位会员在一场活动里的报名：名额让出来，积分退回去，给他留一条消息 */
  async adminCancelSignup(event, openid) {
    await requireAdmin(openid);
    const e = await findById('events', String(event.id || ''));
    if (!e) throw fail('not_found');
    const res = await db.collection('members').where({ memberNo: String(event.memberNo || '') }).limit(1).get();
    if (!event.memberNo || !res.data[0]) throw fail('not_found');
    if (!(await removeSignup(res.data[0]._id, e, 'signup', openid))) throw fail('not_signed');
    return { event: adminEventView(await findById('events', e._id)) };
  },

  /**
   * 取消整场活动：先下架（小程序里不再显示，也报不了名），再把报名的人逐个撤掉、退积分、留消息。
   * 人多时一次调用做不完：每次最多处理 40 人，返回还剩多少（remaining），页面接着调，直到 0。
   * 报名的事务里会重新读活动的状态，所以下架之后不会再有新的报名写进来。
   */
  async adminCancelEvent(event, openid) {
    await requireAdmin(openid);
    const id = String(event.id || '');
    const e = await findById('events', id);
    if (!e) throw fail('not_found');
    // 每次都下架：取消过的活动可能又被上架了，再取消时也得先下架，不然撤完了还能接着报
    if (!e.cancelled || e.status !== 'draft') await db.collection('events').doc(id).update({ data: { status: 'draft', cancelled: true, cancelledAt: db.serverDate(), updatedAt: db.serverDate() } });
    const batch = await db.collection('signups').where({ eventId: id }).limit(40).get();
    for (const s of batch.data) {
      // 某一个人没撤成（数据库一时出错）不拖累别人：他还留在名单里，算在 remaining 里，下一次调用再撤
      try { await removeSignup(s.openid, e, 'event', openid); } catch (err) { console.error('cancel event', s._id, err && err.message); }
    }
    const remaining = (await db.collection('signups').where({ eventId: id }).count()).total;
    return { event: adminEventView(await findById('events', id)), remaining: remaining };
  },

  /** 往期的赞助赛事（后台列表） */
  async adminPastEvents(event, openid) {
    await requireAdmin(openid);
    return { past: await listPast() };
  },

  /** 新加或修改一场往期赛事。带 id 是修改，不带是新加（排在这一年的最前面） */
  async adminSavePast(event, openid) {
    await requireAdmin(openid);
    const data = pastData(event.item);
    const all = await listPast(); // 顺带保证集合已经建好
    const id = event.id ? String(event.id) : '';
    if (id) {
      if (!all.some((p) => p.id === id)) throw fail('not_found');
      // 条件里带上「没删」：刚好被另一位管理员删掉的，不会被这次修改写回一半内容
      const done = await db.collection('past_events').where({ _id: id, deleted: _.exists(false) }).update({ data: Object.assign(data, { updatedAt: db.serverDate() }) });
      if (!done.stats.updated) throw fail('not_found');
    } else {
      // order 越小越靠前：新加的用负的当前时间，排在同一年已有的前面
      await db.collection('past_events').add({ data: Object.assign(data, { order: -Date.now(), createdAt: db.serverDate(), updatedAt: db.serverDate() }) });
    }
    return { past: await listPast() };
  },

  /** 删掉一场往期赛事 */
  async adminDeletePast(event, openid) {
    await requireAdmin(openid);
    const id = String(event.id || '');
    const all = await listPast();
    if (!all.some((p) => p.id === id)) throw fail('not_found');
    // 不真的删记录，只标成删除（原因见 listPast 的说明）
    await db.collection('past_events').doc(id).update({ data: { deleted: true, deletedAt: db.serverDate() } });
    return { past: await listPast() };
  },


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
   *
   * 每次登记有一个自己的编号（notifyId）。登记的同时，把现在订阅着、还没划给别的登记的人划给这一次
   * （订阅记录上写 job 和 eventId）。这一步是一条更新语句，每条订阅记录只会被划给一次登记：
   * 两位管理员同时通知两场活动时，人不会被发两遍；一个人都没划到的那一场会撤回登记，机会还在。
   * 之后才订阅的人不在这场里，额度留给下一场。
   *
   * 划人这一步出错时不在这里撤回：更新可能其实已经做成了、只是结果没传回来，这时撤回登记会把划好的人晾在那里。
   * 留着这条没写 notifyTotal 的登记，remind 两分钟后会把人放回去并撤掉它（见 remind 里的 stopNews）。
   */
  async adminNotifyEvent(event, openid) {
    await requireAdmin(openid);
    const id = String(event.id || '');
    const e = await findById('events', id);
    if (!e) throw fail('not_found');
    if (e.status !== 'published') throw fail('not_published');
    if (ms(e.date) && ms(e.date) < Date.now()) throw fail('event_ended');
    if (e.notifyStatus) throw fail('notified');
    if (!(await newsWaiting())) throw fail('no_subscribers');
    const job = crypto.randomBytes(8).toString('hex');
    // 条件更新：两位管理员同时点同一场，只有一个登记得上
    const res = await db.collection('events').where({ _id: id, notifyStatus: _.exists(false) })
      .update({ data: { notifyStatus: 'pending', notifyId: job, notifyAt: db.serverDate(), notifyBy: openid, notifySent: 0, notifyFailed: 0 } });
    if (!res.stats.updated) throw fail('notified');
    // 下面两步只动「这一次登记、而且人还没划好」的活动记录
    const mine = { _id: id, notifyId: job, notifyStatus: 'pending', notifyTotal: _.exists(false) };
    const total = (await db.collection('news_subs').where({ sent: false, eventId: '' }).update({ data: { eventId: id, job: job } })).stats.updated;
    if (!total) {
      // 刚才还有人订阅，这一刻被另一场活动的通知划走了：撤回登记
      await db.collection('events').where(mine).update({
        data: { notifyStatus: _.remove(), notifyId: _.remove(), notifyAt: _.remove(), notifyBy: _.remove(), notifySent: _.remove(), notifyFailed: _.remove() }
      });
      throw fail('no_subscribers');
    }
    // notifyTotal 写上以后，remind 才开始发这一场
    await db.collection('events').where(mine).update({ data: { notifyTotal: total } });
    return { event: adminEventView(await findById('events', id)), waiting: total };
  },

  /** 新建或修改活动。带 id 是修改，不带是新建 */
  async adminSaveEvent(event, openid) {
    await requireAdmin(openid);
    const data = eventData(event.event);
    let id = event.id ? String(event.id) : '';
    if (id) {
      if (!(await findById('events', id))) throw fail('not_found');
      // 取消过的活动在表单里重新上架：就不再是「已取消」了
      if (data.status === 'published') data.cancelled = false;
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
    const data = { status: status, updatedAt: db.serverDate() };
    // 取消过的活动重新上架：就不再是「已取消」了
    if (status === 'published') data.cancelled = false;
    await db.collection('events').doc(id).update({ data: data });
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
    if (!Number.isInteger(delta) || delta === 0) throw fail('bad_delta');
    // 一次最多加减 10 万：超了要说清楚是太多了，不是没填
    if (Math.abs(delta) > 100000) throw fail('delta_too_large');
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
   * eventId 是这条订阅划给了哪场活动，job 是划给了哪一次登记，空的是还没划（见 adminNotifyEvent）。
   */
  async subscribeNews(event, openid) {
    if (!event.templateId) throw fail('missing_template');
    const data = { openid: openid, templateId: String(event.templateId), sent: false, status: 'waiting', eventId: '', job: '', subscribedAt: db.serverDate() };
    const subs = db.collection('news_subs');
    // 写的时候不能照着刚才读到的样子直接盖上去：同一个人的两个请求同时进来（比如两台手机），
    // 先到的那个写好之后可能已经被划给了某场活动，后到的再盖一遍就把他从那场里挤出去了。所以：
    // - 还没有记录：新增。记录已经在了会新增失败，转到下面按已有记录处理；
    // - 有记录：只有它是「已经发过」的才改回「订阅着」。已经订阅着的原样留着。
    if (!(await newsDoc(openid))) {
      const add = () => subs.add({ data: Object.assign({ _id: openid }, data) });
      try {
        await add();
        return { news: true };
      } catch (e) {
        // 集合还没建（建好再加一次），或者同一个人的另一个请求刚加好这条记录
        try { await db.createCollection('news_subs'); } catch (e2) { /* 集合已经有了 */ }
        try { await add(); return { news: true }; } catch (e3) { /* 记录已经在了 */ }
      }
    }
    await subs.where({ _id: openid, sent: true })
      .update({ data: Object.assign({}, data, { claimedAt: _.remove(), sentAt: _.remove(), error: _.remove() }) });
    // 到这里应该是订阅着的；不是的话说明上面哪一步没写成
    const now = await findById('news_subs', openid);
    if (!now || now.sent !== false) throw fail('server_error');
    return { news: true };
  },

  /**
   * 报名：要先是会员；在报名时间内；有名额限制时不超额；这场要用积分的，积分得够（不够报不了）。
   * 报名后会员自己不能取消，要联系运营（活动详情里有联系方式），由运营在后台取消并退积分。
   * 占名额、扣积分、写报名记录在一个事务里，要么都做成要么都没做：不会扣了积分却没报上，也不会超额。
   * 活动在这中间被下架或取消的，事务里会发现，报不上。
   */
  async signup(event, openid) {
    const member = await findById('members', openid);
    if (!member) throw fail('not_member');
    const e = await findById('events', event.eventId);
    if (!e || e.status !== 'published') throw fail('not_found');
    const now = Date.now();
    const opens = signupOpensAt(e);
    if (opens && now < opens) throw fail('not_open');
    if (e.signupEnd && now > ms(e.signupEnd)) throw fail('closed');

    const id = openid + '_' + e._id;
    if (await findById('signups', id)) return { eventId: e._id, already: true };

    // 这场要用积分的：先看够不够，不够就不用往下走了（事务里还会再看一次）
    // expected：用户在页面上确认过的积分数（老版本的小程序不带这一项，不比）
    const expected = Number.isInteger(event.cost) && event.cost >= 0 ? event.cost : null;
    // 要用的积分和他确认时看到的不一样了：先说这个，让页面拿新的数重新确认，而不是照旧的数说「积分不够」
    if (expected !== null && expected !== costOf(e)) throw fail('cost_changed');
    if (costOf(e) && !((member.points || 0) >= costOf(e))) throw fail('insufficient_points');
    await ensureCollection('point_logs');

    // 报名记录带上本次请求的标记，事务出错时靠它分清是哪种情况；cost 是这次用了多少积分，取消时照这个数退
    const token = Date.now().toString(36) + Math.random().toString(36).slice(2);
    // 事务里发现报不了时把原因记在这里（事务不写任何东西，正常结束）
    let refused = '';
    const attempt = () => db.runTransaction(async (t) => {
      refused = '';
      // 活动和会员在事务里重新读：这时活动可能刚被下架或取消、刚改了要用的积分，名额可能刚被别人占掉，积分可能刚用在别处
      const ev = (await t.collection('events').doc(e._id).get()).data;
      if (ev.status !== 'published') { refused = 'not_found'; return; }
      const cost = costOf(ev);
      // 要用的积分和他确认时看到的不一样了：不扣，让页面拿新的数重新确认
      if (expected !== null && expected !== cost) { refused = 'cost_changed'; return; }
      const count = typeof ev.signupCount === 'number' ? ev.signupCount : 0;
      if (typeof ev.quota === 'number' && count >= ev.quota) { refused = 'full'; return; }
      if (cost) {
        const me = (await t.collection('members').doc(openid).get()).data;
        if (!((me.points || 0) >= cost)) { refused = 'insufficient_points'; return; }
        await t.collection('members').doc(openid).update({ data: { points: _.inc(-cost) } });
        await t.collection('point_logs').add({ data: { openid: openid, delta: -cost, reason: '报名「' + ev.title + '」', createdAt: db.serverDate() } });
      }
      // 不管限不限名额，已报名人数都记：后台要显示，以后给活动加名额限制时这个数也得是对的
      await t.collection('events').doc(e._id).update({ data: { signupCount: count + 1 } });
      // templateId：报名时同意了订阅消息的，记下模板，报名被取消或活动取消时用它发一条通知。
      // 同一个人的另一个请求已经写了这条记录时，这里会失败，整个事务作废
      await t.collection('signups').add({
        data: { _id: id, openid: openid, eventId: e._id, token: token, cost: cost, templateId: event.templateId ? String(event.templateId) : '', createdAt: db.serverDate() }
      });
    });
    for (let left = SIGNUP_TRIES; ; left--) {
      try {
        await attempt();
        break;
      } catch (err) {
        const existing = await findById('signups', id);
        // 记录在，而且是这次请求写的：事务其实提交了，只是结果没传回来。照成功处理
        if (existing && existing.token === token) break;
        // 记录在，但是别的请求写的（同一个人连点了两次）：这次什么都没扣，按「已经报过」处理
        if (existing) return { eventId: e._id, already: true };
        // 没写进去（很多人同时抢名额时事务会互相冲突）：这次什么都没变，再试；试够了把错误交出去
        if (left <= 1) throw err;
      }
    }
    if (refused) {
      // 同一个人连点了两次：另一个请求刚把积分扣走并报上了名，这次按「已经报过」处理，不提示积分不够或名额满了
      if (await findById('signups', id)) return { eventId: e._id, already: true };
      throw fail(refused);
    }
    return { eventId: e._id, already: false, member: memberView(await findById('members', openid)) };
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
