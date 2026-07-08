// utils/ocr.js
// 客户端 OCR 调用 —— 走云函数 ocr（cloud.openapi.ocr.printedText）
//
// 调用流程：
//   1. 拍照拿到本地 tempFilePath
//   2. wx.cloud.uploadFile 上传到云存储 → fileID
//   3. wx.cloud.callFunction('ocr', { fileID })
//   4. 云函数里用 cloud.openapi.ocr.printedText 识别（通用印刷体）
//   5. 云函数提取日期返回，前端拿到填进 batch 列表 / editItem 表单
//
// 个人小程序可用，500 次/天 免费，无需密钥，无需外网出访。

/** 调云函数 ocr 识别（传入云存储 fileID） */
function ocrByCloudFile(fileID) {
  if (typeof wx === 'undefined' || !wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    return Promise.resolve({ ok: false, reason: 'cloud-not-ready' });
  }
  return new Promise((resolve) => {
    wx.cloud.callFunction({
      name: 'ocr',
      data: { fileID },
      success: (res) => {
        const result = res.result || {};
        if (result.success === false) {
          resolve({ ok: false, reason: 'fn-returned-false', message: result.message });
        } else {
          resolve({
            ok: true,
            rawText: result.rawText || '',
            extracted: result.extracted || {},
          });
        }
      },
      fail: (err) => resolve({ ok: false, reason: 'call-failed', error: err }),
    });
  });
}

/** 兼容老 API 名字（之前用的 ocrByCloudFile / ocrFromLocalPath 都重定向到这里） */
const ocrFromLocalPath = ocrByCloudFile;

module.exports = {
  ocrByCloudFile,
  ocrFromLocalPath,
};