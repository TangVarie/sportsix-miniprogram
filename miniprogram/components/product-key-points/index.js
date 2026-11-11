/**
 * 直白卖点：一句话定位加三条卖点。两款产品详情共用。
 * title   一句话定位（products.json 里各款的 positioning）
 * points  各款的 keyPoints：{ eyebrow, items: [{ n, title, body }] }
 * shown   进入视口后置为 true，触发卡片入场
 */
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    title: { type: String, value: '' },
    points: { type: Object, value: {} },
    shown: { type: Boolean, value: false }
  }
});
