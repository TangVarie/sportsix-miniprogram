const products = require('../../content/products.js');
const { withAssets } = require('../../utils/assets.js');

const section = withAssets(products.energyGel.sections.find((s) => s.key === 'dualCarb'));
// 首页版本的脚注不含「食用 2 袋」那一句（content/home 的 dualCarb.note）
const SHORT_FOOTNOTE = section.footnote.replace('食用 2 袋 SPORTSIX 能量胶（含咖啡因版）。', '');

/**
 * 快慢双碳：配速对比曲线。首页和能量胶详情共用，文案来自 products.json#energyGel.sections[dualCarb]。
 * short  首页用，脚注去掉「食用 2 袋」那一句
 * shown  进入视口后置为 true，触发曲线绘制
 */
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    short: { type: Boolean, value: false },
    shown: { type: Boolean, value: false }
  },
  data: { s: section, shortFootnote: SHORT_FOOTNOTE }
});
