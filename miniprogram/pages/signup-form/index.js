const events = require('../../utils/events.js');
const store = require('../../utils/store.js');
const form = require('../../utils/signup-form.js');
const copy = require('../../content/signup-form.js');
const messages = require('../../content/messages.js');
const clientCopy = require('../../content/client-state.js');
const pendingAction = require('../../utils/pending-action.js');
const { eventState } = require('../../utils/event-state.js');
const { baseData, go, navTone, headerTone, shareCard, tick } = require('../../utils/page.js');

const toast = (title) => wx.showToast({ title: title, icon: 'none' });
// 报名结果的提示和活动详情一致（content/messages），报名表自己的几种在 signup-form
const SIGNUP_TOAST = Object.assign({ no_backend: messages.signup.network }, messages.signup);
const errorText = (e) => copy.errors[e && e.code] || SIGNUP_TOAST[e && e.code] || copy.errors.network;

/**
 * 报名表（设计稿里没有，后加的）。参数 id 是活动。
 * - 还没报名：填好提交，和报名一起交给云端，提交成功才算报上名（mode: signup）。
 * - 已经报名：改填过的内容，或者补填运营后来加的必填项（mode: edit）。
 * - 活动开始以后、活动取消了：只能看（mode: view）。
 * 样式沿用活动详情的灰底卡片和底部操作条。
 */
Page({
  data: Object.assign(baseData(), {
    copy: copy,
    clientCopy: clientCopy,
    loading: true,
    loadFailed: false,
    title: '',
    mode: 'signup',
    fields: [],
    agree: false,
    busy: false
  }),

  onLoad(query) {
    this.eventId = query.id || '';
    this.values = {};
    this.errors = {};
    this.setData(baseData());
    // 头部设计高 132px
    this.toneAt = headerTone(132);
    // 页面上是个人信息，不让转发
    try { wx.hideShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] }); } catch (e) { /* 旧基础库忽略 */ }
    this.load();
  },

  onUnload() {
    this.disposed = true;
  },

  /** 万一触发了转发，转出去的是活动详情 */
  onShareAppMessage() {
    return shareCard('/pages/event-detail/index?id=' + this.eventId);
  },

  onPageScroll(e) {
    navTone(this, e.scrollTop, this.toneAt);
  },

  /** 取最新的活动（报名表可能刚改过）和本人填过的内容 */
  load() {
    // 每次读取占一个号：先发出的旧读取晚回来，不盖掉新的
    const seq = this.loadSeq = (this.loadSeq || 0) + 1;
    this.setData({ loading: true, loadFailed: false });
    return events.fetchEvent(this.eventId).catch(() => null).then(() => {
      if (this.disposed || seq !== this.loadSeq) return;
      const event = events.getEvent(this.eventId);
      if (!event) { this.setData({ loading: false, loadFailed: true }); return; }
      this.event = event;
      const mine = events.getSignupForm(this.eventId);
      const signed = events.hasSignup(this.eventId) || !!mine;
      const e = event.raw || event;
      const started = (e.date && Date.now() >= e.date) || e.cancelled;
      // 填过的内容：第一次打开时拿云端存的；重新读取（报名表刚改过）时保留已经填的
      if (!this.filled && mine && mine.answers) this.values = Object.assign({}, mine.answers);
      this.filled = true;
      this.fields = event.form || [];
      this.setData({
        loading: false,
        title: event.title,
        mode: started && signed ? 'view' : signed ? 'edit' : 'signup'
      });
      this.render();
    });
  },

  render() {
    this.setData({ fields: form.view(this.fields, this.values, this.errors) });
  },

  onRetry() {
    if (!this.data.loading) this.load();
  },

  onBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else go('event-detail', { id: this.eventId });
  },

  onInput(e) {
    if (this.data.mode === 'view') return;
    const id = e.currentTarget.dataset.id;
    this.values[id] = e.detail.value;
    // 改了的那一项不再标红
    if (this.errors[id]) { delete this.errors[id]; this.render(); }
  },

  onDate(e) {
    if (this.data.mode === 'view') return;
    this.values[e.currentTarget.dataset.id] = e.detail.value;
    delete this.errors[e.currentTarget.dataset.id];
    this.render();
  },

  /** 点选项：单选换成这一个（再点一次取消），多选加上或去掉 */
  onOption(e) {
    if (this.data.mode === 'view') return;
    const { id, option } = e.currentTarget.dataset;
    const field = this.fields.find((f) => f.id === id);
    if (!field) return;
    tick();
    if (field.kind === 'multi') {
      const list = Array.isArray(this.values[id]) ? this.values[id].slice() : [];
      const i = list.indexOf(option);
      if (i >= 0) list.splice(i, 1); else list.push(option);
      this.values[id] = list;
    } else {
      this.values[id] = this.values[id] === option ? '' : option;
    }
    delete this.errors[id];
    this.render();
  },

  onAgree() {
    tick();
    this.setData({ agree: !this.data.agree });
  },

  onPrivacy() {
    go('doc', { type: 'privacy' });
  },

  onSubmit() {
    if (this.data.loading || this.data.loadFailed) return;
    if (this.data.mode === 'view') { toast(copy.closed); return; }
    if (this.data.busy) return;
    const checked = form.check(this.fields, this.values);
    this.errors = checked.errors;
    this.render();
    if (checked.first) { toast(checked.first); return; }
    if (this.data.mode === 'edit') { this.save(checked.answers); return; }
    if (!this.data.agree) { toast(copy.needAgree); return; }
    const state = eventState(this.event, { signed: false });
    if (!state.canSignup) { toast(state.signupLabel); return; }
    if (!store.isMember()) { pendingAction.setSignup(this.eventId); go('join'); return; }
    const cost = this.event.cost > 0 ? this.event.cost : 0;
    this.setData({ busy: true });
    // 订阅消息要由这一次点击直接触发：同意了的，报名被取消或活动取消时能收到通知；不同意也照样报
    events.askSubscribe()
      .then((templateId) => this.confirmCost(cost).then((goOn) => (goOn ? store.signup(this.eventId, templateId, cost, checked.answers).then(() => true) : false)))
      .then((done) => {
        if (!done) return;
        events.setSignupForm(this.eventId, { answers: checked.answers, complete: true });
        wx.showToast({ title: SIGNUP_TOAST.ok, icon: 'success' });
        setTimeout(() => { if (!this.disposed) this.onBack(); }, 800);
      })
      .catch((e) => this.fail(e, cost))
      .then(() => { if (!this.disposed) this.setData({ busy: false }); });
  },

  /** 已经报名：只改报名表 */
  save(answers) {
    this.setData({ busy: true });
    return store.saveAnswers(this.eventId, answers)
      .then((d) => {
        events.setSignupForm(this.eventId, { answers: (d && d.answers) || answers, complete: true });
        toast(copy.saved);
        setTimeout(() => { if (!this.disposed) this.onBack(); }, 800);
      })
      .catch((e) => this.fail(e, 0))
      .then(() => { if (!this.disposed) this.setData({ busy: false }); });
  },

  fail(e, cost) {
    const code = e && e.code;
    if (code === 'not_member') { pendingAction.setSignup(this.eventId); go('join'); return; }
    if (code === 'insufficient_points') { toast(SIGNUP_TOAST.insufficient_points.replace('[积分]', cost)); return; }
    // 报名表或要用的积分刚改过：重新读取，已经填的保留，用户检查后再提交
    if (code === 'form_changed' || code === 'form_incomplete' || code === 'cost_changed') this.load();
    // 活动开始了：变成只能看
    if (code === 'form_closed') this.load();
    toast(errorText(e));
  },

  /** 要用积分的活动，提交前确认一次：用多少积分、报名后不能自行取消 */
  confirmCost(cost) {
    if (!cost) return Promise.resolve(true);
    const note = events.getDetail(this.event).signupNote;
    return new Promise((resolve) => {
      wx.showModal({
        title: note.confirmTitle,
        content: note.confirm.replace('[积分]', cost),
        success: (res) => resolve(!!res.confirm),
        fail: () => resolve(false)
      });
    });
  }
});
