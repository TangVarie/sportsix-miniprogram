// 由 tools/sync-content.js 从 reference/content/admin.json 生成，不要手改。
module.exports = {
  "_note": "运营后台的文字。只有管理员能看到这些页面（会员记录上有 admin: true）。设计稿里没有后台，文字是开发时写的，可以直接在这里改，改完运行 npm run content。",
  "entry": "运营后台",
  "title": "运营后台",
  "tabs": [
    {
      "key": "events",
      "text": "活动"
    },
    {
      "key": "past",
      "text": "往期"
    },
    {
      "key": "notice",
      "text": "公告"
    },
    {
      "key": "points",
      "text": "积分"
    },
    {
      "key": "web",
      "text": "电脑端"
    }
  ],
  "events": {
    "create": "新建活动",
    "empty": "还没有活动",
    "edit": "编辑",
    "publish": "上架",
    "unpublish": "下架",
    "status": {
      "published": "已上架",
      "draft": "未上架",
      "ended": "已结束"
    },
    "signups": "已报名 [人数] 人",
    "published": "已上架，小程序里能看到了",
    "unpublished": "已下架",
    "subscribers": "[人数] 人订阅了新活动通知",
    "notify": "通知订阅的人",
    "notifyConfirmTitle": "通知订阅的人",
    "notifyConfirm": "现在有 [人数] 人订阅了新活动通知。确认后每人收到一条微信提醒，这场活动只能通知一次。",
    "notifyQueued": "已安排，几分钟内发出",
    "notifyPending": "通知发送中",
    "notifyDone": "已通知 [人数] 人",
    "notifyFailed": "[人数] 人没发到"
  },
  "past": {
    "hint": "活动页「往期」里的赞助赛事。保存后小程序里马上能看到，不用重新发版。",
    "create": "添加赛事",
    "empty": "还没有往期赛事",
    "edit": "编辑",
    "delete": "删除",
    "titleNew": "添加赛事",
    "titleEdit": "编辑赛事",
    "labels": {
      "year": "年份",
      "name": "名称",
      "nameEn": "英文名或副标题",
      "image": "照片"
    },
    "placeholders": {
      "year": "比如 2027",
      "name": "比如 首尔马拉松",
      "nameEn": "比如 Seoul Marathon，可以不填"
    },
    "chooseImage": "选择照片",
    "changeImage": "换一张",
    "uploading": "正在上传",
    "save": "保存",
    "cancel": "取消",
    "saved": "已保存",
    "deleteTitle": "删除赛事",
    "deleteConfirm": "把「[名称]」从往期里删掉",
    "deleted": "已删除"
  },
  "form": {
    "titleNew": "新建活动",
    "titleEdit": "编辑活动",
    "groups": {
      "basic": "基本信息",
      "signup": "报名",
      "more": "头图和介绍"
    },
    "labels": {
      "type": "类型",
      "title": "名称",
      "date": "活动时间",
      "city": "城市",
      "venue": "场地",
      "quota": "名额",
      "quotaText": "名额写法",
      "memberSignupStart": "会员提前报名",
      "signupStart": "报名开始",
      "signupEnd": "报名结束",
      "drawAt": "开奖时间",
      "cover": "头图",
      "intro": "介绍",
      "status": "上架"
    },
    "placeholders": {
      "title": "活动名称",
      "city": "比如 上海",
      "venue": "比如 徐汇滨江",
      "quota": "不填就不限",
      "quotaText": "比如 限 200 份，不填就显示数字",
      "intro": "活动介绍，可以分段",
      "date": "选日期",
      "time": "选时间"
    },
    "hints": {
      "memberSignupStart": "填了，活动卡片上显示「会员优先报名」，提醒也按这个时间发。",
      "status": "打开后保存，小程序里就能看到。",
      "cover": "不选就用默认配图。"
    },
    "clear": "清除",
    "chooseCover": "选择图片",
    "changeCover": "换一张",
    "uploading": "正在上传",
    "save": "保存",
    "saved": "已保存"
  },
  "notice": {
    "labels": {
      "title": "标题",
      "content": "内容",
      "enabled": "打开小程序时弹出"
    },
    "placeholders": {
      "title": "最多 20 个字，可以不填",
      "content": "最多 200 个字"
    },
    "hint": "保存后，每位用户下次打开小程序时弹一次。改了再保存，会再弹一次。",
    "save": "保存",
    "saved": "公告已保存",
    "defaultTitle": "公告",
    "confirm": "知道了"
  },
  "points": {
    "queryPlaceholder": "手机号或会员编号",
    "find": "查找",
    "memberNo": "会员编号 [会员编号]",
    "current": "当前积分",
    "add": "加积分",
    "sub": "减积分",
    "amountPlaceholder": "数量",
    "reasonPlaceholder": "原因，会员在积分记录里能看到",
    "submit": "确认调整",
    "confirmTitle": "确认调整积分",
    "confirmAdd": "给 [会员] 加 [数量] 积分",
    "confirmSub": "给 [会员] 减 [数量] 积分",
    "done": "已调整"
  },
  "errors": {
    "forbidden": "没有权限",
    "not_found": "没有找到",
    "bad_type": "请选择类型",
    "missing_title": "请填写名称",
    "missing_date": "请选择活动时间",
    "bad_signup_time": "报名结束要晚于报名开始",
    "not_published": "活动上架后才能通知",
    "event_ended": "活动已经结束了",
    "notified": "这场活动已经通知过了",
    "no_subscribers": "还没有人订阅新活动通知",
    "bad_year": "年份填四位数字",
    "missing_name": "请填写名称",
    "missing_image": "请选择照片",
    "missing_content": "请填写公告内容",
    "missing_query": "请填写手机号或会员编号",
    "bad_delta": "请填写数量",
    "missing_reason": "请填写原因",
    "insufficient": "积分不够减",
    "upload": "图片上传失败，请再试一次",
    "network": "网络异常，请稍后再试"
  },
  "web": {
    "title": "在电脑上用后台",
    "steps": [
      "在电脑浏览器里打开下面的网址。",
      "点「获取登录码」，把 12 位数字填到网页上。"
    ],
    "urlLabel": "网址",
    "urlEmpty": "还没有配置网址",
    "copy": "复制网址",
    "copied": "已复制",
    "get": "获取登录码",
    "again": "重新获取",
    "codeHint": "5 分钟内有效，只能用一次。登录一次管 12 小时。"
  }
};
