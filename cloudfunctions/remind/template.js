/**
 * 订阅消息的内容。用的是公共模板「活动动态通知」，模板 ID 在 miniprogram/config.js 的 subscribeTemplateId。
 * 模板有五个关键词，字段名取自公众平台该模板的「详细内容」。发送时五个都必须有值，缺一个就会发送失败。
 *
 *   活动名称 {{thing1.DATA}}   开始时间 {{time7.DATA}}   温馨提示 {{thing4.DATA}}
 *   截止时间 {{time3.DATA}}    活动地点 {{thing8.DATA}}
 *
 * 换模板或改关键词后，按新的「详细内容」改 FIELDS，重新上传这个云函数。
 */
const FIELDS = {
  title: 'thing1',     // 活动名称
  startsAt: 'time7',   // 开始时间：活动开始的时间
  tip: 'thing4',       // 温馨提示
  deadline: 'time3',   // 截止时间：报名截止的时间
  place: 'thing8'      // 活动地点
};

/** 温馨提示的内容：报名开放的提醒 */
const TIP = '报名已开放';
/** 温馨提示的内容：新活动通知 */
const TIP_NEW = '新活动上线';
/** 活动没有填城市和场地时，活动地点一栏写这个（thing 类字段不能为空） */
const PLACE_FALLBACK = '详见活动详情';
/** thing 类字段不超过 20 个字 */
const THING_MAX = 20;

function two(n) { return n < 10 ? '0' + n : '' + n; }
const ms = (d) => (d ? new Date(d).getTime() : null);
const thing = (s) => String(s).slice(0, THING_MAX);

/** 按北京时间格式化成 2027年3月8日 09:30 */
function formatTime(msValue) {
  const d = new Date(msValue + 8 * 3600 * 1000);
  return d.getUTCFullYear() + '年' + (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日 ' + two(d.getUTCHours()) + ':' + two(d.getUTCMinutes());
}

module.exports = {
  /** 点消息卡片进入的页面 */
  page: (event) => 'pages/event-detail/index?id=' + event._id,
  /** developer 开发版、trial 体验版、formal 正式版 */
  miniprogramState: 'formal',
  /**
   * 模板内容。opensAt 是报名开放的时间（毫秒），tip 是温馨提示一栏的字（不传就是「报名已开放」）。
   * 活动没填日期时，开始时间用报名开放的时间；没填报名截止时间时，截止时间用活动开始的时间。
   */
  data: (event, opensAt, tip) => {
    const startsAt = ms(event.date) || opensAt;
    const deadline = ms(event.signupEnd) || startsAt;
    const place = [event.city, event.venue].filter(Boolean).join(' ');
    return {
      [FIELDS.title]: { value: thing(event.title || '') },
      [FIELDS.startsAt]: { value: formatTime(startsAt) },
      [FIELDS.tip]: { value: thing(tip || TIP) },
      [FIELDS.deadline]: { value: formatTime(deadline) },
      [FIELDS.place]: { value: thing(place || PLACE_FALLBACK) }
    };
  },
  TIP_NEW: TIP_NEW,
  formatTime: formatTime
};
