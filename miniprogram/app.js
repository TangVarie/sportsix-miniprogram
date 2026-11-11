const config = require('./config.js');
const { loadFonts } = require('./utils/fonts.js');
const store = require('./utils/store.js');
const messages = require('./content/messages.js');

App({
  globalData: {
    config: config,
    /** 状态栏高度（px）。页面用的是自定义导航，首屏内容要让出这一段。 */
    safeTop: 0,
    /** 「我的」里点补给计划、或注册后回到计算页时置为 true，计算页 onShow 时按已保存的输入还原，然后清掉。 */
    fuelRestore: false
  },

  onLaunch() {
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.globalData.safeTop = info.statusBarHeight || 0;
    } catch (e) {
      this.globalData.safeTop = 0;
    }
    // 数字和英文用的 Barlow Condensed（utils/fonts.js）
    loadFonts();
    // 配了云环境时，用云端的会员、计划、提醒、报名覆盖本机缓存；完成后页面会收到通知重读
    store.sync();
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

  /** 要打开的页面不存在（比如别人转发的是旧版本里的页面）：回到首页，不留一张「页面不存在」 */
  onPageNotFound() {
    wx.switchTab({ url: '/pages/home/index' });
  }
});
