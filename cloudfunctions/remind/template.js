/**
 * 订阅消息的内容。用公共模板「活动动态通知」，选三个关键词：活动名称、开始时间、温馨提示。
 *
 * FIELDS 里右边的字段名（thing1、time2 这些）由申请到的模板决定：模板通过后，
 * 在公众平台「订阅消息 → 我的模板 → 详情」的「详细内容」里能看到形如 {{thing1.DATA}} 的写法，
 * 把三个字段名照着改到 FIELDS 里，重新上传这个云函数。字段名对不上会发送失败。
 */
const FIELDS = {
  title: 'thing1', // 活动名称
  time: 'time2',   // 开始时间
  tip: 'thing3'    // 温馨提示
};

/** 温馨提示的内容（thing 类字段不超过 20 个字） */
const TIP = '报名已开放';

function two(n) { return n < 10 ? '0' + n : '' + n; }

/** 按北京时间格式化成 2027年3月8日 09:30（time、date 两类字段都接受这种写法） */
function formatTime(msValue) {
  const d = new Date(msValue + 8 * 3600 * 1000);
  return d.getUTCFullYear() + '年' + (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日 ' + two(d.getUTCHours()) + ':' + two(d.getUTCMinutes());
}

module.exports = {
  /** 点消息卡片进入的页面 */
  page: (event) => 'pages/event-detail/index?id=' + event._id,
  /** developer 开发版、trial 体验版、formal 正式版 */
  miniprogramState: 'formal',
  /** 模板内容。startsAt 是活动开始的时间（毫秒）；活动没填日期时用报名开放的时间 */
  data: (event, opensAt) => {
    const startsAt = event.date ? new Date(event.date).getTime() : opensAt;
    return {
      [FIELDS.title]: { value: String(event.title || '').slice(0, 20) },
      [FIELDS.time]: { value: formatTime(startsAt) },
      [FIELDS.tip]: { value: TIP }
    };
  },
  formatTime: formatTime
};
