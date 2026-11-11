/**
 * 会员、报名、提醒、补给计划的读写。页面只通过这个文件拿这些数据。
 *
 * 读是同步的，读的是本机缓存；写返回 Promise。
 * - 配了云环境（config.cloudEnv）：写先发到云函数 api，成功后更新缓存；
 *   进入小程序时 sync() 用云端的数据覆盖缓存，完成后通知订阅了 onChange 的页面重读。
 * - 没配云环境：只写本机缓存，用来在没有云环境时看页面状态。这时注册不取手机号，提醒不会真的发出。
 */
const cloud = require('./cloud.js');

const KEY = { member: 'sx_member', reminders: 'sx_reminders', signups: 'sx_signups', plan: 'sx_plan', pending: 'sx_pending_plan' };

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

/** 进入小程序时调用：用云端数据覆盖本机缓存。没配云环境时什么也不做。 */
function sync() {
  if (!cloud.enabled()) return Promise.resolve(false);
  return cloud.call('bootstrap').then((d) => {
    write(KEY.member, d.member);
    write(KEY.plan, d.plan);
    write(KEY.reminders, d.reminders || []);
    write(KEY.signups, d.signups || []);
    emit();
    return true;
  }).catch(() => false); // 取不到时先用上次的缓存
}

/** 会员：未注册返回 null。云开发下是 { phoneMasked, memberNo, points, createdAt } */
function getMember() { return read(KEY.member, null); }
function isMember() { return !!getMember(); }

/**
 * 注册。云开发下 code 是手机号快速验证组件回调里的 e.detail.code，由云函数换取手机号并建会员；
 * 没配云环境时不需要 code，只在本机记一个「已注册」。
 */
function register(code) {
  if (!cloud.enabled()) {
    const member = { createdAt: Date.now() };
    write(KEY.member, member);
    return Promise.resolve(member);
  }
  return cloud.call('register', { code: code }).then((d) => {
    write(KEY.member, d.member);
    return d.member;
  });
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
  return cloud.call('remind', { eventId: eventId, templateId: templateId }).then(() => { addTo(KEY.reminders, eventId); });
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
  return cloud.call('signup', { eventId: eventId }).then(() => { addTo(KEY.signups, eventId); });
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
  return cloud.call('savePlan', { input: input, result: result }).then((d) => {
    write(KEY.plan, d.plan);
    return d.plan;
  });
}

/** 未注册时点「保存到我的」：先记下输入，注册完成后再保存 */
function setPendingPlan(input) { write(KEY.pending, input); }
function takePendingPlan() {
  const input = read(KEY.pending, null);
  if (input) write(KEY.pending, null);
  return input;
}

module.exports = {
  sync, onChange,
  getMember, isMember, register,
  getReminders, hasReminder, addReminder,
  getSignups, hasSignup, signup,
  getPlan, savePlan, setPendingPlan, takePendingPlan
};
