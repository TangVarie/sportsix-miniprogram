const copy = require('../../content/admin.js');
const memberCopy = require('../../content/member.js');
const store = require('../../utils/store.js');
const admin = require('../../utils/admin.js');
const events = require('../../utils/events.js');
const format = require('../../utils/format.js');
const { baseData, go, navTone, headerTone, shareCard, TABS, tick } = require('../../utils/page.js');

const toast = (title) => wx.showToast({ title: title, icon: 'none' });

/** 活动 → 列表里一行的显示数据。已上架但日期已经过去的算「已结束」 */
function eventRow(e) {
  const published = e.status === 'published';
  const state = published ? (e.date && e.date < Date.now() - 24 * 3600 * 1000 ? 'ended' : 'published') : 'draft';
  return {
    id: e.id,
    title: e.title,
    published: published,
    state: state,
    stateText: copy.events.status[state],
    meta: [e.type, format.moment(e.date), e.city].filter(Boolean).join(' · '),
    signups: copy.events.signups.replace('[人数]', e.signupCount || 0) + (e.quota ? ' / ' + e.quota : '')
  };
}

/** 查到的会员 → 卡片上的显示数据 */
function memberCard(m) {
  return {
    memberNo: m.memberNo,
    name: m.nickname || memberCopy.me.profile.nickname,
    noText: copy.points.memberNo.replace(/\[[^\]]+\]/, m.memberNo || '—'),
    phoneMasked: m.phoneMasked,
    points: String(m.points || 0)
  };
}

/**
 * 运营后台：活动（新建、编辑、上下架）、公告（打开小程序时弹一次）、积分（给会员加减）。
 * 只有管理员能进：会员记录上有 admin: true（在云开发控制台里手动加）。这里的判断只是不让普通会员看到页面，
 * 真正的权限检查在云函数的各个 admin 接口里。设计稿里没有后台。
 */
Page({
  data: Object.assign(baseData(), {
    copy: copy,
    tab: 'events',
    loading: true,
    busy: false,
    events: [],
    notice: { title: '', content: '', enabled: false },
    noticeLoaded: false,
    query: '',
    member: null,
    sign: 1,
    amount: '',
    reason: ''
  }),

  onLoad() {
    this.setData(baseData());
    // 头部设计高 206px
    this.toneAt = headerTone(206);
    try { wx.hideShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] }); } catch (e) { /* 旧基础库忽略 */ }
    const m = store.getMember();
    if (!m || !m.admin) { toast(copy.errors.forbidden); go('me'); }
  },

  onShow() {
    // 从编辑页回来，或者第一次进来：重取活动列表
    this.loadEvents();
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
    else go('me');
  },

  onTab(e) {
    const tab = e.currentTarget.dataset.key;
    if (tab === this.data.tab) return;
    tick();
    this.setData({ tab: tab });
    if (tab === 'notice' && !this.data.noticeLoaded) this.loadNotice();
  },

  /* ---------- 活动 ---------- */

  loadEvents() {
    return admin.listEvents()
      .then((list) => this.setData({ events: list.map(eventRow), loading: false }))
      .catch((e) => { this.setData({ loading: false }); toast(admin.errorText(e)); });
  },

  onCreate() {
    go('admin-event');
  },

  onEdit(e) {
    go('admin-event', { id: e.currentTarget.dataset.id });
  },

  /** 上架、下架 */
  onStatus(e) {
    if (this.data.busy) return;
    const { id, status } = e.currentTarget.dataset;
    this.setData({ busy: true });
    admin.setEventStatus(id, status)
      .then(() => {
        toast(status === 'published' ? copy.events.published : copy.events.unpublished);
        // 小程序里的活动列表也跟着更新
        events.refresh();
        return this.loadEvents();
      })
      .catch((err) => toast(admin.errorText(err)))
      .then(() => this.setData({ busy: false }));
  },

  /* ---------- 公告 ---------- */

  loadNotice() {
    admin.getNotice()
      .then((n) => this.setData({ notice: n, noticeLoaded: true }))
      .catch((e) => toast(admin.errorText(e)));
  },

  onNoticeInput(e) {
    this.setData({ ['notice.' + e.currentTarget.dataset.field]: e.detail.value });
  },

  onNoticeToggle() {
    tick();
    this.setData({ 'notice.enabled': !this.data.notice.enabled });
  },

  onNoticeSave() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    admin.saveNotice(this.data.notice)
      .then((n) => { this.setData({ notice: n }); toast(copy.notice.saved); })
      .catch((e) => toast(admin.errorText(e)))
      .then(() => this.setData({ busy: false }));
  },

  /* ---------- 积分 ---------- */

  onQueryInput(e) {
    this.setData({ query: e.detail.value });
  },

  onFind() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    admin.findMember(this.data.query)
      .then((m) => this.setData({ member: memberCard(m), amount: '', reason: '' }))
      .catch((e) => { this.setData({ member: null }); toast(admin.errorText(e)); })
      .then(() => this.setData({ busy: false }));
  },

  onSign(e) {
    tick();
    this.setData({ sign: Number(e.currentTarget.dataset.sign) });
  },

  onPointsInput(e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value });
  },

  /** 加减积分：先弹一次确认，写清楚给谁、加还是减、多少 */
  onAdjust() {
    const m = this.data.member;
    if (!m || this.data.busy) return;
    const amount = parseInt(this.data.amount, 10);
    if (!(amount > 0)) { toast(copy.errors.bad_delta); return; }
    const reason = String(this.data.reason || '').trim();
    if (!reason) { toast(copy.errors.missing_reason); return; }
    const adding = this.data.sign > 0;
    wx.showModal({
      title: copy.points.confirmTitle,
      content: (adding ? copy.points.confirmAdd : copy.points.confirmSub).replace('[会员]', m.name + '（' + m.memberNo + '）').replace('[数量]', amount),
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ busy: true });
        admin.adjustPoints(m.memberNo, adding ? amount : -amount, reason)
          .then((after) => { this.setData({ member: memberCard(after), amount: '', reason: '' }); toast(copy.points.done); })
          .catch((e) => toast(admin.errorText(e)))
          .then(() => this.setData({ busy: false }));
      }
    });
  }
});
