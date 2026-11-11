/**
 * 运行：node reference/fuel-plan.test.js
 * 这些用例是设计稿里公式的预期结果，改公式时先改这里。
 */
const assert = require('assert');
const { planFuel } = require('./fuel-plan.js');

const seq = (r) => r.items.map((i) => i.label + (i.product === 'gel' ? 'G' : 'P')).join(' ');
let n = 0;
function check(name, input, expect) {
  const r = planFuel(input);
  for (const k of Object.keys(expect)) {
    const got = k === 'seq' ? seq(r) : r[k];
    assert.deepStrictEqual(got, expect[k], name + ' · ' + k + '：期望 ' + JSON.stringify(expect[k]) + '，得到 ' + JSON.stringify(got));
  }
  n += 1;
}

// 默认：路跑比赛 4:00，65kg，上午
check('全马 4:00', {}, {
  total: 9, gelCount: 4, proCount: 5, carbRate: 60, totalCarb: 225, caffeineMg: 180, kcal: 905,
  seq: '赛前P 0:30G 1:00G 1:30G 2:00G 2:30P 2:50P 3:10P 3:30P'
});
check('全马 3:00', { minutes: 180 }, { total: 7, gelCount: 3, proCount: 4, seq: '赛前P 0:30G 1:00G 1:30G 2:00P 2:20P 2:40P' });
check('半马 2:00', { minutes: 120 }, { total: 4, gelCount: 2, proCount: 2, seq: '赛前P 0:30G 1:00G 1:30P' });
check('10 公里比赛 0:50', { minutes: 50 }, { total: 1, gelCount: 0, proCount: 1, carbRate: 0, seq: '赛前P' });
check('长距离训练 2:00', { scene: 'long', minutes: 120 }, { total: 2, carbRate: 30, seq: '开始前P 1:00G' });
check('高强度训练 0:45', { scene: 'hard', minutes: 45 }, { total: 1, seq: '0:25G' });
check('轻松训练 0:45，不用带胶', { scene: 'long', minutes: 45 }, { total: 0, reasons: ['不足 1 小时的运动，体内储备够用，一般不需要中途补给。'] });
check('越野比赛 8:00，70kg', { sport: 'trail', minutes: 480, kg: 70 }, {
  total: 14, gelCount: 4, proCount: 10, carbRate: 45,
  seq: '赛前P 0:40G 1:20G 2:00P 2:30G 3:10P 3:40G 4:20P 4:50P 5:20P 5:50P 6:20P 6:50P 7:20P'
});
check('越野 10:00，咖啡因敏感', { sport: 'trail', minutes: 600, caffeineSensitive: true }, { total: 20, gelCount: 0, caffeineMg: 0 });
check('骑行比赛 3:00，80kg', { sport: 'bike', minutes: 180, kg: 80 }, { carbRate: 75, total: 8, gelCount: 2, seq: '赛前P 0:30G 0:55P 1:15G 1:40P 2:00P 2:20P 2:40P' });
check('全马 4:00，下午、高温、第一次', { start: 'pm', hot: true, firstTime: true }, { carbRate: 45, total: 7, gelCount: 2, caffeineMg: 90, seq: '赛前P 0:40G 1:20G 2:00P 2:30P 3:00P 3:30P' });
check('全马 4:00，晚上，50kg', { start: 'night', kg: 50 }, { total: 12, gelCount: 0 });
check('徒步 5:00', { sport: 'hike', minutes: 300, scene: 'long' }, { carbRate: 45, total: 8, gelCount: 4, seq: '开始前P 0:40G 1:20G 2:00G 2:40G 3:20P 3:50P 4:20P' });

// 全组合检查：咖啡因不超过每公斤 3mg，相邻两支含咖啡因的间隔不小于 30 分钟，最多 20 支
let combos = 0;
for (const sport of ['road', 'trail', 'bike', 'hike']) {
  for (const scene of ['race', 'long', 'hard']) {
    for (let minutes = 30; minutes <= 600; minutes += 15) {
      for (const kg of [40, 65, 110]) {
        for (const start of ['am', 'pm', 'night']) {
          for (const caffeineSensitive of [false, true]) {
            for (const firstTime of [false, true]) {
              const r = planFuel({ sport, scene, minutes, kg, start, caffeineSensitive, firstTime });
              assert.ok(r.caffeineMg <= 3 * kg + 1e-9, '咖啡因超过每公斤 3mg');
              assert.ok(r.total <= 20, '支数超过 20');
              const gels = r.items.filter((i) => i.product === 'gel').map((i) => i.minute);
              for (let i = 1; i < gels.length; i++) assert.ok(gels[i] - gels[i - 1] >= 30, '含咖啡因的间隔小于 30 分钟');
              if (caffeineSensitive || start === 'night') assert.strictEqual(r.gelCount, 0);
              if (start === 'pm') assert.ok(r.gelCount <= 2);
              for (const it of r.items) assert.ok(it.minute < minutes, '补给时刻晚于结束时间');
              combos += 1;
            }
          }
        }
      }
    }
  }
}
console.log('通过：' + n + ' 个用例，' + combos + ' 种组合');
