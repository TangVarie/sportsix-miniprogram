const member = require('../../content/member.js');
const home = require('../../content/home.js');
const store = require('../../utils/store.js');
const events = require('../../utils/events.js');
const fuel = require('../../utils/fuel-plan.js');
const { baseData, selectTab, go, navTone } = require('../../utils/page.js');
const { assetUrl } = require('../../utils/assets.js');

/**
 * 「我的」：同一个页面两种状态。
 * - 未注册（registered 为 false）：注册页，design/html/07-me-not-registered.html
 * - 已注册：会员页，design/html/08-me-member.html
 *
 * 后台没定（docs/04-open-items.md），会员状态、补给计划、提醒都只经过 utils/store.js 读写本机存储。
 */

/** 去向还没定的入口：点击只给方括号占位提示 */
const PENDING = {
  group: '[加群方式待定]',
  doc: '[隐私政策文本待提供]',
  chat: '[联系方式待定]',
  用户协议: '[用户协议文本待提供]',
  隐私政策: '[隐私政策文本待提供]'
};

/** 把协议那句话按书名号拆开，《…》部分单独可点。文字本身不改。 */
function splitAgreement(text) {
  const parts = [];
  const re = /《([^》]+)》/g;
  let last = 0;
  let m = re.exec(text);
  while (m) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), doc: '' });
    parts.push({ text: m[0], doc: m[1] });
    last = re.lastIndex;
    m = re.exec(text);
  }
  if (last < text.length) parts.push({ text: text.slice(last), doc: '' });
  return parts;
}

/** 会员页的四项权益只有名称，图标取注册页同名权益的图标 */
function memberPerks() {
  return member.me.perks.map((title) => {
    const same = member.join.perks.find((p) => p.title === title);
    return { title: title, icon: same ? same.icon : '' };
  });
}

/**
 * 我的补给计划。只存了输入，展示时用 planFuel 重算。
 * 没有保存的计划（或存的输入已经算不出来）时返回 saved: false，卡片只留去计算页的入口，
 * 文字用首页「分段补给计算」入口的原文（content/home.js#fuelEntry）。
 */
function planCard() {
  const saved = store.getPlan();
  const tpl = member.me.plan;
  if (saved && saved.input) {
    try {
      const r = fuel.planFuel(saved.input);
      const sport = fuel.SPORTS.find((s) => s.key === r.input.sport);
      if (sport) {
        const counts = [r.gelCount, r.proCount];
        let n = 0;
        return {
          saved: true,
          line1: tpl.line1.replace('[项目]', sport.label).replace('[预计时长]', r.durationLabel),
          line2: tpl.line2.replace(/\[支数\]/g, () => counts[n++]),
          // 一支一个圆点，顺序同时间表：能量胶实心黄绿，能量胶PRO 空心
          dots: r.items.map((it, i) => ({ key: i, product: it.product }))
        };
      }
    } catch (e) { /* 存的输入不合法时按没有计划处理 */ }
  }
  return { saved: false, line1: home.fuelEntry.title, line2: home.fuelEntry.body, dots: [] };
}

/**
 * 我的活动。目前只有「已设提醒」有数据来源；活动已不在「即将开始」里的提醒不显示。
 * 待接后台：「已报名」的记录接进来后在这里合并，state 用 'signed'、stateText 用 states[0]，样式已经写好。
 */
function myEvents() {
  const ids = store.getReminders();
  if (!ids.length) return [];
  const states = member.me.events.states;
  const upcoming = events.listUpcoming();
  return ids
    .map((id) => upcoming.find((e) => e.id === id))
    .filter(Boolean)
    .map((e) => ({
      id: e.id,
      title: e.title,
      meta: [e.date, e.city].filter(Boolean).join(' · '),
      state: 'reminded',
      stateText: states[1]
    }));
}

/** 会随别的页面变化的部分：注册状态、补给计划、我的活动 */
function readState() {
  const registered = store.isMember();
  return {
    registered: registered,
    plan: registered ? planCard() : null,
    myEvents: registered ? myEvents() : []
  };
}

/** 会员页白底从会员卡下沿开始：头部上沿到卡片下沿是设计稿的 302px */
function toneThreshold() {
  try {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    return Math.round(302 * info.windowWidth / 390);
  } catch (e) {
    return 302;
  }
}

Page({
  data: Object.assign(baseData(), {
    join: member.join,
    me: member.me,
    agreement: splitAgreement(member.join.agreement),
    perks: memberPerks(),
    wordmark: assetUrl('assets/logo/sportsix-wordmark-white.svg'),
    slogan: assetUrl('assets/logo/win-your-day-white.svg'),
    joinArc: assetUrl('assets/graphics/join-arc.svg'),
    cardArc: assetUrl('assets/graphics/member-card-arc.svg'),
    packGel: assetUrl('assets/product/energy-gel-grape.png'),
    packPro: assetUrl('assets/product/energy-gel-pro-pineapple.png'),
    agreed: false
  }, readState()),

  onLoad() {
    this.setData(baseData());
    this.toneAt = toneThreshold();
  },

  onShow() {
    selectTab(this, 3);
    // 注册状态、补给计划、提醒都可能在别的页面变了，每次显示都重读
    this.setData(readState());
  },

  onPageScroll(e) {
    // 注册页整页深色底；会员页滚过会员卡以后是白底
    navTone(this, e.scrollTop, this.data.registered ? this.toneAt : Infinity);
  },

  onAgree() {
    this.setData({ agreed: !this.data.agreed });
  },

  /** 《用户协议》《隐私政策》两份文本还没有（docs/04-open-items.md），先给占位提示 */
  onDoc(e) {
    wx.showToast({ title: PENDING[e.currentTarget.dataset.doc] || '[待定]', icon: 'none' });
  },

  /**
   * 注册。必须先勾选协议。
   *
   * 现在是本机走通状态用的临时实现：不取手机号，只在本机记「已注册」。
   * 待接后台（主体、AppID、后台方案确定后，按微信官方文档现行的「手机号快速验证组件」说明来做）：
   * 把 WXML 里的注册按钮换成 <button class="sx-btn-reset" open-type="getPhoneNumber" bindgetphonenumber="...">，
   * 在回调里拿 e.detail.code 交给后台换取手机号并建会员（放进 utils/store.js 的 register 里），
   * 成功后再走下面「注册完成」的部分。用户拒绝授权或后台失败时停在本页。
   */
  onRegister() {
    if (!this.data.agreed) return;
    store.register();

    // 注册完成。从计算页点「保存到我的」过来的，先把那份输入存下
    const pending = store.takePendingPlan();
    if (pending) store.savePlan(pending);

    // 本页切到会员状态
    this.setData(readState());
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    navTone(this, 0, this.toneAt);

    // 有待保存的计划时回到计算页，由它按刚存下的输入还原
    if (pending) {
      getApp().globalData.fuelRestore = true;
      go('fuel');
    }
  },

  /** 我的补给计划：有保存的计划时让计算页按它还原输入，没有时只是进入计算页 */
  onPlan() {
    if (this.data.plan && this.data.plan.saved) getApp().globalData.fuelRestore = true;
    go('fuel');
  },

  onEvent(e) {
    go('event-detail', { id: e.currentTarget.dataset.id });
  },

  /** 加入社群 / 隐私政策 / 联系我们：去向都没定（docs/04-open-items.md） */
  onMenu(e) {
    wx.showToast({ title: PENDING[e.currentTarget.dataset.key] || '[待定]', icon: 'none' });
  }
});
