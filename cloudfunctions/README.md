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
4. **建集合**：在云开发控制台的数据库里新建五个集合：`members`、`events`、`signups`、`reminders`、`plans`。权限都设成「所有用户不可读写」（只有云函数能读写）。另有一个 `counters` 集合（存下一个会员编号）不用手动建，第一位会员注册时云函数会自己建；建好后可以在控制台把它的权限也改成「所有用户不可读写」。
5. **上传云函数**：在开发者工具的文件树里右键 `cloudfunctions/api` 和 `cloudfunctions/remind`，各选一次「上传并部署：云端安装依赖」。`remind` 再右键选「上传触发器」。云函数默认的超时时间很短，在云开发控制台的云函数配置里把 `remind` 调到 60 秒、`api` 调到 10 秒。
6. **订阅消息模板**：已申请公共模板「活动动态通知」，模板 ID 已填在 `miniprogram/config.js` 的 `subscribeTemplateId`，五个字段已对到 `cloudfunctions/remind/template.js`。改了这个文件后要重新上传 `remind`。
7. **录入活动**：按下面的格式在 `events` 集合里添加活动。没有活动时「活动」页的「即将开始」显示「敬请期待」，录入后自动出现，不用改代码也不用重新发版。

云调用的权限（`phonenumber.getPhoneNumber`、`subscribeMessage.send`）已经写在两个云函数各自的 `config.json` 里，上传时生效，有约 10 分钟缓存。

## 资源放到云存储

图片、视频、字体不打进小程序包，放在同一个云环境的云存储里（自带 CDN，基础套餐含 5GB CDN 流量）。**现在已经传好**，`miniprogram/config.js` 的 `assetBase` 填的就是云存储的地址。下面的步骤是以后换素材或换环境时用的。

1. 在仓库根目录运行 `npm run cdn`。它把小程序实际用到的 38 个文件（约 7MB）挑到 `out/cdn/assets/` 里，没用到的 720p 原片、多余的字体不带上。
2. 打开云开发控制台的「存储」，把 `out/cdn/` 里的 `assets` 文件夹整个上传到根目录，保持 `assets/` 这一层目录不变。
3. 在「存储」的权限设置里选「所有用户可读，仅创建者可读写」，否则用户的手机加载不了。
4. 点开任意一个上传好的文件，复制它的下载地址，形如 `https://7370-xxxx-1300000000.tcb.qcloud.la/assets/logo/avatar.svg`。取 `/assets/` 前面的那一段，填到 `miniprogram/config.js` 的 `assetBase`，例如 `assetBase: 'https://7370-xxxx-1300000000.tcb.qcloud.la'`。地址后面如果带 `?sign=...` 之类的参数，不要带上。
5. 重新编译，关掉「不校验合法域名」再看一遍：图片、视频、数字字体都应该正常。

图片和视频用的是 `image`、`video` 组件，不需要把这个域名加进小程序后台的服务器域名（那里只管 `wx.request`、上传、下载、WebSocket）。

数字字体的加载单独处理（`miniprogram/utils/fonts.js`）。`wx.loadFontFace` 用 https 地址时要求服务器允许跨域；云存储本身允许，但它前面的 CDN 会把不带跨域许可的响应缓存下来，所以直接用地址加载时好时坏。现在的做法是用 `wx.cloud.downloadFile` 把字体下到本机，读成 Data URL 再加载，不经过跨域检查，也不用配下载域名；下过一次就存在本机。这条路失败时退回用地址加载，再失败就是系统字体，不影响使用。

以后换图：替换云存储里的同名文件即可；新增了资源就重新跑一次 `npm run cdn`，把新增的文件传上去。

## 隐私和协议

- 《用户协议》《隐私政策》的正文在 `reference/content/legal.json`，是按小程序实际收集的信息起草的初稿，**上线前请法务审阅**。文件开头 `fill` 里的四项填一次，正文里会自动替换：四项都已填好。改完运行 `npm run content`。
- 微信要求在小程序后台配置《用户隐私保护指引》（「账号设置 → 服务内容声明 → 用户隐私保护指引」），只有在里面声明过的信息才能调用对应的接口。本小程序现在实际用到的只有**手机号**（用途：会员注册）。隐私政策里另外预留了昵称头像、收货地址、位置、日历（仅写入）、剪切板、相册（仅写入）六项，供后续功能使用，后台的指引里已一并声明。提审时这份指引要和 `legal.json` 里的隐私政策一致。
- 注册按钮是 `open-type="getPhoneNumber|agreePrivacyAuthorization"`：用户勾选协议后点它，既向微信表明已同意隐私政策，又发起手机号授权。
- 以后如果新增收集的信息（头像昵称、位置等），三处要一起改：`legal.json`、小程序后台的指引、对应的授权流程。

## 集合

| 集合 | `_id` | 字段 |
|---|---|---|
| `members` 会员 | openid | `openid`、`phone`、`countryCode`、`nickname`、`memberNo`、`points`、`welcomeBonus`（已送过注册积分）、`createdAt` |
| `events` 活动 | 自动 | 见下 |
| `signups` 报名 | `openid_活动id` | `openid`、`eventId`、`token`（写入时的请求标记）、`createdAt` |
| `reminders` 提醒 | `openid_活动id` | `openid`、`eventId`、`templateId`、`sent`、`status`（`sending` / `sent` / `failed`）、`claimedAt`、`sentAt`、`error`、`createdAt` |
| `plans` 补给计划 | openid | `openid`、`input`（公式的八项输入）、`result`（支数摘要）、`savedAt` |
| `counters` 计数 | `memberNo` | `next`（下一个会员编号）。云函数自动建，不要手动改 |

会员编号按注册先后发，6 位数字，从 100001 起（`api` 里的 `nextMemberNo`）。没有编号的会员（规则定下来之前注册的，或注册时取号失败的）下次进入小程序时补发，页面上暂时显示「—」。

注册送 500 积分（`api` 里的 `WELCOME_POINTS`；页面上的说法在 `reference/content/member.json` 和 `messages.json`，要改一起改）。没领过的老会员下次进入小程序时补送一次，用 `welcomeBonus` 标记防止重复送。积分怎么兑换、参与活动怎么算还没定。要手动给某个会员加减积分，在控制台里改他那条记录的 `points`。

昵称由用户在会员页自己填（`setNickname` 接口），最多 20 个字。输入框用的是微信的昵称键盘，内容安全由微信的组件检测。

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

用公共模板「活动动态通知」，五个关键词：活动名称（`thing1`）、开始时间（`time7`）、温馨提示（`thing4`）、截止时间（`time3`）、活动地点（`thing8`）。`remind/template.js` 开头的 `FIELDS` 把它们对应到活动数据：活动名称、活动开始的时间、「报名已开放」、报名截止的时间、城市加场地。五个字段发送时都必须有值：活动没填报名截止时间时用活动开始时间顶上，没填城市和场地时写「详见活动详情」。所以录活动时最好把 `signupEnd`、`city`、`venue` 都填上。以后换模板或改关键词，按新模板「详细内容」里的字段名改 `FIELDS`。`miniprogramState` 上线后用 `formal`，调试时改成 `developer` 或 `trial`。

提醒的流程：用户点「提醒我」→ 调起订阅授权 → 同意后在 `reminders` 里登记 → 报名开放后 `remind` 先把记录标成 `sent: true`、`status: 'sending'`（领取），再发送，发完记成 `sent` 或 `failed`。一次授权只能发一条，所以宁可漏发不重发：发送失败（用户取消订阅等）会把原因记在 `error` 里，不重试；如果执行中途中断，记录会停在 `sending`，也不会自动重发，可以在数据库里按 `status` 查出来。一次执行最多发 300 条，多出来的下一次接着发。

## 测试

```bash
node tools/test-cloud.js
```

用内存替身（`tools/cloud-mock.js`）代替 `wx-server-sdk`，检查云函数的业务规则，并把小程序端接到替身上走一遍「保存 → 注册 → 提醒 → 报名」。它不能代替真实环境：手机号换取、订阅消息发送、数据库权限、定时触发器要在开发者工具里用真实的云环境验证。
