const util = require('../../utils/util');
const app = getApp();

Page({
  data: {
    item: null,
    progressPct: 0
  },

  onLoad(options) {
    const id = parseInt(options.id);
    if (!id) return;

    const item = app.globalData.items.find(i => i.id === id);
    if (item) {
      const daysLeft = util.calcDaysLeft(item.expireDate);
      const status = util.getStatus(daysLeft, item.used);
      const progressPct = this.calcProgress(item);

      this.setData({
        item: {
          ...item,
          daysLeft,
          status,
          daysText: util.getDaysText(daysLeft, item.used),
          createdAtDisplay: util.formatDateTime(item.createdAt)
        },
        progressPct
      });
    }
  },

  /** 计算时间线进度（处理未到开启日/已过期/已用完三种边界） */
  calcProgress(item) {
    if (item.used) return 100;
    if (!item.openDate || !item.expireDate) return 0;
    const open = new Date(item.openDate);
    const exp = new Date(item.expireDate);
    open.setHours(0, 0, 0, 0);
    exp.setHours(0, 0, 0, 0);
    if (isNaN(open) || isNaN(exp) || exp <= open) return 0;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const totalMs = exp - open;
    if (now <= open) return 0;
    if (now >= exp) return 100;
    return Math.round(((now - open) / totalMs) * 100);
  },

  previewPhoto() {
    if (this.data.item && this.data.item.photoPath) {
      wx.previewImage({
        urls: [this.data.item.photoPath],
        current: this.data.item.photoPath
      });
    }
  },

  markUsed() {
    const item = this.data.item;
    if (item.used) {
      wx.showToast({ title: '已标记为已用完', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '标记已用完',
      content: '将该物品标记为「已用完」后，它将保留记录但不再显示为过期状态。',
      confirmText: '标记',
      success: (res) => {
        if (res.confirm) {
          const updated = { ...item, used: true };
          app.updateItem(item.id, updated);
          const daysLeft = util.calcDaysLeft(item.expireDate);
          this.setData({
            item: {
              ...updated,
              daysLeft,
              status: 'used',
              daysText: '已用完',
              createdAtDisplay: item.createdAtDisplay
            },
            progressPct: 100
          });
          wx.showToast({ title: '已标记为已用完', icon: 'success' });
        }
      }
    });
  },

  unmarkUsed() {
    const item = this.data.item;
    if (!item.used) return;
    const updated = { ...item, used: false };
    app.updateItem(item.id, updated);
    const daysLeft = util.calcDaysLeft(item.expireDate);
    this.setData({
      item: {
        ...updated,
        daysLeft,
        status: util.getStatus(daysLeft, false),
        daysText: util.getDaysText(daysLeft, false),
        createdAtDisplay: item.createdAtDisplay
      },
      progressPct: this.calcProgress(updated)
    });
    wx.showToast({ title: '已恢复', icon: 'success' });
  },

  editItem() {
    wx.navigateTo({ url: `/pages/add/add?id=${this.data.item.id}` });
  },

  deleteItem() {
    const item = this.data.item;
    wx.showModal({
      title: '确认删除',
      content: '确定要删除「' + item.name + '」吗？此操作不可撤销。',
      confirmColor: '#d94535',
      success: (res) => {
        if (res.confirm) {
          app.deleteItem(item.id);
          wx.showToast({ title: '已删除', icon: 'success' });
          setTimeout(() => wx.navigateBack(), 1200);
        }
      }
    });
  }
});
