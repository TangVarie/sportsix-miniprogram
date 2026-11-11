const { go } = require('../../utils/page.js');

/**
 * 场景推荐：三个使用场景，底部按钮跳分段补给计算。两款产品详情共用。
 * scenes  各款的 scenes：{ eyebrow, title, link: { label, to }, items: [{ title, body }] }
 * shown   进入视口后置为 true，触发卡片入场
 */
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    scenes: { type: Object, value: {} },
    shown: { type: Boolean, value: false }
  },
  methods: {
    onLink() {
      const link = this.data.scenes && this.data.scenes.link;
      if (link && link.to) go(link.to);
    }
  }
});
