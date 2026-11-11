/**
 * 小程序运行环境的最小替身：App / Page / Component / wx，只够把页面渲染成静态 HTML。
 * 仅供本地预览用，见 tools/preview/README.md。
 */
const fs = require('fs');
const path = require('path');
const { renderFile, readWxss, wxssToCss } = require('./wxml.js');

const ROOT = path.resolve(__dirname, '../../miniprogram');

function setByPath(obj, key, value) {
  const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (o[parts[i]] == null) o[parts[i]] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    o = o[parts[i]];
  }
  o[parts[parts.length - 1]] = value;
}
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function createWx(opts) {
  const storage = Object.assign({}, opts.storage);
  const calls = [];
  const rec = (name) => (o) => {
    calls.push({ api: name, args: o });
    if (o && typeof o.success === 'function') o.success({});
    if (o && typeof o.complete === 'function') o.complete({});
    return Promise.resolve({});
  };
  const windowInfo = { statusBarHeight: opts.statusBarHeight || 0, windowWidth: 390, windowHeight: 844, screenWidth: 390, screenHeight: 844, pixelRatio: 2, safeArea: { top: 0, bottom: 844 } };
  const observer = () => {
    const o = {
      relativeToViewport: () => o, relativeTo: () => o, disconnect: () => {},
      observe: (sel, cb) => { cb({ intersectionRatio: 1, id: '', dataset: {} }); }
    };
    return o;
  };
  const query = () => {
    const q = { select: () => q, selectAll: () => q, selectViewport: () => q, in: () => q, boundingClientRect: () => q, scrollOffset: () => q, fields: () => q, node: () => q, exec: () => {} };
    return q;
  };
  const wx = {
    __calls: calls,
    __storage: storage,
    __fonts: [],
    getWindowInfo: () => windowInfo,
    getSystemInfoSync: () => windowInfo,
    getDeviceInfo: () => ({ platform: 'devtools' }),
    getAppBaseInfo: () => ({ SDKVersion: '3.0.0' }),
    getMenuButtonBoundingClientRect: () => ({ top: 4, bottom: 36, left: 293, right: 380, width: 87, height: 32 }),
    getAccountInfoSync: () => ({ miniProgram: { appId: 'touristappid', envVersion: 'develop' } }),
    canIUse: () => true,
    nextTick: (fn) => fn(),
    getStorageSync: (k) => (k in storage ? clone(storage[k]) : ''),
    setStorageSync: (k, v) => { storage[k] = clone(v); },
    removeStorageSync: (k) => { delete storage[k]; },
    loadFontFace: (o) => { wx.__fonts.push(o); if (o.success) o.success({ status: 'loaded' }); },
    createIntersectionObserver: observer,
    createSelectorQuery: query,
    createVideoContext: () => ({ play() {}, pause() {} }),
    requestSubscribeMessage: (o) => { calls.push({ api: 'requestSubscribeMessage', args: o }); const r = {}; (o.tmplIds || []).forEach((t) => { r[t] = 'accept'; }); if (o.success) o.success(r); },
    getUpdateManager: () => ({ onCheckForUpdate() {}, onUpdateReady() {}, onUpdateFailed() {} })
  };
  ['navigateTo', 'redirectTo', 'switchTab', 'reLaunch', 'navigateBack', 'showToast', 'hideToast', 'showModal', 'showLoading', 'hideLoading',
    'setNavigationBarColor', 'setNavigationBarTitle', 'pageScrollTo', 'previewImage', 'setClipboardData', 'showShareMenu', 'openPrivacyContract',
    'vibrateShort', 'reportEvent'].forEach((n) => { wx[n] = rec(n); });
  // 测试时可以塞进额外的接口（比如 wx.cloud 的替身）
  Object.assign(wx, opts.wx);
  return wx;
}

/** 重新执行页面或组件的 JS（它依赖的 utils 等模块保持已加载的状态） */
function freshRequire(file) {
  delete require.cache[require.resolve(file)];
  return require(file);
}
function clearCache() {
  for (const k of Object.keys(require.cache)) if (k.startsWith(ROOT)) delete require.cache[k];
}

function readJson(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

function resolveComponents(json, baseDir, appJson) {
  const map = {};
  const add = (uc, dir) => {
    for (const tag of Object.keys(uc || {})) {
      const p = uc[tag];
      map[tag] = p.startsWith('/') ? path.join(ROOT, p) : path.resolve(dir, p);
    }
  };
  add(appJson.usingComponents, ROOT);
  add(json.usingComponents, baseDir);
  return map;
}

function mergeBehaviors(def) {
  const out = { properties: {}, data: {}, methods: {}, observers: {}, lifetimes: {}, pageLifetimes: {} };
  const apply = (d) => {
    (d.behaviors || []).forEach(apply);
    Object.assign(out.properties, d.properties);
    Object.assign(out.data, clone(d.data || {}));
    Object.assign(out.methods, d.methods);
    Object.assign(out.observers, d.observers);
    Object.assign(out.pageLifetimes, d.pageLifetimes);
    const lt = Object.assign({}, d.lifetimes);
    ['created', 'attached', 'ready'].forEach((k) => { if (!lt[k] && d[k]) lt[k] = d[k]; });
    Object.assign(out.lifetimes, lt);
  };
  apply(def);
  out.options = def.options || {};
  return out;
}

function createEnv(opts) {
  opts = opts || {};
  clearCache();
  const wx = createWx(opts);
  const appJson = readJson(path.join(ROOT, 'app.json'));
  const css = [wxssToCss(readWxss(path.join(ROOT, 'app.wxss')))];
  const cssSeen = new Set();
  let app = null;
  let captured = null;
  let compSeq = 0;

  globalThis.wx = wx;
  globalThis.getApp = () => app;
  globalThis.getCurrentPages = () => env.pages;
  globalThis.App = (def) => { app = def; };
  globalThis.Page = (def) => { captured = def; };
  globalThis.Component = (def) => { captured = def; };
  globalThis.Behavior = (def) => def;

  function addCss(file, hostId) {
    if (cssSeen.has(file)) return;
    cssSeen.add(file);
    css.push(wxssToCss(readWxss(file), hostId));
  }

  function instantiateComponent(base, props) {
    captured = null;
    freshRequire(base + '.js');
    const def = mergeBehaviors(captured || {});
    const json = readJson(base + '.json');
    const id = path.relative(ROOT, base);
    addCss(base + '.wxss', id);
    const data = clone(def.data);
    for (const k of Object.keys(def.properties)) {
      const p = def.properties[k];
      const hasDefault = p && typeof p === 'object' && 'value' in p;
      const type = p && typeof p === 'object' ? p.type : p;
      data[k] = hasDefault ? clone(p.value) : type === String ? '' : type === Number ? 0 : type === Boolean ? false : type === Array ? [] : null;
    }
    for (const k of Object.keys(props || {})) if (props[k] !== undefined) data[k] = props[k];
    const inst = Object.assign({}, def.methods, {
      data: data, properties: data, is: id,
      setData(o, cb) { for (const k of Object.keys(o)) setByPath(data, k, o[k]); if (cb) cb(); },
      triggerEvent() {},
      getTabBar() { return env.tabBar; },
      createSelectorQuery: wx.createSelectorQuery,
      createIntersectionObserver: wx.createIntersectionObserver,
      selectComponent() { return null; }
    });
    inst.__def = def;
    inst.__base = base;
    inst.__components = resolveComponents(json, path.dirname(base), appJson);
    ['created', 'attached'].forEach((k) => { if (def.lifetimes[k]) def.lifetimes[k].call(inst); });
    for (const key of Object.keys(def.observers)) {
      const fields = key.split(',').map((s) => s.trim());
      def.observers[key].apply(inst, fields.map((f) => (f === '**' ? data : f.split('.').reduce((o, p) => (o == null ? o : o[p]), data))));
    }
    if (def.lifetimes.ready) def.lifetimes.ready.call(inst);
    if (def.pageLifetimes.show) def.pageLifetimes.show.call(inst);
    return inst;
  }

  function renderInstance(inst, slots) {
    return renderFile(inst.__base + '.wxml', inst.data, {
      components: inst.__components,
      slots: slots,
      renderComponent: (base, props, childSlots) => {
        const child = instantiateComponent(base, props);
        compSeq += 1;
        return { id: child.is, html: renderInstance(child, childSlots) };
      }
    });
  }

  const env = {
    wx: wx, pages: [], tabBar: null, page: null,
    get app() { return app; },

    launch() {
      freshRequire(path.join(ROOT, 'app.js'));
      if (app && app.onLaunch) app.onLaunch({});
      if (app && app.onShow) app.onShow({});
      return app;
    },

    openPage(route, query) {
      const base = path.join(ROOT, route);
      captured = null;
      freshRequire(base + '.js');
      const def = captured;
      if (!def) throw new Error(route + '.js 没有调用 Page()');
      const json = readJson(base + '.json');
      addCss(base + '.wxss');
      const isTab = appJson.tabBar && appJson.tabBar.custom && (appJson.tabBar.list || []).some((t) => t.pagePath === route);
      env.tabBar = isTab ? instantiateComponent(path.join(ROOT, 'custom-tab-bar/index')) : null;
      const page = Object.create(def);
      page.data = clone(def.data || {});
      page.route = route;
      page.options = query || {};
      page.setData = function (o, cb) { for (const k of Object.keys(o)) setByPath(page.data, k, o[k]); if (cb) cb(); };
      page.getTabBar = () => env.tabBar;
      page.createSelectorQuery = wx.createSelectorQuery;
      page.createIntersectionObserver = wx.createIntersectionObserver;
      page.selectComponent = () => null;
      page.__base = base;
      page.__components = resolveComponents(json, path.dirname(base), appJson);
      env.pages = [page];
      env.page = page;
      if (page.onLoad) page.onLoad(page.options);
      if (page.onShow) page.onShow();
      if (page.onReady) page.onReady();
      return page;
    },

    /** 触发一个事件处理函数，等价于用户点击 */
    tap(handler, dataset, detail) {
      const e = { type: 'tap', currentTarget: { dataset: dataset || {}, id: '' }, target: { dataset: dataset || {}, id: '' }, detail: detail || {} };
      if (typeof env.page[handler] !== 'function') throw new Error('页面上没有 ' + handler + ' 方法');
      return env.page[handler](e);
    },

    renderHtml(extraCss) {
      const body = renderInstance(env.page);
      let tab = '';
      if (env.tabBar) tab = '<wx-comp data-c="custom-tab-bar/index">' + renderInstance(env.tabBar) + '</wx-comp>';
      const fonts = wx.__fonts.map((f) => '@font-face{font-family:"' + f.family + '";src:' + f.source +
        (f.desc && f.desc.style ? ';font-style:' + f.desc.style : '') + (f.desc && f.desc.weight ? ';font-weight:' + f.desc.weight : '') + '}').join('\n');
      return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=390">' +
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700;900&display=swap">' +
        '<style>' + fs.readFileSync(path.join(__dirname, 'base.css'), 'utf8') + '</style>' +
        '<style>' + fonts + '</style><style>' + css.join('\n') + '</style>' +
        '<style>' + (extraCss || '') + '</style></head><body>' + body + tab + '</body></html>';
    }
  };
  return env;
}

module.exports = { createEnv, ROOT };
