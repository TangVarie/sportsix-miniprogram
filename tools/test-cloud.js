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
  eq(r.data, { member: null, news: false, notice: null, plan: null, reminders: [], signups: [] }, '新用户');

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
  eq(await cloud.run(() => remind.main()), { sent: 0, failed: 0, newsSent: 0, newsFailed: 0 }, '没开放不发提醒');

  cloud.state.now += 1 * DAY + HOUR; // 会员报名开放
  eq(await cloud.run(() => remind.main()), { sent: 1, failed: 0, newsSent: 0, newsFailed: 0 }, '开放后发提醒');
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
  eq(await cloud.run(() => remind.main()), { sent: 0, failed: 0, newsSent: 0, newsFailed: 0 }, '不重复发');
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
  eq(await cloud.run(() => remind.main()), { sent: 0, failed: 1, newsSent: 0, newsFailed: 0 }, '发送失败');
  ok(cloud.col('reminders').find((x) => x._id === 'user-b_trial').sent === true, '失败的也标记，不重试');
  cloud.state.sendError = null;

  eq(cloud.col('reminders').find((x) => x._id === 'user-b_trial').status, 'failed', '失败的记成 failed');
  cloud.state.sendError = null;

  cloud.state.now += 20 * DAY;
  cloud.state.openid = 'user-a';
  eq((await call('signup', { eventId: 'trial' })).code, 'closed', '报名已结束');
}

/** 报名写入的两种异常：没写进去，和写进去了但响应丢了 */
/** 运营后台：只有管理员能用；活动的新建、编辑、上下架；公告；积分调整 */
async function adminTests() {
  const cloud = createCloud();
  seed(cloud);
  const api = cloud.load('api');
  const call = (action, data) => cloud.run(() => api.main(Object.assign({ action: action }, data)));
  const now = cloud.state.now;
  const DAY = 24 * 3600 * 1000;

  // 不是会员、是会员但不是管理员：都不能用
  for (const action of ['adminEvents', 'adminSaveEvent', 'adminSetEventStatus', 'adminNotifyEvent', 'adminPastEvents', 'adminSavePast', 'adminDeletePast', 'adminNotice', 'adminSaveNotice', 'adminFindMember', 'adminAdjustPoints']) {
    eq((await call(action, {})).code, 'forbidden', '没注册不能用 ' + action);
  }
  await call('register', { code: 'code-a' });
  eq((await call('bootstrap')).data.member.admin, false, '普通会员没有管理员标记');
  eq((await call('adminEvents')).code, 'forbidden', '普通会员不能用运营后台');
  eq((await call('adminAdjustPoints', { memberNo: '100001', delta: 100, reason: '自己给自己加' })).code, 'forbidden', '普通会员不能改积分');

  // 在控制台里给会员记录加上 admin: true 之后才是管理员
  cloud.col('members').find((d) => d._id === 'user-a').admin = true;
  eq((await call('bootstrap')).data.member.admin, true, '管理员有标记，小程序据此显示入口');

  // 活动：全部列出来，含草稿和过期的
  let r = await call('adminEvents');
  eq(r.data.events.map((e) => e.id).sort(), ['draft', 'old', 'race', 'trial'], '后台能看到草稿和过期的活动');
  eq(r.data.events.find((e) => e.id === 'draft').status, 'draft', '带上状态');

  // 新建：必填项
  eq((await call('adminSaveEvent', { event: { title: '没有类型', date: now + DAY } })).code, 'bad_type', '类型必须是三种之一');
  eq((await call('adminSaveEvent', { event: { type: '赛事', date: now + DAY } })).code, 'missing_title', '要有名称');
  eq((await call('adminSaveEvent', { event: { type: '赛事', title: '没有日期' } })).code, 'missing_date', '要有日期');
  eq((await call('adminSaveEvent', { event: { type: '赛事', title: 'x', date: now + DAY, signupStart: now + DAY, signupEnd: now } })).code, 'bad_signup_time', '报名结束不能早于开始');

  r = await call('adminSaveEvent', { event: {
    type: '赛事', title: '  上海半程马拉松\n ', date: now + 20 * DAY, city: '上海', venue: '徐汇滨江', quota: 200, quotaText: '',
    signupStart: now + DAY, signupEnd: now + 10 * DAY, memberSignupStart: now, intro: '第一行\n第二行', status: 'draft', hacked: 'x', signupCount: 999
  } });
  const id = r.data.event.id;
  eq(r.data.event.title, '上海半程马拉松', '名称去掉换行和首尾空格');
  eq(r.data.event.intro, '第一行\n第二行', '介绍保留换行');
  eq([r.data.event.status, r.data.event.signupCount, r.data.event.quota], ['draft', 0, 200], '新建的是草稿，报名人数从 0 开始，不认表单里带来的数');
  ok(!('hacked' in cloud.col('events').find((e) => e._id === id)), '只存认识的字段');
  ok(cloud.col('events').find((e) => e._id === id).date instanceof Date, '时间存成日期类型');
  eq((await call('events')).data.events.some((e) => e.id === id), false, '草稿在小程序里不显示');

  // 上架、编辑、下架
  r = await call('adminSetEventStatus', { id: id, status: 'published' });
  eq(r.data.event.status, 'published', '上架');
  eq((await call('events')).data.events.some((e) => e.id === id), true, '上架后小程序里能看到');
  cloud.col('events').find((e) => e._id === id).signupCount = 3;
  r = await call('adminSaveEvent', { id: id, event: { type: '赛事', title: '上海半马', date: now + 21 * DAY, status: 'published', quota: null, venue: '' } });
  eq([r.data.event.title, r.data.event.quota, r.data.event.venue, r.data.event.signupCount], ['上海半马', null, '', 3], '编辑：清掉的项变空，已报名人数不动');
  eq((await call('adminSaveEvent', { id: 'nope', event: { type: '赛事', title: 'x', date: now + DAY } })).code, 'not_found', '改不存在的活动');
  r = await call('adminSetEventStatus', { id: id, status: 'draft' });
  eq((await call('events')).data.events.some((e) => e.id === id), false, '下架后小程序里不显示');

  // 不限名额的活动也记已报名人数；之后加上名额限制，已经报的人算在里面，不会超额
  await call('adminSaveEvent', { id: id, event: { type: '赛事', title: '上海半马', date: now + 21 * DAY, status: 'published', quota: null } });
  cloud.col('events').find((e) => e._id === id).signupCount = 0;
  eq((await call('signup', { eventId: id })).data.already, false, '不限名额时报名');
  eq(cloud.col('events').find((e) => e._id === id).signupCount, 1, '不限名额的活动也记已报名人数');
  eq((await call('adminEvents')).data.events.find((e) => e.id === id).signupCount, 1, '后台看到已报名 1 人');
  // 以前报的名没记数（老数据）：加名额限制时按报名记录重数
  cloud.col('events').find((e) => e._id === id).signupCount = 0;
  r = await call('adminSaveEvent', { id: id, event: { type: '赛事', title: '上海半马', date: now + 21 * DAY, status: 'published', quota: 1 } });
  eq(r.data.event.signupCount, 1, '加名额限制时，已报名人数按报名记录对准');
  cloud.state.openid = 'user-c';
  cloud.col('members').push({ _id: 'user-c', openid: 'user-c', phone: '13600002222', memberNo: '100900', numbered: true, points: 500, welcomeBonus: true, createdAt: new Date(now) });
  eq((await call('signup', { eventId: id })).code, 'full', '名额 1 个，已经有人报了，后面的人报不上');
  cloud.state.openid = 'user-a';
  // 有人正在报名（人数已经加一、报名记录还没写进去）时保存活动：不能把他占的名额抹掉
  cloud.col('signups').splice(cloud.col('signups').findIndex((s) => s.eventId === id), 1);
  eq(cloud.col('events').find((e) => e._id === id).signupCount, 1, '人数 1，记录 0：相当于有一个人报到一半');
  await call('adminSaveEvent', { id: id, event: { type: '赛事', title: '上海半马', date: now + 21 * DAY, status: 'published', quota: 1 } });
  eq(cloud.col('events').find((e) => e._id === id).signupCount, 1, '保存活动不把正在报名的人占的名额抹掉');
  cloud.state.openid = 'user-c';
  eq((await call('signup', { eventId: id })).code, 'full', '名额还是满的');
  cloud.state.openid = 'user-a';
  await call('adminSetEventStatus', { id: id, status: 'draft' });

  // 活动超过 100 场：后台分页取全，最早的一场也在
  for (let i = 0; i < 130; i++) cloud.col('events').push({ _id: 'bulk' + i, type: '赛事', title: '批量 ' + i, status: 'draft', date: new Date(now - (i + 1) * DAY) });
  r = await call('adminEvents');
  ok(r.data.events.length >= 134 && r.data.events.some((e) => e.id === 'bulk129'), '活动超过 100 场时后台也能列全');
  cloud.state.data.events = cloud.col('events').filter((e) => !/^bulk/.test(e._id));

  // 公告：没设过时是空的；保存后所有人打开小程序都能拿到；关掉就没有
  eq((await call('adminNotice')).data.notice, { title: '', content: '', enabled: false }, '没设过公告');
  eq((await call('adminSaveNotice', { notice: { enabled: true } })).code, 'missing_content', '开着的公告要有内容');
  r = await call('adminSaveNotice', { notice: { title: '双十一活动', content: '11 月 11 日起，\n会员下单有礼。', enabled: true } });
  eq(r.data.notice.enabled, true, '保存公告');
  cloud.state.openid = 'user-b';
  r = await call('bootstrap');
  eq([r.data.notice.title, r.data.notice.content], ['双十一活动', '11 月 11 日起，\n会员下单有礼。'], '没注册的人打开小程序也能拿到公告');
  const v1 = r.data.notice.version;
  cloud.state.openid = 'user-a';
  cloud.state.now += 1000;
  await call('adminSaveNotice', { notice: { title: '双十一活动', content: '改了一个字', enabled: true } });
  ok((await call('bootstrap')).data.notice.version > v1, '再保存一次算新版本，会再弹一次');
  await call('adminSaveNotice', { notice: { title: '双十一活动', content: '改了一个字', enabled: false } });
  eq((await call('bootstrap')).data.notice, null, '关掉以后不再下发');
  eq((await call('adminNotice')).data.notice.content, '改了一个字', '关掉以后内容还在，下次可以接着改');

  // 积分调整：按会员编号或手机号找人，加减都记一笔
  cloud.state.openid = 'user-b';
  await call('register', { code: 'code-b' });
  const noB = cloud.col('members').find((d) => d._id === 'user-b').memberNo;
  cloud.state.openid = 'user-a';
  eq((await call('adminFindMember', { query: '' })).code, 'missing_query', '要填查找的内容');
  eq((await call('adminFindMember', { query: '19900000000' })).code, 'not_found', '查无此人');
  r = await call('adminFindMember', { query: ' ' + cloud.col('members').find((d) => d._id === 'user-b').phone + ' ' });
  eq([r.data.member.memberNo, r.data.member.points], [noB, 500], '按手机号找到');
  ok(!JSON.stringify(r.data).includes('user-b') && !JSON.stringify(r.data).includes(cloud.col('members').find((d) => d._id === 'user-b').phone), '不返回 openid 和完整手机号');
  eq((await call('adminFindMember', { query: noB })).data.member.memberNo, noB, '按会员编号找到');

  eq((await call('adminAdjustPoints', { memberNo: noB, delta: 0, reason: 'x' })).code, 'bad_delta', '加减的数不能是 0');
  eq((await call('adminAdjustPoints', { memberNo: noB, delta: 1.5, reason: 'x' })).code, 'bad_delta', '要是整数');
  eq((await call('adminAdjustPoints', { memberNo: noB, delta: 100, reason: '  ' })).code, 'missing_reason', '要写原因');
  eq((await call('adminAdjustPoints', { memberNo: '999999', delta: 100, reason: 'x' })).code, 'not_found', '会员编号不存在');
  r = await call('adminAdjustPoints', { memberNo: noB, delta: 200, reason: '线下活动签到' });
  eq(r.data.member.points, 700, '加积分');
  eq((await call('adminAdjustPoints', { memberNo: noB, delta: -800, reason: '兑换' })).code, 'insufficient', '不够减，不会减成负数');
  r = await call('adminAdjustPoints', { memberNo: noB, delta: -300, reason: '兑换试用装' });
  eq(r.data.member.points, 400, '减积分');
  const logs = cloud.col('point_logs').filter((l) => l.openid === 'user-b');
  eq(logs.map((l) => [l.delta, l.reason]), [[500, 'welcome'], [200, '线下活动签到'], [-300, '兑换试用装']], '每次调整都记一条');
  eq(logs[1].by, 'user-a', '记下是哪位管理员操作的');
  // 会员自己在积分页能看到这些记录
  cloud.state.openid = 'user-b';
  r = await call('points');
  eq(r.data.member.points, 400, '会员看到调整后的积分');
  eq(r.data.logs.map((l) => l.reason).sort(), ['welcome', '兑换试用装', '线下活动签到'].sort(), '会员在积分页看到调整记录');
  ok(!JSON.stringify(r.data.logs).includes('user-a'), '记录里不带操作人');
}

/** 电脑端后台：网页没有微信身份，靠小程序里取的一次性登录码登录，之后带着凭证调后台接口 */
async function webTests() {
  const cloud = createCloud();
  seed(cloud);
  const api = cloud.load('api');
  const call = (action, data) => cloud.run(() => api.main(Object.assign({ action: action }, data)));
  // 网页来的调用：没有 openid
  const web = async (action, data) => {
    const who = cloud.state.openid;
    cloud.state.openid = '';
    try { return await call(action, data); } finally { cloud.state.openid = who; }
  };

  await call('register', { code: 'code-a' });
  eq((await call('adminWebCode')).code, 'forbidden', '普通会员取不了登录码');
  cloud.col('members').find((d) => d._id === 'user-a').admin = true;

  // 没有微信身份、也没登录：什么都做不了
  eq((await web('nope')).code, 'unknown_action', '网页调不存在的接口');
  for (const action of ['bootstrap', 'register', 'savePlan', 'signup', 'points', 'setNickname', 'subscribeNews', 'pastEvents', 'adminWebCode']) {
    eq((await web(action, { webToken: 'x' })).code, 'no_openid', '网页不能调小程序用户的接口 ' + action);
  }
  for (const action of ['adminEvents', 'adminSaveEvent', 'adminNotice', 'adminAdjustPoints', 'adminUploadCover', 'webMe']) {
    eq((await web(action)).code, 'web_expired', '没登录调不了 ' + action);
    eq((await web(action, { webToken: 'f'.repeat(64) })).code, 'web_expired', '凭证是瞎编的调不了 ' + action);
  }

  // 登录码：12 位数字，只能用一次
  let r = await call('adminWebCode');
  const code = r.data.code;
  ok(/^\d{12}$/.test(code) && r.data.expiresIn === 300, '登录码是 12 位数字，5 分钟内有效');
  eq((await web('webLogin', { code: '000000000000' === code ? '111111111111' : '000000000000' })).code, 'bad_code', '登录码不对');
  eq((await web('webLogin', { code: code.slice(0, 8) })).code, 'bad_code', '只输了前 8 位');
  eq((await web('webLogin', { code: '123' })).code, 'bad_code', '登录码位数不对');
  r = await web('webLogin', { code: code.slice(0, 4) + ' ' + code.slice(4, 8) + ' ' + code.slice(8) });
  const token = r.data.token;
  ok(/^[0-9a-f]{64}$/.test(token), '登录成功拿到凭证（中间带空格也认）');
  eq((await web('webLogin', { code: code })).code, 'bad_code', '登录码用过一次就作废');
  const stored = JSON.stringify(cloud.col('admin_web'));
  ok(stored.indexOf(code) < 0 && stored.indexOf(token) < 0, '库里不存登录码和凭证的原文');

  // 带着凭证：能调后台接口，不能调别的
  eq((await web('adminEvents', { webToken: token })).data.events.length, 4, '登录后能看到活动');
  eq((await web('webMe', { webToken: token })).data.memberNo, '100001', '知道登录的是谁');
  eq((await web('register', { webToken: token, code: 'code-b' })).code, 'no_openid', '凭证不能拿来调小程序用户的接口');
  r = await web('adminSaveNotice', { webToken: token, notice: { title: '网页发的', content: '内容', enabled: true } });
  eq(cloud.col('settings')[0].updatedBy, 'user-a', '网页上的操作记在这位管理员名下');

  // 传头图：只收图片，有大小上限
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64, 1)]);
  eq((await web('adminUploadCover', { webToken: token, data: '' })).code, 'missing_file', '没有文件');
  eq((await web('adminUploadCover', { webToken: token, data: Buffer.from('<script>alert(1)</script>').toString('base64') })).code, 'bad_file', '不是图片不收');
  eq((await web('adminUploadCover', { webToken: token, data: Buffer.concat([png, Buffer.alloc(2 * 1024 * 1024)]).toString('base64') })).code, 'file_too_large', '超过 2MB 不收');
  r = await web('adminUploadCover', { webToken: token, data: png.toString('base64') });
  ok(/^cloud:\/\/mock-env\/events\/\d+-[0-9a-f]{8}\.png$/.test(r.data.fileID) && r.data.url.indexOf('https://') === 0, '图片存进云存储的 events/ 目录，返回 fileID 和预览地址');
  ok(cloud.state.files[r.data.fileID].equals(png), '存的就是传上来的内容');
  const fileID = r.data.fileID;
  r = await web('adminFileUrls', { webToken: token, ids: [fileID, 'https://evil.test/x.png', 42] });
  eq(Object.keys(r.data.urls), [fileID], '只给云存储里的文件换地址');
  eq((await call('adminUploadCover', { data: png.toString('base64') })).ok, true, '小程序里的管理员也能用这个接口');

  // 凭证过期、退出登录
  const session = cloud.col('admin_web').find((d) => d.kind === 'session');
  const realExpiry = session.expiresAt;
  ok(realExpiry - cloud.state.now > 11 * 3600 * 1000 && realExpiry - cloud.state.now <= 12 * 3600 * 1000, '登录一次管 12 小时');
  session.expiresAt = cloud.state.now - 1;
  eq((await web('adminEvents', { webToken: token })).code, 'web_expired', '凭证过期后要重新登录');
  session.expiresAt = realExpiry;
  // 登录之后被撤掉管理员：凭证还在，但后台接口调不通
  cloud.col('members').find((d) => d._id === 'user-a').admin = false;
  eq((await web('adminEvents', { webToken: token })).code, 'forbidden', '被撤掉管理员后，已登录的网页也用不了');
  cloud.col('members').find((d) => d._id === 'user-a').admin = true;
  eq((await web('webLogout', { webToken: token })).ok, true, '退出登录');
  eq((await web('adminEvents', { webToken: token })).code, 'web_expired', '退出后凭证作废');

  // 登录码过期
  const code2 = (await call('adminWebCode')).data.code;
  cloud.col('admin_web').filter((d) => d.kind === 'code' && !d.used).forEach((d) => { d.expiresAt = cloud.state.now - 1; });
  eq((await web('webLogin', { code: code2 })).code, 'bad_code', '登录码过了 5 分钟不能用');

  // 取登录码之后被撤掉管理员：登录不了
  const code3 = (await call('adminWebCode')).data.code;
  cloud.col('members').find((d) => d._id === 'user-a').admin = false;
  eq((await web('webLogin', { code: code3 })).code, 'bad_code', '取码之后被撤掉管理员，登录不了');
  cloud.col('members').find((d) => d._id === 'user-a').admin = true;

  // 乱输多少次都不影响别人登录：网页没有微信身份，分不清谁是谁，要是「输错几次就锁」，
  // 任何人乱输几次就能把管理员挡在外面。输错也不往库里写东西
  const code4 = (await call('adminWebCode')).data.code;
  const before = JSON.stringify(cloud.col('admin_web'));
  for (let i = 0; i < 50; i++) {
    const wrong = String(100000000000 + i);
    eq((await web('webLogin', { code: wrong === code4 ? '999999999999' : wrong })).code, 'bad_code', '第 ' + (i + 1) + ' 次乱输');
  }
  eq(JSON.stringify(cloud.col('admin_web')), before, '乱输不往库里写任何东西');
  ok((await web('webLogin', { code: code4 })).ok, '别人乱输了 50 次，管理员照样能用自己的登录码登录');

  // 登录码每一位都是随机的：取 200 个，没有重复，十个数字都出现过
  const many = [];
  for (let i = 0; i < 200; i++) many.push((await call('adminWebCode')).data.code);
  eq(new Set(many).size, 200, '登录码不重复');
  eq(new Set(many.join('').split('')).size, 10, '十个数字都会出现');
}

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
/** 往期的赞助赛事：存在云端，运营在后台增删改，不用重新发版 */
async function pastTests() {
  const cloud = createCloud();
  seed(cloud);
  const api = cloud.load('api');
  const call = (action, data) => cloud.run(() => api.main(Object.assign({ action: action }, data)));
  const packaged = require('../reference/content/events.json').past;

  // 第一次读时放初始的几场，中途有一条没写成：这次报错，不交出残缺的列表；下一次接着补齐
  cloud.state.addFails = 'before';
  let r = await call('pastEvents');
  eq(r.code, 'server_error', '初始的几场没放齐：报错，不返回残缺的列表');
  r = await call('pastEvents');
  eq([r.ok, r.data.past.length], [true, 4], '下一次读接着补齐');

  // 两个请求重叠：慢的那个读到的还是「集合是空的」，这期间另一个请求放好了初始的几场、管理员删掉了其中一场。
  // 慢的那个接着往下补的时候，不能把删掉的那场放回来
  {
    const c2 = createCloud();
    seed(c2);
    const api2 = c2.load('api');
    const call2 = (action, data) => c2.run(() => api2.main(Object.assign({ action: action }, data)));
    await call2('register', { code: 'code-a' });
    c2.col('members').find((d) => d._id === 'user-a').admin = true;
    c2.state.afterGet = async (name) => {
      if (name !== 'past_events') return;
      c2.state.afterGet = null;
      await call2('pastEvents');
      ok((await call2('adminDeletePast', { id: 'seed-1' })).ok, '另一个请求放好初始的几场，管理员删掉一场');
    };
    const slowRead = await call2('pastEvents');
    c2.state.afterGet = null;
    eq([slowRead.ok, slowRead.data.past.map((x) => x.id)], [true, ['seed-2', 'seed-3', 'seed-4']], '慢的那个请求没有把删掉的那场放回来');
    eq((await call2('pastEvents')).data.past.length, 3, '之后再读也没有回来');
    eq((await call2('adminSavePast', { id: 'seed-1', item: { year: '2026', name: '改名', image: 'cloud://x/a.jpg' } })).code, 'not_found', '删掉的不能再改');
  }

  // 之后再读：就是包里原有的那几场
  r = await call('pastEvents');
  eq(r.data.past.map((p) => [p.year, p.name, p.nameEn, p.image]), packaged.map((p) => [p.year, p.name, p.nameEn, p.image]), '第一次读到的就是包里原有的那几场，顺序一样');
  ok(r.data.past.every((p) => p.id), '每场带 id');

  await call('register', { code: 'code-a' });
  eq((await call('adminSavePast', { item: { year: '2027', name: '新赛事', image: 'cloud://x/a.jpg' } })).code, 'forbidden', '普通会员不能改');
  cloud.col('members').find((d) => d._id === 'user-a').admin = true;

  eq((await call('adminSavePast', { item: { year: '27', name: '新赛事', image: 'cloud://x/a.jpg' } })).code, 'bad_year', '年份要四位数');
  eq((await call('adminSavePast', { item: { year: '2027', name: ' ', image: 'cloud://x/a.jpg' } })).code, 'missing_name', '要有名称');
  eq((await call('adminSavePast', { item: { year: '2027', name: '新赛事', image: '' } })).code, 'missing_image', '要有照片');
  eq((await call('adminSavePast', { id: 'nope', item: { year: '2027', name: '新赛事', image: 'cloud://x/a.jpg' } })).code, 'not_found', '改不存在的');

  r = await call('adminSavePast', { item: { year: '2027', name: '首尔马拉松', nameEn: 'Seoul Marathon', image: 'cloud://x/seoul.jpg' } });
  eq(r.data.past[0].name, '首尔马拉松', '年份新的排最前');
  cloud.state.now += 1000;
  r = await call('adminSavePast', { item: { year: '2026', name: '济州越野', nameEn: '', image: 'cloud://x/jeju.jpg' } });
  eq(r.data.past.map((p) => p.name).slice(0, 3), ['首尔马拉松', '济州越野', '韩国汉江跑步节'], '同一年里新加的排在前面');
  const jeju = r.data.past[1].id;
  r = await call('adminSavePast', { id: jeju, item: { year: '2026', name: '济州越野赛', nameEn: 'Jeju Trail', image: 'cloud://x/jeju2.jpg' } });
  eq([r.data.past[1].name, r.data.past[1].nameEn, r.data.past[1].image, r.data.past.length], ['济州越野赛', 'Jeju Trail', 'cloud://x/jeju2.jpg', 6], '修改不换位置、不多出一条');

  r = await call('adminDeletePast', { id: 'seed-1' });
  ok(!r.data.past.some((p) => p.name === '韩国汉江跑步节') && r.data.past.length === 5, '删掉一场');
  eq((await call('adminDeletePast', { id: 'seed-1' })).code, 'not_found', '删不存在的');
  // 读取一时出错：不能把删掉的那场当成「还没建集合」又放回来
  let broke = false;
  cloud.state.getError = (name) => { if (name === 'past_events' && !broke) { broke = true; return true; } return false; };
  r = await call('pastEvents');
  cloud.state.getError = null;
  ok(r.ok && r.data.past.length === 5 && !r.data.past.some((p) => p.id === 'seed-1'), '读取出错后重读，删掉的没有回来');
  cloud.state.openid = 'user-b';
  eq((await call('pastEvents')).data.past.length, 5, '没注册的用户也能看往期');
}

/** 新活动通知：用户点一次订阅，运营在后台对某场活动点「通知」，定时任务给每人发一条 */
async function newsTests() {
  const cloud = createCloud();
  seed(cloud);
  const api = cloud.load('api');
  const remind = cloud.load('remind');
  const call = (action, data) => cloud.run(() => api.main(Object.assign({ action: action }, data)));
  const as = async (openid, action, data) => {
    const who = cloud.state.openid;
    cloud.state.openid = openid;
    try { return await call(action, data); } finally { cloud.state.openid = who; }
  };
  const tick = () => cloud.run(() => remind.main());
  const event = (id) => cloud.col('events').find((e) => e._id === id);
  const sentTo = () => cloud.state.sent.map((m) => m.touser).sort();

  await call('register', { code: 'code-a' });
  cloud.col('members').find((d) => d._id === 'user-a').admin = true;

  // 还没有人订阅：通知不出去，这场活动的一次机会也不会被用掉
  eq((await call('adminEvents')).data.newsWaiting, 0, '还没人订阅时人数是 0（集合还没建也不报错）');
  eq((await call('adminNotifyEvent', { id: 'race' })).code, 'no_subscribers', '没人订阅时不能通知');
  ok(event('race').notifyStatus === undefined, '没通知出去，活动上不留记号');

  // 订阅：不用是会员，每人一条记录
  eq((await as('user-b', 'subscribeNews', {})).code, 'missing_template', '没带模板不能订阅');
  eq((await as('user-b', 'bootstrap')).data.news, false, '没订阅时是 false');
  ok((await as('user-b', 'subscribeNews', { templateId: 'tmpl' })).ok, '订阅（集合第一次用到时自己建）');
  await as('user-b', 'subscribeNews', { templateId: 'tmpl' });
  await as('user-c', 'subscribeNews', { templateId: 'tmpl' });
  eq(cloud.col('news_subs').map((s) => s._id).sort(), ['user-b', 'user-c'], '同一个人点两次也只有一条记录');
  eq((await as('user-b', 'bootstrap')).data.news, true, '订阅后小程序里显示已订阅');

  // 谁能通知、哪些活动能通知
  eq((await as('user-b', 'adminNotifyEvent', { id: 'race' })).code, 'forbidden', '普通用户不能发通知');
  eq((await call('adminNotifyEvent', { id: 'nope' })).code, 'not_found', '活动不存在');
  eq((await call('adminNotifyEvent', { id: 'draft' })).code, 'not_published', '没上架的活动不能通知');
  eq((await call('adminNotifyEvent', { id: 'old' })).code, 'event_ended', '已经结束的活动不能通知');
  let r = await call('adminEvents');
  eq([r.data.newsWaiting, r.data.events.find((e) => e.id === 'race').notify], [2, null], '后台看到有 2 人订阅，活动还没通知过');

  r = await call('adminNotifyEvent', { id: 'race' });
  eq([r.ok, r.data.waiting, r.data.event.notify.status], [true, 2, 'pending'], '登记通知，返回会发给多少人');
  eq((await call('adminNotifyEvent', { id: 'race' })).code, 'notified', '一场活动只能通知一次');
  eq(cloud.col('news_subs').map((s) => s.eventId), ['race', 'race'], '登记时把当时订阅着的人划给这场活动');
  eq((await call('adminNotifyEvent', { id: 'trial' })).code, 'no_subscribers', '人都划给上一场了，另一场通知不出去');
  ok(event('trial').notifyStatus === undefined, '没通知出去的那场，机会还在');
  eq(cloud.state.sent.length, 0, '登记时不发，由定时任务发');

  // 登记之后才订阅的人：这场不发给他，额度留给下一场
  cloud.state.now += 60 * 1000;
  await as('user-d', 'subscribeNews', { templateId: 'tmpl' });

  r = await tick();
  eq([r.newsSent, r.newsFailed], [2, 0], '定时任务发出 2 条');
  eq(sentTo(), ['user-b', 'user-c'], '发给登记之前订阅的两个人');
  const msg = cloud.state.sent[0];
  eq([msg.page, msg.templateId, msg.data.thing1.value, msg.data.thing4.value, msg.data.thing8.value],
    ['pages/event-detail/index?id=race', 'tmpl', '春季路跑', '新活动上线', '上海 滨江'], '消息内容是这场活动，点开进活动详情');
  r = (await call('adminEvents')).data;
  eq([r.events.find((e) => e.id === 'race').notify.status, r.events.find((e) => e.id === 'race').notify.sent, r.newsWaiting], ['done', 2, 1], '发完记成 done 和人数；还剩后来订阅的 1 人');
  eq([(await as('user-b', 'bootstrap')).data.news, (await as('user-d', 'bootstrap')).data.news], [false, true], '收到的人回到未订阅，没收到的人还是已订阅');
  eq((await tick()).newsSent, 0, '发完以后再跑不会重发');
  eq(cloud.state.sent.length, 2, '没有多发');

  // 编辑活动不会把通知记录抹掉
  await call('adminSaveEvent', { id: 'race', event: { type: '赛事', title: '春季路跑（改）', status: 'published', date: cloud.state.now + 30 * DAY } });
  eq(event('race').notifyStatus, 'done', '编辑活动后通知记录还在');
  eq((await call('adminNotifyEvent', { id: 'race' })).code, 'notified', '编辑后也不能再通知一次');

  // 收到一条之后再点一次订阅，下一场才收得到
  await as('user-b', 'subscribeNews', { templateId: 'tmpl' });
  cloud.state.sent.length = 0;
  ok((await call('adminNotifyEvent', { id: 'trial' })).ok, '通知第二场活动');
  eq(cloud.col('news_subs').filter((s) => s.eventId === 'trial').map((s) => s._id).sort(), ['user-b', 'user-d'], '第二场划到重新订阅的人和上次没轮到的人');
  // 划好的人再点一次订阅（比如页面是旧的）：原样留着，不会被从这场活动里拿出来
  await as('user-b', 'subscribeNews', { templateId: 'tmpl' });
  eq(cloud.col('news_subs').find((s) => s._id === 'user-b').eventId, 'trial', '已经订阅着的人重复订阅，不影响划好的那场');

  // 登记后下架了一下、又在定时任务跑之前上架回来：划给它的人还在，别的活动也划不走
  await call('adminSaveEvent', { event: { type: '赛事', title: '另一场', status: 'published', date: cloud.state.now + 12 * DAY } });
  const other = cloud.col('events').find((e) => e.title === '另一场')._id;
  await call('adminSetEventStatus', { id: 'trial', status: 'draft' });
  eq((await call('adminNotifyEvent', { id: other })).code, 'no_subscribers', '下架着的那场名下的人，不会被另一场划走');
  await call('adminSetEventStatus', { id: 'trial', status: 'published' });
  eq((await tick()).newsSent, 2, '上架回来后照常发给划好的人');
  eq(sentTo(), ['user-b', 'user-d'], '第二场发给了划给它的两个人');

  // 登记后下架、定时任务跑的时候还没上架：这场通知停掉，人放回去；还没开始发的，重新上架后可以再通知
  await as('user-b', 'subscribeNews', { templateId: 'tmpl' });
  await call('adminNotifyEvent', { id: other });
  await call('adminSetEventStatus', { id: other, status: 'draft' });
  cloud.state.sent.length = 0;
  eq((await tick()).newsSent, 0, '下架着：不发');
  eq([event(other).notifyStatus, cloud.col('news_subs').find((s) => s._id === 'user-b').eventId, (await as('user-b', 'bootstrap')).data.news],
    [undefined, '', true], '还没开始发就下架：当作没通知过，人放回去，用户那边还是已订阅');
  await call('adminSetEventStatus', { id: other, status: 'published' });
  ok((await call('adminNotifyEvent', { id: other })).ok, '重新上架后可以再通知');
  // 已经开始发了再下架：这一场到此为止，没发到的人放回去留给下一场
  event(other).notifyStarted = true;
  await call('adminSetEventStatus', { id: other, status: 'draft' });
  await tick();
  eq([event(other).notifyStatus, cloud.col('news_subs').find((s) => s._id === 'user-b').eventId, cloud.state.sent.length], ['done', '', 0], '开始发了以后下架：这场结束，人放回去');
  await call('adminSetEventStatus', { id: other, status: 'published' });
  eq((await call('adminNotifyEvent', { id: other })).code, 'notified', '这场不能再通知');
  cloud.col('news_subs').find((s) => s._id === 'user-b').sent = true; // 后面的用例从没人订阅开始

  // 两位管理员同时通知两场活动：人只划给其中一场，另一场通知不出去、机会还在
  await call('adminSaveEvent', { event: { type: '赛事', title: '同时甲', status: 'published', date: cloud.state.now + 13 * DAY } });
  await call('adminSaveEvent', { event: { type: '赛事', title: '同时乙', status: 'published', date: cloud.state.now + 14 * DAY } });
  const both = ['同时甲', '同时乙'].map((title) => cloud.col('events').find((e) => e.title === title)._id);
  for (const u of ['p1', 'p2', 'p3']) await as(u, 'subscribeNews', { templateId: 'tmpl' });
  const pair = await Promise.all(both.map((id) => call('adminNotifyEvent', { id: id })));
  eq(pair.map((x) => x.ok ? x.data.waiting : x.code).sort(), [3, 'no_subscribers'], '同时通知两场：一场划到全部 3 人，另一场通知不出去');
  const lost = both[pair.findIndex((x) => !x.ok)];
  ok(event(lost).notifyStatus === undefined, '通知不出去的那场撤回登记，以后还能通知');
  cloud.state.sent.length = 0;
  eq((await tick()).newsSent, 3, '划到人的那场照常发出');
  eq(sentTo(), ['p1', 'p2', 'p3'], '每人只收到一条');

  // 数据库一时出错：这一场不算发完，下一次执行接着发
  await as('p1', 'subscribeNews', { templateId: 'tmpl' });
  ok((await call('adminNotifyEvent', { id: lost })).ok, '刚才没通知出去的那场，现在通知');
  let broke = false;
  cloud.state.getError = (name) => { if (name === 'news_subs' && !broke) { broke = true; return true; } return false; };
  cloud.state.sent.length = 0;
  eq([(await tick()).newsSent, event(lost).notifyStatus], [0, 'pending'], '查订阅记录时出错：没发，也没有被当成发完');
  cloud.state.getError = null;
  eq([(await tick()).newsSent, event(lost).notifyStatus, event(lost).notifySent], [1, 'done', 1], '下一次执行接着发完');

  // 两次执行重叠，其中一次慢了一步：前一次刚发完，用户马上又订阅了一次。慢的那次不能把新订阅的这条也拿去发
  await call('adminSaveEvent', { event: { type: '赛事', title: '重叠', status: 'published', date: cloud.state.now + 15 * DAY } });
  const overlap = cloud.col('events').find((e) => e.title === '重叠')._id;
  await as('p2', 'subscribeNews', { templateId: 'tmpl' });
  await call('adminNotifyEvent', { id: overlap });
  let release;
  const gate = new Promise((r) => { release = r; });
  let claims = 0;
  cloud.state.onUpdate = (name, cond) => {
    // 第二次去领 p2 这条记录的（慢的那次执行）：等前一次发完、用户重新订阅之后再继续
    if (name === 'news_subs' && cond._id === 'p2' && cond.sent === false && ++claims === 2) return gate;
    return null;
  };
  const realSend = cloud.sdk.openapi.subscribeMessage.send;
  cloud.sdk.openapi.subscribeMessage.send = async (o) => {
    const res = await realSend(o);
    cloud.state.onUpdate = null;
    await as('p2', 'subscribeNews', { templateId: 'tmpl' }); // 用户收到后马上又点了一次
    release();
    return res;
  };
  cloud.state.sent.length = 0;
  const twice = await cloud.run(() => Promise.all([remind.main(), remind.main()]));
  cloud.sdk.openapi.subscribeMessage.send = realSend;
  const p2 = cloud.col('news_subs').find((s) => s._id === 'p2');
  eq([twice[0].newsSent + twice[1].newsSent, cloud.state.sent.length, p2.sent, p2.status, p2.eventId], [1, 1, false, 'waiting', ''], '只发了一条，新订阅的那条原样留给下一场');
  p2.sent = true;

  // 发不出去的（用户关了订阅消息等）记成 failed，不重试
  await call('adminSaveEvent', { event: { type: '抽奖', title: '周年抽奖', status: 'published', date: cloud.state.now + 9 * DAY } });
  const lottery = cloud.col('events').find((e) => e.title === '周年抽奖')._id;
  cloud.col('news_subs').find((s) => s._id === 'user-b').sent = true;
  await as('user-b', 'subscribeNews', { templateId: 'tmpl' });
  await call('adminNotifyEvent', { id: lottery });
  cloud.state.sendError = 43101;
  r = await tick();
  cloud.state.sendError = null;
  eq([r.newsSent, r.newsFailed, event(lottery).notifyFailed, cloud.col('news_subs').find((s) => s._id === 'user-b').status], [0, 1, 1, 'failed'], '发送失败记下来');
  eq((await tick()).newsFailed, 0, '失败的不重试');

  // 人多的时候分几次发：一次执行最多 300 条，剩下的下次接着发；两次执行重叠也不会给同一个人发两条
  await call('adminSaveEvent', { event: { type: '赛事', title: '大活动', status: 'published', date: cloud.state.now + 20 * DAY } });
  const big = cloud.col('events').find((e) => e.title === '大活动')._id;
  for (let i = 0; i < 320; i++) cloud.col('news_subs').push({ _id: 'n' + i, openid: 'n' + i, templateId: 'tmpl', sent: false, status: 'waiting', eventId: '', job: '', subscribedAt: new Date(cloud.state.now - HOUR) });
  await call('adminNotifyEvent', { id: big });
  cloud.state.sent.length = 0;
  r = await tick();
  eq([r.newsSent, event(big).notifyStatus, event(big).notifySent], [300, 'pending', 300], '第一次发 300 条，活动还在发送中');
  const two = await cloud.run(() => Promise.all([remind.main(), remind.main()]));
  eq(two[0].newsSent + two[1].newsSent, 20, '剩下的 20 条，两次执行重叠也只发一遍');
  eq([event(big).notifyStatus, event(big).notifySent], ['done', 320], '全部发完，人数对得上');
  eq(new Set(cloud.state.sent.map((m) => m.touser)).size, 320, '每人只收到一条');

  // 登记之后活动日期过了：剩下的不发，直接收尾
  await call('adminSaveEvent', { event: { type: '赛事', title: '明天的活动', status: 'published', date: cloud.state.now + DAY } });
  const soon = cloud.col('events').find((e) => e.title === '明天的活动')._id;
  await as('user-c', 'subscribeNews', { templateId: 'tmpl' });
  await call('adminNotifyEvent', { id: soon });
  cloud.state.now += 2 * DAY;
  cloud.state.sent.length = 0;
  await tick();
  const c = cloud.col('news_subs').find((s) => s._id === 'user-c');
  eq([cloud.state.sent.length, event(soon).notifyStatus, c.sent, c.eventId], [0, undefined, false, ''], '活动已经过了就不发了，登记撤掉，人放回去，额度留给下一场');
  eq((await call('adminNotifyEvent', { id: soon })).code, 'event_ended', '过了日期的活动不能再通知');
  c.sent = true; // 后面的用例从没人订阅开始

  // 登记到一半中断了（活动记上了、人还没划好）：两分钟后收尾，当作没通知过
  cloud.col('events').push({ _id: 'half', type: '赛事', title: '登记到一半', status: 'published', date: new Date(cloud.state.now + 5 * DAY), notifyStatus: 'pending', notifyId: 'half-job', notifyAt: new Date(cloud.state.now), notifySent: 0, notifyFailed: 0 });
  await tick();
  eq(event('half').notifyStatus, 'pending', '刚登记、人还没划好：先等着');
  cloud.state.now += 3 * 60 * 1000;
  await tick();
  eq(event('half').notifyStatus, undefined, '两分钟还没划好：当作没通知过，以后还能通知');

  // 划人那一步其实做成了、但结果没传回来：登记先留着，两分钟后把人放回去并撤掉登记，之后可以重新通知
  cloud.col('events').push({ _id: 'lostack', type: '赛事', title: '结果没传回来', status: 'published', date: new Date(cloud.state.now + 6 * DAY) });
  const sub1 = () => cloud.col('news_subs').find((s) => s._id === 'q1');
  await as('q1', 'subscribeNews', { templateId: 'tmpl' });
  cloud.state.updateError = (name) => name === 'news_subs';
  r = await call('adminNotifyEvent', { id: 'lostack' });
  cloud.state.updateError = null;
  eq([r.code, event('lostack').notifyStatus, event('lostack').notifyTotal, sub1().eventId], ['server_error', 'pending', undefined, 'lostack'], '划人时出错：登记留着等收尾，人暂时在这场名下');
  cloud.state.sent.length = 0;
  await tick();
  eq([cloud.state.sent.length, event('lostack').notifyStatus], [0, 'pending'], '人数还没写上：不发，先等着');
  cloud.state.now += 3 * 60 * 1000;
  await tick();
  eq([event('lostack').notifyStatus, sub1().eventId, sub1().job, sub1().sent], [undefined, '', '', false], '两分钟后收尾：撤掉登记，人放回去，没有卡住');
  ok((await call('adminNotifyEvent', { id: 'lostack' })).ok, '之后可以重新通知');
  eq((await tick()).newsSent, 1, '重新通知后照常发出');

  // 同一个人的两个订阅请求同时进来（比如两台手机）：先到的写好并被划给了一场活动，
  // 后到的照着自己读到的旧样子写，不能把他从那场活动里挤出去
  for (const [who, seedDoc, title] of [['twin1', null, '同时订阅甲'], ['twin2', { _id: 'twin2', openid: 'twin2', templateId: 'tmpl', sent: true, status: 'sent', eventId: 'race', job: 'old' }, '同时订阅乙']]) {
    if (seedDoc) cloud.col('news_subs').push(seedDoc);
    await call('adminSaveEvent', { event: { type: '赛事', title: title, status: 'published', date: cloud.state.now + 9 * DAY } });
    const ev = cloud.col('events').find((x) => x.title === title)._id;
    cloud.state.afterGet = async (name, cond) => {
      if (!(name === 'news_subs' && cond._id === who)) return;
      cloud.state.afterGet = null;
      // 后到的请求已经读完（读到的是「没有记录」或「已经发过」），这时先到的请求写好了，管理员也点了通知
      await as(who, 'subscribeNews', { templateId: 'tmpl' });
      ok((await as('user-a', 'adminNotifyEvent', { id: ev })).ok, '管理员点了通知');
    };
    ok((await as(who, 'subscribeNews', { templateId: 'tmpl' })).ok, '后到的订阅请求照常成功');
    cloud.state.afterGet = null;
    const rec = cloud.col('news_subs').find((s) => s._id === who);
    eq([rec.sent, rec.eventId, rec.job === event(ev).notifyId], [false, ev, true], (seedDoc ? '已经发过的记录' : '还没有记录') + '：后到的请求没有把他从划好的活动里挤出去');
    cloud.state.sent.length = 0;
    eq([(await tick()).newsSent, sentTo(), event(ev).notifyStatus], [1, [who], 'done'], '这场活动照常发给他');
  }

  // 这次执行的额度被报名提醒用完了：新活动通知一条没发，不能记成「已经开始发」
  cloud.col('events').push({ _id: 'openrace', type: '赛事', title: '报名开放', status: 'published', date: new Date(cloud.state.now + 8 * DAY), signupStart: new Date(cloud.state.now - HOUR) });
  for (let i = 0; i < 300; i++) cloud.col('reminders').push({ _id: 'r' + i + '_openrace', openid: 'r' + i, eventId: 'openrace', templateId: 'tmpl', sent: false });
  cloud.col('events').push({ _id: 'nobudget', type: '赛事', title: '额度用完', status: 'published', date: new Date(cloud.state.now + 7 * DAY) });
  await as('q1', 'subscribeNews', { templateId: 'tmpl' });
  await call('adminNotifyEvent', { id: 'nobudget' });
  r = await tick();
  eq([r.sent, r.newsSent, event('nobudget').notifyStarted], [300, 0, undefined], '额度用完：新活动通知没发，也没记成开始发');
  await call('adminSetEventStatus', { id: 'nobudget', status: 'draft' });
  await tick();
  eq([event('nobudget').notifyStatus, sub1().eventId], [undefined, ''], '这时下架：当作没通知过，重新上架后还能通知');

  // 停到一半中断了（活动已经标成正在停，人还没放回去）：下一次执行接着收尾
  await call('adminSetEventStatus', { id: 'nobudget', status: 'published' });
  await call('adminNotifyEvent', { id: 'nobudget' });
  event('nobudget').notifyStatus = 'stopping';
  cloud.state.sent.length = 0;
  await tick();
  eq([event('nobudget').notifyStatus, sub1().eventId, cloud.state.sent.length], [undefined, '', 0], '停到一半的接着收尾：人放回去，登记撤掉');

  // 两次执行重叠，都看到同一场下架了的活动：前一次收尾后，管理员把它上架回来并重新通知；
  // 慢了一步的那次收尾认的是旧的登记编号，不能把新的登记停掉，也不能把划给新登记的人放走
  await call('adminNotifyEvent', { id: 'nobudget' });
  const firstJob = event('nobudget').notifyId;
  await call('adminSetEventStatus', { id: 'nobudget', status: 'draft' });
  let stops = 0;
  cloud.state.onUpdate = async (name, cond) => {
    if (!(name === 'events' && cond._id === 'nobudget' && cond.notifyStatus === 'pending' && cond.status === 'draft' && ++stops === 2)) return;
    cloud.state.onUpdate = null;
    // 慢的那次停在这里：等前一次收尾完，管理员上架并重新通知
    for (let i = 0; i < 50 && event('nobudget').notifyStatus !== undefined; i++) await new Promise((res) => setImmediate(res));
    await call('adminSetEventStatus', { id: 'nobudget', status: 'published' });
    await call('adminNotifyEvent', { id: 'nobudget' });
  };
  cloud.state.sent.length = 0;
  await cloud.run(() => Promise.all([remind.main(), remind.main()]));
  cloud.state.onUpdate = null;
  ok(event('nobudget').notifyId && event('nobudget').notifyId !== firstJob, '重新通知是一次新的登记');
  eq([stops, event('nobudget').notifyStatus, sub1().eventId, sub1().job === event('nobudget').notifyId], [2, 'pending', 'nobudget', true], '旧登记的收尾碰不到新的登记，划好的人还在');
  eq([(await tick()).newsSent, event('nobudget').notifyStatus, event('nobudget').notifySent], [1, 'done', 1], '新的登记照常发完');
}

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

  // 订阅新活动通知：点一次授权一次，订阅着的时候不再弹授权
  eq([p.data.news.title, p.data.news.action, p.data.newsOn], ['有新活动通知我', '通知我', false], '活动页有订阅新活动通知的一行，还没订阅');
  const asked = () => env.wx.__calls.filter((c) => c.api === 'requestSubscribeMessage').length;
  const askedBefore = asked();
  p.onNews();
  await tick();
  eq([p.data.newsOn, asked() - askedBefore], [true, 1], '点了以后调起订阅授权，按钮变成已订阅');
  eq(cloud.col('news_subs').map((s) => [s._id, s.templateId, s.sent]), [['user-a', 'tmpl', false]], '订阅登记到云端');
  p.onNews();
  await tick();
  eq(asked() - askedBefore, 1, '已订阅时再点不会重复弹授权');

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

    // 新活动通知：用户拒绝授权时有提示；收到一条通知之后，按钮回到没订阅的样子
    const accept = e5.wx.requestSubscribeMessage;
    e5.wx.requestSubscribeMessage = (o) => { const res = {}; o.tmplIds.forEach((id) => { res[id] = 'reject'; }); o.success(res); };
    q.onNews();
    await tick();
    eq([q.data.newsOn, e5.wx.__calls.filter((c) => c.api === 'showToast').slice(-1)[0].args.title], [false, '没订阅上，请在右上角设置里打开订阅消息'], '拒绝授权：没订阅上并提示');
    e5.wx.requestSubscribeMessage = accept;
    q.onNews();
    await tick();
    ok(q.data.newsOn, '同意授权：订阅上了');
    c5.col('news_subs')[0].sent = true; // 定时任务给他发过一条了
    await require(path.join(ROOT, 'utils/store.js')).sync();
    ok(!q.data.newsOn, '收到通知以后同步回来，按钮回到「通知我」');
  }

  // 换设备（本机没有缓存）：启动时从云端同步回来
  const env2 = createEnv({ wx: { cloud: wxCloud } });
  Object.assign(require(path.join(ROOT, 'config.js')), { cloudEnv: 'test-env', subscribeTemplateId: 'tmpl', sampleEvents: false });
  env2.launch();
  p = env2.openPage('pages/me/index', {});
  ok(!p.data.registered, '同步完成前按本机缓存显示');
  await tick();
  ok(p.data.registered && p.data.plan.saved, '同步完成后页面自动刷新成会员状态');

  // ---------- 运营后台 ----------
  const fresh = () => {
    const e = createEnv({ wx: { cloud: wxCloud } });
    Object.assign(require(path.join(ROOT, 'config.js')), { cloudEnv: 'test-env', subscribeTemplateId: 'tmpl', sampleEvents: false });
    return e;
  };
  const me = cloud.col('members').find((d) => d._id === cloud.state.openid);
  const callsOf = (e, api) => e.wx.__calls.filter((c) => c.api === api);

  // 普通会员：菜单里没有「运营后台」，硬进后台页面会被请出去
  let e3 = fresh();
  e3.launch();
  await tick();
  p = e3.openPage('pages/me/index', {});
  ok(!p.data.menu.some((m) => m.text === '运营后台'), '普通会员看不到运营后台的入口');
  p = e3.openPage('pages/admin/index', {});
  await tick();
  eq(callsOf(e3, 'switchTab').slice(-1)[0].args.url, '/pages/me/index', '普通会员进后台页面被送回「我的」');
  eq(p.data.events, [], '普通会员拿不到后台的活动列表');

  // 管理员：有入口；公告保存后，别的用户打开小程序弹一次，同一条不弹第二次
  me.admin = true;
  e3 = fresh();
  e3.launch();
  await tick();
  p = e3.openPage('pages/me/index', {});
  ok(p.data.menu.some((m) => m.text === '运营后台'), '管理员看到运营后台的入口');
  e3.tap('onMenu', { key: 'shield' });
  eq(callsOf(e3, 'navigateTo').slice(-1)[0].args.url, '/pages/admin/index', '点入口进后台');

  p = e3.openPage('pages/admin/index', {});
  await tick();
  ok(p.data.events.length >= 4 && !p.data.loading, '后台列出全部活动');
  const draftRow = p.data.events.find((x) => x.id === 'draft');
  eq([draftRow.state, draftRow.stateText], ['draft', '未上架'], '草稿显示未上架');
  e3.tap('onStatus', { id: 'draft', status: 'published' });
  await tick();
  eq(p.data.events.find((x) => x.id === 'draft').state, 'published', '点上架后列表更新');
  eq(cloud.col('events').find((x) => x._id === 'draft').status, 'published', '上架写到云端');

  // 新活动通知：上架着、还没开始的活动才有按钮；确认后登记，列表上换成进度
  const rowOf = (id) => p.data.events.find((x) => x.id === id);
  eq([rowOf('race').canNotify, rowOf('old').canNotify, p.data.subscribersText], [true, false, '1 人订阅了新活动通知'], '只有上架着、还没开始的活动能通知');
  e3.tap('onNotify', { id: 'race' });
  await tick();
  const ask = callsOf(e3, 'showModal').slice(-1)[0].args;
  ok(ask.content.includes('1 人') && ask.content.includes('只能通知一次'), '确认框里写清楚发给多少人、只能通知一次');
  ok(cloud.col('events').find((x) => x._id === 'race').notifyStatus === undefined, '没点确定就不登记');
  const plainModal = e3.wx.showModal;
  e3.wx.showModal = (o) => { e3.wx.__calls.push({ api: 'showModal', args: o }); o.success({ confirm: true }); };
  e3.tap('onNotify', { id: 'race' });
  await tick();
  e3.wx.showModal = plainModal;
  eq([callsOf(e3, 'showToast').slice(-1)[0].args.title, rowOf('race').canNotify, rowOf('race').notifyText], ['已安排，几分钟内发出', false, '通知发送中'], '确认后登记，按钮换成「通知发送中」');
  eq(cloud.col('events').find((x) => x._id === 'race').notifyStatus, 'pending', '通知登记到云端');
  cloud.col('events').find((x) => x._id === 'race').notifyStatus = 'done';
  cloud.col('events').find((x) => x._id === 'race').notifySent = 1;
  await p.loadEvents();
  eq(rowOf('race').notifyText, '已通知 1 人', '发完以后显示通知了多少人');

  // 往期的赞助赛事：列出来、加一场、改、删，活动页跟着变
  e3.tap('onTab', { key: 'past' });
  await tick();
  eq([p.data.past.length, p.data.past[0].name, /^https?:.*2026-hangang-running-festival\.jpg$/.test(p.data.past[0].src)], [4, '韩国汉江跑步节', true], '后台列出往期赛事，包里原有的照片换成了地址');
  p.onPastCreate();
  p.onPastInput({ currentTarget: { dataset: { field: 'name' } }, detail: { value: '首尔马拉松' } });
  p.onPastInput({ currentTarget: { dataset: { field: 'year' } }, detail: { value: '2027' } });
  p.onPastSave();
  eq(callsOf(e3, 'showToast').slice(-1)[0].args.title, '请选择照片', '没选照片不能保存');
  e3.wx.chooseMedia = (o) => o.success({ tempFiles: [{ tempFilePath: 'wxfile://tmp/a.jpg' }] });
  e3.wx.cloud.uploadFile = (o) => Promise.resolve({ fileID: 'cloud://test-env/' + o.cloudPath });
  p.onPastImage();
  await tick();
  ok(/^cloud:\/\/test-env\/events\//.test(p.data.pastForm.image) && !p.data.uploading, '照片传到云存储');
  p.onPastSave();
  await tick();
  eq([p.data.pastForm, p.data.past.length, p.data.past[0].name, callsOf(e3, 'showToast').slice(-1)[0].args.title], [null, 5, '首尔马拉松', '已保存'], '保存后回到列表，新的一场排在最前');
  e3.tap('onPastEdit', { id: p.data.past[0].id });
  p.onPastInput({ currentTarget: { dataset: { field: 'nameEn' } }, detail: { value: 'Seoul Marathon' } });
  p.onPastSave();
  await tick();
  eq([p.data.past.length, p.data.past[0].nameEn], [5, 'Seoul Marathon'], '编辑后列表更新');
  // 读取列表的请求还没回来时保存了一场：晚回来的那份旧列表不能把刚保存的盖掉
  {
    const real = e3.wx.cloud.callFunction;
    let held = null;
    e3.wx.cloud.callFunction = (o) => {
      const res = real(o);
      if (o.data.action !== 'adminPastEvents' || held) return res;
      // 这次读取的结果先扣住，等保存完了再放出去
      return res.then((v) => new Promise((resolve) => { held = () => resolve(v); }));
    };
    p.loadPast();
    await tick();
    e3.tap('onPastEdit', { id: p.data.past[0].id });
    p.onPastInput({ currentTarget: { dataset: { field: 'nameEn' } }, detail: { value: 'Seoul Marathon 2027' } });
    p.onPastSave();
    await tick();
    held();
    await tick();
    e3.wx.cloud.callFunction = real;
    eq(p.data.past[0].nameEn, 'Seoul Marathon 2027', '晚回来的旧列表没有盖掉刚保存的内容');
  }
  const plain2 = e3.wx.showModal;
  e3.wx.showModal = (o) => { e3.wx.__calls.push({ api: 'showModal', args: o }); o.success({ confirm: true }); };
  e3.tap('onPastDelete', { id: p.data.past[4].id });
  await tick();
  e3.wx.showModal = plain2;
  ok(callsOf(e3, 'showModal').slice(-1)[0].args.content.includes('韩国自由跑') && p.data.past.length === 4, '删除前确认，删掉后列表更新');
  {
    const q = e3.openPage('pages/events/index', {});
    await tick();
    eq(q.data.past.map((x) => x.name), ['首尔马拉松', '韩国汉江跑步节', '乌兰巴托马拉松', '蔚州九峰越野赛'], '活动页的往期用的是云端的列表');
    ok(/^cloud:\/\//.test(q.data.past[0].image) && /^https?:/.test(q.data.past[1].image), '新加的照片是云存储的文件，原有的是资源地址');
    p = e3.openPage('pages/admin/index', {});
    await tick();
  }

  e3.tap('onTab', { key: 'notice' });
  await tick();
  p.onNoticeInput({ currentTarget: { dataset: { field: 'title' } }, detail: { value: '停机维护' } });
  p.onNoticeInput({ currentTarget: { dataset: { field: 'content' } }, detail: { value: '今晚 23 点到 24 点暂停报名。' } });
  p.onNoticeToggle();
  p.onNoticeSave();
  await tick();
  eq(callsOf(e3, 'showToast').slice(-1)[0].args.title, '公告已保存', '保存公告');

  // 积分：找到会员，确认后加积分
  e3.tap('onTab', { key: 'points' });
  cloud.col('members').push({ _id: 'user-z', openid: 'user-z', phone: '13700001111', nickname: '老李', memberNo: '100777', numbered: true, points: 500, welcomeBonus: true, createdAt: new Date(cloud.state.now) });
  const other = cloud.col('members').find((d) => d._id === 'user-z');
  const beforePoints = other.points;
  p.onQueryInput({ detail: { value: other.memberNo } });
  p.onFind();
  await tick();
  eq(p.data.member.memberNo, other.memberNo, '按会员编号找到会员');
  p.onPointsInput({ currentTarget: { dataset: { field: 'amount' } }, detail: { value: '150' } });
  p.onAdjust();
  eq(callsOf(e3, 'showToast').slice(-1)[0].args.title, '请填写原因', '没写原因不能提交');
  p.onPointsInput({ currentTarget: { dataset: { field: 'reason' } }, detail: { value: '线下活动签到' } });
  // 预览环境的 showModal 不会点「确定」，这里换成会点的
  e3.wx.showModal = (o) => { e3.wx.__calls.push({ api: 'showModal', args: o }); o.success({ confirm: true }); };
  p.onAdjust();
  await tick();
  ok(callsOf(e3, 'showModal').slice(-1)[0].args.content.indexOf('加 150 积分') > 0, '确认框里写清楚加多少');
  eq(other.points, beforePoints + 150, '积分加到云端');
  eq(p.data.member.points, String(beforePoints + 150), '页面上的积分跟着更新');

  // 电脑端：取一个登录码，显示成 1234 5678 9012
  p = e3.openPage('pages/admin/index', {});
  e3.tap('onTab', { key: 'web' });
  p.onWebCode();
  await tick();
  ok(/^\d{4} \d{4} \d{4}$/.test(p.data.webCode), '取到登录码，四位一组好认');
  ok(cloud.col('admin_web').some((d) => d.kind === 'code' && d.used === false && d.openid === cloud.state.openid), '登录码记在这位管理员名下');

  // 新建活动：必填项没填有提示；填好保存后写到云端
  p = e3.openPage('pages/admin-event/index', {});
  p.onSave();
  eq(callsOf(e3, 'showToast').slice(-1)[0].args.title, '请填写名称', '没填名称不能保存');
  p.onInput({ currentTarget: { dataset: { field: 'title' } }, detail: { value: '杭州越野赛' } });
  p.onSave();
  eq(callsOf(e3, 'showToast').slice(-1)[0].args.title, '请选择活动时间', '没选时间不能保存');
  p.onTime({ currentTarget: { dataset: { field: 'date', part: 'date' } }, detail: { value: '2027-03-20' } });
  p.onTime({ currentTarget: { dataset: { field: 'date', part: 'time' } }, detail: { value: '07:30' } });
  p.onTime({ currentTarget: { dataset: { field: 'signupEnd', part: 'date' } }, detail: { value: '2027-03-10' } });
  p.onInput({ currentTarget: { dataset: { field: 'quota' } }, detail: { value: '300' } });
  p.onPublishToggle();
  p.onSave();
  await tick();
  const made = cloud.col('events').find((x) => x.title === '杭州越野赛');
  ok(made && made.status === 'published' && made.quota === 300, '新建的活动写到云端');
  eq([made.date.getHours(), made.date.getMinutes(), made.signupEnd.getHours(), made.signupEnd.getMinutes()], [7, 30, 23, 59], '活动时间按选的存；报名结束只选了日期，按当天最后一分钟');

  // 编辑：表单里是这场活动现在的内容
  p = e3.openPage('pages/admin-event/index', { id: made._id });
  await tick();
  eq([p.data.form.title, p.data.form.quota, p.data.form.published, p.data.times.date.date, p.data.times.date.time], ['杭州越野赛', '300', true, '2027-03-20', '07:30'], '编辑时填好原来的内容');

  // 换一位用户打开小程序（新开一个运行环境要放在最后：它会换掉全局的 wx）
  const e4 = fresh();
  e4.launch();
  await tick();
  let modal = callsOf(e4, 'showModal').slice(-1)[0];
  eq([modal.args.title, modal.args.content, modal.args.showCancel], ['停机维护', '今晚 23 点到 24 点暂停报名。', false], '打开小程序时弹出公告');
  const seenBefore = callsOf(e4, 'showModal').length;
  e4.app.showNotice();
  eq(callsOf(e4, 'showModal').length, seenBefore, '同一条公告不弹第二次');

  // 小程序一直没关：回到前台时隔够 5 分钟会再同步，新发的公告这时弹出来
  me.admin = true;
  cloud.state.now += 60 * 1000; // 替身的时钟不会自己走，往后拨一分钟，这次保存才是新的一版
  await cloud.run(() => api.main({ action: 'adminSaveNotice', notice: { title: '新公告', content: '回到前台时看到的', enabled: true } }));
  const shownBefore = callsOf(e4, 'showModal').length;
  e4.app.onShow();
  await tick();
  eq(callsOf(e4, 'showModal').length, shownBefore, '刚同步过，回到前台不重复取');
  e4.app.lastSync = Date.now() - 6 * 60 * 1000;
  e4.app.onShow();
  await tick();
  eq(callsOf(e4, 'showModal').slice(-1)[0].args.title, '新公告', '隔了一阵回到前台，新公告弹出来');
  me.admin = false;
}

/** 字体：资源在云存储时走「下载到本机 → Data URL」，不依赖跨域许可；任何一步失败都退回 https 地址 */
/** 购买渠道的入口：点了跳到店铺小程序里对应的商品 */
function shopTests() {
  const path = require('path');
  const root = path.resolve(__dirname, '../miniprogram');
  const file = path.join(root, 'components/shop-entry/index.js');
  const shopFile = path.join(root, 'content/shop.js');
  const jumps = [];
  const toasts = [];
  let result = null; // 下一次跳转的结果：null 是成功，否则是 fail 回调收到的 errMsg
  const realWx = global.wx;
  const realComponent = global.Component;
  global.wx = {
    vibrateShort() {},
    showToast: (o) => toasts.push(o.title),
    navigateToMiniProgram: (o) => { jumps.push(o.shortLink); if (result) o.fail({ errMsg: result }); }
  };
  /** 按给定的链接配置加载组件，返回一个能调方法的实例 */
  const make = (links, props) => {
    [file, shopFile].forEach((f) => { delete require.cache[f]; });
    const shop = require(shopFile);
    const saved = Object.assign({}, shop.links);
    Object.assign(shop.links, links);
    let def = null;
    global.Component = (d) => { def = d; };
    require(file);
    Object.assign(shop.links, saved);
    const inst = Object.assign({ data: Object.assign({}, def.data, { product: '', dark: false, bare: false }, props) }, def.methods);
    inst.setData = (d) => Object.assign(inst.data, d);
    if (props && props.product) def.observers.product.call(inst, props.product);
    return inst;
  };
  try {
    const both = { 'energy-gel': '#小程序://店铺/商品/basic', 'energy-gel-pro': '#小程序://店铺/商品/pro' };

    // 产品详情页：直接跳这一款
    let c = make(both, { product: 'energy-gel-pro' });
    c.open();
    eq([jumps.slice(-1)[0], c.data.choosing, c.data.available], ['#小程序://店铺/商品/pro', false, true], '产品页的入口直接跳到这款的商品页');

    // 首页、「我的」：两款都有链接时先让用户选
    c = make(both, {});
    const before = jumps.length;
    c.open();
    eq([c.data.choosing, jumps.length - before, c.data.options.map((o) => o.name)], [true, 0, ['能量胶BASIC', '能量胶PRO']], '没指定产品、两款都有链接：弹出来选一款');
    c.onChoose({ currentTarget: { dataset: { id: 'energy-gel' } } });
    eq([c.data.choosing, jumps.slice(-1)[0]], [false, '#小程序://店铺/商品/basic'], '选了以后跳到那一款');

    // 两款用的是同一条链接（店铺里一个商品页能选两款）：不用选，直接跳
    c = make({ 'energy-gel': '#小程序://店铺/商品/all', 'energy-gel-pro': '#小程序://店铺/商品/all' }, {});
    c.open();
    eq([c.data.choosing, jumps.slice(-1)[0]], [false, '#小程序://店铺/商品/all'], '两款是同一条链接：直接跳，不弹出来选');

    // 只填了一款的链接：不用选，直接跳；没填的那款在它的产品页上不显示入口
    c = make({ 'energy-gel': '', 'energy-gel-pro': '#小程序://店铺/商品/pro' }, {});
    c.open();
    eq([c.data.choosing, jumps.slice(-1)[0]], [false, '#小程序://店铺/商品/pro'], '只有一款有链接：直接跳');
    c = make({ 'energy-gel': '', 'energy-gel-pro': '#小程序://店铺/商品/pro' }, { product: 'energy-gel' });
    const n = jumps.length;
    c.open();
    eq([c.data.available, jumps.length], [false, n], '这款没填链接：入口不显示，也不会跳');

    // 用户在微信的确认框里点了取消：不提示；别的原因没打开：提示一句
    c = make(both, { product: 'energy-gel' });
    result = 'navigateToMiniProgram:fail cancel';
    c.open();
    eq(toasts.length, 0, '用户取消跳转：不提示');
    result = 'navigateToMiniProgram:fail invalid shortLink';
    c.open();
    eq(toasts, ['没打开，请稍后再试'], '没打开：提示一句');

    // 线上的配置：填了的链接都是「#小程序://」开头
    delete require.cache[shopFile];
    // 页面上给用户看的字里不出现店铺的名字（店铺是别的渠道，只带路不宣传）
    const copy = require(shopFile);
    ok(!/海纳|优惠/.test(JSON.stringify([copy.card, copy.menu, copy.sheet, copy.failed])), '入口的文案里不写店铺的名字，也不提优惠');
    const live = copy.links;
    ok(Object.keys(live).every((k) => ['energy-gel', 'energy-gel-pro'].includes(k) && (live[k] === '' || live[k].indexOf('#小程序://') === 0)), '配置里的链接格式对');
  } finally {
    global.wx = realWx;
    global.Component = realComponent;
    [file, shopFile].forEach((f) => { delete require.cache[f]; });
  }
}

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
  shopTests();
  await functionTests();
  await adminTests();
  await webTests();
  await signupFailureTests();
  await remindTests();
  await newsTests();
  await pastTests();
  await clientTests();
  console.log('云开发测试通过：' + n + ' 项');
  process.exit(0);
})().catch((e) => { console.log(e); process.exit(1); });
