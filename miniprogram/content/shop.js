// 由 tools/sync-content.js 从 reference/content/shop.json 生成，不要手改。
module.exports = {
  "_note": "购买渠道的入口：首页两款产品下面、产品详情页底部、「我的」菜单里各有一个，点了跳到店铺小程序里对应的商品。设计稿里没有，文字是加这个入口时写的，可以直接在这里改，改完运行 npm run content。links 是两款产品在店铺里的小程序链接（在店铺的商品页点右上角菜单「复制链接」得到），没填的那款不显示购买入口。现在两款用的是同一条链接（店铺里一个商品页，两款都能选），所以点了直接过去，不用先选。",
  "confirm": "页面上不写店铺的名字，也不说一直有优惠（全渠道控价，优惠是不定期的）。改文案时保持这两点",
  "card": { "title": "优惠渠道", "body": "这里时不时会有优惠", "action": "去看看" },
  "menu": "优惠渠道",
  "sheet": { "title": "选一款去看看", "close": "取消" },
  "failed": "没打开，请稍后再试",
  "links": {
    "energy-gel": "#小程序://E家海纳购/商品/23jsdWFIAhYwQoG",
    "energy-gel-pro": "#小程序://E家海纳购/商品/23jsdWFIAhYwQoG"
  }
};
