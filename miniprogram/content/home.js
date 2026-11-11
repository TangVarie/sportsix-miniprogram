// 由 tools/sync-content.js 从 reference/content/home.json 生成，不要手改。
module.exports = {
  "_note": "首页从上到下的模块与文案。英文小标签（eyebrow）是设计加的装饰，可保留可去掉。标 confirm 的条目上线前需要品牌方确认。",
  "hero": {
    "logo": "assets/logo/sportsix-wordmark-white.svg",
    "slogan": "assets/logo/win-your-day-white.svg",
    "headline": ["缓释超低渗", "慢慢来才更快"],
    "brandLine": "韩国大象集团旗下专业运动营养品牌",
    "tag": "韩国原装进口",
    "packs": ["assets/product/energy-gel-peach.png", "assets/product/energy-gel-grape.png"],
    "confirm": "「缓释」「超低渗」能否对外宣称"
  },
  "stats": [
    { "value": "60+", "label": "年集团科研积淀", "source": "电商页：依托集团六十余年科研积淀打造" },
    { "value": "250", "label": "种禁用成分管理", "source": "电商页：约对 250 种体育禁用成分进行彻底管理" },
    { "value": "5", "label": "款产品全周期覆盖", "source": "产品线共 5 款" }
  ],
  "keywords": {
    "eyebrow": "WHY SPORTSIX",
    "title": "三个词，讲清 SPORTSIX",
    "cards": [
      {
        "n": "01", "word": "缓释", "line": "平稳供能，中间不断档",
        "body": "能量胶用快慢双碳，即时补能 + 长效续航，告别能量过山车。PRO 用 HBCD，像打点滴一样匀速供能。",
        "graphic": "assets/graphics/chart-release.svg", "graphicLabels": ["冲得快，掉得也快", "平稳供能"],
        "chips": ["能量胶", "能量胶PRO"]
      },
      {
        "n": "02", "word": "超低渗", "line": "快排空，不坠胃",
        "body": "通过低渗透压快速清空胃部，缓解饱胀感，长距离无“坠重感”。位置为示意。",
        "graphic": "assets/graphics/chart-osmolality.svg",
        "chips": ["能量胶PRO"],
        "confirm": "电商页只写了「低渗透压」，没有实测数；图上的位置是示意"
      },
      {
        "n": "03", "word": "HBCD", "line": "高支链环状糊精",
        "body": "被称为“高分子循环型糊精”的碳水化合物成分，是运动员良好的能量来源。",
        "graphic": "assets/graphics/hbcd-molecule.svg", "trio": ["快排空", "慢吸收", "强实证"],
        "chips": ["能量胶PRO"]
      }
    ]
  },
  "fuelEntry": {
    "eyebrow": "FUEL PLAN", "title": "分段补给计算", "body": "选项目和目标时间，算出带几支、什么时候吃", "button": "开始计算",
    "image": "assets/photos/web/road-silhouettes.jpg", "to": "fuel"
  },
  "lineup": { "eyebrow": "LINE-UP", "title": "全周期运动产品线", "data": "products.json#lineup" },
  "dualCarb": { "data": "products.json#energyGel.sections[dualCarb]", "note": "首页版本的脚注不含「食用 2 袋」那一句" },
  "specs": [
    { "value": "1115", "unit": "KJ/100g", "title": "高配比能量胶", "body": "高碳水储备，续航更持久" },
    { "value": "45", "unit": "mg", "title": "轻咖啡因", "body": "瓜拉纳提取物的植物来源咖啡因" },
    { "value": "45", "unit": "g", "title": "大容量", "body": "一支适配 30 分钟高强度运动" }
  ],
  "certification": {
    "title": ["Informed-Sport", "权威认证产品"],
    "body": "Informed Sport 是由全球体育反兴奋剂研究所对产品进行检测，确认其不含运动员禁用物质的认证项目。",
    "checks": ["SPORTSIX 约对 250 种体育禁用成分进行彻底管理", "生产的所有批次均经过严格分析和管理"],
    "confirm": "认证标本身未使用，只写了文字；用标需要确认授权范围"
  },
  "races": {
    "eyebrow": "RACES", "title": ["众多专业机构", "选择 SPORTSIX 产品"],
    "partner": { "label": "官方合作伙伴", "name": "韩华老鹰棒球队 Hanwha Eagles" },
    "cards": "events.json#past",
    "hint": "左滑查看更多"
  },
  "brand": {
    "image": "assets/photos/endorsement/factory.jpg",
    "eyebrow": "BRAND", "title": ["韩国大象集团旗下", "专业运动营养品牌"],
    "body": "依托集团六十余年科研积淀打造，秉持六大运动核心价值。",
    "values": [
      { "icon": "globe", "text": "原料全球甄选" },
      { "icon": "pin", "text": "韩国本土原厂出品" },
      { "icon": "store", "text": "线下入驻 Oliveyoung" },
      { "icon": "ship", "text": "原装引进国内" },
      { "icon": "flask", "text": "科学配比碳水电解质" },
      { "icon": "route", "text": "适配长距离运动补给" }
    ]
  },
  "film": {
    "eyebrow": "BRAND FILM", "title": "谁说要当职业选手了？",
    "video": "assets/video/brand-film-540p.mp4", "poster": "assets/video/brand-film-poster.jpg",
    "caption": "又不是要当职业选手，却拼了十年。我的热爱，只属于我的快乐。",
    "confirm": "片中有艺人正脸出镜，能否在国内小程序使用需品牌和法务确认"
  },
  "memberCta": { "title": "成为 SPORTSIX 会员", "body": "优先报名 · 试用装 · 积分 · 抽奖", "button": "立即加入", "to": "join" }
};
