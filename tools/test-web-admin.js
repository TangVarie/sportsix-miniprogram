#!/usr/bin/env node
/**
 * 电脑端后台（web-admin/index.html）的测试：用真的浏览器打开网页，把微信的 Web SDK 换成一个替身，
 * 替身把调用转给内存里的云函数（tools/cloud-mock.js），调用时不带微信身份，和真实的网页一样。
 *
 *   node tools/test-web-admin.js            跑测试
 *   node tools/test-web-admin.js --shots    顺便把几个界面截图存到 out/web-*.png
 *
 * 需要 Playwright（npm test 不跑这个，免得没装浏览器的机器上失败）。它不能代替真实环境：
 * 未登录访问的开关、云函数的安全规则、Web SDK 本身都要在真的云环境里验证。
 */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { createCloud } = require('./cloud-mock.js');

const SHOTS = process.argv.includes('--shots');
const HTML = path.resolve(__dirname, '../web-admin/index.html');
const DAY = 24 * 3600 * 1000;
let n = 0;
const ok = (v, msg) => { assert.ok(v, msg); n += 1; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n += 1; };

// 换掉 Web SDK 的脚本：new cloud.Cloud(...).callFunction 把参数 POST 给本机的 /__call
const SDK_STUB = `window.cloud = { Cloud: function (o) {
  window.__cloudOptions = o;
  this.init = function () { return Promise.resolve(); };
  this.callFunction = function (p) {
    return fetch('/__call', { method: 'POST', body: JSON.stringify(p) }).then(function (r) { return r.json(); }).then(function (result) { return { result: result }; });
  };
} };`;

(async () => {
  const cloud = createCloud();
  const now = cloud.state.now;
  cloud.state.data.events = [
    { _id: 'race', type: '赛事', title: '上海半程马拉松', status: 'published', date: new Date(now + 20 * DAY), city: '上海', venue: '徐汇滨江', quota: 200, signupCount: 36, signupStart: new Date(now + DAY), signupEnd: new Date(now + 10 * DAY) },
    { _id: 'trial', type: '试用装', title: '能量胶PRO 试用装申领', status: 'draft', date: new Date(now + 30 * DAY), signupCount: 0 },
    { _id: 'old', type: '抽奖', title: '周年抽奖', status: 'published', date: new Date(now - 40 * DAY), signupCount: 120 },
    { _id: 'done', type: '赛事', title: '去年的路跑', status: 'published', date: new Date(now - 300 * DAY), signupCount: 0 }
  ];
  cloud.state.phones = { 'code-a': '13800001234', 'code-b': '13900005678' };
  const api = cloud.load('api');
  const as = async (openid, action, data) => {
    cloud.state.openid = openid;
    try { return await cloud.run(() => api.main(Object.assign({ action: action }, data))); } finally { cloud.state.openid = ''; }
  };
  // 两位会员：user-a 是管理员，user-b 是普通会员
  await as('user-a', 'register', { code: 'code-a' });
  await as('user-b', 'register', { code: 'code-b' });
  await as('user-a', 'setNickname', { nickname: '运营小唐' });
  await as('user-b', 'setNickname', { nickname: '老李' });
  cloud.col('members').find((m) => m._id === 'user-a').admin = true;
  const memberB = cloud.col('members').find((m) => m._id === 'user-b');

  let slowUpload = 0;
  let slowSave = 0;
  const slow = {};   // 接口名 → 拖慢多少毫秒
  const broken = {}; // 接口名 → true 时这个接口调不通（像断网）
  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url.startsWith('/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(HTML));
      return;
    }
    if (req.url === '/__call' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        const p = JSON.parse(body);
        // 网页来的调用没有微信身份
        cloud.state.openid = '';
        // 测试里要看「图还在传」的状态时，把传图的响应拖慢
        if (p.data && p.data.action === 'adminUploadCover' && slowUpload) await new Promise((r) => setTimeout(r, slowUpload));
        if (p.data && p.data.action === 'adminSaveEvent' && slowSave) await new Promise((r) => setTimeout(r, slowSave));
        const act = p.data && p.data.action;
        if (slow[act]) await new Promise((r) => setTimeout(r, slow[act]));
        if (broken[act]) { res.writeHead(500); res.end('broken'); return; }
        const result = p.name === 'api' ? await cloud.run(() => api.main(p.data)) : { ok: false, code: 'unknown_function' };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      });
      return;
    }
    res.writeHead(404); res.end('not found');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;

  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: SHOTS ? 2 : 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.route('**/sdk/**/cloud.js', (route) => route.fulfill({ contentType: 'text/javascript', body: SDK_STUB }));
    // 临时文件地址在测试里没有真文件：给一张 1×1 的图
    await page.route('https://files.test/**', (route) => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64') }));
    const shot = async (name) => { if (SHOTS) { fs.mkdirSync('out', { recursive: true }); await page.screenshot({ path: 'out/web-' + name + '.png' }); } };
    // 等提示条出现指定的字（上一条提示可能还没消失，所以按内容等）
    const expectToast = async (text, msg) => {
      await page.waitForFunction((want) => { const el = document.getElementById('toast'); return !el.hidden && el.textContent === want; }, text, { timeout: 5000 })
        .catch(() => { throw new Error(msg + '：没等到提示「' + text + '」'); });
      n += 1;
    };

    // ----- 登录 -----
    await page.goto(base + '/');
    await page.waitForSelector('#view-login:not([hidden])');
    ok(await page.isHidden('#view-app'), '没登录时只看到登录页');
    await shot('login');
    await page.fill('#login-code', '1234');
    await page.click('#login-submit');
    eq(await page.textContent('#login-error'), '登录码是 12 位数字', '位数不对当场提示');
    await page.fill('#login-code', '000000000000');
    eq(await page.inputValue('#login-code'), '0000 0000 0000', '输入时四位一组');
    await page.click('#login-submit');
    await page.waitForFunction(() => document.getElementById('login-error').textContent.length > 0);
    eq(await page.textContent('#login-error'), '登录码不对，或者已经过期', '登录码不对');

    const code = (await as('user-a', 'adminWebCode')).data.code;
    await page.fill('#login-code', code);
    await page.click('#login-submit');
    await page.waitForSelector('#view-app:not([hidden])');
    eq(await page.evaluate(() => window.__cloudOptions), { identityless: true, resourceAppid: 'wx224e462fe4941de6', resourceEnv: 'cloud1-d1g1u97accc6092f6' }, '以未登录模式连小程序的云环境');
    eq(await page.textContent('#who'), '运营小唐', '显示登录的是谁');

    // ----- 活动列表 -----
    await page.waitForSelector('#ev-rows tr');
    eq(await page.locator('#ev-rows tr').count(), 4, '列出全部活动');
    const rowTexts = await page.locator('#ev-rows tr').allTextContents();
    ok(rowTexts.some((t) => t.includes('上海半程马拉松') && t.includes('36 / 200') && t.includes('已上架')), '已上架的活动带报名人数');
    ok(rowTexts.some((t) => t.includes('周年抽奖') && t.includes('已结束')), '过期的活动标成已结束');
    await shot('events');
    await page.selectOption('#ev-filter', 'draft');
    eq(await page.locator('#ev-rows tr').count(), 1, '按状态筛选');
    await page.selectOption('#ev-filter', '');
    await page.fill('#ev-search', '抽奖');
    eq(await page.locator('#ev-rows tr').count(), 1, '按名称找');
    await page.fill('#ev-search', '');

    // ----- 新建活动，带头图 -----
    await page.click('#ev-new');
    await page.waitForSelector('#drawer:not([hidden])');
    await page.click('#drawer-save');
    await expectToast('请填写名称', '没填名称不能保存');
    await page.fill('#f-title', '杭州越野赛');
    await page.click('#drawer-save');
    await expectToast('请选择活动时间', '没选时间不能保存');
    await page.fill('#f-date', '2027-03-20T07:30');
    await page.fill('#f-city', '杭州');
    await page.fill('#f-quota', '300');
    await page.fill('#f-signupStart', '2027-03-01T10:00');
    await page.fill('#f-signupEnd', '2027-03-10T23:59');
    await page.fill('#f-intro', '第一段\n第二段');
    ok(await page.isHidden('#f-drawAt-field'), '赛事不显示开奖时间');
    // 一张 400×300 的 PNG：浏览器里先压成 JPEG 再传
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 400; c.height = 300;
      const g = c.getContext('2d'); g.fillStyle = '#061A70'; g.fillRect(0, 0, 400, 300); g.fillStyle = '#C2E541'; g.fillRect(40, 40, 120, 80);
      return c.toDataURL('image/png').split(',')[1];
    });
    await page.setInputFiles('#f-cover-file', { name: 'cover.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await page.waitForFunction(() => document.getElementById('f-cover-pick').textContent === '换一张');
    const uploaded = Object.keys(cloud.state.files);
    eq(uploaded.length, 1, '头图传到云存储');
    ok(/^cloud:\/\/mock-env\/events\/.+\.jpg$/.test(uploaded[0]) && cloud.state.files[uploaded[0]].slice(0, 3).toString('hex') === 'ffd8ff', '传上去的是压过的 JPEG');
    await page.check('#f-published', { force: true });
    await shot('form');
    await page.click('#drawer-save');
    await page.waitForSelector('#drawer', { state: 'hidden' });
    const made = cloud.col('events').find((e) => e.title === '杭州越野赛');
    ok(made && made.status === 'published' && made.quota === 300 && made.city === '杭州' && made.cover === uploaded[0] && made.intro === '第一段\n第二段', '新建的活动写到云端');
    eq([made.date.getTime(), made.signupEnd.getTime()], [new Date('2027-03-20T07:30').getTime(), new Date('2027-03-10T23:59').getTime()], '时间按填的存');
    await page.waitForFunction(() => document.querySelectorAll('#ev-rows tr').length === 5);

    // ----- 编辑、下架 -----
    await page.locator('#ev-rows tr', { hasText: '杭州越野赛' }).getByText('编辑').click();
    await page.waitForSelector('#drawer:not([hidden])');
    eq([await page.inputValue('#f-title'), await page.inputValue('#f-date'), await page.inputValue('#f-quota'), await page.isChecked('#f-published')], ['杭州越野赛', '2027-03-20T07:30', '300', true], '编辑时填好原来的内容');
    await page.fill('#f-title', '杭州西湖越野赛');
    await page.click('#drawer-save');
    await page.waitForSelector('#drawer', { state: 'hidden' });
    eq(cloud.col('events').find((e) => e._id === made._id).title, '杭州西湖越野赛', '改名写到云端');
    await page.locator('#ev-rows tr', { hasText: '杭州西湖越野赛' }).getByText('下架').click();
    await expectToast('已下架', '下架');
    await page.waitForFunction(() => Array.from(document.querySelectorAll('#ev-rows tr')).some((r) => r.textContent.includes('杭州西湖越野赛') && r.textContent.includes('未上架')));
    eq(cloud.col('events').find((e) => e._id === made._id).status, 'draft', '下架写到云端');

    // ----- 头图还在传的时候：不能保存；关掉表单再开别的活动，这张图不会安到别的活动上 -----
    slowUpload = 500;
    const filesBefore = Object.keys(cloud.state.files).length;
    await page.locator('#ev-rows tr', { hasText: '上海半程马拉松' }).getByText('编辑').click();
    await page.waitForSelector('#drawer:not([hidden])');
    await page.setInputFiles('#f-cover-file', { name: 'cover.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await page.waitForFunction(() => document.getElementById('f-cover-pick').textContent === '正在上传');
    ok(await page.isDisabled('#drawer-save'), '头图还在传的时候不能保存');
    await page.click('#drawer-close');
    await page.locator('#ev-rows tr', { hasText: '周年抽奖' }).getByText('编辑').click();
    await page.waitForSelector('#drawer:not([hidden])');
    ok(await page.isEnabled('#drawer-save'), '换了一个活动，保存按钮可用');
    await page.waitForFunction((n) => true, null);
    await new Promise((r) => setTimeout(r, 900));
    eq(Object.keys(cloud.state.files).length, filesBefore + 1, '那张图确实传完了');
    eq(await page.textContent('#f-cover-pick'), '选择图片', '上一个活动传的图没有安到这个活动上');
    await page.click('#drawer-save');
    await page.waitForSelector('#drawer', { state: 'hidden' });
    eq(cloud.col('events').find((e) => e._id === 'old').cover || '', '', '保存后这个活动还是没有头图');
    eq(cloud.col('events').find((e) => e._id === 'race').cover || '', '', '没保存的那个活动头图也没变');
    slowUpload = 0;

    // ----- 保存还没回来时关掉表单、开了别的活动：回来以后不能把正在填的表单关掉 -----
    slowSave = 500;
    await page.locator('#ev-rows tr', { hasText: '上海半程马拉松' }).getByText('编辑').click();
    await page.waitForSelector('#drawer:not([hidden])');
    await page.fill('#f-venue', '西岸');
    await page.click('#drawer-save');
    await page.click('#drawer-close');
    await page.locator('#ev-rows tr', { hasText: '周年抽奖' }).getByText('编辑').click();
    await page.waitForSelector('#drawer:not([hidden])');
    await page.fill('#f-title', '周年抽奖（改到一半）');
    for (let i = 0; i < 40 && cloud.col('events').find((e) => e._id === 'race').venue !== '西岸'; i += 1) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 400)); // 等网页收到结果、处理完
    eq(cloud.col('events').find((e) => e._id === 'race').venue, '西岸', '前一个活动的修改写到云端');
    ok(await page.isVisible('#drawer'), '正在填的表单没有被关掉');
    eq([await page.inputValue('#f-title'), await page.isEnabled('#drawer-save')], ['周年抽奖（改到一半）', true], '填到一半的内容还在，保存按钮可用');
    await page.click('#drawer-close');
    slowSave = 0;

    // ----- 新活动通知：没人订阅时点了有提示；有人订阅时确认后登记，按钮换成进度 -----
    const raceRow = () => page.locator('#ev-rows tr', { hasText: '上海半程马拉松' });
    eq(await page.textContent('#ev-subs'), '0 人订阅了新活动通知', '活动页上写着有多少人订阅');
    eq(await page.locator('#ev-rows tr', { hasText: '周年抽奖' }).getByText('通知', { exact: true }).count(), 0, '已经结束的活动没有通知按钮');
    await raceRow().getByText('通知', { exact: true }).click();
    await expectToast('还没有人订阅新活动通知', '没人订阅时点通知有提示');
    cloud.state.openid = 'user-b';
    await cloud.run(() => api.main({ action: 'subscribeNews', templateId: 'tmpl' }));
    cloud.state.openid = '';
    await page.click('[data-tab="events"]');
    await page.waitForFunction(() => document.getElementById('ev-subs').textContent.indexOf('1 人') === 0);
    let confirmText = '';
    page.once('dialog', (d) => { confirmText = d.message(); d.accept(); });
    await raceRow().getByText('通知', { exact: true }).click();
    await expectToast('已安排，几分钟内发出', '登记通知');
    ok(confirmText.includes('1 人') && confirmText.includes('只能通知一次'), '确认框里写清楚发给多少人、只能通知一次');
    await page.waitForFunction(() => Array.prototype.some.call(document.querySelectorAll('#ev-rows tr'), (tr) => tr.textContent.includes('上海半程马拉松') && tr.textContent.includes('通知发送中')));
    eq(await raceRow().getByText('通知', { exact: true }).count(), 0, '通知过的活动不再有通知按钮');
    eq(cloud.col('events').find((e) => e._id === 'race').notifyStatus, 'pending', '云端登记上了');

    // ----- 报名名单：看名单、导出、取消某个人、取消整场；活动表单里设积分和联系方式 -----
    await page.click('[data-tab="events"]');
    await raceRow().getByText('编辑').click();
    await page.waitForSelector('#drawer:not([hidden])');
    await page.fill('#f-cost', '300');
    await page.fill('#f-contact', '客服电话 021-0000');
    await page.click('#drawer-save');
    await expectToast('已保存', '活动设上报名积分和联系方式');
    const raceDoc = cloud.col('events').find((e) => e._id === 'race');
    eq([raceDoc.cost, raceDoc.contact], [300, '客服电话 021-0000'], '积分和联系方式写到云端');
    raceDoc.signupStart = new Date(cloud.state.now - DAY);
    cloud.state.openid = 'user-b';
    ok((await cloud.run(() => api.main({ action: 'signup', eventId: 'race' }))).ok, '会员用积分报名');
    cloud.state.openid = '';
    eq(memberB.points, 200, '报名扣了 300 积分');
    await page.click('[data-tab="events"]');
    await raceRow().getByText('名单').click();
    await page.waitForFunction(() => document.querySelectorAll('#roster-rows tr').length === 1);
    eq([await page.textContent('#roster-title'), await page.textContent('#roster-count'), (await page.textContent('#roster-rows')).includes(memberB.phone)], ['上海半程马拉松', '1 人报名', true], '名单里有活动名、人数和完整手机号');
    const download = page.waitForEvent('download');
    await page.click('#roster-export');
    const file = await download;
    const csv = fs.readFileSync(await file.path(), 'utf8');
    ok(csv.includes('"老李"') && csv.includes(memberB.phone) && csv.includes('"300"'), '导出的表格里有昵称、手机号、积分');
    page.once('dialog', (d) => d.accept());
    await page.locator('#roster-rows tr').getByText('取消报名').click();
    await expectToast('已取消', '取消某个人的报名');
    await page.waitForFunction(() => document.querySelectorAll('#roster-rows tr').length === 0 && document.getElementById('roster-count').textContent === '0 人报名');
    eq([memberB.points, cloud.col('inbox').filter((m) => m.openid === 'user-b').length], [500, 1], '积分退回，给他留了一条消息');
    cloud.state.openid = 'user-b';
    await cloud.run(() => api.main({ action: 'signup', eventId: 'race' }));
    cloud.state.openid = '';
    await page.click('#roster-close');
    await raceRow().getByText('名单').click();
    await page.waitForFunction(() => document.querySelectorAll('#roster-rows tr').length === 1);
    page.once('dialog', (d) => d.accept());
    await page.click('#roster-cancel-event');
    await expectToast('活动已取消', '取消整场活动');
    await page.waitForFunction(() => document.querySelectorAll('#roster-rows tr').length === 0);
    await page.click('#roster-close');
    await page.waitForFunction(() => Array.prototype.some.call(document.querySelectorAll('#ev-rows tr'), (tr) => tr.textContent.includes('上海半程马拉松') && tr.textContent.includes('已取消')));
    eq([raceDoc.status, raceDoc.cancelled, memberB.points], ['draft', true, 500], '活动下架并标成取消，积分退回');

    // ----- 发公告：上架着的活动一键发成公告 -----
    await page.locator('#ev-rows tr', { hasText: '能量胶PRO 试用装申领' }).getByText('上架', { exact: true }).click();
    await expectToast('已上架，小程序里能看到了', '上架一场活动');
    let announceText = '';
    page.once('dialog', (d) => { announceText = d.message(); d.accept(); });
    await page.locator('#ev-rows tr', { hasText: '能量胶PRO 试用装申领' }).getByText('发公告').click();
    await expectToast('公告已发出', '发公告');
    const sent = cloud.col('settings').find((d) => d._id === 'notice');
    ok(announceText.includes('能量胶PRO 试用装申领') && sent.enabled && sent.title === '新活动' && sent.content.startsWith('「能量胶PRO 试用装申领」上线了'), '公告的内容是这场活动，已经打开');

    // ----- 加到往期：办完的赛事把名称和年份带进往期的表单 -----
    eq(await page.locator('#ev-rows tr', { hasText: '周年抽奖' }).getByText('加到往期').count(), 0, '抽奖没有「加到往期」');
    await page.locator('#ev-rows tr', { hasText: '去年的路跑' }).getByText('加到往期').click();
    await page.waitForSelector('#past-form:not([hidden])');
    eq([await page.inputValue('#p-name'), await page.inputValue('#p-year'), await page.isChecked('#p-home'), await page.textContent('#past-form-title')],
      ['去年的路跑', String(new Date(now - 300 * DAY).getFullYear()), true, '添加赛事'], '往期的表单预填了名称和年份，默认放在首页');
    await page.click('#past-cancel');

    // ----- 往期的赞助赛事：列出来、加一场、改、删 -----
    await page.click('[data-tab="past"]');
    await page.waitForFunction(() => document.querySelectorAll('#past-rows tr').length === 4);
    eq(await page.locator('#past-rows tr').first().locator('.cell-title__name').textContent(), '韩国汉江跑步节', '列出包里原有的几场');
    ok((await page.locator('#past-rows tr').first().locator('.thumb').evaluate((n) => n.style.backgroundImage)).includes('/assets/photos/endorsement/2026-hangang-running-festival.jpg'), '原有的照片拼上资源前缀显示');
    await page.click('#past-new');
    await page.uncheck('#p-home', { force: true });
    await page.fill('#p-year', '27');
    await page.fill('#p-name', '首尔马拉松');
    await page.click('#past-save');
    await expectToast('年份填四位数字', '年份不对有提示');
    await page.fill('#p-year', '2027');
    await page.click('#past-save');
    await expectToast('请选择照片', '没选照片有提示');
    await page.setInputFiles('#p-file', { name: 'p.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await page.waitForFunction(() => document.getElementById('p-pick').textContent === '换一张');
    await page.click('#past-save');
    await expectToast('已保存', '加一场往期赛事');
    await page.waitForFunction(() => document.querySelectorAll('#past-rows tr').length === 5 && document.getElementById('past-form').hidden);
    const added = cloud.col('past_events').find((x) => x.name === '首尔马拉松');
    ok(added && added.year === '2027' && /^cloud:\/\//.test(added.image), '写到云端，照片是云存储的文件');
    eq([added.home, (await page.locator('#past-rows tr').first().textContent()).includes('不放')], [false, true], '关掉了「放在首页」，列表上写着不放');
    eq(await page.locator('#past-rows tr').first().locator('.cell-title__name').textContent(), '首尔马拉松', '年份新的排最前');
    await page.locator('#past-rows tr', { hasText: '首尔马拉松' }).getByText('编辑').click();
    await page.fill('#p-nameEn', 'Seoul Marathon');
    await page.click('#past-save');
    await page.waitForFunction(() => document.getElementById('past-rows').textContent.includes('Seoul Marathon'));
    eq(cloud.col('past_events').filter((x) => x.name).length, 5, '编辑不多出一条');
    await shot('past');
    // 保存还没回来时切走又切回来：中间那次读取先回来（读到的是旧的），保存完以后列表要是新的
    slow.adminSavePast = 600;
    await page.locator('#past-rows tr', { hasText: '首尔马拉松' }).getByText('编辑').click();
    await page.fill('#p-nameEn', 'Seoul Marathon 2027');
    await page.click('#past-save');
    await page.click('[data-tab="events"]');
    await page.click('[data-tab="past"]');
    await expectToast('已保存', '慢的那次保存完成');
    await page.waitForFunction(() => document.getElementById('past-rows').textContent.includes('Seoul Marathon 2027'));
    ok(true, '保存期间切走又切回来，保存完以后列表是新的');
    slow.adminSavePast = 0;
    page.once('dialog', (d) => d.accept());
    await page.locator('#past-rows tr', { hasText: '韩国自由跑' }).getByText('删除').click();
    await expectToast('已删除', '删掉一场');
    await page.waitForFunction(() => document.querySelectorAll('#past-rows tr').length === 4);
    ok(cloud.col('past_events').find((x) => x.name === '韩国自由跑').deleted === true, '云端也标成删除了');
    await page.click('[data-tab="events"]');

    // ----- 公告：现在的公告没读到之前不能改也不能存，不然会拿空表单把线上的公告清掉 -----
    await as('user-a', 'adminSaveNotice', { notice: { title: '原来的公告', content: '原来的内容', enabled: true } });
    const noticeState = () => page.evaluate(() => [document.getElementById('notice-save').disabled, document.getElementById('notice-title').disabled,
      document.getElementById('notice-hint').hidden ? '' : document.getElementById('notice-hint').textContent]);
    broken.adminNotice = true;
    await page.click('[data-tab="notice"]');
    await page.waitForSelector('#tab-notice:not([hidden])');
    await page.waitForFunction(() => document.getElementById('notice-hint').textContent.indexOf('没读到') === 0);
    eq(await noticeState(), [true, true, '没读到现在的公告，点左边的「公告」再读一次'], '公告没读到：不能改、不能存，并说明怎么办');
    await page.evaluate(() => document.getElementById('notice-form').requestSubmit());
    await new Promise((r) => setTimeout(r, 200));
    eq((await as('user-a', 'adminNotice')).data.notice.title, '原来的公告', '没读到时硬提交也不会把线上的公告清掉');
    broken.adminNotice = false;
    slow.adminNotice = 500;
    await page.click('[data-tab="notice"]');
    eq(await noticeState(), [true, true, '正在读取现在的公告'], '公告还在读：不能改、不能存');
    await page.waitForFunction(() => document.getElementById('notice-title').value === '原来的公告');
    eq(await noticeState(), [false, false, ''], '读到以后表单填上现在的公告，可以改可以存');
    slow.adminNotice = 0;
    await page.fill('#notice-title', '停机维护');
    await page.fill('#notice-content', '今晚 23 点到 24 点暂停报名。');
    eq([await page.textContent('#pv-title'), await page.textContent('#pv-content')], ['停机维护', '今晚 23 点到 24 点暂停报名。'], '右边实时预览');
    await page.check('#notice-enabled', { force: true });
    await shot('notice');
    await page.click('#notice-save');
    await expectToast('公告已保存', '保存公告');
    eq((await as('user-b', 'bootstrap')).data.notice.title, '停机维护', '小程序用户能拿到这条公告');

    // ----- 积分 -----
    await page.click('[data-tab="points"]');
    await page.fill('#find-query', '19900000000');
    await page.click('#find-submit');
    await expectToast('没有找到', '查无此人');
    await page.fill('#find-query', memberB.phone);
    await page.click('#find-submit');
    await page.waitForSelector('#adjust-form:not([hidden])');
    eq([await page.textContent('#m-name'), await page.textContent('#m-points'), await page.textContent('#m-phone')], ['老李', '500', '139****5678'], '按手机号找到会员，手机号打码');
    await page.fill('#adj-amount', '150');
    await page.click('#adj-submit');
    await expectToast('请填写原因', '没写原因不能提交');
    await page.fill('#adj-reason', '线下活动签到');
    let asked = '';
    page.once('dialog', (d) => { asked = d.message(); d.accept(); });
    await page.click('#adj-submit');
    await page.waitForFunction(() => document.getElementById('m-points').textContent === '650');
    ok(asked.includes('老李') && asked.includes('加 150 积分'), '确认框里写清楚给谁加多少');
    eq(memberB.points, 650, '积分加到云端');
    const log = cloud.col('point_logs').filter((l) => l.openid === 'user-b').slice(-1)[0];
    eq([log.delta, log.reason, log.by], [150, '线下活动签到', 'user-a'], '记一条积分记录，带操作的管理员');
    await shot('points');

    // ----- 调整还没回来时又查了另一位会员：结果回来后不能盖掉正在填的内容 -----
    slow.adminAdjustPoints = 600;
    await page.fill('#adj-amount', '10');
    await page.fill('#adj-reason', '补签到');
    page.once('dialog', (d) => d.accept());
    await page.click('#adj-submit');
    await page.fill('#find-query', '13800001234');
    await page.click('#find-submit');
    await page.waitForFunction(() => document.getElementById('m-name').textContent === '运营小唐');
    await page.fill('#adj-amount', '77');
    await page.fill('#adj-reason', '填到一半');
    await expectToast('已给 老李（' + memberB.memberNo + '） 调整', '提示里写清楚刚才那笔是给谁的');
    eq(memberB.points, 660, '前一位会员的积分调整到了云端');
    eq([await page.textContent('#m-name'), await page.inputValue('#adj-amount'), await page.inputValue('#adj-reason')], ['运营小唐', '77', '填到一半'], '页面上还是后来查的会员，填到一半的内容还在');
    ok(await page.isEnabled('#adj-submit'), '调整按钮恢复可用');
    slow.adminAdjustPoints = 0;

    // ----- 刷新页面还在登录状态；凭证过期后回到登录页 -----
    await page.reload();
    await page.waitForSelector('#view-app:not([hidden])');
    ok(true, '刷新页面不用重新登录');
    cloud.col('admin_web').filter((d) => d.kind === 'session').forEach((d) => { d.expiresAt = 0; });
    await page.click('[data-tab="notice"]');
    await page.waitForSelector('#view-login:not([hidden])');
    eq(await page.textContent('#login-error'), '登录过期了，请重新登录', '凭证过期后回到登录页');
    eq(await page.evaluate(() => localStorage.getItem('sx_admin_token')), null, '过期的凭证从浏览器里清掉');

    // ----- 重新登录后，公告是重新取的，不是上一次登录时看到的那份 -----
    cloud.col('settings').find((d) => d._id === 'notice').title = '别的管理员改过的标题';
    const code2 = (await as('user-a', 'adminWebCode')).data.code;
    await page.fill('#login-code', code2);
    await page.click('#login-submit');
    await page.waitForSelector('#view-app:not([hidden])');
    await page.click('[data-tab="notice"]');
    await page.waitForFunction(() => document.getElementById('notice-title').value === '别的管理员改过的标题');
    ok(true, '重新登录后公告重新取，不会拿旧内容盖掉别人的修改');
    await page.click('[data-tab="points"]');
    ok(await page.isHidden('#adjust-form'), '重新登录后上一次查到的会员不留在页面上');

    // ----- 上一次登录期间发出的请求，重新登录以后才回来：不能动现在的页面，也不能把人踢出去 -----
    slow.adminFindMember = 900;
    await page.fill('#find-query', memberB.phone);
    await page.click('#find-submit');
    await page.click('#logout');
    await page.waitForSelector('#view-login:not([hidden])');
    await page.fill('#login-code', (await as('user-a', 'adminWebCode')).data.code);
    await page.click('#login-submit');
    await page.waitForSelector('#view-app:not([hidden])');
    await page.click('[data-tab="points"]');
    await new Promise((r) => setTimeout(r, 1300));
    ok(await page.isVisible('#view-app'), '旧请求带着作废的凭证回来，不会把刚登录的人踢出去');
    ok(await page.isHidden('#adjust-form'), '旧请求查到的会员不会出现在新登录的页面上');
    ok(await page.isEnabled('#find-submit'), '查找按钮可用');
    slow.adminFindMember = 0;

    // ----- 会员看板 -----
    for (let i = 0; i < 35; i++) {
      cloud.col('members').push({ _id: 'extra-' + i, openid: 'extra-' + i, phone: '1360000' + (1000 + i), memberNo: String(300000 + i), points: 10, createdAt: new Date(now - (i % 20) * 24 * 3600 * 1000 - 3600 * 1000) });
    }
    const totalMembers = cloud.col('members').length;
    await page.click('[data-tab="members"]');
    await page.waitForFunction(() => document.querySelectorAll('#mb-rows tr').length === 30);
    eq(await page.textContent('#mb-stats .stat:first-child .stat__num'), String(totalMembers), '看板上的会员总数');
    eq(await page.locator('#mb-chart .chart__col').count(), 30, '图上 30 天一天一根');
    ok(await page.isVisible('#mb-more'), '名单没完时有「再看」');
    ok(!(await page.textContent('#mb-rows')).includes(memberB.phone), '名单里的手机号是打码的');
    // 刷新途中点「再看」：不能拿旧页码接到新名单后面
    slow.adminMembers = 500;
    await page.click('#mb-refresh');
    ok(await page.isDisabled('#mb-more'), '刷新期间「再看」点不了');
    await page.waitForFunction(() => !document.getElementById('mb-more').disabled);
    slow.adminMembers = 0;
    eq(await page.locator('#mb-rows tr').count(), 30, '刷新完还是第一页');
    await page.click('#mb-more');
    await page.waitForFunction((n) => document.querySelectorAll('#mb-rows tr').length === n, totalMembers);
    ok(await page.isHidden('#mb-more'), '读完了就没有「再看」');
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: true });
    await page.click('#mb-rows button[data-no="' + memberB.memberNo + '"]');
    await page.waitForSelector('#adjust-form:not([hidden])');
    ok((await page.textContent('#m-no')).includes(memberB.memberNo), '点「调积分」带着这位会员去积分那一栏');
    broken.adminMemberStats = true;
    await page.click('[data-tab="members"]');
    await expectToast('网络异常，请稍后再试', '看板读不出来有提示');
    broken.adminMemberStats = false;

    // ----- 退出登录 -----
    await page.click('#logout');
    await page.waitForSelector('#view-login:not([hidden])');
    ok(cloud.col('admin_web').filter((d) => d.kind === 'session').every((d) => d.expiresAt === 0), '退出登录后凭证在云端作废');

    eq(errors, [], '页面没有脚本报错');
  } finally {
    await browser.close();
    server.close();
  }
  console.log('电脑端后台测试通过：' + n + ' 项');
})().catch((e) => { console.error(e); process.exit(1); });
