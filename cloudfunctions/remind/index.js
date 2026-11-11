/**
 * 定时任务：活动报名开放后，给点过「提醒我」的用户各发一条订阅消息。
 * 触发周期在 config.json 里（每 5 分钟）。一次性订阅消息一次授权只能发一条，发过就标记 sent。
 */
const cloud = require('wx-server-sdk');
const template = require('./template.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const ms = (d) => (d ? new Date(d).getTime() : null);

exports.main = async () => {
  const now = Date.now();
  const events = await db.collection('events').where({ status: 'published' }).limit(100).get();
  let sent = 0;
  let failed = 0;

  for (const e of events.data) {
    const opensAt = ms(e.memberSignupStart) || ms(e.signupStart);
    // 还没开放的不发；报名已经结束的也不再补发
    if (!opensAt || opensAt > now || (e.signupEnd && ms(e.signupEnd) < now)) continue;

    const pending = await db.collection('reminders').where({ eventId: e._id, sent: false }).limit(100).get();
    for (const r of pending.data) {
      let error = null;
      try {
        await cloud.openapi.subscribeMessage.send({
          touser: r.openid,
          templateId: r.templateId,
          page: template.page(e),
          miniprogramState: template.miniprogramState,
          lang: 'zh_CN',
          data: template.data(e, opensAt)
        });
        sent += 1;
      } catch (err) {
        // 用户取消了订阅、模板不匹配等：记下原因，不重试（一次授权只有一次机会）
        error = String((err && (err.errCode || err.errMsg || err.message)) || err);
        failed += 1;
        console.error('send', r._id, error);
      }
      await db.collection('reminders').doc(r._id).update({ data: { sent: true, sentAt: db.serverDate(), error: error } });
    }
  }
  return { sent: sent, failed: failed };
};
