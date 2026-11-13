const copy = require('../content/client-state.js');
const member = require('../content/member.js');

const time = (value) => value ? new Date(value).getTime() : 0;

/** 与云端报名采用相同边界，页面状态只用于展示，提交仍由云端校验。 */
function eventState(event, flags, now) {
  const e = event && (event.raw || event) || {};
  const state = flags || {};
  const at = now == null ? Date.now() : now;
  const date = time(e.date);
  const cutoff = Math.min(time(e.signupEnd) || Infinity, date || Infinity);
  const opens = time(e.memberSignupStart) || time(e.signupStart);
  let key = 'open';
  if (e.cancelled) key = 'cancelled';
  else if (e.status && e.status !== 'published') key = 'unavailable';
  else if (date && at >= date) key = 'ended';
  else if (at >= cutoff) key = 'closed';
  else if (opens && at < opens) key = 'not_open';
  else if (typeof e.quota === 'number' && (e.signupCount || 0) >= e.quota) key = 'full';
  else if (event && event.readOnly) key = 'unavailable';
  const label = copy.events.states[key];
  return {
    key,
    label,
    canSignup: key === 'open' && !state.signed,
    canRemind: key === 'not_open' && !state.reminded && !state.signed,
    signupLabel: key === 'cancelled' || key === 'unavailable' ? label : state.signed ? member.me.events.states[0] : label,
    reminderLabel: state.reminded ? member.me.events.states[1] : key === 'not_open' ? copy.events.remind : key === 'open' ? copy.events.remindOpen : label,
    readOnly: ['ended', 'unavailable', 'closed', 'cancelled'].indexOf(key) >= 0
  };
}

module.exports = { eventState };
