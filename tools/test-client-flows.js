/** 用户页面的恢复流程测试。全部接口为本机替身，不连接真实云环境。 */
const assert = require('assert');
const path = require('path');
const { createEnv, ROOT } = require('./preview/runtime.js');

let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks += 1; };
const eq = (value, expected, message) => { assert.deepStrictEqual(value, expected, message); checks += 1; };
const tick = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const HOUR = 3600 * 1000;
const record = (id, extra) => Object.assign({ id, type: '赛事', title: '活动 ' + id, status: 'published', date: Date.now() + 24 * HOUR, signupStart: Date.now() - HOUR, signupEnd: Date.now() + HOUR, signupCount: 0, city: '上海', quota: 10 }, extra);

function session(options) {
  const o = Object.assign({ member: null, events: [], past: [], history: [] }, options);
  const calls = [];
  const handlers = {};
  const env = createEnv({
    storage: o.member ? { sx_member: o.member } : {},
    wx: { cloud: {
      init() {},
      callFunction({ data }) {
        calls.push(data);
        const defaults = {
          bootstrap: () => ({ member: o.member, plan: null, reminders: [], signups: [], news: false, notice: null, inbox: [] }),
          events: () => ({ events: o.events }),
          pastEvents: () => ({ past: o.past }),
          event: () => ({ event: o.events.find((e) => e.id === data.id) || null, readOnly: false }),
          myEvents: () => ({ records: o.history, nextCursor: null }),
          points: () => ({ member: o.member, logs: [] }),
          register: () => { o.member = { nickname: '会员', points: 500, memberNo: '100001', createdAt: Date.now() }; return { member: o.member, isNew: true }; },
          signup: () => ({ eventId: data.eventId, member: o.member })
        };
        return Promise.resolve().then(() => {
          const fn = handlers[data.action] || defaults[data.action];
          if (!fn) throw new Error('unexpected action ' + data.action);
          return fn(data);
        }).then((result) => ({ result: { ok: true, data: result } }));
      }
    } }
  });
  Object.assign(require(path.join(ROOT, 'config.js')), { cloudEnv: 'test-env', sampleEvents: false, subscribeTemplateId: 'tmpl' });
  env.launch();
  return { env, calls, handlers, options: o };
}

async function activityFailureAndRetry() {
  const s = session();
  s.handlers.events = () => { throw new Error('offline'); };
  const page = s.env.openPage('pages/events/index');
  await tick();
  ok(page.data.loadError && !page.data.loading, '首次活动加载失败显示错误状态');
  const html = s.env.renderHtml();
  ok(html.includes('暂时没能加载') && !html.includes('敬请期待'), '网络错误不会渲染无活动占位');
  s.handlers.events = () => ({ events: [record('a', { signupStart: Date.now() + HOUR })] });
  await page.onRetry();
  ok(page.data.hasUpcoming && !page.data.loadError, '点击重试恢复活动列表');
  eq(page.data.upcoming[0].state.key, 'not_open', '列表使用统一未开放状态');
  page.onUnload();
}

async function directDetailAndLoginReturn() {
  const s = session();
  const event = record('outside-list');
  let unavailable = true;
  s.handlers.event = () => { if (unavailable) throw new Error('offline'); return { event, readOnly: false }; };
  const detail = s.env.openPage('pages/event-detail/index', { id: event.id });
  await tick();
  ok(detail.data.loadError && !detail.data.event, '详情首次加载失败可重试');
  ok(!s.env.wx.__calls.some((c) => c.api === 'switchTab'), '详情网络失败不跳回列表');
  unavailable = false;
  await detail.onRetry();
  eq(detail.data.event.id, event.id, '公共列表外的活动能按 ID 打开');
  detail.onSignup();
  eq(s.env.wx.__calls.filter((c) => c.api === 'switchTab').pop().args.url, '/pages/me/index', '未加入会员时转到登录');
  detail.onUnload();
  const me = s.env.openPage('pages/me/index');
  await require(path.join(ROOT, 'utils/store.js')).register('phone-code').then((r) => me.afterRegister(r));
  await tick();
  const destination = s.env.wx.__calls.filter((c) => c.api === 'navigateTo').pop();
  eq(destination.args.url, '/pages/event-detail/index?id=' + event.id, '登录后回到原活动');
  eq(s.calls.filter((c) => c.action === 'signup').length, 0, '登录返回不会自动报名或扣积分');
  const reopened = s.env.openPage('pages/event-detail/index', { id: event.id });
  await tick();
  reopened.onSignup();
  await tick();
  eq(s.calls.filter((c) => c.action === 'signup').length, 1, '用户确认点击后才提交报名');
  reopened.onUnload();
  me.onUnload();
}

async function historyAndReadOnly() {
  const ended = record('past', { date: Date.now() - HOUR });
  const s = session({ member: { nickname: '会员', points: 500 }, history: [{ id: ended.id, event: ended, state: 'signed' }] });
  let failing = true;
  s.handlers.myEvents = () => { if (failing) throw new Error('offline'); return { records: s.options.history, nextCursor: null }; };
  const me = s.env.openPage('pages/me/index');
  await tick();
  ok(me.data.historyError && !me.data.historyLoaded, '历史请求失败显示错误而非无记录');
  failing = false;
  await me.onHistoryRetry();
  eq(me.data.myEvents[0].id, ended.id, '已结束活动保留在个人记录中');
  ok(me.data.myEvents[0].stateText.includes('已结束'), '历史记录标明活动已结束');
  s.handlers.event = () => ({ event: ended, readOnly: true });
  const detail = s.env.openPage('pages/event-detail/index', { id: ended.id });
  await tick();
  ok(detail.data.state.readOnly && !detail.data.state.canSignup, '已结束详情只读');
  detail.onSignup();
  eq(s.calls.filter((c) => c.action === 'signup').length, 0, '只读活动不能提交报名');
  detail.onUnload();
  me.onUnload();
}

async function pointsAndHomeRefresh() {
  const s = session({ member: { nickname: '会员', points: 500 }, past: [{ name: '原赛事', year: '2026', image: '', home: true }] });
  s.handlers.points = () => { throw new Error('offline'); };
  const points = s.env.openPage('pages/points/index');
  await tick();
  ok(points.data.loadError && !points.data.pointsLoaded, '积分读取失败显示错误');
  const html = s.env.renderHtml();
  ok(html.includes('暂时没能加载') && !html.includes(points.data.copy.empty), '积分读取失败不显示无记录');
  s.handlers.points = () => ({ member: Object.assign({}, s.options.member, { points: 700 }), logs: [] });
  await points.onRetry();
  eq(points.data.points, '700', '积分重试成功更新余额');
  points.onUnload();
  const home = s.env.openPage('pages/home/index');
  await tick();
  eq(home.data.raceCards[0].name, '原赛事', '首页加载云端赛事');
  const events = require(path.join(ROOT, 'utils/events.js'));
  events.setPast([{ name: '更新赛事', year: '2026', image: '', home: true }, { name: '隐藏赛事', year: '2026', image: '', home: false }]);
  eq(home.data.raceCards.map((r) => r.name), ['更新赛事'], '其他页面更新赛事时首页立即同步并保留首页筛选');
  s.options.past = [{ name: '返回后赛事', year: '2026', image: '', home: true }];
  home.onShow();
  await tick();
  eq(home.data.raceCards[0].name, '返回后赛事', '返回首页重新刷新云端赛事');
  home.onUnload();
}

async function historyReturnIgnoresOlderFlight() {
  const s = session({ member: { nickname: '会员', points: 500 } });
  let release;
  let count = 0;
  s.handlers.myEvents = () => {
    count += 1;
    if (count === 1) return new Promise((resolve) => { release = resolve; });
    return { records: [{ id: 'new', event: record('new'), state: 'signed' }], nextCursor: null };
  };
  const page = s.env.openPage('pages/me/index');
  await tick();
  page.onShow();
  await tick();
  eq(page.data.myEvents.map((r) => r.id), ['new'], '返回会员页会发起新的历史查询');
  release({ records: [{ id: 'old', event: record('old'), state: 'signed' }], nextCursor: 'old-page' });
  await tick();
  eq(page.data.myEvents.map((r) => r.id), ['new'], '旧历史响应不能覆盖返回后新记录');
  eq(page.data.historyNextCursor, null, '旧响应不能覆盖新分页游标');
  page.onUnload();
}

async function snapshotsAndBoundaries() {
  const s = session({ member: { nickname: '会员', points: 500 } });
  await tick();
  const fuel = require(path.join(ROOT, 'utils/fuel-plan.js'));
  const snapshot = fuel.snapshot({ sport: 'road', minutes: 240 });
  snapshot.result.gelCount = 1;
  snapshot.result.proCount = 2;
  // 注入本地已保存快照，不让测试依赖服务端公式版本。
  const s2 = session({ member: { nickname: '会员', points: 500 } });
  s2.handlers.savePlan = (data) => ({ plan: { input: data.input, result: data.result, formulaVersion: data.formulaVersion, savedAt: Date.now() } });
  await tick();
  await require(path.join(ROOT, 'utils/store.js')).savePlan(snapshot.input, snapshot.result, snapshot.formulaVersion);
  const me = s2.env.openPage('pages/me/index');
  ok(me.data.plan.line2.includes('1') && me.data.plan.line2.includes('2'), '会员卡使用保存的数量快照');
  const { eventState } = require(path.join(ROOT, 'utils/event-state.js'));
  const now = Date.now();
  eq(eventState(record('full', { quota: 1, signupCount: 1 }), {}, now).key, 'full', '满额状态可见');
  eq(eventState(record('closed', { signupEnd: now - 1 }), {}, now).key, 'closed', '截止状态可见');
  eq(eventState({ raw: record('closed', { signupEnd: now - 1 }), readOnly: true }, {}, now).key, 'closed', '已发布活动只读标志不会把截止误标为下架');
  eq(eventState(record('ended', { date: now }), {}, now).key, 'ended', '活动日期即缺省截止边界');
  eq(eventState(record('cancelled', { cancelled: true }), {}, now).key, 'cancelled', '取消状态可见');
  me.onUnload();
}

(async () => {
  await activityFailureAndRetry();
  await directDetailAndLoginReturn();
  await historyAndReadOnly();
  await pointsAndHomeRefresh();
  await historyReturnIgnoresOlderFlight();
  await snapshotsAndBoundaries();
  console.log('用户流程恢复测试通过：' + checks + ' 项');
})().catch((e) => { console.error(e); process.exitCode = 1; });
