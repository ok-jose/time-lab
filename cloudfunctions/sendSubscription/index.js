const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

/**
 * 发送订阅消息云函数
 * 向指定用户发送过期提醒推送
 *
 * 前置条件：
 * 1. 用户已在小程序内授权订阅消息
 * 2. 在微信公众平台申请了对应的订阅消息模板
 */
exports.main = async (event, context) => {
  const { openid, alerts } = event;

  if (!openid) {
    return { success: false, message: '缺少用户标识' };
  }

  try {
    const dangerItems = (alerts.danger || []).slice(0, 3);
    const warningItems = (alerts.warning || []).slice(0, 3);

    const messages = [];

    // 已过期提醒
    if (dangerItems.length > 0) {
      messages.push({
        touser: openid,
        templateId: event.templateId,
        page: '/pages/index/index',
        data: {
          thing1: { value: dangerItems.map(i => i.name).join('、') },
          number2: { value: dangerItems.length },
          date3: { value: dangerItems[0].expireDate },
          thing4: { value: '这些物品已过期，请及时处理' }
        }
      });
    }

    // 即将过期提醒
    if (warningItems.length > 0) {
      messages.push({
        touser: openid,
        templateId: event.templateId,
        page: '/pages/index/index',
        data: {
          thing1: { value: warningItems.map(i => i.name).join('、') },
          number2: { value: warningItems.length },
          date3: { value: warningItems[0].expireDate },
          thing4: { value: '这些物品即将过期，请尽快使用' }
        }
      });
    }

    // 发送订阅消息
    for (const msg of messages) {
      try {
        await cloud.openapi.subscribeMessage.send(msg);
      } catch (sendErr) {
        console.error('发送订阅消息失败:', sendErr.errCode, sendErr.errMsg);
      }
    }

    return {
      success: true,
      sentCount: messages.length,
      dangerCount: dangerItems.length,
      warningCount: warningItems.length
    };
  } catch (err) {
    console.error('发送提醒失败:', err);
    return { success: false, error: err.message };
  }
};