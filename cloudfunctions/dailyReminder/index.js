const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/**
 * 每日过期提醒定时触发器
 * 触发器配置：每天上午 8:00 执行
 *
 * 该云函数会扫描所有物品，找出即将过期和已过期的，
 * 然后调用 sendSubscription 向已订阅的用户发送提醒。
 */
exports.main = async (event, context) => {
  try {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    // 查询所有订阅了提醒的用户
    const subscribers = await db.collection('subscriptions').get();

    // 查询所有物品
    const items = await db.collection('items').get();

    const alerts = {
      danger: [],   // 已过期
      warning: []   // 3天内过期
    };

    for (const item of items.data) {
      if (!item.expireDate) continue;
      const expireDate = new Date(item.expireDate);
      expireDate.setHours(0, 0, 0, 0);
      const daysLeft = Math.ceil((expireDate - now) / (1000 * 60 * 60 * 24));

      if (daysLeft < 0) {
        alerts.danger.push(item);
      } else if (daysLeft <= 3) {
        alerts.warning.push(item);
      }
    }

    // 如果有需要提醒的内容，发送给已订阅用户
    if ((alerts.danger.length > 0 || alerts.warning.length > 0) && subscribers.data.length > 0) {
      for (const sub of subscribers.data) {
        await cloud.callFunction({
          name: 'sendSubscription',
          data: {
            openid: sub._openid,
            alerts,
            templateId: sub.templateId
          }
        });
      }
    }

    return {
      success: true,
      checkedAt: now.toISOString(),
      dangerCount: alerts.danger.length,
      warningCount: alerts.warning.length,
      notifiedUsers: subscribers.data.length
    };
  } catch (err) {
    console.error('定时提醒执行失败:', err);
    return { success: false, error: err.message };
  }
};