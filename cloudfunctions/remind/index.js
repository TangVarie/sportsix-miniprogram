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
 * 新活动通知。运营点「通知」时，api 云函数在活动上记了 notifyStatus: 'pending' 和这次登记的编号 notifyId，
 * 并把当时订阅着的人划给了这次登记（订阅记录 news_subs 每人一条，_id 是 openid，job 是划给了哪次登记，
 * sent: false 表示还没发）。这里把划给这次登记的人逐个发完，再把活动记成 'done'。一次执行发不完的，下一次接着发。
 *
 * 下面每一步都只认登记的编号：一场活动的登记被撤掉、后来又重新登记，是两个编号，
 * 慢了一步的旧操作碰不到新的登记，也碰不到划给新登记的人。
 *
 * - 发送前先用条件更新领取（还没发、而且还划在这次登记名下才领得到），所以两次执行重叠时同一个人不会收到两条，
 *   用户刚收到就又点了一次订阅时，新的那条也不会被这一场用掉。
 * - 查询或发送中途出错：这一场保持 'pending'，下一次执行接着发，不会当成发完。
 * - 活动下架了、日期过了、或者登记到一半中断了：停掉这一场，还没发到的人放回去留给下一场（见 stopNews）。
 *
 * @param budget 这次执行还能发多少条
 */
async function sendNews(now, budget) {
  const total = { sent: 0, failed: 0 };
  let left = budget;
  // 上一次执行停到一半的，先收尾
  const stopping = await db.collection('events').where({ notifyStatus: 'stopping' }).limit(20).get();
  for (const e of stopping.data) await stopNews(e, {});

  const jobs = await db.collection('events').where({ notifyStatus: 'pending' }).limit(20).get();
  for (const e of jobs.data) {
    const job = e.notifyId;
    if (!job) continue;
    // 登记到一半（人还没划好）：等它做完。两分钟还没做完，说明那次登记中断了，停掉
    if (typeof e.notifyTotal !== 'number') {
      if (now - (ms(e.notifyAt) || 0) > 2 * 60 * 1000) await stopNews(e, { notifyTotal: _.exists(false) });
      continue;
    }
    // 「该停」的条件写进 stopNews 的更新条件里：读到之后管理员刚好把活动上架回来或改了日期，就不停
    if (e.status !== 'published') { await stopNews(e, { status: e.status === undefined ? _.exists(false) : e.status }); continue; }
    if (ms(e.date) && ms(e.date) < now) { await stopNews(e, { date: e.date }); continue; }
    // 这次执行的额度用完了：这一场留到下一次，也不记「已经开始发」
    if (left <= 0) continue;
    // 记下「已经开始发了」。只有这次登记还在、活动还上架着才记得上；记不上说明刚被下架或停掉了，这次不发
    if (!e.notifyStarted) {
      const started = await db.collection('events').where({ _id: e._id, notifyId: job, status: 'published', notifyStatus: 'pending' }).update({ data: { notifyStarted: true } });
      if (!started.stats.updated) continue;
    }

    let sent = 0;
    let failed = 0;
    let finished = false;
    try {
      while (left > 0) {
        // 每取一批先看一眼活动：中途被下架或停掉了就不发了，剩下的由下一次执行收尾
        const cur = (await db.collection('events').where({ _id: e._id }).limit(1).get()).data[0];
        if (!cur || cur.notifyId !== job || cur.status !== 'published' || cur.notifyStatus !== 'pending') break;
        const pending = await db.collection('news_subs').where({ job: job, sent: false }).limit(PAGE).get();
        if (!pending.data.length) { finished = true; break; }
        for (const r of pending.data) {
          if (left <= 0) break;
          const claim = await db.collection('news_subs').where({ _id: r._id, sent: false, job: job })
            .update({ data: { sent: true, status: 'sending', claimedAt: db.serverDate() } });
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
          // 这期间用户又点了一次订阅的话，记录已经是新的一条（status 回到 'waiting'，job 是空的），不去动它
          await db.collection('news_subs').where({ _id: r._id, status: 'sending', job: job })
            .update({ data: { status: error ? 'failed' : 'sent', sentAt: db.serverDate(), error: error } });
        }
      }
    } catch (err) {
      // 数据库一时出错：不算发完，已经发出去的人数照常记，下一次执行接着发
      console.error('sendNews', e._id, err);
    }
    await db.collection('events').where({ _id: e._id, notifyId: job }).update({ data: { notifySent: _.inc(sent), notifyFailed: _.inc(failed) } });
    // 发完：只有这次登记还在 pending 才记成 done（中途被停掉的由 stopNews 收尾）
    if (finished) await db.collection('events').where({ _id: e._id, notifyId: job, notifyStatus: 'pending' }).update({ data: { notifyStatus: 'done', notifyDoneAt: db.serverDate() } });
    total.sent += sent;
    total.failed += failed;
  }
  return total;
}

/**
 * 停掉一次登记：还没发到的人放回去；还没开始发的当作没通知过（以后可以再通知），已经开始的记成发完。
 *
 * 分三步，每一步都带着这次登记的编号：
 * 1. 把登记从 'pending' 改成 'stopping'。只有它确实还该停才改得上：why 是「该停」的条件
 *    （比如 { status: 'draft' }），所以管理员刚好把活动上架回来的话，这里改不上，什么都不做。
 *    改上以后「开始发」那一步就记不上了（它要求 'pending'），两边不会同时成立。
 * 2. 把划给这次登记、还没发的人放回去。
 * 3. 收尾：没开始发过的撤掉登记，开始过的记成 'done'。
 * 第 1 步之后中断了也没关系：活动停在 'stopping'，下一次执行从第 2 步接着做。
 */
async function stopNews(e, why) {
  const job = e.notifyId;
  const events = db.collection('events');
  if (e.notifyStatus === 'pending') {
    const own = await events.where(Object.assign({ _id: e._id, notifyId: job, notifyStatus: 'pending' }, why)).update({ data: { notifyStatus: 'stopping' } });
    if (!own.stats.updated) return;
  }
  await db.collection('news_subs').where({ job: job, sent: false }).update({ data: { eventId: '', job: '' } });
  const gone = {
    notifyStatus: _.remove(), notifyId: _.remove(), notifyAt: _.remove(), notifyBy: _.remove(),
    notifySent: _.remove(), notifyFailed: _.remove(), notifyTotal: _.remove()
  };
  const reset = await events.where({ _id: e._id, notifyId: job, notifyStatus: 'stopping', notifyStarted: _.exists(false) }).update({ data: gone });
  if (reset.stats.updated) return;
  await events.where({ _id: e._id, notifyId: job, notifyStatus: 'stopping' }).update({ data: { notifyStatus: 'done', notifyDoneAt: db.serverDate() } });
}
