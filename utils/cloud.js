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

/** OCR 识别（传入云存储 fileID） — 旧版走云函数 ocr，已废弃，新代码用 utils/ocr.js */
function ocr(fileID) {
  return callFn('ocr', { fileID });
}

/** 取云存储 HTTPS 临时 URL（serviceMarket OCR 强制要求 HTTPS） */
function getTempFileURL(fileID) {
  if (!isCloudReady()) return Promise.reject(new Error('cloud-not-configured'));
  return new Promise((resolve, reject) => {
    wx.cloud.getTempFileURL({
      fileList: [fileID],
      success: (res) => {
        const item = (res.fileList && res.fileList[0]) || {};
        if (item.status !== 0 || !item.tempFileURL) {
          return reject(new Error(item.errMsg || 'getTempFileURL failed'));
        }
        resolve(item.tempFileURL);
      },
      fail: (err) => reject(err),
    });
  });
}

/** 条形码商品查询 */
function lookupBarcode(barcode) {
  return callFn('barcodeLookup', { barcode });
}

module.exports = {
  isCloudReady,
  uploadFile,
  ocr,
  getTempFileURL,
  lookupBarcode,
};
