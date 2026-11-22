// 分享封面：把文章缩略图裁成微信转发卡片要求的 5:4（500×400）
// 流程：详情页拿到文章后先 prepareCover 预裁剪并缓存临时文件，
// 转发时 coverFor 同步取缓存 —— 点击转发时零等待。
const client = require('./client');

const W = 500;   // 微信分享卡片长宽比 5:4
const H = 400;
const cache = new Map();   // 原图地址 -> 裁剪后临时文件路径（会话内复用）

/** 离屏 canvas 按 cover 模式居中裁剪 */
function cropCover(src) {
  // 无缩略图，或环境不支持离屏 canvas 时放弃（转发卡片会用页面截图）
  if (!src || !client.createOffscreenCanvas || !client.canvasToTempFilePath) {
    return Promise.resolve(null);
  }
  if (cache.has(src)) {
    return Promise.resolve(cache.get(src) || null);
  }

  let canvas, img;
  try {
    canvas = client.createOffscreenCanvas({ type: '2d', width: W, height: H });
    img = canvas.createImage();
  } catch (e) {
    return Promise.resolve(null);
  }

  return new Promise(resolve => {
    img.onload = () => {
      try {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, W, H);
        // cover：短边铺满、长边居中裁掉
        const s = Math.max(W / img.width, H / img.height);
        const dw = img.width * s;
        const dh = img.height * s;
        ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
        client.canvasToTempFilePath({
          canvas: canvas,
          fileType: 'jpg',
          quality: 0.85,
          success: res => {
            cache.set(src, res.tempFilePath);
            resolve(res.tempFilePath);
          },
          fail: () => resolve(null)
        });
      } catch (e) {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** 预裁剪：页面加载后调用，成功与否都不阻塞界面 */
function prepareCover(src) {
  if (!src) return Promise.resolve(null);
  return cropCover(src).catch(() => null);
}

/** 转发时同步取封面：优先裁剪缓存 → 原图（微信会自行居中裁 5:4）→ 空（页面截图） */
function coverFor(src) {
  if (!src) return '';
  return cache.get(src) || src;
}

module.exports = { prepareCover: prepareCover, coverFor: coverFor };
