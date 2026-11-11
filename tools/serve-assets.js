/**
 * 本地资源服务：把仓库里的 assets/ 当成 CDN 用，开发时配合 miniprogram/config.js 的 assetBase。
 * 运行：npm run assets   （默认 http://127.0.0.1:8787/assets/...）
 * 上线前把 assets/ 传到正式的 CDN 或云存储，再改 assetBase。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const TYPES = {
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.json': 'application/json',
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript'
};

/** 静态文件处理：mounts 是 [{ prefix, dir }]，按顺序匹配 */
function staticHandler(mounts) {
  return (req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const mount = mounts.find((m) => url.startsWith(m.prefix));
    if (!mount) { res.writeHead(404); res.end('not found'); return; }
    const file = path.join(mount.dir, url.slice(mount.prefix.length));
    if (!file.startsWith(mount.dir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('not found'); return; }
    const size = fs.statSync(file).size;
    const headers = {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache', 'Accept-Ranges': 'bytes'
    };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range) {
      const start = range[1] ? parseInt(range[1], 10) : 0;
      const end = range[2] ? Math.min(parseInt(range[2], 10), size - 1) : size - 1;
      res.writeHead(206, Object.assign(headers, { 'Content-Range': 'bytes ' + start + '-' + end + '/' + size, 'Content-Length': end - start + 1 }));
      fs.createReadStream(file, { start: start, end: end }).pipe(res);
      return;
    }
    res.writeHead(200, Object.assign(headers, { 'Content-Length': size }));
    fs.createReadStream(file).pipe(res);
  };
}

function serveAssets(port) {
  const dir = path.resolve(__dirname, '../assets');
  const server = http.createServer(staticHandler([{ prefix: '/assets/', dir: dir + path.sep }]));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

module.exports = { staticHandler, serveAssets };

if (require.main === module) {
  const port = parseInt(process.env.PORT || '8787', 10);
  serveAssets(port).then(() => console.log('assets → http://127.0.0.1:' + port + '/assets/'));
}
