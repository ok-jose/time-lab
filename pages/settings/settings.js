const cloud = require('../../utils/cloud');
const cloudConfig = require('../../utils/cloudConfig');
const app = getApp();

Page({
  data: {
    reminderEnabled: false,
    showClearConfirm: false,
    cloudReady: false,
    templateConfigured: false,
    loading: false
  },

  onShow() {
    this.setData({
      reminderEnabled: !!wx.getStorageSync('reminderSubscribed'),
      cloudReady: cloud.isCloudReady(),
      templateConfigured: !!(cloudConfig.subscriptionTemplateId &&
        cloudConfig.subscriptionTemplateId.indexOf('__REPLACE') !== 0)
    });
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },

  /** 开启/关闭过期提醒 */
  async toggleReminder() {
    if (this.data.reminderEnabled) {
      // 关闭
      this.setData({ loading: true });
      await cloud.removeSubscription();
      wx.removeStorageSync('reminderSubscribed');
      this.setData({ reminderEnabled: false, loading: false });
      wx.showToast({ title: '已关闭提醒', icon: 'success' });
      return;
    }

    // 开启流程
    if (!this.data.cloudReady) {
      wx.showModal({
        title: '需要先开通云开发',
        content: '过期提醒依赖云端定时器（每天 8:00 触发）。请先在微信开发者工具中开通云开发，并在 utils/cloudConfig.js 填入 envId。详见 CLOUD_SETUP.md。',
        confirmText: '我知道了',
        showCancel: false
      });
      return;
    }

    if (!this.data.templateConfigured) {
      wx.showModal({
        title: '需要订阅消息模板',
        content: '请先在微信公众平台申请订阅消息模板，把模板 ID 填到 utils/cloudConfig.js 的 subscriptionTemplateId。',
        confirmText: '我知道了',
        showCancel: false
      });
      return;
    }

    // 调 wx.requestSubscribeMessage 拉授权（一次性的，用户每次都得点）
    this.setData({ loading: true });
    let subResult = null;
    try {
      subResult = await wx.requestSubscribeMessage({
        tmplIds: [cloudConfig.subscriptionTemplateId]
      });
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: '订阅授权失败：' + (e.errMsg || '未知错误'), icon: 'none' });
      return;
    }
    const acceptKey = cloudConfig.subscriptionTemplateId;
    if (subResult && subResult[acceptKey] === 'accept') {
      // 用户点了同意
      const saveRes = await cloud.saveSubscription(cloudConfig.subscriptionTemplateId);
      if (saveRes.ok) {
        wx.setStorageSync('reminderSubscribed', true);
        this.setData({ reminderEnabled: true, loading: false });
        wx.showToast({ title: '提醒已开启', icon: 'success' });
      } else {
        this.setData({ loading: false });
        wx.showToast({ title: '保存订阅失败：' + saveRes.reason, icon: 'none' });
      }
    } else {
      // 用户拒绝 / 取消
      this.setData({ loading: false });
      const reason = subResult && subResult[acceptKey] || 'cancel';
      wx.showToast({ title: '已取消订阅（' + reason + '）', icon: 'none' });
    }
  },

  toggleCloudSync() {
    wx.showModal({
      title: '云同步',
      content: '当前版本为纯本地存储，数据仅保存在本设备。订阅消息的发送记录保存在云端，但物品数据本身仍在本机。',
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
      content: 'v1.0.0\n\n记录物品开启与过期时间，让生活更有条理。\n\n纯本地存储，订阅消息提醒走云端。',
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
