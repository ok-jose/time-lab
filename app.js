App({
  globalData: {
    items: [],
    nextId: 1
  },

  onLaunch() {
    this.loadFromStorage();
    this.initCloud();
  },

  /** 初始化云开发（容错：未开通时静默，调用方根据 cloud.isCloudReady() 决定降级） */
  initCloud() {
    const config = require('./utils/cloudConfig');
    if (typeof wx === 'undefined' || !wx.cloud) {
      console.warn('当前微信版本过低，无法使用云开发');
      return;
    }
    if (!config.envId || config.envId.indexOf('__REPLACE') === 0) {
      console.warn('云开发 envId 未配置，云函数相关功能将不可用。详见 utils/cloudConfig.js');
      return;
    }
    try {
      wx.cloud.init({ env: config.envId, traceUser: true });
    } catch (e) {
      console.error('wx.cloud.init 失败:', e);
    }
  },

  /** 从本地存储加载数据 */
  loadFromStorage() {
    try {
      const stored = wx.getStorageSync('items');
      if (stored && Array.isArray(stored)) {
        this.globalData.items = stored;
        this.globalData.nextId = stored.reduce((max, i) => Math.max(max, i.id || 0), 0) + 1;
      }
    } catch (e) {
      console.error('加载本地存储失败:', e);
    }
  },

  /** 保存到本地存储 */
  saveToStorage() {
    try {
      wx.setStorageSync('items', this.globalData.items);
    } catch (e) {
      console.error('保存失败:', e);
    }
  },

  /** 添加物品（纯本地） */
  addItem(item) {
    item.id = this.globalData.nextId++;
    item.createdAt = new Date().toISOString();
    this.globalData.items.unshift(item);
    this.saveToStorage();
    return item;
  },

  /** 更新物品 */
  updateItem(id, updates) {
    const idx = this.globalData.items.findIndex(i => i.id === id);
    if (idx === -1) return null;
    const oldItem = this.globalData.items[idx];
    this.globalData.items[idx] = { ...oldItem, ...updates };
    this.saveToStorage();
    return this.globalData.items[idx];
  },

  /** 删除物品 */
  deleteItem(id) {
    this.globalData.items = this.globalData.items.filter(i => i.id !== id);
    this.saveToStorage();
  },

  /** 获取物品列表 */
  getItems(filter) {
    const items = this.globalData.items;
    const allowed = ['safe', 'warning', 'danger', 'used'];
    if (!filter || filter === 'all') return items;
    if (allowed.indexOf(filter) === -1) return items;
    return items.filter(i => i.status === filter);
  },

  /** 获取过期统计 */
  getAlertStats() {
    const items = this.globalData.items;
    return {
      warning: items.filter(i => i.status === 'warning').length,
      danger: items.filter(i => i.status === 'danger').length
    };
  },

  /** 订阅提醒消息（纯前端提醒） */
  subscribeReminder() {
    return new Promise((resolve) => {
      wx.showModal({
        title: '提醒设置',
        content: '本地提醒功能已开启，将在物品过期时在应用内通知您',
        showCancel: false,
        success: () => {
          wx.setStorageSync('reminderSubscribed', true);
          resolve(true);
        }
      });
    });
  }
});