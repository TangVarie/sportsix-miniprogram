const member = require('../../content/member.js');
const store = require('../../utils/store.js');
const format = require('../../utils/format.js');
const clientCopy = require('../../content/client-state.js');
const { baseData, go, navTone, headerTone, shareCard, TABS } = require('../../utils/page.js');

const COPY = member.me.points;

/** 积分记录 → 页面显示用的数据。原因是 'welcome' 这类代号时换成 content 里的说法，其他的原样显示 */
function rows(logs) {
  return (logs || []).map((l, i) => ({
    id: l.id || String(i),
    reason: COPY.reasons[l.reason] || l.reason || '',
    date: l.at ? format.date(l.at) : '',
    plus: l.delta >= 0,
    delta: (l.delta >= 0 ? '+' : '') + l.delta
  }));
}

/**
 * 积分页：当前积分、一句用途说明、积分记录。从「我的」里点会员卡上的积分进来。
 * 设计稿里没有这一页。积分和记录都从云端取（utils/store.js 的 fetchPoints）。
 */
Page({
  data: Object.assign(baseData(), {
    copy: COPY,
    clientCopy: clientCopy,
    loadError: false,
    pointsLoaded: false,
    points: '0',
    logs: [],
    loading: true
  }),

  onLoad() {
    const m = store.getMember();
    // 没注册的不该到这一页（比如别人转发过来的链接）：去注册页
    if (!m) { go('join'); return; }
    this.setData(Object.assign(baseData(), { points: String(typeof m.points === 'number' ? m.points : 0) }));
    // 头部设计高 216px
    this.toneAt = headerTone(216);
    // 这一页是个人信息，不让转发
    try { wx.hideShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] }); } catch (e) { /* 旧基础库忽略 */ }
    this.onRetry();
  },

  onRetry() {
    if (this.fetching) return this.fetching;
    this.setData({ loading: true, loadError: false });
    this.fetching = store.fetchPoints()
      .then((d) => { if (!this.disposed) this.setData({ points: String(d.points), logs: rows(d.logs), loading: false, pointsLoaded: true }); })
      .catch(() => { if (!this.disposed) this.setData({ loading: false, loadError: true }); })
      .then(() => { this.fetching = null; });
    return this.fetching;
  },

  onUnload() { this.disposed = true; },

  onPageScroll(e) {
    navTone(this, e.scrollTop, this.toneAt);
  },

  /** 转发按钮已经收起来了；万一还是触发了，转出去的是首页 */
  onShareAppMessage() {
    return shareCard(TABS.home);
  },

  onBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else go('me');
  }
});
