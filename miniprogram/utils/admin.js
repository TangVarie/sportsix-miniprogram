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
/** 新建（id 为空）或修改活动 */
function saveEvent(id, event) {
  return cloud.call('adminSaveEvent', { id: id || '', event: event }).then((d) => d.event);
}
/** 上架（published）或下架（draft） */
function setEventStatus(id, status) {
  return cloud.call('adminSetEventStatus', { id: id, status: status }).then((d) => d.event);
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
function adjustPoints(memberNo, delta, reason) {
  return cloud.call('adminAdjustPoints', { memberNo: memberNo, delta: delta, reason: reason }).then((d) => d.member);
}

/** 取电脑端后台的登录码：{ code, expiresIn }。8 位数字，5 分钟内有效，只能用一次 */
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

module.exports = { listEvents, saveEvent, setEventStatus, getNotice, saveNotice, findMember, adjustPoints, webCode, uploadCover, errorText, toPicker, fromPicker };
