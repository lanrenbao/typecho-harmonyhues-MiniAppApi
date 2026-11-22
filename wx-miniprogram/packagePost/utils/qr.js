// 二维码绘制：qrcode-generator（MIT, Kazuhiko Arase）封装成「直接画到 canvas」的小工具
// 用于海报右下角 —— 扫码跳转网页端文章页，不跳小程序
const qrcode = require('./qrlib');

const QUIET = 2; // 静区模块数（四周留白），太小会扫不出
const DARK = '#20201C';

function build(text) {
  const q = qrcode(0, 'M'); // 0 = 自动选版本，M = 15% 纠错
  q.addData(String(text), 'Byte');
  q.make();
  return q;
}

/**
 * 画二维码（含白底静区）
 * @param {Object} ctx  canvas 2d context
 * @param {String} text 内容（网页地址）
 * @param {Number} x,y  左上角
 * @param {Number} size 目标边长
 * @returns {Boolean} 是否绘制成功
 */
function draw(ctx, text, x, y, size) {
  let q;
  try {
    q = build(text);
  } catch (e) {
    return false;
  }
  const count = q.getModuleCount();
  const total = count + QUIET * 2;
  const ms = Math.max(1, Math.floor(size / total)); // 整数模块，避免锯齿
  const real = ms * total;
  const ox = Math.round(x + (size - real) / 2);
  const oy = Math.round(y + (size - real) / 2);

  // 白底（同时充当静区）
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(ox, oy, real, real);

  ctx.fillStyle = DARK;
  const gap = ms > 3 ? 0 : 0.5; // 模块很小时留一丝缝隙，防止糊成一团
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (!q.isDark(r, c)) continue;
      ctx.fillRect(ox + (c + QUIET) * ms, oy + (r + QUIET) * ms, ms - gap, ms - gap);
    }
  }
  return true;
}

module.exports = { draw: draw };
