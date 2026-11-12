/**
 * 会员、报名、提醒、补给计划的读写。页面只通过这个文件拿这些数据。
 *
 * 读是同步的，读的是本机缓存；写返回 Promise。
 * - 配了云环境（config.cloudEnv）：写先发到云函数 api，成功后更新缓存；
 *   进入小程序时 sync() 用云端的数据覆盖缓存，完成后通知订阅了 onChange 的页面重读。
 * - 没配云环境：只写本机缓存，用来在没有云环境时看页面状态。这时注册不取手机号，提醒不会真的发出。
 */
const cloud = require('./cloud.js');

const KEY = { member: 'sx_member', reminders: 'sx_reminders', signups: 'sx_signups', plan: 'sx_plan', pending: 'sx_pending_plan', noticeSeen: 'sx_notice_seen' };

// 运营在后台设的公告，随启动同步拿到。只放在内存里：每次打开小程序都重新取
let notice = null;

function read(key, fallback) {
  try {
    const v = wx.getStorageSync(key);
    return v === '' || v == null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}
function write(key, value) {
  try {
    if (value == null) wx.removeStorageSync(key); else wx.setStorageSync(key, value);
  } catch (e) { /* 存不进去时页面状态只在本次生效 */ }
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
/** 包一层写操作：让进行中的同步知道缓存被动过 */
function tracked(promise) {
  activity += 1;
  const done = () => { activity += 1; };
  promise.then(done, done);
  return promise;
}

/** 进入小程序时调用：用云端数据覆盖本机缓存。没配云环境时什么也不做。 */
function sync(retries) {
  if (!cloud.enabled()) return Promise.resolve(false);
  const before = activity;
  const left = retries == null ? 3 : retries;
  return cloud.call('bootstrap').then((d) => {
    // 同步期间用户注册、保存了计划或报了名：这份快照可能还不包含那次写入，丢掉重取
    if (activity !== before) return left > 0 ? sync(left - 1) : false;
    write(KEY.member, d.member);
    write(KEY.plan, d.plan);
    write(KEY.reminders, d.reminders || []);
    write(KEY.signups, d.signups || []);
    notice = d.notice || null;
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
    return Promise.resolve({ member: member, isNew: true });
  }
  return tracked(cloud.call('register', { code: code }).then((d) => {
    write(KEY.member, d.member);
    return { member: d.member, isNew: d.isNew !== false };
  }));
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
  return tracked(cloud.call('points').then((d) => {
    write(KEY.member, d.member);
    return { points: typeof d.member.points === 'number' ? d.member.points : 0, logs: d.logs || [] };
  }));
}

/** 改昵称。没配云环境时只改本机的。 */
function setNickname(nickname) {
  if (!cloud.enabled()) {
    const member = Object.assign({}, getMember(), { nickname: nickname });
    write(KEY.member, member);
    return Promise.resolve(member);
  }
  return tracked(cloud.call('setNickname', { nickname: nickname }).then((d) => {
    write(KEY.member, d.member);
    return d.member;
  }));
}

function addTo(key, id) {
  const list = read(key, []);
  if (list.indexOf(id) < 0) { list.push(id); write(key, list); }
}

/** 已设提醒的活动 id 列表 */
function getReminders() { return read(KEY.reminders, []); }
function hasReminder(eventId) { return getReminders().indexOf(eventId) >= 0; }
/** 登记提醒。templateId 是用户刚授权的订阅消息模板；没配云环境或没有模板时只记在本机。 */
function addReminder(eventId, templateId) {
  if (!cloud.enabled() || !templateId) { addTo(KEY.reminders, eventId); return Promise.resolve(); }
  return tracked(cloud.call('remind', { eventId: eventId, templateId: templateId }).then(() => { addTo(KEY.reminders, eventId); }));
}

/** 已报名的活动 id 列表 */
function getSignups() { return read(KEY.signups, []); }
function hasSignup(eventId) { return getSignups().indexOf(eventId) >= 0; }
/**
 * 报名。失败时 reject 的 Error 带 code：not_member、not_open、closed、full、not_found、network。
 * 没配云环境时没有地方登记报名，直接按 'no_backend' 失败。
 */
function signup(eventId) {
  if (!cloud.enabled()) return Promise.reject(Object.assign(new Error('no_backend'), { code: 'no_backend' }));
  return tracked(cloud.call('signup', { eventId: eventId }).then(() => { addTo(KEY.signups, eventId); }));
}

/** 补给计划：只保存最近一份。input 是 planFuel 的输入，展示时用 planFuel(input) 重算。 */
function getPlan() { return read(KEY.plan, null); }
/** result 是 { total, gelCount, proCount }，云端留作记录 */
function savePlan(input, result) {
  if (!cloud.enabled()) {
    const plan = { input: input, savedAt: Date.now() };
    write(KEY.plan, plan);
    return Promise.resolve(plan);
  }
  return tracked(cloud.call('savePlan', { input: input, result: result }).then((d) => {
    write(KEY.plan, d.plan);
    return d.plan;
  }));
}

/**
 * 未注册时点「保存到我的」：先记下输入，注册完成后再保存。
 * 保存成功后才清掉（clearPendingPlan）；保存失败时它还在，回到计算页可以接着存。
 */
function setPendingPlan(input) { write(KEY.pending, input); }
function getPendingPlan() { return read(KEY.pending, null); }
function clearPendingPlan() { write(KEY.pending, null); }

module.exports = {
  sync, onChange, unseenNotice, markNoticeSeen,
  getMember, isMember, register, setNickname, fetchPoints,
  getReminders, hasReminder, addReminder,
  getSignups, hasSignup, signup,
  getPlan, savePlan, setPendingPlan, getPendingPlan, clearPendingPlan
};
