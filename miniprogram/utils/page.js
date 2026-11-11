/**
 * 页面公用的小工具。
 */

/** 每个页面 data 里都要有的基础字段：safeTop 是状态栏高度（px），写到根节点的 --sx-safe-top 上。 */
function baseData() {
  const app = getApp();
  return { safeTop: (app && app.globalData.safeTop) || 0 };
}

/**
 * 进入视口时触发动效：把 data.seen[key] 置为 true。
 * 节点写法：<view id="rv-{key}" class="{{seen.key ? 'sx-in' : 'sx-wait'}}">，里面要动的元素加 sx-rise / sx-draw / sx-grow-x / sx-grow-y。
 * 在 onReady 里调用；返回的函数用于 onUnload 时停止监听。
 */
function watchReveal(page, keys) {
  const observers = [];
  keys.forEach((key) => {
    try {
      const ob = page.createIntersectionObserver({ thresholds: [0.01] });
      ob.relativeToViewport({ bottom: -40 }).observe('#rv-' + key, (res) => {
        if (res.intersectionRatio > 0 && !(page.data.seen && page.data.seen[key])) {
          page.setData({ ['seen.' + key]: true });
          ob.disconnect();
        }
      });
      observers.push(ob);
    } catch (e) {
      page.setData({ ['seen.' + key]: true });
    }
  });
  return () => observers.forEach((ob) => ob.disconnect());
}

/**
 * 自定义导航下，状态栏文字颜色要跟着背景走：压在深色分区上用白字，压在浅色内容上用黑字。
 * 在 onPageScroll 里调用：navTone(this, e.scrollTop, 首屏高度px)
 * 只有首屏是深色的页面给一个阈值就够了；深浅分区交替的长页面（首页、产品详情）先用 measureDarkZones 量出各段位置。
 */
function navTone(page, scrollTop, threshold) {
  const zones = page.__darkZones;
  let dark = scrollTop < threshold;
  if (zones && zones.length) {
    const probe = scrollTop + (getApp().globalData.safeTop || 0) / 2; // 状态栏中线压在哪一段上
    dark = zones.some((z) => probe >= z[0] && probe < z[1]);
  }
  if (page.__navDark === dark) return;
  page.__navDark = dark;
  wx.setNavigationBarColor({ frontColor: dark ? '#ffffff' : '#000000', backgroundColor: dark ? '#010439' : '#ffffff' });
}

/**
 * 量出页面上深色分区的位置（节点 class 里带 js-dark），供 navTone 使用。
 * 在 onReady 里调用；图片加载会撑开布局，所以稍后再量一次。返回的函数在 onUnload 里调用。
 */
function measureDarkZones(page) {
  const run = () => {
    try {
      page.createSelectorQuery().selectAll('.js-dark').boundingClientRect().selectViewport().scrollOffset().exec((res) => {
        const rects = res && res[0];
        const scroll = res && res[1];
        if (!rects || !rects.length || !scroll) return;
        page.__darkZones = rects.map((r) => [r.top + scroll.scrollTop, r.bottom + scroll.scrollTop]);
      });
    } catch (e) { /* 量不到就按阈值处理 */ }
  };
  run();
  const timer = setTimeout(run, 1500);
  return () => clearTimeout(timer);
}

/** 切到某个底部导航页 */
const TABS = { home: '/pages/home/index', fuel: '/pages/fuel/index', events: '/pages/events/index', me: '/pages/me/index' };
function go(to, params) {
  if (TABS[to]) { wx.switchTab({ url: TABS[to] }); return; }
  if (to === 'join') { wx.switchTab({ url: TABS.me }); return; }
  if (to === 'energy-gel' || to === 'energy-gel-pro') { wx.navigateTo({ url: '/pages/product/index?id=' + to }); return; }
  if (to === 'event-detail') { wx.navigateTo({ url: '/pages/event-detail/index' + (params && params.id ? '?id=' + params.id : '') }); return; }
}

/** 页面在底部导航里的序号，写进自定义 tabBar 的选中态 */
function selectTab(page, index) {
  if (typeof page.getTabBar === 'function' && page.getTabBar()) page.getTabBar().setData({ selected: index });
}

module.exports = { baseData, watchReveal, navTone, measureDarkZones, go, selectTab, TABS };
