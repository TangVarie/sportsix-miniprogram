/**
 * SPORTSIX 分段补给计算
 *
 * 纯函数，不依赖小程序 API，可直接放进小程序的 utils 目录使用。
 * 公式说明见 docs/03-fuel-formula.md；本文件是公式的唯一实现，页面只负责收集输入和展示结果。
 *
 * 产品数据（每支 45g）：
 *   能量胶      碳水 30g，咖啡因 45mg，能量 120 千卡
 *   能量胶PRO   碳水 21g，咖啡因 0，  能量 85 千卡
 */

const GEL = { key: 'gel', name: '能量胶', carb: 30, caffeine: 45, kcal: 120 };
const PRO = { key: 'pro', name: 'PRO', fullName: '能量胶PRO', carb: 21, caffeine: 0, kcal: 85 };

/**
 * 项目。页面上排成两行三列。
 * steady: 不分强度的项目（徒步、登山、滑雪），页面上不显示「强度」一行，每小时碳水用各自的 rates。
 * rates: [1–2.5 小时, 2.5 小时以上] 的每小时碳水（g）。依据是通行的运动营养建议（ACSM、ISSN）：
 *        运动 1–2.5 小时每小时 30–60g，更长的 60g 起；强度低或间歇性的取下限，强度高的取上限。
 *   徒步  30 / 45  持续的中低强度（原有取值）
 *   登山  45 / 60  负重爬升，中到高强度，海拔高时更依赖糖
 *   滑雪  30 / 30  滑一段、坐一段缆车，间歇性的中等强度，取下限，时间再长也不加
 * note: 这个项目特有的一条说明。
 */
const SPORTS = [
  { key: 'road', label: '路跑', defaultMinutes: 240 },
  { key: 'trail', label: '越野', defaultMinutes: 480 },
  { key: 'bike', label: '骑行', defaultMinutes: 180 },
  { key: 'hike', label: '徒步', defaultMinutes: 300, steady: true, rates: [30, 45] },
  { key: 'climb', label: '登山', defaultMinutes: 360, steady: true, rates: [45, 60], note: '登山负重爬升比平路徒步更耗糖，海拔高了又容易没胃口，按时间表小口吃。' },
  { key: 'ski', label: '滑雪', defaultMinutes: 240, steady: true, rates: [30, 30], note: '滑雪是滑一段歇一段，坐缆车、排队的空档最适合补给。' }
];
/**
 * 强度，从轻到重。时长是单独的一项输入，所以这里只说强度，不再用「长距离」这种和时长重叠的说法。
 * key 沿用原来的（long 原来叫「长距离训练」），已保存的计划照常能用。
 * hint 是选中时显示在下面的一句说明，用通行的两个标准来界定：说话测试，和心率占最大心率的比例
 * （中等强度约 64–76%，较大强度约 77% 以上；这里取整为 60–75% 和 80% 以上）。
 */
const SCENES = [
  { key: 'long', label: '轻松训练', hint: '能完整说话，心率约为最大心率的 60% 到 75%' },
  { key: 'hard', label: '高强度训练', hint: '只能说短句，心率在最大心率的 80% 以上' },
  { key: 'race', label: '比赛', hint: '正式比赛，或全力完成的计时测试' }
];
const sportOf = (key) => SPORTS.find((x) => x.key === key) || SPORTS[0];
const isSteady = (sport) => !!sportOf(sport).steady;
const STARTS = [
  { key: 'am', label: '上午' },
  { key: 'pm', label: '下午' },
  { key: 'night', label: '晚上' }
];

const WEATHERS = [
  { key: 'normal', label: '常温' },
  { key: 'hot', label: '高温' },
  { key: 'cold', label: '低温' },
  { key: 'rain', label: '雨天' }
];

/** 输入范围与默认值 */
const LIMITS = { minMinutes: 30, maxMinutes: 600, minutesStep: 15, minKg: 40, maxKg: 110, kgStep: 5 };
const DEFAULT_INPUT = { sport: 'road', scene: 'race', minutes: 240, kg: 65, start: 'am', caffeineSensitive: false, hot: false, weather: 'normal', firstTime: false };

function formatTime(m) {
  return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0');
}

/** 把间隔取整到 5 分钟，最短 20 分钟 */
function roundInterval(x) {
  return Math.max(20, Math.round(x / 5) * 5);
}

/**
 * 第一步：每小时碳水目标（g/小时）
 * 不足 60 分钟为 0，表示不安排按节奏的中途补给。
 */
function carbRate(input) {
  const T = input.minutes;
  if (T < 60) return 0;
  const long = T >= 150;
  let rate;
  if (isSteady(input.sport)) rate = sportOf(input.sport).rates[long ? 1 : 0];
  else if (input.scene === 'race') rate = long && input.sport === 'bike' && T < 360 ? 75 : 60;
  else if (input.scene === 'hard') rate = long ? 60 : 45;
  else rate = long ? 45 : 30;
  if (T >= 360) rate = Math.min(rate, 45);
  if (input.firstTime) rate = Math.min(rate, 45);
  return rate;
}

/**
 * 第二步：含咖啡因的能量胶最多几支
 * 每公斤体重 3mg 封顶，总量不超过 400mg；下午出发或第一次用胶最多 90mg；
 * 晚上出发或咖啡因敏感为 0。
 */
function caffeineCap(input) {
  let capMg = Math.min(3 * input.kg, 400);
  if (input.start === 'pm' || input.firstTime) capMg = Math.min(capMg, 90);
  if (input.caffeineSensitive || input.start === 'night') capMg = 0;
  return { capMg: capMg, capCount: Math.floor(capMg / GEL.caffeine) };
}

/**
 * 主函数
 * @param {object} input  { sport, scene, minutes, kg, start, caffeineSensitive, weather, firstTime }
 *                        weather: 'normal' | 'hot' | 'cold' | 'rain'，只影响说明，不改支数。hot: true 是旧的写法，等同于 weather: 'hot'
 * @returns {object} 见文件末尾的返回值说明
 */
function planFuel(input) {
  input = Object.assign({}, DEFAULT_INPUT, input);
  // 不分强度的项目统一按「轻松训练」算，不让页面上看不见的选项影响结果
  if (isSteady(input.sport)) input.scene = 'long';
  const T = input.minutes;
  const rate = carbRate(input);
  const cap = caffeineCap(input);
  const capN = cap.capCount;

  // 第三步：排时间表
  const items = [];
  const hasPre = T >= 60 || input.scene === 'race';
  if (hasPre) items.push({ minute: -30, product: 'pro' });

  let used = 0;
  let lastCaf = -999;
  const early = 0.6 * T; // 含咖啡因的能量胶只排在前 60% 的时段
  const takeGel = (t) => {
    if (used >= capN || t > early || t - lastCaf < 30) return false;
    if (t + 0.001 < used * (early / capN)) return false; // 支数少于可排位置时，在前 60% 里均匀分开
    used += 1;
    lastCaf = t;
    return true;
  };

  if (rate > 0) {
    const firstIsGel = takeGel(30);
    if (firstIsGel) { used -= 1; lastCaf = -999; }
    let t = roundInterval((firstIsGel ? GEL.carb : PRO.carb) / rate * 60);
    if (t < 30 && firstIsGel) t = 30;
    while (t <= T - 15) { // 结束前 15 分钟内不再安排
      const g = takeGel(t);
      items.push({ minute: t, product: g ? 'gel' : 'pro' });
      t += roundInterval((g ? GEL.carb : PRO.carb) / rate * 60);
    }
  } else if (input.scene === 'hard' && T >= 40) {
    // 不足 1 小时的高强度训练：中段补 1 支
    const t = Math.round(T / 10) * 5;
    items.push({ minute: t, product: takeGel(t) ? 'gel' : 'pro' });
  }

  const gelCount = items.filter((i) => i.product === 'gel').length;
  const proCount = items.length - gelCount;
  const preLabel = input.scene === 'race' ? '赛前' : '开始前';

  const result = {
    input: input,
    carbRate: rate,
    caffeineCapMg: cap.capMg,
    caffeineCapCount: capN,
    total: items.length,
    gelCount: gelCount,
    proCount: proCount,
    totalCarb: gelCount * GEL.carb + proCount * PRO.carb,
    caffeineMg: gelCount * GEL.caffeine,
    caffeinePerKg: Math.round(gelCount * GEL.caffeine / input.kg * 10) / 10,
    kcal: gelCount * GEL.kcal + proCount * PRO.kcal,
    durationLabel: formatTime(T),
    items: items.map((i) => ({
      minute: i.minute,
      label: i.minute < 0 ? preLabel : formatTime(i.minute),
      product: i.product,
      productName: i.product === 'gel' ? GEL.name : PRO.name,
      // 时间轴上的位置：开始前的那支在 0%，出发点在 8%，结束在 100%
      position: i.minute < 0 ? 0 : Math.round((8 + i.minute / T * 92) * 10) / 10
    }))
  };
  result.reasons = explain(result);
  return result;
}

/** 「为什么这样排」的说明，最多 6 条 */
function explain(r) {
  const s = r.input;
  const sport = SPORTS.find((x) => x.key === s.sport).label;
  const scene = SCENES.find((x) => x.key === s.scene).label;
  const why = [];
  if (r.total === 0) {
    why.push('不足 1 小时的运动，体内储备够用，一般不需要中途补给。');
    return why;
  }
  if (r.carbRate > 0) {
    // 第一句只报每小时多少克。原来后面还跟着一句通用的范围（「更长的 60g 起」），和按强度、项目取的低值对不上，去掉了；
    // 依据写在页面底部的说明和 docs/03-fuel-formula.md 里
    why.push(r.durationLabel + ' 的' + (isSteady(s.sport) ? sport : sport + scene) + '，按每小时约 ' + r.carbRate + 'g 碳水安排。');
    // 登山、滑雪各有一条针对项目的说明
    const note = sportOf(s.sport).note;
    if (note) why.push(note);
  } else {
    why.push('不足 1 小时，只在' + (s.scene === 'race' ? '赛前' : '中段') + '补 1 支。');
  }
  if (s.minutes >= 360) why.push('超过 6 小时，胶按每小时约 ' + r.carbRate + 'g 排，其余靠补给站和固体食物。');
  if (r.items[0].minute < 0) why.push('开始前 30 分钟先吃 1 支 PRO 打底，它不含咖啡因，HBCD 排空快，不坠胃。');
  if (r.gelCount > 0) {
    why.push('体重 ' + s.kg + 'kg，含咖啡因的能量胶不超过 ' + r.caffeineCapCount + ' 支（' + r.caffeineCapCount * 45 + 'mg，每公斤约 ' +
      (r.caffeineCapCount * 45 / s.kg).toFixed(1) + 'mg），间隔至少 30 分钟。');
  }
  if (s.start === 'pm' && !s.caffeineSensitive) why.push('下午出发，含咖啡因的最多 2 支，避免影响晚上睡眠。');
  if (s.start === 'night') why.push('晚上出发，全程用 0 咖啡因的 PRO。');
  if (s.caffeineSensitive) why.push('咖啡因敏感，全程用 0 咖啡因的 PRO。');
  if (r.gelCount > 0 && r.proCount > 1) why.push('含咖啡因的能量胶排在前 60% 的时段，后程换 PRO，它甜度低 26%，肠胃负担更轻。');
  const weather = s.hot ? 'hot' : s.weather;
  if (weather === 'hot') why.push('高温天出汗多，每支胶的钠只有 20 到 25mg，电解质要另外补。');
  if (weather === 'cold') why.push('低温天口渴感弱，容易漏掉补给，按时间表吃。');
  if (weather === 'rain') why.push('雨天体感凉、口渴感弱，容易漏掉补给，按时间表吃。');
  if (s.firstTime) why.push('第一次用胶，先在训练里试，从半支开始。比赛日不换没练过的补给。');
  return why.slice(0, 6);
}

/*
 * 返回值
 * {
 *   total, gelCount, proCount     带几支
 *   totalCarb, caffeineMg, caffeinePerKg, kcal
 *   carbRate                      每小时碳水目标（g）
 *   caffeineCapMg, caffeineCapCount
 *   durationLabel                 '4:00'
 *   items: [{ minute, label, product: 'gel' | 'pro', productName, position }]
 *   reasons: [string]
 * }
 * total 为 0 时页面显示「这次不用带胶」。
 */

module.exports = { planFuel, carbRate, caffeineCap, explain, formatTime, isSteady, GEL, PRO, SPORTS, SCENES, STARTS, WEATHERS, LIMITS, DEFAULT_INPUT };
