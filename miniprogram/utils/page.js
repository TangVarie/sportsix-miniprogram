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
 * 自定义导航下，状态栏文字颜色要跟着背景走：深色首屏用白字，滚到浅色内容后换黑字。
 * 在 onPageScroll 里调用：navTone(this, e.scrollTop, 首屏高度px)
 */
function navTone(page, scrollTop, threshold) {
  const dark = scrollTop < threshold;
  if (page.__navDark === dark) return;
  page.__navDark = dark;
  wx.setNavigationBarColor({ frontColor: dark ? '#ffffff' : '#000000', backgroundColor: dark ? '#010439' : '#ffffff' });
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

module.exports = { baseData, watchReveal, navTone, go, selectTab, TABS };
