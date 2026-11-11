const config = require('../config.js');

/**
 * content 里的资源路径 → 可用的地址。
 * 图标随包（/assets/icons/），其余走统一的资源前缀 config.assetBase。
 */
function assetUrl(p) {
  if (typeof p !== 'string' || p.indexOf('assets/') !== 0) return p;
  if (p.indexOf('assets/icons/') === 0) return '/' + p;
  return config.assetBase.replace(/\/$/, '') + '/' + p;
}

/** 图标地址。name 见 assets/icons/，color: navy | blue | lime | grey | white */
function icon(name, color) {
  return '/assets/icons/' + name + '-' + (color || 'navy') + '.svg';
}

/** 深拷贝一份数据，并把其中所有 `assets/...` 字符串换成可用地址 */
function withAssets(data) {
  if (typeof data === 'string') return assetUrl(data);
  if (Array.isArray(data)) return data.map(withAssets);
  if (data && typeof data === 'object') {
    const out = {};
    Object.keys(data).forEach((k) => { out[k] = withAssets(data[k]); });
    return out;
  }
  return data;
}

module.exports = { assetUrl, icon, withAssets };
