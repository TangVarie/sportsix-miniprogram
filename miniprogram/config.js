/**
 * 运行配置。
 *
 * assetBase       图片、视频、字体的统一资源前缀，后面直接拼 content 里的 `assets/...` 路径。
 *                 开发时用本地资源服务（仓库根目录 `npm run assets`，并在开发者工具里勾选「不校验合法域名」）。
 *                 上线前把仓库里的 assets/ 传到 CDN 或云存储，换成 https 地址，并把域名加进小程序的合法域名。
 * cloudEnv        微信云开发的环境 ID。填了就走云开发：会员、报名、提醒、补给计划、活动都经云函数 api 读写；
 *                 留空时只存在本机，用来在没有云环境时看页面状态（不取手机号、不发订阅消息）。
 *                 部署步骤见 cloudfunctions/README.md。
 * subscribeTemplateId  「活动开始提醒」一次性订阅消息的模板 ID，在公众平台申请后填入。为空时「提醒我」只记在本机。
 * sampleEvents    为 true 时「即将开始」显示 content/events 里三种卡片样式的占位示例，方便对照设计稿；
 *                 为 false 时显示云数据库 events 集合里的活动，没有活动时「即将开始」分页隐藏。上线前改成 false。
 */
module.exports = {
  assetBase: 'http://127.0.0.1:8787',
  cloudEnv: 'cloud1-d1g1u97accc6092f6',
  subscribeTemplateId: '',
  sampleEvents: true
};
