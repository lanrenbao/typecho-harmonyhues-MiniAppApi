/**
 * 展示层格式化
 */
const cfg = require('../config');

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

/** 时间友好化：刚刚 / x分钟前 / 今天 HH:mm / 昨天 / MM-DD / YYYY-MM-DD */
function friendlyTime(ts, now) {
  const t = parseInt(ts, 10);
  if (!t) return '';
  const cur = now || Date.now();
  const d = new Date(t * 1000);
  const diff = Math.floor((cur - t * 1000) / 1000);

  if (diff >= 0 && diff < 60) return '刚刚';
  if (diff >= 60 && diff < 3600) return Math.floor(diff / 60) + ' 分钟前';

  const today = new Date(cur);
  const sameDay = d.getFullYear() === today.getFullYear()
    && d.getMonth() === today.getMonth()
    && d.getDate() === today.getDate();
  if (sameDay) return '今天 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());

  const y = new Date(cur - 86400000);
  const isYesterday = d.getFullYear() === y.getFullYear()
    && d.getMonth() === y.getMonth()
    && d.getDate() === y.getDate();
  if (isYesterday) return '昨天 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());

  if (d.getFullYear() === today.getFullYear()) {
    return pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/** 相对地址补全为绝对地址 */
function absUrl(url, base) {
  const u = String(url || '').trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.indexOf('//') === 0) return u;
  const root = String(base || cfg.apiBase || '').replace(/\/+$/, '');
  if (u.charAt(0) === '/') return root + u;
  return root + '/' + u;
}

/** 字数与阅读时长（中文按 400 字/分钟估） */
function readingStats(text) {
  const s = String(text || '');
  const chars = s.replace(/\s/g, '').length;
  return {
    chars: chars,
    minutes: Math.max(1, Math.round(chars / 400))
  };
}

/** 数字千分位 */
function number(n) {
  const v = parseInt(n, 10) || 0;
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 给接口返回的文章附加展示字段 */
function decoratePost(item) {
  if (!item) return item;
  return Object.assign({}, item, {
    timeText: friendlyTime(item.created),
    excerptText: item.excerpt || ''
  });
}

module.exports = { friendlyTime, absUrl, readingStats, number, pad, decoratePost };
