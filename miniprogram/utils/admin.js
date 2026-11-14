/**
 * 运营后台用的接口和几个小工具。只有管理员（会员记录上有 admin: true）调得通，权限在云函数里检查。
 * 后台页面只经过这里调云函数，不直接调。
 */
const cloud = require('./cloud.js');
const content = require('../content/admin.js');

/** 全部活动（含未上架、已过期），新的在前 */
function listEvents() {
  return cloud.call('adminEvents').then((d) => d.events || []);
}
/** 活动页用：全部活动，加上现在有多少人订阅着新活动通知（newsWaiting） */
function eventsOverview() {
  return cloud.call('adminEvents').then((d) => ({ events: d.events || [], newsWaiting: d.newsWaiting || 0 }));
}
/** 把这场活动通知给订阅了新活动通知的人。只是登记，几分钟内由定时任务发出；每场活动只能通知一次 */
function notifyEvent(id) {
  return cloud.call('adminNotifyEvent', { id: id });
}
/** 新建（id 为空）或修改活动 */
function saveEvent(id, event, version) {
  return cloud.call('adminSaveEvent', { id: id || '', event: event, version: version }).then((d) => d.event);
}
/** 上架（published）或下架（draft） */
function setEventStatus(id, status) {
  return cloud.call('adminSetEventStatus', { id: id, status: status }).then((d) => d.event);
}
/** 一场活动的报名名单：{ event, signups: [{ memberNo, nickname, phone, cost, at }] }，早报的在前 */
function signups(id) {
  return cloud.call('adminSignups', { id: id });
}
/** 取消某位会员的报名（按会员编号）：名额让出来，积分退回，对方收到通知 */
function cancelSignup(id, memberNo) {
  return cloud.call('adminCancelSignup', { id: id, memberNo: memberNo });
}
/**
 * 取消整场活动。人多时云端一次做不完，这里接着调，直到做完。
 * onProgress(还剩多少人) 每做完一批回调一次。没做完就停下来的，reject { code: 'cancel_incomplete' }。
 */
function cancelEvent(id, onProgress) {
  // 只要人数在减少就一直做下去；连着三轮没减少（出了什么问题）才停，停下来时按「没做完」报错，不当成做完
  const step = (last, stuck) => cloud.call('adminCancelEvent', { id: id }).then((d) => {
    if (onProgress) onProgress(d.remaining);
    if (!d.remaining) return d;
    const still = last != null && d.remaining >= last ? stuck + 1 : 0;
    if (still >= 3) return Promise.reject({ code: 'cancel_incomplete', remaining: d.remaining });
    return step(d.remaining, still);
  });
  return step(null, 0);
}
/** 往期的赞助赛事（活动页「往期」里的照片卡），年份新的在前 */
function listPast() {
  return cloud.call('adminPastEvents').then((d) => d.past || []);
}
/** 新加（id 为空）或修改一场往期赛事，resolve 最新的整张列表 */
function savePast(id, item) {
  return cloud.call('adminSavePast', { id: id || '', item: item }).then((d) => d.past || []);
}
/** 删掉一场往期赛事，resolve 最新的整张列表 */
function deletePast(id) {
  return cloud.call('adminDeletePast', { id: id }).then((d) => d.past || []);
}
function getNotice() {
  return cloud.call('adminNotice').then((d) => d.notice);
}
function saveNotice(notice) {
  return cloud.call('adminSaveNotice', { notice: notice }).then((d) => d.notice);
}
/** 按手机号或会员编号找会员 */
function findMember(query) {
  return cloud.call('adminFindMember', { query: query }).then((d) => d.member);
}
/** 加减积分。delta 为负是减 */
function adjustPoints(memberNo, delta, reason, operationId) {
  return cloud.call('adminAdjustPoints', { memberNo: memberNo, delta: delta, reason: reason, operationId: operationId }).then((d) => d.member);
}

/** 只作去重标记，不作登录凭证。同一笔不确定结果的调整重试时复用。 */
function newOperationId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + '-' + Math.random().toString(36).slice(2);
}

/** 和云端一致的表单边界，避免小数、负数被 parseInt 悄悄改成另一种含义。 */
function eventError(e) {
  if (!String(e.title || '').trim()) return 'missing_title';
  if (!e.date) return 'missing_date';
  if (e.quota != null && (!Number.isInteger(e.quota) || e.quota <= 0)) return 'bad_quota';
  if (!Number.isInteger(e.cost) || e.cost < 0 || e.cost > 1000000) return 'bad_cost';
  const start = e.memberSignupStart || e.signupStart;
  if ((e.memberSignupStart && e.signupStart && e.memberSignupStart > e.signupStart) ||
      (start && start > e.date) || (e.signupEnd && start && e.signupEnd <= start) ||
      (e.signupEnd && e.signupEnd > e.date)) return 'bad_signup_time';
  return '';
}

/** 原生返回手势也提示未保存；旧基础库继续使用页面里的返回确认。 */
function watchUnsaved(dirty) {
  try {
    if (dirty && wx.enableAlertBeforeUnload) wx.enableAlertBeforeUnload({ message: content.editor.unsaved });
    else if (!dirty && wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
  } catch (e) { /* 不影响表单 */ }
}

/* 新建活动填到一半的内容留在本机：误退出了，下次点「新建活动」接着填。存成功或点「清空重填」后清掉 */
const EVENT_DRAFT_KEY = 'sx_admin_event_draft';
function getEventDraft() {
  try { const d = wx.getStorageSync(EVENT_DRAFT_KEY); return d && d.form && d.times ? d : null; } catch (e) { return null; }
}
function setEventDraft(draft) {
  try { wx.setStorageSync(EVENT_DRAFT_KEY, draft); } catch (e) { /* 存不上：这次就不留草稿 */ }
}
function clearEventDraft() {
  try { wx.removeStorageSync(EVENT_DRAFT_KEY); } catch (e) { /* 同上 */ }
}

function confirmDiscard(dirty, next) {
  if (!dirty) { next(); return; }
  wx.showModal({ title: content.editor.discardTitle, content: content.editor.unsaved,
    confirmText: content.editor.discard, cancelText: content.editor.keep,
    success: (r) => { if (r.confirm) next(); } });
}

/** 会员看板上的数字：总数、新加入的人数、近 30 天每天多少、积分合计等 */
function memberStats() {
  return cloud.call('adminMemberStats');
}
/** 会员名单的一页：{ members, more, next }，新加入的在前。skip 传上一页给的 next */
function members(skip) {
  return cloud.call('adminMembers', { skip: skip || 0 });
}

/** 取电脑端后台的登录码：{ code, expiresIn }。12 位数字，5 分钟内有效，只能用一次 */
function webCode() {
  return cloud.call('adminWebCode');
}

/** 把活动头图传到云存储，resolve 文件的 fileID（cloud://...），活动的 cover 字段存它 */
function uploadCover(tempPath) {
  const ext = (/\.(\w+)$/.exec(tempPath) || [])[1] || 'jpg';
  const name = 'events/' + Date.now() + '-' + Math.floor(Math.random() * 1e6) + '.' + ext;
  return new Promise((resolve, reject) => {
    try { cloud.init(); } catch (e) { reject(e); return; }
    wx.cloud.uploadFile({ cloudPath: name, filePath: tempPath })
      .then((res) => resolve(res.fileID))
      .catch(reject);
  });
}

/** 接口报错的 code → 给人看的话 */
function errorText(e) {
  return content.errors[e && e.code] || content.errors.network;
}

const two = (n) => (n < 10 ? '0' : '') + n;
/** 毫秒时间戳 → 日期和时间选择器用的两个字符串（按手机所在时区） */
function toPicker(ms) {
  if (!ms) return { date: '', time: '' };
  const d = new Date(ms);
  return { date: d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()), time: two(d.getHours()) + ':' + two(d.getMinutes()) };
}
/** 日期和时间选择器的值 → 毫秒时间戳。没选日期是 null；只选了日期的按 defaultTime（默认 00:00）算 */
function fromPicker(date, time, defaultTime) {
  if (!date) return null;
  const p = date.split('-').map(Number);
  const t = (time || defaultTime || '00:00').split(':').map(Number);
  return new Date(p[0], p[1] - 1, p[2], t[0], t[1]).getTime();
}

module.exports = { listEvents, eventsOverview, notifyEvent, signups, cancelSignup, cancelEvent, listPast, savePast, deletePast, saveEvent, setEventStatus, getNotice, saveNotice, findMember, adjustPoints, newOperationId, eventError, watchUnsaved, confirmDiscard, getEventDraft, setEventDraft, clearEventDraft, memberStats, members, webCode, uploadCover, errorText, toPicker, fromPicker };
