const shop = require('../../content/shop.js');
const products = require('../../content/products.js');
const { tick } = require('../../utils/page.js');

// 有店铺链接的产品：{ id, name, link }。链接在 shop.json 的 links 里，没填的那款不出现
const OPTIONS = [products.energyGel, products.energyGelPro]
  .map((p) => ({ id: p.id, name: p.name, link: shop.links[p.id] || '' }))
  .filter((o) => o.link);

/**
 * 购买渠道的入口：一行卡片，点了跳到店铺小程序里对应的商品（设计稿里没有，后加的）。
 * 小程序自己不卖东西，这里只是把人带到店铺。文案和链接来自 shop.json。
 * - product：产品 id。给了就直接跳这款的商品页；这款没有链接时整个入口不显示。
 *   不给（首页、「我的」）时：两款的链接不一样就从底部弹出来让用户选一款，否则直接跳。
 * - dark：放在深色背景上（首页首屏下面）时用浅色描边和白字。
 * - bare：不显示卡片，由页面调 open() 触发（「我的」菜单里的那一项用）。
 * 跳转用 wx.navigateToMiniProgram 的 shortLink，必须由点击直接触发，微信会先弹一次确认。
 */
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    product: { type: String, value: '' },
    dark: { type: Boolean, value: false },
    bare: { type: Boolean, value: false }
  },
  data: { shop: shop, options: OPTIONS, available: OPTIONS.length > 0, choosing: false },
  observers: {
    product(id) {
      this.setData({ available: id ? OPTIONS.some((o) => o.id === id) : OPTIONS.length > 0 });
    }
  },
  methods: {
    /** 点入口：能确定是哪一款就直接跳，否则弹出来选 */
    open() {
      const list = this.data.product ? OPTIONS.filter((o) => o.id === this.data.product) : OPTIONS;
      if (!list.length) return;
      tick();
      // 只有一款，或者几款用的是同一条链接（店铺里一个商品页能选两款）：不用选，直接跳
      if (list.every((o) => o.link === list[0].link)) { this.jump(list[0].link); return; }
      this.setData({ choosing: true });
    },
    onChoose(e) {
      const o = OPTIONS.find((x) => x.id === e.currentTarget.dataset.id);
      this.setData({ choosing: false });
      if (o) this.jump(o.link);
    },
    close() { this.setData({ choosing: false }); },
    /** 点在面板上不关闭 */
    noop() {},
    jump(link) {
      wx.navigateToMiniProgram({
        shortLink: link,
        fail: (err) => {
          // 用户在微信的确认框里点了取消：不用提示
          if (err && /cancel/.test(String(err.errMsg || ''))) return;
          wx.showToast({ title: shop.failed, icon: 'none' });
        }
      });
    }
  }
});
