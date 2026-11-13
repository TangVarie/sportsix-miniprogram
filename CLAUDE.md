# SPORTSIX 微信小程序

SPORTSIX 是韩国大象集团旗下的运动营养品牌，主推两款能量胶。这个小程序做三件事：品牌和产品介绍、活动通知、会员沉淀。不做商城。

设计已经定稿，你的任务是按设计稿和开发计划把小程序写出来。

## 先读

1. `docs/05-dev-plan.md`：技术约定、目录、分阶段任务和验收标准。按阶段顺序做。
2. `docs/01-product-plan.md`：页面清单、每页的交互、数据来源。
3. `docs/02-design-spec.md`：颜色、字体、字号、组件、动效、小程序里的实现注意点。
4. `docs/03-fuel-formula.md`：分段补给计算的公式说明。
5. `docs/04-open-items.md`：还没定的事。遇到这里列出的问题，不要自己决定。

## 东西在哪

| 要什么 | 去哪找 |
|---|---|
| 每个页面长什么样 | `design/screens/*.png`（2 倍图，设计宽度 390px） |
| 精确的尺寸、颜色、字号、间距 | `design/html/*.html`（内联样式的静态页面，浏览器打开即可查看） |
| 交互逻辑的原型 | `design/canvas-source/*.dc.html`（设计画板源文件，底部的 script 是状态逻辑，仅作参考） |
| 颜色、字号等变量 | `design/tokens.wxss`、`design/tokens.json` |
| 页面文案和数据 | `reference/content/*.json` |
| 补给公式 | `reference/fuel-plan.js`、`reference/fuel-plan.test.js` |
| 图片、图形、图标、字体、视频 | `assets/` |

## 规则

- 文案一律用 `reference/content/*.json` 里的原文，不要改写、补写或自己编文案。缺文案就留方括号占位并在回复里说明。
- 不要自己造词。产品款名只有「能量胶BASIC」和「能量胶PRO」（地方小时简写 BASIC、PRO），不用颜色、「含咖款」这类说法指代。「能量胶」只作品类的统称（「其他能量胶」「新手吃胶」），不指其中某一款。别的品牌的胶写「其他胶」。品牌卖点的说法是「缓释」，不是「持久」。
- `fuel-plan.js` 是公式的唯一实现，原样复制到小程序里使用，页面只负责输入和展示。要改公式，先改测试，并保持 `node fuel-plan.test.js` 通过。
- 尺寸换算：`rpx = px × 750 ÷ 390`。设计稿里的所有数值都是 390px 宽度下的 px。
- 写给用户看的字要互相对得上，也要像人说的话：
  - 量词一律用「支」，不用条、包、袋；能量单位用「千卡」，不用大卡。
  - 入口按钮叫「手机号快捷登录」，结果提示说「加入」「登录」，不说「注册」；积分说「新会员送 500 积分」。
  - 产品页上的数字要和补给计算的结果对得上（全马带几支、能量胶PRO 食用指南的间隔）。改一处，查另一处；`fuel-plan.test.js` 里有对应的用例。
  - 句子里不用冒号、破折号和「不仅…更是…」这类句式，数字范围写「到」；不用全链路、矩阵这类词。标签式的「规格：…」「单位：…」不算。
- 设计稿里方括号括起来的内容是占位，保留为占位或接数据，不要替换成编造的内容。
- JSON 里带 `confirm` 字段的条目是待品牌方确认的内容，照常实现，但不要删掉 `confirm` 标记。
- 微信的接口和限制（包体积、自定义 tabBar、字体加载、手机号快速验证、订阅消息）以官方文档的现行说明为准，用之前先查，不要凭印象写。
- 后台已定为微信云开发（见「工程约定」）。会员权益规则、积分怎么兑换、加群方式等见 `docs/04-open-items.md`，仍然不要自己决定。已定的：会员编号按注册先后发，从 100001 起；昵称由用户自己填、可以改；注册送 500 积分。
- 图片、视频、字体不要打进主包，按 `05-dev-plan.md` 走统一的资源前缀；图标可以随包。
- 中文字体用系统字体，不加载中文字库。只有数字和英文加载 Barlow Condensed。

## 每个阶段做完后

- 对照 `design/screens/` 里对应的截图检查，说明哪些地方与设计稿不一致以及原因。
- 跑一遍 `fuel-plan.test.js`（第二阶段起）。
- 列出这一阶段里留下的占位和待确认项。

## 工程约定

工程已经建好，下面是写页面时要遵守的做法。交接包原样放在仓库根目录（`docs/`、`design/`、`reference/`、`assets/`），小程序代码在 `miniprogram/`。

### 目录

```
miniprogram/
  app.js  app.json  app.wxss     全局样式：styles/tokens.wxss 加几个原子类和动效类
  config.js                      资源前缀 assetBase、本机后台开关等
  custom-tab-bar/                自定义底部导航
  pages/<页面>/index.*           home、fuel、events、event-detail、product、me、points（积分）、doc（用户协议和隐私政策）、
                                 admin、admin-event 和 admin-signups（运营后台，只有管理员能进）
  components/<组件>/index.*      member-cta、dual-carb 等
  utils/                         assets.js、page.js、fonts.js、cloud.js、store.js、events.js、format.js、admin.js（运营后台的接口）、fuel-plan.js（原样复制，不改）
  content/*.js                   由 reference/content/*.json 生成，不要手改
  assets/icons/                  图标随包；另补了 chevron-*、back-* 两组箭头
cloudfunctions/
  api/                           云函数：会员、活动、报名、提醒、补给计划的接口
  remind/                        定时云函数：报名开放后发订阅消息；运营点了「通知」的活动，发新活动通知
web-admin/
  index.html                     电脑端运营后台：一个网页，传到云开发的静态网站上用。文字直接写在这个文件里
tools/
  sync-content.js                改了 reference/content/*.json 之后跑 npm run content
  serve-assets.js                npm run assets：把根目录 assets/ 当 CDN，默认 http://127.0.0.1:8787
  pack-assets.js                 npm run cdn：把用到的资源挑到 out/cdn/assets/，用来上传到云存储
  preview/                       本地预览和设计稿对照，见 tools/preview/README.md
  cloud-mock.js  test-cloud.js   wx-server-sdk 的内存替身和云开发测试
  test-web-admin.js              npm run test:web：用浏览器打开电脑端后台，接到替身上走一遍（需要 Playwright）
```

### 文案和资源

- 页面 JS 里 `require('../../content/xxx.js')` 取文案，用 `withAssets()`（`utils/assets.js`）把其中的 `assets/...` 换成地址后放进 `data`。WXML 里不能调函数，地址都在 JS 里算好。
- 图片、图形、字标、视频一律 `assetUrl('assets/...')`，不放进 `miniprogram/`。只有图标用本地路径 `/assets/icons/<名称>-<颜色>.svg`（navy、blue、lime、grey、white）。
- 设计稿 HTML 里内联的 `<svg>`：先在 `assets/graphics/`、`assets/icons/`、`assets/logo/` 里找对应文件，用 `image` 显示；随数据变化的图形（时间轴、横条等）用 `view` 画。
- content 里没有的文案（按钮名、表头等设计稿上有但 JSON 里没有的字）：以设计稿 HTML 里的原文为准写在 WXML 里。设计稿上也没有的，留方括号占位。
- 操作结果的提示语（保存、注册、报名的成功和失败）在 `reference/content/messages.json`，协议正文在 `legal.json`，这两份不是交接包原有的，是开发时补的。

### 样式

- 数值从 `design/html/*.html` 的内联样式里读，换算成 rpx（`px × 750 ÷ 390`，四舍五入到整数）。1px 的线保留 `1px`。
- 盒模型是默认的 `content-box`，和设计稿 HTML 一致：设计稿里写了 `box-sizing: border-box` 的元素照写；设计稿里的 `<button>` 在浏览器里天然是 border-box，换成 `view` 后带边框的要自己加 `box-sizing: border-box`。
- 只用类选择器，类名带页面或组件前缀（如 `.ev-poster__name`）。WXSS 里属性选择器不生效，也不支持带参数的伪类（`:nth-child()`、`:not()`），不要用；`wx:for` 里用 `index` 判断首尾。
- 全局原子类在 `app.wxss`：`sx-num` / `sx-num-700`（Barlow 斜体，只套数字和英文）、`sx-eyebrow`、`sx-grid-bg`、`sx-slant`、`sx-check`、`sx-photo` + `sx-photo__img`（深蓝单色照片）、`sx-pressable` + `hover-class="sx-press"`（按压）、`sx-btn-reset`。
- 上下相邻的深色块共用一个 `sx-grid-bg` 容器（如首页的 `hm-top`），不要每块各铺一层：网格从各自的顶边起算，接缝处对不齐会多出一道横线。
- 可点的元素用 `view` 加 `bindtap`，不用 `button`；只有需要 `open-type` 的地方才用 `button class="sx-btn-reset"`。
- `image` 默认 320×240，必须写宽高或用 `mode="widthFix"` / `heightFix"`。`scroll-view` 横滑时里面套一层 `view` 做 flex 行。
- 自定义组件一律 `options: { styleIsolation: 'apply-shared' }`，wxss 里写 `:host { display: block; }`。

### 状态栏和底部导航

- 全局 `navigationStyle: custom`。每个页面的根节点写 `style="--sx-safe-top: {{safeTop}}px"`，`data` 用 `baseData()`（`utils/page.js`）初始化并在 `onLoad` 里再 `setData(baseData())`。
- 首屏头部：高度写 `calc(设计高度 + var(--sx-safe-top))`，头部里绝对定位的内容 `top` 也加上 `var(--sx-safe-top)`，背景图形贴底。
- 底部导航页（home、fuel、events、me）：根节点加 `sx-tab-page`，`onShow` 里 `selectTab(this, 序号)`。
- 每个页面都要写 `onShareAppMessage() { return shareCard(路径, 标题); }`（`utils/page.js`），否则右上角菜单里的「转发」是灰的；`npm test` 会检查。会员页有个人信息，注册后用 `wx.hideShareMenu` 收起转发。「分享到朋友圈」只开了首页和产品页（`onShareTimeline` 加页面 json 里的 `singlePage`），其他页面依赖跳转或云开发，单页模式下用不了。
- 跳转用 `go()`（`utils/page.js`）：`go('fuel')`、`go('join')`、`go('energy-gel')`、`go('energy-gel-pro')`、`go('event-detail', { id })`、`go('points')`、`go('admin')`、`go('admin-event', { id })`、`go('admin-signups', { id })`、`go('doc', { type: 'agreement' | 'privacy' })`。

### 动效

- 类在 `app.wxss`：容器是 `sx-in` 或 `sx-wait`，里面要动的元素加 `sx-rise`（入场）、`sx-draw`（从左到右展开）、`sx-grow-x` / `sx-grow-y`（生长）、`sx-pop`；延迟用 `style="animation-delay: .15s"`。持续动效：`sx-float`、`sx-glow`。
- 首屏内容的容器直接写 `sx-in`。首屏以下的分区用 `id="rv-<key>" class="{{seen.key ? 'sx-in' : 'sx-wait'}}"`，在 `onReady` 里 `watchReveal(this, [keys])`，`onUnload` 里调用它返回的函数。
- 弧线图形在 SVG 文件里是「光晕 + 实体」合在一起的，光晕的呼吸动效做不了，保持静止即可。
- 照片和产品图加载完再淡入：节点写 `class="... sx-img-fade {{loaded.key ? '' : 'sx-img-wait'}}" data-img="key" bindload="onImgLoad" binderror="onImgLoad"`，页面上写 `onImgLoad(e) { imgLoaded(this, e); }`（`utils/page.js`）。已经带 `sx-draw` 等动效类的图形不要加。
- 列表在等云端数据时用 `sx-skeleton` 占位块；点选、加减这类操作调 `tick()` 轻震一下。

### 后台相关

- 后台用微信云开发，说明和部署步骤见 `cloudfunctions/README.md`。`config.js` 的 `cloudEnv` 留空时不走云开发，只存本机。
- 小程序端只调一个云函数 `api`（`utils/cloud.js` 的 `call(action, data)`），数据库集合不对小程序端开放。加接口时在 `cloudfunctions/api/index.js` 的 `actions` 里加，并在 `tools/test-cloud.js` 里补用例。
- 会员、报名、提醒、新活动通知、补给计划统一走 `utils/store.js`：读是同步的（读本机缓存），写返回 Promise；进入小程序时 `store.sync()` 用云端数据覆盖缓存，页面用 `store.onChange()` 订阅后重读。活动数据走 `utils/events.js`。页面不要直接读写存储或调云函数。
- 往期的赞助赛事存在云端（`past_events` 集合），运营在后台增删改，页面经 `utils/events.js` 的 `listPast()` / `refreshPast()` 读。`reference/content/events.json` 的 `past` 是初始的那几场，和 `api/index.js` 的 `PAST_SEED` 是同一份，改一处要改另一处（`npm test` 会核对）。
- 报名可以用积分（活动上的 `cost`）。会员不能自己取消，运营在名单页取消报名或取消整场活动，退积分并通知：一条站内消息（`inbox` 集合，进小程序时由 `app.js` 的 `showInbox` 弹出），报名时同意了订阅的再发一条订阅消息。订阅不能当成报名的条件。`cloudfunctions/api/template.js` 和 `remind/template.js` 是同一份，改一处要改另一处（`npm test` 会核对）。
- 首页的赞助赛事只显示往期里 `home` 不是 `false` 的那些。
- 时间在云端存时间戳，显示格式统一用 `utils/format.js`。
- 购买渠道：小程序自己不卖东西，`components/shop-entry` 把人带到店铺小程序里对应的商品（首页产品卡片下面、产品详情页底部、「我的」菜单）。文案和两款产品的小程序链接在 `reference/content/shop.json`；某一款的链接留空，这款就不显示购买入口。
- 运营后台：页面只经过 `utils/admin.js` 调云函数；云函数里 `admin` 开头的接口第一句都是 `await requireAdmin(openid)`，新加的后台接口照做，并在 `tools/test-cloud.js` 的 `adminTests` 里测「普通会员调不通」。后台的文字在 `reference/content/admin.json`。
- 电脑端后台（`web-admin/index.html`）没有微信身份，调的也是 `api`。新加的后台接口要让网页能用，把名字加进 `api/index.js` 的 `WEB_ACTIONS`；不在这个名单里的接口，没有微信身份一律调不通，不要为了省事放宽。改了网页跑 `npm run test:web`。

### 只有真机和审核才会暴露的事

本地预览看不到这些，写新页面、新按钮时逐条过一遍：

- 页面要有 `onShareAppMessage` 和 `navigationBarTitleText`（`npm test` 会检查）。
- 按钮在「现在不能用」的时候点了要有提示，不能没反应（没勾选协议点注册、订阅消息被拒绝后点提醒）。
- 给用户看的地方不能露出方括号占位；没有数据就不显示或显示「—」。
- 调用手机号验证的页面上不能出现「微信」字样和微信的图标。
- 页面顶部右侧留给微信的胶囊按钮，内容不要伸到那里；有个人信息的页面不让转发。
- 发新版本后靠 `app.js` 的 `watchUpdate` 提示重启；页面路径改了，旧的转发卡片由 `onPageNotFound` 兜到首页。

### 检查

- `npm test`：补给公式测试、content 同步检查、工程自检（`tools/check-project.js`）、云开发测试（`tools/test-cloud.js`）。
- `node tools/preview/shot.js --route pages/<页面>/index --compare design/screens/<截图>.png --out out/<名字>.png`：渲染并和设计稿并排对照，逐张看 `out/*-cmp-N.png`。`--do` 可以先调页面方法走到某个状态。
- 预览只是近似，最终以微信开发者工具和真机为准。
