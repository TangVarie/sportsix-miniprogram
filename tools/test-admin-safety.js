#!/usr/bin/env node
/** 后台故障路径：不访问云端，验证慢读/失败、冲突、未保存提醒和积分重试去重。 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const helpers = require('../miniprogram/utils/admin.js');
const copy = require('../miniprogram/content/admin.js');

let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
const same = (actual, expected, message) => { assert.deepStrictEqual(actual, expected, message); checks++; };
const flush = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function pageFor(route, overrides) {
  const state = { confirm: true, navigated: 0, toasts: [], alert: false, modals: [] };
  const wx = {
    hideShareMenu() {},
    showToast(o) { state.toasts.push(o.title); },
    showModal(o) { state.modals.push(o); o.success({ confirm: state.confirm }); },
    enableAlertBeforeUnload() { state.alert = true; },
    disableAlertBeforeUnload() { state.alert = false; },
    navigateBack() { state.navigated++; }
  };
  global.wx = wx;
  const admin = Object.assign({}, helpers, overrides);
  let page;
  const file = path.resolve(__dirname, '../miniprogram/pages', route, 'index.js');
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    require(name) {
      if (name === '../../utils/admin.js') return admin;
      if (name === '../../utils/store.js') return { getMember: () => ({ admin: true }) };
      if (name === '../../utils/events.js') return { refresh() {}, setPast() {} };
      if (name === '../../utils/page.js') return { baseData: () => ({}), headerTone() {}, tick() {}, TABS: {}, go() { state.navigated++; } };
      return require(path.resolve(path.dirname(file), name));
    },
    Page(p) { page = p; }, wx, console, Date, getCurrentPages: () => [{}, {}], setTimeout() {}
  }, { filename: file });
  page.data = JSON.parse(JSON.stringify(page.data));
  page.setData = (d) => {
    Object.keys(d).forEach((key) => {
      const parts = key.split('.');
      let target = page.data;
      parts.slice(0, -1).forEach((k) => { target = target[k]; });
      target[parts[parts.length - 1]] = d[key];
    });
  };
  return { page, admin, state };
}

const input = (field, value) => ({ currentTarget: { dataset: { field } }, detail: { value } });

async function noticeTests() {
  const read = deferred(); let writes = 0;
  const p = pageFor('admin', { getNotice: () => read.promise, saveNotice: async (n) => { writes++; return n; } });
  const loading = p.page.loadNotice();
  p.page.onNoticeInput(input('title', '不能提前输入'));
  p.page.onNoticeToggle();
  p.page.onNoticeSave();
  same(writes, 0, '公告读取中，硬调保存也不能覆盖线上内容');
  same(p.page.data.notice.title, '', '读取中不接受输入');
  check(!p.page.data.notice.enabled, '读取中不接受开关操作');
  read.reject({ code: 'server_error' }); await loading;
  check(p.page.data.noticeFailed && !p.page.data.noticeLoaded, '读取失败有独立错误状态');
  p.page.onNoticeSave(); same(writes, 0, '读取失败时仍不能保存');
  p.admin.getNotice = async () => ({ title: '原公告', content: '原内容', enabled: true });
  await p.page.onNoticeRetry();
  same(p.page.data.notice.title, '原公告', '重试读取真正的公告');
  p.page.onNoticeInput(input('content', '改过的内容'));
  check(p.state.alert, '改动启用原生返回提醒');
  p.state.confirm = false; p.page.onBack();
  same(p.state.navigated, 0, '取消离开，草稿保留');
  same(p.page.data.notice.content, '改过的内容', '取消离开不清除表单');
  await p.page.onNoticeSave();
  same(writes, 1, '已读到的公告可以保存');
  check(!p.state.alert, '保存成功清除未保存提醒');
  p.page.onBack(); same(p.state.navigated, 1, '保存后的返回无需再确认');
}

async function editorTests() {
  const read = deferred(); let saves = 0, submitted;
  const event = { id: 'race', version: 7, type: '赛事', title: '原活动', date: new Date('2027-05-20T08:00:00Z').getTime(), status: 'draft', cost: 0 };
  const p = pageFor('admin-event', {
    listEvents: () => read.promise,
    saveEvent: async (id, data, version) => { saves++; submitted = { id, data, version }; throw { code: 'conflict' }; }
  });
  p.page.onLoad({ id: 'race' });
  p.page.onInput(input('title', '提前输入')); p.page.onSave();
  same(saves, 0, '活动没读到之前不能保存');
  same(p.page.data.form.title, '', '活动没读到之前不能修改');
  read.reject({ code: 'server_error' }); await flush();
  check(p.page.data.loadFailed && !p.page.data.loaded, '活动读取失败可重试');
  p.admin.listEvents = async () => [event]; p.page.onRetry(); await flush();
  same(p.page.data.form.title, '原活动', '重试载入原活动');
  p.page.onInput(input('title', '我的修改'));
  await p.page.onSave();
  same(submitted.version, 7, '保存携带读取到的版本');
  check(p.page.data.conflict && p.page.data.form.title === '我的修改', '冲突保留草稿并显示状态');
  p.page.onSave(); same(saves, 1, '冲突后不会反复盲写');
  p.state.confirm = false; p.page.onRetry(); await flush();
  same(p.page.data.form.title, '我的修改', '放弃重读时保留草稿');
  p.state.confirm = true;
  p.admin.listEvents = async () => [Object.assign({}, event, { version: 8, title: '别人修改' })];
  p.page.onRetry(); await flush();
  same(p.page.data.form.title, '别人修改', '确认丢弃后读取最新内容');
  check(!p.page.data.conflict && p.page.version === 8, '重读更新版本并解除冲突');
  p.page.onInput(input('quota', '-1')); await p.page.onSave();
  same(saves, 1, '负名额不能被转换成不限名额');
  p.page.onInput(input('quota', '1.5')); await p.page.onSave();
  same(saves, 1, '小数名额不能被截成整数');
  p.page.onInput(input('quota', '')); p.page.onInput(input('cost', '-5')); await p.page.onSave();
  same(saves, 1, '负积分不能被转换成免费');
  same(helpers.eventError({ title: '活动', date: 1000, cost: 0, memberSignupStart: 800, signupStart: 700 }), 'bad_signup_time', '会员提前时间不能晚于公开开始');
  same(helpers.eventError({ title: '活动', date: 1000, cost: 0, signupEnd: 1001 }), 'bad_signup_time', '报名结束不晚于活动时间');
}

async function adjustmentTests() {
  const calls = []; let fail = true;
  const p = pageFor('admin', { adjustPoints: async (...args) => {
    calls.push(args);
    if (fail) throw { code: 'network' };
    return { memberNo: '100001', nickname: '会员', points: 510 };
  } });
  p.page.setData({ member: { memberNo: '100001', name: '会员' }, amount: '10', reason: '签到' });
  p.page.onAdjust(); await flush();
  p.page.onAdjust(); await flush();
  same(calls.length, 2, '失败后允许主动重试');
  check(calls[0][3] && calls[0][3] === calls[1][3], '相同参数失败重试复用operationId');
  p.page.onPointsInput(input('reason', '补签到')); p.page.onAdjust(); await flush();
  check(calls[2][3] !== calls[1][3], '参数改变生成新operationId');
  fail = false; p.page.onAdjust(); await flush();
  same(calls[2][3], calls[3][3], '修改后的不确定操作仍可复用重试');
  p.page.setData({ amount: '10', reason: '补签到' }); p.page.onAdjust(); await flush();
  check(calls[4][3] !== calls[3][3], '成功后相同参数的新操作有新ID');
  p.page.setData({ amount: '1.5' }); p.page.onAdjust();
  same(calls.length, 5, '积分小数输入不能被截断执行');
}

async function rosterTests() {
  let cancelled = 0;
  const p = pageFor('admin-signups', {
    signups: async () => { throw { code: 'network' }; },
    cancelEvent: async () => { cancelled++; }
  });
  p.page.onLoad({ id: 'race' }); await flush();
  check(p.page.data.loadFailed && !p.page.data.loaded, '名单失败与空名单区分');
  p.page.onCancelEvent(); await flush();
  same(cancelled, 0, '未读取名单时不能用空人数确认取消整场');
  p.admin.signups = async () => ({ event: { title: '活动' }, signups: [], total: 0 });
  await p.page.onRetry();
  check(p.page.data.loaded && !p.page.data.loadFailed, '名单重试恢复可用');
}

/** 可选真实浏览器验证；SDK全部替换为本机接口，不连接生产环境。 */
async function browserTests() {
  const http = require('http');
  const { launchChromium } = require('./browser.js');
  const html = fs.readFileSync(path.resolve(__dirname, '../web-admin/index.html'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const calls = [], errors = [];
  let blockRead = null, eventError = false, conflict = false, noticeError = false, rosterError = false, pointsError = true;
  let event = { id: 'race', version: 7, type: '赛事', title: '测试赛事', date: new Date('2027-05-20T08:00:00Z').getTime(), status: 'published', cost: 0 };
  const notice = { title: '原公告', content: '原内容', enabled: true };
  const member = { memberNo: '100001', nickname: '测试会员', phoneMasked: '138****1234', points: 500 };
  try {
    browser = await launchChromium();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(() => localStorage.setItem('sx_admin_token', 'test-session'));
    await page.exposeFunction('__adminCall', async (d) => {
      calls.push(d);
      const ok = (data) => ({ ok: true, data });
      if (d.action === 'webMe') return ok({ name: '管理员' });
      if (d.action === 'adminEvents') {
        if (blockRead) await blockRead.promise;
        if (eventError) return { ok: false, code: 'server_error' };
        return ok({ events: [event], newsWaiting: 0 });
      }
      if (d.action === 'adminSaveEvent') {
        if (conflict) return { ok: false, code: 'conflict' };
        event = Object.assign({}, event, d.event, { version: event.version + 1 });
        return ok({ event });
      }
      if (d.action === 'adminNotice') return noticeError ? { ok: false, code: 'server_error' } : ok({ notice });
      if (d.action === 'adminSaveNotice') { Object.assign(notice, d.notice); return ok({ notice }); }
      if (d.action === 'adminSignups') return rosterError ? { ok: false, code: 'server_error' } : ok({ event, signups: [], total: 0 });
      if (d.action === 'adminFindMember') return ok({ member });
      if (d.action === 'adminAdjustPoints') {
        if (pointsError) return { ok: false, code: 'server_error' };
        return ok({ member: Object.assign({}, member, { points: 510 }) });
      }
      throw new Error('Unexpected action ' + d.action);
    });
    await page.route('**/sdk/**/cloud.js', (route) => route.fulfill({ contentType: 'text/javascript', body:
      'window.cloud={Cloud:function(){this.init=function(){return Promise.resolve()};this.callFunction=function(p){return window.__adminCall(p.data).then(function(result){return {result:result}})}}};' }));
    await page.goto('http://127.0.0.1:' + server.address().port);
    const row = () => page.locator('#ev-rows tr').first();
    await page.waitForSelector('#ev-rows tr');
    blockRead = deferred(); eventError = true;
    await row().getByText('编辑', { exact: true }).click();
    check(await page.isDisabled('#f-title'), '网页编辑读取中字段禁用');
    check(await page.isDisabled('#drawer-save'), '网页编辑读取中禁止保存');
    await page.evaluate(() => document.getElementById('drawer').requestSubmit());
    same(calls.filter((d) => d.action === 'adminSaveEvent').length, 0, '网页读取中硬提交不写入');
    blockRead.resolve(); blockRead = null;
    await page.waitForSelector('#drawer-retry:not([hidden])');
    eventError = false;
    await page.click('#drawer-retry');
    await page.waitForFunction(() => !document.getElementById('drawer-save').disabled);
    same(await page.inputValue('#f-title'), '测试赛事', '网页读取失败重试恢复');
    await page.fill('#f-title', '保留我的修改'); conflict = true;
    await page.click('#drawer-save');
    await page.waitForSelector('#drawer-retry:not([hidden])');
    same(await page.inputValue('#f-title'), '保留我的修改', '网页冲突保留草稿');
    same(calls.filter((d) => d.action === 'adminSaveEvent').at(-1).version, 7, '网页保存传递版本');
    check(await page.isDisabled('#drawer-save'), '网页冲突后暂停保存');
    page.once('dialog', (d) => d.dismiss()); await page.keyboard.press('Escape');
    check(await page.isVisible('#drawer'), '网页Esc取消丢弃后保留表单');
    page.once('dialog', (d) => d.dismiss()); await page.click('#drawer-mask', { position: { x: 10, y: 100 } });
    check(await page.isVisible('#drawer'), '网页遮罩取消丢弃后保留表单');
    event = Object.assign({}, event, { title: '别人改过', version: 8 }); conflict = false;
    page.once('dialog', (d) => d.accept()); await page.click('#drawer-retry');
    await page.waitForFunction(() => !document.getElementById('drawer-save').disabled);
    same(await page.inputValue('#f-title'), '别人改过', '网页确认重读载入最新版本');
    await page.fill('#f-title', '最终标题'); await page.click('#drawer-save');
    await page.waitForSelector('#drawer', { state: 'hidden' });
    same(calls.filter((d) => d.action === 'adminSaveEvent').at(-1).version, 8, '网页重读后使用新版本保存');

    noticeError = true; await page.click('[data-tab="notice"]');
    await page.waitForSelector('#notice-retry:not([hidden])');
    check(await page.isDisabled('#notice-save'), '网页公告失败时禁止覆盖');
    noticeError = false; await page.click('#notice-retry');
    await page.waitForFunction(() => !document.getElementById('notice-save').disabled);
    await page.fill('#notice-content', '已修改内容'); await page.click('#notice-save');
    await page.waitForFunction(() => document.getElementById('toast').textContent === '公告已保存');
    await page.click('[data-tab="events"]');
    await page.waitForSelector('#ev-rows tr'); rosterError = true;
    await row().getByText('名单', { exact: true }).click();
    await page.waitForSelector('#roster-retry:not([hidden])');
    check(await page.isDisabled('#roster-cancel-event'), '网页名单读取失败不能盲目取消整场');
    rosterError = false; await page.click('#roster-retry');
    await page.waitForFunction(() => !document.getElementById('roster-cancel-event').disabled);
    check(await page.isVisible('#roster-empty'), '网页名单重试可以显示真实空名单');
    await page.click('#roster-close');

    await page.click('[data-tab="points"]'); await page.fill('#find-query', '100001'); await page.click('#find-submit');
    await page.waitForSelector('#adjust-form:not([hidden])');
    await page.fill('#adj-amount', '10'); await page.fill('#adj-reason', '签到');
    page.once('dialog', (d) => d.accept()); await page.click('#adj-submit');
    await page.waitForFunction(() => !document.getElementById('adj-submit').disabled);
    pointsError = false;
    page.once('dialog', (d) => d.accept()); await page.click('#adj-submit');
    await page.waitForFunction(() => document.getElementById('m-points').textContent === '510');
    const adjustments = calls.filter((d) => d.action === 'adminAdjustPoints');
    check(adjustments[0].operationId && adjustments[0].operationId === adjustments[1].operationId, '网页不确定结果重试复用operationId');
    same(errors, [], '网页新增保护流程没有脚本错误');
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

(async () => {
  await noticeTests(); await editorTests(); await adjustmentTests(); await rosterTests();
  if (process.argv.includes('--web')) await browserTests();
  delete global.wx;
  console.log('后台故障路径测试通过：' + checks + ' 项');
})().catch((e) => { console.error(e); process.exitCode = 1; });
