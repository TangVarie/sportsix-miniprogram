/**
 * 活动数据、「提醒我」和「有新活动通知我」。
 *
 * - 往期（past）是赞助过的赛事：存在云端，运营在后台增删改（经云函数 api 的 pastEvents 接口），本机缓存一份。
 *   没配云环境、或者还没取到过时，用打进包里的那几场。
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
const messages = require('../content/messages.js');

const toast = (title) => wx.showToast({ title: title, icon: 'none' });

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
    // 报名要用多少积分（0 是不用），和报名的人有事找谁
    cost: e.cost > 0 ? e.cost : 0,
    contact: e.contact || '',
    readOnly: !!e.readOnly,
    raw: e
  };
  view.meta = t.style === 'lime' ? join([view.window, view.quota]) : join([view.date, view.city]);
  return withAssets(view);
}

const PAST_KEY = 'sx_past';
const cache = Object.create(null);
const states = Object.create(null);
const flights = Object.create(null);
const generations = Object.create(null);
const details = Object.create(null);
const listeners = [];
let mine = [];
let mineCursor = null;

function onChange(fn) {
  listeners.push(fn);
  return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
}
function emit() {
  listeners.slice().forEach((fn) => { try { fn(); } catch (e) { /* 一个页面异常不影响其他订阅者 */ } });
}
function readList(key) {
  if (Object.prototype.hasOwnProperty.call(cache, key)) return cache[key];
  try {
    const v = wx.getStorageSync(key);
    cache[key] = Array.isArray(v) ? v : null;
  } catch (e) { cache[key] = null; }
  return cache[key];
}
function writeList(key, list) {
  cache[key] = list;
  try { wx.setStorageSync(key, list); } catch (e) { /* 运行时数据已更新，持久化失败也能显示 */ }
}

function stateKey(kind, id) { return kind === 'detail' ? 'detail:' + id : kind; }
function state(key) {
  if (!states[key]) {
    const hasData = key === 'upcoming' ? config.sampleEvents || readList(CACHE_KEY) !== null
      : key === 'past' ? true : key.indexOf('detail:') === 0 ? !!getEvent(key.slice(7)) : false;
    states[key] = { status: hasData ? 'ready' : 'idle', loading: false, error: null, hasData: hasData, stale: false, updatedAt: 0 };
  }
  return states[key];
}
/** 请求状态与内容分开，网络失败不会冒充「没有活动」。hasData 包括成功取到的空结果。 */
function getLoadState(kind, id) { return Object.assign({}, state(stateKey(kind || 'upcoming', id))); }
function begin(key) {
  const s = state(key);
  Object.assign(s, { status: s.hasData ? 'refreshing' : 'loading', loading: true, error: null, stale: false });
  const generation = (generations[key] || 0) + 1;
  generations[key] = generation;
  emit();
  return generation;
}
function complete(key, empty) {
  Object.assign(state(key), { status: empty ? 'empty' : 'ready', loading: false, error: null, hasData: true, stale: false, updatedAt: Date.now() });
  emit();
}
function failed(key, error) {
  const s = state(key);
  Object.assign(s, { status: s.hasData ? 'stale' : 'error', loading: false, error: error && error.code || 'network', stale: s.hasData });
  emit();
}

/**
 * 本机从没取到过活动列表、要等云端返回：这段时间列表显示占位块，不先闪一下「敬请期待」。
 * 取到过一次以后（哪怕是空的）就不再算首次加载，回到这一页时直接显示缓存里的结果。
 */
function isFirstLoad() {
  return !config.sampleEvents && cloud.enabled() && readList(CACHE_KEY) === null;
}

/** 即将开始的活动（同步，读缓存） */
function listUpcoming() {
  if (config.sampleEvents) return content.upcoming.map(fromSample);
  return (readList(CACHE_KEY) || []).map(fromCloud);
}

/** 从云端取最新的活动列表，更新缓存。用示例数据或没配云环境时不请求。resolve 是否有更新。 */
function refresh(force) {
  if (config.sampleEvents || !cloud.enabled()) return Promise.resolve(false);
  if (!force && flights.upcoming) return flights.upcoming;
  const generation = begin('upcoming');
  const promise = cloud.call('events').then((d) => {
    if (generation !== generations.upcoming) return false;
    const list = d.events || [];
    writeList(CACHE_KEY, list);
    complete('upcoming', !list.length);
    return true;
  }).catch((e) => { if (generation === generations.upcoming) failed('upcoming', e); return false; });
  flights.upcoming = promise;
  promise.then(() => { if (flights.upcoming === promise) delete flights.upcoming; });
  return promise;
}

/** 「即将开始」里没有活动时的空状态 */
function getEmpty() {
  return withAssets({ title: content.empty.title, image: content.empty.image, graphic: content.empty.graphic });
}

/** 往期的赞助赛事（同步，读缓存）。还没从云端取到过时用包里的那几场 */
function listPast() {
  return withAssets(readList(PAST_KEY) || content.past);
}
/** 运营保存后返回的完整列表也走这个入口，首页和活动页同步更新。 */
function setPast(list) {
  generations.past = (generations.past || 0) + 1;
  writeList(PAST_KEY, list || []);
  complete('past', !list || !list.length);
}

/** 从云端取最新的往期赛事，更新缓存。没配云环境时不请求。resolve 是否有更新。 */
function refreshPast(force) {
  if (!cloud.enabled()) return Promise.resolve(false);
  if (!force && flights.past) return flights.past;
  const generation = begin('past');
  const promise = cloud.call('pastEvents').then((d) => {
    if (generation !== generations.past) return false;
    writeList(PAST_KEY, d.past || []);
    complete('past', !(d.past || []).length);
    return true;
  }).catch((e) => { if (generation === generations.past) failed('past', e); return false; });
  flights.past = promise;
  promise.then(() => { if (flights.past === promise) delete flights.past; });
  return promise;
}

function getEvent(id) {
  if (Object.prototype.hasOwnProperty.call(details, id)) return details[id];
  return listUpcoming().find((e) => e.id === id) || null;
}

/** 详情不依赖公共列表的数量和日期范围；历史报名可由云端返回只读详情。 */
function fetchEvent(id) {
  if (config.sampleEvents || !cloud.enabled()) return Promise.resolve(getEvent(id));
  const key = stateKey('detail', id);
  if (flights[key]) return flights[key];
  const generation = begin(key);
  const promise = cloud.call('event', { id: id }).then((d) => {
    if (generation !== generations[key]) return getEvent(id);
    details[id] = d.event ? fromCloud(Object.assign({}, d.event, { readOnly: !!d.readOnly })) : null;
    complete(key, !details[id]);
    return details[id];
  }).catch((e) => {
    if (generation === generations[key] && e && e.code === 'not_found') {
      details[id] = null;
      complete(key, true);
      return null;
    }
    if (generation === generations[key]) failed(key, e);
    throw e;
  });
  flights[key] = promise;
  const done = () => { if (flights[key] === promise) delete flights[key]; };
  promise.then(done, done);
  return promise;
}

function getMyEvents() { return mine.slice(); }
/** cursor 留空从第一页重新加载；翻页时保留已有记录，删除活动也保留本人记录。 */
function fetchMyEvents(cursor) {
  if (!cloud.enabled()) return Promise.resolve({ records: getMyEvents(), nextCursor: null });
  const key = 'mine';
  const generation = begin(key);
  return cloud.call('myEvents', { cursor: cursor || null }).then((d) => {
    const records = (d.records || []).map((r) => Object.assign({}, r, { event: r.event ? fromCloud(r.event) : null }));
    if (generation !== generations[key]) return { records: getMyEvents(), nextCursor: mineCursor };
    const all = cursor ? mine.concat(records) : records;
    const seen = Object.create(null);
    mine = all.filter((r) => { const id = r.id || r.event && r.event.id; if (seen[id]) return false; seen[id] = true; return true; });
    mineCursor = d.nextCursor || null;
    complete(key, !mine.length);
    return { records: getMyEvents(), nextCursor: mineCursor };
  }).catch((e) => { if (generation === generations[key]) failed(key, e); throw e; });
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
 * 没设上时提示一句：用户以前选过「总是拒绝」或关了订阅消息总开关时，微信不会再弹授权窗，不提示的话看起来像按钮没反应。
 * @returns {Promise<boolean>} 是否已设提醒
 */
const pendingBatches = Object.create(null);
const subscriptionFlights = Object.create(null);
function subscribe(kind, eventId) {
  const tmpl = config.subscribeTemplateId;
  const key = kind + ':' + (eventId || '');
  if (subscriptionFlights[key]) return subscriptionFlights[key];
  const copy = messages[kind];
  const save = (batchId) => kind === 'remind' ? store.addReminder(eventId, tmpl, batchId) : store.subscribeNews(tmpl, batchId);
  const persist = (batch) => save(batch.id).then((d) => {
    delete pendingBatches[key];
    return !d || (kind === 'news' ? d.news !== false : d.reminded !== false);
  }).catch(() => { toast(copy.failed); return false; });
  let promise;
  if (!tmpl) promise = save('').then(() => true);
  // 登记响应丢失时复用这次已授权的批次，不重复弹授权，也不把已发送的记录重新激活。
  else if (pendingBatches[key] && pendingBatches[key].templateId === tmpl) promise = persist(pendingBatches[key]);
  else promise = new Promise((resolve) => {
    const declined = () => { toast(copy.declined); resolve(false); };
    try {
      wx.requestSubscribeMessage({
        tmplIds: [tmpl],
        success: (res) => {
          if (res[tmpl] !== 'accept') { declined(); return; }
          const batch = { id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2), templateId: tmpl };
          pendingBatches[key] = batch;
          persist(batch).then(resolve);
        },
        fail: declined
      });
    } catch (e) { declined(); }
  });
  subscriptionFlights[key] = promise;
  const done = () => { if (subscriptionFlights[key] === promise) delete subscriptionFlights[key]; };
  promise.then(done, done);
  return promise;
}
function remind(eventId) { return subscribe('remind', eventId); }

/**
 * 报名前请用户订阅一次消息：同意了的，报名被取消或活动取消时能用微信的服务通知告诉他。
 * 必须由点击直接触发。不同意也照样能报名（平台不允许「不订阅就不让用」），这时 resolve 空字符串。
 * @returns {Promise<string>} 同意了是模板 ID，否则是 ''
 */
function askSubscribe() {
  const tmpl = config.subscribeTemplateId;
  if (!tmpl) return Promise.resolve('');
  return new Promise((resolve) => {
    wx.requestSubscribeMessage({
      tmplIds: [tmpl],
      success: (res) => resolve(res[tmpl] === 'accept' ? tmpl : ''),
      fail: () => resolve('')
    });
  });
}

/** 活动页最下面「有新活动通知我」那一行的文字 */
function getNews() {
  return content.news;
}

/**
 * 「有新活动通知我」：和「提醒我」一样是一次性订阅消息，点一次换一条，所以必须由点击直接触发。
 * 运营在后台对某场活动点「通知」时发出；收到一条之后按钮回到没订阅的样子，要再点一次。
 * @returns {Promise<boolean>} 是否订阅上了
 */
function subscribeNews() {
  return subscribe('news');
}

module.exports = {
  listUpcoming, isFirstLoad, refresh, listPast, refreshPast, getEmpty, getEvent, getDetail, remind, hasReminder: store.hasReminder, hasSignup: store.hasSignup,
  getNews, subscribeNews, hasNews: store.hasNews, askSubscribe,
  onChange, getLoadState, setPast, fetchEvent, fetchMyEvents, getMyEvents
};
