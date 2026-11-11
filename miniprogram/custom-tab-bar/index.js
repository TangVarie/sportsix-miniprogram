const member = require('../content/member.js');
const { TABS } = require('../utils/page.js');

// 「补给」是凸起的黄绿圆形按钮，始终高亮；其余三项选中用标题蓝，未选用次要文字色。
const items = member.tabBar.map((t) => ({
  key: t.key,
  text: t.text,
  raised: !!t.raised,
  url: TABS[t.key],
  icon: '/assets/icons/' + t.icon + (t.raised ? '-navy' : '-grey') + '.svg',
  iconOn: '/assets/icons/' + t.icon + (t.raised ? '-navy' : '-blue') + '.svg'
}));

Component({
  options: { styleIsolation: 'apply-shared' },
  data: { selected: 0, items: items },
  methods: {
    onTap(e) {
      const index = e.currentTarget.dataset.index;
      if (index === this.data.selected) return;
      wx.switchTab({ url: this.data.items[index].url });
    }
  }
});
