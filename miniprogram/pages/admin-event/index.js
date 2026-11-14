const copy = require('../../content/admin.js');
const store = require('../../utils/store.js');
const admin = require('../../utils/admin.js');
const events = require('../../utils/events.js');
const { baseData, go, navTone, headerTone, shareCard, TABS, tick } = require('../../utils/page.js');

const toast = (title) => wx.showToast({ title: title, icon: 'none' });
const TYPES = ['赛事', '试用装', '抽奖'];
/** 五个时间字段。活动时间必填，其余可以不填 */
const TIME_FIELDS = ['date', 'signupStart', 'signupEnd', 'memberSignupStart', 'drawAt'];
/** 只选了日期没选时间时按几点算：结束的按当天最后一分钟，其余按零点 */
const DEFAULT_TIME = { signupEnd: '23:59' };

function emptyForm() {
  return { type: TYPES[0], title: '', city: '', venue: '', quota: '', quotaText: '', cost: '', contact: '', cover: '', intro: '', published: false };
}
function emptyTimes() {
  const t = {};
  TIME_FIELDS.forEach((k) => { t[k] = { date: '', time: '' }; });
  return t;
}

/**
 * 运营后台：新建或编辑一场活动。参数 id 有值是编辑，没有是新建。
 * 表单里的时间按手机所在的时区理解（运营在国内用就是北京时间），存到云端是时间戳。
 * 权限在云函数里检查，这里只是不让普通会员看到页面。设计稿里没有后台。
 */
Page({
  data: Object.assign(baseData(), {
    copy: copy.form,
    types: TYPES,
    id: '',
    form: emptyForm(),
    times: emptyTimes(),
    loaded: false,
    loading: false,
    loadFailed: false,
    conflict: false,
    busy: false,
    uploading: false,
    // 表单里的内容是从上次没存的草稿里恢复的
    restored: false
  }),

  onLoad(query) {
    this.setData(Object.assign(baseData(), { id: query.id || '' }));
    // 头部设计高 132px
    this.toneAt = headerTone(132);
    try { wx.hideShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] }); } catch (e) { /* 旧基础库忽略 */ }
    const m = store.getMember();
    if (!m || !m.admin) { toast(copy.errors.forbidden); go('me'); return; }
    if (query.id) this.load(query.id);
    else {
      this.savedSnapshot = this.snapshot();
      // 上次新建到一半没存的内容：摆回来接着填
      const draft = admin.getEventDraft();
      if (draft) {
        this.setData({ form: Object.assign(emptyForm(), draft.form), times: Object.assign(emptyTimes(), draft.times) });
        this.setData({ restored: this.snapshot() !== this.savedSnapshot });
      }
      this.setData({ loaded: true });
    }
  },

  /** 编辑：把这场活动现在的内容填进表单 */
  load(id) {
    const mine = this.loadSeq = (this.loadSeq || 0) + 1;
    this.setData({ loading: true, loaded: false, loadFailed: false });
    return admin.listEvents().then((list) => {
      if (mine !== this.loadSeq) return;
      const e = list.find((x) => x.id === id);
      if (!e) throw { code: 'not_found' };
      this.version = e.version;
      const times = {};
      TIME_FIELDS.forEach((k) => { times[k] = admin.toPicker(e[k]); });
      this.setData({
        form: {
          type: e.type, title: e.title, city: e.city, venue: e.venue, quota: e.quota ? String(e.quota) : '', quotaText: e.quotaText,
          cost: e.cost ? String(e.cost) : '', contact: e.contact || '',
          cover: e.cover, intro: e.intro, published: e.status === 'published'
        },
        times: times,
        loaded: true, loading: false, conflict: false
      });
      this.savedSnapshot = this.snapshot();
      admin.watchUnsaved(false);
    }).catch((e) => {
      if (mine !== this.loadSeq) return;
      this.setData({ loading: false, loadFailed: true });
      toast(admin.errorText(e));
    });
  },

  snapshot() {
    return JSON.stringify({ form: this.data.form, times: this.data.times });
  },

  dirty() {
    return this.data.uploading || (this.data.loaded && this.snapshot() !== this.savedSnapshot);
  },

  changed() {
    // 新建的表单每改一下就存成草稿，退出不用拦；编辑已有活动时没保存的修改会丢，退出前要问
    if (!this.data.id) { this.keepDraft(); return; }
    admin.watchUnsaved(this.dirty());
  },

  keepDraft() {
    // 页面已经退出了（比如头图传到一半就走了，传完才回到这里）：不能拿这一页的旧内容去盖后来填的草稿
    if (this.unloaded) return;
    if (this.snapshot() === this.savedSnapshot) admin.clearEventDraft();
    else admin.setEventDraft({ form: this.data.form, times: this.data.times });
  },

  /** 「清空重填」：丢掉草稿，回到空表单 */
  onDraftClear() {
    if (this.data.id || this.data.busy || this.data.uploading) return;
    tick();
    admin.clearEventDraft();
    this.setData({ form: emptyForm(), times: emptyTimes(), restored: false });
  },

  onRetry() {
    if (this.data.loading || this.data.busy) return;
    admin.confirmDiscard(this.dirty(), () => this.load(this.data.id));
  },

  onUnload() {
    this.unloaded = true;
    this.loadSeq = (this.loadSeq || 0) + 1;
    admin.watchUnsaved(false);
  },

  onPageScroll(e) {
    navTone(this, e.scrollTop, this.toneAt);
  },

  /** 后台不让转发；万一触发了，转出去的是首页 */
  onShareAppMessage() {
    return shareCard(TABS.home);
  },

  onBack() {
    admin.confirmDiscard(!!this.data.id && this.dirty(), () => {
      admin.watchUnsaved(false);
      if (getCurrentPages().length > 1) wx.navigateBack();
      else go('admin');
    });
  },

  onType(e) {
    if (!this.data.loaded || this.data.busy) return;
    tick();
    this.setData({ 'form.type': e.currentTarget.dataset.type });
    this.changed();
  },

  onInput(e) {
    if (!this.data.loaded || this.data.busy) return;
    this.setData({ ['form.' + e.currentTarget.dataset.field]: e.detail.value });
    this.changed();
  },

  /** 选了日期或时间。data-field 是哪个时间，data-part 是 date 还是 time */
  onTime(e) {
    if (!this.data.loaded || this.data.busy) return;
    const { field, part } = e.currentTarget.dataset;
    this.setData({ ['times.' + field + '.' + part]: e.detail.value });
    this.changed();
  },

  onTimeClear(e) {
    if (!this.data.loaded || this.data.busy) return;
    this.setData({ ['times.' + e.currentTarget.dataset.field]: { date: '', time: '' } });
    this.changed();
  },

  onPublishToggle() {
    if (!this.data.loaded || this.data.busy) return;
    tick();
    this.setData({ 'form.published': !this.data.form.published });
    this.changed();
  },

  /** 选一张图传到云存储，活动存的是它的 fileID */
  onCover() {
    if (!this.data.loaded || this.data.busy || this.data.uploading) return;
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sizeType: ['compressed'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) return;
        this.setData({ uploading: true });
        this.changed();
        admin.uploadCover(file.tempFilePath)
          .then((fileID) => this.setData({ 'form.cover': fileID }))
          .catch(() => toast(copy.errors.upload))
          .then(() => { this.setData({ uploading: false }); this.changed(); });
      }
    });
  },

  onCoverClear() {
    if (!this.data.loaded || this.data.busy || this.data.uploading) return;
    this.setData({ 'form.cover': '' });
    this.changed();
  },

  /** 表单 → 交给云函数的活动数据 */
  payload() {
    const f = this.data.form;
    const quota = String(f.quota || '').trim() ? Number(f.quota) : null;
    const cost = String(f.cost || '').trim() ? Number(f.cost) : 0;
    const event = {
      cost: cost, contact: f.contact,
      type: f.type, title: f.title, city: f.city, venue: f.venue,
      quota: quota, quotaText: f.quotaText,
      cover: f.cover, intro: f.intro, status: f.published ? 'published' : 'draft'
    };
    TIME_FIELDS.forEach((k) => {
      const t = this.data.times[k];
      event[k] = admin.fromPicker(t.date, t.time, DEFAULT_TIME[k]);
    });
    // 开奖时间只有抽奖有
    if (f.type !== '抽奖') event.drawAt = null;
    return event;
  },

  onSave() {
    if (!this.data.loaded) { toast(copy.errors.load_first); return; }
    if (this.data.conflict) { toast(copy.errors.conflict); return; }
    // 头图还在传的时候点保存：说一句，不能没反应
    if (this.data.uploading) { toast(copy.errors.uploading_wait); return; }
    if (this.data.busy) return;
    const event = this.payload();
    // 先在本机拦一下必填项，省一次来回；云函数里还会再检查
    const invalid = admin.eventError(event);
    if (invalid) { toast(copy.errors[invalid]); return; }
    // 新建的：记下交上去的是哪一份，存成功时只清这一份草稿
    const submitted = this.snapshot();
    this.setData({ busy: true });
    return admin.saveEvent(this.data.id, event, this.version)
      .then(() => {
        // 小程序里的活动列表跟着更新
        events.refresh(true);
        if (!this.data.id) admin.clearEventDraftIf(submitted);
        this.savedSnapshot = this.snapshot();
        admin.watchUnsaved(false);
        toast(copy.form.saved);
        setTimeout(() => this.onBack(), 600);
      })
      .catch((e) => { this.setData({ busy: false, conflict: e.code === 'conflict' }); toast(admin.errorText(e)); });
  }
});
