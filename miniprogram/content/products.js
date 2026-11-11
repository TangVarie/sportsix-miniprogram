// 由 tools/sync-content.js 从 reference/content/products.json 生成，不要手改。
module.exports = {
  "_note": "文案取自 SPORTSIX 电商详情页、折页和《SPORTSIX产品介绍文档（教练版）》。keyPoints、scenes、compare 三块来自教练版文档：点名其他品牌的对比没有收录，绝对化和医疗化的用词改成了平实说法，功效说法照原文保留并标 confirm。标 confirm 的条目上线前需要品牌方确认。产品款名统一用「能量胶」「能量胶PRO」，不用颜色区分。",
  "lineup": [
    {
      "stage": "运动前", "stageEn": "BEFORE",
      "products": [
        { "id": "booster-gel", "name": "增效凝胶", "role": "体能激活", "image": "assets/product/booster-gel.png", "detail": false },
        { "id": "clear-shot", "name": "CLEAR SHOT 电解质活力饮", "role": "电解质调节 · 运动前、运动后", "image": "assets/product/clear-shot.png", "detail": false }
      ]
    },
    {
      "stage": "运动中", "stageEn": "DURING",
      "products": [
        { "id": "energy-gel", "name": "能量胶", "role": "赛中补给 · 青葡萄味 / 桃子味", "fact": "45mg 咖啡因 · 120 千卡", "image": "assets/product/energy-gel-grape.png", "detail": true },
        { "id": "energy-gel-pro", "name": "能量胶PRO", "role": "赛中补给 · 菠萝味", "fact": "0 咖啡因 · 85 千卡", "image": "assets/product/energy-gel-pro-pineapple.png", "detail": true }
      ]
    },
    {
      "stage": "运动后", "stageEn": "AFTER",
      "products": [
        { "id": "revital-drink", "name": "REVITAL DRINK 焕活复原饮品", "role": "赛后恢复", "image": "assets/product/revital-drink.png", "detail": false }
      ]
    }
  ],
  "compare": {
    "_note": "产品速选对比，两款详情页底部共用，当前产品一列加粗。",
    "eyebrow": "QUICK PICK", "title": "产品速选对比",
    "columns": [
      { "id": "energy-gel", "name": "能量胶", "image": "assets/product/energy-gel-grape.png" },
      { "id": "energy-gel-pro", "name": "能量胶PRO", "image": "assets/product/energy-gel-pro-pineapple.png" }
    ],
    "rows": [
      {"label": "一句话定位", "energyGel": "高能续航 + 天然提神", "energyGelPro": "极速排空 + 护胃抗损"},
      {"label": "规格与热量", "energyGel": "45g / 120 kcal", "energyGelPro": "45g / 85 kcal"},
      {"label": "能量密度", "energyGel": "2.67 kcal/g", "energyGelPro": "1.89 kcal/g"},
      {"label": "碳水方案", "energyGel": "麦芽糊精 + 帕拉金糖", "energyGelPro": "HBCD + 麦芽糊精 + 果糖"},
      {"label": "渗透压", "energyGel": "中低渗，水感良好，甜度适中", "energyGelPro": "超低渗，胃排空快"},
      {"label": "功能复方", "energyGel": "瓜拉纳咖啡因 + VB3 + 氨基酸", "energyGelPro": "谷氨酰胺 + 精氨酸 + 胶原蛋白肽 + BCAA"},
      {"label": "口感", "energyGel": "顺滑果汁感，清爽不齁甜、不糊喉咙", "energyGelPro": "近似水感果冻，易下咽"},
      {"label": "咖啡因", "energyGel": "约 45mg / 包", "energyGelPro": "0 咖啡因，晚课 / 敏感人群友好"}
    ]
  },
  "energyGel": {
    "id": "energy-gel",
    "name": "能量胶",
    "tag": "运动中 · 赛中补给",
    "headline": ["长距离不撞墙", "SPORTSIX 双碳能量胶"],
    "flavors": [
      { "key": "grape", "label": "青葡萄味", "image": "assets/product/energy-gel-grape.png" },
      { "key": "peach", "label": "桃子味", "image": "assets/product/energy-gel-peach.png" }
    ],
    "positioning": "高能续航 + 天然提神",
    "keyPoints": {
      "eyebrow": "KEY POINTS",
      "items": [
        {"n": "01", "title": "能量超顶且“不倒糖”", "body": "单包仅 45g 就有 120 大卡。采用缓释帕拉金糖，血糖像平原一样稳定，不容易出现“刚吃完很猛、20 分钟后突然虚脱”的情况。"},
        {"n": "02", "title": "温和提神不心慌", "body": "提取自天然瓜拉纳，比人工合成咖啡因起效更柔和、持续时间更长。"},
        {"n": "03", "title": "告别“糊嘴与齁甜”", "body": "水感果汁质地，单手撕开吸一口就能咽下，跑动中不需要停下来找水稀释。"}
      ]
    },
    "scenes": {
      "eyebrow": "SCENES", "title": "场景推荐", "link": { "label": "分段补给计算", "to": "fuel" },
      "items": [
        {"title": "Hyrox 赛场", "body": "比赛开始前 15~20 分钟喝 1 包，或者在赛程过半时补 1 包。高心率动作转换中迅速唤醒神经，为后半程提供扎实体能底气。"},
        {"title": "公路 / 山地骑行", "body": "集团巡航或上坡攻坚时，骑行途中单手持把即可无阻力吸入，高热量密度无需在骑行服后兜塞满大包小包。"},
        {"title": "越野跑日常拉练 / 半程前段", "body": "适合起跑前及赛程前 30 公里作为主力快碳来源，维持输出功率稳定。"}
      ],
      "confirm": "教练版原文写的是「第4站划船/滑雪机转折点」「后半程推雪橇与波比跳」，与 HYROX 的固定站序不符，这里改成了「赛程过半时」「后半程」"
    },
    "facts": [
      { "value": "45", "unit": "g", "label": "大容量" },
      { "value": "45", "unit": "mg", "label": "温和咖啡因" },
      { "value": "30", "unit": "g", "label": "快慢碳水" },
      { "value": "120", "unit": "kcal", "label": "每支能量" }
    ],
    "sections": [
      {
        "key": "sources", "eyebrow": "5 SOURCES", "title": "5 维能量方案", "sub": "终结耐力短板",
        "graphic": "assets/graphics/radar-5-sources.svg",
        "items": ["一水结晶葡萄糖", "玉米糖浆", "天然植物咖啡因", "帕拉金糖", "麦芽糊精"]
      },
      {
        "key": "dualCarb", "eyebrow": "DUAL CARB", "title": ["快慢双碳", "告别能量过山车"],
        "body": "即时补能 + 长效续航双向兼顾，长距离耐力运动不掉速、不撞墙。",
        "graphic": "assets/graphics/chart-pace.svg",
        "legend": ["SPORTSIX 复配：麦芽糊精 + 帕拉金糖，更稳定", "普通胶：只有单糖，波动大"],
        "footnote": "马拉松 30KM 前后配速稳定性对比，曲线为示意。食用 2 袋 SPORTSIX 能量胶（含咖啡因版）。数据参考自《International Journal of Sport Nutrition and Exercise Metabolism》发表的《Improved Marathon Performance by In-Race Nutritional Strategy Intervention》研究论文。",
        "confirm": "是否在小程序引用这项研究"
      },
      {
        "key": "density", "eyebrow": "ENERGY DENSITY", "title": "高配比能量胶", "sub": "高碳水储备，续航更持久",
        "highlight": { "label": "单位能量提升约", "value": "11%" },
        "bars": [
          { "label": "常规补水型水胶", "value": 481 },
          { "label": "传统基础能量胶", "value": 1004 },
          { "label": "SPORTSIX 能量胶", "value": 1115, "highlight": true }
        ],
        "footnote": "单位：KJ/100g。水胶、市面上普通能量胶数据来源市场某品牌，增长幅度来源于 SPORTSIX。"
      },
      {
        "key": "caffeine", "eyebrow": "CAFFEINE", "title": ["45mg 轻咖啡因", "稳状态冲 PB"],
        "body": "瓜拉纳提取物的植物来源咖啡因，每包含有 45mg。",
        "bars": [
          { "label": "美式咖啡", "sub": "（不规格）", "value": 125, "unit": "mg" },
          { "label": "罐装咖啡", "sub": "（200ml）", "value": 118, "unit": "mg" },
          { "label": "能量胶", "sub": "（2 条）", "value": 90, "unit": "mg", "highlight": true },
          { "label": "能量胶", "sub": "（1 条）", "value": 45, "unit": "mg", "highlight": true }
        ],
        "note": "每运动 30 分钟补充 1 条，1 小时最多 2 条，避免咖啡因叠加心慌。",
        "footnote": "按食品分类的咖啡因平均含量。出处：食品药品安全部。"
      },
      {
        "key": "electrolytes", "eyebrow": "ELECTROLYTES", "title": "全链路电解质补给", "sub": "缓解高温肌肉不适",
        "compare": {
          "columns": ["普通胶", "SPORTSIX 能量胶"],
          "rows": [
            { "item": "电解质构成", "other": "单一钠元素", "ours": "钠 + 钾 + 柠檬酸钠复配，添加 VB3" },
            { "item": "补给方式", "other": "只补细胞外盐分，钾持续缺失", "ours": "细胞内 + 细胞外，双向全链路补充" },
            { "item": "高温长跑表现", "other": "电解质配比不全，失衡概率偏高", "ours": "贴合汗液流失结构，长效稳定肌肉状态" }
          ]
        },
        "confirm": "「缓解高温肌肉不适」属于功效说法"
      },
      {
        "key": "clean", "eyebrow": "CLEAN LABEL", "title": ["全球甄选进口原料", "口感清爽不齁腻"],
        "zero": ["人工色素", "反式脂肪", "防腐剂", "人工甜味剂"],
        "body": "拒绝人参 / 灵芝等冗余添加。青葡萄款采用智利进口青葡萄浓缩汁，桃子款采用以色列进口桃子浓缩汁。"
      },
      {
        "key": "howTo", "eyebrow": "HOW TO FUEL", "title": "科学补给，续航更稳", "sub": "科学分段补给参考 · 马拉松赛中适配",
        "banner": { "image": "assets/photos/web/race-motion-blur.jpg", "eyebrow": "EVERY 30 MIN", "title": "每运动 30 分钟补充 1 条" },
        "timeline": [
          { "label": "补充 1 支", "minutes": 30 },
          { "label": "累计 2 支", "minutes": 60 },
          { "label": "累计 3 支", "minutes": 90 }
        ],
        "timelineNote": "可根据个人体能、出汗量灵活微调补给节奏。",
        "race": {
          "title": "比赛时怎么吃", "rule": "每运动 30 分钟补充 1 条",
          "rows": [
            { "k": "赛前", "v": "肠胃适应人群起跑前 15 分钟可吃半条打底" },
            { "k": "赛中", "v": "每 30 分钟 / 约 10km 补充 1 条" },
            { "k": "赛后", "v": "高强度完赛 30 分钟内按需补充，快速恢复体能" }
          ]
        },
        "training": {
          "title": "训练时怎么吃", "rule": "满足任一情况补充 1 条",
          "rows": ["单次跑步距离 ＞ 10km", "单次运动时长 ＞ 60 分钟", "高强度间歇 / 爬坡训练 ＞ 30–40 分钟", "90 分钟以上长距离拉练，每 30 分钟定时补充"]
        },
        "footnote": "初次食用建议先吃半条适应肠胃。仅运动中途补充，咖啡因敏感者减量食用。"
      }
    ],
    "nutrition": {
      "per": "每份 45g",
      "rows": [["能量", "120 千卡"], ["碳水化合物", "30 g"], ["糖类", "9 g"], ["钠", "20 mg"], ["脂肪", "0 g"]],
      "footnote": "规格：360 克（45 克 / 包 × 8 包）。食品类型：混合饮料。"
    },
    "crossLink": { "to": "energy-gel-pro", "title": "能量胶PRO", "sub": "0 咖啡因 · 菠萝味" }
  },
  "energyGelPro": {
    "id": "energy-gel-pro",
    "name": "能量胶PRO",
    "tag": "运动中 · 赛中补给",
    "headline": ["重新定义“零负担”能量胶", "长跑不胀肚，夜跑不失眠"],
    "chips": ["缓释", "超低渗", "HBCD"],
    "flavor": "菠萝味",
    "image": "assets/product/energy-gel-pro-pineapple.png",
    "positioning": "极速排空 + 护胃抗损",
    "keyPoints": {
      "eyebrow": "KEY POINTS",
      "items": [
        {"n": "01", "title": "“秒排空”，胃里不晃荡", "body": "采用 HBCD（高支链环糊精），分子超大、渗透压极低，像喝清水一样迅速穿过胃部进入肠道，跑步跳跃时胃里没有“水晃荡”和胀气感。"},
        {"n": "02", "title": "边跑边修护肠道与关节", "body": "额外添加了谷氨酰胺（防止高温剧烈运动下的肠道黏膜痉挛反胃）与小分子胶原蛋白肽 + BCAA（缓冲下坡冲坠对膝盖软骨与韧带的微损伤）。"},
        {"n": "03", "title": "纯 0 咖啡因，不抢心率", "body": "不含咖啡因，晚上训练吃完也不影响睡眠。"}
      ],
      "confirm": "「护胃抗损」「修护肠道与关节」「防止…肠道黏膜痉挛反胃」「缓冲…微损伤」属于功效说法"
    },
    "scenes": {
      "eyebrow": "SCENES", "title": "场景推荐", "link": { "label": "分段补给计算", "to": "fuel" },
      "items": [
        {"title": "越野跑 50km+ 后半程 / 夜赛", "body": "越野跑后程由于脱水、高温，很多跑者肠胃罢工、“闻到甜味就恶心甚至呕吐”。此时能量胶PRO 更容易顺畅吞入。"},
        {"title": "Hyrox 晚间大强度团课", "body": "下班后 19:00-21:00 上高强度大课，既需要快速供能，又怕摄入咖啡因导致整夜失眠，可以选能量胶PRO。"},
        {"title": "长距离下坡与多日耐力挑战", "body": "连续高落差下坡肌肉离心收缩剧烈时，胶原蛋白肽与氨基酸矩阵能直接在行进间延缓肌肉与结缔组织损伤。"}
      ],
      "confirm": "「延缓肌肉与结缔组织损伤」属于功效说法"
    },
    "facts": [
      { "value": "0", "unit": "", "label": "咖啡因" },
      { "value": "-26", "unit": "%", "label": "甜度，相比含咖啡因版" },
      { "value": "85", "unit": "kcal", "label": "每支能量" },
      { "value": "21", "unit": "g", "label": "优质碳水" }
    ],
    "sections": [
      {
        "key": "hbcd", "eyebrow": "HBCD", "title": ["不仅是能量胶", "更是「肠胃救星」"],
        "body": "HBCD（高支链环状糊精）被称为“高分子循环型糊精”的碳水化合物成分，是运动员良好的能量来源。",
        "trio": [
          { "title": "快排空", "body": "胃里不积食，长距离无“坠重感”" },
          { "title": "慢吸收", "body": "像打点滴一样匀速供能，拒绝血糖骤升骤降" },
          { "title": "强实证", "body": "有效降低疲劳值，加速赛后恢复" }
        ],
        "flow": [
          { "n": "01", "title": "摄入 HBCD" },
          { "n": "02", "small": "通过低渗透压快速从上部排出", "title": "快速清空胃部，缓解饱胀感" },
          { "n": "03", "small": "通过 α-(1,6) 结合缓慢消化", "title": "长时间提供能量" },
          { "n": "04", "small": "运动所需", "title": "快速且持久地提供健康能量" }
        ],
        "footnote": "此为原料说明，非产品本身。胃排空提速来源于《高支链环状糊精（HBCD）及其对运动员运动表现的增效作用简要综述》。",
        "confirm": "「肠胃救星」「降低疲劳值」「加速赛后恢复」属于功效说法"
      },
      {
        "key": "release", "eyebrow": "RELEASE", "title": "吸收集中，还是持续释放",
        "columns": [
          { "label": "普通胶", "title": "吸收集中", "body": ["血糖波动大", "肠胃易不适"], "graphic": "assets/graphics/chart-absorb-spike.svg" },
          { "label": "SPORTSIX PRO 能量胶", "title": "持续释放", "body": ["供能更稳定", "降低疲劳感"], "graphic": "assets/graphics/chart-absorb-steady.svg", "highlight": true }
        ],
        "footnote": "曲线为示意。来源于《高支链环状糊精（HBCD）及其对运动员运动表现的增效作用简要综述》。"
      },
      {
        "key": "taste", "eyebrow": "TASTE", "title": ["菠萝水感胶", "清爽到忘记它的存在"],
        "points": [
          { "title": "0 咖啡因 · 全时段友好", "body": "专为咖啡因敏感体质、夜跑党、青少年运动员打造。提神靠自己，补能交给我。" },
          { "title": "降甜 26% · 顺滑不糊喉", "body": "菠萝酸甜口，水感凝胶质地，高强度颠簸中食用也不呛喉，无糖渣残留。" }
        ],
        "bars": [
          { "label": "能量胶PRO", "value": 44, "unit": "Brix", "highlight": true },
          { "label": "含咖啡因版", "value": 60, "unit": "Brix" }
        ]
      },
      {
        "key": "lean", "eyebrow": "85 KCAL", "title": "85 大卡的精致补给", "sub": "拒绝无效填充，只留有效能量",
        "quad": [
          { "title": "21g 优质碳水", "body": "持久续航" },
          { "title": "8g 轻糖", "body": "减少身体负担" },
          { "title": "BCAA / 精氨酸 / 肌酸", "body": "补糖、抗疲劳、肌肉保护" },
          { "title": "电解质钠", "body": "预防长距离抽筋" }
        ],
        "confirm": "「抗疲劳」「肌肉保护」「预防长距离抽筋」属于功效说法"
      },
      {
        "key": "ingredients", "eyebrow": "6 INGREDIENTS", "title": "SPORTSIX 精心严选", "sub": "为运动而生的 6 种协同原料",
        "graphic": "assets/graphics/radar-6-ingredients.svg",
        "items": ["胶原蛋白", "脯氨酸", "丙氨酸", "谷氨酰胺", "支链氨基酸", "精氨酸"]
      },
      {
        "key": "guide", "eyebrow": "RACE DAY", "title": "食用指南",
        "banner": { "image": "assets/photos/web/marathon-aerial.jpg" },
        "steps": [
          { "when": "赛前 30min", "what": "打底储备", "qty": "1 条" },
          { "when": "开赛", "what": "缓释续航", "qty": "1 条" },
          { "when": "40~60min", "what": "HBCD 稳血糖", "qty": "1 条" },
          { "when": "60~90min", "what": "回血恢复", "qty": "1 条（可选）" },
          { "when": "完赛后" }
        ],
        "note": "3 条食用口诀：提前打底 1 条，赛中 45 分钟 1 条，PRO 款全天随便补。"
      },
      {
        "key": "qa", "eyebrow": "Q&A", "title": "新手吃胶 Q&A",
        "items": [
          { "n": "01", "q": "第一次吃，肠胃会不会抗议？", "a": "HBCD 本身比葡萄糖 / 麦芽糊精温和，建议首次长距离前用一次 LSD（长距离慢跑）试胶。" },
          { "n": "02", "q": "要不要配水？", "a": "PRO 是 44Brix 水感凝胶，不需要配水。" },
          { "n": "03", "q": "和含咖啡因款怎么搭？", "a": "白天竞速选含咖款提神；夜跑、敏感体质、下午赛怕失眠选 PRO 无咖款；也可前半程含咖 + 后半程切无咖组合打。" },
          { "n": "04", "q": "一场全马带几支够？", "a": "建议 5–6 支（含赛前 1 支），再根据自身体重 / 配速微调，腰包 6 支刚好一盒带走。" },
          {"n": "05", "q": "运动一大意就反酸、拉肚子，能吃能量胶吗？", "a": "可以选能量胶PRO。它用的是极低渗透压的 HBCD，还加了谷氨酰胺，喝进胃里负担小。"}
        ]
      }
    ],
    "nutrition": {
      "per": "每份 45g",
      "rows": [["能量", "85 千卡"], ["碳水化合物", "21 g"], ["糖类", "8 g"], ["钠", "25 mg"], ["脂肪", "0 g"], ["蛋白质", "0 g"]],
      "footnote": "规格：总重 270g（45g × 6 条）。食品类型：混合饮料。"
    },
    "crossLink": { "to": "energy-gel", "title": "能量胶", "sub": "45mg 咖啡因 · 青葡萄味 / 桃子味" }
  }
};
