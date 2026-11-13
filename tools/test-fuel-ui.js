/** 补给页关键行为：长计划不漏支、历史计划不重算、保存不重复提交。无需网络或浏览器。 */
const assert = require('assert');
const { createEnv } = require('./preview/runtime.js');

function open(storage) {
  const env = createEnv({ storage: storage || { sx_member: { createdAt: 1 } } });
  require('../miniprogram/config.js').cloudEnv = '';
  env.launch();
  const page = env.openPage('pages/fuel/index');
  return { env, page, fuel: require('../miniprogram/utils/fuel-plan.js'), store: require('../miniprogram/utils/store.js') };
}
const event = (index) => ({ currentTarget: { dataset: { index: index } } });

async function main() {
  {
    const { page, fuel } = open();
    assert.strictEqual(page.data.plan.total, 9, '四小时仍是原来的整场统计');
    assert.strictEqual(page.data.segmented, false, '普通计划保持一张时间表');
    assert.strictEqual(page.data.stageItems.length, 9);
    for (const minutes of [375, 480, 600, 1440, 1455, 2880]) {
      page.update({ sport: 'trail', minutes: minutes });
      const all = [];
      assert.ok(page.data.segmented, '长计划分段');
      for (let i = 0; i < page.data.stages.length; i++) {
        page.onStage(event(i));
        page.data.stageItems.forEach((item) => {
          assert.ok(item.position >= 0 && item.position <= 100, '点不能画到当前段之外');
          all.push(item.id);
        });
        assert.ok(page.data.stageItems.length <= 13, '每段点数保持可读');
        assert.strictEqual(page.data.active, -1, '切段清除上一段高亮');
      }
      const expected = fuel.planFuel(page.data.input).items.map((it) => it.minute + '|' + it.product);
      assert.deepStrictEqual(all, expected, '分段合起来恰好是原时间表，边界不漏、不重复');
      assert.strictEqual(new Set(all).size, all.length);
    }
    page.update({ minutes: 240 });
    assert.strictEqual(page.data.segmented, false, '改短后回到整场展示');
  }
  {
    const { page, env, fuel, store } = open();
    const saved = fuel.snapshot(page.data.input);
    saved.formulaVersion = 'previous-version';
    saved.result.items[1].minute = 35;
    saved.result.items[1].label = '0:35';
    saved.result.reasons = ['保存时的排法说明'];
    await store.savePlan(saved.input, saved.result, saved.formulaVersion);
    env.app.globalData.fuelRestore = true;
    page.onShow();
    assert.strictEqual(page.data.stageItems[1].label, '0:35', '恢复保存时的时间表');
    assert.deepStrictEqual(page.data.plan.reasons, ['保存时的排法说明']);
    assert.strictEqual(page.data.formulaVersion, 'previous-version');
    assert.strictEqual(page.data.restoredSnapshot, true);
    page.update({ kg: 70 });
    assert.strictEqual(page.data.stageItems[1].label, '0:30', '用户修改输入后才按当前规则重算');
    assert.strictEqual(page.data.formulaVersion, fuel.VERSION);
    assert.strictEqual(page.data.restoredSnapshot, false);
  }
  {
    const { page, store, fuel } = open();
    let calls = 0;
    let release;
    let sent;
    store.savePlan = (input, result, formulaVersion) => {
      calls += 1;
      sent = { input, result, formulaVersion };
      return new Promise((resolve) => { release = resolve; });
    };
    const first = page.onSave();
    page.update({ kg: 70 });
    const again = page.onSave();
    assert.strictEqual(first, again, '进行中的保存共用一次请求');
    assert.strictEqual(calls, 1);
    assert.strictEqual(page.data.saving, true);
    assert.strictEqual(sent.input.kg, 65, '请求期间修改输入不改变正在保存的快照');
    assert.strictEqual(sent.formulaVersion, fuel.VERSION);
    assert.ok(sent.result.items.length > 0 && sent.result.reasons.length > 0, '保存完整时间表与解释');
    release();
    await first;
    assert.strictEqual(page.data.saving, false);
    assert.strictEqual(page.savingPlan, null);
    const second = page.onSave();
    assert.strictEqual(calls, 2, '前一次完成后才可保存修改后的计划');
    assert.strictEqual(sent.input.kg, 70);
    release();
    await second;
    store.savePlan = () => Promise.reject(Object.assign(new Error('offline'), { code: 'network' }));
    await page.onSave();
    assert.strictEqual(page.data.saving, false, '保存失败后可重试');
  }
  {
    const { page, store } = open({});
    assert.strictEqual(page.data.member, false, '保留未加入会员的状态');
    assert.ok(page.data.plan.total > 0, '未加入会员仍可看到支数');
    page.onSave();
    assert.strictEqual(store.getPendingPlan().minutes, page.data.input.minutes, '登录前先保留计划输入');
  }
  console.log('补给页面测试通过：普通计划、长计划分段覆盖、历史快照、重复保存、失败重试、会员状态');
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
