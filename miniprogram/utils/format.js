/**
 * 时间的显示格式。活动的时间在云端存的是时间戳，统一按北京时间显示。
 */
function parts(ms) {
  const d = new Date(ms + 8 * 3600 * 1000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), min: d.getUTCMinutes() };
}
const two = (n) => (n < 10 ? '0' + n : '' + n);

/** 2026年3月8日 */
function date(ms) {
  if (!ms) return '';
  const p = parts(ms);
  return p.y + '年' + p.m + '月' + p.d + '日';
}

/** 3月8日 09:30 */
function moment(ms) {
  if (!ms) return '';
  const p = parts(ms);
  return p.m + '月' + p.d + '日 ' + two(p.h) + ':' + two(p.min);
}

/** 3月1日 10:00 – 3月5日 18:00；只有一头时只写那一头 */
function range(from, to) {
  return [moment(from), moment(to)].filter(Boolean).join(' – ');
}

/** 把文案里的方括号占位换成实际的值：fill('报名 [开放时间] 开始', { 开放时间: '3月1日 10:00' }) */
function fill(text, values) {
  return String(text).replace(/\[([^\]]+)\]/g, (all, name) => (values[name] != null && values[name] !== '' ? values[name] : all));
}

module.exports = { date, moment, range, fill };
