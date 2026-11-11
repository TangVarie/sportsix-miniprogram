/**
 * 云开发的调用入口。只有一个云函数 api，用 action 区分接口（cloudfunctions/api/index.js）。
 */
const config = require('../config.js');

let inited = false;

/** 是否走云开发：config.cloudEnv 填了环境 ID */
function enabled() {
  return !!config.cloudEnv;
}

function init() {
  if (inited || !enabled()) return;
  if (!wx.cloud) throw new Error('基础库不支持云能力');
  // init 只能调用一次，多次调用只有第一次生效
  wx.cloud.init({ env: config.cloudEnv, traceUser: true });
  inited = true;
}

/**
 * 调用接口。成功时 resolve 接口返回的 data；失败时 reject 一个带 code 的 Error：
 * 业务错误是接口给的 code（not_member、full 等），网络或云函数异常是 'network'。
 */
function call(action, data) {
  return new Promise((resolve, reject) => {
    try { init(); } catch (e) { reject(Object.assign(e, { code: 'network' })); return; }
    wx.cloud.callFunction({ name: 'api', data: Object.assign({ action: action }, data) })
      .then((res) => {
        const r = res && res.result;
        if (r && r.ok) { resolve(r.data); return; }
        reject(Object.assign(new Error((r && r.code) || 'server_error'), { code: (r && r.code) || 'server_error' }));
      })
      .catch((e) => reject(Object.assign(e instanceof Error ? e : new Error(String(e && e.errMsg)), { code: 'network' })));
  });
}

module.exports = { enabled, init, call };
