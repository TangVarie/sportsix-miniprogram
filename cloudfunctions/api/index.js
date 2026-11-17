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
 *
 *   interactions 现场互动  大转盘、网页、其他小程序；平时关着，运营打开后小程序里才有入口。第一次用到时云函数自己建
 *   draws        抽奖记录  每抽一次一条，中了的带领奖码；第一次用到时云函数自己建
 *   draw_users   抽奖次数  每人在每个互动里抽了几次；第一次用到时云函数自己建
 *   draw_codes   领奖码    每个中奖的领奖码占一条（_id 是「互动id_领奖码」），保证同一个互动里不重复；第一次用到时云函数自己建
 *
 * 报名表存在活动的 form 上，填好的内容存在报名记录的 answers 上（见「报名表」一节）。
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

// 事务读取不存在的文档时 SDK 会抛错；只把明确的「文档不存在」当作空，网络/权限错误必须继续抛出。
async function transactionDoc(t, name, id) {
  try { return (await t.collection(name).doc(id).get()).data || null; }
  catch (e) {
    if (/document.*(?:not exist|does not exist|not found)/i.test(String(e && (e.errMsg || e.message)))) return null;
    throw e;
  }
}

const randomId = () => crypto.randomBytes(16).toString('hex');
function operationId(value) {
  if (value == null || value === '') return randomId(); // 兼容旧客户端，只保证本次请求内重试
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(value)) throw fail('bad_input');
  return value;
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
 * - 没领过注册积分的补送一次，积分和固定 ID 的赠分流水放在同一个事务中。
 * - 旧版赠分流水漏记的只恢复流水，不再次加余额。
 * 编号仍使用条件写入；取号失败可以下次补发，积分事务失败则向调用方报错，重进可恢复。
 */
async function ensureMember(member) {
  if (!member) return member;
  let m = member;
  if (m.ledgerVersion !== 1) {
    await ensureCollection('point_logs');
    // 兼容旧版随机 ID 的赠分流水。新记录使用固定 ID，旧版漏记的流水可在下次进入时恢复。
    const old = (await db.collection('point_logs').where({ openid: m._id, reason: 'welcome' }).limit(1).get()).data[0];
    const logId = 'welcome_' + sha(m._id);
    try {
      await db.runTransaction(async (t) => {
        const current = await transactionDoc(t, 'members', m._id);
        if (!current || current.ledgerVersion === 1) return;
        const log = await transactionDoc(t, 'point_logs', logId);
        const data = { ledgerVersion: 1, welcomeBonus: true };
        if (!current.welcomeBonus) data.points = _.inc(WELCOME_POINTS);
        if (!old && !log) await t.collection('point_logs').doc(logId).set({ data: {
          openid: m._id, delta: WELCOME_POINTS, reason: 'welcome', createdAt: current.createdAt || db.serverDate()
        } });
        await t.collection('members').doc(m._id).update({ data: data });
      });
    } catch (e) {
      // 提交结果丢失时以数据库中的事务标记确认；失败时不返回虚假的赠分成功。
      const confirmed = await findById('members', m._id);
      if (!confirmed || confirmed.ledgerVersion !== 1) throw e;
    }
    m = await findById('members', m._id) || m;
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
  'adminFindMember', 'adminAdjustPoints', 'adminMemberStats', 'adminMembers', 'adminUploadCover', 'adminFileUrls',
  'adminInteractions', 'adminSaveInteraction', 'adminSetInteractionStatus', 'adminDeleteInteraction', 'adminDraws', 'adminRedeem', 'adminInteractionCode'];

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

/** 会员看板：一天多少毫秒、北京时间比 UTC 早多少、统计时一页读多少人最多读几页、名单一页多少人 */
const DAY = 24 * 3600 * 1000;
const TZ_OFFSET = 8 * 3600 * 1000;
const STATS_PAGE_SIZE = 1000;
const STATS_PAGES = 20;
const MEMBERS_PAGE = 30;

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
  if ((e.cost != null && e.cost !== '' && (!Number.isInteger(e.cost) || e.cost < 0)) || data.cost > 1000000) throw fail('bad_cost');
  if (!data.type) throw fail('bad_type');
  if (!data.title) throw fail('missing_title');
  if (!data.date) throw fail('missing_date');
  if (data.signupStart && data.signupEnd && data.signupEnd <= data.signupStart) throw fail('bad_signup_time');
  if (e.quota != null && e.quota !== '' && (!Number.isInteger(e.quota) || e.quota <= 0)) throw fail('bad_quota');
  const opens = data.memberSignupStart || data.signupStart;
  if ((data.memberSignupStart && data.signupStart && data.memberSignupStart > data.signupStart) ||
      (opens && opens > data.date) || (data.signupEnd && data.signupEnd > data.date) ||
      (opens && data.signupEnd && data.signupEnd <= opens)) throw fail('bad_signup_time');
  // 报名表。没带这一项的（更新前的后台页面）不动已经存的报名表，免得改别的内容时把报名表清掉
  if (e.form !== undefined) data.form = formData(e.form);
  return data;
}

/* ---------- 报名表 ---------- */

/**
 * 报名表由运营在后台按模块拼：每一项有自己的 id（运营新加这一项时页面生成，之后不变）、类型、标题、是否必填，
 * 单选和多选另有选项。存在活动的 form 上（数组，没有报名表是 null）。
 * 类型：text 一行字，textarea 多行字，phone 电话，idno 证件号码，date 日期，single 单选，multi 多选。
 * 「姓名」「性别」「服装尺码」这些是后台页面上预先填好标题和选项的模块，存下来就是上面这几种类型。
 */
const FORM_KINDS = ['text', 'textarea', 'phone', 'idno', 'date', 'single', 'multi'];
const FORM_MAX_FIELDS = 20;
const FORM_MAX_OPTIONS = 20;
/** 每种类型的回答最多多少个字 */
const ANSWER_MAX = { text: 50, textarea: 300 };

function formData(input) {
  if (input == null) return null;
  const list = Array.isArray(input) ? input : (input && Array.isArray(input.fields) ? input.fields : null);
  if (!list) throw fail('bad_form');
  if (list.length > FORM_MAX_FIELDS) throw fail('form_too_long');
  const seen = Object.create(null);
  const fields = list.map((f) => {
    const kind = f && FORM_KINDS.indexOf(f.kind) >= 0 ? f.kind : '';
    const id = f && typeof f.id === 'string' && /^[a-zA-Z0-9_-]{1,24}$/.test(f.id) ? f.id : '';
    if (!kind || !id || seen[id]) throw fail('bad_form');
    seen[id] = true;
    const label = cleanText(f.label, 20);
    if (!label) throw fail('missing_field_label');
    const field = { id: id, kind: kind, label: label, required: f.required === true };
    if (kind === 'single' || kind === 'multi') {
      const options = [];
      (Array.isArray(f.options) ? f.options : []).forEach((o) => {
        const v = cleanText(o, 100);
        // 选项超长直接报错，不悄悄截断：截掉以后运营看到的和用户看到的对不上
        if (Array.from(v).length > 20) throw fail('option_too_long');
        if (v && options.indexOf(v) < 0) options.push(v);
      });
      if (options.length < 2) throw fail('missing_options');
      if (options.length > FORM_MAX_OPTIONS) throw fail('too_many_options');
      field.options = options;
    }
    return field;
  });
  return fields.length ? fields : null;
}

/** 这场活动的报名表（没有就是空数组） */
const formOf = (e) => (e && Array.isArray(e.form) ? e.form : []);

/** 18 位的居民身份证号按国家标准核对最后一位；别的证件（护照、港澳台证件等）只看格式 */
function idnoOk(v) {
  if (!/^[0-9A-Z]{6,30}$/.test(v)) return false;
  if (!/^\d{17}[\dX]$/.test(v)) return true;
  const w = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += Number(v[i]) * w[i];
  return '10X98765432'[sum % 11] === v[17];
}

function dateOk(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return +m[1] >= 1900 && +m[1] <= 2100 && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/**
 * 按报名表整理用户交上来的回答（{ 项的 id: 值 }，多选的值是数组）。
 * 返回 { answers, missing }：answers 是要存的 [{ id, label, value }]（带上当时的标题，运营之后改了报名表也看得懂），
 * missing 是没填的必填项。格式不对（电话、证件号码、日期，或者选了不在选项里的）直接报 bad_answer。
 */
function cleanAnswers(fields, input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const answers = [];
  const missing = [];
  fields.forEach((f) => {
    const raw = src[f.id];
    let value;
    if (f.kind === 'multi') {
      const picked = (Array.isArray(raw) ? raw : []).map((x) => String(x));
      if (picked.some((x) => f.options.indexOf(x) < 0)) throw fail('bad_answer');
      value = f.options.filter((o) => picked.indexOf(o) >= 0);
      if (!value.length) value = null;
    } else {
      let s = raw == null ? '' : String(raw);
      if (f.kind === 'phone') s = s.replace(/[\s-]/g, '');
      else if (f.kind === 'idno') s = s.replace(/\s/g, '').toUpperCase();
      else s = cleanText(s, ANSWER_MAX[f.kind] || 50, f.kind === 'textarea');
      if (s && f.kind === 'phone' && !/^\+?\d{5,20}$/.test(s)) throw fail('bad_answer');
      if (s && f.kind === 'idno' && !idnoOk(s)) throw fail('bad_answer');
      if (s && f.kind === 'date' && !dateOk(s)) throw fail('bad_answer');
      if (s && f.kind === 'single' && f.options.indexOf(s) < 0) throw fail('bad_answer');
      value = s || null;
    }
    if (value == null) { if (f.required) missing.push(f.id); return; }
    answers.push({ id: f.id, label: f.label, value: value });
  });
  return { answers: answers, missing: missing };
}

/** 存着的回答还缺不缺必填项（报名之后运营可能又加了必填项） */
function answersComplete(fields, answers) {
  const have = Object.create(null);
  (Array.isArray(answers) ? answers : []).forEach((a) => { have[a.id] = true; });
  return fields.every((f) => !f.required || have[f.id]);
}

/** 给本人看的回答：{ 项的 id: 值 } */
function answerMap(answers) {
  const out = {};
  (Array.isArray(answers) ? answers : []).forEach((a) => { out[a.id] = a.value; });
  return out;
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
  await ensureCollection('settings');
  return findById('settings', 'notice');
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
    status: e.status === 'published' ? 'published' : 'draft',
    cancelled: e.cancelled === true,
    signupCount: e.signupCount || 0,
    version: Number.isInteger(e.version) ? e.version : 0,
    updatedAt: ms(e.updatedAt),
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
    contact: e.contact || '',
    // 报名表（没有是空数组）
    form: formOf(e)
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
    // 瞬时读取失败不能被误认为初始化成功。
    if (!/collection.*(?:not exist|does not exist)/i.test(String(e && (e.errMsg || e.message)))) throw e;
    try { await db.createCollection(name); } catch (e2) {
      if (!/exist/i.test(String(e2 && (e2.errMsg || e2.message)))) throw e2;
    }
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
      const now = await transactionDoc(t, 'signups', id);
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
const signupClosesAt = (e) => Math.min(ms(e.signupEnd) || Infinity, ms(e.date) || Infinity);

function checkEventVersion(input, current) {
  const version = input.version == null && input.event ? input.event.version : input.version;
  const updatedAt = input.updatedAt == null && input.event ? input.event.updatedAt : input.updatedAt;
  if ((version != null && version !== (current.version || 0)) ||
      (version == null && updatedAt != null && updatedAt !== ms(current.updatedAt))) throw fail('conflict');
}

function planView(plan) {
  if (!plan) return null;
  const view = { input: plan.input, savedAt: ms(plan.savedAt) };
  if (plan.formulaVersion) { view.formulaVersion = plan.formulaVersion; view.result = plan.result; }
  return view;
}

const PLAN_KEYS = { sport: 'string', scene: 'string', start: 'string', minutes: 'number', kg: 'number', caffeineSensitive: 'boolean', hot: 'boolean', firstTime: 'boolean' };

/* ---------- 现场互动 ---------- */

/**
 * 活动现场的互动（interactions 集合）。平时关着，小程序里看不到入口；运营在后台打开后，
 * 活动页顶上和关联活动的详情里出现入口，也可以打印小程序码让现场的人扫。里面放什么由运营换，不用发版：
 *   wheel 大转盘：奖品、数量、中奖机会、每人抽几次都在后台填，抽奖在云端做（draw）；
 *   web   网页：别处做好的 H5 活动，小程序里用 web-view 打开（域名要先加进小程序后台的业务域名）；
 *   mini  其他小程序：填 AppID 和页面路径，或者小程序链接（#小程序://…）。
 * _id 是 8 位的字母数字（小程序码的 scene 最多 32 个字，系统自动生成的 _id 放不下）。
 *
 * draws       每抽一次一条：_id 是「互动id_openid_第几次」，中了的带 6 位领奖码，现场核销后 redeemed 为 true
 * draw_users  每人在每个互动里抽了几次：_id 是「互动id_openid」
 * draw_codes  已经发出去的领奖码：_id 是「互动id_领奖码」，同一个互动里领奖码不重复
 */
const INTERACT_KINDS = ['wheel', 'web', 'mini'];
/** 谁能参与：所有人、会员、报了关联活动的会员 */
const AUDIENCES = ['all', 'member', 'signed'];
const PRIZE_MAX = 8;
const TRIES_MAX = 20;
/** 中奖机会按万分之几算（页面上填百分比，最多两位小数） */
const CHANCE_BASE = 10000;
const DRAWS_PAGES = 20;

const shortId = () => {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[bytes[i] % chars.length];
  return s;
};
const randomBelow = (n) => (crypto.randomInt ? crypto.randomInt(n) : crypto.randomBytes(4).readUInt32BE(0) % n);
/** 6 位领奖码，第一位是 1 到 9（252 以上的字节丢掉，九个数字出现的机会一样）。导出的表格用 Excel 打开时不会把开头的 0 吞掉 */
function prizeCode() {
  for (;;) {
    const b = crypto.randomBytes(1)[0];
    if (b < 252) return String(b % 9 + 1) + randomDigits(5);
  }
}

/** 后台表单交上来的互动 → 要存的数据（不含状态、版本和各奖品已经抽中了几个） */
function interactionData(input) {
  const x = input || {};
  const data = {
    title: cleanText(x.title, 20),
    kind: INTERACT_KINDS.indexOf(x.kind) >= 0 ? x.kind : '',
    eventId: cleanText(x.eventId, 64),
    note: cleanText(x.note, 300, true),
    audience: AUDIENCES.indexOf(x.audience) >= 0 ? x.audience : 'all',
    prizes: [],
    tries: 1,
    url: '',
    appId: '',
    path: '',
    shortLink: ''
  };
  if (!data.kind) throw fail('bad_kind');
  if (!data.title) throw fail('missing_title');
  if (data.audience === 'signed' && !data.eventId) throw fail('missing_event');
  if (data.kind === 'wheel') {
    const list = Array.isArray(x.prizes) ? x.prizes : [];
    if (!list.length) throw fail('missing_prizes');
    if (list.length > PRIZE_MAX) throw fail('too_many_prizes');
    const seen = Object.create(null);
    let sum = 0;
    data.prizes = list.map((p) => {
      const id = p && typeof p.id === 'string' && /^[a-zA-Z0-9_-]{1,24}$/.test(p.id) ? p.id : '';
      if (!id || seen[id]) throw fail('bad_form');
      seen[id] = true;
      const name = cleanText(p.name, 12);
      if (!name) throw fail('missing_prize_name');
      if (!Number.isInteger(p.total) || p.total < 0 || p.total > 100000) throw fail('bad_prize_total');
      const chance = Number(p.chance);
      if (!isFinite(chance) || chance < 0 || chance > 100 || Math.abs(Math.round(chance * 100) - chance * 100) > 1e-6) throw fail('bad_chance');
      sum += Math.round(chance * 100);
      return { id: id, name: name, total: p.total, chance: Math.round(chance * 100) / 100 };
    });
    if (sum > CHANCE_BASE) throw fail('bad_chance');
    if (!Number.isInteger(x.tries) || x.tries < 1 || x.tries > TRIES_MAX) throw fail('bad_tries');
    data.tries = x.tries;
  } else if (data.kind === 'web') {
    data.url = cleanText(x.url, 500);
    if (!/^https:\/\/[^\s/]+\.[^\s]+$/.test(data.url)) throw fail('bad_url');
  } else {
    data.appId = cleanText(x.appId, 32);
    data.path = cleanText(x.path, 200);
    data.shortLink = cleanText(x.shortLink, 200);
    if (data.shortLink) {
      if (data.shortLink.indexOf('#小程序://') !== 0) throw fail('bad_mini');
      data.appId = ''; data.path = '';
    } else if (!/^wx[0-9a-f]{16}$/.test(data.appId)) throw fail('bad_mini');
  }
  return data;
}

/** 给小程序看的互动。中奖机会和奖品数量不给，只给奖品名称（转盘上要画） */
function interactionView(x) {
  return {
    id: x._id,
    title: x.title || '',
    kind: x.kind,
    note: x.note || '',
    eventId: x.eventId || '',
    audience: x.audience || 'all',
    open: x.status === 'on' && x.deleted !== true,
    tries: x.kind === 'wheel' ? (x.tries || 1) : 0,
    prizes: x.kind === 'wheel' ? (x.prizes || []).map((p) => ({ id: p.id, name: p.name })) : [],
    url: x.kind === 'web' ? x.url || '' : '',
    appId: x.kind === 'mini' ? x.appId || '' : '',
    path: x.kind === 'mini' ? x.path || '' : '',
    shortLink: x.kind === 'mini' ? x.shortLink || '' : ''
  };
}

/** 后台看到的互动：多了状态、版本、每个奖品的数量和机会、抽了多少次 */
function adminInteractionView(x, stats) {
  return Object.assign(interactionView(x), {
    status: x.status === 'on' ? 'on' : 'off',
    version: Number.isInteger(x.version) ? x.version : 0,
    updatedAt: ms(x.updatedAt),
    url: x.url || '', appId: x.appId || '', path: x.path || '', shortLink: x.shortLink || '',
    prizes: (x.prizes || []).map((p) => ({ id: p.id, name: p.name, total: p.total || 0, chance: p.chance || 0, won: p.won || 0 })),
    draws: stats ? stats.draws : 0,
    wins: stats ? stats.wins : 0,
    redeemed: stats ? stats.redeemed : 0
  });
}

/** 正在进行的互动（小程序里显示入口用）。集合还没建时是空的 */
async function liveInteractions(eventId) {
  try {
    const cond = { status: 'on', deleted: _.exists(false) };
    if (eventId) cond.eventId = eventId;
    const res = await db.collection('interactions').where(cond).orderBy('updatedAt', 'desc').limit(10).get();
    return res.data.map((x) => ({ id: x._id, title: x.title || '', kind: x.kind, eventId: x.eventId || '' }));
  } catch (e) { return []; }
}

async function findInteraction(id) {
  await ensureCollection('interactions');
  const x = typeof id === 'string' && id ? await findById('interactions', id) : null;
  return x && x.deleted !== true ? x : null;
}

/** 这个人能不能参与：返回 '' 是能，否则是原因（not_member、not_signed） */
async function audienceBlock(x, openid) {
  if (!x.audience || x.audience === 'all') return '';
  const member = await findById('members', openid);
  if (!member) return 'not_member';
  if (x.audience === 'signed') {
    const s = x.eventId ? await findById('signups', openid + '_' + x.eventId) : null;
    if (!s) return 'not_signed';
  }
  return '';
}

/** 本人在这个互动里的抽奖记录，先抽的在前 */
async function myDraws(x, openid) {
  await ensureCollection('draws');
  const res = await db.collection('draws').where({ interactionId: x._id, openid: openid }).limit(TRIES_MAX).get();
  const list = res.data.sort((a, b) => a.n - b.n).map((d) => ({
    n: d.n, win: d.win === true, prizeName: d.prizeName || '', code: d.code || '', redeemed: d.redeemed === true, at: ms(d.createdAt)
  }));
  const tries = x.tries || 1;
  return { used: list.length, tries: tries, left: Math.max(0, tries - list.length), results: list };
}

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
      plan: planView(plan),
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
    // 先建立可恢复的基础会员；ensureMember 在事务中发赠分并写流水，避免有余额没有账目。
    const doc = {
      openid: openid, phone: info.purePhoneNumber, countryCode: info.countryCode || '', nickname: '',
      memberNo: null, points: 0, createdAt: db.serverDate()
    };
    // 用 add 而不是 set：同一个人的两个注册请求同时进来时，后到的那个写不进去，不会把先建好的记录（连同编号）盖掉
    let created = true;
    try {
      await db.collection('members').add({ data: Object.assign({ _id: openid }, doc) });
    } catch (e) {
      created = false;
      if (!(await findById('members', openid))) throw e;
    }
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
    await ensureCollection('point_logs');
    const res = await db.collection('point_logs').where({ openid: openid }).orderBy('createdAt', 'desc').limit(50).get();
    const logs = res.data.map((l) => ({ id: l._id, delta: l.delta, reason: l.reason, at: ms(l.createdAt) }));
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
    if (!['road', 'trail', 'bike', 'hike', 'climb', 'ski'].includes(input.sport) ||
        !['long', 'hard', 'race'].includes(input.scene) || !['am', 'pm', 'night'].includes(input.start) ||
        !Number.isInteger(input.minutes) || input.minutes < 30 || input.minutes > 2880 ||
        !Number.isFinite(input.kg) || input.kg < 40 || input.kg > 110 ||
        (input.weather !== undefined && !['normal', 'hot', 'cold', 'rain'].includes(input.weather))) throw fail('bad_input');
    const r = event.result || {};
    const result = {};
    for (const k of ['total', 'gelCount', 'proCount']) {
      const value = r[k] == null ? 0 : Number(r[k]);
      if (!Number.isInteger(value) || value < 0 || value > 200) throw fail('bad_input');
      result[k] = value;
    }
    const data = { openid: openid, input: input, result: result, savedAt: db.serverDate() };
    if (event.formulaVersion != null) {
      if (typeof event.formulaVersion !== 'string' || !/^[a-zA-Z0-9._-]{1,64}$/.test(event.formulaVersion)) throw fail('bad_input');
      // 只保存有界的完整展示快照；不把客户端字段用于积分或其他权威业务计算。
      for (const k of ['totalCarb', 'caffeineMg', 'kcal', 'carbRate', 'caffeineCapMg', 'caffeineCapCount', 'caffeinePerKg', 'days']) {
        if (!Number.isFinite(r[k]) || r[k] < 0 || r[k] > 100000) throw fail('bad_input');
        result[k] = r[k];
      }
      if (typeof r.durationLabel !== 'string' || r.durationLabel.length > 20 || !Array.isArray(r.items) || r.items.length > 200 ||
          !Array.isArray(r.reasons) || r.reasons.length > 10 || result.total !== result.gelCount + result.proCount || result.total !== r.items.length) throw fail('bad_input');
      result.durationLabel = r.durationLabel;
      result.items = r.items.map((item) => {
        if (!item || !Number.isFinite(item.minute) || item.minute < -30 || item.minute > input.minutes ||
            !['gel', 'pro'].includes(item.product) || !Number.isFinite(item.position) || item.position < 0 || item.position > 100 ||
            typeof item.label !== 'string' || item.label.length > 80 || typeof item.productName !== 'string' || item.productName.length > 40) throw fail('bad_input');
        return { minute: item.minute, label: item.label, product: item.product, productName: item.productName, position: item.position };
      });
      result.reasons = r.reasons.map((reason) => { if (typeof reason !== 'string' || reason.length > 1000) throw fail('bad_input'); return reason; });
      if (Buffer.byteLength(JSON.stringify(result)) > 64000) throw fail('bad_input');
      data.formulaVersion = event.formulaVersion;
    }
    await db.collection('plans').doc(openid).set({ data: data });
    return { plan: planView(await findById('plans', openid)) };
  },

  /** 分享卡片、历史记录按 ID 读取；下架活动仅报名/提醒过的本人可读。 */
  async event(event, openid) {
    const id = typeof event.id === 'string' ? event.id : '';
    const e = id && await findById('events', id);
    if (!e) throw fail('not_found');
    const signed = await findById('signups', openid + '_' + id);
    const mine = signed && signed.openid === openid ? signed : null;
    if (e.status !== 'published') {
      const own = mine || await findById('reminders', openid + '_' + id);
      if (!own || own.openid !== openid) throw fail('not_found');
    }
    return {
      event: eventView(e),
      readOnly: e.status !== 'published' || e.cancelled === true || Date.now() >= signupClosesAt(e),
      // 本人报了名的：报名表填了什么、必填项齐不齐（报名之后运营可能又加了必填项）
      mine: mine ? { answers: answerMap(mine.answers), complete: answersComplete(formOf(e), mine.answers), answeredAt: ms(mine.answeredAt) } : null,
      // 这场活动正在进行的现场互动
      live: e.status === 'published' ? await liveInteractions(id) : []
    };
  },

  /**
   * 报名之后改报名表上填的内容（或者补填运营后来加的项）。活动开始以后、活动取消了就不能再改。
   * 只改本人这一次报名的记录：中途被运营取消了报名的，改不到。
   */
  async saveAnswers(event, openid) {
    const e = await findById('events', String(event.eventId || ''));
    if (!e) throw fail('not_found');
    const id = openid + '_' + e._id;
    const s = await findById('signups', id);
    if (!s || s.openid !== openid) throw fail('not_signed');
    if (e.cancelled === true || (ms(e.date) && Date.now() >= ms(e.date))) throw fail('form_closed');
    const fields = formOf(e);
    if (!fields.length) throw fail('no_form');
    const cleaned = cleanAnswers(fields, event.answers);
    if (cleaned.missing.length) throw fail('form_incomplete');
    // 运营后来删掉的项：之前填的内容留着（名单上照样列出来），只换现在报名表上有的项
    const kept = (Array.isArray(s.answers) ? s.answers : []).filter((a) => !fields.some((f) => f.id === a.id));
    const answers = cleaned.answers.concat(kept);
    const res = await db.collection('signups').where({ _id: id, token: s.token }).update({ data: { answers: answers, answeredAt: db.serverDate() } });
    if (!res.stats.updated) throw fail('not_signed');
    return { answers: answerMap(answers), complete: true };
  },

  /**
   * 现场互动的页面：互动本身、本人能不能参与（blocked：not_member、not_signed，空的是能），
   * 大转盘另外带上本人抽了几次、还能抽几次、每次的结果。关掉了的互动照样返回（open 为 false），页面上说现在没开放。
   */
  async interaction(event, openid) {
    const x = await findInteraction(String(event.id || ''));
    if (!x) throw fail('not_found');
    return {
      interaction: interactionView(x),
      blocked: await audienceBlock(x, openid),
      mine: x.kind === 'wheel' ? await myDraws(x, openid) : null
    };
  },

  /**
   * 大转盘抽一次。抽不抽得中、抽中什么都在这里定，页面只负责转到对应的格子。
   * 每个奖品有自己的机会（万分之几）；落在某个奖品上但它已经发完了，算没抽中，机会不挪给别的奖品。
   * 「这个人第几次抽」「奖品还剩几个」「这次的结果」在一个事务里写：不会多抽，奖品不会超发。
   */
  async draw(event, openid) {
    const id = String(event.id || '');
    const x = await findInteraction(id);
    if (!x) throw fail('not_found');
    if (x.kind !== 'wheel') throw fail('bad_kind');
    if (x.status !== 'on') throw fail('closed');
    const blocked = await audienceBlock(x, openid);
    if (blocked) throw fail(blocked);
    await ensureCollection('draws');
    await ensureCollection('draw_users');
    await ensureCollection('draw_codes');
    const userId = id + '_' + openid;
    const token = randomId();
    let refused = '';
    let result = null;
    const attempt = () => db.runTransaction(async (t) => {
      refused = ''; result = null;
      const cur = await transactionDoc(t, 'interactions', id);
      if (!cur || cur.deleted === true || cur.status !== 'on' || cur.kind !== 'wheel') { refused = 'closed'; return; }
      // 谁能参与在事务里按现在的设置再核对一次：运营刚收紧了范围、他的报名刚被取消，都不能再抽
      if (cur.audience === 'member' || cur.audience === 'signed') {
        if (!(await transactionDoc(t, 'members', openid))) { refused = 'not_member'; return; }
        if (cur.audience === 'signed' && !(cur.eventId && await transactionDoc(t, 'signups', openid + '_' + cur.eventId))) { refused = 'not_signed'; return; }
      }
      const user = await transactionDoc(t, 'draw_users', userId);
      const used = user ? user.count || 0 : 0;
      if (used >= (cur.tries || 1)) { refused = 'no_tries'; return; }
      const prizes = Array.isArray(cur.prizes) ? cur.prizes : [];
      const r = randomBelow(CHANCE_BASE);
      let from = 0;
      let hit = null;
      for (const p of prizes) {
        const width = Math.round((p.chance || 0) * 100);
        if (r >= from && r < from + width && (p.total || 0) - (p.won || 0) > 0) hit = p;
        from += width;
      }
      const n = used + 1;
      if (hit) {
        await t.collection('interactions').doc(id).update({ data: {
          prizes: prizes.map((p) => (p.id === hit.id ? Object.assign({}, p, { won: (p.won || 0) + 1 }) : p))
        } });
      }
      if (user) await t.collection('draw_users').doc(userId).update({ data: { count: n, updatedAt: db.serverDate() } });
      else await t.collection('draw_users').doc(userId).set({ data: { interactionId: id, openid: openid, count: n, createdAt: db.serverDate(), updatedAt: db.serverDate() } });
      // 领奖码在这个互动里不重复：每个码在 draw_codes 里占一条（_id 是「互动id_领奖码」），撞上已有的就换一个。
      // 占码和这次抽奖在同一个事务里，两个人同时抽到同一个码时只有一个能写成
      let code = '';
      if (hit) {
        for (let i = 0; i < 8 && !code; i++) {
          const c = prizeCode();
          if (!(await transactionDoc(t, 'draw_codes', id + '_' + c))) code = c;
        }
        if (!code) throw fail('server_error');
        await t.collection('draw_codes').doc(id + '_' + code).set({ data: { interactionId: id, code: code, drawId: userId + '_' + n, createdAt: db.serverDate() } });
      }
      result = { n: n, win: !!hit, prizeId: hit ? hit.id : '', prizeName: hit ? hit.name : '', code: code };
      await t.collection('draws').doc(userId + '_' + n).set({ data: {
        interactionId: id, openid: openid, n: n, win: result.win, prizeId: result.prizeId, prizeName: result.prizeName, code: result.code,
        redeemed: false, token: token, createdAt: db.serverDate()
      } });
    });
    for (let left = SIGNUP_TRIES; ; left--) {
      try {
        await attempt();
        break;
      } catch (err) {
        // 事务其实提交了、只是结果没传回来：按这次写下的记录返回
        const saved = (await db.collection('draws').where({ interactionId: id, openid: openid, token: token }).limit(1).get()).data[0];
        if (saved) { result = { n: saved.n, win: saved.win === true, prizeId: saved.prizeId || '', prizeName: saved.prizeName || '', code: saved.code || '' }; refused = ''; break; }
        if (left <= 1) throw err;
      }
    }
    if (refused) throw fail(refused);
    return { result: { n: result.n, win: result.win, prizeId: result.prizeId, prizeName: result.prizeName, code: result.code }, mine: await myDraws(x, openid) };
  },

  /** 本人的活动历史独立于公开列表；分批读取并批量关联活动，避免每条历史各查一次。 */
  async myEvents(event, openid) {
    const cursor = event.cursor ? String(event.cursor) : 's:0';
    if (!/^[sr]:\d{1,8}$/.test(cursor)) throw fail('bad_input');
    let [phase, position] = cursor.split(':');
    let offset = Number(position);
    let nextCursor = null;
    const source = [];
    while (source.length < 100) {
      const remaining = 100 - source.length;
      const collection = phase === 's' ? 'signups' : 'reminders';
      const res = await db.collection(collection).where({ openid: openid }).orderBy('createdAt', 'desc').skip(offset).limit(remaining + 1).get();
      source.push(...res.data.slice(0, remaining).map((r) => ({ row: r, state: phase === 's' ? 'signed' : 'reminded' })));
      if (res.data.length > remaining) { nextCursor = phase + ':' + (offset + remaining); break; }
      if (phase === 'r') break;
      phase = 'r'; offset = 0;
      nextCursor = 'r:0';
    }
    if (phase === 'r' && source.length < 100) nextCursor = null;
    const eventIds = [...new Set(source.map((r) => r.row.eventId))];
    const events = eventIds.length ? (await db.collection('events').where({ _id: _.in(eventIds) }).limit(100).get()).data : [];
    const byId = Object.fromEntries(events.map((e) => [e._id, e]));
    const reminded = source.filter((r) => r.state === 'reminded').map((r) => openid + '_' + r.row.eventId);
    const signed = reminded.length ? (await db.collection('signups').where({ _id: _.in(reminded) }).limit(100).get()).data : [];
    const signedIds = new Set(signed.map((s) => s.eventId));
    const records = source.filter((r) => r.state === 'signed' || !signedIds.has(r.row.eventId)).map(({ row, state }) => ({
      id: row.eventId, event: byId[row.eventId] ? eventView(byId[row.eventId]) : null, state: state, createdAt: ms(row.createdAt)
    }));
    return { records: records, nextCursor: nextCursor };
  },

  /** 即将开始的活动：已发布、活动日期还没过（留一天余量） */
  async events() {
    const res = await db.collection('events')
      .where({ status: 'published', date: _.gte(new Date(Date.now() - 24 * 3600 * 1000)) })
      .orderBy('date', 'asc').limit(50).get();
    // live：正在进行的现场互动。活动页顶上显示入口，没有就不显示
    return { events: res.data.map(eventView), live: await liveInteractions('') };
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
    const fields = formOf(e);
    return {
      event: adminEventView(e),
      total: total,
      // 报名表现在的样子。名单上每个人的 answers 是他交上来时的 [{ id, label, value }]，
      // 运营后来删掉的项也还在里面（label 是当时的标题），complete 是现在的必填项填齐了没有
      form: fields,
      signups: all.map((s) => {
        const m = members[s.openid] || {};
        return {
          memberNo: m.memberNo || '', nickname: m.nickname || '', phone: m.phone || '', cost: Number.isInteger(s.cost) ? s.cost : 0, at: ms(s.createdAt),
          answers: Array.isArray(s.answers) ? s.answers : [], complete: answersComplete(fields, s.answers), answeredAt: ms(s.answeredAt)
        };
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
    await db.runTransaction(async (t) => {
      const current = await transactionDoc(t, 'events', id);
      if (!current) throw fail('not_found');
      if (!current.cancelled || current.status !== 'draft') await t.collection('events').doc(id).update({ data: {
        status: 'draft', cancelled: true, version: (current.version || 0) + 1, cancelledAt: db.serverDate(), updatedAt: db.serverDate()
      } });
    });
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

  /* ---------- 现场互动（后台） ---------- */

  /** 全部互动（删掉的不列），新改的在前；每个带上抽了多少次、中了多少、领了多少 */
  async adminInteractions(event, openid) {
    await requireAdmin(openid);
    await ensureCollection('interactions');
    await ensureCollection('draws');
    const res = await db.collection('interactions').where({ deleted: _.exists(false) }).orderBy('updatedAt', 'desc').limit(100).get();
    const list = await Promise.all(res.data.map(async (x) => {
      const count = (cond) => db.collection('draws').where(Object.assign({ interactionId: x._id }, cond)).count().then((r) => r.total);
      const [draws, wins, redeemed] = await Promise.all([count({}), count({ win: true }), count({ win: true, redeemed: true })]);
      return adminInteractionView(x, { draws: draws, wins: wins, redeemed: redeemed });
    }));
    return { interactions: list };
  },

  /**
   * 新建或修改一个互动。带 id 是修改：要带上读到时的 version，被别人改过了返回 conflict。
   * 大转盘的奖品按 id 对上原来的，已经抽中的个数（won）留着；数量不能改得比已经抽中的少。
   * 新建的是关着的，要在列表上点「打开」才出现入口。
   */
  async adminSaveInteraction(event, openid) {
    await requireAdmin(openid);
    const data = interactionData(event.interaction);
    if (data.eventId && !(await findById('events', data.eventId))) throw fail('missing_event');
    await ensureCollection('interactions');
    let id = event.id ? String(event.id) : '';
    if (id) {
      await db.runTransaction(async (t) => {
        const cur = await transactionDoc(t, 'interactions', id);
        if (!cur || cur.deleted === true) throw fail('not_found');
        if (event.version != null && event.version !== (cur.version || 0)) throw fail('conflict');
        const won = Object.create(null);
        (cur.prizes || []).forEach((p) => { won[p.id] = p.won || 0; });
        // 已经有人抽中的奖品不能删（也不能把有人中过奖的大转盘改成别的类型）：页面上读到的抽中数可能是旧的，
        // 在事务里按现在的数核对，删了的话中奖记录和奖品就对不上了
        const kept = Object.create(null);
        data.prizes.forEach((p) => { kept[p.id] = true; });
        if ((cur.prizes || []).some((p) => (p.won || 0) > 0 && !kept[p.id])) throw fail('prize_has_winners');
        data.prizes = data.prizes.map((p) => {
          const n = won[p.id] || 0;
          if (p.total < n) throw fail('prize_below_won');
          return Object.assign(p, { won: n });
        });
        await t.collection('interactions').doc(id).update({ data: Object.assign({}, data, { version: (cur.version || 0) + 1, updatedAt: db.serverDate(), updatedBy: openid }) });
      });
    } else {
      data.prizes = data.prizes.map((p) => Object.assign(p, { won: 0 }));
      for (let i = 0; ; i++) {
        id = shortId();
        try {
          await db.collection('interactions').add({ data: Object.assign({ _id: id }, data, { status: 'off', version: 1, createdAt: db.serverDate(), updatedAt: db.serverDate(), updatedBy: openid }) });
          break;
        } catch (e) {
          // 8 位撞上已有的（几乎不会）：换一个再试
          if (i >= 3 || !(await findById('interactions', id))) throw e;
        }
      }
    }
    return { interaction: adminInteractionView(await findById('interactions', id)) };
  },

  /** 打开（on）或关掉（off）一个互动。打开后小程序里出现入口，关掉后入口消失，扫码进来的看到「现在没有开放」 */
  async adminSetInteractionStatus(event, openid) {
    await requireAdmin(openid);
    const id = String(event.id || '');
    const status = event.status === 'on' ? 'on' : 'off';
    await ensureCollection('interactions');
    await db.runTransaction(async (t) => {
      const cur = await transactionDoc(t, 'interactions', id);
      if (!cur || cur.deleted === true) throw fail('not_found');
      if (event.version != null && event.version !== (cur.version || 0)) throw fail('conflict');
      await t.collection('interactions').doc(id).update({ data: { status: status, version: (cur.version || 0) + 1, updatedAt: db.serverDate(), updatedBy: openid } });
    });
    return { interaction: adminInteractionView(await findById('interactions', id)) };
  },

  /** 删掉一个互动：先关掉，记录不抹（抽奖和领奖的记录还在），后台列表里不再显示 */
  async adminDeleteInteraction(event, openid) {
    await requireAdmin(openid);
    const id = String(event.id || '');
    await ensureCollection('interactions');
    const res = await db.collection('interactions').where({ _id: id, deleted: _.exists(false) })
      .update({ data: { deleted: true, status: 'off', deletedAt: db.serverDate(), updatedAt: db.serverDate(), updatedBy: openid } });
    if (!res.stats.updated) throw fail('not_found');
    return {};
  },

  /**
   * 一个大转盘的中奖名单：谁中了什么、领奖码、领了没有，先中的在前。另带一共抽了多少次。
   * 会员带上昵称、会员编号和手机号（隐私政策里写了手机号会用于就奖品事项联系）；不是会员的人只有领奖码。
   */
  async adminDraws(event, openid) {
    await requireAdmin(openid);
    const x = await findInteraction(String(event.id || ''));
    if (!x) throw fail('not_found');
    await ensureCollection('draws');
    // code：按领奖码直接查（中奖的人超过名单上限时，后面的人也能找到、核销）
    const code = typeof event.code === 'string' && /^\d{6}$/.test(event.code) ? event.code : '';
    const cond = { interactionId: x._id, win: true };
    if (code) cond.code = code;
    const all = [];
    for (let page = 0; page < DRAWS_PAGES; page++) {
      const res = await db.collection('draws').where(cond).orderBy('createdAt', 'asc').skip(page * 100).limit(100).get();
      all.push(...res.data);
      if (res.data.length < 100) break;
    }
    all.sort((a, b) => (ms(a.createdAt) || 0) - (ms(b.createdAt) || 0));
    const members = {};
    const ids = [...new Set(all.map((d) => d.openid))];
    for (let i = 0; i < ids.length; i += 100) {
      const res = await db.collection('members').where({ _id: _.in(ids.slice(i, i + 100)) }).limit(100).get();
      res.data.forEach((m) => { members[m._id] = m; });
    }
    const count = async (c) => (await db.collection('draws').where(Object.assign({ interactionId: x._id }, c)).count()).total;
    const total = await count({});
    const winsTotal = await count({ win: true });
    const redeemed = await count({ win: true, redeemed: true });
    return {
      interaction: adminInteractionView(x, { draws: total, wins: winsTotal, redeemed: redeemed }),
      draws: total,
      // 一共多少人中奖；名单最多给 DRAWS_PAGES × 100 人，超出时 partial 为 true，页面上说明并让人按完整的领奖码查
      winsTotal: winsTotal,
      partial: !code && winsTotal > all.length,
      code: code,
      wins: all.map((d) => {
        const m = members[d.openid] || {};
        return { id: d._id, prizeName: d.prizeName || '', code: d.code || '', redeemed: d.redeemed === true, redeemedAt: ms(d.redeemedAt), at: ms(d.createdAt),
          memberNo: m.memberNo || '', nickname: m.nickname || '', phone: m.phone || '' };
      })
    };
  },

  /** 核销领奖码：redeemed 为 true 是领了，false 是点错了撤回。已经是这个状态的返回 already */
  async adminRedeem(event, openid) {
    await requireAdmin(openid);
    const id = String(event.id || '');
    const redeemed = event.redeemed !== false;
    await ensureCollection('draws');
    const d = await findById('draws', id);
    if (!d || d.win !== true) throw fail('not_found');
    const res = await db.collection('draws').where({ _id: id, win: true, redeemed: !redeemed })
      .update({ data: redeemed ? { redeemed: true, redeemedAt: db.serverDate(), redeemedBy: openid } : { redeemed: false, redeemedAt: _.remove(), redeemedBy: _.remove() } });
    const now = await findById('draws', id);
    return { id: id, redeemed: now.redeemed === true, redeemedAt: ms(now.redeemedAt), already: !res.stats.updated };
  },

  /**
   * 互动的小程序码：扫了直接进这个互动的页面。图片存进云存储 interact/ 目录，返回 fileID 和一个临时地址。
   * envVersion 是码打开哪个版本（release 正式版、trial 体验版、develop 开发版），后台页面按自己所在的版本传。
   * 正式版的码要等带有互动页面的版本发布之后才能生成（微信会检查页面在不在正式版里）。
   */
  async adminInteractionCode(event, openid) {
    await requireAdmin(openid);
    const x = await findInteraction(String(event.id || ''));
    if (!x) throw fail('not_found');
    const envVersion = ['release', 'trial', 'develop'].indexOf(event.envVersion) >= 0 ? event.envVersion : 'release';
    let res;
    try {
      res = await cloud.openapi.wxacode.getUnlimited({
        scene: x._id, page: 'pages/interact/index', checkPath: envVersion === 'release', envVersion: envVersion, width: 430
      });
    } catch (e) {
      console.error('wxacode', e && (e.errCode || e.errMsg || e.message));
      throw fail('code_failed');
    }
    const buf = res && res.buffer;
    if (!buf || !buf.length) throw fail('code_failed');
    const up = await cloud.uploadFile({ cloudPath: 'interact/' + x._id + '-' + envVersion + '.png', fileContent: buf });
    const urls = await cloud.getTempFileURL({ fileList: [up.fileID] });
    return { fileID: up.fileID, url: (urls.fileList[0] && urls.fileList[0].tempFileURL) || '' };
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
      // 取消过的活动在表单里重新上架：就不再是「已取消」了
      if (data.status === 'published') data.cancelled = false;
      await db.runTransaction(async (t) => {
        const current = await transactionDoc(t, 'events', id);
        if (!current) throw fail('not_found');
        checkEventVersion(event, current);
        await t.collection('events').doc(id).update({ data: Object.assign({}, data, { version: (current.version || 0) + 1, updatedAt: db.serverDate() }) });
      });
      // 有名额限制时，已报名人数不能比报名记录少（以前不限名额时报的名可能没记数）
      if (data.quota) await raiseSignupCount(id);
    } else {
      const res = await db.collection('events').add({ data: Object.assign(data, { version: 1, signupCount: 0, createdAt: db.serverDate(), updatedAt: db.serverDate() }) });
      id = res._id;
    }
    return { event: adminEventView(await findById('events', id)) };
  },

  /** 上架、下架。下架后小程序里不再显示，报名和提醒的记录保留 */
  async adminSetEventStatus(event, openid) {
    await requireAdmin(openid);
    const id = String(event.id || '');
    const status = event.status === 'published' ? 'published' : 'draft';
    const data = { status: status, updatedAt: db.serverDate() };
    // 取消过的活动重新上架：就不再是「已取消」了
    if (status === 'published') data.cancelled = false;
    await db.runTransaction(async (t) => {
      const current = await transactionDoc(t, 'events', id);
      if (!current) throw fail('not_found');
      checkEventVersion(event, current);
      await t.collection('events').doc(id).update({ data: Object.assign({}, data, { version: (current.version || 0) + 1 }) });
    });
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

  /**
   * 会员看板上的数字：总数、今天和近 7 天、近 30 天新加入的人数、近 30 天每天加入多少、
   * 大家手里一共有多少积分、报名人次、订阅着新活动通知的人数。
   * 天按北京时间分。总数和新加入的人数是直接数出来的。积分合计、填了昵称的人数、每天的柱状图是把会员一页页读出来算的，
   * 最多读 STATS_PAGES 页，超出时 partial 为 true（这三项只算了最近加入的那些人）。
   */
  async adminMemberStats(event, openid) {
    await requireAdmin(openid);
    const now = Date.now();
    const dayStart = (t) => Math.floor((t + TZ_OFFSET) / DAY) * DAY - TZ_OFFSET;
    const today = dayStart(now);
    const from = today - 29 * DAY;
    const daily = [];
    for (let i = 0; i < 30; i++) daily.push({ day: from + i * DAY, count: 0 });
    let points = 0; let read = 0; let named = 0; let partial = false;
    for (let page = 0; ; page++) {
      if (page >= STATS_PAGES) { partial = true; break; }
      const res = await db.collection('members').orderBy('createdAt', 'desc').skip(page * STATS_PAGE_SIZE).limit(STATS_PAGE_SIZE).get();
      res.data.forEach((m) => {
        read += 1;
        points += Number(m.points) || 0;
        if (m.nickname) named += 1;
        const at = ms(m.createdAt);
        if (at === null || at < from) return;
        const i = Math.floor((dayStart(at) - from) / DAY);
        if (daily[i]) daily[i].count += 1;
      });
      if (res.data.length < STATS_PAGE_SIZE) break;
    }
    const total = (await db.collection('members').count()).total;
    // 新加入的人数直接数，不靠上面那一遍（它最多读两万人）
    const since = async (t) => (await db.collection('members').where({ createdAt: _.gte(new Date(t)) }).count()).total;
    const joined = { today: await since(today), week: await since(today - 6 * DAY), month: await since(from) };
    const signups = (await db.collection('signups').count()).total;
    const plans = (await db.collection('plans').count()).total;
    const news = await newsWaiting();
    return {
      total: total, today: joined.today, week: joined.week, month: joined.month,
      daily: daily, points: points, named: named, signups: signups, plans: plans, newsWaiting: news,
      partial: partial && total > read
    };
  },

  /**
   * 会员名单，新加入的在前，一次 MEMBERS_PAGE 个。手机号是打码的。
   * 每个人带上报名过几场。返回 more 表示后面还有。
   */
  async adminMembers(event, openid) {
    await requireAdmin(openid);
    const skip = Math.max(0, parseInt(event.skip, 10) || 0);
    const res = await db.collection('members').orderBy('createdAt', 'desc').skip(skip).limit(MEMBERS_PAGE + 1).get();
    const list = res.data.slice(0, MEMBERS_PAGE);
    const counts = {};
    if (list.length) {
      // 这一页的人各报了几场：一人数一次（一起数的话，报得多的人会把别人的挤掉）
      const totals = await Promise.all(list.map((m) => db.collection('signups').where({ openid: m._id }).count()));
      list.forEach((m, i) => { counts[m._id] = totals[i].total; });
    }
    return {
      members: list.map((m) => Object.assign(adminMemberView(m), { joinedAt: ms(m.createdAt), signups: counts[m._id] || 0, admin: m.admin === true })),
      more: res.data.length > MEMBERS_PAGE,
      next: skip + list.length
    };
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
    const op = operationId(event.operationId);
    const id = 'adjust_' + sha(openid + ':' + op);
    const signature = sha(JSON.stringify([target._id, delta, reason]));
    await ensureCollection('point_logs');
    try {
      await db.runTransaction(async (t) => {
        const previous = await transactionDoc(t, 'point_logs', id);
        if (previous) { if (previous.signature !== signature) throw fail('operation_conflict'); return; }
        const current = await transactionDoc(t, 'members', target._id);
        if (!current) throw fail('not_found');
        if ((current.points || 0) + delta < 0) throw fail('insufficient');
        await t.collection('members').doc(target._id).update({ data: { points: _.inc(delta) } });
        await t.collection('point_logs').doc(id).set({ data: {
          openid: target._id, delta: delta, reason: reason, by: openid, signature: signature, operationId: op, createdAt: db.serverDate()
        } });
      });
    } catch (e) {
      const confirmed = await findById('point_logs', id);
      if (!confirmed || confirmed.signature !== signature) throw e;
    }
    return { member: adminMemberView(await findById('members', target._id)) };
  },

  /** 「提醒我」：用户授权了一次性订阅消息之后登记，报名开放时由 remind 云函数发送 */
  async remind(event, openid) {
    const e = await findById('events', event.eventId);
    if (!e || e.status !== 'published') throw fail('not_found');
    if (!event.templateId) throw fail('missing_template');
    const batchId = operationId(event.batchId);
    const id = openid + '_' + e._id;
    await db.runTransaction(async (t) => {
      const current = await transactionDoc(t, 'reminders', id);
      // 同一次授权重试不能重新消费；旧版无批次请求也不能重置尚未发送或正在发送的记录。
      const batches = current && Array.isArray(current.batches) ? current.batches.slice() : [];
      if (current && current.batchId && !batches.includes(current.batchId)) batches.push(current.batchId);
      if (current && (batches.includes(batchId) || current.sent === false || current.status === 'sending')) return;
      if (batches.length >= 100) throw fail('bad_input');
      batches.push(batchId);
      await t.collection('reminders').doc(id).set({ data: {
        openid: openid, eventId: e._id, templateId: String(event.templateId), batchId: batchId, batches: batches,
        sent: false, status: 'waiting', createdAt: db.serverDate()
      } });
    });
    const saved = await findById('reminders', id);
    return { eventId: e._id, batchId: saved && saved.batchId || batchId, reminded: !!saved && saved.sent === false };
  },

  /**
   * 「有新活动通知我」：用户授权了一次性订阅消息之后登记。运营在后台点「通知」时，由 remind 云函数给每人发一条。
   * 每人只有一条记录（_id 是 openid）：一次授权只有一条额度，收到一条之后要再点一次才有下一条。
   * eventId 是这条订阅划给了哪场活动，job 是划给了哪一次登记，空的是还没划（见 adminNotifyEvent）。
   */
  async subscribeNews(event, openid) {
    if (!event.templateId) throw fail('missing_template');
    const data = { openid: openid, templateId: String(event.templateId), sent: false, status: 'waiting', eventId: '', job: '', subscribedAt: db.serverDate() };
    if (event.batchId) {
      const batchId = operationId(event.batchId);
      await ensureCollection('news_subs');
      await ensureCollection('subscription_batches');
      const marker = sha('news:' + openid + ':' + batchId);
      await db.runTransaction(async (t) => {
        if (await transactionDoc(t, 'subscription_batches', marker)) return;
        const current = await transactionDoc(t, 'news_subs', openid);
        if (!current || current.sent === true) await t.collection('news_subs').doc(openid).set({ data: Object.assign({}, data, { batchId: batchId }) });
        await t.collection('subscription_batches').doc(marker).set({ data: { openid: openid, batchId: batchId, createdAt: db.serverDate() } });
      });
      const current = await findById('news_subs', openid);
      return { news: !!current && current.sent === false };
    }
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
    if (now >= signupClosesAt(e)) throw fail('closed');

    const id = openid + '_' + e._id;
    if (await findById('signups', id)) return { eventId: e._id, already: true };

    // 这场要用积分的：先看够不够，不够就不用往下走了（事务里还会再看一次）
    // expected：用户在页面上确认过的积分数（老版本的小程序不带这一项，不比）
    const expected = Number.isInteger(event.cost) && event.cost >= 0 ? event.cost : null;
    // 要用的积分和他确认时看到的不一样了：先说这个，让页面拿新的数重新确认，而不是照旧的数说「积分不够」
    if (expected !== null && expected !== costOf(e)) throw fail('cost_changed');
    if (costOf(e) && !((member.points || 0) >= costOf(e))) throw fail('insufficient_points');
    // 报名表：有报名表的活动，新版小程序把填好的内容和报名一起交上来，必填项没填齐报不上。
    // 不带 answers 的是更新前的旧版小程序：照常报名，之后在新版的活动详情里补填
    const legacy = event.answers === undefined;
    if (!legacy && formOf(e).length) {
      const checked = cleanAnswers(formOf(e), event.answers);
      if (checked.missing.length) throw fail('form_incomplete');
    }
    await ensureCollection('point_logs');

    // 报名记录带上本次请求的标记，事务出错时靠它分清是哪种情况；cost 是这次用了多少积分，取消时照这个数退
    const token = Date.now().toString(36) + Math.random().toString(36).slice(2);
    // 事务里发现报不了时把原因记在这里（事务不写任何东西，正常结束）
    let refused = '';
    const attempt = () => db.runTransaction(async (t) => {
      refused = '';
      // 活动和会员在事务里重新读：这时活动可能刚被下架或取消、刚改了要用的积分，名额可能刚被别人占掉，积分可能刚用在别处
      const existing = await transactionDoc(t, 'signups', id);
      if (existing) { refused = 'already'; return; }
      const ev = await transactionDoc(t, 'events', e._id);
      if (!ev || ev.status !== 'published' || ev.cancelled === true) { refused = 'not_found'; return; }
      const currentTime = Date.now();
      const currentOpens = signupOpensAt(ev);
      if (currentOpens && currentTime < currentOpens) { refused = 'not_open'; return; }
      if (currentTime >= signupClosesAt(ev)) { refused = 'closed'; return; }
      const cost = costOf(ev);
      // 要用的积分和他确认时看到的不一样了：不扣，让页面拿新的数重新确认
      if (expected !== null && expected !== cost) { refused = 'cost_changed'; return; }
      const count = typeof ev.signupCount === 'number' ? ev.signupCount : 0;
      if (typeof ev.quota === 'number' && count >= ev.quota) { refused = 'full'; return; }
      // 报名表按事务里读到的活动再核对一次：用户填表的这段时间里运营可能改了报名表
      let answers = [];
      if (!legacy && formOf(ev).length) {
        let checked;
        try { checked = cleanAnswers(formOf(ev), event.answers); } catch (err) { refused = 'form_changed'; return; }
        if (checked.missing.length) { refused = 'form_changed'; return; }
        answers = checked.answers;
      }
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
      // answers：报名表上填的 [{ id, label, value }]，没有报名表是空数组
      const doc = { _id: id, openid: openid, eventId: e._id, token: token, cost: cost, templateId: event.templateId ? String(event.templateId) : '', answers: answers, createdAt: db.serverDate() };
      if (answers.length) doc.answeredAt = db.serverDate();
      await t.collection('signups').add({ data: doc });
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
  const handler = typeof action === 'string' && Object.prototype.hasOwnProperty.call(actions, action) ? actions[action] : null;
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
