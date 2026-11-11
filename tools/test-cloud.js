/**
 * 云开发部分的测试。运行：node tools/test-cloud.js
 * 用 tools/cloud-mock.js 的内存替身代替 wx-server-sdk：
 *   第一部分直接调云函数，检查业务规则；
 *   第二部分把小程序端（预览工具的运行环境）接到替身上，走一遍「保存 → 注册 → 提醒 → 报名」。
 * 替身不能代替真实的云开发环境，真实的手机号换取和订阅消息发送要在开发者工具里验证。
 */
const assert = require('assert');
const { createCloud } = require('./cloud-mock.js');

// 云函数在预期内的失败路径上会打错误日志，测试里不需要看
console.error = () => {};

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
let n = 0;
const ok = (cond, name) => { assert.ok(cond, name); n += 1; };
const eq = (a, b, name) => { assert.deepStrictEqual(a, b, name); n += 1; };

function seed(cloud) {
  const now = cloud.state.now;
  cloud.state.phones = { 'code-a': '13800001234', 'code-b': '13900005678' };
  cloud.state.data.events = [
    { _id: 'race', type: '赛事', title: '春季路跑', status: 'published', date: new Date(now + 30 * DAY), city: '上海', venue: '滨江', quota: 1,
      signupStart: new Date(now + 2 * DAY), signupEnd: new Date(now + 10 * DAY), memberSignupStart: new Date(now + 1 * DAY), intro: '介绍' },
    { _id: 'trial', type: '试用装', title: '试用装申领', status: 'published', date: new Date(now + 5 * DAY), signupStart: new Date(now - DAY), signupEnd: new Date(now + 3 * DAY) },
    { _id: 'draft', type: '抽奖', title: '草稿', status: 'draft', date: new Date(now + 5 * DAY) },
    { _id: 'old', type: '赛事', title: '过期', status: 'published', date: new Date(now - 10 * DAY) }
  ];
}

async function functionTests() {
  const cloud = createCloud();
  seed(cloud);
  const api = cloud.load('api');
  const remind = cloud.load('remind');
  const call = (action, data) => cloud.run(() => api.main(Object.assign({ action: action }, data)));
  const input = { sport: 'road', scene: 'race', start: 'am', minutes: 240, kg: 65, caffeineSensitive: false, hot: false, firstTime: false };

  eq(await call('nope'), { ok: false, code: 'unknown_action' }, '未知接口');

  let r = await call('bootstrap');
  eq(r.data, { member: null, plan: null, reminders: [], signups: [] }, '新用户');

  eq((await call('savePlan', { input: input })).code, 'not_member', '未注册不能保存计划');
  eq((await call('points')).code, 'not_member', '未注册不能看积分');
  eq((await call('signup', { eventId: 'trial' })).code, 'not_member', '未注册不能报名');
  eq((await call('register', {})).code, 'missing_code', '注册缺 code');
  eq((await call('register', { code: 'bad' })).code, 'phone_failed', '换不到手机号');

  r = await call('register', { code: 'code-a' });
  eq(r.data.member.phoneMasked, '138****1234', '手机号打码');
  eq(r.data.member.memberNo, '100001', '第一位会员的编号是 100001');
  eq(cloud.col('members')[0].memberNo, '100001', '编号存进会员记录');
  eq(cloud.col('counters')[0].next, 100002, '计数集合自动建好，记着下一个号');
  eq(r.data.member.points, 500, '注册送 500 积分');
  eq(r.data.isNew, true, '第一次注册是新会员');
  eq(r.data.member.nickname, '', '昵称一开始是空的');
  ok(!JSON.stringify(r.data).includes('13800001234'), '不把完整手机号返回给小程序端');
  eq(cloud.col('members')[0].phone, '13800001234', '库里存完整手机号');
  r = await call('register', { code: 'whatever' });
  eq(r.data.member.phoneMasked, '138****1234', '重复注册返回已有会员');
  eq(cloud.col('members').length, 1, '不重复建会员');
  eq(r.data.member.memberNo, '100001', '重复注册不换编号');
  eq(r.data.member.points, 500, '重复注册不重复送积分');
  eq(r.data.isNew, false, '已经是会员的再登录不算新会员');

  // 积分页：当前积分和积分记录
  r = await call('points');
  eq(r.data.member.points, 500, '积分页返回当前积分');
  eq(r.data.logs.map((l) => [l.delta, l.reason]), [[500, 'welcome']], '注册赠送记了一条积分记录');
  eq(typeof r.data.logs[0].at, 'number', '记录的时间是时间戳');
  eq(cloud.col('point_logs').length, 1, '积分记录的集合自动建好');
  // 手动加的记录（运营在控制台里加的）排在前面，原因原样返回
  cloud.col('point_logs').push({ _id: 'manual-1', openid: 'user-a', delta: -100, reason: '兑换试用装', createdAt: new Date(cloud.state.now + 1000) });
  r = await call('points');
  eq(r.data.logs.map((l) => l.reason), ['兑换试用装', 'welcome'], '新的记录在前');
  cloud.col('point_logs').splice(cloud.col('point_logs').findIndex((d) => d._id === 'manual-1'), 1);

  // 编号规则定下来之前注册的会员没有编号：下次进入时补发，按取号先后往下排
  cloud.col('members').push({ _id: 'user-old', openid: 'user-old', phone: '13900005678', memberNo: null, points: 0, createdAt: new Date(cloud.state.now) });
  cloud.state.openid = 'user-old';
  r = await call('bootstrap');
  eq(r.data.member.memberNo, '100002', '老会员进入时补发编号');
  eq(r.data.member.points, 500, '老会员补送注册积分');
  eq((await call('points')).data.logs.map((l) => l.reason), ['welcome'], '补送的也记了积分记录');
  r = await call('bootstrap');
  eq(r.data.member.memberNo, '100002', '补发过的不再换号');

  // 同一个老会员的两个请求同时进来：两边拿到同一个编号，和库里存的一致，积分只送一次
  cloud.col('members').push({ _id: 'user-twice', openid: 'user-twice', phone: '13900009999', memberNo: null, points: 0, createdAt: new Date(cloud.state.now) });
  cloud.state.openid = 'user-twice';
  const both = await Promise.all([call('bootstrap'), call('bootstrap')]);
  const kept = cloud.col('members').find((d) => d._id === 'user-twice');
  eq(both.map((x) => x.data.member.memberNo), [kept.memberNo, kept.memberNo], '同时进来的两个请求拿到同一个编号');
  ok(/^\d{6}$/.test(kept.memberNo), '编号已经发下来');
  eq(both.map((x) => x.data.member.points), [500, 500], '同时进来也只送一次积分');
  cloud.col('members').splice(cloud.col('members').findIndex((d) => d._id === 'user-twice'), 1);
  cloud.state.openid = 'user-old';
  eq(r.data.member.points, 500, '补送过的不再送');

  eq((await call('setNickname', { nickname: '   ' })).code, 'bad_nickname', '昵称不能为空');
  r = await call('setNickname', { nickname: '  跑\n者小王  ' });
  eq(r.data.member.nickname, '跑者小王', '昵称去掉换行和首尾空格');
  r = await call('setNickname', { nickname: '一二三四五六七八九十一二三四五六七八九十多出来的' });
  eq(Array.from(r.data.member.nickname).length, 20, '昵称最多 20 个字');
  eq((await call('bootstrap')).data.member.nickname, r.data.member.nickname, '昵称存进会员记录');
  cloud.col('members').splice(cloud.col('members').findIndex((d) => d._id === 'user-old'), 1);
  cloud.state.openid = 'user-a';

  eq((await call('savePlan', { input: { sport: 'road' } })).code, 'bad_input', '计划输入不完整');
  r = await call('savePlan', { input: Object.assign({ extra: 'x' }, input), result: { total: 9, gelCount: 4, proCount: 5 } });
  eq(r.data.plan.input, input, '只保存公式的八项输入');
  await call('savePlan', { input: Object.assign({}, input, { kg: 70 }), result: { total: 9, gelCount: 4, proCount: 5 } });
  eq(cloud.col('plans').length, 1, '只保留最近一份计划');
  eq(cloud.col('plans')[0].input.kg, 70, '后一次覆盖前一次');
  r = await call('savePlan', { input: Object.assign({}, input, { weather: 'rain' }), result: { total: 9, gelCount: 4, proCount: 5 } });
  eq(r.data.plan.input.weather, 'rain', '计划里带上天气');

  r = await call('events');
  eq(r.data.events.map((e) => e.id), ['trial', 'race'], '只返回已发布、未过期的活动，按日期排序');
  eq(typeof r.data.events[0].date, 'number', '时间转成时间戳');

  eq((await call('remind', { eventId: 'draft', templateId: 't' })).code, 'not_found', '未发布的活动不能设提醒');
  eq((await call('remind', { eventId: 'race' })).code, 'missing_template', '提醒要带模板');
  await call('remind', { eventId: 'race', templateId: 'tmpl' });
  await call('remind', { eventId: 'race', templateId: 'tmpl' });
  eq(cloud.col('reminders').length, 1, '同一场活动重复点只登记一条');

  eq((await call('signup', { eventId: 'race' })).code, 'not_open', '会员报名还没开放');
  eq(await cloud.run(() => remind.main()), { sent: 0, failed: 0 }, '没开放不发提醒');

  cloud.state.now += 1 * DAY + HOUR; // 会员报名开放
  eq(await cloud.run(() => remind.main()), { sent: 1, failed: 0 }, '开放后发提醒');
  eq(cloud.state.sent[0].touser, 'user-a', '发给设了提醒的人');
  eq(cloud.state.sent[0].templateId, 'tmpl', '用登记时的模板');
  eq(cloud.state.sent[0].page, 'pages/event-detail/index?id=race', '点消息进活动详情');
  const msg = cloud.state.sent[0].data;
  eq(Object.keys(msg).sort(), ['thing1', 'thing4', 'thing8', 'time3', 'time7'], '消息带齐模板的五个字段');
  eq(msg.thing1.value, '春季路跑', '活动名称');
  eq(msg.thing4.value, '报名已开放', '温馨提示');
  eq(msg.thing8.value, '上海 滨江', '活动地点');
  const timeRe = /^\d{4}年\d{1,2}月\d{1,2}日 \d{2}:\d{2}$/;
  ok(timeRe.test(msg.time7.value) && timeRe.test(msg.time3.value) && msg.time7.value !== msg.time3.value, '开始时间和截止时间');
  ok(Object.keys(msg).every((k) => msg[k].value && msg[k].value.length <= 20), '每个字段都有值且不超长');
  eq(await cloud.run(() => remind.main()), { sent: 0, failed: 0 }, '不重复发');
  eq((await call('bootstrap')).data.reminders, [], '发过的提醒不再算「已设提醒」');

  r = await call('signup', { eventId: 'race' });
  eq(r.data, { eventId: 'race', already: false }, '报名成功');
  eq((await call('signup', { eventId: 'race' })).data.already, true, '重复报名不重复登记');
  eq(cloud.col('events').find((e) => e._id === 'race').signupCount, 1, '名额只占一次');

  cloud.state.openid = 'user-b';
  await call('register', { code: 'code-b' });
  eq((await call('signup', { eventId: 'race' })).code, 'full', '名额满了');
  eq((await call('signup', { eventId: 'trial' })).data.already, false, '没有名额限制的活动可以报');
  eq((await call('bootstrap')).data.signups, ['trial'], '各人只看到自己的报名');

  // 发送失败：记下原因，不重试
  await call('remind', { eventId: 'trial', templateId: 'tmpl' });
  cloud.state.sendError = 43101;
  eq(await cloud.run(() => remind.main()), { sent: 0, failed: 1 }, '发送失败');
  ok(cloud.col('reminders').find((x) => x._id === 'user-b_trial').sent === true, '失败的也标记，不重试');
  cloud.state.sendError = null;

  eq(cloud.col('reminders').find((x) => x._id === 'user-b_trial').status, 'failed', '失败的记成 failed');
  cloud.state.sendError = null;

  cloud.state.now += 20 * DAY;
  cloud.state.openid = 'user-a';
  eq((await call('signup', { eventId: 'trial' })).code, 'closed', '报名已结束');
}

/** 报名写入的两种异常：没写进去，和写进去了但响应丢了 */
async function signupFailureTests() {
  const cloud = createCloud();
  seed(cloud);
  cloud.state.now += DAY + HOUR;
  const api = cloud.load('api');
  const call = (action, data) => cloud.run(() => api.main(Object.assign({ action: action }, data)));
  const count = () => cloud.col('events').find((e) => e._id === 'race').signupCount;
  await call('register', { code: 'code-a' });

  cloud.state.addFails = 'before';
  eq((await call('signup', { eventId: 'race' })).code, 'server_error', '报名记录没写进去时报错');
  eq(count(), 0, '没写进去：占的名额退回');
  eq(cloud.col('signups').length, 0, '没有留下报名记录');

  cloud.state.addFails = 'after';
  eq((await call('signup', { eventId: 'race' })).data, { eventId: 'race', already: false }, '写进去了但响应丢失：按成功处理');
  eq(count(), 1, '响应丢失时不退名额');

  cloud.state.openid = 'user-b';
  await call('register', { code: 'code-b' });
  eq((await call('signup', { eventId: 'race' })).code, 'full', '名额没有被多放出去');
  eq(cloud.col('signups').length, 1, '只有一条报名记录');
}

/** 定时提醒：两次执行重叠不重复发；活动很多时不漏 */
async function remindTests() {
  const cloud = createCloud();
  const now = cloud.state.now;
  // 150 场已经开放报名的活动，只有最后一场有人设了提醒；再加一批过期但没撤下的活动
  const events = [];
  for (let i = 0; i < 120; i++) events.push({ _id: 'old' + i, type: '赛事', title: '往期' + i, status: 'published', date: new Date(now - (400 - i) * DAY), signupStart: new Date(now - 500 * DAY) });
  for (let i = 0; i < 150; i++) events.push({ _id: 'e' + i, type: '赛事', title: '活动' + i, status: 'published', date: new Date(now + (i + 2) * DAY), signupStart: new Date(now - HOUR) });
  cloud.state.data.events = events;
  cloud.state.data.reminders = [
    { _id: 'u1_e149', openid: 'u1', eventId: 'e149', templateId: 'tmpl', sent: false },
    { _id: 'u2_e149', openid: 'u2', eventId: 'e149', templateId: 'tmpl', sent: false },
    { _id: 'u1_old5', openid: 'u1', eventId: 'old5', templateId: 'tmpl', sent: false }
  ];
  const remind = cloud.load('remind');
  const results = await cloud.run(() => Promise.all([remind.main(), remind.main()]));
  eq(results[0].sent + results[1].sent, 2, '两次执行重叠：每条提醒只发一次');
  eq(cloud.state.sent.map((m) => m.touser).sort(), ['u1', 'u2'], '排在 100 场以后的活动也检查到了');
  const bare = cloud.state.sent[0].data; // 这些活动没填地点和报名截止时间
  ok(bare.thing8.value === '详见活动详情' && bare.time3.value === bare.time7.value, '没填地点、截止时间时用兜底值，字段不为空');
  eq(cloud.col('reminders').filter((r) => r.status === 'sent').length, 2, '发完记成 sent');
  ok(cloud.col('reminders').find((r) => r._id === 'u1_old5').sent === false, '活动日期已过的不发');
}

async function clientTests() {
  const path = require('path');
  const { createEnv, ROOT } = require('./preview/runtime.js');
  const cloud = createCloud();
  seed(cloud);
  const api = cloud.load('api');
  const wxCloud = {
    inited: null,
    init(o) { wxCloud.inited = o.env; },
    callFunction(o) { return cloud.run(() => api.main(o.data)).then((result) => ({ result: result })); }
  };
  const env = createEnv({ wx: { cloud: wxCloud } });
  const config = require(path.join(ROOT, 'config.js'));
  Object.assign(config, { cloudEnv: 'test-env', subscribeTemplateId: 'tmpl', sampleEvents: false });
  const tick = () => new Promise((r) => setTimeout(r, 20));
  const lastCall = (api) => env.wx.__calls.filter((c) => c.api === api).slice(-1)[0];

  const app = env.launch();
  await tick();
  eq(wxCloud.inited, 'test-env', '启动时初始化云环境');

  // 未注册：计算页点保存 → 记下输入 → 去注册
  let p = env.openPage('pages/fuel/index', {});
  p.onPick({ currentTarget: { dataset: { field: 'sport', index: 1 } } });
  p.onSave();
  await tick();
  eq(lastCall('switchTab').args.url, '/pages/me/index', '未注册保存跳到注册');

  // 注册页：没勾协议时是普通按钮，勾了以后是手机号按钮
  p = env.openPage('pages/me/index', {});
  ok(p.data.cloudMode && !p.data.registered, '云开发模式的注册页');
  let html = env.renderHtml();
  ok(!html.includes('<wx-button'), '未勾选协议时没有手机号按钮');
  p.onRegister();
  eq(lastCall('showToast').args.title, '请先阅读并同意用户协议和隐私政策', '未勾选就点注册：提示先勾选');
  ok(!p.data.registered, '未勾选不注册');
  p.onAgree({});
  html = env.renderHtml();
  ok(html.includes('<wx-button'), '勾选后是手机号按钮');
  p.onPhone({ detail: { errMsg: 'getPhoneNumber:fail user deny' } });
  await tick();
  ok(!p.data.registered, '用户拒绝授权时不注册');
  p.onPhone({ detail: { code: 'code-a' } });
  await tick();
  ok(p.data.registered, '注册成功切到会员状态');
  eq(p.data.profile.phone, '138****1234', '显示打码手机号');
  eq(p.data.profile.points, '500', '显示积分');
  ok(/^会员编号 \d{6}$/.test(p.data.profile.memberNo), '显示会员编号');
  eq(p.data.profile.nickname, 'SPORTSIX 会员', '没填昵称时的显示');
  ok(!JSON.stringify(p.data.profile).includes('['), '会员信息里没有方括号占位');

  // 转发：会员页有个人信息，注册以后把「转发」收起来
  eq(p.onShareAppMessage(), { path: '/pages/me/index' }, '注册页转发出去的是注册页');
  ok(lastCall('hideShareMenu'), '注册以后会员页收起转发');

  // 改昵称：等微信的昵称检测结果，通过才保存
  p.onNameEdit();
  ok(p.data.nameEditing, '点名字打开改昵称的弹层');
  p.onNameReview({ detail: { pass: false, timeout: false } });
  p.onNameSubmit({ detail: { value: { nickname: '不合适的昵称' } } });
  await tick();
  eq(p.data.profile.nickname, 'SPORTSIX 会员', '没通过检测的昵称不保存');
  ok(p.data.nameEditing, '没通过时弹层留着，可以换一个');
  p.onNameInput();
  p.onNameSubmit({ detail: { value: { nickname: ' 跑者小王 ' } } });
  p.onNameReview({ detail: { pass: true, timeout: false } });
  await tick();
  eq(p.data.profile.nickname, '跑者小王', '通过检测后保存并显示新昵称');
  ok(!p.data.nameEditing, '保存后关闭弹层');
  eq(cloud.col('members').find((d) => d._id === cloud.state.openid).nickname, '跑者小王', '昵称存到云端');
  eq(cloud.col('plans')[0].input.sport, 'trail', '注册后把待保存的计划存到云端');
  eq(lastCall('switchTab').args.url, '/pages/fuel/index', '回到计算页');
  ok(app.globalData.fuelRestore, '计算页按保存的输入还原');

  // 活动列表：来自云端
  p = env.openPage('pages/events/index', {});
  await tick();
  eq(p.data.upcoming.map((e) => e.id), ['trial', 'race'], '活动来自云数据库');
  const race = p.data.upcoming[1];
  ok(race.style === 'poster' && race.title === '春季路跑' && race.meta.includes('上海'), '赛事卡片的数据');
  ok(!p.data.upcoming.map((e) => [e.title, e.meta, e.signupOpens, e.tag].join('|')).join('|').includes('['), '真实活动不带方括号占位');
  p.onRemind({ currentTarget: { dataset: { id: 'race' } } });
  await tick();
  ok(p.data.upcoming[1].reminded, '设提醒成功');
  eq(lastCall('requestSubscribeMessage').args.tmplIds, ['tmpl'], '调起订阅授权');
  eq(cloud.col('reminders')[0]._id, 'user-a_race', '提醒登记到云端');

  // 活动详情：报名
  p = env.openPage('pages/event-detail/index', { id: 'race' });
  await tick();
  ok(p.data.reminded && !p.data.signed, '详情页的提醒和报名状态');
  const texts = p.data.headFields.concat(p.data.rowFields).map((f) => f.v).concat([p.data.detail.memberBanner.body, p.data.detail.about.body]);
  ok(texts.length === 8 && !texts.join('|').includes('['), '详情页不带方括号占位');
  p.onSignup();
  await tick();
  eq([p.data.signed, lastCall('showToast').args.title], [false, '报名还没有开放'], '没开放时报名失败并提示');
  cloud.state.now += DAY + HOUR;
  p.onSignup();
  await tick();
  ok(p.data.signed, '报名成功');
  eq(lastCall('showToast').args.title, '报名成功', '报名成功有提示');

  // 我的：活动里先显示已报名
  p = env.openPage('pages/me/index', {});
  eq(p.data.myEvents.map((e) => [e.id, e.state]), [['race', 'signed']], '我的活动：同一场只显示已报名');
  ok(p.data.plan.saved, '我的补给计划');

  // 注册后保存计划失败：提示，待保存的输入留着，不跳回计算页
  {
    const c2 = createCloud();
    seed(c2);
    const api2 = c2.load('api');
    let failSave = true;
    const wxc = {
      init() {},
      callFunction(o) {
        if (o.data.action === 'savePlan' && failSave) return Promise.reject({ errMsg: 'cloud.callFunction:fail timeout' });
        return c2.run(() => api2.main(o.data)).then((result) => ({ result: result }));
      }
    };
    const e3 = createEnv({ wx: { cloud: wxc } });
    Object.assign(require(path.join(ROOT, 'config.js')), { cloudEnv: 'test-env', subscribeTemplateId: 'tmpl', sampleEvents: false });
    e3.launch();
    await tick();
    const last3 = (name) => e3.wx.__calls.filter((c) => c.api === name).slice(-1)[0];
    let q = e3.openPage('pages/fuel/index', {});
    q.onPick({ currentTarget: { dataset: { field: 'sport', index: 2 } } });
    q.onSave();
    await tick();
    q = e3.openPage('pages/me/index', {});
    q.onAgree({});
    q.onPhone({ detail: { code: 'code-a' } });
    await tick();
    ok(q.data.registered, '保存失败不影响注册');
    ok(last3('showToast').args.title.includes('保存失败'), '保存失败有提示');
    eq(last3('switchTab').args.url, '/pages/me/index', '保存失败不跳回计算页');
    eq(e3.wx.__storage.sx_pending_plan.sport, 'bike', '待保存的输入还在');
    ok(!q.data.plan.saved, '我的补给计划还是未保存');
    // 关掉重进：计算页把那份输入摆回来，再点保存
    q = e3.openPage('pages/fuel/index', {});
    eq(q.data.input.sport, 'bike', '计算页恢复没存上的输入');
    failSave = false;
    q.onSave();
    await tick();
    eq(c2.col('plans')[0].input.sport, 'bike', '重试保存成功');
    ok(!e3.wx.__storage.sx_pending_plan, '存上以后清掉待保存的输入');
  }

  // 启动同步很慢，期间用户完成了注册：迟到的旧快照不能把注册状态冲掉
  {
    const c4 = createCloud();
    seed(c4);
    const api4 = c4.load('api');
    let slow = 80;
    const wxc = {
      init() {},
      callFunction(o) {
        // bootstrap 先取到云端结果，再拖一会儿才返回
        const res = c4.run(() => api4.main(o.data)).then((result) => ({ result: result }));
        if (o.data.action !== 'bootstrap') return res;
        const delay = slow;
        slow = 0;
        return res.then((r) => new Promise((resolve) => setTimeout(() => resolve(r), delay)));
      }
    };
    const e4 = createEnv({ wx: { cloud: wxc } });
    Object.assign(require(path.join(ROOT, 'config.js')), { cloudEnv: 'test-env', subscribeTemplateId: 'tmpl', sampleEvents: false });
    e4.launch();
    const q = e4.openPage('pages/me/index', {});
    q.onAgree({});
    q.onPhone({ detail: { code: 'code-a' } });
    await tick();
    ok(q.data.registered, '同步返回前注册成功');
    await new Promise((r) => setTimeout(r, 150));
    ok(q.data.registered && !!e4.wx.__storage.sx_member, '迟到的旧快照没有覆盖注册状态');
  }

  // 云端一场活动都没有：第一次等返回时显示占位块，之后回到这一页直接显示「敬请期待」，不再闪占位块
  {
    const c5 = createCloud();
    const api5 = c5.load('api');
    const wxc = { init() {}, callFunction(o) { return c5.run(() => api5.main(o.data)).then((result) => ({ result: result })); } };
    const e5 = createEnv({ wx: { cloud: wxc } });
    Object.assign(require(path.join(ROOT, 'config.js')), { cloudEnv: 'test-env', subscribeTemplateId: 'tmpl', sampleEvents: false });
    e5.launch();
    const q = e5.openPage('pages/events/index', {});
    ok(q.data.loading && !q.data.hasUpcoming, '第一次取活动、还没返回：显示占位块');
    await tick();
    ok(!q.data.loading && !q.data.hasUpcoming, '云端没有活动：显示「敬请期待」');
    eq(q.data.empty.title, '敬请期待', '空状态的文案');
    q.onShow();
    ok(!q.data.loading, '再回到这一页：不再显示占位块');
    await tick();
    c5.state.data.events = [{ _id: 'new', type: '赛事', title: '新活动', status: 'published', date: new Date(c5.state.now + 5 * DAY) }];
    q.onShow();
    ok(!q.data.loading && !q.data.hasUpcoming, '后台新增了活动、还没取回来：先显示上次的结果');
    await tick();
    eq(q.data.upcoming.map((e) => e.id), ['new'], '取回来以后显示新活动');
  }

  // 换设备（本机没有缓存）：启动时从云端同步回来
  const env2 = createEnv({ wx: { cloud: wxCloud } });
  Object.assign(require(path.join(ROOT, 'config.js')), { cloudEnv: 'test-env', subscribeTemplateId: 'tmpl', sampleEvents: false });
  env2.launch();
  p = env2.openPage('pages/me/index', {});
  ok(!p.data.registered, '同步完成前按本机缓存显示');
  await tick();
  ok(p.data.registered && p.data.plan.saved, '同步完成后页面自动刷新成会员状态');
}

/** 字体：资源在云存储时走「下载到本机 → Data URL」，不依赖跨域许可；任何一步失败都退回 https 地址 */
async function fontTests() {
  const path = require('path');
  const { createEnv, ROOT } = require('./preview/runtime.js');
  const CDN = 'https://636c-test-env-1500000000.tcb.qcloud.la';
  const tick = () => new Promise((r) => setTimeout(r, 20));
  const FONT_FILES = ['barlow-condensed-latin-700-italic.woff2', 'barlow-condensed-latin-800-italic.woff2', 'barlow-condensed-latin-700-normal.woff2'];

  function launch(opts) {
    const files = opts.files;                 // 本机文件：路径 → base64
    const downloads = [];
    const attempts = [];                      // dataUrlFails 时：每次 loadFontFace 的 source
    const loaded = [];                        // dataUrlFails 时：加载成功的
    const wxExtra = {
      env: { USER_DATA_PATH: 'wxfile://usr' },
      getFileSystemManager: () => ({
        readFile(o) { if (o.filePath in files) o.success({ data: files[o.filePath] }); else o.fail({ errMsg: 'no such file' }); },
        copyFile(o) { files[o.destPath] = files[o.srcPath]; },
        unlink(o) { delete files[o.filePath]; }
      }),
      cloud: {
        init() {},
        callFunction: () => Promise.resolve({ result: { ok: true, data: { member: null, plan: null, reminders: [], signups: [] } } }),
        downloadFile(o) {
          downloads.push(o.fileID);
          if (opts.downloadFails) return Promise.reject({ errMsg: 'downloadFile:fail' });
          const tmp = 'wxfile://tmp/' + downloads.length;
          files[tmp] = 'QkFTRTY0';
          return Promise.resolve({ tempFilePath: tmp });
        }
      }
    };
    if (opts.dataUrlFails) {
      // 模拟「Data URL 的字体内容是坏的」：这种 source 一律加载失败
      wxExtra.loadFontFace = (o) => {
        attempts.push(o.source);
        if (o.source.indexOf('data:') >= 0) { o.fail({ status: 'error' }); return; }
        loaded.push(o);
      };
    }
    const env = createEnv({ wx: wxExtra, assetBase: opts.assetBase || CDN });
    Object.assign(require(path.join(ROOT, 'config.js')), { cloudEnv: 'test-env', sampleEvents: false });
    env.launch();
    return { env: env, downloads: downloads, attempts: attempts, loaded: loaded };
  }

  const files = {};
  let r = launch({ files: files });
  await tick();
  eq(r.env.wx.__fonts.length, 3, '三个字重都交给 loadFontFace');
  ok(r.env.wx.__fonts.every((f) => f.source === 'url("data:font/woff2;base64,QkFTRTY0")' && f.global && f.family === 'Barlow Condensed'), '云存储的字体以 Data URL 加载');
  eq(r.downloads[0], 'cloud://test-env.636c-test-env-1500000000/assets/fonts/barlow-condensed-latin-700-italic.woff2', '云文件 ID 由环境 ID 和资源域名拼出');
  eq(r.env.wx.__fonts.map((f) => f.desc.style + f.desc.weight).sort(), ['italic700', 'italic800', 'normal700'], '字重和样式');

  r = launch({ files: files });
  await tick();
  ok(r.downloads.length === 0 && r.env.wx.__fonts.length === 3, '第二次启动读本机缓存，不再下载');

  r = launch({ files: {}, downloadFails: true });
  await tick();
  ok(r.env.wx.__fonts.length === 3 && r.env.wx.__fonts.every((f) => f.source.startsWith('url("' + CDN + '/assets/fonts/')), '下载失败时退回 https 地址');

  // 本机缓存的内容坏了：Data URL 加载失败后删掉缓存，改用 https 地址再试一次
  const broken = {};
  FONT_FILES.forEach((name) => { broken['wxfile://usr/sx-' + name] = 'QlJPS0VO'; });
  r = launch({ files: broken, dataUrlFails: true });
  await tick();
  eq(r.attempts.filter((s) => s.indexOf('data:') >= 0).length, 3, '先试本机缓存的 Data URL');
  ok(r.loaded.length === 3 && r.loaded.every((f) => f.source.startsWith('url("' + CDN + '/assets/fonts/')), 'Data URL 加载失败后改用 https 地址');
  eq(Object.keys(broken).filter((k) => k.indexOf('wxfile://usr/') === 0).length, 0, '坏掉的缓存被删掉，下次启动重新下载');

  r = launch({ files: {}, assetBase: 'http://127.0.0.1:8787' });
  await tick();
  ok(r.downloads.length === 0 && r.env.wx.__fonts.every((f) => f.source.startsWith('url("http://127.0.0.1:8787/assets/fonts/')), '资源不在云存储时直接用地址加载');
}

(async () => {
  await fontTests();
  await functionTests();
  await signupFailureTests();
  await remindTests();
  await clientTests();
  console.log('云开发测试通过：' + n + ' 项');
  process.exit(0);
})().catch((e) => { console.log(e); process.exit(1); });
