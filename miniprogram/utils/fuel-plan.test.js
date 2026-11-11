/**
 * 运行：node reference/fuel-plan.test.js
 * 这些用例是设计稿里公式的预期结果，改公式时先改这里。
 */
const assert = require('assert');
const { planFuel, carbRate, SPORTS, SCENES } = require('./fuel-plan.js');

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
check('轻松训练 2:00', { scene: 'long', minutes: 120 }, { total: 2, carbRate: 30, seq: '开始前P 1:00G' });
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

// 下面两组时间表是按上面的每小时碳水、用和其他项目同一套排法排出来的
const SKI_240 = { total: 5, gelCount: 2, seq: '开始前P 1:00G 2:00G 3:00P 3:40P' };
const CLIMB_240 = { total: 9, gelCount: 4, seq: '开始前P 0:30G 1:00G 1:30G 2:00G 2:30P 2:50P 3:10P 3:30P' };

// 项目：六个，排成两行三列。徒步、登山、滑雪不分强度（steady），各有自己的每小时碳水：
//   徒步  30 / 45（原有）
//   登山  45 / 60：负重爬升是中到高强度，取推荐范围（1–2.5 小时 30–60g，更长 60g 起）的中上段
//   滑雪  30 / 30：滑一段、坐一段缆车，是间歇性的中等强度，取范围的下限，时间再长也不加
// 超过 6 小时一律不超过 45（原有的规则）
assert.deepStrictEqual(SPORTS.map((s) => s.label), ['路跑', '越野', '骑行', '徒步', '登山', '滑雪'], '项目的顺序和名称');
assert.deepStrictEqual(SPORTS.filter((s) => s.steady).map((s) => s.key), ['hike', 'climb', 'ski'], '不分强度的项目');
const rate = (sport, minutes) => carbRate({ sport: sport, scene: 'long', minutes: minutes });
assert.deepStrictEqual([90, 240, 360].map((m) => rate('hike', m)), [30, 45, 45], '徒步每小时碳水');
assert.deepStrictEqual([90, 240, 360, 480].map((m) => rate('climb', m)), [45, 60, 45, 45], '登山每小时碳水');
assert.deepStrictEqual([90, 240, 360, 480].map((m) => rate('ski', m)), [30, 30, 30, 30], '滑雪每小时碳水');
assert.strictEqual(rate('climb', 45), 0, '不足 1 小时不排');
check('滑雪 4:00', { sport: 'ski', minutes: 240 }, { carbRate: 30, total: SKI_240.total, gelCount: SKI_240.gelCount, seq: SKI_240.seq });
check('登山 4:00', { sport: 'climb', minutes: 240 }, { carbRate: 60, total: CLIMB_240.total, gelCount: CLIMB_240.gelCount, seq: CLIMB_240.seq });
check('登山 6:00', { sport: 'climb', minutes: 360 }, { carbRate: 45, total: 10, gelCount: 4 });
check('滑雪 1:30', { sport: 'ski', minutes: 90 }, { carbRate: 30 });
for (const sport of ['hike', 'climb', 'ski']) {
  const base = seq(planFuel({ sport: sport, scene: 'long', minutes: 300 }));
  for (const scene of ['race', 'hard']) {
    assert.strictEqual(seq(planFuel({ sport: sport, scene: scene, minutes: 300 })), base, sport + ' 不分强度：选什么强度结果都一样');
  }
}
assert.strictEqual(planFuel({ sport: 'ski', minutes: 240 }).reasons[0], '4:00 的滑雪，按每小时约 30g 碳水安排。', '滑雪的说明里不带强度');
assert.ok(planFuel({ sport: 'ski', minutes: 240 }).reasons[1].indexOf('缆车') > 0, '滑雪多一条针对这个项目的说明');
assert.ok(planFuel({ sport: 'climb', minutes: 240 }).reasons[1].indexOf('登山') === 0, '登山多一条针对这个项目的说明');
assert.ok(planFuel({ sport: 'hike', minutes: 300 }).reasons[0].indexOf('5:00 的徒步，按每小时约 45g 碳水安排：') === 0, '徒步的说明不变');
assert.ok(planFuel({ sport: 'ski', minutes: 420 }).reasons.indexOf('超过 6 小时，胶按每小时约 30g 排，其余靠补给站和固体食物。') > 0, '超过 6 小时的那句用实际的数');
assert.ok(planFuel({ sport: 'trail', minutes: 480 }).reasons.indexOf('超过 6 小时，胶按每小时约 45g 排，其余靠补给站和固体食物。') > 0, '其他项目超过 6 小时的那句不变');
assert.ok(planFuel({ sport: 'ski', minutes: 45, scene: 'race' }).total === 0, '不足 1 小时的滑雪不用带胶');
n += 12;

// 强度：三档，从轻到重。key 不变（long、hard、race），已保存的计划照常能用；每档带一句说明
assert.deepStrictEqual(SCENES.map((s) => s.key + ':' + s.label), ['long:轻松训练', 'hard:高强度训练', 'race:比赛'], '强度的顺序和名称');
assert.ok(SCENES.every((s) => typeof s.hint === 'string' && s.hint.length > 0), '每档强度都有一句说明');
assert.ok(SCENES[0].hint.indexOf('60–75%') > 0 && SCENES[1].hint.indexOf('80%') > 0, '轻松和高强度用说话测试和心率区间来界定');
assert.ok(planFuel({ scene: 'long', minutes: 120 }).reasons[0].indexOf('2:00 的路跑轻松训练，') === 0, '说明里用新的叫法');
n += 3;

// 天气：高温、低温、雨天只多一条说明，不改支数。hot: true 是旧的写法，等同于 weather: 'hot'
const says = (input, text) => planFuel(input).reasons.some((x) => x.indexOf(text) >= 0);
check('全马 4:00，雨天', { weather: 'rain' }, { total: 9, gelCount: 4, proCount: 5, caffeineMg: 180 });
check('全马 4:00，低温', { weather: 'cold' }, { total: 9, gelCount: 4, proCount: 5, caffeineMg: 180 });
check('全马 4:00，高温', { weather: 'hot' }, { total: 9, gelCount: 4, proCount: 5, caffeineMg: 180 });
assert.ok(says({ weather: 'rain' }, '雨天'), '雨天要有一条说明');
assert.ok(says({ weather: 'cold' }, '低温'), '低温要有一条说明');
assert.ok(says({ weather: 'hot' }, '高温天出汗多'), '高温要有一条说明');
assert.ok(says({ hot: true }, '高温天出汗多'), '旧的 hot: true 仍然有效');
assert.ok(!says({}, '雨天') && !says({}, '低温') && !says({}, '高温'), '常温没有天气说明');
assert.ok(!says({ weather: 'rain' }, '高温') && !says({ weather: 'cold' }, '雨天'), '只出现所选天气的说明');
n += 6;

// 全组合检查：咖啡因不超过每公斤 3mg，相邻两支含咖啡因的间隔不小于 30 分钟，最多 20 支
let combos = 0;
for (const sport of SPORTS.map((s) => s.key)) {
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
