const util = require('../../utils/util');
const app = getApp();

// 分类固定配色（与 util.getCategoryIcon 一致，保持视觉统一）
const CATEGORY_COLORS = {
  '食品': '#3dad6e',
  '药品': '#d94535',
  '化妆品': '#e07ab4',
  '饮料': '#5b9ee0',
  '日用品': '#9b7ad4',
  '其他': '#8b8a94'
};

Page({
  data: {
    summary: { total: 0, warning: 0, danger: 0, used: 0 },
    monthStats: { added: 0, expired: 0, usedUp: 0 },
    categoryDist: [],
    pieGradient: '',
    trendData: [],
    trendMax: 0,
    locationRank: []
  },

  onShow() {
    this.compute();
  },

  onPullDownRefresh() {
    this.compute();
    wx.stopPullDownRefresh();
  },

  compute() {
    // 把每个物品补上实时状态字段
    const items = app.globalData.items.map(item => {
      const daysLeft = util.calcDaysLeft(item.expireDate);
      return { ...item, daysLeft, status: util.getStatus(daysLeft, item.used) };
    });

    // 1) 顶部汇总
    const summary = {
      total: items.length,
      warning: items.filter(i => i.status === 'warning').length,
      danger: items.filter(i => i.status === 'danger').length,
      used: items.filter(i => i.status === 'used').length
    };

    // 2) 本月数据（按 createdAt / expireDate 的 YYYY-MM 前缀判定）
    const now = new Date();
    const ymPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const inThisMonth = (s) => s && s.indexOf(ymPrefix) === 0;
    const monthStats = {
      added: items.filter(i => inThisMonth((i.createdAt || '').slice(0, 7))).length,
      expired: items.filter(i => inThisMonth(i.expireDate) && i.status === 'danger').length,
      usedUp: items.filter(i => i.used && inThisMonth((i.createdAt || '').slice(0, 7))).length
    };

    // 3) 分类分布（按数量降序）
    const catMap = {};
    items.forEach(i => {
      const c = i.category || '其他';
      catMap[c] = (catMap[c] || 0) + 1;
    });
    const totalForPct = items.length || 1;
    const categoryDist = Object.keys(catMap)
      .map(c => ({
        category: c,
        count: catMap[c],
        pct: Math.round((catMap[c] / totalForPct) * 100),
        color: CATEGORY_COLORS[c] || '#8b8a94'
      }))
      .sort((a, b) => b.count - a.count);

    // 生成 conic-gradient 字符串
    let acc = 0;
    const stops = [];
    categoryDist.forEach(d => {
      const start = acc;
      acc += d.pct;
      stops.push(`${d.color} ${start}% ${acc}%`);
    });
    const pieGradient = stops.length > 0 ? stops.join(', ') : '#eeeaf2 0% 100%';

    // 4) 7 天趋势（柱状图）
    const trendData = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const ymd = util.formatDate(d);
      const count = items.filter(it => (it.createdAt || '').slice(0, 10) === ymd).length;
      trendData.push({
        date: ymd,
        dayLabel: ['日','一','二','三','四','五','六'][d.getDay()],
        count,
        isToday: i === 0,
        heightPct: 0
      });
    }
    const trendMax = Math.max(0, ...trendData.map(d => d.count));
    trendData.forEach(d => {
      // 没数据时给个最小高度 4%，有数据时按比例；今天单独高亮
      d.heightPct = d.count === 0 ? 4 : Math.max(8, Math.round((d.count / Math.max(1, trendMax)) * 100));
    });

    // 5) 存放位置 TOP 5
    const locMap = {};
    items.forEach(i => {
      const loc = (i.location || '').trim();
      if (!loc) return;
      locMap[loc] = (locMap[loc] || 0) + 1;
    });
    const locSorted = Object.keys(locMap)
      .map(name => ({ name, count: locMap[name] }))
      .sort((a, b) => b.count - a.count);
    const locMax = Math.max(1, ...locSorted.map(l => l.count));
    const locationRank = locSorted.slice(0, 5).map(l => ({
      ...l,
      pct: Math.round((l.count / locMax) * 100)
    }));

    this.setData({ summary, monthStats, categoryDist, pieGradient, trendData, trendMax, locationRank });
  }
});