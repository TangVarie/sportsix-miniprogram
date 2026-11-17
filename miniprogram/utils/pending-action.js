/** 登录意图仅在本次使用期间保留。switchTab 会销毁详情页，因此放在独立模块里。 */
let pending = null;
const TTL = 30 * 60 * 1000;

/** 没登录时点了报名：加入完回到这场活动，由用户再点一次确认 */
function setSignup(eventId) {
  pending = eventId ? { type: 'signup', eventId: String(eventId), createdAt: Date.now() } : null;
}

/** 只对会员开放的现场互动：加入完回到这个互动 */
function setInteract(id) {
  pending = id ? { type: 'interact', id: String(id), createdAt: Date.now() } : null;
}

function take() {
  const action = pending;
  pending = null;
  return action && Date.now() - action.createdAt < TTL ? action : null;
}

function clear() { pending = null; }

module.exports = { setSignup, setInteract, take, clear };
