const interact = require('../../utils/interact.js');
const clientCopy = require('../../content/client-state.js');
const { shareCard } = require('../../utils/page.js');

/**
 * 现场互动里的网页（web-view）。参数 id 是互动，地址每次按 id 从云端取，不从参数里拿，
 * 转发出去的卡片也不能被改成打开别的网页。互动关掉了、对这个人不开放时回到互动页。
 * web-view 会铺满整个页面、盖住别的组件，自定义导航对它无效，所以这一页用微信自带的导航栏（见 index.json）。
 * 网页的域名要先加进小程序后台的「业务域名」，个人主体的小程序不能用 web-view。
 */
Page({
  data: { url: '', failed: false, clientCopy: clientCopy },

  onLoad(query) {
    this.id = query.id || '';
    interact.fetch(this.id)
      .then((d) => {
        const item = d.interaction;
        if (item.kind !== 'web' || !item.open || d.blocked || !item.url) { this.back(); return; }
        if (item.title) wx.setNavigationBarTitle({ title: item.title });
        this.setData({ url: item.url });
      })
      .catch(() => this.setData({ failed: true }));
  },

  /** 不能在这里打开：换成互动页，由它说明原因 */
  back() {
    wx.redirectTo({ url: '/pages/interact/index?id=' + this.id });
  },

  onRetry() {
    this.setData({ failed: false });
    this.onLoad({ id: this.id });
  },

  onShareAppMessage() {
    return shareCard('/pages/interact/index?id=' + this.id);
  }
});
