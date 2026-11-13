const events = require('../../utils/events.js');
const store = require('../../utils/store.js');
const member = require('../../content/member.js');
const messages = require('../../content/messages.js');
const config = require('../../config.js');
const { baseData, go, navTone, headerTone, imgLoaded, shareCard } = require('../../utils/page.js');

// 「已设提醒」的说法：活动自己带 actionDone 就用它（目前只有赛事示例有），否则用会员文案里同一个状态名
const REMINDED_TEXT = member.me.events.states[1];
// 「已报名」同样用会员文案里的状态名
const SIGNED_TEXT = member.me.events.states[0];

// 报名结果的提示（content/messages）。没配云环境时没有地方登记报名，按网络异常提示
const SIGNUP_TOAST = Object.assign({ no_backend: messages.signup.network }, messages.signup);

/** 报名须知要显示的几行。活动不用积分、也没填联系方式时不显示（返回 null） */
function signupNote(event, detail) {
  if (!event || !(event.cost > 0 || event.contact)) return null;
  const copy = detail.signupNote;
  return {
    title: copy.title,
    lines: (event.cost > 0 ? [copy.cost.replace('[积分]', event.cost)] : []).concat([copy.noCancel]),
    contactLabel: copy.contact,
    contact: event.contact
  };
}

Page({
  data: Object.assign(baseData(), {
    event: null,
    note: null,
    detail: null,
    headFields: [],
    rowFields: [],
    reminded: false,
    remindedText: REMINDED_TEXT,
    signed: false,
    signedText: SIGNED_TEXT,
    groupReady: config.groupReady
  }),

  /** 图片加载完（或加载失败）：让它淡入 */
  onImgLoad(e) {
    imgLoaded(this, e);
  },

  onLoad(query) {
    this.eventId = query.id;
    this.setData(baseData());
    this.render();
    // 头部设计高 356px，状态栏滚出它之后文字换成黑色
    this.toneAt = headerTone(356);
    // 从消息卡片直接进来时本机可能还没有这场活动：取一次最新的活动列表；云端数据同步完成后也重画
    events.refresh().then((changed) => {
      if (changed) this.render();
      // 活动已下线或链接失效：页面是自定义导航，不能留一张空白页，回到活动列表
      if (!this.data.event) go('events');
    });
    this.offStore = store.onChange(() => this.render());
  },

  /** 转发出去的是这场活动的详情页，标题用活动名称 */
  onShareAppMessage() {
    const e = this.data.event;
    return shareCard('/pages/event-detail/index?id=' + this.eventId, e ? e.title : '');
  },

  onShow() {
    // 注册回来以后报名状态可能变了
    if (this.data.event) this.render();
  },

  onUnload() {
    if (this.offStore) this.offStore();
  },

  render() {
    const event = events.getEvent(this.eventId);
    if (!event) { this.setData({ event: null }); return; }
    if (event.title) wx.setNavigationBarTitle({ title: event.title });
    const detail = events.getDetail(event);
    this.setData({
      event: event,
      detail: detail,
      // 头图底部并排放的几项和正文里逐行列出的几项
      headFields: detail.fields.filter((f) => f.head),
      rowFields: detail.fields.filter((f) => !f.head),
      reminded: events.hasReminder(event.id),
      remindedText: event.actionDone || REMINDED_TEXT,
      signed: events.hasSignup(event.id),
      // 报名须知：这场要用积分、或者填了联系方式时显示
      note: signupNote(event, detail)
    });
  },

  onPageScroll(e) {
    navTone(this, e.scrollTop, this.toneAt);
  },

  onBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else go('events');
  },

  onRemind() {
    if (!this.data.event || this.data.reminded) return;
    events.remind(this.data.event.id).then((ok) => {
      if (ok) this.setData({ reminded: true });
    });
  },

  onSignup() {
    if (!this.data.event || this.data.signed || this.signing) return;
    // 报名要先是会员
    if (!store.isMember()) { go('join'); return; }
    const event = this.data.event;
    const cost = event.cost > 0 ? event.cost : 0;
    const short = () => { const p = (store.getMember() || {}).points; return cost > 0 && typeof p === 'number' && p < cost; };
    // 本机记着的积分不够：这个数可能是旧的（运营刚给加了积分），先和云端对一下再说够不够
    if (short()) {
      this.signing = true;
      wx.showLoading({ title: '', mask: true });
      store.sync().catch(() => false).then(() => {
        wx.hideLoading();
        if (short()) { this.signing = false; this.sayShort(cost); return; }
        // 对完发现够了：接着报。这时已经不是点击的那一下，订阅请求弹不出来，这一次就不问了
        this.finishSignup(event, cost, Promise.resolve(''));
      });
      return;
    }
    this.signing = true;
    // 先请用户订阅一次消息（必须由这次点击直接触发）：同意了的，报名被取消或活动取消时能收到微信通知；不同意也照样报
    this.finishSignup(event, cost, events.askSubscribe());
  },

  /** 报名的后半段：等订阅的结果（templateId，没同意是空的）→ 要用积分的确认一次 → 报名 */
  finishSignup(event, cost, asked) {
    asked
      .then((templateId) => this.confirmCost(cost).then((go_) => (go_ ? store.signup(event.id, templateId).then(() => true) : false)))
      .then((done) => {
        if (!done) return;
        this.setData({ signed: true });
        wx.showToast({ title: SIGNUP_TOAST.ok, icon: 'success' });
      })
      .catch((e) => {
        // 云端说还不是会员（比如换了设备、本机缓存是旧的）：去注册
        if (e.code === 'not_member') { go('join'); return; }
        if (e.code === 'insufficient_points') { this.sayShort(cost); return; }
        wx.showToast({ title: SIGNUP_TOAST[e.code] || SIGNUP_TOAST.network, icon: 'none' });
      })
      .then(() => { this.signing = false; });
  },

  /** 积分不够：说清楚这场要多少 */
  sayShort(cost) {
    wx.showToast({ title: SIGNUP_TOAST.insufficient_points.replace('[积分]', cost), icon: 'none' });
  },

  /** 要用积分的活动，报名前确认一次：用多少积分、报名后不能自行取消。不用积分的直接报。resolve 是否继续 */
  confirmCost(cost) {
    if (!cost) return Promise.resolve(true);
    const copy = this.data.detail.signupNote;
    return new Promise((resolve) => {
      wx.showModal({
        title: copy.confirmTitle,
        content: copy.confirm.replace('[积分]', cost),
        success: (res) => resolve(!!res.confirm),
        fail: () => resolve(false)
      });
    });
  },

onGroup() {
    // 群的形式（企业微信群、客服二维码）定了以后在这里接；现在这个入口不显示（config.groupReady）
  }
});
