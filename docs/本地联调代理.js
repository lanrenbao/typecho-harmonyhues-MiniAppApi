/**
 * 本地联调代理（仅开发用，别上传到服务器）
 *
 * 背景：QQ/微信开发者工具的模拟器用 XHR 发请求，会先发 OPTIONS 预检；
 * 服务端（插件 1.3.2 之前）不返回 CORS 头就会被浏览器拦掉，表现为
 * 「无法连接站点 / request:fail」。
 *
 * 用法：
 *   1) node 本地联调代理.js
 *   2) qq-miniprogram/config.js 里把 devBase 改成 'http://127.0.0.1:8899'
 *   3) 开发者工具重新编译
 *   4) 正式发布前把 devBase 改回 ''
 *
 * 服务端插件升级到 1.3.2 之后就不需要它了。
 */
const http = require('http');
const https = require('https');

const PORT = 8899;
const HOST = 'www.xiehongwei.cn'; // ← 改成你的域名

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400'
};

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  console.log('[proxy]', req.method, req.url);

  const upstream = https.request(
    'https://' + HOST + req.url,
    { method: req.method, headers: { 'user-agent': 'local-dev-proxy' } },
    up => {
      const headers = Object.assign({}, up.headers, CORS);
      delete headers['content-encoding'];
      res.writeHead(up.statusCode || 502, headers);
      up.pipe(res);
    }
  );

  upstream.on('error', e => {
    res.writeHead(502, Object.assign({ 'content-type': 'application/json' }, CORS));
    res.end(JSON.stringify({ code: 1, msg: 'proxy error: ' + e.message }));
  });

  req.pipe(upstream);
}).listen(PORT, '127.0.0.1', () => {
  console.log('代理已启动：http://127.0.0.1:' + PORT + ' -> https://' + HOST);
});
