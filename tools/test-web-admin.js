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
  const lostResponse = {}; // 写入已经成功，再让客户端收到网络错误
  const requests = [];
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
        requests.push(p.data);
        if (slow[act]) await new Promise((r) => setTimeout(r, slow[act]));
        if (broken[act]) { res.writeHead(500); res.end('broken'); return; }
        const result = p.name === 'api' ? await cloud.run(() => api.main(p.data)) : { ok: false, code: 'unknown_function' };
        if (lostResponse[act]) { lostResponse[act] -= 1; res.writeHead(500); res.end('response lost'); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      });
      return;
    }
    res.writeHead(404); res.end('not found');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;

  const { launchChromium } = require('./browser.js');
  const browser = await launchChromium();
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
    await page.waitForSelector('#drawer-save:enabled');
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
    await page.waitForSelector('#drawer-save:enabled');
    await page.setInputFiles('#f-cover-file', { name: 'cover.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await page.waitForFunction(() => document.getElementById('f-cover-pick').textContent === '正在上传');
    ok(await page.isDisabled('#drawer-save'), '头图还在传的时候不能保存');
    page.once('dialog', (d) => d.accept());
    await page.click('#drawer-close');
    await page.locator('#ev-rows tr', { hasText: '周年抽奖' }).getByText('编辑').click();
    await page.waitForSelector('#drawer:not([hidden])');
    await page.waitForSelector('#drawer-save:enabled');
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
    await page.waitForSelector('#drawer-save:enabled');
    await page.fill('#f-venue', '西岸');
    await page.click('#drawer-save');
    page.once('dialog', (d) => d.accept());
    await page.click('#drawer-close');
    await page.locator('#ev-rows tr', { hasText: '周年抽奖' }).getByText('编辑').click();
    await page.waitForSelector('#drawer:not([hidden])');
    await page.fill('#f-title', '周年抽奖（改到一半）');
    for (let i = 0; i < 40 && cloud.col('events').find((e) => e._id === 'race').venue !== '西岸'; i += 1) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 400)); // 等网页收到结果、处理完
    eq(cloud.col('events').find((e) => e._id === 'race').venue, '西岸', '前一个活动的修改写到云端');
    ok(await page.isVisible('#drawer'), '正在填的表单没有被关掉');
    eq([await page.inputValue('#f-title'), await page.isEnabled('#drawer-save')], ['周年抽奖（改到一半）', true], '填到一半的内容还在，保存按钮可用');
    page.once('dialog', (d) => d.accept());
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

    // ----- 报名表：用现成的模块拼一张，检查和云端一样，存上，再打开还在 -----
    const westLake = () => page.locator('#ev-rows tr', { hasText: '杭州西湖越野赛' });
    const ffLabels = () => page.locator('#ff-list .ff__label').evaluateAll((n) => n.map((x) => x.value));
    const ffIds = () => page.locator('#ff-list .ff').evaluateAll((n) => n.map((x) => x.getAttribute('data-id')));
    await westLake().getByText('编辑').click();
    await page.waitForSelector('#drawer:not([hidden])');
    await page.waitForSelector('#drawer-save:enabled');
    ok(await page.isVisible('#ff-empty'), '没有报名表时写着用户点报名直接报上');
    eq(await page.locator('#ff-presets button').allTextContents(), ['姓名', '手机号', '性别', '出生日期', '证件号码', '服装尺码', '紧急联系人', '紧急联系电话', '单选题', '多选题', '填空', '多行填空'], '「添加一项」里有 12 个现成的模块');
    await page.click('#ff-presets [data-preset="name"]');
    await page.click('#ff-presets [data-preset="gender"]');
    await page.click('#ff-presets [data-preset="idno"]');
    ok(await page.isVisible('#ff-sensitive') && await page.isHidden('#ff-empty'), '加了证件号码有敏感信息的提示');
    await page.click('#ff-presets [data-preset="multi"]');
    const ffRows = page.locator('#ff-list .ff');
    eq(await ffRows.count(), 4, '加了四项');
    eq(await page.locator('#ff-list .ff__required').evaluateAll((n) => n.map((x) => x.checked)), [true, true, true, true], '新加的项默认必填，和小程序后台一样');
    ok(await page.evaluate(() => document.activeElement.classList.contains('ff__label') && document.activeElement.value === ''), '多选题没有现成的标题，加上后直接填标题');
    eq([await ffRows.nth(1).locator('.ff__label').inputValue(), await ffRows.nth(1).locator('.ff__kind').textContent(), await ffRows.nth(1).locator('.ff__options').inputValue()], ['性别', '单选', '男\n女'], '性别是单选，带好了选项');
    await page.click('#drawer-save');
    await expectToast('报名表的每一项都要写标题', '多选题没写标题不能保存');
    await ffRows.nth(3).locator('.ff__label').fill('参加项目');
    await ffRows.nth(3).locator('.ff__options').fill('跑步');
    await page.click('#drawer-save');
    await expectToast('单选和多选至少要有两个选项', '只有一个选项不能保存');
    await ffRows.nth(3).locator('.ff__options').fill('跑步\n骑行\n跑步\n\n游泳');
    await ffRows.nth(1).locator('.ff__required').uncheck();
    await ffRows.nth(3).locator('.ff__hint').fill('  可以选多个  ');
    await ffRows.nth(3).getByText('上移').click(); // 参加项目挪到证件号码前面
    await ffRows.nth(3).getByText('删除').click(); // 删掉证件号码
    ok(await page.isHidden('#ff-sensitive'), '删掉证件号码后提示也没了');
    eq(await ffLabels(), ['姓名', '性别', '参加项目'], '上移、删除后的顺序');
    await shot('signup-form');
    await page.click('#drawer-save');
    await page.waitForSelector('#drawer', { state: 'hidden' });
    const savedForm = cloud.col('events').find((e) => e._id === made._id).form;
    eq(savedForm.map((f) => [f.kind, f.label, f.required, f.options]), [['text', '姓名', true, undefined], ['single', '性别', false, ['男', '女']], ['multi', '参加项目', true, ['跑步', '骑行', '游泳']]], '报名表存到云端，重复的和空的选项去掉');
    ok(savedForm.every((f) => /^[a-zA-Z0-9_-]{1,24}$/.test(f.id)) && new Set(savedForm.map((f) => f.id)).size === 3, '每一项有自己的 id');
    eq(savedForm.map((f) => f.hint), [undefined, undefined, '可以选多个'], '填写说明存到云端，没写的不带');
    eq(requests.filter((d) => d.action === 'adminSaveEvent').slice(-1)[0].event.form.length, 3, '保存时带着报名表');
    await westLake().getByText('编辑').click();
    await page.waitForSelector('#drawer-save:enabled');
    eq([await ffLabels(), await ffIds()], [['姓名', '性别', '参加项目'], savedForm.map((f) => f.id)], '再打开时报名表还在，id 不变');
    eq(await ffRows.nth(2).locator('.ff__options').inputValue(), '跑步\n骑行\n游泳', '选项一行一个');
    eq(await ffRows.nth(2).locator('.ff__hint').inputValue(), '可以选多个', '填写说明也带回来了');
    eq(await page.locator('#ff-list .ff__required').evaluateAll((n) => n.map((x) => x.checked)), [true, false, true], '必填也带回来了');
    // 只改了填写说明没存：关的时候也要问
    await ffRows.nth(0).locator('.ff__hint').fill('和证件上的一致');
    let hintAsk = '';
    page.once('dialog', (d) => { hintAsk = d.message(); d.dismiss(); });
    await page.click('#drawer-close');
    ok(hintAsk.includes('没有保存') && await page.isVisible('#drawer'), '只改了填写说明没存，关的时候也要问');
    // 改了报名表没存：关的时候要问
    await ffRows.nth(1).getByText('删除').click();
    let unsavedAsk = '';
    page.once('dialog', (d) => { unsavedAsk = d.message(); d.dismiss(); });
    await page.click('#drawer-close');
    ok(unsavedAsk.includes('没有保存') && await page.isVisible('#drawer'), '删了一项没存，关的时候要问，选不关就留着');
    page.once('dialog', (d) => d.accept());
    await page.click('#drawer-close');
    await page.waitForSelector('#drawer', { state: 'hidden' });
    eq(cloud.col('events').find((e) => e._id === made._id).form.length, 3, '没存的修改不会写到云端');
    // 新建活动沿用这张报名表：每一项换新的 id；新建的草稿里也带着报名表
    await page.click('#ev-new');
    await page.waitForSelector('#drawer:not([hidden])');
    ok((await page.locator('#ff-copy option').allTextContents()).includes('杭州西湖越野赛（3 项）'), '「沿用」里列出有报名表的活动');
    await page.selectOption('#ff-copy', made._id);
    await expectToast('已沿用「杭州西湖越野赛」的报名表', '沿用别的活动的报名表');
    const copiedIds = await ffIds();
    eq(await ffLabels(), ['姓名', '性别', '参加项目'], '三项都带过来了');
    ok(copiedIds.every((id) => /^[a-zA-Z0-9_-]{1,24}$/.test(id) && !savedForm.some((f) => f.id === id)), '带过来的每一项换了新的 id');
    await page.fill('#f-title', '有报名表的草稿');
    await page.click('#drawer-close');
    await page.waitForSelector('#drawer', { state: 'hidden' });
    await page.reload();
    await page.waitForSelector('#ev-rows tr');
    await page.click('#ev-new');
    await page.waitForSelector('#drawer:not([hidden])');
    eq([await page.inputValue('#f-title'), await ffLabels(), await ffIds(), await ffRows.nth(1).locator('.ff__options').inputValue(), await ffRows.nth(2).locator('.ff__hint').inputValue()],
      ['有报名表的草稿', ['姓名', '性别', '参加项目'], copiedIds, '男\n女', '可以选多个'], '刷新后新建的草稿里报名表还在，id 和填写说明都在');
    await page.click('#drawer-draft-clear');
    eq([await ffRows.count(), await page.isVisible('#ff-empty')], [0, true], '清空重填后报名表也清掉了');
    await page.click('#drawer-close');
    await page.waitForSelector('#drawer', { state: 'hidden' });

    // ----- 报名名单里有报名表的回答，导出的表格里也有（删掉的项也导出） -----
    const fid = (label) => savedForm.find((f) => f.label === label).id;
    cloud.col('signups').push(
      { _id: 'user-b_' + made._id, openid: 'user-b', eventId: made._id, cost: 0, createdAt: new Date(now - 2 * 3600 * 1000), answeredAt: new Date(now - 2 * 3600 * 1000),
        answers: [{ id: fid('姓名'), label: '姓名', value: '李四' }, { id: fid('性别'), label: '性别', value: '男' }, { id: fid('参加项目'), label: '参加项目', value: ['跑步', '游泳'] }, { id: 'gone', label: '鞋码', value: '42' }] },
      { _id: 'user-a_' + made._id, openid: 'user-a', eventId: made._id, cost: 0, createdAt: new Date(now - 3600 * 1000), answers: [{ id: fid('性别'), label: '性别', value: '女' }] }
    );
    await westLake().getByText('名单').click();
    await page.waitForFunction(() => document.querySelectorAll('#roster-rows tr').length === 2);
    eq(await page.locator('#roster-head th').allTextContents(), ['会员', '手机号', '报名时间', '积分', '姓名', '性别', '参加项目', '操作'], '表头多出报名表的每一项');
    const leeRow = await page.locator('#roster-rows tr', { hasText: '老李' }).textContent();
    ok(leeRow.includes('李四') && leeRow.includes('跑步、游泳') && !leeRow.includes('报名表还没填齐'), '回答显示在名单里，多选用顿号连起来；填齐的人没有标记');
    const tangRow = page.locator('#roster-rows tr', { hasText: '运营小唐' });
    eq([(await tangRow.textContent()).includes('报名表还没填齐'), await tangRow.locator('.cell-answer').allTextContents()], [true, ['—', '女', '—']], '必填项没填的人有标记，没填的写「—」');
    ok(await page.locator('#roster').evaluate((n) => n.classList.contains('drawer--wide')), '有报名表时名单放宽');
    await shot('roster-form');
    const download2 = page.waitForEvent('download');
    await page.click('#roster-export');
    const csv2 = fs.readFileSync(await (await download2).path(), 'utf8');
    const csvLines = (csv2.charCodeAt(0) === 0xfeff ? csv2.slice(1) : csv2).split('\r\n');
    eq(csvLines[0], '"昵称","会员编号","手机号","报名时间","用的积分","姓名","性别","参加项目","鞋码（已删掉的项）"', '导出的表头带着报名表的各项，删掉的项排在后面');
    ok(csvLines.some((l) => l.startsWith('"老李"') && l.endsWith('"李四","男","跑步、游泳","42"')), '导出的表格里有回答');
    ok(csvLines.some((l) => l.startsWith('"运营小唐"') && l.endsWith('"—","女","—","—"')), '没填的写「—」');
    await page.click('#roster-close');

    // ----- 现场互动：新建大转盘、打开、改（撞上别人的修改）、中奖名单、核销和撤回、小程序码、删除 -----
    await page.click('[data-tab="interact"]');
    await page.waitForFunction(() => document.getElementById('ix-empty-text').textContent === '还没有互动');
    ok(await page.isVisible('#ix-empty'), '没有互动时写着还没有');
    await page.click('#ix-new');
    await page.waitForSelector('#ix-drawer:not([hidden])');
    const pz = (i) => page.locator('#ix-prizes .pz').nth(i);
    eq([await page.textContent('#ix-drawer-title'), await page.textContent('#ix-kind-seg .seg__btn--on'), await page.textContent('#ix-aud-seg .seg__btn--on'), await page.inputValue('#x-tries'), await page.locator('#ix-prizes .pz').count()],
      ['新建互动', '大转盘', '会员', '1', 1], '新建默认是大转盘、只给会员、每人一次，先有一行奖品');
    await page.click('#ix-save');
    await expectToast('请填写名称', '没写名称不能保存');
    await page.fill('#x-title', '幸运大转盘');
    await pz(0).locator('.pz__name').fill('运动毛巾');
    await pz(0).locator('.pz__total').fill('10');
    await pz(0).locator('.pz__chance').fill('30');
    await page.click('#ix-add-prize');
    await pz(1).locator('.pz__name').fill('能量胶PRO 一支');
    await pz(1).locator('.pz__total').fill('100');
    await pz(1).locator('.pz__chance').fill('80');
    eq(await page.textContent('#ix-chance-sum'), '加起来 110%，谢谢参与 0%', '机会加起来实时算');
    await page.click('#ix-save');
    await expectToast('中奖机会填 0 到 100，最多两位小数，加起来不超过 100', '机会加起来超过 100 不能保存');
    await pz(1).locator('.pz__chance').fill('20.5');
    eq(await page.textContent('#ix-chance-sum'), '加起来 50.5%，谢谢参与 49.5%', '剩下的是谢谢参与');
    await page.click('#ix-aud-seg [data-aud="signed"]');
    await page.click('#ix-save');
    await expectToast('只给报名的人参与时，要选关联活动；关联的活动要存在', '只给报名的人参与时要选活动');
    await page.selectOption('#x-event', made._id);
    await page.fill('#x-tries', '2');
    await page.fill('#x-note', '领奖到 1 号帐篷');
    await page.locator('#x-tries').scrollIntoViewIfNeeded();
    await shot('interact-form');
    await page.click('#ix-save');
    await page.waitForSelector('#ix-drawer', { state: 'hidden' });
    const wheelId = cloud.col('interactions').find((x) => x.title === '幸运大转盘')._id;
    const ixDoc = () => cloud.col('interactions').find((x) => x._id === wheelId);
    ok(ixDoc().kind === 'wheel' && ixDoc().status === 'off' && ixDoc().audience === 'signed' && ixDoc().eventId === made._id && ixDoc().tries === 2 && ixDoc().note === '领奖到 1 号帐篷', '新建的互动写到云端，是关着的');
    eq(ixDoc().prizes.map((p) => [p.name, p.total, p.chance]), [['运动毛巾', 10, 30], ['能量胶PRO 一支', 100, 20.5]], '奖品、数量、机会按填的存');
    ok(ixDoc().prizes.every((p) => /^[a-zA-Z0-9_-]{1,24}$/.test(p.id)), '奖品有自己的 id');
    const ixRow = () => page.locator('#ix-rows tr', { hasText: '幸运大转盘' });
    await ixRow().waitFor();
    const ixText = await ixRow().textContent();
    ok(ixText.includes('大转盘') && ixText.includes('已关') && ixText.includes('杭州西湖越野赛') && ixText.includes('抽了 0 次，中奖 0 人，已领 0 人'), '列表上有类型、状态、关联活动和抽奖情况');
    await ixRow().getByText('打开', { exact: true }).click();
    await expectToast('已打开，小程序里有入口了', '打开互动');
    await page.waitForFunction(() => document.getElementById('ix-rows').textContent.includes('进行中'));
    eq([ixDoc().status, requests.filter((d) => d.action === 'adminSetInteractionStatus').slice(-1)[0].version], ['on', 1], '云端打开了，带着读到时的版本');
    await shot('interact');

    // 编辑时另一位管理员改了它：填的内容留着，重新读取后再存
    ixDoc().prizes[0].won = 1; // 毛巾已经有人抽中了一条
    await ixRow().getByText('编辑').click();
    await page.waitForSelector('#ix-save:enabled');
    eq([await page.inputValue('#x-title'), await page.inputValue('#x-event'), await page.textContent('#ix-aud-seg .seg__btn--on'), await page.locator('#ix-prizes .pz__won').allTextContents()],
      ['幸运大转盘', made._id, '报了关联活动的会员', ['已抽中 1', '已抽中 0']], '编辑时填好原来的内容，奖品带着已抽中的个数');
    await pz(0).getByText('删除').click();
    await expectToast('奖品数量不能比已经抽中的少', '已经有人抽中的奖品不能删');
    eq(await page.locator('#ix-prizes .pz').count(), 2, '奖品还在');
    await pz(0).locator('.pz__total').fill('0');
    await page.click('#ix-save');
    await expectToast('奖品数量不能比已经抽中的少', '数量不能改得比已经抽中的少');
    await pz(0).locator('.pz__total').fill('10');
    await page.fill('#x-title', '幸运大转盘 二期');
    Object.assign(ixDoc(), { title: '别人改的名字', version: ixDoc().version + 1 });
    await page.click('#ix-save');
    await page.waitForFunction(() => !document.getElementById('ix-hint').hidden && document.getElementById('ix-hint').textContent.includes('其他管理员'));
    eq([await page.inputValue('#x-title'), await page.isDisabled('#ix-save'), await page.isVisible('#ix-reread')], ['幸运大转盘 二期', true, true], '撞上别人的修改：填的内容留着，先不让存，可以重新读取');
    page.once('dialog', (d) => d.dismiss());
    await page.keyboard.press('Escape');
    ok(await page.isVisible('#ix-drawer'), '按 Esc 时问要不要放弃，选不放弃就留着');
    await page.click('#ix-mask', { position: { x: 10, y: 100 } });
    ok(await page.isVisible('#ix-drawer') && await page.inputValue('#x-title') === '幸运大转盘 二期', '点表单外面的空白处不关');
    page.once('dialog', (d) => d.accept());
    await page.click('#ix-reread');
    await page.waitForSelector('#ix-save:enabled');
    eq(await page.inputValue('#x-title'), '别人改的名字', '重新读取后是最新的内容');
    await page.fill('#x-title', '幸运大转盘');
    await page.click('#ix-save');
    await page.waitForSelector('#ix-drawer', { state: 'hidden' });
    eq([ixDoc().title, requests.filter((d) => d.action === 'adminSaveInteraction').slice(-1)[0].version, ixDoc().version], ['幸运大转盘', 3, 4], '重新读取后带着新的版本存上');
    eq(ixDoc().status, 'on', '改内容不改开关');

    // 中奖名单：两个人中了（一个不是会员），一次没中
    const prizes = ixDoc().prizes;
    cloud.col('draws').push(
      { _id: wheelId + '_user-b_1', interactionId: wheelId, openid: 'user-b', n: 1, win: true, prizeId: prizes[0].id, prizeName: '运动毛巾', code: '123456', redeemed: false, createdAt: new Date(now - 600000) },
      { _id: wheelId + '_guest_1', interactionId: wheelId, openid: 'guest', n: 1, win: true, prizeId: prizes[1].id, prizeName: '能量胶PRO 一支', code: '654321', redeemed: false, createdAt: new Date(now - 300000) },
      { _id: wheelId + '_guest_2', interactionId: wheelId, openid: 'guest', n: 2, win: false, prizeId: '', prizeName: '', code: '', redeemed: false, createdAt: new Date(now - 200000) }
    );
    await page.click('[data-tab="interact"]');
    await page.waitForFunction(() => document.getElementById('ix-rows').textContent.includes('抽了 3 次，中奖 2 人，已领 0 人'));
    ok(true, '列表上的抽奖情况跟着变');
    await ixRow().getByText('中奖名单').click();
    await page.waitForFunction(() => document.querySelectorAll('#draws-rows tr').length === 2);
    eq([await page.textContent('#draws-title'), await page.textContent('#draws-count')], ['幸运大转盘', '抽了 3 次，中奖 2 人，已领 0 人'], '名单上面写着抽了几次、中了几个、领了几个');
    const winRow = (c) => page.locator('#draws-rows tr[data-code="' + c + '"]');
    ok((await winRow('123456').textContent()).includes('老李') && (await winRow('123456').textContent()).includes(memberB.phone), '会员带着昵称和手机号');
    ok((await winRow('654321').textContent()).includes('不是会员'), '不是会员的人只有领奖码');
    await page.fill('#draws-search', '6543');
    eq(await page.locator('#draws-rows tr').count(), 1, '按领奖码找');
    await page.fill('#draws-search', '999');
    eq([await page.locator('#draws-rows tr').count(), await page.textContent('#draws-empty')], [0, '没有这个领奖码'], '找不到时说没有这个领奖码');
    await page.fill('#draws-search', '');
    let redeemAsk = '';
    page.once('dialog', (d) => { redeemAsk = d.message(); d.accept(); });
    await winRow('123456').getByText('核销').click();
    await expectToast('已核销', '核销领奖码');
    ok(redeemAsk.includes('123456 · 运动毛巾'), '确认框里写着领奖码和奖品');
    await page.waitForFunction(() => document.getElementById('draws-count').textContent.includes('已领 1 人'));
    ok((await winRow('123456').textContent()).includes('已领取'), '这一行变成已领取');
    eq(cloud.col('draws').find((d) => d.code === '123456').redeemed, true, '云端核销了');
    // 另一位工作人员刚核销过这个码
    cloud.col('draws').find((d) => d.code === '654321').redeemed = true;
    page.once('dialog', (d) => d.accept());
    await winRow('654321').getByText('核销').click();
    await expectToast('这个领奖码已经核销过', '重复核销有提示');
    await page.waitForFunction(() => document.getElementById('draws-count').textContent.includes('已领 2 人'));
    ok((await winRow('654321').textContent()).includes('已领取'), '页面上也改成已领取');
    let undoAsk = '';
    page.once('dialog', (d) => { undoAsk = d.message(); d.accept(); });
    await winRow('123456').getByText('撤回').click();
    await expectToast('已改回待领取', '撤回核销');
    ok(undoAsk.includes('把 123456 改回待领取'), '撤回前问一句');
    eq(cloud.col('draws').find((d) => d.code === '123456').redeemed, false, '云端改回待领取');
    // 中奖的人超过名单上限：说明没列全，输入完整的领奖码到云端查
    for (let i = 0; i < 2000; i++) {
      cloud.col('draws').push({ _id: wheelId + '_bulk' + i + '_1', interactionId: wheelId, openid: 'bulk' + i, n: 1, win: true, prizeId: prizes[0].id, prizeName: '运动毛巾',
        code: String(300000 + i), redeemed: false, createdAt: new Date(now - 100000 + i) });
    }
    await page.click('#draws-close');
    await ixRow().getByText('中奖名单').click();
    await page.waitForFunction(() => document.getElementById('draws-count').textContent.includes('只列出先中奖的 2000 人'));
    ok(!(await page.locator('#draws-rows tr[data-code="301999"]').count()), '最后中奖的人不在名单里');
    await page.fill('#draws-search', '301999');
    await page.waitForFunction(() => document.querySelectorAll('#draws-rows tr[data-code="301999"]').length === 1);
    ok(true, '输入完整的领奖码，到云端查到名单外的人');
    await page.fill('#draws-search', '');
    await shot('draws');
    const download3 = page.waitForEvent('download');
    await page.click('#draws-export');
    const csv3 = fs.readFileSync(await (await download3).path(), 'utf8');
    ok(csv3.includes('"中奖时间","奖品","领奖码","昵称","会员编号","手机号","领奖状态","领取时间"') && csv3.includes('"123456"') && csv3.includes('"老李"') && csv3.includes('"不是会员"'), '导出中奖名单');
    await page.click('#draws-close');
    await page.waitForFunction(() => document.getElementById('ix-rows').textContent.includes('抽了 3 次，中奖 2 人，已领 1 人'));
    ok(true, '关掉名单后列表上的已领人数是新的');

    // 小程序码：生成正式版的，显示出来可以下载；生成失败时说清楚
    await ixRow().getByText('小程序码').click();
    await page.waitForSelector('#code-img:not([hidden])');
    const codeSrc = await page.getAttribute('#code-img', 'src');
    ok(codeSrc.includes('interact/' + wheelId + '-release.png'), '显示生成的小程序码');
    eq([cloud.state.codes.slice(-1)[0].scene, cloud.state.codes.slice(-1)[0].envVersion], [wheelId, 'release'], '码里是互动的 id，打开正式版');
    eq(await page.getAttribute('#code-download', 'href'), codeSrc, '可以下载这张图');
    await shot('code');
    await page.click('#code-close');
    cloud.state.codeError = 41030;
    await ixRow().getByText('小程序码').click();
    await page.waitForFunction(() => document.getElementById('code-status').textContent.indexOf('小程序码没生成出来') === 0);
    ok(await page.isHidden('#code-download') && await page.isHidden('#code-img'), '没生成出来时说清楚，不给下载');
    cloud.state.codeError = null;
    await page.keyboard.press('Escape');
    ok(await page.isHidden('#code-modal'), 'Esc 关掉小程序码');

    // 网页互动：地址要 https；没有中奖名单。新建的填了一半关掉要问
    await page.click('#ix-new');
    await page.click('#ix-kind-seg [data-kind="web"]');
    ok(await page.isHidden('#ix-wheel') && await page.isVisible('#ix-web'), '换成网页后只填网页地址');
    await page.fill('#x-title', '现场答题');
    let newAsk = '';
    page.once('dialog', (d) => { newAsk = d.message(); d.dismiss(); });
    await page.click('#ix-close');
    ok(newAsk.includes('没有保存') && await page.isVisible('#ix-drawer'), '新建的互动填了一半关掉也要问');
    await page.fill('#x-url', 'http://h5.example.com/quiz');
    await page.click('#ix-save');
    await expectToast('网页地址要以 https:// 开头', '网页地址要 https');
    await page.fill('#x-url', 'https://h5.example.com/quiz');
    await page.click('#ix-save');
    await page.waitForSelector('#ix-drawer', { state: 'hidden' });
    await page.locator('#ix-rows tr', { hasText: '现场答题' }).waitFor();
    eq(await page.locator('#ix-rows tr', { hasText: '现场答题' }).getByText('中奖名单').count(), 0, '网页互动没有中奖名单');
    eq(cloud.col('interactions').find((x) => x.title === '现场答题').url, 'https://h5.example.com/quiz', '网页地址存上');

    // 删除：问一句，列表里没了，抽奖记录还在
    let delAsk = '';
    page.once('dialog', (d) => { delAsk = d.message(); d.accept(); });
    await ixRow().getByText('删除').click();
    await expectToast('已删除', '删除互动');
    ok(delAsk.includes('删掉「幸运大转盘」'), '删除前问一句');
    await page.waitForFunction(() => !document.getElementById('ix-rows').textContent.includes('幸运大转盘'));
    eq([ixDoc().deleted, cloud.col('draws').some((d) => d.interactionId === wheelId)], [true, true], '云端标成删除了，抽奖记录还在');
    await page.click('[data-tab="events"]');
    await page.waitForSelector('#ev-rows tr');

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

    // ----- 写入成功但响应丢失：重试复用operationId，余额和流水都只变化一次 -----
    await page.fill('#adj-amount', '10');
    await page.fill('#adj-reason', '响应丢失重试验证');
    const pointBeforeRetry = cloud.col('members').find((m) => m._id === 'user-a').points;
    const logsBeforeRetry = cloud.col('point_logs').filter((l) => l.openid === 'user-a').length;
    lostResponse.adminAdjustPoints = 1;
    page.once('dialog', (d) => d.accept());
    await page.click('#adj-submit');
    await expectToast('网络异常，请稍后再试', '响应丢失时提示重试');
    eq(cloud.col('members').find((m) => m._id === 'user-a').points, pointBeforeRetry + 10, '丢响应之前服务端确实已经执行');
    const firstRetry = requests.filter((d) => d.action === 'adminAdjustPoints').slice(-1)[0];
    page.once('dialog', (d) => d.accept());
    await page.click('#adj-submit');
    await expectToast('已调整', '同一笔调整重试可以恢复结果');
    const secondRetry = requests.filter((d) => d.action === 'adminAdjustPoints').slice(-1)[0];
    ok(firstRetry.operationId && firstRetry.operationId === secondRetry.operationId, '丢响应后的重试带同一个operationId');
    eq(cloud.col('members').find((m) => m._id === 'user-a').points, pointBeforeRetry + 10, '重试不会再次加积分');
    eq(cloud.col('point_logs').filter((l) => l.openid === 'user-a').length, logsBeforeRetry + 1, '重试不会再次记流水');

    // ----- 刷新页面还在登录状态；凭证过期后回到登录页 -----
    // 上一个断言留下了未提交的积分草稿，刷新前明确清掉。
    await page.fill('#adj-amount', '');
    await page.fill('#adj-reason', '');
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
    // 正在查另一位会员时从名单点「调积分」：以点的这一位为准，先前那次的结果回来了也不用
    await page.click('[data-tab="points"]');
    slow.adminFindMember = 600;
    await page.fill('#find-query', '100001');
    await page.click('#find-submit');
    slow.adminFindMember = 0;
    await page.click('[data-tab="members"]');
    await page.waitForFunction((n) => document.querySelectorAll('#mb-rows tr').length >= 30);
    await page.click('#mb-rows button[data-no="' + memberB.memberNo + '"]');
    await page.waitForSelector('#adjust-form:not([hidden])');
    await new Promise((r) => setTimeout(r, 900));
    ok((await page.textContent('#m-no')).includes(memberB.memberNo) && (await page.inputValue('#find-query')) === memberB.memberNo, '先前那次查找的结果不会盖掉刚点的这位会员');
    await page.click('[data-tab="members"]');
    await page.waitForFunction(() => !document.getElementById('mb-more').disabled);
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
