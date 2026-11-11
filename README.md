# SPORTSIX 微信小程序

SPORTSIX 小程序做三件事：品牌和产品介绍、活动通知、会员沉淀。不做商城。

这个仓库里有两部分：小程序工程（`miniprogram/`、`tools/`），和设计交接包的原件（`docs/`、`design/`、`reference/`、`assets/`、`CLAUDE.md`）。

## 运行

1. 起本地资源服务。图片、视频、字体不打进包，开发时由它代替 CDN：

```bash
npm run assets
```

2. 用微信开发者工具导入仓库根目录（`project.config.json` 已把小程序目录指到 `miniprogram/`，AppID 暂用测试号）。在「详情 → 本地设置」里勾选「不校验合法域名」，否则本地资源加载不出来。

改了 `reference/content/*.json` 之后跑 `npm run content`，把文案同步到 `miniprogram/content/`。

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm test` | 补给公式测试、文案是否已同步、工程自检（页面文件、图标和资源路径、WXSS 禁用写法） |
| `npm run content` | 由 `reference/content/*.json` 生成 `miniprogram/content/*.js` |
| `npm run assets` | 本地资源服务，`http://127.0.0.1:8787/assets/...` |
| `npm run size` | 包体积检查（单包上限 2M） |
| `npm run shot -- --route pages/home/index --compare design/screens/01-home.png` | 不开开发者工具，渲染页面并和设计稿并排对照，见 `tools/preview/README.md` |

## 上线前要换掉的配置

都在 `miniprogram/config.js` 和 `project.config.json`：

- `assetBase`：把 `assets/` 传到 CDN 或云存储，换成 https 地址，域名加进小程序的合法域名。
- `localBackend`：现在会员、提醒、补给计划只存在本机，用来走通页面状态。后台方案定了以后改 `miniprogram/utils/store.js` 和 `utils/events.js`。
- `subscribeTemplateId`：「活动开始提醒」订阅消息模板 ID。
- `sampleEvents`：现在显示的是三种活动卡片的占位示例，上线前关掉或接真实活动。
- `appid`：现在是测试号。

工程约定（目录、样式、动效、状态栏等）写在 `CLAUDE.md` 末尾。

---

以下是交接包原来的说明。

## 交接包

给开发用的全部材料：设计稿、素材、文案、补给公式和开发计划。小程序范围是介绍、活动通知、会员沉淀，不含商城。

### 怎么用

把整个文件夹放进工程目录，让 Claude Code 从 `CLAUDE.md` 开始读，按 `docs/05-dev-plan.md` 的阶段顺序做。第一到第三阶段（首页、分段补给计算、产品详情）不依赖后台，可以直接开工；第四阶段的订阅消息和第五阶段的会员需要先定主体、AppID 和后台方案。

### 目录

```
CLAUDE.md                 给 Claude Code 的项目说明和规则
README.md                 本文件
docs/
  01-product-plan.md      定位、页面清单、每页交互、数据来源
  02-design-spec.md       颜色、字体、组件、动效、小程序实现提示
  03-fuel-formula.md      分段补给计算的公式和依据
  04-open-items.md        待确认事项，按负责方分组
  05-dev-plan.md          技术约定、目录、分阶段任务和验收
design/
  screens/                15 张页面截图（2 倍图，设计宽度 390px）
  html/                   同样 15 个状态的静态页面，取精确样式用
  canvas-source/          设计画板源文件，含交互原型的状态逻辑
  tokens.wxss             颜色、字号等变量，可直接引入
  tokens.json             同上，JSON 格式
reference/
  fuel-plan.js            补给公式，纯函数，无依赖
  fuel-plan.test.js       公式测试：node reference/fuel-plan.test.js
  content/                四份文案和数据：home、products、events、member
assets/
  logo/                   字标、WIN YOUR DAY、方形头像
  product/                六款产品包装图（透明底）
  photos/endorsement/     厂房和四场赛事照片（品牌方素材）
  photos/web/             五张网图和来源说明
  video/                  品牌影片（540p、720p 原片、封面）
  fonts/                  Barlow Condensed（数字和英文用）及授权文件
  icons/                  21 个图标 × 5 种颜色
  graphics/               15 个自绘图形：弧线、曲线图、雷达图、分子示意等
```

### 页面和截图对应

| 页面 | 截图 |
|---|---|
| 首页（介绍） | `01-home.png` |
| 分段补给计算 | `02-fuel-*.png`：默认、越野 10 小时且咖啡因敏感、徒步、不用带胶 |
| 能量胶详情 | `03-product-energy-gel.png`、切换到桃子味的状态 |
| 能量胶PRO 详情 | `04-product-energy-gel-pro.png` |
| 活动列表 | `05-events-*.png`：即将开始、已设提醒、往期 |
| 活动详情 | `06-event-detail.png` |
| 我的（未注册） | `07-me-not-registered.png` |
| 我的（已注册） | `08-me-member.png` |
| 色值与图形 | `09-tokens.png` |

设计画板在线版：https://claude.ai/artifact/JBo9ZNcWpVa9XBcJaAPEeW

### 上线前必须解决的

详见 `docs/04-open-items.md`。最要紧的几条：

- 「缓释」「超低渗」能否对外宣称，以及沿用自电商页的功效说法。
- 品牌影片里有艺人正脸，需要品牌和法务确认能否使用。
- 补给公式的五处取值需要品牌方确认。
- 活动、积分、会员编号目前是占位。
- 主体、AppID、后台方案未定。
