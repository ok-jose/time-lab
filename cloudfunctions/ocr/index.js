// cloudfunctions/ocr/index.js
// OCR 识别云函数 —— 调腾讯云 OCR 通用印刷体识别
//
// 调用方式：
//   event.fileID  云存储 fileID
//
// 链路：
//   1. fileID → 图片二进制（cloud.downloadFile）
//   2. 拼 TC3-HMAC-SHA256 签名 → 调腾讯云 ocr.tencentcloudapi.com
//   3. 当前云函数自己 https.request 走外网（外网出访权限已开通）
//   4. 拿到识别文字 → extractDates 提取日期 / 天数 / 名称
//
// 前置条件：
//   1. 云函数环境变量里配 TENCENT_SECRET_ID / TENCENT_SECRET_KEY
//   2. 云函数「外网出访」权限已开通（在云开发控制台 → ocr → 配置）
//
// 不再依赖 httpRequest 云函数 —— ocr 自己直接调外网，少一层依赖。

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const https = require('https');

/**
 * 云函数入口
 *
 * 链路：
 *   1. cloud.downloadFile 拿到图片二进制
 *   2. 腾讯云 OCR（GeneralBasicOCR） → rawText
 *   3. 结构化字段提取（双轨）：
 *      - 优先用 LLM（如果配了 LLM_API_URL + LLM_API_KEY 环境变量）
 *      - LLM 失败自动回退到正则
 *   4. 返回 { success, rawText, extracted, extractedBy }
 */
exports.main = async (event, context) => {
  const { fileID, type } = event;

  if (!fileID) {
    return { success: false, message: '缺少图片文件' };
  }

  try {
    // 1. 下载图
    const res = await cloud.downloadFile({ fileID });
    const imageBase64 = res.fileContent.toString('base64');

    // 2. 腾讯云 OCR → 原始文字
    const rawText = await callTencentOCR(imageBase64, type || 'general');
    console.log('[ocr] rawText:', rawText);

    // 3. 结构化抽取：先 LLM，失败回退正则
    const hasLLM = !!(process.env.LLM_API_URL && process.env.LLM_API_KEY);
    let extracted = null;
    let extractedBy = 'none';

    if (hasLLM) {
      try {
        const llmResult = await extractDatesByLLM(rawText);
        if (llmResult && (llmResult.expireDate || llmResult.openDate || llmResult.limitDays || llmResult.productName)) {
          extracted = llmResult;
          extractedBy = 'llm';
        } else {
          console.warn('[ocr] LLM 返回空，回退正则');
        }
      } catch (llmErr) {
        console.warn('[ocr] LLM 抽取失败，回退正则:', llmErr && llmErr.message);
      }
    }

    if (!extracted) {
      extracted = extractDatesByRegex(rawText);
      extractedBy = hasLLM ? 'regex-fallback' : 'regex';
    }

    return {
      success: true,
      rawText,
      extracted,
      extractedBy,
    };
  } catch (err) {
    console.error('OCR 失败:', err);
    return { success: false, message: '识别失败：' + (err && err.message ? err.message : String(err)) };
  }
};

/**
 * 调用腾讯云 OCR 通用文字识别
 * 当前云函数自己 https.request 走外网（外网出访权限已开通的情况下）
 */
async function callTencentOCR(imageBase64, type) {
  const crypto = require('crypto');

  const SECRET_ID = process.env.TENCENT_SECRET_ID || '';
  const SECRET_KEY = process.env.TENCENT_SECRET_KEY || '';

  if (!SECRET_ID || !SECRET_KEY) {
    throw new Error('未配置 OCR 密钥 TENCENT_SECRET_ID / TENCENT_SECRET_KEY');
  }

  const host = 'ocr.tencentcloudapi.com';
  const service = 'ocr';
  const action = type === 'recognizeTable' ? 'RecognizeTableOCR' : 'GeneralBasicOCR';
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
  const canonicalHeaders =
    'content-type:application/json; charset=utf-8\n' +
    `host:${host}\n` +
    `x-tc-action:${action.toLowerCase()}\n`;
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

  const authorization =
    `${algorithm} Credential=${SECRET_ID}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  // 当前云函数自己直接 https.request 调腾讯云 —— 不再依赖 httpRequest 云函数
  const resultBody = await httpsPostJson({
    host,
    path: '/',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Host': host,
      'X-TC-Action': action,
      'X-TC-Version': version,
      'X-TC-Timestamp': timestamp.toString(),
      'Authorization': authorization,
      'Content-Length': Buffer.byteLength(payload).toString()
    },
    body: payload
  });

  const result = JSON.parse(resultBody);
  if (result.Response && result.Response.Error) {
    throw new Error(result.Response.Error.Message || '腾讯云 OCR 返回错误');
  }

  const items = (result.Response && (result.Response.TextDetections || [])) || [];
  const texts = items.map((t) => t.DetectedText).join('\n');
  return texts;
}

/**
 * 内部：当前云函数直接 https POST JSON 出去
 */
function httpsPostJson({ host, path, headers, body }) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host,
        port: 443,
        path,
        method: 'POST',
        headers,
        timeout: 30000
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          resolve(data);
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.on('error', (err) => reject(err));
    req.write(body);
    req.end();
  });
}

/**
 * LLM 结构化抽取 —— 用 OpenAI 兼容协议（minimax / OpenAI / 其他都行）
 *
 * 环境变量：
 *   LLM_API_URL    例如 https://api.minimax.chat/v1/chat/completions
 *   LLM_API_KEY    Bearer Token
 *   LLM_MODEL      例如 MiniMax-Text-01 / gpt-4o-mini / qwen2.5-72b-instruct
 *
 * prompt 策略：
 *   - 强调「只输出 JSON，不要其他内容」，让小模型也稳定
 *   - 给 schema 示例，让 LLM 知道字段要求
 *   - temperature=0 保证输出稳定
 *   - 超时 8 秒（避免 OCR 整体被拖死，失败自动回退正则）
 */
async function extractDatesByLLM(text) {
  const url = process.env.LLM_API_URL;
  const key = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL || 'MiniMax-Text-01';

  const prompt = [
    '你是一个商品包装信息抽取助手。',
    '从下面这段由 OCR 识别出的（可能含错字、漏字、乱序、跨行）商品包装文字中，',
    '提取出 4 个字段：过期日期、生产日期、开封后使用天数、产品名。',
    '',
    '严格按下面 JSON 格式输出，不要任何解释、不要 markdown 代码块、不要多余字符：',
    '{',
    '  "expireDate": "YYYY-MM-DD 或空字符串",     // 优先选「有效期至 / 失效日期 / EXP / expiry」附近的日期',
    '  "openDate": "YYYY-MM-DD 或空字符串",       // 「生产日期 / manufacture / mfg date」附近的日期',
    '  "limitDays": "纯数字字符串 或空字符串",    // 「开封后 N 天 / 限用 N 天」',
    '  "productName": "产品名 或空字符串"         // 「品名 / 产品名称 / 商品名 / 通用名称」后的内容',
    '}',
    '',
    '识别提示：',
    '- 药品 / 食品包装的 OCR 文字经常出现方括号被识别错（[ 被错成 ( 【 】 》 等），按语义判断',
    '- 「批号 / LOT / 批次」后跟的数字是生产批号（如 2403212），不要当成日期',
    '- 日期格式可能是 2026.02.15 / 2026-02-15 / 2026年02月15日 / 2026.02（无日期时按 1 号算）',
    '- OCR 漏字时合理补全（如「有效期至 2026.02」补为 2026-02-01）',
    '',
    'OCR 文字：',
    text
  ].join('\n');

  const body = JSON.stringify({
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
    max_tokens: 300,
  });

  const resultBody = await new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        host: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
          'Content-Length': Buffer.byteLength(body).toString(),
        },
        timeout: 8000,
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { raw += c; });
        res.on('end', () => resolve(raw));
      }
    );
    req.on('timeout', () => req.destroy(new Error('llm timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  let json;
  try {
    const outer = JSON.parse(resultBody);
    const content = outer.choices[0].message.content;
    // 允许 LLM 把 JSON 包在 ```json ... ``` 里（兼容一些模型）
    const cleaned = content.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    json = JSON.parse(cleaned);
  } catch (parseErr) {
    throw new Error('LLM 返回解析失败: ' + parseErr.message);
  }

  return {
    expireDate: normalizeDate(json.expireDate),
    openDate: normalizeDate(json.openDate),
    limitDays: (json.limitDays != null && json.limitDays !== '') ? String(json.limitDays).replace(/\D/g, '') : '',
    productName: (json.productName || '').toString().trim().slice(0, 50),
  };
}

/**
 * 把 LLM 返回的日期规范化成 YYYY-MM-DD
 */
function normalizeDate(s) {
  if (!s) return '';
  const str = String(s).trim();
  if (!str) return '';
  // 匹配 YYYY[-./年]MM[-./月]DD[日号]?
  const m = str.match(/(\d{4})[-./年](\d{1,2})(?:[-./月](\d{1,2}))?[日号]?/);
  if (!m) return '';
  const y = m[1];
  const mo = String(parseInt(m[2], 10)).padStart(2, '0');
  const d = m[3] ? String(parseInt(m[3], 10)).padStart(2, '0') : '01';
  if (parseInt(y) < 2020 || parseInt(y) > 2099) return '';
  if (parseInt(mo) < 1 || parseInt(mo) > 12) return '';
  if (parseInt(d) < 1 || parseInt(d) > 31) return '';
  return `${y}-${mo}-${d}`;
}

/**
 * 从 OCR 文字中提取日期 / 限制天数 / 产品名（正则兜底实现）
 *
 * 鲁棒处理：
 *   - 接受方括号被 OCR 错识为 ( [ 【 】 》 等任意标点
 *   - 接受日期跨行（OCR 把同一字段拆成两行）
 *   - 接受日期不完整（缺日 → 默认 01）
 *   - 区分「有效期」「批号」「生产日期」三种数字，避免误把批号当日期
 *   - 退化策略：拿不到「有效期」上下文的日期时，取最晚出现的日期（药品包装一般把有效期放最后）
 */
function extractDatesByRegex(text) {
  const result = {
    expireDate: '',
    openDate: '',
    limitDays: '',
    productName: ''
  };

  if (!text || typeof text !== 'string') return result;

  // 把换行替换成单个空格，方便「有效期【至\n2026.02」这种跨行匹配
  const flat = text.replace(/\s+/g, ' ');

  // ===== 1. 找所有「可能的日期」 =====
  // 容忍 YYYY.MM.DD / YYYY-MM-DD / YYYY/MM/DD / YYYY年MM月DD日 / YYYY.MM.（缺日）
  const allDateMatches = [];
  const dateRegex = /(\d{4})[年.\-\/](\d{1,2})(?:[月.\-\/](\d{1,2}))?[日号]?/g;
  let m;
  while ((m = dateRegex.exec(flat)) !== null) {
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const day = m[3] ? parseInt(m[3], 10) : 1;
    // 只接受合理年份（2020 ~ 2099 之间的医药相关日期）
    if (year >= 2020 && year <= 2099 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      allDateMatches.push({
        format: `${m[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        index: m.index,
        context: flat.slice(Math.max(0, m.index - 25), m.index + 35),
        raw: m[0],
      });
    }
  }

  // ===== 2. 找「有效期」对应的日期 =====
  // 关键词：有效期 / 失效日期 / 过期 / EXP / 至 / expiry / valid until
  // 容忍关键词和日期之间有任意标点（包括 OCR 错识的 【 】 》 等）
  const expireKeywordRegex = /(有效期|失效日期|过期|EXP|expir|valid\s*until)/i;
  const batchKeywordRegex = /(批号|lot|batch|批次)/i;
  const mfgKeywordRegex = /(生产日期|制造日期|manufacture|mfg\s*date)/i;

  // 找到所有「有效期」关键词的位置，每个往前看最近的日期
  const expireContextRegex = /(有效期|失效日期|过期|EXP\b|expir|valid\s*until)/gi;
  let matchedExpire = null;
  while ((m = expireContextRegex.exec(flat)) !== null) {
    const kwIndex = m.index;
    // 关键词后面 30 字内找最近的日期
    const candidate = allDateMatches.find(d => d.index > kwIndex && d.index < kwIndex + 30);
    if (candidate) {
      matchedExpire = candidate;
      break;
    }
    // 关键词前面 20 字内（处理「日期 在关键词后」这种倒装）
    const reverse = allDateMatches.slice().reverse().find(d => d.index < kwIndex && kwIndex - d.index < 20);
    if (reverse) {
      matchedExpire = reverse;
      break;
    }
  }
  if (matchedExpire) {
    result.expireDate = matchedExpire.format;
  } else {
    // 退化：找离「批号」最远的日期（药品包装一般批号在前、效期在后）
    let batchIdx = -1;
    const batchMatch = flat.match(batchKeywordRegex);
    if (batchMatch) batchIdx = flat.indexOf(batchMatch[0]);
    if (batchIdx >= 0 && allDateMatches.length > 0) {
      const afterBatch = allDateMatches.filter(d => d.index > batchIdx);
      if (afterBatch.length > 0) {
        result.expireDate = afterBatch[afterBatch.length - 1].format;
      }
    }
    // 再退化：整个文本最晚出现的日期
    if (!result.expireDate && allDateMatches.length > 0) {
      result.expireDate = allDateMatches[allDateMatches.length - 1].format;
    }
  }

  // ===== 3. 限制使用天数（开封后 N 天） =====
  const daysPatterns = [
    /[开封开启]\s*[后最]?[多]?\s*(\d+)\s*[天日]/,
    /限用\s*(\d+)\s*天/,
    /(\d+)\s*天[内里]?[用使]完/,
    /保质期[至到]?\s*[:：]?\s*(\d+)\s*[个]?月/,
  ];
  for (const pattern of daysPatterns) {
    const dm = flat.match(pattern);
    if (dm) {
      result.limitDays = dm[1];
      break;
    }
  }

  // ===== 4. 生产日期（可选，药品一般不强制要） =====
  let mfgIdx = -1;
  if ((m = flat.match(mfgKeywordRegex))) {
    mfgIdx = m.index;
  }
  if (mfgIdx >= 0) {
    const mfgCandidate = allDateMatches.find(d => d.index > mfgIdx && d.index < mfgIdx + 30);
    if (mfgCandidate) result.openDate = mfgCandidate.format;
  }

  // ===== 5. 产品名 =====
  const namePatterns = [
    /品\s*名\s*[:：]\s*(.+?)(?:\s|$)/,
    /产品\s*名称\s*[:：]\s*(.+?)(?:\s|$)/,
    /商品\s*名\s*[:：]\s*(.+?)(?:\s|$)/,
    /通用名\s*称?\s*[:：]\s*(.+?)(?:\s|$)/,
  ];
  for (const pattern of namePatterns) {
    const nm = flat.match(pattern);
    if (nm) {
      result.productName = nm[1].trim().slice(0, 30);
      break;
    }
  }

  return result;
}