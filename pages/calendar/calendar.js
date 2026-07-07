const util = require('../../utils/util');
const app = getApp();

Page({
  data: {
    year: 0,
    month: 0,
    weekdays: [
      { label: '日', weekend: true },
      { label: '一', weekend: false },
      { label: '二', weekend: false },
      { label: '三', weekend: false },
      { label: '四', weekend: false },
      { label: '五', weekend: false },
      { label: '六', weekend: true }
    ],
    days: [],
    selectedDayKey: '',
    selectedDayItems: [],
    selectedDayLabel: '',
    monthSummary: { expired: 0, today: 0, future: 0 }
  },

  onShow() {
    const now = new Date();
    this.setData({
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      selectedDayKey: '',
      selectedDayItems: []
    });
    this.compute();
  },

  prevMonth() {
    let { year, month } = this.data;
    month--;
    if (month < 1) { month = 12; year--; }
    this.setData({ year, month, selectedDayKey: '', selectedDayItems: [] });
    this.compute();
  },

  nextMonth() {
    let { year, month } = this.data;
    month++;
    if (month > 12) { month = 1; year++; }
    this.setData({ year, month, selectedDayKey: '', selectedDayItems: [] });
    this.compute();
  },

  /** 核心：根据 year/month 构建 days 数组 + 标注每天的过期情况 */
  compute() {
    const { year, month } = this.data;
    const ymPrefix = `${year}-${String(month).padStart(2, '0')}`;

    // 该月起始是周几 / 总天数
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    const daysInMonth = lastDay.getDate();
    const startWeekday = firstDay.getDay();

    // 今天
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayKey = util.formatDate(today);

    // 过滤本月相关的物品
    const items = app.globalData.items.filter(i => !i.used);

    // 预先按 expireDate 聚合
    const byDate = {};
    items.forEach(it => {
      if (!it.expireDate) return;
      byDate[it.expireDate] = (byDate[it.expireDate] || 0) + 1;
    });

    // 拼装日历数组
    const days = [];
    // 前面空格
    for (let i = 0; i < startWeekday; i++) {
      days.push({ empty: true, idx: days.length, day: '' });
    }
    // 当月日期
    for (let d = 1; d <= daysInMonth; d++) {
      const dateKey = `${ymPrefix}-${String(d).padStart(2, '0')}`;
      const todayExpireCount = dateKey === todayKey ? (byDate[dateKey] || 0) : 0;
      // 过期 = expireDate 在今天之前且还在本月
      const expiredCount = dateKey < todayKey ? (byDate[dateKey] || 0) : 0;
      const futureCount = dateKey > todayKey ? (byDate[dateKey] || 0) : 0;
      days.push({
        empty: false,
        idx: days.length,
        day: d,
        dateKey,
        isToday: dateKey === todayKey,
        isPast: dateKey < todayKey,
        expiredCount,
        todayExpireCount,
        futureCount
      });
    }

    // 本月汇总
    const monthSummary = { expired: 0, today: 0, future: 0 };
    days.forEach(d => {
      if (d.empty) return;
      monthSummary.expired += d.expiredCount;
      monthSummary.today += d.todayExpireCount;
      monthSummary.future += d.futureCount;
    });

    this.setData({ days, monthSummary });
  },

  onDayTap(e) {
    const idx = e.currentTarget.dataset.idx;
    const cell = this.data.days[idx];
    if (!cell || cell.empty) return;

    const items = app.globalData.items.filter(i => i.expireDate === cell.dateKey && !i.used);
    const selectedDayItems = items.map(item => {
      const daysLeft = util.calcDaysLeft(item.expireDate);
      const status = util.getStatus(daysLeft, item.used);
      return {
        ...item,
        status,
        statusText: util.getDaysText(daysLeft, item.used)
      };
    });
    const selectedDayLabel = `${cell.day}日 · ${cell.dateKey}`;
    this.setData({
      selectedDayKey: cell.dateKey,
      selectedDayItems,
      selectedDayLabel
    });
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  }
});