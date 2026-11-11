/**
 * 活动数据和「提醒我」。
 *
 * - 往期（past）是打进包里的真实赛事。
 * - 即将开始：config.sampleEvents 为 true 时用 content 里三种卡片样式的占位示例；
 *   否则用云数据库 events 集合里的活动（经云函数 api 的 events 接口），本机缓存一份，refresh() 更新。
 * 页面拿到的都是整理好的显示用数据，形状和占位示例一致。
 */
const config = require('../config.js');
const content = require('../content/events.js');
const cloud = require('./cloud.js');
const store = require('./store.js');
const format = require('./format.js');
const { withAssets } = require('./assets.js');

const CACHE_KEY = 'sx_events';
const join = (list) => list.filter(Boolean).join(' · ');

// 三种活动各自的卡片样式、固定标签、默认配图，取自 content 里对应的示例
const TEMPLATE = {};
content.upcoming.forEach((t) => { TEMPLATE[t.type] = t; });

function fromSample(e, i) {
  return withAssets(Object.assign({}, e, {
    id: 'sample-' + i,
    meta: e.style === 'lime' ? join([e.window, e.quota]) : join([e.date, e.city])
  }));
}

/** 云端的活动 → 页面显示用的数据 */
function fromCloud(e) {
  const t = TEMPLATE[e.type] || TEMPLATE[content.types[0]];
  const opens = e.memberSignupStart || e.signupStart;
  const quota = e.quotaText || (e.quota != null ? String(e.quota) : '');
  const view = {
    id: e.id,
    style: t.style,
    type: e.type,
    // 「会员优先报名」只在活动确实给会员留了提前报名的时间时才显示
    tag: t.style === 'poster' ? (e.memberSignupStart ? t.tag : '') : t.tag,
    title: e.title,
    date: format.date(e.date),
    city: e.city,
    signupOpens: format.moment(opens),
    window: format.range(e.signupStart, e.signupEnd),
    quota: quota,
    drawAt: format.moment(e.drawAt),
    image: e.cover || t.image,
    graphic: t.graphic,
    icon: t.icon,
    action: t.action,
    actionDone: t.actionDone,
    raw: e
  };
  view.meta = t.style === 'lime' ? join([view.window, view.quota]) : join([view.date, view.city]);
  return withAssets(view);
}

function cached() {
  try { return wx.getStorageSync(CACHE_KEY) || []; } catch (e) { return []; }
}

/** 即将开始的活动（同步，读缓存） */
function listUpcoming() {
  if (config.sampleEvents) return content.upcoming.map(fromSample);
  return cached().map(fromCloud);
}

/** 从云端取最新的活动列表，更新缓存。用示例数据或没配云环境时不请求。resolve 是否有更新。 */
function refresh() {
  if (config.sampleEvents || !cloud.enabled()) return Promise.resolve(false);
  return cloud.call('events').then((d) => {
    try { wx.setStorageSync(CACHE_KEY, d.events || []); } catch (e) { /* 缓存失败不影响本次显示 */ }
    return true;
  }).catch(() => false);
}

function listPast() {
  return withAssets(content.past);
}

function getEvent(id) {
  return listUpcoming().find((e) => e.id === id) || null;
}

/**
 * 活动详情页的文案和字段。固定文字来自 content 的 detail，其中的方括号占位换成这场活动的数据；
 * 活动没有提供的项不显示。占位示例没有真实数据，原样返回占位。
 */
function getDetail(event) {
  const d = withAssets(content.detail);
  d.fields = d.fields.map((f, i) => ({ k: f.k, v: f.v, head: i < 3 }));
  if (!event || !event.raw) return d;
  const e = event.raw;
  const values = {
    活动日期: event.date,
    城市: e.city,
    名额: event.quota,
    活动日期与时间: format.moment(e.date),
    城市与场地: [e.city, e.venue].filter(Boolean).join(' '),
    报名起止时间: format.range(e.memberSignupStart || e.signupStart, e.signupEnd),
    会员开放时间: format.moment(e.memberSignupStart),
    活动介绍文案: e.intro
  };
  const filled = (text) => format.fill(text, values);
  const done = (text) => text.indexOf('[') < 0;
  // head: 头图底部并排的前三项；其余在正文里逐行列出
  d.fields = d.fields.map((f, i) => ({ k: f.k, v: filled(f.v), head: i < 3 })).filter((f) => done(f.v));
  d.memberBanner = e.memberSignupStart ? { title: d.memberBanner.title, body: filled(d.memberBanner.body) } : null;
  d.about = Object.assign({}, d.about, { body: done(filled(d.about.body)) ? filled(d.about.body) : '' });
  return d;
}

/**
 * 「提醒我」：一次性订阅消息，用户每点一次授权换一条通知，所以必须由点击直接触发。
 * 模板 ID 没填时只在本机记录，不会真的发消息。
 * @returns {Promise<boolean>} 是否已设提醒
 */
function remind(eventId) {
  const tmpl = config.subscribeTemplateId;
  if (!tmpl) return store.addReminder(eventId).then(() => true);
  return new Promise((resolve) => {
    wx.requestSubscribeMessage({
      tmplIds: [tmpl],
      success: (res) => {
        if (res[tmpl] !== 'accept') { resolve(false); return; }
        store.addReminder(eventId, tmpl).then(() => resolve(true)).catch(() => resolve(false));
      },
      fail: () => resolve(false)
    });
  });
}

module.exports = { listUpcoming, refresh, listPast, getEvent, getDetail, remind, hasReminder: store.hasReminder, hasSignup: store.hasSignup };
