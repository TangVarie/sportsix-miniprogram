const copy = require('../../content/admin.js');
const store = require('../../utils/store.js');
const admin = require('../../utils/admin.js');
const events = require('../../utils/events.js');
const format = require('../../utils/format.js');
const { baseData, go, navTone, headerTone, shareCard, TABS } = require('../../utils/page.js');

const toast = (title) => wx.showToast({ title: title, icon: 'none' });
const c = copy.signups;

/** 一项回答 → 显示的字：多选用顿号连起来，没填是「—」 */
const answerText = (v) => (Array.isArray(v) ? v.join('、') : v) || c.formEmptyValue;

/**
 * 报名表的回答按现在的报名表排：现在有的项按顺序列，没填的写「—」；
 * 运营后来删掉的项，之前填的内容也还列出来（标题是当时的，后面注明已删掉）。
 */
function answerRows(form, answers) {
  const byId = {};
  (answers || []).forEach((a) => { byId[a.id] = a; });
  const rows = form.map((f) => ({ label: f.label, value: answerText(byId[f.id] && byId[f.id].value) }));
  (answers || []).filter((a) => !form.some((f) => f.id === a.id)).forEach((a) => rows.push({ label: a.label + c.formRemoved, value: answerText(a.value) }));
  return rows;
}

/** 名单里的一个人 → 一行的显示数据 */
function row(s, form) {
  return {
    memberNo: s.memberNo,
    name: s.nickname || c.noName,
    noText: c.memberNo.replace(/\[[^\]]+\]/, s.memberNo || '—'),
    phone: s.phone,
    costText: s.cost > 0 ? c.cost.replace('[积分]', s.cost) : '',
    at: format.moment(s.at),
    answers: answerRows(form, s.answers),
    // 报名表的必填项没填齐（旧版本报的名，或者运营后来加了必填项）
    missing: form.length > 0 && s.complete === false
  };
}

/**
 * 运营后台：一场活动的报名名单。能看到每个人的昵称、会员编号、手机号（点一下拨打），
 * 能取消某个人的报名，也能取消整场活动；取消后名额让出来、积分退回、对方收到通知。
 * 只有管理员能进，权限在云函数里检查。设计稿里没有后台。
 */
Page({
  data: Object.assign(baseData(), {
    copy: c,
    id: '',
    title: '',
    countText: '',
    // 一共多少人报名。名单太长时比 list 多
    total: 0,
    cancelled: false,
    loading: true,
    loaded: false,
    loadFailed: false,
    busy: false,
    progress: '',
    list: [],
    // 这场活动的报名表（现在的样子）和展开了报名表的人
    form: [],
    open: {}
  }),

  onLoad(query) {
    this.setData(Object.assign(baseData(), { id: query.id || '' }));
    // 头部设计高 132px
    this.toneAt = headerTone(132);
    try { wx.hideShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] }); } catch (e) { /* 旧基础库忽略 */ }
    const m = store.getMember();
    if (!m || !m.admin) { toast(copy.errors.forbidden); go('me'); return; }
    this.load();
  },

  load() {
    // 每次读取占一个号：取消报名之后重读时，先发出的旧读取晚回来也不会盖掉新的
    const mine = this.seq = (this.seq || 0) + 1;
    this.setData({ loading: true, loadFailed: false });
    return admin.signups(this.data.id)
      .then((d) => {
        if (mine !== this.seq) return;
        this.setData({
          title: d.event.title,
          cancelled: !!d.event.cancelled,
          form: d.form || [],
          list: d.signups.map((x) => row(x, d.form || [])),
          total: d.total > d.signups.length ? d.total : d.signups.length,
          countText: d.total > d.signups.length ? c.countPartial.replace('[人数]', d.total).replace('[显示]', d.signups.length) : c.count.replace('[人数]', d.signups.length),
          loading: false, loaded: true
        });
      })
      .catch((e) => { if (mine === this.seq) { this.setData({ loading: false, loadFailed: true }); toast(admin.errorText(e)); } });
  },

  onRetry() {
    if (!this.data.loading && !this.data.busy) return this.load();
  },

  onUnload() {
    this.seq = (this.seq || 0) + 1;
  },

  onPageScroll(e) {
    navTone(this, e.scrollTop, this.toneAt);
  },

  /** 后台不让转发；万一触发了，转出去的是首页 */
  onShareAppMessage() {
    return shareCard(TABS.home);
  },

  onBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else go('admin');
  },

  /** 点手机号：拨打 */
  onCall(e) {
    const phone = e.currentTarget.dataset.phone;
    if (phone) wx.makePhoneCall({ phoneNumber: phone, fail: () => {} });
  },

  /** 展开或收起某个人填的报名表 */
  onToggle(e) {
    const no = e.currentTarget.dataset.no;
    this.setData({ ['open.' + no]: !this.data.open[no] });
  },

  /**
   * 把名单复制出来，贴到表格或聊天里：第一行是表头，之后每人一行，昵称、会员编号、手机号，
   * 有报名表的再接上每一项的回答（按现在的报名表的顺序）。各项之间用制表符隔开，贴进表格正好一格一项。
   */
  onCopy() {
    if (!this.data.list.length) { toast(c.empty); return; }
    const clean = (v) => String(v == null ? '' : v).replace(/[\t\n\r]+/g, ' ');
    const head = c.copyHeader.concat(this.data.form.map((f) => f.label));
    const lines = this.data.list.map((s) => [s.name, s.memberNo, s.phone].concat(s.answers.slice(0, this.data.form.length).map((a) => a.value)).map(clean).join('\t'));
    wx.setClipboardData({ data: [head.map(clean).join('\t')].concat(lines).join('\n'), success: () => toast(c.copied) });
  },

  /** 取消某个人的报名：先确认，写清楚是谁、会发生什么 */
  onCancel(e) {
    if (this.data.busy) return;
    const s = this.data.list.find((x) => x.memberNo === e.currentTarget.dataset.no);
    if (!s) return;
    wx.showModal({
      title: c.cancelTitle,
      content: c.cancelConfirm.replace('[会员]', s.name + '（' + s.memberNo + '）'),
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ busy: true });
        admin.cancelSignup(this.data.id, s.memberNo)
          .then(() => toast(c.cancelled))
          .catch((err) => toast(admin.errorText(err)))
          .then(() => this.load())
          .then(() => this.setData({ busy: false }));
      }
    });
  },

  /** 取消整场活动：下架，所有人撤销、退积分、发通知。人多时分几批做，页面上显示还剩多少 */
  onCancelEvent() {
    if (this.data.busy || this.data.loading || !this.data.loaded || this.data.loadFailed) return;
    wx.showModal({
      title: c.cancelEventTitle,
      content: c.cancelEventConfirm.replace('[人数]', this.data.total || this.data.list.length),
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ busy: true });
        admin.cancelEvent(this.data.id, (left) => this.setData({ progress: left ? c.cancelling.replace('[人数]', left) : '' }))
          .then(() => { toast(c.cancelEventDone); events.refresh(true); })
          .catch((err) => toast(admin.errorText(err)))
          .then(() => this.load())
          .then(() => this.setData({ busy: false, progress: '' }));
      }
    });
  }
});
