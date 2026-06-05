const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

/**
 * 条形码商品查询云函数
 * 调用中国物品编码中心 API 或第三方条码库
 *
 * 免费 API 方案：
 * 1. 中国物品编码中心（https://www.gds.org.cn/）
 * 2. 阿里云市场条码查询（0.01元/次）
 * 3. 聚合数据条码查询
 *
 * 备用方案：直接返回条码号作为商品标识
 */

exports.main = async (event, context) => {
  const { barcode } = event;

  if (!barcode) {
    return { success: false, message: '缺少条码号' };
  }

  try {
    // 方案1: 尝试调用第三方API
    // const result = await queryBarcodeAPI(barcode);
    // if (result.success) return result;

    // 方案2（备用）: 本地解析条码前缀
    return localBarcodeInfo(barcode);
  } catch (err) {
    console.error('条码查询失败:', err);
    return localBarcodeInfo(barcode);
  }
};

/**
 * 本地条码信息解析（备用方案）
 * 基于中国商品条码前缀规则
 */
function localBarcodeInfo(barcode) {
  const prefixMap = {
    '690': '中国',
    '691': '中国',
    '692': '中国',
    '693': '中国',
    '694': '中国',
    '695': '中国',
    '696': '中国',
    '697': '中国',
    '698': '中国',
    '699': '中国',
    '880': '韩国',
    '490': '日本',
    '450': '日本',
    '400': '德国',
    '500': '英国',
    '300': '法国',
    '800': '意大利',
    '930': '澳大利亚',
    '940': '新西兰',
    '000': '美国',
    '060': '美国',
    '070': '挪威',
    '200': '内部使用',
  };

  const prefix3 = barcode.substring(0, 3);
  const prefix2 = barcode.substring(0, 2);
  const country = prefixMap[prefix3] || prefixMap[prefix2] || '未知产地';

  return {
    success: true,
    barcode,
    country,
    // 如果是13位EAN-13码，提取厂商码
    manufacturerCode: barcode.length >= 8 ? barcode.substring(0, 7) : '',
    productCode: barcode.length >= 9 ? barcode.substring(7, 12) : '',
    suggestion: '请手动补充商品名称和规格'
  };
}