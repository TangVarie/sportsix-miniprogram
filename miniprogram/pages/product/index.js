const products = require('../../content/products.js');
const { baseData, watchReveal, navTone, measureDarkZones, go, imgLoaded, shareCard } = require('../../utils/page.js');
const { assetUrl, withAssets } = require('../../utils/assets.js');

const PRODUCTS = { 'energy-gel': products.energyGel, 'energy-gel-pro': products.energyGelPro };

/** 首屏以下各分区的进场顺序，对应 WXML 里的 id="rv-<key>" */
const REVEAL = {
  'energy-gel': ['facts', 'keyPoints', 'sources', 'dualCarb', 'density', 'caffeine', 'electrolytes', 'clean', 'scenes', 'howTo', 'nutrition', 'compare'],
  'energy-gel-pro': ['facts', 'keyPoints', 'hbcd', 'release', 'taste', 'lean', 'ingredients', 'scenes', 'guide', 'qa', 'nutrition', 'compare']
};

/** 柱形图里最高一根柱子的高度：设计稿 144px */
const BAR_MAX_RPX = 277;
/** 首屏设计高度（px，390 宽） */
const HERO_H = 500;

const lines = (v) => (Array.isArray(v) ? v : [v]);
const pct = (value, max) => Math.round((value / max) * 1000) / 10;
const maxOf = (bars) => Math.max.apply(null, bars.map((b) => b.value));

/** 柱形图下方的名称按设计稿在「水胶」「能量胶」前换行，文字本身不变 */
function barLabel(label) {
  const m = /^(.*?)\s*((?:能量|水)胶)$/.exec(label);
  return m && m[1] ? [m[1], m[2]] : [label];
}

/** sections 数组 → 以 key 为名的对象，顺带算好图表要用的尺寸。文案不动。 */
function buildSections(list) {
  const s = {};
  list.forEach((sec) => {
    const out = Object.assign({}, sec, { titleLines: lines(sec.title) });
    if (sec.key === 'density') {
      const max = maxOf(sec.bars);
      out.bars = sec.bars.map((b) => Object.assign({}, b, { height: Math.round((b.value / max) * BAR_MAX_RPX), labelLines: barLabel(b.label) }));
    } else if (sec.bars) {
      const max = maxOf(sec.bars);
      out.bars = sec.bars.map((b) => Object.assign({}, b, { pct: pct(b.value, max) }));
    }
    s[sec.key] = out;
  });
  return s;
}

/** 首屏两支包装：选中的口味在前，另一支在后 */
function heroPacks(flavors, key) {
  const front = flavors.find((f) => f.key === key) || flavors[0];
  const back = flavors.find((f) => f.key !== front.key);
  return [{ key: front.key, front: front.image, back: back ? back.image : '' }];
}

function build(id) {
  const raw = PRODUCTS[id] || PRODUCTS['energy-gel'];
  const p = withAssets(raw);
  // 款名里的英文（PRO）单独套 Barlow
  const nameCn = p.name.replace(/[A-Za-z]+$/, '');
  const view = {
    id: p.id,
    isPro: p.id === 'energy-gel-pro',
    p: p,
    nameCn: nameCn,
    nameEn: p.name.slice(nameCn.length),
    s: buildSections(p.sections),
    // 雷达图中间的包装图
    packImage: p.image || p.flavors[0].image,
    nutritionRows: p.nutrition.rows.map((r) => ({ k: r[0], v: r[1] })),
    seen: {},
    qaOpen: 0
  };
  if (p.flavors) {
    view.flavor = p.flavors[0].key;
    view.packs = heroPacks(p.flavors, view.flavor);
  }
  return view;
}

Page({
  data: Object.assign(baseData(), {
    heroArc: assetUrl('assets/graphics/pro-hero-arc.svg'),
    id: '',
    isPro: false,
    p: null,
    s: {},
    seen: {},
    qaOpen: 0
  }),

  /** 图片加载完（或加载失败）：让它淡入 */
  onImgLoad(e) {
    imgLoaded(this, e);
  },

  onLoad(query) {
    this.setData(Object.assign(baseData(), build(query.id)));
    // 首屏高度换成屏幕 px：深色分区的位置还没量到时，先按「滚过首屏换成深色字」处理
    let width = 390;
    try { width = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).windowWidth || 390; } catch (e) { /* 取不到就按设计宽度 */ }
    this.heroHeight = Math.round((HERO_H * width) / 390);
  },

  /** 转发出去的是这一款的详情页，标题用款名 */
  onShareAppMessage() {
    return shareCard('/pages/product/index?id=' + this.data.id, this.data.p ? this.data.p.name : '');
  },

  onReady() {
    this.stopReveal = watchReveal(this, REVEAL[this.data.id] || []);
    // 深浅分区交替：量出各段深色区（class 带 js-dark）的位置，状态栏文字跟着换色
    this.stopMeasure = measureDarkZones(this);
  },

  onUnload() {
    if (this.stopReveal) this.stopReveal();
    if (this.stopMeasure) this.stopMeasure();
  },

  onPageScroll(e) {
    navTone(this, e.scrollTop, this.heroHeight);
  },

  onBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else go('home');
  },

  /** 切换口味：首屏两支包装前后互换 */
  onFlavor(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.flavor) return;
    this.setData({ flavor: key, packs: heroPacks(this.data.p.flavors, key) });
  },

  /** Q&A：同一时间只展开一条，再点一次收起 */
  onQa(e) {
    const index = e.currentTarget.dataset.index;
    this.setData({ qaOpen: this.data.qaOpen === index ? -1 : index });
  },

  /** 速选对比里点另一款。用 redirectTo 替换当前页，两款来回切换时页面栈不会变长。 */
  onOpenProduct(e) {
    const id = e.detail && e.detail.id;
    if (!PRODUCTS[id] || id === this.data.id) return;
    wx.redirectTo({ url: '/pages/product/index?id=' + id });
  },

  onJoin() {
    go('join');
  }
});
