#!/usr/bin/env node
/**
 * 把小程序页面渲染成 HTML 并截图，可与设计稿并排对照。用法见 tools/preview/README.md。
 *
 *   node tools/preview/shot.js --route pages/events/index --out out/events.png
 *     [--query "id=energy-gel"]            页面参数
 *     [--do "tap('onTab',{key:'past'})"]    渲染前执行的 JS，可用 page、tap(handler, dataset, detail)、wx、app
 *     [--storage '{"key":value}']           预置本地存储
 *     [--compare design/screens/x.png]      生成并排对照图：左设计稿、右渲染结果
 *     [--slice 1400]                        对照图每张的高度（设计稿 px）
 *     [--html out/x.html]                   另存渲染出的 HTML
 *     [--motion]                            不关闭动效（默认按「减少动态效果」渲染静止状态）
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { createEnv, ROOT } = require('./runtime.js');
const { staticHandler, serveAssets } = require('../serve-assets.js');

function args() {
  const a = {};
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) {
    if (!v[i].startsWith('--')) continue;
    const k = v[i].slice(2);
    a[k] = v[i + 1] && !v[i + 1].startsWith('--') ? v[++i] : true;
  }
  return a;
}

async function main() {
  const a = args();
  if (!a.route) { console.error('缺少 --route'); process.exit(1); }
  const out = path.resolve(a.out || 'out/' + a.route.replace(/\//g, '-') + '.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });

  // 渲染
  const env = createEnv({ storage: a.storage ? JSON.parse(a.storage) : {} });
  const app = env.launch();
  const query = {};
  if (a.query) new URLSearchParams(a.query).forEach((val, k) => { query[k] = val; });
  const page = env.openPage(a.route, query);
  if (a.do) {
    const r = new Function('page', 'tap', 'wx', 'app', 'env', a.do)(page, env.tap, env.wx, app, env);
    if (r && typeof r.then === 'function') await r;
  }
  await new Promise((r) => setTimeout(r, 30)); // 等页面里的 Promise 和定时器跑完
  const html = env.renderHtml();
  if (a.html) fs.writeFileSync(path.resolve(a.html), html);

  // 服务：资源（8787，若已在运行则复用）和页面（随机端口）
  const config = require(path.join(ROOT, 'config.js'));
  const assetPort = parseInt(new URL(config.assetBase).port || '80', 10);
  let assetServer = null;
  try { assetServer = await serveAssets(assetPort); } catch (e) { if (e.code !== 'EADDRINUSE') throw e; }
  const files = staticHandler([{ prefix: '/', dir: ROOT + path.sep }]);
  const design = a.compare ? path.resolve(a.compare) : null;
  const pageServer = http.createServer((req, res) => {
    if (req.url === '/__page.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); return; }
    if (req.url === '/__design.png' && design) { res.writeHead(200, { 'Content-Type': 'image/png' }); fs.createReadStream(design).pipe(res); return; }
    if (req.url === '/__render.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); fs.createReadStream(out).pipe(res); return; }
    files(req, res);
  });
  await new Promise((r) => pageServer.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + pageServer.address().port;

  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion: a.motion ? 'no-preference' : 'reduce' });
    const p = await ctx.newPage();
    const failed = [];
    p.on('requestfailed', (r) => failed.push(r.url()));
    p.on('response', (r) => { if (r.status() >= 400) failed.push(r.status() + ' ' + r.url()); });
    await p.goto(base + '/__page.html', { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(a.motion ? 2500 : 200);
    // 把视口拉到和内容一样高再截：fixed / sticky 的底栏落在页面最底部，和设计稿画板的画法一致
    const height = await p.evaluate(() => document.documentElement.scrollHeight);
    await p.setViewportSize({ width: 390, height: height });
    await p.waitForTimeout(100);
    await p.screenshot({ path: out, fullPage: true });
    console.log('截图 ' + path.relative(process.cwd(), out) + '（390 × ' + height + '）');
    if (failed.length) console.log('加载失败的资源：\n  ' + [...new Set(failed)].join('\n  '));

    if (design) {
      const slice = parseInt(a.slice || '1400', 10);
      const c = await browser.newContext({ viewport: { width: 800, height: slice }, deviceScaleFactor: 1 });
      const cp = await c.newPage();
      await cp.setContent('<body style="margin:0;background:#888;display:flex;gap:20px;align-items:flex-start">' +
        '<img id="d" src="' + base + '/__design.png" style="width:390px"><img id="r" src="' + base + '/__render.png" style="width:390px"></body>', { waitUntil: 'load' });
      const h = await cp.evaluate(() => Math.max(document.getElementById('d').height, document.getElementById('r').height));
      const dh = await cp.evaluate(() => document.getElementById('d').height);
      console.log('设计稿高 ' + dh + '，渲染高 ' + height + '（差 ' + (height - dh) + '）');
      const stem = out.replace(/\.png$/, '');
      for (let y = 0, i = 0; y < h; y += slice, i++) {
        const file = stem + '-cmp-' + i + '.png';
        await cp.screenshot({ path: file, fullPage: true, clip: { x: 0, y: y, width: 800, height: Math.min(slice, h - y) } });
        console.log('对照 ' + path.relative(process.cwd(), file) + '（y ' + y + '–' + Math.min(y + slice, h) + '，左设计稿 / 右渲染）');
      }
    }
  } finally {
    await browser.close();
    pageServer.close();
    if (assetServer) assetServer.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
