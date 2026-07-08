const reminder = require('../../utils/reminder');
const app = getApp();

Page({
  data: {
    reminderEnabled: false,
    showClearConfirm: false,
    loading: false
  },

  onShow() {
    this.setData({
      reminderEnabled: reminder.isEnabled(),
    });
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },

  /** 开启/关闭过期提醒（本地版，不依赖云函数） */
  toggleReminder(e) {
    const nextEnabled = e && e.detail && typeof e.detail.value === 'boolean'
      ? e.detail.value
      : !this.data.reminderEnabled;

    if (!nextEnabled) {
      reminder.disableReminder();
      this.setData({ reminderEnabled: false });
      wx.showToast({ title: '已关闭提醒', icon: 'success' });
    } else {
      reminder.enableReminder();
      this.setData({ reminderEnabled: true });
      wx.showModal({
        title: '本地提醒已开启',
        content: '每天首次打开应用时，若有已过期或 3 天内即将过期的物品，会弹窗提醒你。\n\n点「今日不再提醒」可静音到第二天。',
        showCancel: false,
        confirmText: '好的',
      });
    }
  },

  showClearDialog() {
    this.setData({ showClearConfirm: true });
  },

  hideClearDialog() {
    this.setData({ showClearConfirm: false });
  },

  stopPropagation() {},

  showAbout() {
    wx.showModal({
      title: '用不过期',
      content: 'v1.0.0\n\n记录物品开启与过期时间，让生活更有条理。\n\n当前版本为纯本地存储，过期提醒为应用内弹窗。',
      showCancel: false,
      confirmText: '知道了'
    });
  },

  clearAllData() {
    wx.showModal({
      title: '危险操作',
      content: '确认清空所有物品数据？此操作不可恢复！',
      confirmText: '确认清空',
      confirmColor: '#ff4d4f',
      success: (res) => {
        if (res.confirm) {
          app.globalData.items = [];
          app.globalData.nextId = 1;
          wx.removeStorageSync('items');
          wx.removeStorageSync('addBatchDraft');
          this.setData({ showClearConfirm: false });
          wx.showToast({ title: '数据已清空', icon: 'success' });
        }
      }
    });
  },

  exportData() {
    const items = app.getItems('all');
    if (items.length === 0) {
      wx.showToast({ title: '暂无数据', icon: 'none' });
      return;
    }
    const statusText = { safe: '安全', warning: '临期', danger: '过期', used: '已用完' };
    const escapeCsv = (value) => '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';
    const csv = '名称,分类,开启日期,过期日期,限用天数,状态,存放位置,备注\n' +
      items.map(i => [
        i.name,
        i.category,
        i.openDate,
        i.expireDate,
        i.limitDays,
        statusText[i.status] || i.status,
        i.location || '',
        i.note || ''
      ].map(escapeCsv).join(',')).join('\n');

    wx.setClipboardData({
      data: csv,
      success: () => wx.showToast({ title: '已复制到剪贴板', icon: 'success' })
    });
  }
});
