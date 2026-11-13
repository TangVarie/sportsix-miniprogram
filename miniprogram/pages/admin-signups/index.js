const copy = require('../../content/admin.js');
const store = require('../../utils/store.js');
const admin = require('../../utils/admin.js');
const events = require('../../utils/events.js');
const format = require('../../utils/format.js');
const { baseData, go, navTone, headerTone, shareCard, TABS } = require('../../utils/page.js');

const toast = (title) => wx.showToast({ title: title, icon: 'none' });
const c = copy.signups;

/** 名单里的一个人 → 一行的显示数据 */
function row(s) {
  return {
    memberNo: s.memberNo,
    name: s.nickname || c.noName,
    noText: c.memberNo.replace(/\[[^\]]+\]/, s.memberNo || '—'),
    phone: s.phone,
    costText: s.cost > 0 ? c.cost.replace('[积分]', s.cost) : '',
    at: format.moment(s.at)
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
    busy: false,
    progress: '',
    list: []
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
    return admin.signups(this.data.id)
      .then((d) => {
        if (mine !== this.seq) return;
        this.setData({
          title: d.event.title,
          cancelled: !!d.event.cancelled,
          list: d.signups.map(row),
          total: d.total > d.signups.length ? d.total : d.signups.length,
          countText: d.total > d.signups.length ? c.countPartial.replace('[人数]', d.total).replace('[显示]', d.signups.length) : c.count.replace('[人数]', d.signups.length),
          loading: false
        });
      })
      .catch((e) => { if (mine === this.seq) this.setData({ loading: false }); toast(admin.errorText(e)); });
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

  /** 把名单复制出来，贴到表格或聊天里：每人一行，昵称、会员编号、手机号 */
  onCopy() {
    if (!this.data.list.length) { toast(c.empty); return; }
    const text = this.data.list.map((s) => [s.name, s.memberNo, s.phone].join('\t')).join('\n');
    wx.setClipboardData({ data: text, success: () => toast(c.copied) });
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
    if (this.data.busy) return;
    wx.showModal({
      title: c.cancelEventTitle,
      content: c.cancelEventConfirm.replace('[人数]', this.data.total || this.data.list.length),
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ busy: true });
        admin.cancelEvent(this.data.id, (left) => this.setData({ progress: left ? c.cancelling.replace('[人数]', left) : '' }))
          .then(() => { toast(c.cancelEventDone); events.refresh(); })
          .catch((err) => toast(admin.errorText(err)))
          .then(() => this.load())
          .then(() => this.setData({ busy: false, progress: '' }));
      }
    });
  }
});
