// utils/reminder.js
// 本地过期提醒（不依赖云函数 / 订阅消息）
//
// 设计原则（PRD 风险 R3「推送疲劳」防御）：
//   1. 每天首次进入首页才弹 1 次
//   2. 合并信息：1 个 modal「X 件过期 + Y 件 3 天内过期」
//   3. 用户可点「今日不再提醒」提前静音到第二天
//   4. 总开关：reminderSubscribed=false 直接不弹
//
// 触发时机：app.onShow（首页是 tabBar 第一项，用户每日主入口）
//
// 状态存储（localStorage）：
//   reminderSubscribed         bool   总开关
//   reminderLastShownDate     string 'YYYY-MM-DD' 今天是否弹过
//   reminderSnoozeDate        string 'YYYY-MM-DD' 用户手动静音到哪一天

const util = require('./util');

const KEY_ENABLED = 'reminderSubscribed';
const KEY_LAST_SHOWN = 'reminderLastShownDate';
const KEY_SNOOZE = 'reminderSnoozeDate';

/** YYYY-MM-DD 格式今天 */
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 找出过期 + 3 天内即将过期的物品 */
function getAlertItems(items) {
  const danger = [];
  const warning = [];
  for (const item of items) {
    if (!item.expireDate) continue;
    const daysLeft = util.calcDaysLeft(item.expireDate);
    const status = util.getStatus(daysLeft, item.used);
    if (status === 'danger') danger.push(item);
    else if (status === 'warning') warning.push(item);
  }
  return { danger, warning };
}

/** 是否应该今天弹？ */
function shouldShowToday() {
  if (!wx.getStorageSync(KEY_ENABLED)) return false;
  const today = todayKey();
  if (wx.getStorageSync(KEY_LAST_SHOWN) === today) return false; // 今天已弹
  if (wx.getStorageSync(KEY_SNOOZE) === today) return false; // 用户今日静音
  return true;
}

/** 标记今天已弹 */
function markShownToday() {
  wx.setStorageSync(KEY_LAST_SHOWN, todayKey());
}

/** 标记今日不再提醒（用户点了 modal 的"今日不再提醒"） */
function snoozeToday() {
  wx.setStorageSync(KEY_SNOOZE, todayKey());
}

/** 弹提醒 modal */
function showReminderModal(dangerCount, warningCount) {
  let title = '过期提醒';
  let content = '';
  if (dangerCount > 0 && warningCount > 0) {
    title = '有物品需要关注';
    content = `${dangerCount} 件已过期，${warningCount} 件 3 天内即将过期。\n\n建议尽快处理。`;
  } else if (dangerCount > 0) {
    content = `${dangerCount} 件物品已过期，建议尽快处理。`;
  } else if (warningCount > 0) {
    content = `${warningCount} 件物品将在 3 天内过期，建议尽快使用。`;
  } else {
    return; // 没有任何过期
  }

  wx.showModal({
    title,
    content,
    confirmText: '去看下',
    cancelText: '今日不再提醒',
    success: (res) => {
      if (res.confirm) {
        const targetFilter = dangerCount > 0 ? 'danger' : 'warning';
        getApp().globalData._reminderFilter = targetFilter;

        // 如果当前已经在首页，直接切筛选，避免 switchTab success 与首页 onShow 的时序竞争
        const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
        const current = pages[pages.length - 1];
        if (current && current.route === 'pages/index/index') {
          current.setData({ currentFilter: targetFilter });
          if (typeof current.loadItems === 'function') current.loadItems();
          return;
        }

        // 跳转到首页并自动切到「过期」或「即将过期」tab
        wx.switchTab({ url: '/pages/index/index' });
      } else if (res.cancel) {
        snoozeToday();
      }
    },
  });
}

/** 主入口：检查并弹提醒（在首页 onShow 调用） */
function checkAndShow(items) {
  if (!shouldShowToday()) return;
  const { danger, warning } = getAlertItems(items);
  if (danger.length === 0 && warning.length === 0) return;
  markShownToday();
  showReminderModal(danger.length, warning.length);
}

/** 开启本地提醒（settings 入口调用） */
function enableReminder() {
  wx.setStorageSync(KEY_ENABLED, true);
  wx.removeStorageSync(KEY_SNOOZE);
}

/** 关闭本地提醒 */
function disableReminder() {
  wx.setStorageSync(KEY_ENABLED, false);
}

function isEnabled() {
  return !!wx.getStorageSync(KEY_ENABLED);
}

module.exports = {
  todayKey,
  getAlertItems,
  shouldShowToday,
  markShownToday,
  snoozeToday,
  showReminderModal,
  checkAndShow,
  enableReminder,
  disableReminder,
  isEnabled,
};
