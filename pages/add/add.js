const util = require('../../utils/util');
const cloud = require('../../utils/cloud');
const app = getApp();

// ============ 批量草稿存储 key ============
const DRAFT_KEY = 'addBatchDraft';

/**
 * pages/add/add.js
 *
 * 重构设计（v2.0 录入流程）：3-state 状态机，消除"每件物品都要重新走完 5 步" 的摩擦。
 *
 *   phase: 'choose'   — 3 入口全屏选择（快速 / 拍照 / 模板）
 *   phase: 'batch'    — 批量列表页，已经在录，可以连加多个
 *   phase: 'editItem' — 单个物品编辑（点击 batch-item 进入；编辑老物品也走这里）
 *
 * 核心原则：
 *   1. 零默认值：所有字段都有兜底，光填名字 + 选档位日期就能存
 *   2. 同会话连录：录音一个后面直接"添加下一个"，不再退回首页
 *   3. 模板 / OCR 识别结果直接进 batch 列表，不再走老 form
 *   4. 草稿恢复：意外退出不丢数据，下次进 add 会问"是否继续"
 */

Page({
  data: {
    // ==== 状态机 ====
    phase: 'choose',          // 'choose' | 'batch' | 'editItem'
    editingBatchIndex: -1,    // phase==='editItem' 时，正在编辑 batchItems 第几项

    // ==== 老编辑模式标记 ====
    isEdit: false,            // true = 编辑已有物品，走原单表单流程
    editingId: null,
    pageTitle: '快速添加',

    // ==== 批量会话 ====
    batchItems: [],           // [{ name, category, openDate, expireDate, limitDays,
                               //    location, note, photoPath, barCode,
                               //    needsReview (bool), source ('quick'|'ocr'|'scan'|'template') }]
    recentLocations: [],      // 从历史 items 提取，按频次排序

    // ==== 分类 / 模板 ====
    categories: util.getDefaultCategories(),
    templates: util.getTemplates(),

    // ==== 单个 item 编辑表单（phase==='editItem' 时用） ====
    form: {
      name: '',
      category: '其他',
      openDate: '',
      expireDate: '',
      limitDays: '30',
      note: '',
      location: ''
    },

    // ==== 拍照 / OCR 流程（单 item 时复用） ====
    ocrImagePath: '',
    ocrExtracted: null,
    ocrLoading: false,
    ocrFilled: false,

    // ==== 扫码流程 ====
    scanCodeText: '',
    scanInfo: null,
    scanLoading: false,

    // ==== 通用 ====
    photoPath: '',
    cloudReady: false
  },

  // ============================================================
  //  生命周期
  // ============================================================

  onLoad(options) {
    // ---- 编辑已有物品：走老 single-form 流程，不进新状态机 ----
    const editId = options.id ? parseInt(options.id) : null;
    if (editId) {
      const item = app.globalData.items.find(i => i.id === editId);
      if (item) {
        this.setData({
          isEdit: true,
          editingId: editId,
          pageTitle: '编辑物品',
          phase: 'editItem',
          editingBatchIndex: -1,
          photoPath: item.photoPath || '',
          scanCodeText: item.barCode || '',
          cloudReady: cloud.isCloudReady(),
          form: {
            name: item.name || '',
            category: item.category || '其他',
            openDate: item.openDate || '',
            expireDate: item.expireDate || '',
            limitDays: item.limitDays ? String(item.limitDays) : '30',
            note: item.note || '',
            location: item.location || ''
          }
        });
        wx.setNavigationBarTitle({ title: '编辑物品' });
        return;
      }
    }

    // ---- 提取最近用过的位置（按频次） ----
    const locCount = {};
    app.globalData.items.forEach(i => {
      if (i.location) locCount[i.location] = (locCount[i.location] || 0) + 1;
    });
    const recentLocations = Object.entries(locCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([loc]) => loc);

    // ---- 检查草稿是否恢复 ----
    const draft = wx.getStorageSync(DRAFT_KEY);
    if (draft && Array.isArray(draft) && draft.length > 0) {
      // 询问用户是否恢复
      wx.showModal({
        title: '未完成的批量录入',
        content: `之前还有 ${draft.length} 件待添加，是否继续编辑？`,
        confirmText: '继续',
        cancelText: '丢弃',
        success: (r) => {
          if (r.confirm) {
            this.setData({ phase: 'batch', batchItems: draft });
            wx.setNavigationBarTitle({ title: `批量添加 (${draft.length})` });
          } else {
            wx.removeStorageSync(DRAFT_KEY);
          }
        }
      });
    }

    this.setData({
      cloudReady: cloud.isCloudReady(),
      recentLocations
    });
    wx.setNavigationBarTitle({ title: '添加物品' });
  },

  onUnload() {
    // 退出时如果还在 batch 阶段且有项，自动保存草稿
    if (this.data.phase !== 'choose' && !this.data.isEdit && this.data.batchItems.length > 0) {
      wx.setStorageSync(DRAFT_KEY, this.data.batchItems);
    }
  },

  // ============================================================
  //  Helpers
  // ============================================================

  /** 创建一个新物品草稿：尽量复用上一个的字段，零默认值兜底 */
  newBatchItem(overrides = {}) {
    const last = this.data.batchItems[this.data.batchItems.length - 1];
    const today = util.formatDate(new Date());
    const defaults = {
      name: '',
      category: last ? last.category : '其他',
      openDate: today,
      limitDays: last ? String(last.limitDays) : '30',
      location: last ? last.location : (this.data.recentLocations[0] || ''),
      note: '',
      photoPath: '',
      barCode: '',
      needsReview: true,    // 默认「待确认」黄底
      source: 'quick'
    };
    const item = { ...defaults, ...overrides };
    // 自动联动 expireDate
    if (!overrides.expireDate && item.openDate && item.limitDays) {
      item.expireDate = util.calcExpireDate(item.openDate, parseInt(item.limitDays) || 30);
    }
    return item;
  },

  /** 批量添加 item，并自动同步到 storage + 更新标题 */
  pushBatchItem(item) {
    const next = [...this.data.batchItems, item];
    this.setData({ batchItems: next });
    this._persistDraft(next);
    wx.setNavigationBarTitle({ title: `批量添加 (${next.length})` });
  },

  /** 替换某一项（editItem 存盘后回 batch） */
  replaceBatchItem(index, item) {
    const next = [...this.data.batchItems];
    next[index] = item;
    this.setData({ batchItems: next });
    this._persistDraft(next);
  },

  /** 删除某一项 */
  removeBatchItem(index) {
    const next = this.data.batchItems.filter((_, i) => i !== index);
    this.setData({
      batchItems: next,
      phase: next.length === 0 ? 'choose' : 'batch'
    });
    this._persistDraft(next);
    if (next.length === 0) wx.setNavigationBarTitle({ title: '添加物品' });
    else wx.setNavigationBarTitle({ title: `批量添加 (${next.length})` });
  },

  /** 标记某项为「✓ 已确认」 */
  markItemOk(index) {
    const next = [...this.data.batchItems];
    next[index] = { ...next[index], needsReview: false };
    this.setData({ batchItems: next });
    this._persistDraft(next);
  },

  /** 写草稿到 storage */
  _persistDraft(items) {
    try { wx.setStorageSync(DRAFT_KEY, items); } catch (e) {}
  },

  /** 把日期 / 天数输入变成完整 expireDate */
  _autoCalcForm(form, changedField) {
    return util.autoCalcForm(form, changedField);
  },

  /** 把单个 item 反向同步到 form（编辑时） */
  _itemToForm(item) {
    return {
      name: item.name || '',
      category: item.category || '其他',
      openDate: item.openDate || '',
      expireDate: item.expireDate || '',
      limitDays: item.limitDays ? String(item.limitDays) : '30',
      note: item.note || '',
      location: item.location || ''
    };
  },

  /** 把 form 同步回 item（编辑存盘时） */
  _formToItem(form, baseItem) {
    const openDate = form.openDate || util.formatDate(new Date());
    const limitDays = parseInt(form.limitDays) || 30;
    const expireDate = form.expireDate || util.calcExpireDate(openDate, limitDays);
    return {
      ...baseItem,
      name: form.name.trim(),
      category: form.category,
      openDate,
      limitDays,
      expireDate,
      note: (form.note || '').trim(),
      location: (form.location || '').trim(),
      needsReview: false  // 编辑过的默认「已确认」
    };
  },

  // ============================================================
  //  阶段 1：3 入口选择（phase === 'choose'）
  // ============================================================

  /** ⚡ 快速录：0 配置，1 个空 item 直接进 batch */
  onQuickStart() {
    const item = this.newBatchItem({ name: '' });
    this.pushBatchItem(item);
    this.setData({ phase: 'batch' });
  },

  /** 📷 拍照批量：进 batch，触发相机，拍完自动 addBatchItem */
  onQuickPhoto() {
    const item = this.newBatchItem({ name: '等待拍照...' });
    this.pushBatchItem(item);
    this.setData({ phase: 'batch' });
    this.takeOCRPhoto();
  },

  /** 📦 从模板批量：进 batch，但不预填 item，等用户点模板 */
  onQuickTemplate() {
    this.setData({ phase: 'batch' });
  },

  // ============================================================
  //  阶段 2：批量列表（phase === 'batch'）
  // ============================================================

  /** 「+ 添加下一个」按钮：加一个新的空 item，立即进入 editItem 编辑 */
  onAddNext() {
    const item = this.newBatchItem();
    this.pushBatchItem(item);
    // 不进 editItem，让用户先在 batch 列表里看，再决定要不要编辑
    // 但给一个引导 toast
    wx.showToast({ title: '已添加，点击行编辑', icon: 'none', duration: 1500 });
  },

  /** 「✓ 添加 N 件」按钮：批量保存 */
  onSaveAll() {
    const valid = this.data.batchItems.filter(it =>
      (it.name || '').trim() && (it.expireDate || it.limitDays)
    );
    const invalidCount = this.data.batchItems.length - valid.length;
    if (valid.length === 0) {
      wx.showToast({ title: '没有可保存的物品', icon: 'none' });
      return;
    }

    // 有无效项就先提示
    if (invalidCount > 0) {
      wx.showModal({
        title: `有 ${invalidCount} 件信息不全`,
        content: '将只保存信息完整的物品，未填写名称或日期的会被跳过。继续吗？',
        confirmText: '继续保存',
        success: (r) => {
          if (r.confirm) this._doSaveItems(valid);
        }
      });
      return;
    }
    this._doSaveItems(valid);
  },

  _doSaveItems(items) {
    let saved = 0;
    items.forEach(it => {
      const item = {
        name: (it.name || '').trim(),
        category: it.category || '其他',
        icon: util.getCategoryIcon(it.category || '其他'),
        openDate: it.openDate || util.formatDate(new Date()),
        expireDate: it.expireDate || util.calcExpireDate(it.openDate || util.formatDate(new Date()), parseInt(it.limitDays) || 30),
        limitDays: parseInt(it.limitDays) || 30,
        note: it.note || '',
        location: it.location || '',
        daysLeft: util.calcDaysLeft(it.expireDate),
        photoPath: it.photoPath || '',
        barCode: it.barCode || ''
      };
      app.addItem(item);
      saved++;
    });
    wx.removeStorageSync(DRAFT_KEY);
    wx.showToast({ title: `✓ 已添加 ${saved} 件`, icon: 'success', duration: 1500 });
    setTimeout(() => wx.navigateBack(), 1500);
  },

  /** 点击 batch-item 行：进入单 item 编辑 */
  onTapBatchItem(e) {
    const index = e.currentTarget.dataset.index;
    const item = this.data.batchItems[index];
    this.setData({
      phase: 'editItem',
      editingBatchIndex: index,
      form: this._itemToForm(item),
      photoPath: item.photoPath || '',
      scanCodeText: item.barCode || ''
    });
    wx.setNavigationBarTitle({ title: `编辑第 ${index + 1} 件` });
  },

  /** 从 batch 中删除某项 */
  onDeleteBatchItem(e) {
    const index = e.currentTarget.dataset.index;
    wx.showModal({
      title: '删除这 1 件？',
      content: this.data.batchItems[index].name || '未命名',
      confirmText: '删除',
      confirmColor: '#b06367',
      success: (r) => {
        if (r.confirm) this.removeBatchItem(index);
      }
    });
  },

  /** 标记为「✓ 已确认」 */
  onMarkItemOk(e) {
    const index = e.currentTarget.dataset.index;
    this.markItemOk(index);
  },

  /** 套用模板到当前 batch：如果是 batch 模式且没有正在编辑的 item，就把模板加成新 item */
  onApplyTemplate(e) {
    const id = e.currentTarget.dataset.id;
    const tpl = util.getTemplateById(id);
    if (!tpl) return;

    if (this.data.phase === 'editItem') {
      // 在单个编辑页：套模板只填空字段
      const form = { ...this.data.form };
      if (!form.name) form.name = tpl.name;
      if (!form.category || form.category === '其他') form.category = tpl.category;
      if (!form.limitDays || form.limitDays === '30') {
        Object.assign(form, this._autoCalcForm({ ...form, limitDays: String(tpl.limitDays) }, 'limitDays'));
      }
      if (!form.location) form.location = tpl.location;
      this.setData({ form });
    } else {
      // 在 batch 列表：把模板加成新 item
      const item = this.newBatchItem({
        name: tpl.name,
        category: tpl.category,
        limitDays: String(tpl.limitDays),
        location: tpl.location,
        source: 'template',
        needsReview: false  // 模板直接应用，标记为已确认
      });
      // 自动算 expireDate
      if (!item.expireDate) {
        item.expireDate = util.calcExpireDate(item.openDate, parseInt(item.limitDays));
      }
      this.pushBatchItem(item);
    }

    wx.showToast({ title: `已套用「${tpl.name}」`, icon: 'success', duration: 1200 });
  },

  // ============================================================
  //  阶段 3：单个 item 编辑（phase === 'editItem'）
  // ============================================================

  /** 单 item 编辑存盘：回到 batch 列表 */
  onSaveItemEdit() {
    const f = this.data.form;
    if (!f.name || !f.name.trim()) {
      wx.showToast({ title: '请输入物品名称', icon: 'none' });
      return;
    }
    if (!f.expireDate && !f.limitDays) {
      wx.showToast({ title: '请设置过期日期或限制天数', icon: 'none' });
      return;
    }

    if (this.data.isEdit) {
      // === 编辑已有物品（老模式）===
      const openDate = f.openDate || util.formatDate(new Date());
      const limitDays = parseInt(f.limitDays) || 30;
      const expireDate = f.expireDate || util.calcExpireDate(openDate, limitDays);
      const daysLeft = util.calcDaysLeft(expireDate);
      const item = {
        name: f.name.trim(),
        category: f.category,
        icon: util.getCategoryIcon(f.category),
        openDate,
        expireDate,
        limitDays,
        note: (f.note || '').trim(),
        location: (f.location || '').trim(),
        daysLeft,
        photoPath: this.data.photoPath || '',
        barCode: this.data.scanCodeText || ''
      };
      const old = app.globalData.items.find(i => i.id === this.data.editingId);
      if (old) item.used = !!old.used;
      app.updateItem(this.data.editingId, item);
      wx.showToast({ title: '已保存', icon: 'success', duration: 1200 });
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }

    // === 批量模式下的单个编辑：回 batch 列表 ===
    const baseItem = this.data.batchItems[this.data.editingBatchIndex] || {};
    const newItem = this._formToItem(f, { ...baseItem, photoPath: this.data.photoPath, barCode: this.data.scanCodeText });
    this.replaceBatchItem(this.data.editingBatchIndex, newItem);
    this.setData({ phase: 'batch', editingBatchIndex: -1 });
    wx.setNavigationBarTitle({ title: `批量添加 (${this.data.batchItems.length})` });
  },

  /** 单 item 编辑取消：如果是 batch 中的 edit 项，丢弃改动回 batch */
  onCancelItemEdit() {
    if (this.data.isEdit) {
      wx.navigateBack();
      return;
    }
    // 删除刚加的空 item（如果是新建后什么都没改）
    const item = this.data.batchItems[this.data.editingBatchIndex];
    if (item && (!item.name || item.name === '等待拍照...' || item.source === 'quick' && !item.name)) {
      this.removeBatchItem(this.data.editingBatchIndex);
    }
    this.setData({ phase: 'batch', editingBatchIndex: -1 });
    wx.setNavigationBarTitle({ title: `批量添加 (${this.data.batchItems.length})` });
  },

  // ============================================================
  //  表单输入（phase === 'editItem' 时）
  // ============================================================

  onInputName(e) { this.setData({ 'form.name': e.detail.value }); },
  onInputNote(e) { this.setData({ 'form.note': e.detail.value }); },
  onInputLocation(e) { this.setData({ 'form.location': e.detail.value }); },
  onSelectLocation(e) {
    // 选中常用位置
    this.setData({ 'form.location': e.currentTarget.dataset.loc });
  },
  onSelectCategory(e) {
    this.setData({ 'form.category': e.currentTarget.dataset.cat });
  },

  onInputLimitDays(e) {
    const form = this._autoCalcForm({ ...this.data.form, limitDays: e.detail.value }, 'limitDays');
    this.setData({ form });
  },
  onOpenDateChange(e) {
    const form = this._autoCalcForm({ ...this.data.form, openDate: e.detail.value }, 'openDate');
    this.setData({ form });
  },
  onExpireDateChange(e) {
    const form = this._autoCalcForm({ ...this.data.form, expireDate: e.detail.value }, 'expireDate');
    this.setData({ form });
  },

  // ============================================================
  //  OCR / 扫码（phase === 'editItem' 时）
  // ============================================================

  async takeOCRPhoto() {
    try {
      const res = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['camera'],
        camera: 'back'
      });
      const path = res.tempFiles[0].tempFilePath;
      this.setData({ ocrImagePath: path, photoPath: path, ocrExtracted: null, ocrFilled: false });

      if (!cloud.isCloudReady()) {
        this.setData({ ocrExtracted: null });
        if (this.data.phase === 'batch') {
          // batch 模式：标记当前 item 有照片、等用户编辑
          const i = this.data.batchItems.length - 1;
          if (i >= 0) {
            const next = [...this.data.batchItems];
            next[i] = { ...next[i], photoPath: path, name: next[i].name === '等待拍照...' ? '' : next[i].name };
            this.setData({ batchItems: next });
          }
        }
        return;
      }

      this.setData({ ocrLoading: true });
      const cloudPath = `ocr/${Date.now()}-${Math.floor(Math.random() * 10000)}.jpg`;
      const upRes = await cloud.uploadFile(cloudPath, path);
      if (!upRes.ok) {
        this.setData({ ocrLoading: false });
        wx.showToast({ title: '图片上传失败：' + upRes.reason, icon: 'none' });
        return;
      }
      const ocrRes = await cloud.ocr(upRes.data.fileID);
      this.setData({ ocrLoading: false });
      if (!ocrRes.ok) {
        wx.showToast({ title: 'OCR 识别失败：' + (ocrRes.data && ocrRes.data.message || ocrRes.reason), icon: 'none' });
        return;
      }

      const extracted = ocrRes.data.extracted || {};
      this.setData({ ocrExtracted: extracted });
      const hits = ['expireDate', 'openDate', 'limitDays', 'productName'].filter(k => extracted[k]);

      if (this.data.phase === 'editItem') {
        // 单 item 编辑模式：识别完直接把字段填进 form
        if (hits.length > 0) this.fillFromOCR();
      } else if (this.data.phase === 'batch') {
        // batch 模式：识别完直接把字段填进最后一个 item
        if (hits.length > 0) {
          const i = this.data.batchItems.length - 1;
          if (i >= 0) this._fillOCRIntoBatchItem(i, extracted);
        }
      }
    } catch (err) {
      if (err && err.errMsg && err.errMsg.indexOf('cancel') !== -1) return;
      if (err && err.errMsg && err.errMsg.indexOf('auth deny') !== -1) {
        wx.showModal({
          title: '需要相机权限',
          content: '请在设置中允许小程序使用相机',
          confirmText: '去设置',
          success: (r) => { if (r.confirm) wx.openSetting(); }
        });
        return;
      }
      console.error('OCR 流程失败:', err);
    }
  },

  /** 把 OCR 字段直接填进 batch 当前 item（batch 模式） */
  _fillOCRIntoBatchItem(index, ex) {
    const it = this.data.batchItems[index];
    const next = [...this.data.batchItems];
    next[index] = { ...it };
    if (ex.productName) next[index].name = ex.productName;
    if (ex.expireDate) {
      next[index].expireDate = ex.expireDate;
    } else if (ex.limitDays && next[index].openDate) {
      next[index].limitDays = String(ex.limitDays);
      next[index].expireDate = util.calcExpireDate(next[index].openDate, parseInt(ex.limitDays));
    }
    if (ex.openDate) next[index].openDate = ex.openDate;
    if (ex.limitDays) {
      next[index].limitDays = String(ex.limitDays);
      if (!next[index].expireDate && next[index].openDate) {
        next[index].expireDate = util.calcExpireDate(next[index].openDate, parseInt(next[index].limitDays));
      }
    }
    next[index].source = 'ocr';
    next[index].needsReview = true;  // OCR 识别结果仍需用户确认
    this.setData({ batchItems: next });
    this._persistDraft(next);
    wx.showToast({ title: '已识别，点击行编辑确认', icon: 'success', duration: 1500 });
  },

  /** 单 item 编辑模式：把 OCR 结果批量填入 form（老逻辑保留） */
  fillFromOCR() {
    const ex = this.data.ocrExtracted;
    if (!ex) return;
    const form = { ...this.data.form };
    if (ex.productName && !form.name) form.name = ex.productName;
    if (ex.expireDate) {
      Object.assign(form, this._autoCalcForm({ ...form, expireDate: ex.expireDate }, 'expireDate'));
    }
    if (ex.openDate && !form.openDate) {
      Object.assign(form, this._autoCalcForm({ ...form, openDate: ex.openDate }, 'openDate'));
    }
    if (ex.limitDays && !form.limitDays) {
      Object.assign(form, this._autoCalcForm({ ...form, limitDays: ex.limitDays }, 'limitDays'));
    }
    this.setData({ form, ocrFilled: true });
  },

  async scanCode() {
    try {
      const res = await wx.scanCode({ scanType: ['barCode', 'qrCode'] });
      const codeText = res.result;
      this.setData({ scanCodeText: codeText, scanInfo: null });

      if (!cloud.isCloudReady()) {
        this.setData({ 'form.note': '条码 ' + codeText });
        return;
      }

      this.setData({ scanLoading: true });
      const r = await cloud.lookupBarcode(codeText);
      this.setData({ scanLoading: false });
      if (r.ok) {
        this.setData({ scanInfo: r.data });
        // 自动填入 form
        if (!this.data.form.name) {
          const tail = r.data.productCode || codeText.slice(-6);
          this.setData({ 'form.name': '商品 (' + tail + ')' });
        }
        if (!this.data.form.note) {
          this.setData({ 'form.note': '条码 ' + codeText + (r.data.country ? '（' + r.data.country + '）' : '') });
        }
        wx.showToast({ title: '已填入条码信息', icon: 'success' });
      }
    } catch (err) {
      if (err && err.errMsg && err.errMsg.indexOf('cancel') !== -1) return;
      wx.showToast({ title: '扫码失败，请重试', icon: 'none' });
    }
  },

  takePhoto() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const path = res.tempFiles[0].tempFilePath;
        this.setData({ photoPath: path });
      }
    });
  }
});
