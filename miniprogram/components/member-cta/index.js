const home = require('../../content/home.js');
const { go } = require('../../utils/page.js');

/** 「成为 SPORTSIX 会员」：首页和产品详情底部共用。文案来自 home.json#memberCta。 */
Component({
  options: { styleIsolation: 'apply-shared' },
  data: { cta: home.memberCta },
  methods: {
    onJoin() { go(this.data.cta.to); }
  }
});
