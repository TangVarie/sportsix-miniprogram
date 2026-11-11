const products = require('../../content/products.js');
const { withAssets } = require('../../utils/assets.js');

const compare = withAssets(products.compare);
/** 产品 id → 对比行里的字段名：energy-gel → energyGel */
const fieldOf = (id) => id.replace(/-([a-z])/g, (m, c) => c.toUpperCase());

/** 按当前产品标出加粗的一列。两款详情里内容相同，只有 on 不同。 */
function build(current) {
  return {
    columns: compare.columns.map((c) => ({ id: c.id, name: c.name, image: c.image, on: c.id === current })),
    rows: compare.rows.map((r) => ({
      label: r.label,
      cells: compare.columns.map((c) => ({ id: c.id, text: r[fieldOf(c.id)], on: c.id === current }))
    }))
  };
}

/**
 * 产品速选对比：两款并排八行，文案来自 products.json#compare。两款产品详情共用。
 * current    当前产品的 id，这一列加粗；另一列的表头可点
 * crossLink  底部链接到另一款：{ to, title, sub }（各款的 crossLink）
 * shown      进入视口后置为 true
 * 事件 open  点了另一款，detail: { id }。怎么跳由页面决定。
 */
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    current: { type: String, value: '' },
    crossLink: { type: Object, value: {} },
    shown: { type: Boolean, value: false }
  },
  data: Object.assign({ eyebrow: compare.eyebrow, title: compare.title }, build('')),
  observers: {
    current(id) {
      this.setData(build(id));
    }
  },
  methods: {
    onOpen(e) {
      const id = e.currentTarget.dataset.id;
      if (id && id !== this.data.current) this.triggerEvent('open', { id: id });
    }
  }
});
