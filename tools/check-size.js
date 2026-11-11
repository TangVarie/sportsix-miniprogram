/**
 * 包体积检查：统计 miniprogram/ 里会打进包的文件。单个包上限 2M（微信官方文档「分包加载」）。
 * 运行：npm run size
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../miniprogram');
const LIMIT = 2 * 1024 * 1024;
const IGNORE = ['utils/fuel-plan.test.js']; // project.config.json 的 packOptions.ignore

const groups = {};
let total = 0;
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    const rel = path.relative(root, file);
    if (fs.statSync(file).isDirectory()) { walk(file); continue; }
    if (IGNORE.includes(rel)) continue;
    const size = fs.statSync(file).size;
    const key = rel.split(path.sep).slice(0, rel.startsWith('assets') ? 2 : 1).join('/');
    groups[key] = (groups[key] || 0) + size;
    total += size;
  }
})(root);

const kb = (n) => (n / 1024).toFixed(1).padStart(8) + ' KB';
Object.keys(groups).sort((a, b) => groups[b] - groups[a]).forEach((k) => console.log(kb(groups[k]) + '  ' + k));
console.log(kb(total) + '  合计（未压缩；上限 ' + LIMIT / 1024 + ' KB）');
if (total > LIMIT) { console.error('超过单包 2M 上限'); process.exit(1); }
