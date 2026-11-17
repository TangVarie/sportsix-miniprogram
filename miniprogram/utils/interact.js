/**
 * 现场互动（大转盘、网页、其他小程序）的读取和抽奖。页面只经过这里调云函数。
 * 入口列表（正在进行的互动）跟着活动列表一起取，在 utils/events.js 的 getLive / getLiveFor。
 */
const cloud = require('./cloud.js');

/** 一个互动：{ interaction, blocked, mine }。blocked 是 ''（能参与）、not_member、not_signed */
function fetch(id) {
  if (!cloud.enabled()) return Promise.reject(Object.assign(new Error('no_backend'), { code: 'no_backend' }));
  return cloud.call('interaction', { id: id });
}

/** 大转盘抽一次：{ result: { n, win, prizeId, prizeName, code }, mine } */
function draw(id) {
  if (!cloud.enabled()) return Promise.reject(Object.assign(new Error('no_backend'), { code: 'no_backend' }));
  return cloud.call('draw', { id: id });
}

/**
 * 转盘上的格子：每个奖品后面跟一格「谢谢参与」，不到 6 格时整组重复，转盘不会太空。
 * 返回 [{ key, prizeId, label, thanks }]，prizeId 为空的是「谢谢参与」。
 */
function segments(prizes, thanks) {
  const one = [];
  (prizes || []).forEach((p) => {
    one.push({ prizeId: p.id, label: p.name, thanks: false });
    one.push({ prizeId: '', label: thanks, thanks: true });
  });
  if (!one.length) return [];
  let list = one.slice();
  while (list.length < 6) list = list.concat(one);
  return list.map((s, i) => Object.assign({ key: 's' + i }, s));
}

/**
 * 转到某个结果要停在的角度。current 是转盘现在的角度，至少再转 6 圈；
 * 落在对应格子的中间附近（左右留一点，不压线）。random 可以换成固定值方便测试。
 */
function stopAngle(list, result, current, random) {
  const rnd = random || Math.random;
  const want = result && result.win ? result.prizeId : '';
  const hits = list.map((s, i) => (s.prizeId === want ? i : -1)).filter((i) => i >= 0);
  const index = hits.length ? hits[Math.floor(rnd() * hits.length)] : 0;
  const size = 360 / list.length;
  const jitter = (rnd() - 0.5) * size * 0.6;
  // 指针在正上方：格子 i 的中心在 (i + 0.5) × size 度，转盘要转到让它回到 0 度
  const target = 360 - ((index + 0.5) * size + jitter);
  const base = Math.ceil((current || 0) / 360) * 360;
  return base + 360 * 6 + target;
}

module.exports = { fetch, draw, segments, stopAngle };
