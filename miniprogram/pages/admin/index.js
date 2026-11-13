const copy = require('../../content/admin.js');
const memberCopy = require('../../content/member.js');
const store = require('../../utils/store.js');
const admin = require('../../utils/admin.js');
const events = require('../../utils/events.js');
const format = require('../../utils/format.js');
const config = require('../../config.js');
const { baseData, go, navTone, headerTone, shareCard, TABS, tick } = require('../../utils/page.js');
const { assetUrl } = require('../../utils/assets.js');

const toast = (title) => wx.showToast({ title: title, icon: 'none' });

/** 新活动通知发到哪一步了：没通知过是空的 */
function notifyText(n) {
  if (!n) return '';
  if (n.status !== 'done') return copy.events.notifyPending;
  return copy.events.notifyDone.replace('[人数]', n.sent) + (n.failed ? '，' + copy.events.notifyFailed.replace('[人数]', n.failed) : '');
}

/** 活动 → 列表里一行的显示数据。已上架但日期已经过去的算「已结束」 */
function eventRow(e) {
  const published = e.status === 'published';
  const ended = !!e.date && e.date < Date.now() - 24 * 3600 * 1000;
  const state = e.cancelled ? 'cancelled' : (published ? (ended ? 'ended' : 'published') : 'draft');
  return {
    id: e.id,
    title: e.title,
    published: published,
    state: state,
    stateText: copy.events.status[state],
    meta: [e.type, format.moment(e.date), e.city].filter(Boolean).join(' · '),
    signups: copy.events.signups.replace('[人数]', e.signupCount || 0) + (e.quota ? ' / ' + e.quota : ''),
    // 新活动通知：上架着、还没开始、没通知过的活动可以通知一次
    // 上架着、还没结束的活动可以一键发成公告
    canAnnounce: state === 'published',
    // 办完的赛事可以加到往期（往期只放赛事）
    canPast: e.type === '赛事' && ended && !e.cancelled,
    raw: { title: e.title, date: e.date, city: e.city, venue: e.venue, cover: e.cover },
    canNotify: state === 'published' && !e.notify && e.date > Date.now(),
    notifyText: notifyText(e.notify)
  };
}

/** 往期赛事 → 列表里一行的显示数据。照片是 assets/ 路径的换成地址，云存储的 fileID 直接能显示 */
function pastRow(p) {
  return { id: p.id, year: p.year, name: p.name, nameEn: p.nameEn, image: p.image, src: assetUrl(p.image), home: p.home !== false };
}

/** 看板上按北京时间写几月几日（云端的一天是按北京时间分的） */
function bjDay(ms) {
  const d = new Date(ms + 8 * 3600 * 1000);
  return (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日';
}

/** 云端的统计 → 看板上的数字卡片和柱状图 */
function boardView(d) {
  const c = copy.members;
  const days = d.daily || [];
  const max = days.reduce((m, x) => Math.max(m, x.count), 0);
  return {
    stats: [
      ['total', d.total], ['today', d.today], ['week', d.week], ['month', d.month],
      ['points', d.points], ['signups', d.signups], ['plans', d.plans], ['news', d.newsWaiting]
    ].map((x) => ({ key: x[0], label: c.stats[x[0]], num: String(x[1] || 0) })),
    partial: !!d.partial,
    // 柱子的高度是占最高那天的百分之几；一个人都没有的那天留一道细线
    bars: days.map((x) => ({ day: x.day, zero: !x.count, height: max && x.count ? Math.max(4, Math.round(x.count / max * 100)) : 2 })),
    maxText: c.chartMax.replace('[人数]', max),
    from: days.length ? bjDay(days[0].day) : '',
    to: days.length ? bjDay(days[days.length - 1].day) : ''
  };
}

/** 名单里的一位会员 → 一行的显示数据 */
function memberRow(m) {
  const c = copy.members;
  return {
    memberNo: m.memberNo,
    name: m.nickname || c.noName,
    noName: !m.nickname,
    admin: !!m.admin,
    meta: [c.memberNo.replace(/\[[^\]]+\]/, m.memberNo || '—'), m.phoneMasked].filter(Boolean).join(' · '),
    sub: [m.joinedAt ? c.joined.replace('[日期]', format.date(m.joinedAt)) : '', m.signups ? c.signups.replace('[场数]', m.signups) : ''].filter(Boolean).join(' · '),
    points: String(m.points || 0)
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
    eventsFailed: false,
    busy: false,
    events: [],
    // 现在有多少人订阅着新活动通知
    newsWaiting: 0,
    subscribersText: '',
    // 往期的赞助赛事。pastForm 不是 null 时显示表单（新加或编辑），否则显示列表
    past: [],
    pastLoaded: false,
    // 会员看板：board 是数字和图，members 是名单，membersMore 表示后面还有
    board: null,
    members: [],
    membersMore: false,
    membersLoading: false,
    membersFailed: false,
    pastForm: null,
    uploading: false,
    notice: { title: '', content: '', enabled: false },
    noticeLoaded: false,
    noticeLoading: false,
    noticeFailed: false,
    query: '',
    member: null,
    sign: 1,
    amount: '',
    reason: '',
    // 电脑端后台的网址和刚取到的登录码（显示成 1234 5678 9012）
    webUrl: config.webAdminUrl || '',
    webCode: ''
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
    this.watchUnsaved();
  },

  onPageScroll(e) {
    navTone(this, e.scrollTop, this.toneAt);
  },

  /** 后台不让转发；万一触发了，转出去的是首页 */
  onShareAppMessage() {
    return shareCard(TABS.home);
  },

  onBack() {
    admin.confirmDiscard(this.unsaved(), () => {
      admin.watchUnsaved(false);
      if (getCurrentPages().length > 1) wx.navigateBack();
      else go('me');
    });
  },

  unsaved() {
    return this.data.uploading ||
      (this.data.noticeLoaded && this.noticeSnapshot !== JSON.stringify(this.data.notice)) ||
      (!!this.data.pastForm && this.pastSnapshot !== JSON.stringify(this.data.pastForm)) ||
      (!!this.data.member && !!(this.data.amount || this.data.reason));
  },

  watchUnsaved() {
    admin.watchUnsaved(this.unsaved());
  },

  onUnload() {
    this.noticeSeq = (this.noticeSeq || 0) + 1;
    this.pastEditor = (this.pastEditor || 0) + 1;
    admin.watchUnsaved(false);
  },

  onTab(e) {
    const tab = e.currentTarget.dataset.key;
    if (tab === this.data.tab) {
      if (tab === 'notice' && this.data.noticeFailed) this.loadNotice();
      return;
    }
    tick();
    this.setData({ tab: tab });
    if (tab === 'notice' && (!this.data.noticeLoaded || this.noticeSnapshot === JSON.stringify(this.data.notice))) this.loadNotice(true);
    if (tab === 'past' && !this.data.pastLoaded) this.loadPast();
    if (tab === 'members' && !this.data.board) this.loadMembers();
  },

  /* ---------- 会员看板 ---------- */

  /** 读看板上的数字和名单的第一页 */
  loadMembers() {
    const mine = this.memberSeq = (this.memberSeq || 0) + 1;
    this.setData({ membersLoading: true, membersFailed: false });
    return Promise.all([admin.memberStats(), admin.members(0)])
      .then((r) => {
        if (mine !== this.memberSeq) return;
        this.memberNext = r[1].next;
        this.setData({ board: boardView(r[0]), members: (r[1].members || []).map(memberRow), membersMore: !!r[1].more, membersLoading: false });
      })
      .catch((e) => { if (mine === this.memberSeq) { this.setData({ membersLoading: false, membersFailed: true }); toast(admin.errorText(e)); } });
  },

  onMembersRefresh() {
    if (this.data.membersLoading) return;
    tick();
    this.loadMembers();
  },

  onMembersMore() {
    if (this.data.membersLoading) return;
    const mine = this.memberSeq;
    this.setData({ membersLoading: true });
    admin.members(this.memberNext)
      .then((d) => {
        // 中间刷新过的话，名单已经从头读了，这一页不要了
        if (mine !== this.memberSeq) return;
        // 读这一页的时候有新人加入，名单会整体往后挪：已经在页面上的不再加一遍
        const have = {};
        this.data.members.forEach((m) => { have[m.memberNo] = true; });
        const add = (d.members || []).map(memberRow).filter((m) => !m.memberNo || !have[m.memberNo]);
        this.memberNext = d.next;
        this.setData({ members: this.data.members.concat(add), membersMore: !!d.more, membersLoading: false });
      })
      .catch((e) => { if (mine === this.memberSeq) { this.setData({ membersLoading: false }); toast(admin.errorText(e)); } });
  },

  /** 「调积分」：带着会员编号去积分那一栏查出来 */
  onMemberAdjust(e) {
    tick();
    this.setData({ tab: 'points', query: e.currentTarget.dataset.no, member: null, amount: '', reason: '' });
    this.onFind(null, true);
  },

  /* ---------- 活动 ---------- */

  loadEvents() {
    const mine = this.eventSeq = (this.eventSeq || 0) + 1;
    this.setData({ loading: !this.data.events.length, eventsFailed: false });
    return admin.eventsOverview()
      .then((d) => { if (mine !== this.eventSeq) return; this.setData({
        events: d.events.map(eventRow),
        newsWaiting: d.newsWaiting,
        subscribersText: copy.events.subscribers.replace('[人数]', d.newsWaiting),
        loading: false
      }); })
      .catch((e) => { if (mine === this.eventSeq) { this.setData({ loading: false, eventsFailed: true }); toast(admin.errorText(e)); } });
  },

  onEventsRetry() {
    return this.loadEvents();
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
        events.refresh(true);
        return this.loadEvents();
      })
      .catch((err) => toast(admin.errorText(err)))
      .then(() => this.setData({ busy: false }));
  },

  /** 报名名单 */
  onSignups(e) {
    go('admin-signups', { id: e.currentTarget.dataset.id });
  },

  /** 办完的赛事加到往期：切到「往期」，把名称、年份、头图带进表单，改一改再保存 */
  onToPast(e) {
    const row = this.data.events.find((x) => x.id === e.currentTarget.dataset.id);
    if (!row) return;
    const cover = row.raw.cover || '';
    admin.confirmDiscard(this.data.pastForm && this.pastSnapshot !== JSON.stringify(this.data.pastForm), () => {
      this.setData({
        tab: 'past',
        pastForm: { id: '', year: String(new Date(row.raw.date).getFullYear()), name: row.raw.title, nameEn: '', image: cover, src: assetUrl(cover), home: true }
      });
      this.pastEditor = (this.pastEditor || 0) + 1;
      // 从活动带来的内容尚未保存到往期，离开时也要提醒。
      this.pastSnapshot = '';
      this.watchUnsaved();
      if (!this.data.pastLoaded) this.loadPast();
      if (!cover) toast(copy.events.toPastNoCover);
      wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    });
  },

  /** 把这场活动发成公告：用户下次打开小程序时弹出来。先确认一次，因为会换掉现在的公告 */
  onAnnounce(e) {
    if (this.data.busy) return;
    const row = this.data.events.find((x) => x.id === e.currentTarget.dataset.id);
    if (!row) return;
    const where = [row.raw.city, row.raw.venue].filter(Boolean).join(' ');
    const notice = {
      title: copy.events.announceTitle,
      content: copy.events.announceContent.replace('[名称]', row.raw.title).replace('[时间]', format.moment(row.raw.date)).replace('[地点]', where ? '，' + where : ''),
      enabled: true
    };
    wx.showModal({
      title: copy.events.announceConfirmTitle,
      content: notice.content + '\n\n' + copy.events.announceConfirm,
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ busy: true });
        admin.saveNotice(notice)
          .then((n) => {
            this.noticeSeq = (this.noticeSeq || 0) + 1;
            this.setData({ notice: n, noticeLoaded: true, noticeLoading: false, noticeFailed: false });
            this.noticeSnapshot = JSON.stringify(n);
            this.watchUnsaved();
            toast(copy.events.announced);
          })
          .catch((err) => toast(admin.errorText(err)))
          .then(() => this.setData({ busy: false }));
      }
    });
  },

  /** 把这场活动通知给订阅了新活动通知的人：先弹一次确认，写清楚发给多少人 */
  onNotify(e) {
    if (this.data.busy) return;
    const id = e.currentTarget.dataset.id;
    if (!this.data.newsWaiting) { toast(copy.errors.no_subscribers); return; }
    wx.showModal({
      title: copy.events.notifyConfirmTitle,
      content: copy.events.notifyConfirm.replace('[人数]', this.data.newsWaiting),
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ busy: true });
        admin.notifyEvent(id)
          .then(() => { toast(copy.events.notifyQueued); return this.loadEvents(); })
          .catch((err) => { toast(admin.errorText(err)); return this.loadEvents(); })
          .then(() => this.setData({ busy: false }));
      }
    });
  },

  /* ---------- 往期的赞助赛事 ---------- */

  loadPast() {
    // 每次读取或保存、删除都占一个号。读取回来时号变了，说明这期间列表已经被更新的结果换过了，这份旧的不用
    const mine = this.pastSeq = (this.pastSeq || 0) + 1;
    return admin.listPast()
      .then((list) => { if (mine === this.pastSeq) this.setData({ past: list.map(pastRow), pastLoaded: true }); })
      .catch((e) => toast(admin.errorText(e)));
  },

  /** 保存或删除成功后拿到的新列表：后台的列表和小程序活动页的缓存一起更新 */
  pastChanged(list) {
    this.pastSeq = (this.pastSeq || 0) + 1;
    this.setData({ past: list.map(pastRow), pastLoaded: true });
    events.setPast(list);
  },

  onPastCreate() {
    this.setData({ pastForm: { id: '', year: String(new Date().getFullYear()), name: '', nameEn: '', image: '', src: '', home: true } });
    this.pastEditor = (this.pastEditor || 0) + 1;
    this.pastSnapshot = JSON.stringify(this.data.pastForm);
    this.watchUnsaved();
  },

  onPastEdit(e) {
    const p = this.data.past.find((x) => x.id === e.currentTarget.dataset.id);
    if (p) {
      this.setData({ pastForm: Object.assign({}, p) });
      this.pastEditor = (this.pastEditor || 0) + 1;
      this.pastSnapshot = JSON.stringify(this.data.pastForm);
      this.watchUnsaved();
    }
  },

  onPastCancel() {
    if (this.data.busy || this.data.uploading) return;
    admin.confirmDiscard(this.pastSnapshot !== JSON.stringify(this.data.pastForm), () => {
      this.pastEditor = (this.pastEditor || 0) + 1;
      this.setData({ pastForm: null }); this.watchUnsaved();
    });
  },

  /** 放不放在首页那一排里 */
  onPastHome() {
    if (!this.data.pastForm || this.data.busy) return;
    tick();
    this.setData({ 'pastForm.home': !this.data.pastForm.home });
    this.watchUnsaved();
  },

  onPastInput(e) {
    if (!this.data.pastForm || this.data.busy) return;
    this.setData({ ['pastForm.' + e.currentTarget.dataset.field]: e.detail.value });
    this.watchUnsaved();
  },

  /** 选一张照片传到云存储，赛事存的是它的 fileID */
  onPastImage() {
    if (this.data.uploading || !this.data.pastForm) return;
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sizeType: ['compressed'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file || !this.data.pastForm) return;
        const mine = this.pastEditor;
        this.setData({ uploading: true });
        this.watchUnsaved();
        admin.uploadCover(file.tempFilePath)
          .then((fileID) => { if (mine === this.pastEditor && this.data.pastForm) this.setData({ 'pastForm.image': fileID, 'pastForm.src': fileID }); })
          .catch(() => toast(copy.errors.upload))
          .then(() => { this.setData({ uploading: false }); this.watchUnsaved(); });
      }
    });
  },

  onPastSave() {
    const f = this.data.pastForm;
    // 照片还在传的时候点保存：说一句，不能没反应
    if (f && this.data.uploading) { toast(copy.errors.uploading_wait); return; }
    if (!f || this.data.busy) return;
    // 先在本机拦一下，省一次来回；云函数里还会再检查
    if (!/^(19|20)\d{2}$/.test(String(f.year).trim())) { toast(copy.errors.bad_year); return; }
    if (!String(f.name || '').trim()) { toast(copy.errors.missing_name); return; }
    if (!f.image) { toast(copy.errors.missing_image); return; }
    this.setData({ busy: true });
    admin.savePast(f.id, { year: String(f.year).trim(), name: f.name, nameEn: f.nameEn, image: f.image, home: f.home !== false })
      .then((list) => { this.pastChanged(list); this.setData({ pastForm: null }); this.watchUnsaved(); toast(copy.past.saved); })
      .catch((e) => toast(admin.errorText(e)))
      .then(() => this.setData({ busy: false }));
  },

  /** 删除前弹一次确认，写清楚删的是哪一场 */
  onPastDelete(e) {
    if (this.data.busy) return;
    const p = this.data.past.find((x) => x.id === e.currentTarget.dataset.id);
    if (!p) return;
    wx.showModal({
      title: copy.past.deleteTitle,
      content: copy.past.deleteConfirm.replace('[名称]', p.name),
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ busy: true });
        admin.deletePast(p.id)
          .then((list) => { this.pastChanged(list); toast(copy.past.deleted); })
          .catch((err) => { toast(admin.errorText(err)); return this.loadPast(); })
          .then(() => this.setData({ busy: false }));
      }
    });
  },

  /* ---------- 公告 ---------- */

  loadNotice(force) {
    if (this.data.noticeLoading || (this.data.noticeLoaded && force !== true)) return;
    const mine = this.noticeSeq = (this.noticeSeq || 0) + 1;
    this.setData({ noticeLoading: true, noticeFailed: false, noticeLoaded: false });
    return admin.getNotice()
      .then((n) => {
        if (mine !== this.noticeSeq) return;
        this.setData({ notice: n, noticeLoaded: true });
        this.noticeSnapshot = JSON.stringify(n);
        this.watchUnsaved();
      })
      .catch((e) => { if (mine === this.noticeSeq) { this.setData({ noticeFailed: true }); toast(admin.errorText(e)); } })
      .then(() => { if (mine === this.noticeSeq) this.setData({ noticeLoading: false }); });
  },

  onNoticeRetry() {
    return this.loadNotice();
  },

  onNoticeInput(e) {
    if (!this.data.noticeLoaded || this.data.busy) return;
    this.setData({ ['notice.' + e.currentTarget.dataset.field]: e.detail.value });
    this.watchUnsaved();
  },

  onNoticeToggle() {
    if (!this.data.noticeLoaded || this.data.busy) return;
    tick();
    this.setData({ 'notice.enabled': !this.data.notice.enabled });
    this.watchUnsaved();
  },

  onNoticeSave() {
    if (!this.data.noticeLoaded) { toast(copy.errors.load_first); return; }
    if (this.data.busy) return;
    this.setData({ busy: true });
    return admin.saveNotice(this.data.notice)
      .then((n) => { this.setData({ notice: n }); this.noticeSnapshot = JSON.stringify(n); this.watchUnsaved(); toast(copy.notice.saved); })
      .catch((e) => toast(admin.errorText(e)))
      .then(() => this.setData({ busy: false }));
  },

  /* ---------- 积分 ---------- */

  onQueryInput(e) {
    this.setData({ query: e.detail.value });
  },

  /**
   * 按输入框里的手机号或会员编号找会员。正在找的时候再点不重复找；
   * force 为真（从会员名单点「调积分」过来）时不管：以最后要找的这一位为准，先前那次的结果回来了也不用。
   */
  onFind(e, force) {
    if (this.finding && force !== true) return;
    const mine = this.findSeq = (this.findSeq || 0) + 1;
    this.finding = true;
    admin.findMember(this.data.query)
      .then((m) => { if (mine === this.findSeq) { this.pointsOperation = null; this.setData({ member: memberCard(m), amount: '', reason: '' }); this.watchUnsaved(); } })
      .catch((err) => { if (mine === this.findSeq) { this.setData({ member: null }); toast(admin.errorText(err)); } })
      .then(() => { if (mine === this.findSeq) this.finding = false; });
  },

  onSign(e) {
    tick();
    this.setData({ sign: Number(e.currentTarget.dataset.sign) });
    this.pointsOperation = null;
  },

  onPointsInput(e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value });
    this.pointsOperation = null;
    this.watchUnsaved();
  },

  /* ---------- 电脑端 ---------- */

  /** 取一个登录码，填到电脑上的网页里登录 */
  onWebCode() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    admin.webCode()
      .then((r) => this.setData({ webCode: r.code.replace(/(\d{4})(?=\d)/g, '$1 ') }))
      .catch((e) => toast(admin.errorText(e)))
      .then(() => this.setData({ busy: false }));
  },

  onCopyUrl() {
    wx.setClipboardData({ data: this.data.webUrl, success: () => toast(copy.web.copied) });
  },

  /** 加减积分：先弹一次确认，写清楚给谁、加还是减、多少 */
  onAdjust() {
    const m = this.data.member;
    if (!m || this.data.busy) return;
    const amount = Number(this.data.amount);
    if (!Number.isInteger(amount) || amount <= 0) { toast(copy.errors.bad_delta); return; }
    if (amount > 100000) { toast(copy.errors.delta_too_large); return; }
    const reason = String(this.data.reason || '').trim();
    if (!reason) { toast(copy.errors.missing_reason); return; }
    const adding = this.data.sign > 0;
    const delta = adding ? amount : -amount;
    const signature = JSON.stringify([m.memberNo, delta, reason]);
    wx.showModal({
      title: copy.points.confirmTitle,
      content: (adding ? copy.points.confirmAdd : copy.points.confirmSub).replace('[会员]', m.name + '（' + m.memberNo + '）').replace('[数量]', amount),
      success: (res) => {
        if (!res.confirm) return;
        const mine = this.findSeq;
        if (!this.pointsOperation || this.pointsOperation.signature !== signature) {
          this.pointsOperation = { signature: signature, id: admin.newOperationId() };
        }
        const operation = this.pointsOperation;
        this.setData({ busy: true });
        admin.adjustPoints(m.memberNo, delta, reason, operation.id)
          .then((after) => {
            // 结果回来时页面上还是这位会员才更新卡片；已经换成别人了就不动，只说一声调好了
            const now = this.data.member;
            if (now && now.memberNo === after.memberNo) {
              this.setData(mine === this.findSeq && operation === this.pointsOperation ?
                { member: memberCard(after), amount: '', reason: '' } : { member: memberCard(after) });
            }
            if (operation === this.pointsOperation) this.pointsOperation = null;
            this.watchUnsaved();
            toast(copy.points.done);
          })
          .catch((e) => toast(admin.errorText(e)))
          .then(() => this.setData({ busy: false }));
      }
    });
  }
});
