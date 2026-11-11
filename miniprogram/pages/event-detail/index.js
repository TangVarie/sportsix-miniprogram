const events = require('../../utils/events.js');
const store = require('../../utils/store.js');
const { baseData, go, navTone } = require('../../utils/page.js');

Page({
  data: Object.assign(baseData(), {
    event: null,
    detail: null,
    headFields: [],
    rowFields: [],
    reminded: false
  }),

  onLoad(query) {
    const event = events.getEvent(query.id);
    const detail = events.getDetail();
    this.setData(Object.assign(baseData(), {
      event: event,
      detail: detail,
      // 前三项在头图底部并排，后三项在正文里逐行列出
      headFields: detail.fields.slice(0, 3),
      rowFields: detail.fields.slice(3),
      reminded: event ? events.hasReminder(event.id) : false
    }));
  },

  onPageScroll(e) {
    navTone(this, e.scrollTop, 300);
  },

  onBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else go('events');
  },

  onRemind() {
    if (!this.data.event || this.data.reminded) return;
    events.remind(this.data.event.id).then((ok) => {
      if (ok) this.setData({ reminded: true });
    });
  },

  onSignup() {
    // 报名要先是会员；报名本身依赖后台，方案未定
    if (!store.isMember()) { go('join'); return; }
    wx.showToast({ title: '[报名待接入后台]', icon: 'none' });
  },

  onGroup() {
    // 群的形式（企业微信群、客服二维码）未定
    wx.showToast({ title: '[加群方式待定]', icon: 'none' });
  }
});
