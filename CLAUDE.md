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
- 不要自己造词。产品款名只有「能量胶」和「能量胶PRO」，不用颜色或其他说法指代。品牌卖点的说法是「缓释」，不是「持久」。
- `fuel-plan.js` 是公式的唯一实现，原样复制到小程序里使用，页面只负责输入和展示。要改公式，先改测试，并保持 `node fuel-plan.test.js` 通过。
- 尺寸换算：`rpx = px × 750 ÷ 390`。设计稿里的所有数值都是 390px 宽度下的 px。
- 设计稿里方括号括起来的内容是占位，保留为占位或接数据，不要替换成编造的内容。
- JSON 里带 `confirm` 字段的条目是待品牌方确认的内容，照常实现，但不要删掉 `confirm` 标记。
- 微信的接口和限制（包体积、自定义 tabBar、字体加载、手机号快速验证、订阅消息）以官方文档的现行说明为准，用之前先查，不要凭印象写。
- 后台方案、AppID、主体还没定。做到需要后台的地方（第四阶段的订阅消息、第五阶段的会员）先停下来问，不要自行选型。
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
  pages/<页面>/index.*           home、fuel、events、event-detail、product、me
  components/<组件>/index.*      member-cta、dual-carb 等
  utils/                         assets.js、page.js、store.js、events.js、fuel-plan.js（原样复制，不改）
  content/*.js                   由 reference/content/*.json 生成，不要手改
  assets/icons/                  图标随包；另补了 chevron-*、back-* 两组箭头
tools/
  sync-content.js                改了 reference/content/*.json 之后跑 npm run content
  serve-assets.js                npm run assets：把根目录 assets/ 当 CDN，默认 http://127.0.0.1:8787
  preview/                       本地预览和设计稿对照，见 tools/preview/README.md
```

### 文案和资源

- 页面 JS 里 `require('../../content/xxx.js')` 取文案，用 `withAssets()`（`utils/assets.js`）把其中的 `assets/...` 换成地址后放进 `data`。WXML 里不能调函数，地址都在 JS 里算好。
- 图片、图形、字标、视频一律 `assetUrl('assets/...')`，不放进 `miniprogram/`。只有图标用本地路径 `/assets/icons/<名称>-<颜色>.svg`（navy、blue、lime、grey、white）。
- 设计稿 HTML 里内联的 `<svg>`：先在 `assets/graphics/`、`assets/icons/`、`assets/logo/` 里找对应文件，用 `image` 显示；随数据变化的图形（时间轴、横条等）用 `view` 画。
- content 里没有的文案（按钮名、表头等设计稿上有但 JSON 里没有的字）：以设计稿 HTML 里的原文为准写在 WXML 里。设计稿上也没有的，留方括号占位。

### 样式

- 数值从 `design/html/*.html` 的内联样式里读，换算成 rpx（`px × 750 ÷ 390`，四舍五入到整数）。1px 的线保留 `1px`。
- 盒模型是默认的 `content-box`，和设计稿 HTML 一致：设计稿里写了 `box-sizing: border-box` 的元素照写；设计稿里的 `<button>` 在浏览器里天然是 border-box，换成 `view` 后带边框的要自己加 `box-sizing: border-box`。
- 只用类选择器，类名带页面或组件前缀（如 `.ev-poster__name`）。WXSS 里属性选择器不生效，也不支持带参数的伪类（`:nth-child()`、`:not()`），不要用；`wx:for` 里用 `index` 判断首尾。
- 全局原子类在 `app.wxss`：`sx-num` / `sx-num-700`（Barlow 斜体，只套数字和英文）、`sx-eyebrow`、`sx-grid-bg`、`sx-slant`、`sx-check`、`sx-photo` + `sx-photo__img`（深蓝单色照片）、`sx-pressable` + `hover-class="sx-press"`（按压）、`sx-btn-reset`。
- 可点的元素用 `view` 加 `bindtap`，不用 `button`；只有需要 `open-type` 的地方才用 `button class="sx-btn-reset"`。
- `image` 默认 320×240，必须写宽高或用 `mode="widthFix"` / `heightFix"`。`scroll-view` 横滑时里面套一层 `view` 做 flex 行。
- 自定义组件一律 `options: { styleIsolation: 'apply-shared' }`，wxss 里写 `:host { display: block; }`。

### 状态栏和底部导航

- 全局 `navigationStyle: custom`。每个页面的根节点写 `style="--sx-safe-top: {{safeTop}}px"`，`data` 用 `baseData()`（`utils/page.js`）初始化并在 `onLoad` 里再 `setData(baseData())`。
- 首屏头部：高度写 `calc(设计高度 + var(--sx-safe-top))`，头部里绝对定位的内容 `top` 也加上 `var(--sx-safe-top)`，背景图形贴底。
- 底部导航页（home、fuel、events、me）：根节点加 `sx-tab-page`，`onShow` 里 `selectTab(this, 序号)`。
- 跳转用 `go()`（`utils/page.js`）：`go('fuel')`、`go('join')`、`go('energy-gel')`、`go('energy-gel-pro')`、`go('event-detail', { id })`。

### 动效

- 类在 `app.wxss`：容器是 `sx-in` 或 `sx-wait`，里面要动的元素加 `sx-rise`（入场）、`sx-draw`（从左到右展开）、`sx-grow-x` / `sx-grow-y`（生长）、`sx-pop`；延迟用 `style="animation-delay: .15s"`。持续动效：`sx-float`、`sx-glow`。
- 首屏内容的容器直接写 `sx-in`。首屏以下的分区用 `id="rv-<key>" class="{{seen.key ? 'sx-in' : 'sx-wait'}}"`，在 `onReady` 里 `watchReveal(this, [keys])`，`onUnload` 里调用它返回的函数。
- 弧线图形在 SVG 文件里是「光晕 + 实体」合在一起的，光晕的呼吸动效做不了，保持静止即可。

### 后台相关

- 后台没定。会员、提醒、补给计划统一走 `utils/store.js`（目前只存本机），活动数据走 `utils/events.js`。页面不要直接读写存储，也不要自己加接口。

### 检查

- `npm test`：补给公式测试和 content 同步检查。
- `node tools/preview/shot.js --route pages/<页面>/index --compare design/screens/<截图>.png --out out/<名字>.png`：渲染并和设计稿并排对照，逐张看 `out/*-cmp-N.png`。`--do` 可以先调页面方法走到某个状态。
- 预览只是近似，最终以微信开发者工具和真机为准。
