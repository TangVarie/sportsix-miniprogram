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

const FORM = [
  { id: 'name', kind: 'text', label: '姓名', required: true },
  { id: 'gender', kind: 'single', label: '性别', required: true, options: ['男', '女'] },
  { id: 'idno', kind: 'idno', label: '证件号码', required: true },
  { id: 'gel', kind: 'multi', label: '想试的补给', required: false, options: ['能量胶BASIC', '能量胶PRO'] }
];
const input = (page, id, value) => page.onInput({ currentTarget: { dataset: { id: id } }, detail: { value: value } });
const option = (page, id, value) => page.onOption({ currentTarget: { dataset: { id: id, option: value } } });

/** 有报名表的活动：点报名先去填表；没填齐、没勾同意都不提交；填好了和报名一起交；报名后能改 */
async function signupFormFlow() {
  const event = record('f', { form: FORM });
  const s = session({ member: { nickname: '会员', points: 500, memberNo: '100001' }, events: [event] });
  let mine = null;
  s.handlers.event = () => ({ event, readOnly: false, mine: mine, live: [{ id: 'w1', title: '幸运大转盘', kind: 'wheel', eventId: 'f' }] });
  s.handlers.signup = (data) => { mine = { answers: data.answers, complete: true }; return { eventId: data.eventId, member: s.options.member }; };
  s.handlers.saveAnswers = (data) => ({ answers: data.answers, complete: true });
  const detail = s.env.openPage('pages/event-detail/index', { id: 'f' });
  await tick();
  eq(detail.data.live.map((x) => x.id), ['w1'], '活动详情显示这场的现场互动');
  eq(detail.data.form, null, '没报名时不显示报名表卡片');
  detail.onSignup();
  eq(s.env.wx.__calls.filter((c) => c.api === 'navigateTo').pop().args.url, '/pages/signup-form/index?id=f', '有报名表的活动点报名先去填表');
  eq(s.calls.filter((c) => c.action === 'signup').length, 0, '去填表时还没报名');

  const form = s.env.openPage('pages/signup-form/index', { id: 'f' });
  await tick();
  eq([form.data.mode, form.data.fields.length], ['signup', 4], '报名表按活动上的项显示');
  form.onSubmit();
  ok(form.data.fields.filter((f) => f.error).map((f) => f.id).join() === 'name,gender,idno', '没填的必填项标出来');
  eq(s.env.wx.__calls.filter((c) => c.api === 'showToast').pop().args.title, form.data.copy.errors.missing, '提示还有必填项没填');
  input(form, 'name', ' 王小明 ');
  option(form, 'gender', '男');
  option(form, 'gel', '能量胶PRO');
  input(form, 'idno', '110105194912310021');
  form.onSubmit();
  eq(s.env.wx.__calls.filter((c) => c.api === 'showToast').pop().args.title, form.data.copy.errors.idno, '身份证号最后一位不对，提交前就拦下');
  input(form, 'idno', '11010519491231002x');
  form.onSubmit();
  eq(s.env.wx.__calls.filter((c) => c.api === 'showToast').pop().args.title, form.data.copy.needAgree, '没勾同意隐私政策不提交');
  eq(s.calls.filter((c) => c.action === 'signup').length, 0, '前面几次都没提交');
  form.onAgree();
  form.onSubmit();
  await tick();
  const call = s.calls.filter((c) => c.action === 'signup').pop();
  eq(call.answers, { name: '王小明', gender: '男', idno: '11010519491231002X', gel: ['能量胶PRO'] }, '整理好的回答和报名一起交');
  eq(call.templateId, 'tmpl', '提交这一下请求订阅');
  const events = require(path.join(ROOT, 'utils/events.js'));
  const store = require(path.join(ROOT, 'utils/store.js'));
  ok(store.hasSignup('f') && events.getSignupForm('f').complete, '报上名，记下已填好');
  form.onUnload();
  detail.render();
  eq([detail.data.form.todo, detail.data.form.button], [false, detail.data.form.button], '报名后详情里有报名表卡片');
  ok(!detail.data.form.todo, '填齐了不提示补填');

  // 报名后改：不再报名，只改报名表
  const edit = s.env.openPage('pages/signup-form/index', { id: 'f' });
  await tick();
  eq([edit.data.mode, edit.data.fields.find((f) => f.id === 'name').value], ['edit', '王小明'], '再进来是修改，带着填过的内容');
  input(edit, 'name', '王大明');
  edit.onSubmit();
  await tick();
  eq(s.calls.filter((c) => c.action === 'signup').length, 1, '修改不会再报一次名');
  eq(s.calls.filter((c) => c.action === 'saveAnswers').pop().answers.name, '王大明', '修改交给 saveAnswers');
  edit.onUnload();

  // 旧版本报的名没填表：详情里提示补填
  mine = { answers: {}, complete: false };
  await detail.onRetry();
  eq(detail.data.form.todo, true, '没填齐时提示去补填');
  detail.onUnload();
}

/** 现场互动：扫码进来；只给会员的先去加入再回来；抽奖按云端结果转，次数用完了点了有提示 */
async function interactFlow() {
  const s = session({ events: [] });
  const item = { id: 'w1', kind: 'wheel', title: '幸运大转盘', note: '', eventId: '', audience: 'member', open: true, tries: 1,
    prizes: [{ id: 'p1', name: '运动毛巾' }, { id: 'p2', name: '帽子' }] };
  let blocked = 'not_member';
  let results = [];
  s.handlers.interaction = () => ({ interaction: item, blocked: blocked, mine: { used: results.length, tries: 1, left: 1 - results.length, results: results } });
  s.handlers.draw = () => {
    results = [{ n: 1, win: true, prizeName: '帽子', code: '123456', redeemed: false, at: Date.now() }];
    return { result: { n: 1, win: true, prizeId: 'p2', prizeName: '帽子', code: '123456' }, mine: { used: 1, tries: 1, left: 0, results: results } };
  };
  const page = s.env.openPage('pages/interact/index', { scene: encodeURIComponent('w1') });
  page.onShow();
  await tick();
  eq([page.data.item.id, page.data.blocked, page.data.wheel.labels.length], ['w1', 'not_member', 8], '扫码进来按 scene 打开互动，两个奖品各配一格谢谢参与，不到 6 格整组重复');
  page.onDraw();
  eq(s.calls.filter((c) => c.action === 'draw').length, 0, '还不是会员时不抽');
  eq(s.env.wx.__calls.filter((c) => c.api === 'showToast').pop().args.title, page.data.copy.errors.not_member, '点了说明要先加入');
  page.onBlocked();
  eq(s.env.wx.__calls.filter((c) => c.api === 'switchTab').pop().args.url, '/pages/me/index', '去加入会员');
  page.onUnload();
  const me = s.env.openPage('pages/me/index');
  await require(path.join(ROOT, 'utils/store.js')).register('phone-code').then((r) => me.afterRegister(r));
  await tick();
  eq(s.env.wx.__calls.filter((c) => c.api === 'navigateTo').pop().args.url, '/pages/interact/index?id=w1', '加入后回到这个互动');
  me.onUnload();

  blocked = '';
  const again = s.env.openPage('pages/interact/index', { id: 'w1' });
  again.onShow();
  await tick();
  const timers = [];
  const realTimeout = global.setTimeout;
  global.setTimeout = (fn) => { timers.push(fn); return 0; };
  try {
    again.onDraw();
    await tick();
    eq(s.calls.filter((c) => c.action === 'draw').length, 1, '会员点了就抽');
    ok(again.data.spinning && again.data.rotation >= 360 * 6, '转盘至少转 6 圈');
    // 停下时指针（正上方）落在「帽子」那一格
    const size = 360 / again.segments.length;
    const at = ((360 - (again.data.rotation % 360)) % 360);
    eq(again.segments[Math.floor(at / size)].prizeId, 'p2', '停在抽中的奖品上');
    timers.forEach((fn) => fn());
  } finally { global.setTimeout = realTimeout; }
  const modal = s.env.wx.__calls.filter((c) => c.api === 'showModal').pop().args;
  ok(modal.title === again.data.copy.wheel.winTitle && modal.content.includes('123456') && modal.content.includes('帽子'), '转完弹出结果和领奖码');
  eq([again.data.spinning, again.data.mine.left, again.data.mine.results[0].code], [false, 0, '123456'], '记录里有领奖码，次数用完');
  again.onDraw();
  eq(s.calls.filter((c) => c.action === 'draw').length, 1, '次数用完不再抽');
  eq(s.env.wx.__calls.filter((c) => c.api === 'showToast').pop().args.title, again.data.copy.wheel.noLeft, '点了说明次数用完了');
  again.onUnload();

  // 没带 id（旧的转发卡片）：打开正在进行的那一个；没有进行中的就说没有
  s.handlers.events = () => ({ events: [], live: [{ id: 'w1', title: '幸运大转盘', kind: 'wheel', eventId: '' }] });
  const bare = s.env.openPage('pages/interact/index', {});
  bare.onShow();
  await tick();
  eq(bare.data.item && bare.data.item.id, 'w1', '没带 id 时打开正在进行的互动');
  bare.onUnload();
  s.handlers.events = () => ({ events: [], live: [] });
  require(path.join(ROOT, 'utils/events.js')).refresh(true);
  await tick();
  const none = s.env.openPage('pages/interact/index', {});
  none.onShow();
  await tick();
  eq([none.data.item, none.data.error], [null, 'none'], '没有进行中的互动时说明，不报错');
  none.onUnload();
  const list = s.env.openPage('pages/events/index');
  list.onShow();
  await tick();
  eq(list.data.live, [], '互动关掉后活动页没有入口');
  s.handlers.events = () => ({ events: [], live: [{ id: 'w1', title: '幸运大转盘', kind: 'wheel', eventId: '' }] });
  await list.onRetry();
  eq(list.data.live.map((x) => x.id), ['w1'], '打开后活动页出现入口');
  list.onLive({ currentTarget: { dataset: { id: 'w1' } } });
  eq(s.env.wx.__calls.filter((c) => c.api === 'navigateTo').pop().args.url, '/pages/interact/index?id=w1', '点入口进互动页');
  list.onUnload();
}

/** 手机端后台：按模块拼报名表、建大转盘、核销领奖码，交给云端的数据对不对 */
async function adminToolsFlow() {
  const admin = { nickname: '运营', points: 0, memberNo: '100001', admin: true };
  const s = session({ member: admin, events: [record('a', { form: FORM }), record('b')] });
  s.handlers.adminEvents = () => ({ events: s.options.events, newsWaiting: 0 });
  s.handlers.adminSaveEvent = (data) => ({ event: Object.assign({ id: 'new' }, data.event) });
  const editor = s.env.openPage('pages/admin-event/index', {});
  await tick();
  eq(editor.data.copyNames, ['活动 a'], '别的活动的报名表可以沿用');
  const add = (key) => editor.onFieldAdd({ currentTarget: { dataset: { key: key } } });
  add('name'); add('gender'); add('single'); add('idno');
  eq(editor.data.form.fields.map((f) => [f.kind, f.label]), [['text', '姓名'], ['single', '性别'], ['single', ''], ['idno', '证件号码']], '按模块加项，预先填好标题');
  ok(editor.data.hasIdno, '有证件号码时提醒是敏感信息');
  editor.onInput({ currentTarget: { dataset: { field: 'title' } }, detail: { value: '新活动' } });
  editor.onTime({ currentTarget: { dataset: { field: 'date', part: 'date' } }, detail: { value: '2030-01-01' } });
  editor.onSave();
  eq(s.calls.filter((c) => c.action === 'adminSaveEvent').length, 0, '单选题没写标题和选项时不保存');
  editor.onFieldInput({ currentTarget: { dataset: { index: 2, field: 'label' } }, detail: { value: '参加过几次' } });
  editor.onFieldInput({ currentTarget: { dataset: { index: 2, field: 'optionsText' } }, detail: { value: '第一次\n 两到三次 \n\n更多' } });
  editor.onFieldMove({ currentTarget: { dataset: { index: 3, to: 'up' } } });
  editor.onFieldRequired({ currentTarget: { dataset: { index: 0 } } });
  editor.onSave();
  await tick();
  const saved = s.calls.filter((c) => c.action === 'adminSaveEvent').pop().event.form;
  eq(saved.map((f) => [f.kind, f.label, f.required, f.options]), [
    ['text', '姓名', false, undefined], ['single', '性别', true, ['男', '女']], ['idno', '证件号码', true, undefined], ['single', '参加过几次', true, ['第一次', '两到三次', '更多']]
  ], '报名表按调好的顺序和必填交上去，选项一行一个');
  ok(saved.every((f) => /^[a-zA-Z0-9_-]{1,24}$/.test(f.id)), '每项有 id');
  editor.onUnload();

  const copy = s.env.openPage('pages/admin-event/index', {});
  await tick();
  copy.onFieldCopy({ detail: { value: 0 } });
  eq(copy.data.form.fields.map((f) => f.label), FORM.map((f) => f.label), '沿用别的活动的报名表');
  ok(copy.data.form.fields.every((f) => FORM.every((g) => g.id !== f.id)), '沿用过来的每项换了新 id');
  copy.onUnload();

  s.handlers.adminSaveInteraction = (data) => ({ interaction: Object.assign({ id: 'w1', status: 'off', version: 1 }, data.interaction) });
  s.handlers.adminInteractions = () => ({ interactions: [] });
  const ix = s.env.openPage('pages/admin-interact/index', {});
  await tick();
  eq(ix.data.form.audience, 'member', '新建的互动默认只给会员');
  const set = (field, value) => ix.onInput({ currentTarget: { dataset: { field: field } }, detail: { value: value } });
  const prize = (i, field, value) => ix.onPrizeInput({ currentTarget: { dataset: { index: i, field: field } }, detail: { value: value } });
  set('title', '幸运大转盘');
  prize(0, 'name', '毛巾'); prize(0, 'total', '10'); prize(0, 'chance', '60');
  ix.onPrizeAdd();
  prize(1, 'name', '帽子'); prize(1, 'total', '5'); prize(1, 'chance', '50');
  ix.onSave();
  eq(s.calls.filter((c) => c.action === 'adminSaveInteraction').length, 0, '机会加起来超过 100% 不保存');
  prize(1, 'chance', '12.5');
  ok(ix.data.chanceText.includes('72.5') && ix.data.chanceText.includes('27.5'), '实时算出合计和谢谢参与的机会');
  ix.onSave();
  await tick();
  const x = s.calls.filter((c) => c.action === 'adminSaveInteraction').pop().interaction;
  eq([x.kind, x.title, x.tries, x.prizes.map((p) => [p.name, p.total, p.chance])], ['wheel', '幸运大转盘', 1, [['毛巾', 10, 60], ['帽子', 5, 12.5]]], '数字转好交上去');
  ix.onUnload();

  let redeemed = false;
  s.handlers.adminDraws = () => ({ interaction: { id: 'w1', title: '幸运大转盘' }, draws: 9, wins: [
    { id: 'd1', prizeName: '帽子', code: '123456', redeemed: redeemed, at: Date.now(), memberNo: '100002', nickname: '小王', phone: '13800001234' },
    { id: 'd2', prizeName: '毛巾', code: '654321', redeemed: false, at: Date.now(), memberNo: '', nickname: '', phone: '' }
  ] });
  s.handlers.adminRedeem = (data) => { redeemed = data.redeemed; return { id: data.id, redeemed: redeemed, already: false }; };
  const dw = s.env.openPage('pages/admin-draws/index', { id: 'w1' });
  await tick();
  ok(dw.data.countText.includes('9') && dw.data.shown.length === 2, '中奖名单和抽奖次数');
  dw.onQuery({ detail: { value: '1234' } });
  eq(dw.data.shown.map((x) => x.code), ['123456'], '按领奖码筛');
  eq(dw.data.list[1].who, dw.data.copy.notMember, '不是会员的写明');
  const realModal = s.env.wx.showModal;
  s.env.wx.showModal = (o) => o.success({ confirm: true });
  try {
    dw.onRedeem({ currentTarget: { dataset: { id: 'd1' } } });
    await tick();
  } finally { s.env.wx.showModal = realModal; }
  eq(s.calls.filter((c) => c.action === 'adminRedeem').pop(), { action: 'adminRedeem', id: 'd1', redeemed: true }, '确认后核销');
  eq(dw.data.list[0].redeemed, true, '核销后重读，显示已领取');
  dw.onUnload();
}

(async () => {
  await adminToolsFlow();
  await signupFormFlow();
  await interactFlow();
  await activityFailureAndRetry();
  await directDetailAndLoginReturn();
  await historyAndReadOnly();
  await pointsAndHomeRefresh();
  await historyReturnIgnoresOlderFlight();
  await snapshotsAndBoundaries();
  console.log('用户流程恢复测试通过：' + checks + ' 项');
})().catch((e) => { console.error(e); process.exitCode = 1; });
