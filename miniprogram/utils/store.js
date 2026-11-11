/**
 * 会员、提醒、补给计划的读写。
 *
 * 后台方案、AppID、主体还没定（docs/04-open-items.md），这里先只用本机存储走通页面状态：
 * - 注册不取手机号，只在本机记一个「已注册」；会员编号、积分保持设计稿里的占位。
 * - 「提醒我」只记在本机，不会真的发订阅消息。
 * - 补给计划只存最近一份。
 * 接后台时只改这个文件，页面不用动。接口形状见 docs/05-dev-plan.md 末尾。
 */
const KEY = { member: 'sx_member', reminders: 'sx_reminders', plan: 'sx_plan', pending: 'sx_pending_plan' };

function read(key, fallback) {
  try {
    const v = wx.getStorageSync(key);
    return v === '' || v == null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}
function write(key, value) {
  try { wx.setStorageSync(key, value); } catch (e) { /* 存不进去时页面状态只在本次生效 */ }
}

/** 会员：未注册返回 null */
function getMember() { return read(KEY.member, null); }
function isMember() { return !!getMember(); }
function register() {
  const member = { createdAt: Date.now() };
  write(KEY.member, member);
  return member;
}

/** 已设提醒的活动 id 列表 */
function getReminders() { return read(KEY.reminders, []); }
function hasReminder(eventId) { return getReminders().indexOf(eventId) >= 0; }
function addReminder(eventId) {
  const list = getReminders();
  if (list.indexOf(eventId) < 0) { list.push(eventId); write(KEY.reminders, list); }
  return list;
}

/** 补给计划：只保存最近一份。input 是 planFuel 的输入，展示时用 planFuel(input) 重算。 */
function getPlan() { return read(KEY.plan, null); }
function savePlan(input) {
  const plan = { input: input, savedAt: Date.now() };
  write(KEY.plan, plan);
  return plan;
}

/** 未注册时点「保存到我的」：先记下输入，注册完成后再保存 */
function setPendingPlan(input) { write(KEY.pending, input); }
function takePendingPlan() {
  const input = read(KEY.pending, null);
  if (input) { try { wx.removeStorageSync(KEY.pending); } catch (e) { /* 忽略 */ } }
  return input;
}

module.exports = { getMember, isMember, register, getReminders, hasReminder, addReminder, getPlan, savePlan, setPendingPlan, takePendingPlan };
