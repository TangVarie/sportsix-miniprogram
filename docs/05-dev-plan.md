# 05 开发计划

## 技术约定

- 微信原生小程序（WXML / WXSS / JS），不引入跨端框架。
- 渲染用默认的 WebView 模式。设计里用到 `clip-path`、`mix-blend-mode`、SVG 滤镜，换渲染模式前先确认支持情况。
- 尺寸一律 rpx：`rpx = px × 750 ÷ 390`。
- 自定义底部导航（`tabBar.custom: true` 加根目录 `custom-tab-bar` 组件）。
- 文案不写死在页面里，从 `content/*.json` 读。
- 补给计算直接使用 `reference/fuel-plan.js`，不要重写公式；改动先改测试。

平台规则会变，动手前对照微信官方文档确认：包体积限制、自定义 tabBar、`wx.loadFontFace`、`video` 组件、手机号快速验证组件、订阅消息。

## 建议的目录

```
miniprogram/
  app.js  app.json  app.wxss        全局样式引入 tokens.wxss
  custom-tab-bar/                   四项导航，「补给」凸起
  pages/
    home/                           首页
    fuel/                           分段补给计算
    events/                         活动列表
    event-detail/                   活动详情
    product/                        产品详情，参数 id=energy-gel | energy-gel-pro
    me/                             我的，未注册和已注册两种状态
  components/                       见下
  utils/
    fuel-plan.js                    从 reference/ 原样复制
    fuel-plan.test.js
  content/                          从 reference/content/ 复制
  assets/icons/                     图标随包，其余资源走 CDN
```

组件建议：`sx-button`、`sx-tag`（斜切）、`sx-eyebrow`、`sx-num`（Barlow 数字）、`sx-check`、`sx-section`、`sx-photo`（深蓝单色处理）、`sx-arc`、`sx-timeline`（竖线加圆点）、`sx-segment`、`sx-stepper`、`sx-bars`、`sx-accordion`。

## 阶段

### 第一阶段：骨架和首页

- 建工程、`tokens.wxss`、字体加载、自定义底部导航、四个空页面。
- 把 `assets/` 里的图片、视频、字体传到 CDN 或云存储，统一一个资源前缀。
- 首页全部十二个模块，含动效和赛事卡片横滑、品牌影片。

验收：首页在 iPhone 和安卓各一台真机上与 `design/screens/01-home.png` 对照，模块顺序、文案、颜色一致；底部导航四项可切换。

### 第二阶段：分段补给计算

- 复制 `fuel-plan.js` 和测试，先跑通测试。
- 页面：三组输入、结果卡、时间轴、格子、说明、0 支状态。
- 输入变化即时重算。

验收：`node utils/fuel-plan.test.js` 通过；页面在四种状态下与 `design/screens/02-fuel-*.png` 对照一致；默认输入显示 9 支。

### 第三阶段：产品详情

- 一个页面按 `id` 渲染两款，内容来自 `products.json`。
- 口味切换、Q&A 折叠、图表（图片加遮罩动画或 canvas）。
- 三个两款共用的模块做成组件：直白卖点（`keyPoints`）、场景推荐（`scenes`，底部按钮跳分段补给计算）、产品速选对比（`products.json#compare`，当前产品一列加粗，另一列的表头可点进对应详情）。

验收：两款详情与设计稿对照一致；口味切换后首屏包装前后互换；Q&A 同时只展开一条；速选对比在两款详情里内容相同、加粗列不同。

### 第四阶段：活动

- 活动列表（两个分页）、三种卡片样式、活动详情。
- 「提醒我」接订阅消息：点击时调起授权，成功后置为「已设提醒」。
- 数据先用本地示例，接口形状按 `events.json`。

验收：分页切换、提醒状态变化正常；没有真实活动时页面不留方括号占位（隐藏或显示空状态）。

### 第五阶段：会员

依赖主体、AppID 和后台方案确定。

- 注册：勾选协议，手机号快速验证组件取号，后台换取手机号并建会员。
- 「我的」两种状态；会员卡；我的活动；我的补给计划（保存最近一份）。
- 「保存到我的」：未注册跳注册，注册后回到计算页并保存。

验收：新用户能完成注册并看到会员状态；保存的补给计划在「我的」里显示，点进去能还原输入。

### 第六阶段：上线前

- 把 `04-open-items.md` 里已确认的结论落到文案和素材上；未获确认的内容拿掉。
- 隐私政策、用户协议、订阅消息模板、合法域名。
- 包体积检查、弱网和首屏加载、减少动态效果的开关。

## 接口形状（供后台参考）

```
会员      { openid, phone, memberNo, points, createdAt }
活动      { id, type: '赛事'|'试用装'|'抽奖', title, date, city, venue, quota,
            signupStart, signupEnd, memberSignupStart, cover, intro, status }
报名      { memberId, eventId, createdAt }
提醒      { openid, eventId, templateId, sent }
补给计划  { memberId, input, result, savedAt }
```
