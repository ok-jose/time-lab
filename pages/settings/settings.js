const app = getApp();

Page({
  data: {
    reminderEnabled: false,
    showClearConfirm: false
  },

  onShow() {
    this.setData({
      reminderEnabled: !!wx.getStorageSync('reminderSubscribed')
    });
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },

  async toggleReminder() {
    if (this.data.reminderEnabled) {
      wx.setStorageSync('reminderSubscribed', false);
      this.setData({ reminderEnabled: false });
      wx.showToast({ title: '已关闭提醒', icon: 'success' });
    } else {
      const success = await app.subscribeReminder();
      if (success) {
        this.setData({ reminderEnabled: true });
        wx.showToast({ title: '提醒已开启', icon: 'success' });
      } else {
        wx.showToast({ title: '需要授权才能接收提醒', icon: 'none' });
      }
    }
  },

  toggleCloudSync() {
    wx.showModal({
      title: '云同步',
      content: '当前版本为纯本地存储，数据仅保存在本设备。如需云端备份，请将数据导出到剪贴板后手动保存。',
      showCancel: false,
      confirmText: '知道了'
    });
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
      content: 'v1.0.0\n\n记录物品开启与过期时间，让生活更有条理。\n\n纯本地存储，数据安全不外泄。',
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
    const csv = '名称,分类,开启日期,过期日期,限用天数,状态,备注\n' +
      items.map(i => `"${i.name}","${i.category}","${i.openDate}","${i.expireDate}",${i.limitDays},"${i.status}","${i.note||''}"`).join('\n');

    wx.setClipboardData({
      data: csv,
      success: () => wx.showToast({ title: '已复制到剪贴板', icon: 'success' })
    });
  }
});