const config = require('./config.js');
const { loadFonts } = require('./utils/fonts.js');
const store = require('./utils/store.js');

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
  }
});
