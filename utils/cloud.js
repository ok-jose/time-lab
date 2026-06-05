// utils/cloud.js
// 云开发调用封装
// 设计原则：未开通云开发时所有函数静默返回 { ok: false, reason: 'cloud-not-configured' }，调用方根据 ok 决定降级行为

const config = require('./cloudConfig');

/** 检测云开发是否就绪（wx.cloud 存在 + envId 已配置） */
function isCloudReady() {
  if (typeof wx === 'undefined' || !wx.cloud) return false;
  if (!config.envId || config.envId.indexOf('__REPLACE') === 0) return false;
  return true;
}

/** 上传本地临时文件到云存储 */
function uploadFile(cloudPath, filePath) {
  if (!isCloudReady()) return Promise.resolve({ ok: false, reason: 'cloud-not-configured' });
  return new Promise((resolve) => {
    wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success: (res) => resolve({ ok: true, data: { fileID: res.fileID } }),
      fail: (err) => resolve({ ok: false, reason: 'upload-failed', error: err })
    });
  });
}

/** 调云函数并统一结果 */
function callFn(name, data) {
  if (!isCloudReady()) return Promise.resolve({ ok: false, reason: 'cloud-not-configured' });
  return new Promise((resolve) => {
    wx.cloud.callFunction({
      name,
      data,
      success: (res) => {
        const result = res.result || {};
        if (result.success === false) {
          resolve({ ok: false, reason: 'fn-returned-false', data: result });
        } else {
          resolve({ ok: true, data: result });
        }
      },
      fail: (err) => resolve({ ok: false, reason: 'call-failed', error: err })
    });
  });
}

/** OCR 识别（传入云存储 fileID） */
function ocr(fileID) {
  return callFn('ocr', { fileID });
}

/** 条形码商品查询 */
function lookupBarcode(barcode) {
  return callFn('barcodeLookup', { barcode });
}

/** 保存订阅消息授权到云数据库（subscriptions 集合） */
function saveSubscription(templateId) {
  if (!isCloudReady()) return Promise.resolve({ ok: false, reason: 'cloud-not-configured' });
  const db = wx.cloud.database();
  // client 端默认只能读到自己 _openid 的记录（需要 collection 权限设为"仅创建者可读写"）
  return new Promise((resolve) => {
    db.collection('subscriptions').limit(1).get({
      success: (res) => {
        if (res.data && res.data.length > 0) {
          db.collection('subscriptions').doc(res.data[0]._id).update({
            data: { templateId, updatedAt: Date.now() },
            success: () => resolve({ ok: true }),
            fail: (err) => resolve({ ok: false, reason: 'db-update-failed', error: err })
          });
        } else {
          db.collection('subscriptions').add({
            data: { templateId, createdAt: Date.now() },
            success: () => resolve({ ok: true }),
            fail: (err) => resolve({ ok: false, reason: 'db-add-failed', error: err })
          });
        }
      },
      fail: (err) => resolve({ ok: false, reason: 'db-query-failed', error: err })
    });
  });
}

/** 删除订阅记录（关闭提醒时调用） */
function removeSubscription() {
  if (!isCloudReady()) return Promise.resolve({ ok: false, reason: 'cloud-not-configured' });
  const db = wx.cloud.database();
  return new Promise((resolve) => {
    db.collection('subscriptions').limit(1).get({
      success: (res) => {
        if (!res.data || res.data.length === 0) return resolve({ ok: true });
        db.collection('subscriptions').doc(res.data[0]._id).remove({
          success: () => resolve({ ok: true }),
          fail: (err) => resolve({ ok: false, reason: 'db-remove-failed', error: err })
        });
      },
      fail: (err) => resolve({ ok: false, reason: 'db-query-failed', error: err })
    });
  });
}

module.exports = {
  isCloudReady,
  uploadFile,
  ocr,
  lookupBarcode,
  saveSubscription,
  removeSubscription
};
