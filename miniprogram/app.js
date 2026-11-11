const config = require('./config.js');
const { assetUrl } = require('./utils/assets.js');
const store = require('./utils/store.js');

// 数字和英文用 Barlow Condensed，只加载设计里用到的字重：斜体 700 / 800，以及补给时刻格子里的正体 700。中文用系统字体。
const FONTS = [
  { style: 'italic', weight: '700', file: 'assets/fonts/barlow-condensed-latin-700-italic.woff2' },
  { style: 'italic', weight: '800', file: 'assets/fonts/barlow-condensed-latin-800-italic.woff2' },
  { style: 'normal', weight: '700', file: 'assets/fonts/barlow-condensed-latin-700-normal.woff2' }
];

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
    this.loadFonts();
    // 配了云环境时，用云端的会员、计划、提醒、报名覆盖本机缓存；完成后页面会收到通知重读
    store.sync();
  },

  loadFonts() {
    FONTS.forEach((f) => {
      wx.loadFontFace({
        global: true,
        family: 'Barlow Condensed',
        source: 'url("' + assetUrl(f.file) + '")',
        desc: { style: f.style, weight: f.weight },
        // 加载失败时回退到系统字体，不影响使用
        fail: () => {}
      });
    });
  }
});
