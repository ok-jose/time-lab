const util = require('../../utils/util');
const cloud = require('../../utils/cloud');
const app = getApp();

Page({
  data: {
    isEdit: false,
    editingId: null,
    pageTitle: '添加物品',
    currentMode: 'ocr',
    categories: util.getDefaultCategories(),
    templates: util.getTemplates(),
    ocrImagePath: '',
    ocrResult: '',          // 兼容老字段：原始识别文本（无云时也用）
    ocrExtracted: null,     // 云端解析后字段：{ expireDate, openDate, limitDays, productName }
    ocrLoading: false,
    ocrFilled: false,       // 标记是否已经一键填过（防重复覆盖）
    scanResult: '',
    scanCodeText: '',
    scanInfo: null,         // 云端条码查询：{ country, manufacturerCode, productCode }
    scanLoading: false,
    photoPath: '',
    cloudReady: false,
    form: {
      name: '',
      category: '其他',
      openDate: '',
      expireDate: '',
      limitDays: '',
      note: '',
      location: ''
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
          cloudReady: cloud.isCloudReady(),
          form: {
            name: item.name || '',
            category: item.category || '其他',
            openDate: item.openDate || '',
            expireDate: item.expireDate || '',
            limitDays: item.limitDays ? String(item.limitDays) : '',
            note: item.note || '',
            location: item.location || ''
          }
        });
        wx.setNavigationBarTitle({ title: '编辑物品' });
        return;
      }
    }
    this.setData({
      'form.openDate': util.formatDate(new Date()),
      cloudReady: cloud.isCloudReady()
    });
    wx.setNavigationBarTitle({ title: '添加物品' });
  },

  switchMode(e) {
    this.setData({ currentMode: e.currentTarget.dataset.mode });
  },

  /** 应用预设模板：把模板字段填进 form，不覆盖用户已输入的值 */
  onApplyTemplate(e) {
    const id = e.currentTarget.dataset.id;
    const tpl = util.getTemplateById(id);
    if (!tpl) return;
    const form = { ...this.data.form };
    if (!form.name) form.name = tpl.name;
    if (!form.category || form.category === '其他') form.category = tpl.category;
    if (!form.limitDays) {
      // 改 limitDays 会触发 autoCalcForm 联动算出 expireDate
      Object.assign(form, util.autoCalcForm({ ...form, limitDays: String(tpl.limitDays) }, 'limitDays'));
    }
    if (!form.location) form.location = tpl.location;
    this.setData({ form });
    wx.showToast({ title: `已套用「${tpl.name}」模板`, icon: 'success', duration: 1500 });
  },

  // ============ OCR 识别：拍照 → 上传云存储 → 调云函数解析 → 一键填表 ============
  async takeOCRPhoto() {
    try {
      const res = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['camera'],
        camera: 'back'
      });
      const path = res.tempFiles[0].tempFilePath;
      this.setData({
        ocrImagePath: path,
        ocrExtracted: null,
        ocrFilled: false
      });

      if (!cloud.isCloudReady()) {
        // 降级：未开通云开发时只拍照不识别，让用户手动填
        this.setData({ ocrResult: '云开发未配置 OCR，请手动填写或开通云开发后重试（详见 CLOUD_SETUP.md）' });
        return;
      }

      this.setData({ ocrLoading: true });
      // 上传到云存储（路径：ocr/{时间戳}-{随机}.jpg）
      const cloudPath = `ocr/${Date.now()}-${Math.floor(Math.random() * 10000)}.jpg`;
      const upRes = await cloud.uploadFile(cloudPath, path);
      if (!upRes.ok) {
        this.setData({ ocrLoading: false });
        wx.showToast({ title: '图片上传失败：' + upRes.reason, icon: 'none' });
        return;
      }
      // 调云函数识别
      const ocrRes = await cloud.ocr(upRes.data.fileID);
      this.setData({ ocrLoading: false });
      if (!ocrRes.ok) {
        wx.showToast({ title: 'OCR 识别失败：' + (ocrRes.data && ocrRes.data.message || ocrRes.reason), icon: 'none' });
        this.setData({ ocrResult: '识别失败：' + (ocrRes.data && ocrRes.data.message || ocrRes.reason) });
        return;
      }
      const extracted = ocrRes.data.extracted || {};
      this.setData({
        ocrExtracted: extracted,
        ocrResult: ocrRes.data.rawText || '（未提取到文本）'
      });
      // 如果至少解析出 1 个字段，提示用户一键填入
      const hits = ['expireDate', 'openDate', 'limitDays', 'productName'].filter(k => extracted[k]);
      if (hits.length > 0) {
        wx.showToast({ title: `已识别 ${hits.length} 个字段，点击下方填入表单`, icon: 'none', duration: 2200 });
      } else {
        wx.showToast({ title: '未识别到有效日期，请手动填写', icon: 'none' });
      }
    } catch (err) {
      // chooseMedia 失败 / 用户取消
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

  /** 把 OCR 解析结果批量填入 form（仅填空字段，不覆盖用户已输入的值） */
  fillFromOCR() {
    const ex = this.data.ocrExtracted;
    if (!ex) return;
    const form = { ...this.data.form };
    if (ex.productName && !form.name) form.name = ex.productName;
    if (ex.expireDate) {
      // 改 expireDate 会触发 autoCalcForm
      Object.assign(form, util.autoCalcForm({ ...form, expireDate: ex.expireDate }, 'expireDate'));
    }
    if (ex.openDate && !form.openDate) {
      Object.assign(form, util.autoCalcForm({ ...form, openDate: ex.openDate }, 'openDate'));
    }
    if (ex.limitDays && !form.limitDays) {
      form.limitDays = ex.limitDays;
      // 改 limitDays 也走联动
      const synced = util.autoCalcForm({ ...form, limitDays: ex.limitDays }, 'limitDays');
      Object.assign(form, synced);
    }
    this.setData({ form, ocrFilled: true });
    wx.showToast({ title: '已填入表单，请检查', icon: 'success' });
  },

  // ============ 扫码录入：扫码 → 查云端条码库 → 显示国家/厂商码 ============
  async scanCode() {
    try {
      const res = await wx.scanCode({ scanType: ['barCode', 'qrCode'] });
      const codeText = res.result;
      this.setData({ scanCodeText: codeText, scanResult: '条码号: ' + codeText, scanInfo: null });

      if (!cloud.isCloudReady()) {
        // 降级：只记录条码号，不查云端
        this.setData({ scanResult: '条码号: ' + codeText + '\n\n云开发未配置，跳过商品查询（详见 CLOUD_SETUP.md）' });
        return;
      }

      this.setData({ scanLoading: true });
      const r = await cloud.lookupBarcode(codeText);
      this.setData({ scanLoading: false });
      if (r.ok) {
        const info = r.data;
        const lines = [
          '条码号: ' + codeText,
          '产地: ' + (info.country || '未知'),
          info.manufacturerCode ? '厂商码: ' + info.manufacturerCode : null,
          info.suggestion || '请手动填写商品名称'
        ].filter(Boolean);
        this.setData({ scanResult: lines.join('\n'), scanInfo: info });
      } else {
        this.setData({ scanResult: '条码号: ' + codeText + '\n\n查询失败：' + r.reason });
      }
    } catch (err) {
      if (err && err.errMsg && err.errMsg.indexOf('cancel') !== -1) return;
      wx.showToast({ title: '扫码失败，请重试', icon: 'none' });
    }
  },

  fillFromScan() {
    if (!this.data.scanCodeText) return;
    const form = { ...this.data.form };
    if (!form.name) {
      // 优先用云端返回的厂商码后缀当兜底名称
      const tail = this.data.scanInfo && this.data.scanInfo.productCode
        ? this.data.scanInfo.productCode
        : this.data.scanCodeText.slice(-6);
      form.name = '商品 (' + tail + ')';
    }
    // 扫码得到的条码写到备注里，方便以后查
    if (!form.note && this.data.scanInfo) {
      form.note = '条码 ' + this.data.scanCodeText + '（' + (this.data.scanInfo.country || '未知产地') + '）';
    } else if (!form.note) {
      form.note = '条码 ' + this.data.scanCodeText;
    }
    this.setData({ form });
    wx.showToast({ title: '已填入条码信息', icon: 'success' });
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
  onInputLocation(e) { this.setData({ 'form.location': e.detail.value }); },

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
      location: (f.location || '').trim(),
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