/**
 * 把小程序实际用到的资源挑出来，放进 out/cdn/assets/，方便整个文件夹上传到 CDN 或云存储。
 * 运行：npm run cdn
 * 只挑代码和文案里引用到的文件（不含随包的图标），没用到的（720p 原片、多余的字体等）不带上。
 * 上传后保持 assets/ 这一层目录，再把 miniprogram/config.js 的 assetBase 改成它前面的那段地址。
 */
const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const src = path.join(repo, 'miniprogram');
const out = path.join(repo, 'out/cdn');

function walk(dir, list) {
  for (const name of fs.readdirSync(dir)) {
    const f = path.join(dir, name);
    if (fs.statSync(f).isDirectory()) walk(f, list); else if (f.endsWith('.js')) list.push(f);
  }
  return list;
}

const used = new Set();
for (const f of walk(src, [])) {
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/['"](assets\/[\w./-]+\.\w+)['"]/g)) {
    if (!m[1].startsWith('assets/icons/')) used.add(m[1]);
  }
}

fs.rmSync(out, { recursive: true, force: true });
let total = 0;
const missing = [];
for (const p of [...used].sort()) {
  const from = path.join(repo, p);
  if (!fs.existsSync(from)) { missing.push(p); continue; }
  const to = path.join(out, p);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  const size = fs.statSync(from).size;
  total += size;
  console.log((size / 1024).toFixed(1).padStart(9) + ' KB  ' + p);
}
console.log((total / 1024 / 1024).toFixed(2).padStart(9) + ' MB  合计 ' + (used.size - missing.length) + ' 个文件 → out/cdn/assets/');
if (missing.length) { console.error('引用了但仓库里没有的文件：\n  ' + missing.join('\n  ')); process.exit(1); }
