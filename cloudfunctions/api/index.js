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
 */
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

/** 返回给小程序端的会员信息：手机号只给打码后的 */
function memberView(m) {
  if (!m) return null;
  const phone = String(m.phone || '');
  return {
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
    const member = await findById('members', openid);
    const plan = member ? await findById('plans', openid) : null;
    const reminders = await db.collection('reminders').where({ openid: openid, sent: false }).limit(100).get();
    const signups = await db.collection('signups').where({ openid: openid }).limit(100).get();
    return {
      member: memberView(member),
      plan: plan ? { input: plan.input, savedAt: ms(plan.savedAt) } : null,
      reminders: reminders.data.map((r) => r.eventId),
      signups: signups.data.map((s) => s.eventId)
    };
  },

  /** 注册：用手机号快速验证组件给的 code 换手机号，建会员。已注册的直接返回。 */
  async register(event, openid) {
    const existing = await findById('members', openid);
    if (existing) return { member: memberView(existing) };
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
    // 会员编号和积分的规则还没定（docs/04-open-items.md）：编号先留空，积分从 0 开始
    const doc = { openid: openid, phone: info.purePhoneNumber, countryCode: info.countryCode || '', memberNo: null, points: 0, createdAt: db.serverDate() };
    await db.collection('members').doc(openid).set({ data: doc });
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

    if (typeof e.quota === 'number') {
      if (typeof e.signupCount !== 'number') await db.collection('events').where({ _id: e._id, signupCount: _.exists(false) }).update({ data: { signupCount: 0 } });
      // 条件更新：只有还没满时才加一，避免并发超额
      const res = await db.collection('events').where({ _id: e._id, signupCount: _.lt(e.quota) }).update({ data: { signupCount: _.inc(1) } });
      if (!res.stats.updated) throw fail('full');
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
      if (typeof e.quota === 'number') await db.collection('events').where({ _id: e._id }).update({ data: { signupCount: _.inc(-1) } });
      if (existing) return { eventId: e._id, already: true };
      throw err;
    }
    return { eventId: e._id, already: false };
  }
};

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const handler = actions[event && event.action];
  if (!handler) return { ok: false, code: 'unknown_action' };
  if (!OPENID) return { ok: false, code: 'no_openid' };
  try {
    return { ok: true, data: await handler(event, OPENID) };
  } catch (e) {
    if (e && e.code && typeof e.code === 'string') return { ok: false, code: e.code };
    console.error(event.action, e);
    return { ok: false, code: 'server_error' };
  }
};
