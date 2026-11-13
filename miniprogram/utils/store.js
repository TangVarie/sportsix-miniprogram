/**
 * 会员、报名、提醒、新活动通知、补给计划的读写。页面只通过这个文件拿这些数据。
 *
 * 读是同步的，运行时以内存为准；本机缓存只用于下次启动。写返回 Promise。
 * - 配了云环境（config.cloudEnv）：写先发到云函数 api，成功后更新缓存；
 *   进入小程序时 sync() 用云端的数据覆盖缓存，完成后通知订阅了 onChange 的页面重读。
 * - 没配云环境：只写本机缓存，用来在没有云环境时看页面状态。这时注册不取手机号，提醒不会真的发出。
 */
const cloud = require('./cloud.js');

const KEY = { member: 'sx_member', reminders: 'sx_reminders', signups: 'sx_signups', plan: 'sx_plan', pending: 'sx_pending_plan', noticeSeen: 'sx_notice_seen', news: 'sx_news' };

// 运营在后台设的公告，随启动同步拿到。只放在内存里：每次打开小程序都重新取
let notice = null;
// 还没看过的站内消息（报名被取消、活动取消），随启动同步拿到，app.js 逐条弹出来
let inbox = [];
const memory = Object.create(null);
const revisions = Object.create(null);
let requestNo = 0;
const memberRevisions = Object.create(null);
let memberRevision = 0;

function read(key, fallback) {
  if (Object.prototype.hasOwnProperty.call(memory, key)) return memory[key] == null ? fallback : memory[key];
  try {
    const v = wx.getStorageSync(key);
    memory[key] = v === '' || v == null ? fallback : v;
  } catch (e) { memory[key] = fallback; }
  return memory[key];
}
function write(key, value, revision) {
  if (revision != null && revision < (revisions[key] || 0)) return false;
  if (revision != null) revisions[key] = revision;
  memory[key] = value;
  try {
    if (value == null) wx.removeStorageSync(key); else wx.setStorageSync(key, value);
  } catch (e) { /* 持久化失败不影响本次已经成功的操作 */ }
  return true;
}
/** 资料更新只合并它负责的字段，避免积分响应里的旧昵称、昵称响应里的旧积分互相覆盖。 */
function writeMember(member, revision, fields) {
  if (!member) {
    if (revision < memberRevision) return false;
    memberRevision = revision;
    return write(KEY.member, null);
  }
  const current = read(KEY.member, null);
  if (!current && revision < memberRevision) return false;
  const next = Object.assign({}, current || {});
  const keys = fields && current ? fields : Object.keys(Object.assign({}, current || {}, member));
  let changed = false;
  keys.forEach((key) => {
    if (revision < (memberRevisions[key] || 0)) return;
    memberRevisions[key] = revision;
    if (Object.prototype.hasOwnProperty.call(member, key)) next[key] = member[key];
    else delete next[key];
    changed = true;
  });
  memberRevision = Math.max(memberRevision, revision);
  return changed ? write(KEY.member, next) : false;
}

const listeners = [];
/** 缓存被云端数据刷新后回调，返回取消订阅的函数 */
function onChange(fn) {
  listeners.push(fn);
  return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
}
function emit() {
  listeners.slice().forEach((fn) => { try { fn(); } catch (e) { /* 某个页面出错不影响其他页面 */ } });
}

// 每次写操作开始和结束时各加一。同步期间这个数变了，说明拿到的云端快照可能比本机旧，不能用它覆盖缓存。
let activity = 0;
let activeWrites = 0;
/** 分配请求版本；较早发出的响应不能覆盖较新的会员资料或计划。 */
function tracked(action, data, apply) {
  const revision = ++requestNo;
  activity += 1;
  activeWrites += 1;
  const done = () => { activity += 1; activeWrites -= 1; };
  return cloud.call(action, data).then((d) => {
    let value;
    try { value = apply(d, revision); } catch (e) { done(); throw e; }
    done();
    emit();
    return value;
  }, (e) => { done(); throw e; });
}

/** 进入小程序时调用：用云端数据覆盖本机缓存。没配云环境时什么也不做。 */
function sync(retries) {
  if (!cloud.enabled()) return Promise.resolve(false);
  const before = activity;
  const revision = ++requestNo;
  const left = retries == null ? 3 : retries;
  return cloud.call('bootstrap').then((d) => {
    // 同步期间用户注册、保存了计划或报了名：这份快照可能还不包含那次写入，丢掉重取
    if (activeWrites || activity !== before) return left > 0 ? sync(left - 1) : false;
    // 两次同步同时在路上时，忽略后返回的旧快照（也不能倒退站内消息和公告）。
    if (revision < (revisions.bootstrap || 0)) return false;
    revisions.bootstrap = revision;
    writeMember(d.member, revision);
    write(KEY.plan, d.plan, revision);
    write(KEY.reminders, d.reminders || [], revision);
    write(KEY.signups, d.signups || [], revision);
    write(KEY.news, d.news ? true : null, revision);
    notice = d.notice || null;
    inbox = d.inbox || [];
    emit();
    return true;
  }).catch(() => false); // 取不到时先用上次的缓存
}

/**
 * 还没给这位用户弹过的公告：{ version, title, content }，没有就是 null。
 * 每保存一次公告是一个新版本，同一个版本在同一台手机上只弹一次。
 */
function unseenNotice() {
  if (!notice) return null;
  return read(KEY.noticeSeen, 0) === notice.version ? null : notice;
}
function markNoticeSeen(version) {
  write(KEY.noticeSeen, version);
}

/** 取走还没看过的站内消息：[{ id, title, content }]。取走以后这边就清空，同一条不会弹两次 */
function takeInbox() {
  const list = inbox;
  inbox = [];
  return list;
}
/** 这几条看过了，告诉云端下次不用再给。没告诉成也没关系，最多下次再弹一遍 */
function readInbox(ids) {
  if (!cloud.enabled() || !ids || !ids.length) return Promise.resolve();
  return cloud.call('readInbox', { ids: ids }).catch(() => {});
}

/** 会员：未注册返回 null。云开发下是 { nickname, phoneMasked, memberNo, points, createdAt } */
function getMember() { return read(KEY.member, null); }
function isMember() { return !!getMember(); }

/**
 * 注册。云开发下 code 是手机号快速验证组件回调里的 e.detail.code，由云函数换取手机号并建会员；
 * 没配云环境时不需要 code，只在本机记一个「已注册」。
 * resolve { member, isNew }：isNew 为 false 表示本来就是会员（比如换了手机），不是这次新加入的。
 */
function register(code) {
  if (!cloud.enabled()) {
    const member = { createdAt: Date.now(), points: 500 };
    write(KEY.member, member);
    emit();
    return Promise.resolve({ member: member, isNew: true });
  }
  return tracked('register', { code: code }, (d, revision) => {
    writeMember(d.member, revision);
    return { member: d.member, isNew: d.isNew !== false };
  });
}

/**
 * 积分页的数据：{ points, logs: [{ id, delta, reason, at }] }。顺带把本机缓存的会员信息更新成云端最新的。
 * 没配云环境时只有本机记的那 500。
 */
function fetchPoints() {
  if (!cloud.enabled()) {
    const m = getMember() || {};
    return Promise.resolve({ points: typeof m.points === 'number' ? m.points : 0, logs: [{ id: 'welcome', delta: 500, reason: 'welcome', at: m.createdAt }] });
  }
  return tracked('points', undefined, (d, revision) => {
    writeMember(d.member, revision, ['points']);
    return { points: typeof d.member.points === 'number' ? d.member.points : 0, logs: d.logs || [] };
  });
}

/** 改昵称。没配云环境时只改本机的。 */
function setNickname(nickname) {
  if (!cloud.enabled()) {
    const member = Object.assign({}, getMember(), { nickname: nickname });
    write(KEY.member, member);
    emit();
    return Promise.resolve(member);
  }
  return tracked('setNickname', { nickname: nickname }, (d, revision) => {
    writeMember(d.member, revision, ['nickname']);
    return d.member;
  });
}

function addTo(key, id) {
  const list = read(key, []).slice();
  if (list.indexOf(id) < 0) { list.push(id); write(key, list); }
}

/** 已设提醒的活动 id 列表 */
function getReminders() { return read(KEY.reminders, []); }
function hasReminder(eventId) { return getReminders().indexOf(eventId) >= 0; }
/** 登记提醒。templateId 是用户刚授权的订阅消息模板；没配云环境或没有模板时只记在本机。 */
function addReminder(eventId, templateId, batchId) {
  if (!cloud.enabled() || !templateId) { addTo(KEY.reminders, eventId); emit(); return Promise.resolve(); }
  return tracked('remind', { eventId: eventId, templateId: templateId, batchId: batchId || '' }, (d) => {
    if (d && d.reminded === false) write(KEY.reminders, getReminders().filter((id) => id !== eventId));
    else addTo(KEY.reminders, eventId);
    return d;
  });
}

/**
 * 新活动通知：订阅了、还没收到通知时是 true。收到一条之后云端会把它改回 false，要再点一次才有下一条。
 */
function hasNews() { return read(KEY.news, false) === true; }
/** 登记订阅。templateId 是用户刚授权的订阅消息模板；没配云环境或没有模板时只记在本机。 */
function subscribeNews(templateId, batchId) {
  if (!cloud.enabled() || !templateId) { write(KEY.news, true); emit(); return Promise.resolve(); }
  return tracked('subscribeNews', { templateId: templateId, batchId: batchId || '' }, (d, revision) => {
    write(KEY.news, !d || d.news !== false, revision);
    return d;
  });
}

/** 已报名的活动 id 列表 */
function getSignups() { return read(KEY.signups, []); }
function hasSignup(eventId) { return getSignups().indexOf(eventId) >= 0; }
/**
 * 报名。失败时 reject 的 Error 带 code：not_member、not_open、closed、full、insufficient_points、not_found、network。
 * 没配云环境时没有地方登记报名，直接按 'no_backend' 失败。
 */
function signup(eventId, templateId, cost) {
  if (!cloud.enabled()) return Promise.reject(Object.assign(new Error('no_backend'), { code: 'no_backend' }));
  // templateId：报名时同意了订阅消息的带上，报名被取消或活动取消时云端用它发通知
  // cost：用户在页面上确认过的积分数。云端发现这场要用的积分已经变了就不扣，返回 cost_changed
  return tracked('signup', { eventId: eventId, templateId: templateId || '', cost: cost > 0 ? cost : 0 }, (d, revision) => {
    addTo(KEY.signups, eventId);
    // 这场用了积分的话，云端返回扣完以后的会员信息
    if (d && d.member) writeMember(d.member, revision, ['points']);
    return d;
  });
}

/** 补给计划：只保存最近一份，新计划保留公式版本与完整结果快照。 */
function getPlan() { return read(KEY.plan, null); }
/** 旧版只传摘要仍兼容；新版 result 是去掉 input 的完整计算结果。 */
function savePlan(input, result, formulaVersion) {
  if (!cloud.enabled()) {
    const plan = { input: input, result: result, formulaVersion: formulaVersion, savedAt: Date.now() };
    write(KEY.plan, plan);
    emit();
    return Promise.resolve(plan);
  }
  return tracked('savePlan', { input: input, result: result, formulaVersion: formulaVersion }, (d, revision) => {
    write(KEY.plan, d.plan, revision);
    return d.plan;
  });
}

/**
 * 未注册时点「保存到我的」：先记下输入，注册完成后再保存。
 * 保存成功后才清掉（clearPendingPlan）；保存失败时它还在，回到计算页可以接着存。
 */
function setPendingPlan(input) { write(KEY.pending, input); }
function getPendingPlan() { return read(KEY.pending, null); }
function clearPendingPlan() { write(KEY.pending, null); }

module.exports = {
  sync, onChange, unseenNotice, markNoticeSeen, takeInbox, readInbox,
  getMember, isMember, register, setNickname, fetchPoints,
  getReminders, hasReminder, addReminder, hasNews, subscribeNews,
  getSignups, hasSignup, signup,
  getPlan, savePlan, setPendingPlan, getPendingPlan, clearPendingPlan
};
