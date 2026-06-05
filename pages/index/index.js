const util = require('../../utils/util');
const app = getApp();

// 排序方式定义：键 -> 排序函数
const SORTERS = {
  expireAsc: (a, b) => (a.expireDate || '').localeCompare(b.expireDate || ''),
  expireDesc: (a, b) => (b.expireDate || '').localeCompare(a.expireDate || ''),
  createdDesc: (a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''),
  createdAsc: (a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''),
  nameAsc: (a, b) => (a.name || '').localeCompare(b.name || '', 'zh-Hans-CN')
};

Page({
  data: {
    filteredItems: [],
    currentFilter: 'all',
    sortBy: 'expireAsc', // 默认按过期日期升序（最急的在前）
    searchKeyword: '',
    alertMode: '',
    alertTitle: '',
    alertCount: 0,
    currentDate: '',
    stats: { total: 0, safe: 0, warning: 0, danger: 0, used: 0 }
  },

  onShow() {
    this.setData({ currentDate: this.formatTime() });
    this.loadItems();
  },

  onPullDownRefresh() {
    this.loadItems();
    wx.stopPullDownRefresh();
  },

  loadItems() {
    const all = app.getItems('all');

    // 给每个物品算上实时状态字段
    const fresh = all.map(item => {
      const daysLeft = util.calcDaysLeft(item.expireDate);
      return { ...item, daysLeft, status: util.getStatus(daysLeft, item.used) };
    });

    // 1) 搜索过滤（按名称 + 备注）
    const keyword = (this.data.searchKeyword || '').trim().toLowerCase();
    const matched = keyword
      ? fresh.filter(i =>
          (i.name || '').toLowerCase().includes(keyword) ||
          (i.note || '').toLowerCase().includes(keyword))
      : fresh;

    // 2) 状态过滤
    const filter = this.data.currentFilter;
    const filtered = filter === 'all'
      ? matched
      : matched.filter(i => i.status === filter);

    // 3) 排序
    const sorter = SORTERS[this.data.sortBy] || SORTERS.expireAsc;
    const sorted = [...filtered].sort(sorter);

    // 4) 顶部提醒条
    const dangerCount = fresh.filter(i => i.status === 'danger').length;
    const warningCount = fresh.filter(i => i.status === 'warning').length;
    let alertMode = '', alertTitle = '', alertCount = 0;
    if (dangerCount > 0) {
      alertMode = 'danger';
      alertTitle = `${dangerCount} 个物品已过期`;
      alertCount = dangerCount;
    } else if (warningCount > 0) {
      alertMode = 'warning';
      alertTitle = `${warningCount} 个物品即将过期`;
      alertCount = warningCount;
    }

    // 5) 统计卡
    const stats = {
      total: fresh.length,
      safe: fresh.filter(i => i.status === 'safe').length,
      warning: warningCount,
      danger: dangerCount,
      used: fresh.filter(i => i.status === 'used').length
    };

    this.setData({
      filteredItems: sorted.map(item => ({
        ...item,
        openDateDisplay: item.openDate,
        daysText: util.getDaysText(item.daysLeft, item.used)
      })),
      alertMode,
      alertTitle,
      alertCount,
      stats
    });
  },

  onFilterChange(e) {
    this.setData({ currentFilter: e.currentTarget.dataset.filter });
    this.loadItems();
  },

  onSortChange(e) {
    this.setData({ sortBy: e.currentTarget.dataset.sort });
    this.loadItems();
  },

  onSearchInput(e) {
    this.setData({ searchKeyword: e.detail.value });
    this.loadItems();
  },

  onSearchClear() {
    this.setData({ searchKeyword: '' });
    this.loadItems();
  },

  onItemTap(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  onItemLongPress(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.filteredItems.find(i => i.id === id);
    wx.showActionSheet({
      itemList: ['编辑', '删除'],
      success: (res) => {
        if (res.tapIndex === 0) {
          wx.navigateTo({ url: `/pages/add/add?id=${id}` });
        } else if (res.tapIndex === 1) {
          wx.showModal({
            title: '删除',
            content: `确定要删除「${item.name}」吗？此操作不可撤销。`,
            confirmColor: '#d94535',
            confirmText: '删除',
            success: (r) => {
              if (r.confirm) {
                app.deleteItem(id);
                wx.showToast({ title: '已删除', icon: 'success' });
                this.loadItems();
              }
            }
          });
        }
      }
    });
  },

  goAdd() {
    wx.navigateTo({ url: '/pages/add/add' });
  },

  navigateToSettings() {
    wx.switchTab({ url: '/pages/settings/settings' });
  },

  formatTime() {
    const now = new Date();
    const h = now.getHours().toString().padStart(2, '0');
    const m = now.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
  }
});
