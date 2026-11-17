const interact = require('../../utils/interact.js');
const events = require('../../utils/events.js');
const store = require('../../utils/store.js');
const copy = require('../../content/interact.js');
const clientCopy = require('../../content/client-state.js');
const pendingAction = require('../../utils/pending-action.js');
const { baseData, go, navTone, headerTone, shareCard, tick, TABS } = require('../../utils/page.js');

const toast = (title) => wx.showToast({ title: title, icon: 'none' });
const errorText = (e) => copy.errors[e && e.code] || copy.errors.network;
/** 转盘转多久（毫秒），和 wxss 里 .it-wheel 的 transition 一致 */
const SPIN_MS = 4200;
/** 转盘的两种格子颜色：奖品黄绿底深蓝字，谢谢参与深蓝底白字 */
const COLORS = { prize: '#C2E541', thanks: '#061A70' };

/** 本人的抽奖记录 → 显示用的几行 */
function mineView(mine) {
  if (!mine) return null;
  const w = copy.wheel;
  return {
    left: mine.left,
    leftText: mine.left > 0 ? w.left.replace('[次数]', mine.left) : w.noLeft,
    results: (mine.results || []).slice().reverse().map((r) => ({
      n: r.n,
      round: w.round.replace('[次数]', r.n),
      win: r.win,
      text: r.win ? r.prizeName : w.lost,
      code: r.code,
      status: r.redeemed ? w.redeemed : w.unredeemed,
      redeemed: r.redeemed
    }))
  };
}

/** 转盘的背景（按格子拼的锥形渐变）和每一格文字的角度 */
function wheelView(segments) {
  const size = 360 / segments.length;
  const stops = segments.map((s, i) => (s.thanks ? COLORS.thanks : COLORS.prize) + ' ' + (i * size) + 'deg ' + ((i + 1) * size) + 'deg');
  return {
    background: 'conic-gradient(from 0deg, ' + stops.join(', ') + ')',
    labels: segments.map((s, i) => ({ key: s.key, text: s.label, thanks: s.thanks, deg: (i + 0.5) * size }))
  };
}

/**
 * 现场互动（设计稿里没有，后加的）。参数 id 是互动；扫小程序码进来时 id 在 scene 里。
 * 没带 id 时（比如从旧的转发卡片进来）打开正在进行的那一个。
 * - 大转盘：抽奖在云端做，页面只负责转到结果对应的格子，再弹出结果。
 * - 网页：点「打开」进 web-view 页面（pages/webview）。
 * - 其他小程序：点「前往参与」跳过去，微信会先弹一次确认。
 */
Page({
  data: Object.assign(baseData(), {
    copy: copy,
    clientCopy: clientCopy,
    loading: true,
    // 读不到的原因：not_found（没有这个互动）、none（现在没有进行中的互动）、network
    error: '',
    item: null,
    blocked: '',
    blockedCopy: null,
    mine: null,
    wheel: null,
    rotation: 0,
    spinning: false
  }),

  onLoad(query) {
    this.setData(baseData());
    this.id = query.id || (query.scene ? decodeURIComponent(query.scene) : '');
    // 头部是深色的，滚过去之后状态栏换成黑字
    this.toneAt = headerTone(560);
  },

  onShow() {
    // 从加入会员、其他小程序回来时重读一次（能不能参与、抽奖记录可能变了）。转盘正在转的时候不动
    if (!this.data.spinning) this.load();
  },

  onUnload() {
    this.disposed = true;
    clearTimeout(this.timer);
  },

  onShareAppMessage() {
    const item = this.data.item;
    return shareCard('/pages/interact/index' + (this.id ? '?id=' + this.id : ''), item ? item.title : copy.title);
  },

  onPageScroll(e) {
    navTone(this, e.scrollTop, this.toneAt);
  },

  /** 没带 id：用活动列表里带回来的正在进行的互动，只有一个就直接打开 */
  pickLive() {
    if (this.id) return Promise.resolve(this.id);
    const pick = () => { const live = events.getLive(); return live.length ? live[0].id : ''; };
    if (pick()) return Promise.resolve(pick());
    return events.refresh(true).then(pick);
  },

  load() {
    const mine = this.loadSeq = (this.loadSeq || 0) + 1;
    if (!this.data.item) this.setData({ loading: true, error: '' });
    return this.pickLive()
      .then((id) => {
        if (!id) throw { code: 'none' };
        this.id = id;
        return interact.fetch(id);
      })
      .then((d) => {
        if (mine !== this.loadSeq || this.disposed) return;
        const item = d.interaction;
        if (item.title) wx.setNavigationBarTitle({ title: item.title });
        const segments = item.kind === 'wheel' ? interact.segments(item.prizes, copy.wheel.thanks) : [];
        this.segments = segments;
        this.setData({
          loading: false, error: '',
          item: item,
          blocked: d.blocked || '',
          blockedCopy: d.blocked ? copy.blocked[d.blocked] || null : null,
          mine: mineView(d.mine),
          wheel: segments.length ? wheelView(segments) : null
        });
      })
      .catch((e) => {
        if (mine !== this.loadSeq || this.disposed) return;
        const code = e && e.code;
        // 已经显示着内容时刷新失败：留着原来的内容
        if (this.data.item && code !== 'not_found') { this.setData({ loading: false }); return; }
        this.setData({ loading: false, item: null, error: code === 'not_found' || code === 'none' ? code : 'network' });
      });
  },

  onRetry() {
    if (!this.data.loading) this.load();
  },

  onBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.switchTab({ url: TABS.events });
  },

  onEvents() {
    go('events');
  },

  /** 只对会员开放：去加入，加入完回到这里 */
  onBlocked() {
    const item = this.data.item;
    if (!item) return;
    if (this.data.blocked === 'not_member' || !store.isMember()) { pendingAction.setInteract(this.id); go('join'); return; }
    if (this.data.blocked === 'not_signed' && item.eventId) go('event-detail', { id: item.eventId });
  },

  /** 现在不能参与时点了按钮：说一句为什么，不能没反应 */
  unavailable() {
    const item = this.data.item;
    if (!item) return true;
    if (!item.open) { toast(copy.closed); return true; }
    if (this.data.blocked) { toast(copy.errors[this.data.blocked] || copy.closed); return true; }
    return false;
  },

  onDraw() {
    if (this.data.spinning || this.unavailable()) return;
    const mine = this.data.mine;
    if (mine && mine.left <= 0) { toast(copy.wheel.noLeft); return; }
    tick();
    this.setData({ spinning: true });
    interact.draw(this.id)
      .then((d) => {
        if (this.disposed) return;
        const rotation = interact.stopAngle(this.segments, d.result, this.data.rotation);
        this.setData({ rotation: rotation });
        this.timer = setTimeout(() => {
          if (this.disposed) return;
          this.setData({ spinning: false, mine: mineView(d.mine) });
          this.showResult(d.result, d.mine);
        }, SPIN_MS);
      })
      .catch((e) => {
        if (this.disposed) return;
        this.setData({ spinning: false });
        const code = e && e.code;
        if (code === 'not_member') { pendingAction.setInteract(this.id); go('join'); return; }
        toast(errorText(e));
        // 互动刚被关掉、次数刚用完、条件刚改过：重读一次，页面跟着变
        if (code === 'closed' || code === 'no_tries' || code === 'not_signed') this.load();
      });
  },

  showResult(result, mine) {
    const w = copy.wheel;
    const left = mine ? mine.left : 0;
    wx.showModal({
      title: result.win ? w.winTitle : w.loseTitle,
      content: result.win ? w.winBody.replace('[奖品]', result.prizeName).replace('[领奖码]', result.code)
        : left > 0 ? w.loseBodyMore.replace('[次数]', left) : w.loseBody,
      showCancel: false,
      confirmText: w.ok
    });
  },

  /** 网页：进 web-view 页面，地址在那边按 id 重新取 */
  onWeb() {
    if (this.unavailable()) return;
    wx.navigateTo({ url: '/pages/webview/index?id=' + this.id });
  },

  /** 其他小程序：必须由点击直接触发，微信会先弹一次确认 */
  onMini() {
    if (this.unavailable()) return;
    const item = this.data.item;
    const target = item.shortLink ? { shortLink: item.shortLink } : { appId: item.appId, path: item.path || '' };
    wx.navigateToMiniProgram(Object.assign(target, {
      fail: (err) => {
        // 用户在微信的确认框里点了取消：不用提示
        if (err && /cancel/.test(String(err.errMsg || ''))) return;
        toast(copy.mini.failed);
      }
    }));
  }
});
