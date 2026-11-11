const member = require('../../content/member.js');
const home = require('../../content/home.js');
const store = require('../../utils/store.js');
const cloud = require('../../utils/cloud.js');
const events = require('../../utils/events.js');
const fuel = require('../../utils/fuel-plan.js');
const { baseData, selectTab, go, navTone } = require('../../utils/page.js');
const { assetUrl } = require('../../utils/assets.js');

/**
 * 「我的」：同一个页面两种状态。
 * - 未注册（registered 为 false）：注册页，design/html/07-me-not-registered.html
 * - 已注册：会员页，design/html/08-me-member.html
 *
 * 会员状态、补给计划、提醒、报名都只经过 utils/store.js 读写：配了云环境时走云开发，没配时只存本机。
 */

/** 去向还没定的入口：点击只给方括号占位提示 */
const PENDING = {
  group: '[加群方式待定]',
  doc: '[隐私政策文本待提供]',
  chat: '[联系方式待定]',
  用户协议: '[用户协议文本待提供]',
  隐私政策: '[隐私政策文本待提供]',
  registerFailed: '[注册失败提示文案]'
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
 * 我的活动：已报名的和已设提醒的，同一场活动两样都有时只显示「已报名」。
 * 活动已不在「即将开始」里的不显示。
 */
function myEvents() {
  const signed = store.getSignups();
  const reminded = store.getReminders().filter((id) => signed.indexOf(id) < 0);
  if (!signed.length && !reminded.length) return [];
  const states = member.me.events.states;
  const upcoming = events.listUpcoming();
  const rows = (ids, state, stateText) => ids
    .map((id) => upcoming.find((e) => e.id === id))
    .filter(Boolean)
    .map((e) => ({
      id: e.id,
      title: e.title,
      meta: [e.date, e.city].filter(Boolean).join(' · '),
      state: state,
      stateText: stateText
    }));
  return rows(signed, 'signed', states[0]).concat(rows(reminded, 'reminded', states[1]));
}

/**
 * 头部和会员卡上的个人信息。云开发下手机号是打码后的；
 * 昵称不收集（注册只取微信身份和手机号），会员编号和积分的规则没定，没有数据的项保持 content 里的占位。
 */
function profile() {
  const m = store.getMember() || {};
  return {
    nickname: member.me.profile.nickname,
    phone: m.phoneMasked || member.me.profile.phone,
    memberNo: m.memberNo ? member.me.card.memberNo.replace(/\[[^\]]+\]/, m.memberNo) : member.me.card.memberNo,
    points: typeof m.points === 'number' ? String(m.points) : member.me.card.points
  };
}

/** 会随别的页面变化的部分：注册状态、补给计划、我的活动 */
function readState() {
  const registered = store.isMember();
  return {
    registered: registered,
    profile: profile(),
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
    agreed: false,
    // 云开发下注册按钮是手机号快速验证组件；没配云环境时是普通按钮，只在本机记录
    cloudMode: cloud.enabled()
  }, readState()),

  onLoad() {
    this.setData(baseData());
    this.toneAt = toneThreshold();
    // 云端数据同步完成后重读（会员状态以云端为准）
    this.offStore = store.onChange(() => this.setData(readState()));
  },

  onUnload() {
    if (this.offStore) this.offStore();
  },

  onShow() {
    selectTab(this, 3);
    // 注册状态、补给计划、提醒、报名都可能在别的页面变了，每次显示都重读；活动列表再从云端取一次
    this.setData(readState());
    events.refresh().then((changed) => { if (changed) this.setData(readState()); });
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
   * 注册（没配云环境时）。必须先勾选协议。不取手机号，只在本机记「已注册」，用来看页面状态。
   */
  onRegister() {
    if (!this.data.agreed || this.data.cloudMode) return;
    store.register().then(() => this.afterRegister());
  },

  /**
   * 注册（云开发）：手机号快速验证组件的回调。用户同意后拿到 e.detail.code，交给云函数换手机号并建会员；
   * 用户拒绝时没有 code，停在本页。这个组件只对已认证的非个人主体开放，并且按次收费（见微信官方文档）。
   */
  onPhone(e) {
    const code = e.detail && e.detail.code;
    if (!code || this.registering) return;
    this.registering = true;
    store.register(code)
      .then(() => this.afterRegister())
      .catch(() => wx.showToast({ title: PENDING.registerFailed, icon: 'none' }))
      .then(() => { this.registering = false; });
  },

  /** 注册完成 */
  afterRegister() {
    // 从计算页点「保存到我的」过来的，先把那份输入存下
    const pending = store.takePendingPlan();
    let saving = Promise.resolve();
    if (pending) {
      const r = fuel.planFuel(pending);
      saving = store.savePlan(pending, { total: r.total, gelCount: r.gelCount, proCount: r.proCount }).catch(() => {});
    }

    // 本页切到会员状态
    this.setData(readState());
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    navTone(this, 0, this.toneAt);

    // 有待保存的计划时回到计算页，由它按刚存下的输入还原
    if (pending) {
      saving.then(() => {
        getApp().globalData.fuelRestore = true;
        go('fuel');
      });
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
