# 本地预览

微信开发者工具只有 Windows 和 macOS 版。这个目录里是一个很小的替身：把 WXML / WXSS / 页面 JS 渲染成普通 HTML，用无头浏览器截图，并和 `design/screens/` 里的设计稿并排对照。写页面时用它快速检查布局、文案和状态。

它只是近似，不能代替开发者工具和真机：内置组件的行为、`wx.*` 接口、字体、安全区、原生组件层级都以真实环境为准。

## 用法

```bash
node tools/preview/shot.js --route pages/events/index --out out/events.png --compare design/screens/05-events-upcoming.png
```

| 参数 | 说明 |
|---|---|
| `--route` | 页面路径，同 `app.json` 里的写法 |
| `--query "id=energy-gel"` | 页面参数 |
| `--do "tap('onTab', { tab: 'past' })"` | 渲染前执行的 JS，用来走到某个状态。可用 `page`（页面实例）、`tap(方法名, dataset, detail)`、`wx`、`app` |
| `--storage '{"sx_member":{"createdAt":1}}'` | 预置本地存储 |
| `--compare <设计稿.png>` | 另外生成并排对照图 `*-cmp-N.png`：左设计稿、右渲染结果，都是 390px 宽 |
| `--slice 1400` | 对照图每张的高度 |
| `--html out/x.html` | 另存渲染出的 HTML |
| `--motion` | 不关闭动效。默认按「减少动态效果」渲染，得到静止的最终状态 |

需要 Node 和 Playwright（带 Chromium）。脚本会自己在 `config.js` 的 `assetBase` 端口上起资源服务。

## 支持范围

- WXML：`{{ }}`、`wx:if / elif / else`、`wx:for`、`block`、`template / import / include`、`slot`。不支持 WXS。
- 组件：`properties`、`data`、`methods`、`observers`、`lifetimes`、`behaviors`、`usingComponents`、`:host`。事件不会触发，状态用 `--do` 直接调页面方法。
- WXSS：`rpx` 按 390px 设计宽度换算；标签选择器和 `page` 会改写成对应的元素。组件样式不做隔离。
- `wx.*`：只有页面会用到的一小部分，见 `runtime.js`。`createIntersectionObserver` 会立即回调「已进入视口」。状态栏高度按 0 处理，和设计稿一致。
- 中文字体用 Noto Sans SC（设计稿绘制时的字体），真机上是系统字体。
