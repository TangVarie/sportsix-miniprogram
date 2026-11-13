const { snapshot, VERSION, isSteady, SPORTS, SCENES, STARTS, WEATHERS, LIMITS, DEFAULT_INPUT, formatTime } = require('../../utils/fuel-plan.js');
const store = require('../../utils/store.js');
const messages = require('../../content/messages.js');
const ui = require('../../content/fuel-ui.js');
const { baseData, selectTab, go, navTone, headerTone, imgLoaded, tick, shareCard, TABS } = require('../../utils/page.js');
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
  weather: byKey(WEATHERS)
};

/** 步进输入的范围 */
const RANGE = {
  minutes: { min: LIMITS.minMinutes, max: LIMITS.maxMinutes },
  kg: { min: LIMITS.minKg, max: LIMITS.maxKg }
};
const clamp = (v, r) => Math.min(r.max, Math.max(r.min, v));
/** 加减到头时提示的话（content/messages 的 fuel） */
const LIMIT_TEXT = {
  minutes: { min: messages.fuel.minMinutes, max: messages.fuel.maxMinutes },
  kg: { min: messages.fuel.minKg, max: messages.fuel.maxKg }
};
/** 到了哪一头就提示哪一句：不能点了没反应 */
function sayLimit(field, value) {
  const r = RANGE[field];
  wx.showToast({ title: value >= r.max ? LIMIT_TEXT[field].max : LIMIT_TEXT[field].min, icon: 'none' });
}
/** 点时长弹出的选择器：小时一列（0 到上限），分钟一列（每 15 分钟一档）。长时间的不用一下一下点加号 */
const two = (n) => (n < 10 ? '0' + n : '' + n);
const TIME_RANGE = [
  Array.from({ length: LIMITS.maxMinutes / 60 + 1 }, (x, i) => i + ' 小时'),
  Array.from({ length: 60 / LIMITS.minutesStep }, (x, i) => two(i * LIMITS.minutesStep) + ' 分')
];

/** 把外来的输入（已保存的计划）整理成合法的 input：缺的补默认值，越界的夹住 */
function normalize(raw) {
  const input = {};
  Object.keys(DEFAULT_INPUT).forEach((k) => {
    input[k] = raw && raw[k] !== undefined && raw[k] !== null ? raw[k] : DEFAULT_INPUT[k];
  });
  // 以前保存的计划只有 hot（高温与否），没有 weather：hot 为真的按高温处理
  if ((!raw || raw.weather == null) && raw && raw.hot) input.weather = 'hot';
  ['sport', 'scene', 'start', 'weather'].forEach((k) => {
    if (!OPTIONS[k].some((o) => o.value === input[k])) input[k] = DEFAULT_INPUT[k];
  });
  ['caffeineSensitive', 'firstTime'].forEach((k) => { input[k] = !!input[k]; });
  // hot 是旧字段，跟着 weather 走，保持两者一致
  input.hot = input.weather === 'hot';
  ['minutes', 'kg'].forEach((k) => { input[k] = clamp(Number(input[k]) || DEFAULT_INPUT[k], RANGE[k]); });
  return input;
}

/**
 * 传给公式、存进计划的输入。徒步、登山、滑雪不分强度，页面上「强度」一行是隐藏的，这时按轻松训练算
 * （公式里也是这么处理的），不让看不见的选项影响结果。
 */
function effective(input) {
  return isSteady(input.sport) ? Object.assign({}, input, { scene: 'long' }) : input;
}

/** 每个分段选择里，当前值是第几项 */
function selectedIndexes(input) {
  const on = {};
  Object.keys(OPTIONS).forEach((field) => {
    on[field] = Math.max(0, OPTIONS[field].findIndex((o) => o.value === input[field]));
  });
  return on;
}

/** 长计划分成最多六小时一段，点和格子始终对应同一段，时刻仍以出发为零点。 */
function stageView(result, minutes, index) {
  const count = Math.ceil(minutes / 360);
  const selected = Math.max(0, Math.min(count - 1, Number(index) || 0));
  const stages = Array.from({ length: count }, (unused, i) => ({
    index: i,
    label: ui.range.replace('[开始]', formatTime(i * 360)).replace('[结束]', formatTime(Math.min(minutes, (i + 1) * 360)))
  }));
  const from = selected * 360;
  const until = Math.min(minutes, from + 360);
  const selectedItems = count > 1 ? result.items.filter((it) => (selected === 0 ? it.minute < until : it.minute >= from && it.minute < until)) : result.items;
  const items = selectedItems.map((it) => ({
    id: it.minute + '|' + it.product,
    label: it.label,
    gel: it.product === 'gel',
    productName: it.productName,
    position: count === 1 ? it.position : (it.minute < 0 ? 0 : Math.round(((selected === 0 ? 8 : 0) + (it.minute - from) / (until - from) * (selected === 0 ? 92 : 100)) * 10) / 10)
  }));
  return {
    segmented: count > 1,
    stages: stages,
    stageIndex: selected,
    stageCount: ui.stageCount.replace('[支数]', items.length),
    stageItems: items,
    stageStart: selected === 0 ? ui.start : formatTime(from),
    stageEnd: formatTime(count > 1 ? until : minutes),
    active: -1
  };
}

/** 由输入生成展示数据；完整历史快照按保存时的结果展示，不随公式版本静默改变。 */
function view(input, saved) {
  const hasSnapshot = saved && saved.formulaVersion && saved.result && Array.isArray(saved.result.items) && Array.isArray(saved.result.reasons);
  const pack = hasSnapshot ? saved : snapshot(effective(input));
  const r = pack.result;
  return {
    input: input,
    durationLabel: formatTime(input.minutes),
    // 时长选择器当前停在哪一格：[小时, 第几个 15 分钟]
    timeValue: [Math.floor(input.minutes / 60), Math.floor(input.minutes % 60 / LIMITS.minutesStep)],
    // 各个分段选择当前选中的是第几项，深蓝底按它滑到位
    on: selectedIndexes(input),
    // 原始结果快照与展示用格子分开，保存和切换分段都不会遗漏其他时段。
    resultSnapshot: r,
    formulaVersion: pack.formulaVersion,
    restoredSnapshot: !!hasSnapshot,
    // 徒步、登山、滑雪不分强度：隐藏这一行；input.scene 保持原值，切回其他项目时还是原来的选择
    showScene: !isSteady(input.sport),
    // 选中的强度下面的一句说明
    sceneHint: (SCENES.find((s) => s.key === input.scene) || {}).hint || '',
    plan: {
      total: r.total,
      gelCount: r.gelCount,
      proCount: r.proCount,
      totalCarb: r.totalCarb,
      caffeineMg: r.caffeineMg,
      kcal: r.kcal,
      durationLabel: r.durationLabel,
      days: r.days,
      reasons: r.reasons
    },
    ...stageView(r, input.minutes, 0)
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
    weathers: OPTIONS.weather,
    ui: ui,
    saving: false,
    timeRange: TIME_RANGE,
    // 是不是会员：不是的只显示带几支，时间表和排法说明加入后才有
    member: store.isMember(),
    lock: messages.fuel.lock
  }, view(normalize(DEFAULT_INPUT))),

  /** 图片加载完（或加载失败）：让它淡入 */
  onImgLoad(e) {
    imgLoaded(this, e);
  },

  onShareAppMessage() {
    return shareCard(TABS.fuel);
  },

  onLoad() {
    this.setData(baseData());
    // 头图设计高 212px，滚过它之后状态栏文字换成黑色
    this.toneAt = headerTone(212);
    // 上次点了「保存到我的」但还没存上（没注册完，或注册后保存失败）就关掉了小程序：把那份输入摆回来
    const pending = store.getPendingPlan();
    if (pending) this.setData(view(normalize(pending)));
    this.offStore = store.onChange(() => { if (this.data.member !== store.isMember()) this.setData({ member: store.isMember() }); });
  },

  onUnload() {
    if (this.offStore) this.offStore();
  },

  /** 时间表上的「手机号快捷登录」：去加入页。这一页留在原地，加入完回来输入都还在 */
  onJoin() {
    go('join');
  },

  onShow() {
    selectTab(this, 1);
    // 刚加入完回来，或者进入小程序时的同步刚做完：会员状态可能变了
    if (this.data.member !== store.isMember()) this.setData({ member: store.isMember() });
    // 从「我的」点补给计划、或注册完成后回来：按已保存的输入还原
    const app = getApp();
    if (app.globalData.fuelRestore) {
      app.globalData.fuelRestore = false;
      const saved = store.getPlan();
      if (saved && saved.input) this.setData(view(normalize(saved.input), saved));
    }
  },

  onPageScroll(e) {
    navTone(this, e.scrollTop, this.toneAt);
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
    tick();
    this.update(patch);
  },

  /** 步进按钮：data-field 是 minutes 或 kg，data-delta 是增减量；到边界时夹住 */
  onStep(e) {
    const field = e.currentTarget.dataset.field;
    const delta = Number(e.currentTarget.dataset.delta);
    if (!RANGE[field] || !delta) return;
    const want = this.data.input[field] + delta;
    const next = clamp(want, RANGE[field]);
    // 到头了，或者这一步跨过了头（比如 47:30 再加 1 小时）：停在头上，并说一句为什么
    if (next !== want) sayLimit(field, next);
    if (next === this.data.input[field]) return;
    tick();
    this.update({ [field]: next });
  },

  /** 在时长选择器里选了一个时间。选到范围外的（比如 0 小时 15 分、48 小时 30 分）夹回来并提示 */
  onTimePick(e) {
    const v = e.detail.value || [];
    const want = Number(v[0]) * 60 + Number(v[1]) * LIMITS.minutesStep;
    const next = clamp(want, RANGE.minutes);
    if (next !== want) sayLimit('minutes', next);
    // 夹回来以后和现在一样：选择器已经停在选的那一格了，重设一遍让它回到实际的时长
    if (next === this.data.input.minutes) { this.setData({ timeValue: view(this.data.input).timeValue }); return; }
    tick();
    this.update({ minutes: next });
  },

  /** 点某一格：高亮它和时间轴上对应的点，再点一次取消 */
  onFocus(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.setData({ active: this.data.active === index ? -1 : index });
  },

  onStage(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (!Number.isInteger(index) || index < 0 || index >= this.data.stages.length || index === this.data.stageIndex) return;
    tick();
    this.setData(stageView(this.data.resultSnapshot, this.data.input.minutes, index));
  },

  onSave() {
    if (this.savingPlan) return this.savingPlan;
    const input = effective(this.data.input);
    if (store.isMember()) {
      this.setData({ saving: true });
      this.savingPlan = store.savePlan(input, this.data.resultSnapshot, this.data.formulaVersion || VERSION)
        .then(() => {
          store.clearPendingPlan(); // 之前没存上的那份不再需要
          wx.showToast({ title: messages.plan.saved, icon: 'success' });
        })
        .catch((e) => {
          // 云端说还不是会员（本机缓存是旧的）：按未注册处理
          if (e.code === 'not_member') { store.setPendingPlan(input); go('join'); return; }
          wx.showToast({ title: messages.plan.saveFailed, icon: 'none' });
        })
        .then(() => {
          this.savingPlan = null;
          this.setData({ saving: false });
        });
      return this.savingPlan;
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
