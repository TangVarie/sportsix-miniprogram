const legal = require('../../content/legal.js');
const { baseData, go, navTone, headerTone, shareCard } = require('../../utils/page.js');

/** 把正文里的 {operator} 等换成 content/legal 的 fill 里填的主体信息 */
function fill(text) {
  return text.replace(/\{(\w+)\}/g, (all, key) => (legal.fill[key] != null ? legal.fill[key] : all));
}

/** 整理成页面显示用的数据 */
function build(type) {
  const doc = legal[type] || legal.agreement;
  return {
    title: doc.title,
    meta: fill(doc.meta),
    intro: doc.intro.map(fill),
    sections: doc.sections.map((s) => ({ h: s.h, p: s.p.map(fill) }))
  };
}

/**
 * 用户协议、隐私政策。参数 type=agreement | privacy。
 * 正文在 reference/content/legal.json（生成到 content/legal.js）。设计稿里没有这一页，版式沿用现有页面的头部和正文样式。
 */
Page({
  data: Object.assign(baseData(), { doc: build('agreement') }),

  onLoad(query) {
    this.docType = query.type;
    this.setData(Object.assign(baseData(), { doc: build(query.type) }));
    wx.setNavigationBarTitle({ title: this.data.doc.title });
    // 头部设计高 132px
    this.toneAt = headerTone(132);
  },

  onPageScroll(e) {
    navTone(this, e.scrollTop, this.toneAt);
  },

  onShareAppMessage() {
    return shareCard('/pages/doc/index?type=' + (this.docType || 'agreement'), this.data.doc ? this.data.doc.title : '');
  },

  onBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else go('me');
  }
});
