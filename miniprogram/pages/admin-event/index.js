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
  return { type: TYPES[0], title: '', city: '', venue: '', quota: '', quotaText: '', cover: '', intro: '', published: false };
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
    busy: false,
    uploading: false
  }),

  onLoad(query) {
    this.setData(Object.assign(baseData(), { id: query.id || '' }));
    // 头部设计高 132px
    this.toneAt = headerTone(132);
    try { wx.hideShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] }); } catch (e) { /* 旧基础库忽略 */ }
    const m = store.getMember();
    if (!m || !m.admin) { toast(copy.errors.forbidden); go('me'); return; }
    if (query.id) this.load(query.id);
  },

  /** 编辑：把这场活动现在的内容填进表单 */
  load(id) {
    admin.listEvents().then((list) => {
      const e = list.find((x) => x.id === id);
      if (!e) { toast(copy.errors.not_found); return; }
      const times = {};
      TIME_FIELDS.forEach((k) => { times[k] = admin.toPicker(e[k]); });
      this.setData({
        form: {
          type: e.type, title: e.title, city: e.city, venue: e.venue, quota: e.quota ? String(e.quota) : '', quotaText: e.quotaText,
          cover: e.cover, intro: e.intro, published: e.status === 'published'
        },
        times: times
      });
    }).catch((e) => toast(admin.errorText(e)));
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

  onType(e) {
    tick();
    this.setData({ 'form.type': e.currentTarget.dataset.type });
  },

  onInput(e) {
    this.setData({ ['form.' + e.currentTarget.dataset.field]: e.detail.value });
  },

  /** 选了日期或时间。data-field 是哪个时间，data-part 是 date 还是 time */
  onTime(e) {
    const { field, part } = e.currentTarget.dataset;
    this.setData({ ['times.' + field + '.' + part]: e.detail.value });
  },

  onTimeClear(e) {
    this.setData({ ['times.' + e.currentTarget.dataset.field]: { date: '', time: '' } });
  },

  onPublishToggle() {
    tick();
    this.setData({ 'form.published': !this.data.form.published });
  },

  /** 选一张图传到云存储，活动存的是它的 fileID */
  onCover() {
    if (this.data.uploading) return;
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sizeType: ['compressed'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) return;
        this.setData({ uploading: true });
        admin.uploadCover(file.tempFilePath)
          .then((fileID) => this.setData({ 'form.cover': fileID }))
          .catch(() => toast(copy.errors.upload))
          .then(() => this.setData({ uploading: false }));
      }
    });
  },

  onCoverClear() {
    this.setData({ 'form.cover': '' });
  },

  /** 表单 → 交给云函数的活动数据 */
  payload() {
    const f = this.data.form;
    const quota = parseInt(f.quota, 10);
    const event = {
      type: f.type, title: f.title, city: f.city, venue: f.venue,
      quota: quota > 0 ? quota : null, quotaText: f.quotaText,
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
    if (this.data.busy || this.data.uploading) return;
    const event = this.payload();
    // 先在本机拦一下必填项，省一次来回；云函数里还会再检查
    if (!String(event.title || '').trim()) { toast(copy.errors.missing_title); return; }
    if (!event.date) { toast(copy.errors.missing_date); return; }
    this.setData({ busy: true });
    admin.saveEvent(this.data.id, event)
      .then(() => {
        // 小程序里的活动列表跟着更新
        events.refresh();
        toast(copy.form.saved);
        setTimeout(() => this.onBack(), 600);
      })
      .catch((e) => { this.setData({ busy: false }); toast(admin.errorText(e)); });
  }
});
