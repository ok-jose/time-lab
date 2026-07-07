/**
 * 用不过期 - 工具函数
 */

/** 计算剩余天数（正数=剩余，0=今日到期，负数=已过期） */
function calcDaysLeft(expireDate) {
  if (!expireDate) return null;
  const now = new Date();
  const exp = new Date(expireDate);
  now.setHours(0, 0, 0, 0);
  exp.setHours(0, 0, 0, 0);
  return Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
}

/** 根据剩余天数判断状态 */
function getStatus(daysLeft, used) {
  if (used) return 'used';
  if (daysLeft === null) return 'safe';
  if (daysLeft < 0) return 'danger';
  if (daysLeft <= 7) return 'warning';
  return 'safe';
}

/** 剩余天数文本 */
function getDaysText(daysLeft, used) {
  if (used) return '已用完';
  if (daysLeft === null) return '未设置';
  if (daysLeft < 0) return `已过期 ${Math.abs(daysLeft)} 天`;
  if (daysLeft === 0) return '今日到期';
  return `剩余 ${daysLeft} 天`;
}

/** 根据过期日期和限制天数推算开启日期 */
function calcOpenDate(expireDate, limitDays) {
  if (!expireDate || !limitDays) return '';
  const d = new Date(expireDate);
  d.setDate(d.getDate() - limitDays);
  return formatDate(d);
}

/** 根据开启日期和限制天数推算过期日期 */
function calcExpireDate(openDate, limitDays) {
  if (!openDate || !limitDays) return '';
  const d = new Date(openDate);
  d.setDate(d.getDate() + limitDays);
  return formatDate(d);
}

/**
 * 表单字段联动计算
 * 规则：
 * - 改 limitDays：基于 openDate 重算 expireDate
 * - 改 openDate / expireDate：基于两日期重算 limitDays
 * 返回一个新对象，调用方用 setData 整体赋值即可
 */
function autoCalcForm(form, changedField) {
  const next = { ...form };
  const days = parseInt(next.limitDays);

  if (changedField === 'limitDays') {
    if (next.openDate && days > 0) {
      next.expireDate = calcExpireDate(next.openDate, days);
    }
  } else if (changedField === 'openDate' || changedField === 'expireDate') {
    if (next.openDate && next.expireDate) {
      const od = new Date(next.openDate);
      const ed = new Date(next.expireDate);
      const diff = Math.round((ed - od) / (1000 * 60 * 60 * 24));
      next.limitDays = diff > 0 ? String(diff) : '';
    }
  }

  return next;
}

/** 格式化日期 YYYY-MM-DD */
function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 格式化日期为显示文本 */
function formatDateDisplay(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${m}月${day}日`;
}

/** 分类图标映射 */
const CATEGORY_ICONS = {
  '食品': '🥛',
  '药品': '💊',
  '化妆品': '🧴',
  '饮料': '🥤',
  '日用品': '📦',
  '其他': '📦'
};

/** 获取分类图标 */
function getCategoryIcon(category) {
  return CATEGORY_ICONS[category] || '📦';
}

/** 获取默认分类列表 */
function getDefaultCategories() {
  return ['食品', '药品', '化妆品', '饮料', '日用品', '其他'];
}

/**
 * 预设模板：一键填表的常用物品预设
 * 字段：id / name / category / icon / limitDays / location
 * 点一下就把这些字段填进 form，用户再补 openDate/expireDate 即可
 */
const TEMPLATES = [
  { id: 'mask',     name: '面膜',     category: '化妆品', icon: '🧴', limitDays: 30,  location: '梳妆台' },
  { id: 'yogurt',   name: '酸奶',     category: '食品',   icon: '🥛', limitDays: 7,   location: '冰箱' },
  { id: 'eyedrop',  name: '眼药水',   category: '药品',   icon: '💊', limitDays: 30,  location: '床头柜' },
  { id: 'soy',      name: '酱油',     category: '食品',   icon: '🍶', limitDays: 180, location: '灶台' },
  { id: 'shampoo',  name: '洗发水',   category: '日用品', icon: '🧼', limitDays: 365, location: '浴室' },
  { id: 'lip',      name: '润唇膏',   category: '化妆品', icon: '💄', limitDays: 365, location: '随身包' },
  { id: 'milk',     name: '鲜奶',     category: '饮料',   icon: '🥛', limitDays: 15,  location: '冰箱' },
  { id: 'cream',    name: '面霜',     category: '化妆品', icon: '🧴', limitDays: 365, location: '梳妆台' }
];

/** 获取预设模板列表 */
function getTemplates() {
  return TEMPLATES;
}

/** 根据 id 查单个模板 */
function getTemplateById(id) {
  return TEMPLATES.find(t => t.id === id) || null;
}

/** 格式化日期时间 */
function formatDateTime(date) {
  const d = new Date(date);
  return `${formatDate(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

module.exports = {
  calcDaysLeft,
  getStatus,
  getDaysText,
  calcOpenDate,
  calcExpireDate,
  autoCalcForm,
  formatDate,
  formatDateDisplay,
  formatDateTime,
  getCategoryIcon,
  getDefaultCategories,
  getTemplates,
  getTemplateById
};