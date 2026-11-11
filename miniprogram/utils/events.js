/**
 * 活动数据和「提醒我」。
 *
 * 第一版数据来自打进包里的 content/events：past 是真实的往期赛事，upcoming 是三种卡片样式的占位示例。
 * 后台方案定了以后，把 listUpcoming / getEvent 换成接口请求，返回的形状保持不变（docs/05-dev-plan.md）。
 */
const config = require('../config.js');
const content = require('../content/events.js');
const store = require('./store.js');
const { withAssets } = require('./assets.js');

function listUpcoming() {
  if (!config.sampleEvents) return [];
  return withAssets(content.upcoming).map((e, i) => Object.assign({ id: 'sample-' + i }, e));
}

function listPast() {
  return withAssets(content.past);
}

function getEvent(id) {
  const list = listUpcoming();
  return list.find((e) => e.id === id) || list[0] || null;
}

/** 活动详情页的固定文案和字段（目前全部是占位） */
function getDetail() {
  return withAssets(content.detail);
}

/**
 * 「提醒我」：一次性订阅消息，用户每点一次授权换一条通知，所以必须由点击直接触发。
 * 模板 ID 还没申请时只在本机记录，不会真的发消息。
 * @returns {Promise<boolean>} 是否已设提醒
 */
function remind(eventId) {
  return new Promise((resolve) => {
    const tmpl = config.subscribeTemplateId;
    if (!tmpl) {
      store.addReminder(eventId);
      resolve(true);
      return;
    }
    wx.requestSubscribeMessage({
      tmplIds: [tmpl],
      success: (res) => {
        if (res[tmpl] !== 'accept') { resolve(false); return; }
        // 待接后台：把 { openid, eventId, templateId } 登记到「提醒」表，报名开放时由后台发送
        store.addReminder(eventId);
        resolve(true);
      },
      fail: () => resolve(false)
    });
  });
}

module.exports = { listUpcoming, listPast, getEvent, getDetail, remind, hasReminder: store.hasReminder };
