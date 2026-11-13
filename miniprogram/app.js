const config = require('./config.js');
const { loadFonts } = require('./utils/fonts.js');
const store = require('./utils/store.js');
const messages = require('./content/messages.js');
const adminCopy = require('./content/admin.js');

App({
  globalData: {
    config: config,
    /** 状态栏高度（px）。页面用的是自定义导航，首屏内容要让出这一段。 */
    safeTop: 0,
    /** 是不是从朋友圈打开的单页模式：不能跳转、没有底部导航、云开发不能用 */
    singlePage: false,
    /** 「我的」里点补给计划、或注册后回到计算页时置为 true，计算页 onShow 时按已保存的输入还原，然后清掉。 */
    fuelRestore: false
  },

  onLaunch(options) {
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.globalData.safeTop = info.statusBarHeight || 0;
    } catch (e) {
      this.globalData.safeTop = 0;
    }
    // 从朋友圈打开的是「单页模式」（场景值 1154）：微信在页面上方固定放一条导航栏，页面从它下面开始排
    // （页面 json 里的 singlePage.navigationBarFit: squeezed），所以不用再让出状态栏
    if (options && options.scene === 1154) {
      this.globalData.singlePage = true;
      this.globalData.safeTop = 0;
    }
    // 数字和英文用的 Barlow Condensed（utils/fonts.js）
    loadFonts();
    // 配了云环境时，用云端的会员、计划、提醒、报名覆盖本机缓存；完成后页面会收到通知重读
    this.refresh();
    this.watchUpdate();
  },

  /**
   * 发了新版本以后，微信要到用户下一次「冷启动」才换上新代码，常用的人可能好几天都停在旧版本。
   * 这里在新版本下载好时问一句，点了就立刻重启换上。
   */
  watchUpdate() {
    try {
      if (!wx.getUpdateManager) return;
      const manager = wx.getUpdateManager();
      manager.onUpdateReady(() => {
        wx.showModal({
          title: messages.update.title, content: messages.update.content, confirmText: messages.update.confirm, showCancel: false,
          success: () => manager.applyUpdate()
        });
      });
    } catch (e) { /* 取不到更新管理器不影响使用 */ }
  },

  /**
   * 小程序从后台回到前台：隔了一阵子就再同步一次，新发的公告这时候就能弹出来。
   * 不然常用的人一直是「热启动」，要等到下一次冷启动才看得到公告。
   */
  onShow() {
    if (this.globalData.singlePage || !this.lastSync) return;
    if (Date.now() - this.lastSync > 5 * 60 * 1000) this.refresh();
  },

  /** 用云端数据覆盖本机缓存，顺带取公告 */
  refresh() {
    this.lastSync = Date.now();
    return store.sync().then(() => this.showInbox()).then(() => this.showNotice());
  },

  /**
   * 给这位用户的站内消息（报名被取消、活动取消）：逐条弹出来，点了「知道了」才算看过。
   * 都看完以后再往下走（弹公告），两个弹窗不会叠在一起。
   */
  showInbox() {
    const list = store.takeInbox();
    return list.reduce((done, m) => done.then(() => new Promise((resolve) => {
      wx.showModal({
        title: m.title,
        content: m.content,
        showCancel: false,
        confirmText: messages.inbox.confirm,
        success: () => { store.readInbox([m.id]); resolve(); },
        fail: () => resolve()
      });
    })), Promise.resolve());
  },

  /** 运营在后台设了公告：打开小程序时弹一次。同一条公告在这台手机上不弹第二次 */
  showNotice() {
    const n = store.unseenNotice();
    if (!n) return;
    wx.showModal({
      title: n.title || adminCopy.notice.defaultTitle,
      content: n.content,
      showCancel: false,
      confirmText: adminCopy.notice.confirm,
      success: () => store.markNoticeSeen(n.version)
    });
  },

  /** 要打开的页面不存在（比如别人转发的是旧版本里的页面）：回到首页，不留一张「页面不存在」 */
  onPageNotFound() {
    wx.switchTab({ url: '/pages/home/index' });
  }
});
