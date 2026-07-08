// cloudfunctions/httpRequest/index.js
// 通用 HTTPS 代理云函数 —— 让其他云函数能调外网 API
//
// 接收参数：
//   url       string  目标 URL（必须 https）
//   method    string  GET / POST，默认 POST
//   headers   object  请求头
//   body      string  请求体（已序列化好的字符串）
//
// 返回：
//   statusCode  int
//   headers     object
//   body        string  响应体（原始）
//
// 不需要 npm 依赖 —— 直接用 Node 内置的 https 模块。

const https = require('https');
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const { url, method, headers, body } = event;

  if (!url) {
    return { statusCode: 400, body: 'missing url' };
  }

  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      resolve({ statusCode: 400, body: 'invalid url: ' + url });
      return;
    }

    const opts = {
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: (method || 'POST').toUpperCase(),
      headers: headers || {},
      timeout: 30000,
    };

    const req = https.request(opts, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data,
        });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('request timeout'));
    });
    req.on('error', (err) => {
      reject(err);
    });

    if (body) req.write(body);
    req.end();
  });
};