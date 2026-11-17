const copy = require('../../content/admin.js');
const store = require('../../utils/store.js');
const admin = require('../../utils/admin.js');
const format = require('../../utils/format.js');
const { baseData, go, navTone, headerTone, shareCard, TABS, tick } = require('../../utils/page.js');

const toast = (title) => wx.showToast({ title: title, icon: 'none' });
const c = copy.interact.draws;

/** 中奖的一条 → 一行的显示数据 */
function row(w) {
  const who = w.memberNo
    ? [w.nickname || copy.members.noName, copy.members.memberNo.replace(/\[[^\]]+\]/, w.memberNo)].join(' · ')
    : c.notMember;
  return {
    id: w.id, prize: w.prizeName, code: w.code, redeemed: w.redeemed,
    status: w.redeemed ? c.redeemed : c.unredeemed,
    who: who, phone: w.phone || '', at: format.moment(w.at)
  };
}

/**
 * 运营后台：大转盘的中奖名单。现场按对方出示的领奖码找到这一条，发了奖品点「核销」；点错了可以撤回。
 * 只有管理员能进，权限在云函数里检查。设计稿里没有后台。
 */
Page({
  data: Object.assign(baseData(), {
    copy: c,
    common: copy.signups,
    title: '',
    countText: '',
    query: '',
    list: [],
    shown: [],
    loading: true,
    loadFailed: false,
    busy: false
  }),

  onLoad(query) {
    this.id = query.id || '';
    this.setData(baseData());
    this.toneAt = headerTone(132);
    try { wx.hideShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] }); } catch (e) { /* 旧基础库忽略 */ }
    const m = store.getMember();
    if (!m || !m.admin) { toast(copy.errors.forbidden); go('me'); return; }
    this.load();
  },

  load() {
    const mine = this.seq = (this.seq || 0) + 1;
    this.setData({ loading: true, loadFailed: false });
    return admin.draws(this.id)
      .then((d) => {
        if (mine !== this.seq) return;
        const list = d.wins.map(row);
        const redeemed = list.filter((x) => x.redeemed).length;
        this.setData({
          title: d.interaction.title,
          countText: c.count.replace('[次数]', d.draws).replace('[中奖]', list.length).replace('[已领]', redeemed),
          list: list, loading: false
        });
        this.filter();
      })
      .catch((e) => { if (mine === this.seq) { this.setData({ loading: false, loadFailed: true }); toast(admin.errorText(e)); } });
  },

  /** 按领奖码筛：输入几位就显示码里含这几位的 */
  filter() {
    const q = this.data.query.replace(/\D/g, '');
    this.setData({ shown: q ? this.data.list.filter((x) => x.code.indexOf(q) >= 0) : this.data.list });
  },

  onQuery(e) {
    this.setData({ query: e.detail.value });
    this.filter();
  },

  onRetry() {
    if (!this.data.loading && !this.data.busy) this.load();
  },

  onUnload() { this.seq = (this.seq || 0) + 1; },
  onPageScroll(e) { navTone(this, e.scrollTop, this.toneAt); },

  /** 后台不让转发；万一触发了，转出去的是首页 */
  onShareAppMessage() { return shareCard(TABS.home); },

  onBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else go('admin');
  },

  onCall(e) {
    const phone = e.currentTarget.dataset.phone;
    if (phone) wx.makePhoneCall({ phoneNumber: phone, fail: () => {} });
  },

  /** 核销或撤回：先确认是哪个码、什么奖品 */
  onRedeem(e) {
    if (this.data.busy) return;
    const w = this.data.list.find((x) => x.id === e.currentTarget.dataset.id);
    if (!w) return;
    const undo = w.redeemed;
    wx.showModal({
      title: undo ? c.undoTitle : c.redeemTitle,
      content: (undo ? c.undoConfirm : c.redeemConfirm).replace('[领奖码]', w.code).replace('[奖品]', w.prize),
      success: (r) => {
        if (!r.confirm) return;
        tick();
        this.setData({ busy: true });
        admin.redeem(w.id, !undo)
          .then((d) => toast(d.already && !undo ? c.already : undo ? c.unredeemed : c.redeemDone))
          .catch((err) => toast(admin.errorText(err)))
          .then(() => this.load())
          .then(() => this.setData({ busy: false }));
      }
    });
  },

  /** 复制名单：每人一行，时间、奖品、领奖码、状态、会员、手机号，用制表符隔开，可以直接贴进表格 */
  onCopy() {
    if (!this.data.list.length) { toast(c.empty); return; }
    const text = this.data.list.map((x) => [x.at, x.prize, x.code, x.status, x.who, x.phone].join('\t')).join('\n');
    wx.setClipboardData({ data: text, success: () => toast(c.copied) });
  }
});
