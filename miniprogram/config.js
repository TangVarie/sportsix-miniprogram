/**
 * 运行配置。
 *
 * assetBase       图片、视频、字体的统一资源前缀，后面直接拼 content 里的 `assets/...` 路径。
 *                 开发时用本地资源服务（仓库根目录 `npm run assets`，并在开发者工具里勾选「不校验合法域名」）。
 *                 上线前把仓库里的 assets/ 传到 CDN 或云存储，换成 https 地址，并把域名加进小程序的合法域名。
 * localBackend    后台方案未定（docs/04-open-items.md）。为 true 时会员、提醒、补给计划只存在本机，
 *                 用来走通页面状态，不是正式实现：不取手机号、不发订阅消息。接后台时改 utils/store.js。
 * subscribeTemplateId  「活动开始提醒」一次性订阅消息的模板 ID，申请后填入。为空时「提醒我」只记在本机。
 * sampleEvents    「即将开始」目前没有真实活动，content/events 里是三种卡片样式的占位示例。
 *                 为 true 时显示这些示例，方便对照设计稿；上线前改成 false 或接真实数据，
 *                 没有活动时「即将开始」分页会隐藏，页面不留方括号占位。
 */
module.exports = {
  assetBase: 'http://127.0.0.1:8787',
  localBackend: true,
  subscribeTemplateId: '',
  sampleEvents: true
};
