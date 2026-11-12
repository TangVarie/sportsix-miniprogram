/**
 * 定时任务，触发周期在 config.json 里（每 5 分钟）。做两件事：
 * 1. 活动报名开放后，给点过「提醒我」的用户各发一条订阅消息；
 * 2. 运营在后台对某场活动点了「通知」之后，给订阅了「有新活动通知我」的用户各发一条（见下面的 sendNews）。
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
  const news = await sendNews(now, MAX_PER_RUN - sent - failed);
  return { sent: sent, failed: failed, newsSent: news.sent, newsFailed: news.failed };
};

/**
 * 新活动通知。运营点「通知」时，api 云函数在活动上记了 notifyStatus: 'pending' 和 notifyAt（点的时间）。
 * 这里把 notifyAt 之前订阅的人逐个发完，再把活动记成 'done'。一次执行发不完的，下一次接着发。
 *
 * 订阅记录每人一条（news_subs，_id 是 openid），sent: false 表示手里还有一条额度。发送前同样先用条件更新领取，
 * 所以同一个人不会因为两次执行重叠收到两条。发完记 'sent' 或 'failed'；这期间用户又点了一次订阅的话，
 * 记录已经回到 'waiting'，不去动它。
 *
 * @param budget 这次执行还能发多少条
 */
async function sendNews(now, budget) {
  const total = { sent: 0, failed: 0 };
  let left = budget;
  const jobs = await db.collection('events').where({ status: 'published', notifyStatus: 'pending' }).limit(20).get();
  for (const e of jobs.data) {
    let sent = 0;
    let failed = 0;
    // 活动日期已经过了：剩下的不发了，直接收尾
    let finished = !!(ms(e.date) && ms(e.date) < now);
    const cutoff = new Date(ms(e.notifyAt) || now);
    while (!finished && left > 0) {
      let pending;
      try {
        pending = await db.collection('news_subs').where({ sent: false, subscribedAt: _.lte(cutoff) }).limit(PAGE).get();
      } catch (err) {
        pending = { data: [] }; // 集合还没建：没有人订阅
      }
      if (!pending.data.length) { finished = true; break; }
      for (const r of pending.data) {
        if (left <= 0) break;
        const claim = await db.collection('news_subs').where({ _id: r._id, sent: false })
          .update({ data: { sent: true, status: 'sending', eventId: e._id, claimedAt: db.serverDate() } });
        if (!claim.stats.updated) continue;
        left -= 1;

        let error = null;
        try {
          await cloud.openapi.subscribeMessage.send({
            touser: r.openid,
            templateId: r.templateId,
            page: template.page(e),
            miniprogramState: template.miniprogramState,
            lang: 'zh_CN',
            data: template.data(e, ms(e.memberSignupStart) || ms(e.signupStart) || now, template.TIP_NEW)
          });
          sent += 1;
        } catch (err) {
          error = String((err && (err.errCode || err.errMsg || err.message)) || err);
          failed += 1;
          console.error('news', r._id, error);
        }
        await db.collection('news_subs').where({ _id: r._id, status: 'sending' })
          .update({ data: { status: error ? 'failed' : 'sent', sentAt: db.serverDate(), error: error } });
      }
    }
    const data = { notifySent: _.inc(sent), notifyFailed: _.inc(failed) };
    if (finished) Object.assign(data, { notifyStatus: 'done', notifyDoneAt: db.serverDate() });
    await db.collection('events').doc(e._id).update({ data: data });
    total.sent += sent;
    total.failed += failed;
  }
  return total;
}
