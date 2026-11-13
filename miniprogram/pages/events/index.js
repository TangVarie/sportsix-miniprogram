const events = require('../../utils/events.js');
const store = require('../../utils/store.js');
const clientCopy = require('../../content/client-state.js');
const { eventState } = require('../../utils/event-state.js');
const { baseData, selectTab, go, navTone, headerTone, imgLoaded, shareCard, TABS } = require('../../utils/page.js');
const { assetUrl } = require('../../utils/assets.js');

Page({
  data: Object.assign(baseData(), {
    clientCopy: clientCopy,
    loadError: false,
    stale: false,
    pastError: false,
    pastStale: false,
    pastLoading: false,
    arc: assetUrl('assets/graphics/events-header-arc.svg'),
    tab: 'upcoming',
    hasUpcoming: false,
    // 第一次从云端取活动、还没返回
    loading: false,
    empty: events.getEmpty(),
    // 「有新活动通知我」那一行的文字，和现在是不是已经订阅
    news: events.getNews(),
    newsOn: false,
    upcoming: [],
    past: []
  }),

  /** 图片加载完（或加载失败）：让它淡入 */
  onImgLoad(e) {
    imgLoaded(this, e);
  },

  onShareAppMessage() {
    return shareCard(TABS.events);
  },

  onLoad() {
    this.setData(baseData());
    this.setData({ past: events.listPast() });
    // 头部设计高 176px，状态栏滚出它之后文字换成黑色
    this.toneAt = headerTone(176);
    // 云端数据同步完成后重画（提醒状态以云端为准）
    this.offStore = store.onChange(() => this.render());
    this.offEvents = events.onChange(() => this.render());
  },

  onPageScroll(e) {
    navTone(this, e.scrollTop, this.toneAt);
  },

  onShow() {
    selectTab(this, 2);
    this.render();
    this.onRetry();
    this.onPastRetry();
  },

  onUnload() {
    if (this.offStore) this.offStore();
    if (this.offEvents) this.offEvents();
  },

  /** 数据变化和加载状态变化都重画，网络错误不会伪装成空列表。 */
  render() {
    const upcoming = events.listUpcoming().map((e) => {
      const reminded = events.hasReminder(e.id);
      return Object.assign({}, e, { reminded: reminded, state: eventState(e, { reminded: reminded, signed: events.hasSignup(e.id) }) });
    });
    const load = events.getLoadState('upcoming');
    const past = events.getLoadState('past');
    this.setData({
      upcoming: upcoming, hasUpcoming: upcoming.length > 0, newsOn: events.hasNews(),
      loading: load.loading && !load.hasData, loadError: !!load.error, stale: !!load.error && load.hasData,
      past: events.listPast(), pastLoading: past.loading && !past.hasData, pastError: !!past.error, pastStale: past.stale
    });
  },

  onRetry() { return events.refresh().then(() => this.render()); },
  onPastRetry() { return events.refreshPast().then(() => this.render()); },

  /** 订阅新活动通知。已经订阅着的时候不再弹授权 */
  onNews() {
    if (this.data.newsOn || this.subscribing) return;
    this.subscribing = true;
    return events.subscribeNews().then(() => {
      this.subscribing = false;
      this.render();
    });
  },

  onTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
  },

  onOpen(e) {
    go('event-detail', { id: e.currentTarget.dataset.id });
  },

  onRemind(e) {
    const id = e.currentTarget.dataset.id;
    const event = this.data.upcoming.find((x) => x.id === id);
    if (!event || event.reminded || this.reminding === id) return;
    const state = eventState(event, { reminded: event.reminded, signed: events.hasSignup(id) });
    if (!state.canRemind) { wx.showToast({ title: state.reminderLabel, icon: 'none' }); return; }
    this.reminding = id;
    return events.remind(id).then(() => { this.reminding = null; this.render(); });
  }
});
