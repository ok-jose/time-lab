const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

/**
 * OCR 识别云函数
 * 调用腾讯云 OCR API 识别图片中的文字
 *
 * 前置条件：在云环境配置中设置环境变量：
 *   TENCENT_SECRET_ID  - 腾讯云 SecretId
 *   TENCENT_SECRET_KEY - 腾讯云 SecretKey
 */

exports.main = async (event, context) => {
  const { fileID, type } = event;

  if (!fileID) {
    return { success: false, message: '缺少图片文件' };
  }

  try {
    // 1. 下载云存储图片
    const res = await cloud.downloadFile({ fileID });
    const imageBase64 = res.fileContent.toString('base64');

    // 2. 调用腾讯云 OCR
    const ocrResult = await callTencentOCR(imageBase64, type || 'general');

    // 3. 从 OCR 结果中提取日期
    const extracted = extractDates(ocrResult);

    return {
      success: true,
      rawText: ocrResult,
      extracted
    };
  } catch (err) {
    console.error('OCR 失败:', err);
    return { success: false, message: '识别失败，请重试' };
  }
};

/**
 * 调用腾讯云 OCR 通用文字识别
 */
async function callTencentOCR(imageBase64, type) {
  const crypto = require('crypto');

  const SECRET_ID = process.env.TENCENT_SECRET_ID || '';
  const SECRET_KEY = process.env.TENCENT_SECRET_KEY || '';

  if (!SECRET_ID || !SECRET_KEY) {
    throw new Error('未配置 OCR 密钥');
  }

  const host = 'ocr.tencentcloudapi.com';
  const service = 'ocr';
  const action = type === 'general' ? 'GeneralBasicOCR' : 'RecognizeTableOCR';
  const version = '2018-11-19';
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().split('T')[0];

  const payload = JSON.stringify({
    ImageBase64: imageBase64,
    LanguageType: 'zh'
  });

  const hashedPayload = crypto.createHash('sha256').update(payload).digest('hex');
  const httpRequestMethod = 'POST';
  const canonicalUri = '/';
  const canonicalQueryString = '';
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`;
  const signedHeaders = 'content-type;host;x-tc-action';

  const canonicalRequest = [
    httpRequestMethod,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    hashedPayload
  ].join('\n');

  const algorithm = 'TC3-HMAC-SHA256';
  const credentialScope = `${date}/${service}/tc3_request`;
  const hashedCanonicalRequest = crypto.createHash('sha256').update(canonicalRequest).digest('hex');
  const stringToSign = [algorithm, timestamp, credentialScope, hashedCanonicalRequest].join('\n');

  const kDate = crypto.createHmac('sha256', `TC3${SECRET_KEY}`).update(date).digest();
  const kService = crypto.createHmac('sha256', kDate).update(service).digest();
  const kSigning = crypto.createHmac('sha256', kService).update('tc3_request').digest();
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const authorization = `${algorithm} Credential=${SECRET_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await cloud.callFunction({
    name: 'httpRequest',
    data: {
      url: `https://${host}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Host': host,
        'X-TC-Action': action,
        'X-TC-Version': version,
        'X-TC-Timestamp': timestamp.toString(),
        'Authorization': authorization
      },
      body: payload
    }
  });

  const result = JSON.parse(response.result.body);
  if (result.Response.Error) {
    throw new Error(result.Response.Error.Message);
  }

  const texts = (result.Response.TextDetections || [])
    .map(t => t.DetectedText)
    .join('\n');

  return texts;
}

/**
 * 从 OCR 文字中提取日期和限制天数
 */
function extractDates(text) {
  const result = {
    expireDate: '',
    openDate: '',
    limitDays: '',
    productName: ''
  };

  // 匹配过期日期（多种格式）
  const expPatterns = [
    /保质期[至到]?\s*[:：]?\s*(\d{4}[年.\-/]\d{1,2}[月.\-/]\d{1,2}[日号]?)/,
    /有效期[至到]?\s*[:：]?\s*(\d{4}[年.\-/]\d{1,2}[月.\-/]\d{1,2}[日号]?)/,
    /EXP\s*[:：]?\s*(\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2})/i,
    /有效期[:：]\s*(\d{4}[年.\-/]\d{1,2}[月.\-/]\d{1,2}[日号]?)/,
    /(\d{4}[年.\-/]\d{1,2}[月.\-/]\d{1,2}[日号]?)到期/,
    /生产日期.*?保质期[:：]?\s*(\d+)\s*[个]?月/,
  ];

  for (const pattern of expPatterns) {
    const match = text.match(pattern);
    if (match) {
      let dateStr = match[1];
      dateStr = dateStr.replace(/[年月]/g, '-').replace(/[日号]/g, '');
      // 确保月份和日期是两位数
      const parts = dateStr.split(/[.\-/]/);
      if (parts.length === 3) {
        parts[1] = parts[1].padStart(2, '0');
        parts[2] = parts[2].padStart(2, '0');
        result.expireDate = parts.join('-');
      }
      break;
    }
  }

  // 匹配限制使用天数
  const daysPatterns = [
    /[开封开启]后\s*(\d+)\s*天/,
    /限用\s*(\d+)\s*天/,
    /(\d+)\s*天[内里]?[用使]完/,
    /开封后[最]?[多]?\s*(\d+)\s*[天日]/,
  ];

  for (const pattern of daysPatterns) {
    const match = text.match(pattern);
    if (match) {
      result.limitDays = match[1];
      break;
    }
  }

  // 匹配产品名称
  const namePatterns = [
    /品名[:：]\s*(.+?)(?:\s|$)/,
    /产品名称[:：]\s*(.+?)(?:\s|$)/,
    /商品名[:：]\s*(.+?)(?:\s|$)/,
  ];

  for (const pattern of namePatterns) {
    const match = text.match(pattern);
    if (match) {
      result.productName = match[1].trim();
      break;
    }
  }

  return result;
}