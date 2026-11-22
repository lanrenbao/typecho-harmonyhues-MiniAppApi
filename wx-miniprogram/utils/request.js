/**
 * 请求封装：统一拼参、密钥注入、超时、失败重试、错误信息友好化
 */
const cfg = require('../config');
const client = require('./client');

function buildUrl(path) {
  // devBase 用于本地联调：QQ 开发者工具模拟器用 XHR 发请求，
  // 服务端未返回 CORS 头会被浏览器拦截，可指向本地代理绕过
  const base = String(cfg.devBase || cfg.apiBase || '').replace(/\/+$/, '');
  const prefix = cfg.useIndexPhp ? '/index.php' : '';
  return base + prefix + path;
}

function toQuery(params) {
  const keys = Object.keys(params || {});
  const parts = [];
  for (let i = 0; i < keys.length; i++) {
    const v = params[keys[i]];
    if (v === '' || v === null || v === undefined) continue;
    parts.push(encodeURIComponent(keys[i]) + '=' + encodeURIComponent(v));
  }
  return parts.join('&');
}

function friendlyError(res) {
  const code = res && res.statusCode;
  if (!code) return '网络异常，请稍后重试';
  if (code === 404) return '接口不存在，请确认插件已启用';
  if (code === 500) return '服务器出错（500），请查看站点错误日志';
  if (code >= 500) return '服务器繁忙（' + code + '），稍后重试';
  if (code === 401 || code === 403) return '接口密钥校验失败，请核对 token';
  return '请求失败（' + code + '）';
}

/** 单次请求 */
function once(path, params, timeout) {
  const url = buildUrl(path);
  let qs = toQuery(params);
  if (cfg.token) {
    qs += (qs ? '&' : '') + 'token=' + encodeURIComponent(cfg.token);
  }
  const fullUrl = url + (qs ? '?' + qs : '');

  return new Promise((resolve, reject) => {
    client.request({
      url: fullUrl,
      method: 'GET',
      timeout: timeout || cfg.timeout || 15000,
      success(res) {
        const body = res.data;
        if (res.statusCode === 200 && body && body.code === 0) {
          resolve(body.data);
          return;
        }
        const err = new Error((body && body.msg) ? body.msg : friendlyError(res));
        err.statusCode = res.statusCode;
        reject(err);
      },
      fail(err) {
        const e = new Error('无法连接站点，请检查网络与域名白名单');
        e.raw = err;
        e.statusCode = 0;
        reject(e);
      }
    });
  });
}

/** 带一次自动重试的请求（仅对网络错误与 5xx 重试） */
function request(path, params, options) {
  const opts = options || {};
  const retry = opts.retry === undefined ? 1 : opts.retry;
  return once(path, params, opts.timeout).catch(err => {
    const retriable = !err.statusCode || err.statusCode >= 500;
    if (retry > 0 && retriable) {
      return new Promise(r => setTimeout(r, 400)).then(
        () => request(path, params, { timeout: opts.timeout, retry: retry - 1 })
      );
    }
    throw err;
  });
}

module.exports = { request, buildUrl };
