/** 客户端数据层故障与并发回归。只用隔离的内存云端，不访问线上。 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../miniprogram');
const flush = () => new Promise((resolve) => setImmediate(resolve));
const copy = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
let assertions = 0;
function eq(actual, expected, label) {
  assert.deepStrictEqual(copy(actual), copy(expected), label);
  assertions += 1;
}
function ok(value, label) { assert.ok(value, label); assertions += 1; }

function harness(options) {
  options = options || {};
  const storage = Object.assign({}, options.storage);
  const requests = [];
  const modules = Object.create(null);
  let authorizations = 0;
  const wx = {
    getStorageSync: (key) => copy(storage[key]) || '',
    setStorageSync: (key, value) => { if (options.storageFails) throw new Error('quota'); storage[key] = copy(value); },
    removeStorageSync: (key) => { if (options.storageFails) throw new Error('quota'); delete storage[key]; },
    showToast() {},
    requestSubscribeMessage: (o) => { authorizations += 1; o.success({ template: 'accept' }); }
  };
  const cloud = {
    enabled: () => true,
    call: (action, data) => new Promise((resolve, reject) => { requests.push({ action, data, resolve, reject, done: false }); })
  };
  function load(relative) {
    const file = path.resolve(ROOT, relative);
    if (file === path.join(ROOT, 'utils/cloud.js')) return cloud;
    if (file === path.join(ROOT, 'config.js')) return { assetBase: 'https://assets.example', cloudEnv: 'test', sampleEvents: false, subscribeTemplateId: 'template' };
    if (modules[file]) return modules[file].exports;
    const module = { exports: {} };
    modules[file] = module;
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
      module, wx, Promise, Date, Math,
      require: (id) => load(path.relative(ROOT, path.resolve(path.dirname(file), id))),
      getApp: () => ({ globalData: {} })
    }, { filename: file });
    return module.exports;
  }
  function pending(action) {
    const request = requests.find((r) => r.action === action && !r.done);
    assert.ok(request, '存在待响应请求 ' + action);
    request.done = true;
    return request;
  }
  return { load, storage, requests, pending, authorizations: () => authorizations };
}
const member = (nickname, points) => ({ nickname, points, memberNo: 100001 });
const bootstrap = (m) => ({ member: m, plan: null, signups: [], reminders: [], news: false });
const event = (id) => ({ id, type: '赛事', title: '活动 ' + id, date: Date.now() + 86400000, status: 'published' });

async function storeTests() {
  {
    const h = harness({ storage: { sx_member: member('旧昵称', 500) }, storageFails: true });
    const store = h.load('utils/store.js');
    let changes = 0;
    store.onChange(() => { changes += 1; });
    const saved = store.setNickname('新昵称');
    h.pending('setNickname').resolve({ member: member('新昵称', 500) });
    await saved;
    eq(store.getMember().nickname, '新昵称', '持久化失败仍保留成功资料');
    eq(changes, 1, '成功写通知页面刷新');
    const synced = store.sync();
    h.pending('bootstrap').resolve(bootstrap(member('云端昵称', 600)));
    eq(await synced, true, '缓存失败不阻断同步');
    eq(store.getMember(), member('云端昵称', 600), '同步结果在内存可读');
  }
  {
    const h = harness({ storage: { sx_member: member('旧昵称', 500) } });
    const store = h.load('utils/store.js');
    const points = store.fetchPoints();
    const renamed = store.setNickname('新昵称');
    h.pending('setNickname').resolve({ member: member('新昵称', 500) });
    await renamed;
    h.pending('points').resolve({ member: member('旧昵称', 450), logs: [] });
    await points;
    eq(store.getMember(), member('新昵称', 450), '旧积分响应只更新积分，不倒退昵称');

    const rename2 = store.setNickname('第二个昵称');
    const signed = store.signup('race', 'template', 50);
    const signupRequest = h.pending('signup');
    eq(signupRequest.data.cost, 50, '保留用户确认过的报名积分');
    signupRequest.resolve({ member: member('新昵称', 400) });
    await signed;
    h.pending('setNickname').resolve({ member: member('第二个昵称', 450) });
    await rename2;
    eq(store.getMember(), member('第二个昵称', 400), '较早昵称写响应不覆盖较新扣分，较新扣分不覆盖昵称');
    eq(store.getSignups(), ['race'], '报名成功更新本地记录');
  }
  {
    const h = harness({ storage: { sx_member: member('旧昵称', 500) } });
    const store = h.load('utils/store.js');
    const oldRead = store.fetchPoints();
    const newRead = store.fetchPoints();
    const oldRequest = h.pending('points');
    const newRequest = h.pending('points');
    newRequest.resolve({ member: member('旧昵称', 700), logs: [] });
    await newRead;
    oldRequest.resolve({ member: member('旧昵称', 500), logs: [] });
    await oldRead;
    eq(store.getMember().points, 700, '同字段较早请求晚到不会倒退');
  }
  {
    const h = harness({ storage: { sx_member: member('旧昵称', 500) } });
    const store = h.load('utils/store.js');
    const sync = store.sync();
    const oldSnapshot = h.pending('bootstrap');
    const renamed = store.setNickname('新昵称');
    h.pending('setNickname').resolve({ member: member('新昵称', 500) });
    await renamed;
    oldSnapshot.resolve(bootstrap(member('旧昵称', 500)));
    await flush();
    eq(store.getMember().nickname, '新昵称', '写入期间的旧同步快照不能覆盖修改');
    h.pending('bootstrap').resolve(bootstrap(member('新昵称', 500)));
    eq(await sync, true, '同步丢弃旧快照后可以恢复');
  }
  {
    const h = harness({ storage: { sx_member: member('旧昵称', 500) } });
    const store = h.load('utils/store.js');
    const renamed = store.setNickname('新昵称');
    const sync = store.sync(0);
    h.pending('bootstrap').resolve(bootstrap(member('旧昵称', 500)));
    eq(await sync, false, '同步在写入开始后发起也不能提交不完整快照');
    h.pending('setNickname').resolve({ member: member('新昵称', 500) });
    await renamed;
    eq(store.getMember().nickname, '新昵称', '正在写入的操作完成后仍显示最新状态');
  }
  {
    const h = harness();
    const store = h.load('utils/store.js');
    const first = store.sync();
    const second = store.sync();
    const a = h.pending('bootstrap');
    const b = h.pending('bootstrap');
    b.resolve(bootstrap(member('新快照', 700)));
    await second;
    a.resolve(bootstrap(member('旧快照', 500)));
    eq(await first, false, '较早的整份同步响应被丢弃');
    eq(store.getMember().points, 700, '同步不会倒退会员积分');
    const result = { total: 2, gelCount: 1, proCount: 1, items: [{ minute: 30, product: 'gel' }], reasons: ['提醒'] };
    const saved = store.savePlan({ sport: 'road' }, result, 'formula-v2');
    const request = h.pending('savePlan');
    eq(request.data.formulaVersion, 'formula-v2', '上传公式版本');
    request.resolve({ plan: Object.assign({ savedAt: 1 }, request.data) });
    await saved;
    eq(store.getPlan().result, result, '保留完整计划快照，不降级为支数摘要');
  }
}

async function eventsTests() {
  {
    const h = harness();
    const events = h.load('utils/events.js');
    const first = events.refresh();
    eq(events.getLoadState('upcoming').status, 'loading', '首次请求有加载状态');
    h.pending('events').reject({ code: 'network' });
    eq(await first, false, '保留refresh布尔返回值兼容性');
    eq(events.getLoadState('upcoming').status, 'error', '首次失败不会伪装成空活动');
    eq(events.getLoadState('upcoming').hasData, false, '请求失败不算获得空结果');
    const retried = events.refresh();
    h.pending('events').resolve({ events: [] });
    await retried;
    eq(events.getLoadState('upcoming').status, 'empty', '重试成功的空列表单独可辨');
    eq(events.getLoadState('upcoming').hasData, true, '成功空列表属于有效响应');
  }
  {
    const h = harness({ storage: { sx_events: [event('cached')] }, storageFails: true });
    const events = h.load('utils/events.js');
    let changed = 0;
    events.onChange(() => { changed += 1; });
    eq(events.getLoadState('upcoming').stale, false, '缓存本身不应显示刷新失败');
    const failed = events.refresh();
    h.pending('events').reject({ code: 'network' });
    await failed;
    eq(events.getLoadState('upcoming').status, 'stale', '有缓存时失败标记为旧数据');
    eq(events.listUpcoming()[0].id, 'cached', '失败时保留旧列表');
    const recovered = events.refresh();
    h.pending('events').resolve({ events: [event('latest')] });
    await recovered;
    eq(events.listUpcoming()[0].id, 'latest', '缓存写失败仍显示新活动');
    ok(changed >= 4, '订阅者能看到加载、错误和恢复变化');

    const oldList = events.refresh();
    const oldRequest = h.pending('events');
    const forced = events.refresh(true);
    h.pending('events').resolve({ events: [event('after-edit')] });
    await forced;
    oldRequest.resolve({ events: [event('before-edit')] });
    await oldList;
    eq(events.listUpcoming()[0].id, 'after-edit', '运营变更后的强制刷新不被旧列表覆盖');
  }
  {
    const h = harness();
    const events = h.load('utils/events.js');
    const detail = events.fetchEvent('outside-first-50');
    eq(h.pending('event').data, { id: 'outside-first-50' }, '详情直接按ID请求');
    const detailRequest = h.requests[h.requests.length - 1];
    detailRequest.resolve({ event: event('outside-first-50'), readOnly: true });
    await detail;
    eq(events.getEvent('outside-first-50').readOnly, true, '公共列表以外的只读详情也能显示');
    const failed = events.fetchEvent('outside-first-50');
    h.pending('event').reject({ code: 'network' });
    await assert.rejects(failed);
    eq(events.getLoadState('detail', 'outside-first-50').status, 'stale', '详情失败保留旧内容并显示重试状态');
    const unavailable = events.fetchEvent('outside-first-50');
    h.pending('event').reject({ code: 'not_found' });
    eq(await unavailable, null, '失效链接与网络失败分开处理');
    eq(events.getEvent('outside-first-50'), null, '确认下架后清除旧详情');
    eq(events.getLoadState('detail', 'outside-first-50').status, 'empty', '活动失效显示不可用结果，不无限重试');

    const first = events.fetchMyEvents();
    h.pending('myEvents').resolve({ records: [{ id: 'old', event: event('old'), state: 'signed', createdAt: 1 }], nextCursor: 'page2' });
    eq((await first).nextCursor, 'page2', '个人活动保留分页游标');
    const second = events.fetchMyEvents('page2');
    h.pending('myEvents').resolve({ records: [{ id: 'deleted', event: null, state: 'signed', createdAt: 0 }], nextCursor: null });
    await second;
    eq(events.getMyEvents().map((r) => [r.id, r.event && r.event.id]), [['old', 'old'], ['deleted', null]], '历史独立于即将开始，已删活动的记录不丢失');

    const past = events.refreshPast();
    const oldPast = h.pending('pastEvents');
    events.setPast([{ name: '编辑后赛事' }]);
    oldPast.resolve({ past: [{ name: '编辑前赛事' }] });
    await past;
    eq(events.listPast()[0].name, '编辑后赛事', '后台保存结果不会被旧赛事读取覆盖');
  }
  {
    const h = harness();
    const events = h.load('utils/events.js');
    const first = events.remind('race');
    const request = h.pending('remind');
    const batchId = request.data.batchId;
    ok(batchId, '授权后登记携带批次');
    request.reject({ code: 'network' });
    eq(await first, false, '登记失败允许用户重试');
    const retried = events.remind('race');
    const retryRequest = h.pending('remind');
    eq(retryRequest.data.batchId, batchId, '响应丢失后的重试复用同一次授权批次');
    eq(h.authorizations(), 1, '重试登记不重复消耗订阅授权');
    retryRequest.resolve({ eventId: 'race' });
    eq(await retried, true, '批次登记重试成功');
    eq(events.hasReminder('race'), true, '成功登记同步更新提醒状态');

    const news = events.subscribeNews();
    const newsRequest = h.pending('subscribeNews');
    const newsBatch = newsRequest.data.batchId;
    newsRequest.reject({ code: 'network' });
    await news;
    const newsRetry = events.subscribeNews();
    const newsRetried = h.pending('subscribeNews');
    eq(newsRetried.data.batchId, newsBatch, '新活动通知也复用授权批次');
    newsRetried.resolve({ news: false });
    eq(await newsRetry, false, '重试时授权已经消费，不伪装成已订阅');
    eq(events.hasNews(), false, '已消费的新活动授权不会重新显示已订阅');

    const consumed = events.remind('another');
    h.pending('remind').reject({ code: 'network' });
    await consumed;
    const consumedRetry = events.remind('another');
    h.pending('remind').resolve({ eventId: 'another', reminded: false });
    eq(await consumedRetry, false, '提醒登记响应丢失后已发送，重试返回真实状态');
    eq(events.hasReminder('another'), false, '已发送提醒不会重新加入未发送缓存');
  }
}

async function appTests() {
  function loadApp(results) {
    let app;
    let syncs = 0;
    const store = {
      sync: () => { syncs += 1; return Promise.resolve(results.shift()); },
      takeInbox: () => [], unseenNotice: () => null
    };
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8'), {
      App: (value) => { app = value; }, Promise, Date,
      wx: { getWindowInfo: () => ({ statusBarHeight: 24 }) },
      require: (id) => {
        if (id === './utils/store.js') return store;
        if (id === './utils/fonts.js') return { loadFonts() {} };
        return require(path.join(ROOT, id));
      }
    });
    return { app, syncs: () => syncs };
  }
  const h = loadApp([false, true]);
  const first = h.app.refresh();
  eq(h.app.refresh() === first, true, '应用启动和前台回调共享在途同步');
  await first;
  eq(h.app.lastSync, undefined, '失败同步不开始五分钟成功缓存计时');
  h.app.onShow();
  await flush();
  eq(h.syncs(), 2, '重新进入前台可立即重试失败同步');
  ok(h.app.lastSync > 0, '成功同步后记录更新时间');
  h.app.onShow();
  eq(h.syncs(), 2, '成功后继续保留五分钟节流');
  const single = loadApp([]);
  single.app.onLaunch({ scene: 1154 });
  single.app.onShow();
  eq(single.syncs(), 0, '朋友圈单页模式不初始化云端同步');
}

(async () => {
  await storeTests();
  await eventsTests();
  await appTests();
  console.log('客户端故障与并发回归通过（' + assertions + ' 项）');
})().catch((error) => { console.error(error); process.exitCode = 1; });
