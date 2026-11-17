const copy = require('../../content/admin.js');
const store = require('../../utils/store.js');
const admin = require('../../utils/admin.js');
const events = require('../../utils/events.js');
const { baseData, go, navTone, headerTone, shareCard, TABS, tick } = require('../../utils/page.js');

const toast = (title) => wx.showToast({ title: title, icon: 'none' });
const c = copy.interact;
const KINDS = ['wheel', 'web', 'mini'];
const AUDIENCES = ['all', 'member', 'signed'];

function emptyForm() {
  return {
    kind: 'wheel', title: '', note: '', eventId: '', audience: 'member', tries: '1',
    prizes: [emptyPrize()], url: '', appId: '', path: '', shortLink: ''
  };
}
function emptyPrize() {
  return { id: admin.newFieldId('p'), name: '', total: '', chance: '', won: 0, wonText: '' };
}

/** 填的中奖机会加起来是多少（按万分之几算，避免小数相加的误差） */
function chanceLine(prizes) {
  const sum = prizes.reduce((s, p) => s + (isFinite(Number(p.chance)) ? Math.round(Number(p.chance) * 100) : 0), 0);
  const fmt = (bp) => String(bp / 100);
  return c.form.chanceSum.replace('[合计]', fmt(sum)).replace('[剩下]', fmt(Math.max(0, 10000 - sum)));
}

/**
 * 运营后台：新建或编辑一个现场互动。参数 id 有值是编辑。
 * 新建的是关着的，回到列表点「打开」才出现入口。设计稿里没有后台，样式沿用活动的表单页。
 */
Page({
  data: Object.assign(baseData(), {
    copy: c,
    common: copy.form,
    kinds: KINDS.map((k) => ({ key: k, text: c.kinds[k] })),
    audiences: AUDIENCES.map((k) => ({ key: k, text: c.audiences[k] })),
    id: '',
    form: emptyForm(),
    chanceText: '',
    eventNames: [c.form.noEvent],
    eventIndex: 0,
    loaded: false,
    loading: false,
    loadFailed: false,
    conflict: false,
    busy: false
  }),

  onLoad(query) {
    this.setData(Object.assign(baseData(), { id: query.id || '' }));
    this.toneAt = headerTone(132);
    try { wx.hideShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] }); } catch (e) { /* 旧基础库忽略 */ }
    const m = store.getMember();
    if (!m || !m.admin) { toast(copy.errors.forbidden); go('me'); return; }
    this.load();
  },

  /** 读活动列表（关联活动用），编辑时再读这个互动现在的内容 */
  load() {
    const mine = this.loadSeq = (this.loadSeq || 0) + 1;
    this.setData({ loading: true, loaded: false, loadFailed: false });
    const id = this.data.id;
    return Promise.all([admin.listEvents(), id ? admin.listInteractions() : Promise.resolve(null)])
      .then((r) => {
        if (mine !== this.loadSeq) return;
        // 关联活动只列还没结束的，加上这个互动已经关联着的那一场
        const list = r[0];
        let form = emptyForm();
        if (id) {
          const x = (r[1] || []).find((i) => i.id === id);
          if (!x) throw { code: 'not_found' };
          this.version = x.version;
          form = {
            kind: x.kind, title: x.title, note: x.note, eventId: x.eventId || '', audience: x.audience || 'all',
            tries: String(x.tries || 1),
            prizes: x.kind === 'wheel' ? x.prizes.map((p) => ({
              id: p.id, name: p.name, total: String(p.total), chance: String(p.chance), won: p.won || 0,
              // 已经抽中了几个：数量不能改得比它少
              wonText: p.won ? c.form.wonText.replace('[个数]', p.won) : ''
            })) : [emptyPrize()],
            url: x.url || '', appId: x.appId || '', path: x.path || '', shortLink: x.shortLink || ''
          };
        }
        this.eventList = list.filter((e) => e.id === form.eventId || !e.date || e.date > Date.now() - 24 * 3600 * 1000);
        this.setData({
          form: form, loaded: true, loading: false, conflict: false,
          eventNames: [c.form.noEvent].concat(this.eventList.map((e) => e.title)),
          eventIndex: Math.max(0, this.eventList.findIndex((e) => e.id === form.eventId) + 1),
          chanceText: chanceLine(form.prizes)
        });
        this.savedSnapshot = this.snapshot();
        admin.watchUnsaved(false);
      })
      .catch((e) => {
        if (mine !== this.loadSeq) return;
        this.setData({ loading: false, loadFailed: true });
        toast(admin.errorText(e));
      });
  },

  snapshot() { return JSON.stringify(this.data.form); },
  dirty() { return this.data.loaded && this.snapshot() !== this.savedSnapshot; },
  changed() {
    this.setData({ chanceText: chanceLine(this.data.form.prizes) });
    admin.watchUnsaved(this.dirty());
  },

  onUnload() {
    this.loadSeq = (this.loadSeq || 0) + 1;
    admin.watchUnsaved(false);
  },

  onPageScroll(e) { navTone(this, e.scrollTop, this.toneAt); },

  /** 后台不让转发；万一触发了，转出去的是首页 */
  onShareAppMessage() { return shareCard(TABS.home); },

  onBack() {
    admin.confirmDiscard(this.dirty(), () => {
      admin.watchUnsaved(false);
      if (getCurrentPages().length > 1) wx.navigateBack();
      else go('admin');
    });
  },

  onRetry() {
    if (this.data.loading || this.data.busy) return;
    admin.confirmDiscard(this.dirty(), () => this.load());
  },

  editable() { return this.data.loaded && !this.data.busy; },

  onKind(e) {
    if (!this.editable()) return;
    tick();
    this.setData({ 'form.kind': e.currentTarget.dataset.key });
    this.changed();
  },

  onAudience(e) {
    if (!this.editable()) return;
    tick();
    this.setData({ 'form.audience': e.currentTarget.dataset.key });
    this.changed();
  },

  onEvent(e) {
    if (!this.editable()) return;
    const i = Number(e.detail.value) || 0;
    this.setData({ eventIndex: i, 'form.eventId': i > 0 ? this.eventList[i - 1].id : '' });
    this.changed();
  },

  onInput(e) {
    if (!this.editable()) return;
    this.setData({ ['form.' + e.currentTarget.dataset.field]: e.detail.value });
    this.changed();
  },

  onPrizeInput(e) {
    if (!this.editable()) return;
    const { index, field } = e.currentTarget.dataset;
    this.setData({ ['form.prizes[' + index + '].' + field]: e.detail.value });
    this.changed();
  },

  onPrizeAdd() {
    if (!this.editable()) return;
    if (this.data.form.prizes.length >= 8) { toast(copy.errors.too_many_prizes); return; }
    tick();
    this.setData({ 'form.prizes': this.data.form.prizes.concat([emptyPrize()]) });
    this.changed();
  },

  onPrizeRemove(e) {
    if (!this.editable()) return;
    const i = e.currentTarget.dataset.index;
    const prizes = this.data.form.prizes.slice();
    // 已经有人抽中的奖品不能删：删了以后数量对不上。把数量改到已抽中的数，就不会再抽出来
    if (prizes[i] && prizes[i].won > 0) { toast(copy.errors.prize_below_won); return; }
    tick();
    prizes.splice(i, 1);
    this.setData({ 'form.prizes': prizes });
    this.changed();
  },

  /** 表单 → 交给云函数的数据。数字在这里转，格式不对的交给检查去拦 */
  payload() {
    const f = this.data.form;
    const num = (v) => (String(v).trim() === '' ? NaN : Number(v));
    return {
      kind: f.kind, title: f.title.trim(), note: f.note, eventId: f.eventId, audience: f.audience,
      tries: num(f.tries),
      prizes: f.kind === 'wheel' ? f.prizes.map((p) => ({ id: p.id, name: p.name.trim(), total: num(p.total), chance: num(p.chance) })) : [],
      url: f.url.trim(), appId: f.appId.trim(), path: f.path.trim(), shortLink: f.shortLink.trim()
    };
  },

  onSave() {
    if (!this.data.loaded) { toast(copy.errors.load_first); return; }
    if (this.data.conflict) { toast(c.form.conflict); return; }
    if (this.data.busy) return;
    const x = this.payload();
    const invalid = admin.interactionError(x);
    if (invalid) { toast(copy.errors[invalid]); return; }
    this.setData({ busy: true });
    return admin.saveInteraction(this.data.id, x, this.data.id ? this.version : undefined)
      .then(() => {
        this.savedSnapshot = this.snapshot();
        admin.watchUnsaved(false);
        events.refresh(true);
        toast(c.form.saved);
        setTimeout(() => this.onBack(), 600);
      })
      .catch((e) => { this.setData({ busy: false, conflict: e.code === 'conflict' }); toast(e.code === 'conflict' ? c.form.conflict : admin.errorText(e)); });
  }
});
