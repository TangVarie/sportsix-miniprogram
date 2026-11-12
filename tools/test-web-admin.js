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
    { _id: 'old', type: '抽奖', title: '周年抽奖', status: 'published', date: new Date(now - 40 * DAY), signupCount: 120 }
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
    eq(await page.locator('#ev-rows tr').count(), 3, '列出全部活动');
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
    await page.waitForFunction(() => document.querySelectorAll('#ev-rows tr').length === 4);

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

    await page.click('[data-tab="notice"]');
    await page.waitForSelector('#tab-notice:not([hidden])');
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
