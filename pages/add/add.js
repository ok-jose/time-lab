const util = require('../../utils/util');
const app = getApp();

Page({
  data: {
    isEdit: false,
    editingId: null,
    pageTitle: '添加物品',
    currentMode: 'ocr',
    categories: util.getDefaultCategories(),
    ocrImagePath: '',
    ocrResult: '',
    ocrLoading: false,
    scanResult: '',
    scanCodeText: '',
    scanLoading: false,
    photoPath: '',
    form: {
      name: '',
      category: '其他',
      openDate: '',
      expireDate: '',
      limitDays: '',
      note: ''
    }
  },

  onLoad(options) {
    const editId = options.id ? parseInt(options.id) : null;
    if (editId) {
      const item = app.globalData.items.find(i => i.id === editId);
      if (item) {
        this.setData({
          isEdit: true,
          editingId: editId,
          pageTitle: '编辑物品',
          currentMode: 'manual',
          photoPath: item.photoPath || '',
          scanCodeText: item.barCode || '',
          form: {
            name: item.name || '',
            category: item.category || '其他',
            openDate: item.openDate || '',
            expireDate: item.expireDate || '',
            limitDays: item.limitDays ? String(item.limitDays) : '',
            note: item.note || ''
          }
        });
        wx.setNavigationBarTitle({ title: '编辑物品' });
        return;
      }
    }
    this.setData({ 'form.openDate': util.formatDate(new Date()) });
    wx.setNavigationBarTitle({ title: '添加物品' });
  },

  switchMode(e) {
    this.setData({ currentMode: e.currentTarget.dataset.mode });
  },

  // ============ OCR 识别（本地拍照 + 手动填写） ============
  takeOCRPhoto() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera'],
      camera: 'back',
      success: (res) => {
        const path = res.tempFiles[0].tempFilePath;
        this.setData({ ocrImagePath: path });
        wx.showModal({
          title: '拍照完成',
          content: '请手动填写产品信息，或使用扫码功能',
          confirmText: '去填写',
          showCancel: false
        });
      },
      fail: (err) => {
        if (err.errMsg.indexOf('auth deny') !== -1) {
          wx.showModal({
            title: '需要相机权限',
            content: '请在设置中允许小程序使用相机',
            confirmText: '去设置',
            success: (r) => {
              if (r.confirm) wx.openSetting();
            }
          });
        }
      }
    });
  },

  fillFromOCR() {
    wx.showToast({ title: '请手动填写信息', icon: 'none' });
  },

  // ============ 扫码录入（本地读取条码号） ============
  scanCode() {
    wx.scanCode({
      scanType: ['barCode', 'qrCode'],
      success: (res) => {
        const codeText = res.result;
        this.setData({
          scanCodeText: codeText,
          scanResult: '条码: ' + codeText + '\n\n已记录条码号，请手动填写商品信息',
          scanLoading: false
        });
      },
      fail: (err) => {
        if (err.errMsg.indexOf('cancel') === -1) {
          wx.showToast({ title: '扫码失败，请重试', icon: 'none' });
        }
      }
    });
  },

  fillFromScan() {
    if (!this.data.scanCodeText) return;
    if (!this.data.form.name) {
      this.setData({ 'form.name': '商品 (' + this.data.scanCodeText.slice(-6) + ')' });
    }
    wx.showToast({ title: '条码已记录', icon: 'success' });
  },

  // ============ 拍照 ============
  takePhoto() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        this.setData({ photoPath: res.tempFiles[0].tempFilePath });
      }
    });
  },

  // ============ 表单操作 ============
  onSelectCategory(e) { this.setData({ 'form.category': e.currentTarget.dataset.cat }); },
  onInputName(e) { this.setData({ 'form.name': e.detail.value }); },
  onInputNote(e) { this.setData({ 'form.note': e.detail.value }); },

  onInputLimitDays(e) {
    const form = util.autoCalcForm({ ...this.data.form, limitDays: e.detail.value }, 'limitDays');
    this.setData({ form });
  },
  onOpenDateChange(e) {
    const form = util.autoCalcForm({ ...this.data.form, openDate: e.detail.value }, 'openDate');
    this.setData({ form });
  },
  onExpireDateChange(e) {
    const form = util.autoCalcForm({ ...this.data.form, expireDate: e.detail.value }, 'expireDate');
    this.setData({ form });
  },

  // ============ 提交 ============
  submitItem() {
    const f = this.data.form;
    if (!f.name.trim()) {
      wx.showToast({ title: '请输入物品名称', icon: 'none' });
      return;
    }
    if (!f.expireDate && !f.limitDays) {
      wx.showToast({ title: '请设置过期日期或限制使用天数', icon: 'none' });
      return;
    }

    const openDate = f.openDate || util.formatDate(new Date());
    const expireDate = f.expireDate || util.calcExpireDate(openDate, parseInt(f.limitDays) || 30);
    const limitDays = f.limitDays || (expireDate && openDate ?
      Math.ceil((new Date(expireDate) - new Date(openDate)) / (1000 * 60 * 60 * 24)) : 30);

    const daysLeft = util.calcDaysLeft(expireDate);

    const item = {
      name: f.name.trim(),
      category: f.category,
      icon: util.getCategoryIcon(f.category),
      openDate: openDate,
      expireDate: expireDate,
      limitDays: parseInt(limitDays) || 30,
      note: f.note.trim(),
      daysLeft: daysLeft,
      photoPath: this.data.photoPath || '',
      barCode: this.data.scanCodeText || ''
    };
    // 编辑时保留已用完状态
    if (this.data.isEdit) {
      const old = app.globalData.items.find(i => i.id === this.data.editingId);
      if (old) item.used = !!old.used;
    }

    if (this.data.isEdit) {
      app.updateItem(this.data.editingId, item);
      wx.showToast({ title: '已保存', icon: 'success', duration: 1200 });
      setTimeout(() => wx.navigateBack(), 1200);
    } else {
      app.addItem(item);
      wx.showToast({ title: '添加成功', icon: 'success', duration: 1500 });
      setTimeout(() => wx.navigateBack(), 1500);
    }
  }
});