# 云开发

后台用微信云开发。小程序端只调一个云函数 `api`，数据库集合不对小程序端开放；另有一个定时云函数 `remind` 负责发「活动开始提醒」。

```
cloudfunctions/
  api/       接口：会员、活动、报名、提醒、补给计划
  remind/    定时任务：报名开放后发订阅消息（每 5 分钟检查一次）
```

小程序端的入口是 `miniprogram/utils/cloud.js`（调用）、`utils/store.js`（会员、报名、提醒、计划）、`utils/events.js`（活动）。`miniprogram/config.js` 的 `cloudEnv` 留空时不走云开发，只存本机。

## 部署步骤

前提：小程序已用正式 AppID 注册。手机号一键注册用的是「手机号快速验证组件」，只对**已认证的非个人主体**开放，每次成功调用收费 0.03 元（每个小程序有 1000 次体验额度），以微信官方文档现行说明为准。

1. **换 AppID**：把 `project.config.json` 里的 `appid` 从 `touristappid` 改成正式 AppID。测试号不能用云开发。
2. **开通云开发**：在微信开发者工具里点左上角「云开发」，创建环境，记下环境 ID。
3. **填环境 ID**：`miniprogram/config.js` 的 `cloudEnv` 填上环境 ID。
4. **建集合**：在云开发控制台的数据库里新建五个集合：`members`、`events`、`signups`、`reminders`、`plans`。权限都设成「所有用户不可读写」（只有云函数能读写）。
5. **上传云函数**：在开发者工具的文件树里右键 `cloudfunctions/api` 和 `cloudfunctions/remind`，各选一次「上传并部署：云端安装依赖」。`remind` 再右键选「上传触发器」。
6. **申请订阅消息模板**：在公众平台的「订阅消息」里申请一条「活动开始提醒」类的一次性模板，把模板 ID 填到 `miniprogram/config.js` 的 `subscribeTemplateId`。然后按模板的字段改 `cloudfunctions/remind/template.js`（见下），重新上传 `remind`。
7. **录入活动**：按下面的格式在 `events` 集合里添加活动，再把 `miniprogram/config.js` 的 `sampleEvents` 改成 `false`。

云调用的权限（`phonenumber.getPhoneNumber`、`subscribeMessage.send`）已经写在两个云函数各自的 `config.json` 里，上传时生效，有约 10 分钟缓存。

## 集合

| 集合 | `_id` | 字段 |
|---|---|---|
| `members` 会员 | openid | `openid`、`phone`、`countryCode`、`memberNo`、`points`、`createdAt` |
| `events` 活动 | 自动 | 见下 |
| `signups` 报名 | `openid_活动id` | `openid`、`eventId`、`createdAt` |
| `reminders` 提醒 | `openid_活动id` | `openid`、`eventId`、`templateId`、`sent`、`sentAt`、`error`、`createdAt` |
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

**报名规则目前的做法**：报名要先是会员；从 `memberSignupStart`（没填就用 `signupStart`）到 `signupEnd` 之间可以报；有 `quota` 时不超额；同一个人同一场只算一次。会员优先报名提前多久、试用装和抽奖怎么领怎么开（`docs/04-open-items.md`）定了以后，改 `api/index.js` 的 `signup`。

## 订阅消息的字段

`remind/template.js` 里的 `data` 决定消息内容。字段名（`thing1`、`time2` 这些）由申请到的模板决定，现在写的是示意，**必须按公众平台上该模板的「详细内容」改成实际的字段名**，否则发送会失败。`miniprogramState` 上线后用 `formal`，调试时改成 `developer` 或 `trial`。

提醒的流程：用户点「提醒我」→ 调起订阅授权 → 同意后在 `reminders` 里登记 → 报名开放后 `remind` 发一条并标记 `sent`。一次授权只能发一条；发送失败（用户取消订阅等）会把原因记在 `error` 里，不重试。

## 测试

```bash
node tools/test-cloud.js
```

用内存替身（`tools/cloud-mock.js`）代替 `wx-server-sdk`，检查云函数的业务规则，并把小程序端接到替身上走一遍「保存 → 注册 → 提醒 → 报名」。它不能代替真实环境：手机号换取、订阅消息发送、数据库权限、定时触发器要在开发者工具里用真实的云环境验证。
