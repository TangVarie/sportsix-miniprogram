# 云开发

后台用微信云开发（云函数加云数据库）。注意不是「微信云托管」：云托管是部署容器服务的，要 Dockerfile 和端口，这个项目用不到，不要在云托管里发布这个仓库。

小程序端只调一个云函数 `api`，数据库集合不对小程序端开放；另有一个定时云函数 `remind` 负责发「活动开始提醒」。

```
cloudfunctions/
  api/       接口：会员、活动、报名、提醒、补给计划
  remind/    定时任务：报名开放后发订阅消息（每 5 分钟检查一次）
```

小程序端的入口是 `miniprogram/utils/cloud.js`（调用）、`utils/store.js`（会员、报名、提醒、计划）、`utils/events.js`（活动）。`miniprogram/config.js` 的 `cloudEnv` 留空时不走云开发，只存本机。

## 部署步骤

前提：小程序已用正式 AppID 注册。手机号一键注册用的是「手机号快速验证组件」，只对**已认证的非个人主体**开放，每次成功调用收费 0.03 元（每个小程序有 1000 次体验额度），以微信官方文档现行说明为准。

1. **AppID**：`project.config.json` 里已经填了正式 AppID。用这个小程序的管理员或开发者微信登录开发者工具。
2. **开通云开发**：在微信开发者工具里点左上角「云开发」，创建环境，记下环境 ID。
3. **环境 ID**：`miniprogram/config.js` 的 `cloudEnv` 已经填好（`cloud1-d1g1u97accc6092f6`）。
4. **建集合**：在云开发控制台的数据库里新建五个集合：`members`、`events`、`signups`、`reminders`、`plans`。权限都设成「所有用户不可读写」（只有云函数能读写）。
5. **上传云函数**：在开发者工具的文件树里右键 `cloudfunctions/api` 和 `cloudfunctions/remind`，各选一次「上传并部署：云端安装依赖」。`remind` 再右键选「上传触发器」。云函数默认的超时时间很短，在云开发控制台的云函数配置里把 `remind` 调到 60 秒、`api` 调到 10 秒。
6. **申请订阅消息模板**：在公众平台的「订阅消息」里申请一条「活动开始提醒」类的一次性模板，把模板 ID 填到 `miniprogram/config.js` 的 `subscribeTemplateId`。然后按模板的字段改 `cloudfunctions/remind/template.js`（见下），重新上传 `remind`。
7. **录入活动**：按下面的格式在 `events` 集合里添加活动，再把 `miniprogram/config.js` 的 `sampleEvents` 改成 `false`。

云调用的权限（`phonenumber.getPhoneNumber`、`subscribeMessage.send`）已经写在两个云函数各自的 `config.json` 里，上传时生效，有约 10 分钟缓存。

## 资源放到云存储

图片、视频、字体不打进小程序包，开发时由本地的 `npm run assets` 代替。上线前要放到线上，直接用同一个云环境的云存储即可（自带 CDN，基础套餐含 5GB CDN 流量）。

1. 在仓库根目录运行 `npm run cdn`。它把小程序实际用到的 38 个文件（约 7MB）挑到 `out/cdn/assets/` 里，没用到的 720p 原片、多余的字体不带上。
2. 打开云开发控制台的「存储」，把 `out/cdn/` 里的 `assets` 文件夹整个上传到根目录，保持 `assets/` 这一层目录不变。
3. 在「存储」的权限设置里选「所有用户可读，仅创建者可读写」，否则用户的手机加载不了。
4. 点开任意一个上传好的文件，复制它的下载地址，形如 `https://7370-xxxx-1300000000.tcb.qcloud.la/assets/logo/avatar.svg`。取 `/assets/` 前面的那一段，填到 `miniprogram/config.js` 的 `assetBase`，例如 `assetBase: 'https://7370-xxxx-1300000000.tcb.qcloud.la'`。地址后面如果带 `?sign=...` 之类的参数，不要带上。
5. 重新编译，关掉「不校验合法域名」再看一遍：图片、视频、数字字体都应该正常。

图片和视频用的是 `image`、`video` 组件，不需要把这个域名加进小程序后台的服务器域名（那里只管 `wx.request`、上传、下载、WebSocket）。数字字体是用 `wx.loadFontFace` 加载的，要求 https 且允许跨域；如果控制台报字体加载失败，页面会回退成系统字体，不影响使用，把报错发给开发处理。

以后换图：替换云存储里的同名文件即可；新增了资源就重新跑一次 `npm run cdn`，把新增的文件传上去。

## 隐私和协议

- 《用户协议》《隐私政策》的正文在 `reference/content/legal.json`，是按小程序实际收集的信息起草的初稿，**上线前请法务审阅**。文件开头 `fill` 里的四项（运营主体全称、联系方式、生效日期、管辖地）现在是方括号占位，填一次，正文里会自动替换。改完运行 `npm run content`。
- 微信要求在小程序后台配置《用户隐私保护指引》（「账号设置 → 服务内容声明 → 用户隐私保护指引」），只有在里面声明过的信息才能调用对应的接口。本小程序要声明**手机号**（用途：会员注册）。提审时这份指引要和 `legal.json` 里的隐私政策一致。
- 注册按钮是 `open-type="getPhoneNumber|agreePrivacyAuthorization"`：用户勾选协议后点它，既向微信表明已同意隐私政策，又发起手机号授权。
- 以后如果新增收集的信息（头像昵称、位置等），三处要一起改：`legal.json`、小程序后台的指引、对应的授权流程。

## 集合

| 集合 | `_id` | 字段 |
|---|---|---|
| `members` 会员 | openid | `openid`、`phone`、`countryCode`、`memberNo`、`points`、`createdAt` |
| `events` 活动 | 自动 | 见下 |
| `signups` 报名 | `openid_活动id` | `openid`、`eventId`、`token`（写入时的请求标记）、`createdAt` |
| `reminders` 提醒 | `openid_活动id` | `openid`、`eventId`、`templateId`、`sent`、`status`（`sending` / `sent` / `failed`）、`claimedAt`、`sentAt`、`error`、`createdAt` |
| `plans` 补给计划 | openid | `openid`、`input`（公式的八项输入）、`result`（支数摘要）、`savedAt` |

会员编号和积分的规则还没定：注册时 `memberNo` 留空、`points` 为 0。`memberNo` 为空时页面上保持占位，规则定了以后在这里补发号逻辑。

小程序端拿到的手机号是打码后的（`138****1234`），完整手机号只存在 `members` 里。

## 活动怎么填

第一版直接在云开发控制台改 `events` 集合。时间字段的类型选「date」。

| 字段 | 类型 | 说明 |
|---|---|---|
| `type` | string | `赛事`、`试用装`、`抽奖`，决定卡片样式 |
| `title` | string | 活动名称 |
| `status` | string | `published` 才会显示；其他值（如 `draft`）不显示 |
| `date` | date | 活动日期和时间。过了一天以后自动从「即将开始」里消失 |
| `city`、`venue` | string | 城市、场地 |
| `quota` | number | 名额上限。不填就不限 |
| `quotaText` | string | 名额的显示文字（如「限 200 份」）。不填就显示 `quota` 的数字 |
| `signupStart`、`signupEnd` | date | 报名起止时间 |
| `memberSignupStart` | date | 会员提前报名的开始时间。填了卡片上才显示「会员优先报名」，提醒也按这个时间发 |
| `drawAt` | date | 开奖时间（抽奖用） |
| `cover` | string | 头图。云存储的 fileID（`cloud://...`）或 https 地址；不填用默认配图 |
| `intro` | string | 活动介绍 |
| `signupCount` | number | 已报名人数，由云函数维护，不用手填 |

活动没有提供的项，页面上不显示，不会留方括号占位。

**报名规则目前的做法**：报名要先是会员；从 `memberSignupStart`（没填就用 `signupStart`）到 `signupEnd` 之间可以报；有 `quota` 时不超额；同一个人同一场只算一次。名额是先占后写报名记录，中途出错时 `signupCount` 只会偏多不会偏少，最坏情况是空出一个名额，不会超额。会员优先报名提前多久、试用装和抽奖怎么领怎么开（`docs/04-open-items.md`）定了以后，改 `api/index.js` 的 `signup`。

## 订阅消息的字段

`remind/template.js` 里的 `data` 决定消息内容。字段名（`thing1`、`time2` 这些）由申请到的模板决定，现在写的是示意，**必须按公众平台上该模板的「详细内容」改成实际的字段名**，否则发送会失败。`miniprogramState` 上线后用 `formal`，调试时改成 `developer` 或 `trial`。

提醒的流程：用户点「提醒我」→ 调起订阅授权 → 同意后在 `reminders` 里登记 → 报名开放后 `remind` 先把记录标成 `sent: true`、`status: 'sending'`（领取），再发送，发完记成 `sent` 或 `failed`。一次授权只能发一条，所以宁可漏发不重发：发送失败（用户取消订阅等）会把原因记在 `error` 里，不重试；如果执行中途中断，记录会停在 `sending`，也不会自动重发，可以在数据库里按 `status` 查出来。一次执行最多发 300 条，多出来的下一次接着发。

## 测试

```bash
node tools/test-cloud.js
```

用内存替身（`tools/cloud-mock.js`）代替 `wx-server-sdk`，检查云函数的业务规则，并把小程序端接到替身上走一遍「保存 → 注册 → 提醒 → 报名」。它不能代替真实环境：手机号换取、订阅消息发送、数据库权限、定时触发器要在开发者工具里用真实的云环境验证。
