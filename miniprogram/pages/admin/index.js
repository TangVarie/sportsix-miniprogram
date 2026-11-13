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
    // 现在有多少人订阅着新活动通知
    newsWaiting: 0,
    subscribersText: '',
    // 往期的赞助赛事。pastForm 不是 null 时显示表单（新加或编辑），否则显示列表
    past: [],
    pastLoaded: false,
    pastForm: null,
    uploading: false,
    notice: { title: '', content: '', enabled: false },
    noticeLoaded: false,
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
    if (tab === 'past' && !this.data.pastLoaded) this.loadPast();
  },

  /* ---------- 活动 ---------- */

  loadEvents() {
    return admin.eventsOverview()
      .then((d) => this.setData({
        events: d.events.map(eventRow),
        newsWaiting: d.newsWaiting,
        subscribersText: copy.events.subscribers.replace('[人数]', d.newsWaiting),
        loading: false
      }))
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

  /** 报名名单 */
  onSignups(e) {
    go('admin-signups', { id: e.currentTarget.dataset.id });
  },

  /** 办完的赛事加到往期：切到「往期」，把名称、年份、头图带进表单，改一改再保存 */
  onToPast(e) {
    const row = this.data.events.find((x) => x.id === e.currentTarget.dataset.id);
    if (!row) return;
    const cover = row.raw.cover || '';
    this.setData({
      tab: 'past',
      pastForm: { id: '', year: String(new Date(row.raw.date).getFullYear()), name: row.raw.title, nameEn: '', image: cover, src: assetUrl(cover), home: true }
    });
    if (!this.data.pastLoaded) this.loadPast();
    if (!cover) toast(copy.events.toPastNoCover);
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
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
          .then((n) => { this.setData({ notice: n, noticeLoaded: true }); toast(copy.events.announced); })
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
    events.refreshPast();
  },

  onPastCreate() {
    this.setData({ pastForm: { id: '', year: String(new Date().getFullYear()), name: '', nameEn: '', image: '', src: '', home: true } });
  },

  onPastEdit(e) {
    const p = this.data.past.find((x) => x.id === e.currentTarget.dataset.id);
    if (p) this.setData({ pastForm: Object.assign({}, p) });
  },

  onPastCancel() {
    if (this.data.busy || this.data.uploading) return;
    this.setData({ pastForm: null });
  },

  /** 放不放在首页那一排里 */
  onPastHome() {
    tick();
    this.setData({ 'pastForm.home': !this.data.pastForm.home });
  },

  onPastInput(e) {
    this.setData({ ['pastForm.' + e.currentTarget.dataset.field]: e.detail.value });
  },

  /** 选一张照片传到云存储，赛事存的是它的 fileID */
  onPastImage() {
    if (this.data.uploading || !this.data.pastForm) return;
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sizeType: ['compressed'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file || !this.data.pastForm) return;
        this.setData({ uploading: true });
        admin.uploadCover(file.tempFilePath)
          .then((fileID) => { if (this.data.pastForm) this.setData({ 'pastForm.image': fileID, 'pastForm.src': fileID }); })
          .catch(() => toast(copy.errors.upload))
          .then(() => this.setData({ uploading: false }));
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
      .then((list) => { this.pastChanged(list); this.setData({ pastForm: null }); toast(copy.past.saved); })
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
