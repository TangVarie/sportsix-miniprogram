const events = require('../../utils/events.js');
const { baseData, selectTab, go, navTone, headerTone } = require('../../utils/page.js');
const { assetUrl } = require('../../utils/assets.js');

Page({
  data: Object.assign(baseData(), {
    arc: assetUrl('assets/graphics/events-header-arc.svg'),
    tab: 'upcoming',
    hasUpcoming: false,
    upcoming: [],
    past: []
  }),

  onLoad() {
    this.setData(baseData());
    this.setData({ past: events.listPast() });
    // 头部设计高 176px，状态栏滚出它之后文字换成黑色
    this.toneAt = headerTone(176);
  },

  onPageScroll(e) {
    navTone(this, e.scrollTop, this.toneAt);
  },

  onShow() {
    selectTab(this, 2);
    // 提醒状态可能在详情页里变了，每次显示都重读
    const upcoming = events.listUpcoming().map((e) => Object.assign({}, e, { reminded: events.hasReminder(e.id) }));
    const hasUpcoming = upcoming.length > 0;
    this.setData({ upcoming: upcoming, hasUpcoming: hasUpcoming, tab: hasUpcoming ? this.data.tab : 'past' });
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
