const { planFuel, SPORTS, SCENES, STARTS, LIMITS, DEFAULT_INPUT, formatTime } = require('../../utils/fuel-plan.js');
const store = require('../../utils/store.js');
const { baseData, selectTab, go, navTone } = require('../../utils/page.js');
const { assetUrl } = require('../../utils/assets.js');

/*
 * 分段补给计算：页面只收集输入、展示结果，公式全部在 utils/fuel-plan.js。
 * 八项输入就是 planFuel 的 input；任一项变化后立即重算。
 */

/** 各分段选择的选项：value 是写进 input 的值。两项选择的文字取自设计稿。 */
const byKey = (list) => list.map((o) => ({ value: o.key, label: o.label }));
const OPTIONS = {
  sport: byKey(SPORTS),
  scene: byKey(SCENES),
  start: byKey(STARTS),
  caffeineSensitive: [{ value: false, label: '正常' }, { value: true, label: '敏感' }],
  firstTime: [{ value: false, label: '用过' }, { value: true, label: '第一次' }],
  hot: [{ value: false, label: '常温' }, { value: true, label: '高温' }]
};

/** 步进输入的范围 */
const RANGE = {
  minutes: { min: LIMITS.minMinutes, max: LIMITS.maxMinutes },
  kg: { min: LIMITS.minKg, max: LIMITS.maxKg }
};
const clamp = (v, r) => Math.min(r.max, Math.max(r.min, v));

/** 把外来的输入（已保存的计划）整理成合法的 input：缺的补默认值，越界的夹住 */
function normalize(raw) {
  const input = {};
  Object.keys(DEFAULT_INPUT).forEach((k) => {
    input[k] = raw && raw[k] !== undefined && raw[k] !== null ? raw[k] : DEFAULT_INPUT[k];
  });
  ['sport', 'scene', 'start'].forEach((k) => {
    if (!OPTIONS[k].some((o) => o.value === input[k])) input[k] = DEFAULT_INPUT[k];
  });
  ['caffeineSensitive', 'hot', 'firstTime'].forEach((k) => { input[k] = !!input[k]; });
  ['minutes', 'kg'].forEach((k) => { input[k] = clamp(Number(input[k]) || DEFAULT_INPUT[k], RANGE[k]); });
  return input;
}

/**
 * 传给公式的输入。徒步不分场景，页面上「场景」一行是隐藏的，这时按长距离训练算
 * （fuel-plan.test.js 里徒步的用例也是 scene: 'long'），不让看不见的选项影响结果。
 */
function effective(input) {
  return input.sport === 'hike' ? Object.assign({}, input, { scene: 'long' }) : input;
}

/** 由 input 算出页面要显示的全部数据 */
function view(input) {
  const r = planFuel(effective(input));
  return {
    input: input,
    durationLabel: formatTime(input.minutes),
    // 徒步不分场景：隐藏这一行；input.scene 保持原值，切回其他项目时还是原来的选择
    showScene: input.sport !== 'hike',
    plan: {
      total: r.total,
      gelCount: r.gelCount,
      proCount: r.proCount,
      totalCarb: r.totalCarb,
      caffeineMg: r.caffeineMg,
      kcal: r.kcal,
      durationLabel: r.durationLabel,
      // id 带上位置和内容：某一格的时刻或款式变了，节点会重建，「弹出」动效重新播放；没变的格子不动
      items: r.items.map((it, i) => ({
        id: i + '|' + it.minute + '|' + it.product,
        label: it.label,
        gel: it.product === 'gel',
        productName: it.productName,
        position: it.position
      })),
      reasons: r.reasons
    }
  };
}

Page({
  data: Object.assign(baseData(), {
    photo: assetUrl('assets/photos/web/mountain-ridge.jpg'),
    sports: OPTIONS.sport,
    scenes: OPTIONS.scene,
    starts: OPTIONS.start,
    caffeines: OPTIONS.caffeineSensitive,
    experiences: OPTIONS.firstTime,
    weathers: OPTIONS.hot
  }, view(normalize(DEFAULT_INPUT))),

  onLoad() {
    this.setData(baseData());
    // 头图设计高 212px，滚过它之后状态栏文字换成黑色
    let width = 390;
    try { width = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).windowWidth || 390; } catch (e) { /* 用设计宽度 */ }
    this.headerPx = Math.round(212 * width / 390);
  },

  onShow() {
    selectTab(this, 1);
    // 从「我的」点补给计划、或注册完成后回来：按已保存的输入还原
    const app = getApp();
    if (app.globalData.fuelRestore) {
      app.globalData.fuelRestore = false;
      const saved = store.getPlan();
      if (saved && saved.input) this.setData(view(normalize(saved.input)));
    }
  },

  onPageScroll(e) {
    navTone(this, e.scrollTop, this.headerPx || 212);
  },

  /** 改一项或几项输入后重算 */
  update(patch) {
    this.setData(view(normalize(Object.assign({}, this.data.input, patch))));
  },

  /** 分段选择：data-field 是 input 的字段，data-index 是选项序号 */
  onPick(e) {
    const field = e.currentTarget.dataset.field;
    const option = OPTIONS[field] && OPTIONS[field][Number(e.currentTarget.dataset.index)];
    if (!option || this.data.input[field] === option.value) return;
    const patch = { [field]: option.value };
    // 切换项目时，预计时长重置为该项目的默认值
    if (field === 'sport') patch.minutes = SPORTS.find((s) => s.key === option.value).defaultMinutes;
    this.update(patch);
  },

  /** 步进按钮：data-field 是 minutes 或 kg，data-delta 是增减量；到边界时夹住 */
  onStep(e) {
    const field = e.currentTarget.dataset.field;
    const delta = Number(e.currentTarget.dataset.delta);
    if (!RANGE[field] || !delta) return;
    const next = clamp(this.data.input[field] + delta, RANGE[field]);
    if (next !== this.data.input[field]) this.update({ [field]: next });
  },

  onSave() {
    const input = effective(this.data.input);
    if (store.isMember()) {
      store.savePlan(input);
      // 设计稿和原型里没有保存成功的提示文案，先留占位
      wx.showToast({ title: '[已保存提示文案]', icon: 'none' });
    } else {
      // 未注册：先记下输入，注册完成后再保存
      store.setPendingPlan(input);
      go('join');
    }
  },

  onProducts() {
    go('energy-gel');
  }
});
