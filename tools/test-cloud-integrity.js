/** 数据完整性回归：真实事务边界、重试、历史鉴权和订阅批次。只运行内存替身，不访问云环境。 */
const assert = require('assert');
const { createCloud } = require('./cloud-mock');
const fuel = require('../miniprogram/utils/fuel-plan');
const DAY = 86400000;
const originalError = console.error;
console.error = () => {};
const watchdog = setTimeout(() => { console.error = originalError; console.error('云端完整性测试未完成，可能存在悬挂的 Promise'); process.exit(1); }, 30000);
let checks = 0;
const eq = (a, b) => { assert.deepStrictEqual(a, b); checks++; };
function setup() {
  const cloud = createCloud();
  cloud.state.data.members = [
    { _id: 'user-a', openid: 'user-a', memberNo: '100001', admin: true, points: 500, welcomeBonus: true, numbered: true, ledgerVersion: 1 },
    { _id: 'user-b', openid: 'user-b', memberNo: '100002', points: 500, welcomeBonus: true, numbered: true, ledgerVersion: 1 }
  ];
  cloud.state.data.events = [{ _id: 'e', type: '赛事', title: '活动', status: 'published', date: new Date(cloud.state.now + DAY), signupStart: new Date(cloud.state.now - DAY), version: 1, signupCount: 0, quota: 2 }];
  const api = cloud.load('api');
  const call = (action, data = {}, who = 'user-a') => cloud.run(() => {
    cloud.state.openid = who;
    return api.main(Object.assign({ action }, data));
  });
  return { cloud, call };
}

async function ledgerTests() {
  const { cloud: c, call } = setup();
  const request = { memberNo: '100002', delta: 100, reason: '活动奖励', operationId: 'points-operation-1' };
  c.state.txFails = 'after';
  eq((await call('adminAdjustPoints', request)).ok, true);
  eq((await call('adminAdjustPoints', request)).data.member.points, 600);
  eq(c.col('point_logs').filter((l) => l.reason === request.reason).length, 1);
  eq((await call('adminAdjustPoints', Object.assign({}, request, { delta: 200 }))).code, 'operation_conflict');
  eq(c.col('members').find((m) => m._id === 'user-b').points, 600);
  c.state.beforeCommit = () => { c.state.beforeCommit = null; throw new Error('connection lost before commit'); };
  eq((await call('adminAdjustPoints', Object.assign({}, request, { operationId: 'points-operation-2' }))).code, 'server_error');
  eq(c.col('members').find((m) => m._id === 'user-b').points, 600);
  eq(c.col('point_logs').length, 1);
  eq((await call('adminAdjustPoints', Object.assign({}, request, { operationId: 'points-operation-3', delta: -700 }))).code, 'insufficient');
  const results = await Promise.all([call('adminAdjustPoints', Object.assign({}, request, { operationId: 'points-concurrent' })), call('adminAdjustPoints', Object.assign({}, request, { operationId: 'points-concurrent' }))]);
  eq(results.every((r) => r.ok), true);
  eq(c.col('members').find((m) => m._id === 'user-b').points, 700);
  c.state.getError = (name) => name === 'point_logs';
  eq((await call('points', {}, 'user-b')).code, 'server_error');
  c.state.getError = null;

  const fresh = createCloud(); fresh.state.phones.code = '13800001234';
  const api = fresh.load('api'); const register = () => fresh.run(() => api.main({ action: 'register', code: 'code' }));
  fresh.state.txFails = 'before';
  eq((await register()).code, 'server_error');
  eq(fresh.col('members')[0].points, 0);
  eq(fresh.col('point_logs').length, 0);
  eq((await register()).data.member.points, 500);
  eq((await register()).data.member.points, 500);
  eq(fresh.col('point_logs').length, 1);
  // 旧版余额已到账、流水丢失：补流水而不重复送余额。
  fresh.col('members').push({ _id: 'legacy', points: 500, welcomeBonus: true, memberNo: '100099', numbered: true });
  fresh.state.openid = 'legacy';
  eq((await fresh.run(() => api.main({ action: 'bootstrap' }))).data.member.points, 500);
  eq(fresh.col('point_logs').filter((l) => l.openid === 'legacy').length, 1);
}

async function transactionIsolationTests() {
  const { cloud: c } = setup(); const db = c.sdk.database();
  let release, entered;
  const paused = new Promise((r) => { entered = r; });
  const gate = new Promise((r) => { release = r; });
  let first = true;
  const pending = db.runTransaction(async (t) => {
    const me = (await t.collection('members').doc('user-b').get()).data;
    await t.collection('members').doc('user-b').update({ data: { points: me.points + 10 } });
    if (first) { first = false; entered(); await gate; }
  });
  await paused;
  eq(c.col('members').find((m) => m._id === 'user-b').points, 500); // 未提交修改不可见
  await db.collection('members').where({ _id: 'user-b' }).update({ data: { points: db.command.inc(5) } });
  release(); await pending;
  eq(c.col('members').find((m) => m._id === 'user-b').points, 515); // 冲突重跑而不是抹掉外部写入
  await assert.rejects(db.runTransaction(async (t) => {
    await t.collection('members').doc('user-b').update({ data: { points: 0 } });
    throw new Error('rollback');
  })); checks++;
  eq(c.col('members').find((m) => m._id === 'user-b').points, 515);
  // 调度钩子可先等待另一个独立请求完成；替身不能用全局队列制造现实中不存在的相互等待。
  c.state.beforeTx = async () => {
    c.state.beforeTx = null;
    await db.runTransaction(async (t) => t.collection('members').doc('user-b').update({ data: { points: db.command.inc(1) } }));
  };
  await db.runTransaction(async (t) => t.collection('members').doc('user-b').update({ data: { points: db.command.inc(1) } }));
  eq(c.col('members').find((m) => m._id === 'user-b').points, 517);
}

async function eventTests() {
  const { cloud: c, call } = setup();
  c.col('events')[0].date = new Date(c.state.now - 1);
  eq((await call('signup', { eventId: 'e' })).code, 'closed');
  c.col('events')[0].date = new Date(c.state.now + DAY);
  c.state.beforeTx = () => { c.state.beforeTx = null; c.col('events')[0].signupStart = new Date(c.state.now + 10000); };
  eq((await call('signup', { eventId: 'e' })).code, 'not_open');
  c.col('events')[0].signupStart = new Date(c.state.now - DAY);
  c.state.beforeTxRead = (name) => {
    if (name !== 'events') return;
    c.state.beforeTxRead = null;
    c.col('events')[0].status = 'draft';
  };
  eq((await call('signup', { eventId: 'e' })).code, 'not_found');
  eq(c.col('events')[0].signupCount, 0);
  c.col('events')[0].status = 'published';
  eq((await call('signup', { eventId: 'e' })).ok, true);
  const form = { type: '赛事', title: '活动改名', date: c.state.now + DAY, status: 'draft' };
  eq((await call('adminSaveEvent', { id: 'e', version: 1, event: form })).data.event.version, 2);
  eq((await call('adminSaveEvent', { id: 'e', version: 1, event: form })).code, 'conflict');
  eq((await call('event', { id: 'e' })).data.readOnly, true);
  eq((await call('event', { id: 'e' }, 'user-b')).code, 'not_found');
  const history = await call('myEvents');
  eq(history.data.records.map((r) => [r.id, r.state, r.event.title]), [['e', 'signed', '活动改名']]);
  c.col('events').push({ _id: 'reminder-only', status: 'draft', title: '仅我提醒的历史', date: new Date(c.state.now - DAY) });
  c.col('reminders').push({ _id: 'user-a_reminder-only', openid: 'user-a', eventId: 'reminder-only', sent: true, createdAt: new Date(c.state.now) });
  eq((await call('event', { id: 'reminder-only' })).ok, true);
  eq((await call('event', { id: 'reminder-only' }, 'user-b')).code, 'not_found');
  eq((await call('myEvents')).data.records.map((r) => r.state), ['signed', 'reminded']);
  eq((await call('adminSignups', { id: 'e' }, 'user-b')).code, 'forbidden');
  await call('adminCancelEvent', { id: 'e' });
  eq((await call('event', { id: 'e' })).code, 'not_found'); // 报名已撤销，非公开详情不再可读
  eq((await call('adminSaveEvent', { id: 'e', version: 2, event: form })).code, 'conflict');
  // 用提醒保留本人历史入口，不改变取消/退款行为。
  c.col('reminders').push({ _id: 'user-a_e', openid: 'user-a', eventId: 'e', sent: true });
  for (let i = 0; i < 110; i++) c.col('signups').push({ _id: 'user-a_many-' + i, openid: 'user-a', eventId: 'many-' + i, createdAt: new Date(c.state.now + i) });
  const page = (await call('myEvents')).data;
  eq(page.records.length, 100);
  eq(page.nextCursor, 's:100');
  eq((await call('myEvents', { cursor: page.nextCursor })).data.records.length, 12);
}

async function reminderTests() {
  const { cloud: c, call } = setup();
  const request = { eventId: 'e', templateId: 'tmpl', batchId: 'reminder-batch-1' };
  eq((await call('remind', request)).data.reminded, true);
  const remind = c.load('remind');
  const originalSend = c.sdk.openapi.subscribeMessage.send;
  let entered, release;
  const paused = new Promise((r) => { entered = r; }); const gate = new Promise((r) => { release = r; });
  c.sdk.openapi.subscribeMessage.send = async (data) => { entered(); await gate; return originalSend(data); };
  await c.run(async () => {
    const first = remind.main(); await paused;
    eq((await call('remind', request)).data.reminded, false);
    await remind.main(); release(); await first;
  });
  eq(c.state.sent.length, 1);
  eq((await call('remind', request)).data.reminded, false);
  eq(c.col('reminders')[0].sent, true);
  c.sdk.openapi.subscribeMessage.send = originalSend;
  await call('subscribeNews', { templateId: 'tmpl', batchId: 'news-batch-0001' });
  c.col('news_subs')[0].sent = true; c.col('news_subs')[0].status = 'sent';
  eq((await call('subscribeNews', { templateId: 'tmpl', batchId: 'news-batch-0001' })).data.news, false);
  eq((await call('subscribeNews', { templateId: 'tmpl', batchId: 'news-batch-0002' })).data.news, true);
  eq((await call('subscribeNews', { templateId: 'tmpl', batchId: 'news-batch-0001' })).data.news, true);
  eq(c.col('news_subs')[0].batchId, 'news-batch-0002');
  // 旧数据无批次仍会被发送一次；时间预算耗尽后下一条保持待处理。
  c.state.data.reminders = [0, 1, 2].map((i) => ({ _id: 'legacy-' + i, openid: 'legacy-' + i, eventId: 'e', templateId: 'tmpl', sent: false }));
  c.sdk.openapi.subscribeMessage.send = async (data) => { c.state.now += 46000; return originalSend(data); };
  const result = await c.run(() => remind.main());
  eq(result.sent, 1);
  eq(c.col('reminders').filter((r) => !r.sent).length, 2);
  // 新闻发送同样服从执行时间预算。
  c.state.data.reminders = [];
  const ev = c.col('events')[0]; Object.assign(ev, { notifyId: 'job', notifyStatus: 'pending', notifyTotal: 2 });
  c.state.data.news_subs = [0, 1].map((i) => ({ _id: 'news-' + i, openid: 'news-' + i, job: 'job', eventId: 'e', templateId: 'tmpl', sent: false }));
  eq((await c.run(() => remind.main())).newsSent, 1);
  eq(c.col('news_subs').filter((s) => !s.sent).length, 1);
}

async function planTests() {
  const { call } = setup();
  const snapshot = fuel.snapshot({ sport: 'trail', minutes: 2880 });
  const saved = await call('savePlan', snapshot);
  eq(saved.ok, true);
  eq(saved.data.plan.result, snapshot.result);
  eq((await call('bootstrap')).data.plan.formulaVersion, snapshot.formulaVersion);
  eq((await call('savePlan', Object.assign({}, snapshot, { input: Object.assign({}, snapshot.input, { minutes: Infinity }) }))).code, 'bad_input');
  eq((await call('savePlan', Object.assign({}, snapshot, { input: Object.assign({}, snapshot.input, { sport: 'invented' }) }))).code, 'bad_input');
  eq((await call('savePlan', Object.assign({}, snapshot, { result: Object.assign({}, snapshot.result, { total: -1 }) }))).code, 'bad_input');
  eq((await call('savePlan', { input: snapshot.input, result: { total: 2, gelCount: 1, proCount: 1 } })).ok, true);
  eq('formulaVersion' in (await call('bootstrap')).data.plan, false);
}

(async () => {
  await ledgerTests(); await transactionIsolationTests(); await eventTests(); await reminderTests(); await planTests();
  console.error = originalError;
  clearTimeout(watchdog);
  console.log('云端数据完整性检查通过 ' + checks + ' 项');
})().catch((error) => { clearTimeout(watchdog); console.error = originalError; console.error(error); process.exitCode = 1; });
