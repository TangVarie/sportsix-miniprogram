const events = require('../../utils/events.js');
const store = require('../../utils/store.js');
const member = require('../../content/member.js');
const { baseData, go, navTone, headerTone } = require('../../utils/page.js');

// 「已设提醒」的说法：活动自己带 actionDone 就用它（目前只有赛事示例有），否则用会员文案里同一个状态名
const REMINDED_TEXT = member.me.events.states[1];

Page({
  data: Object.assign(baseData(), {
    event: null,
    detail: null,
    headFields: [],
    rowFields: [],
    reminded: false,
    remindedText: REMINDED_TEXT
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
      reminded: event ? events.hasReminder(event.id) : false,
      remindedText: (event && event.actionDone) || REMINDED_TEXT
    }));
    // 头部设计高 356px，状态栏滚出它之后文字换成黑色
    this.toneAt = headerTone(356);
  },

  onPageScroll(e) {
    navTone(this, e.scrollTop, this.toneAt);
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
