const home = require('../../content/home.js');
const products = require('../../content/products.js');
const events = require('../../utils/events.js');
const { baseData, watchReveal, navTone, go, selectTab } = require('../../utils/page.js');
const { assetUrl, withAssets } = require('../../utils/assets.js');

/*
 * 六大核心价值的断行位置，取自 design/html/01-home.html 里的 <br>。
 * content 里是不带断行的整句，这里只记「第几个字后换行」，文字本身仍然来自 content；
 * 没列在这里的（一行放得下的，或带空格能自然断开的）和 content 改了字对不上的，都交给自然换行。
 */
const VALUE_BREAK = {
  '韩国本土原厂出品': 4,
  '科学配比碳水电解质': 4,
  '适配长距离运动补给': 5
};

function valueLines(text) {
  const at = VALUE_BREAK[text];
  return at ? [text.slice(0, at), text.slice(at)] : [text];
}

/** 首屏加三个数字这一段深色区域在 390px 设计稿下的高度：548 + 102 */
const DARK_TOP_PX = 650;

/** 首屏以下各分区进入视口时触发动效，对应 WXML 里的 id="rv-<key>" */
const REVEAL_KEYS = ['kw0', 'kw1', 'kw2', 'fuel', 'stage0', 'stage1', 'stage2', 'dualCarb', 'specs', 'cert', 'races', 'brand'];

const brand = withAssets(home.brand);
brand.values = brand.values.map((v) => ({ icon: v.icon, lines: valueLines(v.text) }));

Page({
  data: Object.assign(baseData(), {
    trackLines: assetUrl('assets/graphics/hero-track-lines.svg'),
    arc: assetUrl('assets/graphics/hero-arc.svg'),
    hero: withAssets(home.hero),
    stats: home.stats,
    keywords: withAssets(home.keywords),
    fuelEntry: withAssets(home.fuelEntry),
    lineup: home.lineup,
    stages: withAssets(products.lineup),
    specs: home.specs,
    cert: home.certification,
    races: home.races,
    raceCards: [],
    brand: brand,
    film: withAssets(home.film),
    seen: {}
  }),

  onLoad() {
    this.setData(baseData());
    this.setData({ raceCards: events.listPast() });

    // 状态栏文字在深色首屏上用白字，滚过首屏和三个数字之后换黑字
    let width = 390;
    try { width = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).windowWidth || 390; } catch (e) { /* 用设计宽度 */ }
    this.toneAt = DARK_TOP_PX * width / 390 + this.data.safeTop / 2;
  },

  onReady() {
    this.stopReveal = watchReveal(this, REVEAL_KEYS);
  },

  onShow() {
    selectTab(this, 0);
  },

  onHide() {
    // 切到别的页面时停掉品牌影片
    if (wx.createVideoContext) wx.createVideoContext('hm-film-video').pause();
  },

  onUnload() {
    if (this.stopReveal) this.stopReveal();
  },

  onPageScroll(e) {
    navTone(this, e.scrollTop, this.toneAt);
  },

  onFuel() {
    go(this.data.fuelEntry.to);
  },

  /** 产品线：只有 detail 为 true 的两款能量胶有详情页 */
  onProduct(e) {
    const { id, detail } = e.currentTarget.dataset;
    if (detail) go(id);
  }
});
