/**
 * 加载 Barlow Condensed（数字和英文用）。中文用系统字体，不加载。
 *
 * wx.loadFontFace 用 https 地址加载字体时要求服务器允许跨域。云存储本身允许，但它前面的 CDN 会把
 * 「不带跨域许可」的响应缓存下来再发给别人，所以直接用 https 地址时有时能加载、有时不能。
 * 资源放在云存储时改走另一条路：用 wx.cloud.downloadFile 把字体下到本机，读成 Data URL 再交给 loadFontFace，
 * 不经过跨域检查，也不用配下载域名。下过一次就存在本机，之后直接读。
 * 这条路上任何一步失败，都退回用 https 地址加载；再失败就是系统字体，不影响使用。
 */
const config = require('../config.js');
const cloud = require('./cloud.js');
const { assetUrl } = require('./assets.js');

const FAMILY = 'Barlow Condensed';
// 只加载设计里用到的字重：斜体 700 / 800，以及补给时刻格子里的正体 700
const FONTS = [
  { style: 'italic', weight: '700', file: 'assets/fonts/barlow-condensed-latin-700-italic.woff2' },
  { style: 'italic', weight: '800', file: 'assets/fonts/barlow-condensed-latin-800-italic.woff2' },
  { style: 'normal', weight: '700', file: 'assets/fonts/barlow-condensed-latin-700-normal.woff2' }
];

const CLOUD_HOST = /^https:\/\/([\w-]+)\.tcb\.qcloud\.la\/?$/;

/** 资源前缀是云存储的域名时，返回这个文件的云文件 ID；否则返回空 */
function cloudFileId(file) {
  const m = CLOUD_HOST.exec(config.assetBase);
  if (!m || !cloud.enabled()) return '';
  return 'cloud://' + config.cloudEnv + '.' + m[1] + '/' + file;
}

const dataUrl = (base64) => 'url("data:font/woff2;base64,' + base64 + '")';

/** 读本机文件成 base64 */
function readBase64(fs, filePath) {
  return new Promise((resolve, reject) => {
    fs.readFile({ filePath: filePath, encoding: 'base64', success: (res) => resolve(res.data), fail: reject });
  });
}

/** 这个字体交给 loadFontFace 的 source：优先本机缓存，其次从云存储下载，都不行就用 https 地址 */
function fontSource(font) {
  const https = 'url("' + assetUrl(font.file) + '")';
  const fileID = cloudFileId(font.file);
  if (!fileID) return Promise.resolve(https);
  let fs;
  let saved;
  try {
    fs = wx.getFileSystemManager();
    saved = wx.env.USER_DATA_PATH + '/sx-' + font.file.split('/').pop();
    cloud.init();
  } catch (e) {
    return Promise.resolve(https);
  }
  return readBase64(fs, saved)
    .catch(() => wx.cloud.downloadFile({ fileID: fileID }).then((res) => readBase64(fs, res.tempFilePath).then((base64) => {
      // 存一份到本机，下次不用再下；存不上也不要紧
      try { fs.copyFile({ srcPath: res.tempFilePath, destPath: saved, fail() {} }); } catch (e) { /* 忽略 */ }
      return base64;
    })))
    .then(dataUrl)
    .catch(() => https);
}

function loadFonts() {
  FONTS.forEach((font) => {
    fontSource(font).then((source) => {
      wx.loadFontFace({
        global: true,
        family: FAMILY,
        source: source,
        desc: { style: font.style, weight: font.weight },
        // 加载失败时回退到系统字体，不影响使用
        fail: () => {}
      });
    });
  });
}

module.exports = { loadFonts, cloudFileId, FONTS };
