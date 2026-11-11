const events = require('../../utils/events.js');
const store = require('../../utils/store.js');
const { baseData, selectTab, go, navTone, headerTone, imgLoaded } = require('../../utils/page.js');
const { assetUrl } = require('../../utils/assets.js');

Page({
  data: Object.assign(baseData(), {
    arc: assetUrl('assets/graphics/events-header-arc.svg'),
    tab: 'upcoming',
    hasUpcoming: false,
    // 第一次从云端取活动、还没返回
    loading: false,
    empty: events.getEmpty(),
    upcoming: [],
    past: []
  }),

  /** 图片加载完（或加载失败）：让它淡入 */
  onImgLoad(e) {
    imgLoaded(this, e);
  },

  onLoad() {
    this.setData(baseData());
    this.setData({ past: events.listPast() });
    // 头部设计高 176px，状态栏滚出它之后文字换成黑色
    this.toneAt = headerTone(176);
    // 云端数据同步完成后重画（提醒状态以云端为准）
    this.offStore = store.onChange(() => this.render());
  },

  onPageScroll(e) {
    navTone(this, e.scrollTop, this.toneAt);
  },

  onShow() {
    selectTab(this, 2);
    // 提醒状态可能在详情页里变了，每次显示都重读；再从云端取一次最新的活动
    if (events.isFirstLoad()) this.setData({ loading: true });
    this.render();
    events.refresh().then((changed) => {
      if (changed) this.render();
      if (this.data.loading) this.setData({ loading: false });
    });
  },

  onUnload() {
    if (this.offStore) this.offStore();
  },

  /** 按缓存里的活动和提醒状态重画列表 */
  render() {
    const upcoming = events.listUpcoming().map((e) => Object.assign({}, e, { reminded: events.hasReminder(e.id) }));
    // 没有活动时「即将开始」里显示「敬请期待」
    this.setData({ upcoming: upcoming, hasUpcoming: upcoming.length > 0 });
  },

  onTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
  },

  onOpen(e) {
    go('event-detail', { id: e.currentTarget.dataset.id });
  },

  onRemind(e) {
    const id = e.currentTarget.dataset.id;
    const index = this.data.upcoming.findIndex((x) => x.id === id);
    if (index < 0 || this.data.upcoming[index].reminded) return;
    events.remind(id).then((ok) => {
      if (ok) this.setData({ ['upcoming[' + index + '].reminded']: true });
    });
  }
});
