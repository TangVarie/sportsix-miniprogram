/**
 * 定时任务：活动报名开放后，给点过「提醒我」的用户各发一条订阅消息。
 * 触发周期在 config.json 里（每 5 分钟）。
 *
 * 每条提醒只发一次：发送前先用条件更新把记录从 sent: false 改成 sent: true、status: 'sending'，
 * 只有改成功的那次执行才去发，所以两次执行重叠时不会重复发。发完再记成 'sent' 或 'failed'。
 * 如果执行在「领取」和「发完」之间中断，记录会停在 'sending'，不会自动重发（一次授权只有一条额度，宁可漏发不重发），
 * 在数据库里按 status 能查到。
 */
const cloud = require('wx-server-sdk');
const template = require('./template.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const PAGE = 100;
/** 一次执行最多发多少条，留在云函数的超时时间以内；剩下的下一次执行接着发 */
const MAX_PER_RUN = 300;
const ms = (d) => (d ? new Date(d).getTime() : null);

/** 活动日期还没过的已发布活动，分页取完 */
async function listEvents(now) {
  const all = [];
  for (let skip = 0; ; skip += PAGE) {
    const res = await db.collection('events')
      .where({ status: 'published', date: _.gte(new Date(now - 24 * 3600 * 1000)) })
      .orderBy('date', 'asc').skip(skip).limit(PAGE).get();
    all.push(...res.data);
    if (res.data.length < PAGE) return all;
  }
}

exports.main = async () => {
  const now = Date.now();
  let sent = 0;
  let failed = 0;

  for (const e of await listEvents(now)) {
    const opensAt = ms(e.memberSignupStart) || ms(e.signupStart);
    // 还没开放的不发；报名已经结束的也不再补发
    if (!opensAt || opensAt > now || (e.signupEnd && ms(e.signupEnd) < now)) continue;

    // 领取过的记录不再是 sent: false，所以每次都从头取，直到取不到为止
    while (sent + failed < MAX_PER_RUN) {
      const pending = await db.collection('reminders').where({ eventId: e._id, sent: false }).limit(PAGE).get();
      if (!pending.data.length) break;
      for (const r of pending.data) {
        if (sent + failed >= MAX_PER_RUN) break;
        // 领取：只有还是 sent: false 时才改得动
        const claim = await db.collection('reminders').where({ _id: r._id, sent: false })
          .update({ data: { sent: true, status: 'sending', claimedAt: db.serverDate() } });
        if (!claim.stats.updated) continue;

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
          // 用户取消了订阅、模板不匹配等：记下原因，不重试
          error = String((err && (err.errCode || err.errMsg || err.message)) || err);
          failed += 1;
          console.error('send', r._id, error);
        }
        await db.collection('reminders').doc(r._id).update({ data: { status: error ? 'failed' : 'sent', sentAt: db.serverDate(), error: error } });
      }
    }
  }
  return { sent: sent, failed: failed };
};
