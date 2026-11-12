/**
 * 运行配置。
 *
 * assetBase       图片、视频、字体的统一资源前缀，后面直接拼 content 里的 `assets/...` 路径。
 *                 现在是云存储的地址（云开发控制台「存储」里文件下载地址的开头那一段）。
 *                 改了素材要重新上传：npm run cdn 挑出用到的文件，再传到云存储的 assets/ 下。
 *                 想用本地素材调试时，临时改成 'http://127.0.0.1:8787'，在仓库根目录跑 npm run assets，
 *                 并在开发者工具里勾选「不校验合法域名」。
 * cloudEnv        微信云开发的环境 ID。填了就走云开发：会员、报名、提醒、补给计划、活动都经云函数 api 读写；
 *                 留空时只存在本机，用来在没有云环境时看页面状态（不取手机号、不发订阅消息）。
 *                 部署步骤见 cloudfunctions/README.md。
 * subscribeTemplateId  「活动开始提醒」一次性订阅消息的模板 ID，在公众平台申请后填入。为空时「提醒我」只记在本机。
 * sampleEvents    为 true 时「即将开始」显示 content/events 里三种卡片样式的占位示例，方便对照设计稿；
 *                 为 false 时显示云数据库 events 集合里的活动，没有活动时「即将开始」里显示「敬请期待」。正式环境用 false。
 * groupReady      加群的方式（企业微信群、客服二维码）还没定。为 false 时「加入社群」「加入活动群」两个入口不显示；
 *                 定了以后做好对应的页面或弹层，再改成 true。
 */
module.exports = {
  assetBase: 'https://636c-cloud1-d1g1u97accc6092f6-1529732437.tcb.qcloud.la',
  cloudEnv: 'cloud1-d1g1u97accc6092f6',
  subscribeTemplateId: 'APVCkWz7HLHIurWipctjacSf6Ii9nKuLuNuv7JsqrmQ',
  sampleEvents: false,
  groupReady: false,

  // 电脑端运营后台的网址：开通云开发的「静态网站」并上传 web-admin/ 之后，把默认域名填在这里。
  // 只用来显示在小程序的「运营后台 → 电脑端」里，方便复制到电脑上打开。
  webAdminUrl: ''
};
