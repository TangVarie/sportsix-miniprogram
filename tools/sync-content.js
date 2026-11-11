/**
 * 把 reference/content/*.json 原样生成为 miniprogram/content/*.js。
 * 小程序里用 require 读文案；JSON 是唯一的修改入口，生成的 .js 不要手改。
 * 运行：npm run content        检查是否同步：npm run content -- --check
 */
const fs = require('fs');
const path = require('path');

const src = path.resolve(__dirname, '../reference/content');
const dst = path.resolve(__dirname, '../miniprogram/content');
const check = process.argv.includes('--check');
let stale = 0;

fs.mkdirSync(dst, { recursive: true });
for (const f of fs.readdirSync(src).filter((x) => x.endsWith('.json'))) {
  const raw = fs.readFileSync(path.join(src, f), 'utf8');
  JSON.parse(raw); // 格式不对时直接报错
  const out = '// 由 tools/sync-content.js 从 reference/content/' + f + ' 生成，不要手改。\nmodule.exports = ' + raw.trim() + ';\n';
  const file = path.join(dst, f.replace(/\.json$/, '.js'));
  if (check) {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== out) { console.error('未同步：' + f); stale += 1; }
  } else {
    fs.writeFileSync(file, out);
    console.log('生成 miniprogram/content/' + path.basename(file));
  }
}
if (check && stale) process.exit(1);
if (check) console.log('content 已同步');
