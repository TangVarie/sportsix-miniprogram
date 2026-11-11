/**
 * 工程自检，不依赖微信开发者工具。运行：npm run check
 * - app.json 里的页面、usingComponents 里的组件，四个文件是否齐全
 * - 每个页面都定义了 onShareAppMessage（否则不能转发）
 * - WXML / JS 里引用的随包图标是否存在；content 里的 assets/ 路径在仓库的 assets/ 下是否存在
 * - WXSS 里不生效的写法：属性选择器、带参数的伪类、通配符
 * - WXML 能否被预览工具解析（标签配对）
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('./preview/wxml.js');

const root = path.resolve(__dirname, '../miniprogram');
const repo = path.resolve(__dirname, '..');
const errors = [];
const rel = (f) => path.relative(repo, f);
const exists = (f) => fs.existsSync(f);
const read = (f) => fs.readFileSync(f, 'utf8');

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const f = path.join(dir, name);
    if (fs.statSync(f).isDirectory()) walk(f, out); else out.push(f);
  }
  return out;
}
const files = walk(root, []);

// 页面和组件
const app = JSON.parse(read(path.join(root, 'app.json')));
const units = app.pages.map((p) => path.join(root, p));
units.push(path.join(root, 'custom-tab-bar/index'));
for (const f of files.filter((x) => x.endsWith('.json'))) {
  let json;
  try { json = JSON.parse(read(f)); } catch (e) { errors.push(rel(f) + '：JSON 解析失败'); continue; }
  for (const p of Object.values(json.usingComponents || {})) {
    units.push(p.startsWith('/') ? path.join(root, p) : path.resolve(path.dirname(f), p));
  }
}
for (const u of new Set(units)) {
  for (const ext of ['.js', '.json', '.wxml', '.wxss']) if (!exists(u + ext)) errors.push('缺文件：' + rel(u + ext));
}
// 页面不定义 onShareAppMessage 的话，右上角菜单里的「转发」是灰的
for (const p of app.pages) {
  if (!/\bonShareAppMessage\s*\(/.test(fs.readFileSync(path.join(root, p + '.js'), 'utf8'))) errors.push('页面没有定义 onShareAppMessage，不能转发：' + p);
}
for (const t of app.tabBar.list) if (!app.pages.includes(t.pagePath)) errors.push('tabBar 页面不在 pages 里：' + t.pagePath);

// 图标引用（含 {{ }} 的动态路径跳过）
for (const f of files.filter((x) => /\.(wxml|js|wxss)$/.test(x))) {
  const text = read(f);
  for (const m of text.matchAll(/\/assets\/icons\/[\w{}\s.'?:-]+?\.svg/g)) {
    if (m[0].includes('{')) continue;
    if (!exists(path.join(root, m[0]))) errors.push(rel(f) + '：图标不存在 ' + m[0]);
  }
  for (const m of text.matchAll(/icon\('([\w-]+)'(?:,\s*'(\w+)')?\)/g)) {
    const p = 'assets/icons/' + m[1] + '-' + (m[2] || 'navy') + '.svg';
    if (!exists(path.join(root, p))) errors.push(rel(f) + '：图标不存在 ' + p);
  }
}

// 资源路径
for (const f of files.filter((x) => /\.js$/.test(x))) {
  for (const m of read(f).matchAll(/['"](assets\/[\w./-]+\.\w+)['"]/g)) {
    const p = m[1];
    const base = p.startsWith('assets/icons/') ? root : repo;
    if (!exists(path.join(base, p))) errors.push(rel(f) + '：资源不存在 ' + p);
  }
}

// WXSS
for (const f of files.filter((x) => x.endsWith('.wxss'))) {
  const css = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of css.matchAll(/([^{}]+)\{/g)) {
    const sel = m[1].trim();
    if (!sel || sel.startsWith('@') || /^(from|to|[\d.]+%)/.test(sel)) continue;
    if (/\[[^\]]*\]/.test(sel)) errors.push(rel(f) + '：属性选择器不生效 → ' + sel);
    if (/:(nth-|not\(|is\(|where\(|has\()/.test(sel)) errors.push(rel(f) + '：带参数的伪类不支持 → ' + sel);
    if (/(^|[\s>+~,])\*/.test(sel)) errors.push(rel(f) + '：通配符选择器 → ' + sel);
  }
}

// WXML
for (const f of files.filter((x) => x.endsWith('.wxml'))) {
  try { parse(read(f)); } catch (e) { errors.push(rel(f) + '：' + e.message); }
  if (/<wxs[\s>]/.test(read(f))) errors.push(rel(f) + '：用了 WXS，预览工具不支持');
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('工程自检通过：' + new Set(units).size + ' 个页面和组件，' + files.length + ' 个文件');
