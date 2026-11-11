/**
 * 订阅消息的内容。字段名（thing1、time2 这些）由申请到的模板决定，
 * 模板申请下来以后，按公众平台上该模板的「详细内容」把下面的字段名和取值对上，否则发送会失败。
 * 字段有长度限制（thing 类 20 个字以内），标题在这里截断。
 */
function two(n) { return n < 10 ? '0' + n : '' + n; }

/** 按北京时间格式化成 2026-01-05 09:30 */
function formatTime(msValue) {
  const d = new Date(msValue + 8 * 3600 * 1000);
  return d.getUTCFullYear() + '-' + two(d.getUTCMonth() + 1) + '-' + two(d.getUTCDate()) + ' ' + two(d.getUTCHours()) + ':' + two(d.getUTCMinutes());
}

module.exports = {
  /** 点消息卡片进入的页面 */
  page: (event) => 'pages/event-detail/index?id=' + event._id,
  /** developer 开发版、trial 体验版、formal 正式版 */
  miniprogramState: 'formal',
  /** 模板内容：字段名待按申请到的模板调整 */
  data: (event, opensAt) => ({
    thing1: { value: String(event.title || '').slice(0, 20) },
    time2: { value: formatTime(opensAt) }
  }),
  formatTime: formatTime
};
