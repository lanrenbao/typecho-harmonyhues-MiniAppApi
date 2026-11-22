// 文章海报：封面 + 日期块 + 标题 + 作者分类 + 页脚（logo / 二维码）
// 纯离屏 canvas 绘制；二维码指向网页端文章页，扫码即回到网站
const client = require('../../utils/client');
const cfg = require('../../config');
const qr = require('./qr');

const W = 750;
const PAD = 44;
const COVER_RATIO = 1.5; // 封面 3:2
const COVER_W = W - PAD * 2;
const COVER_H = Math.round(COVER_W / COVER_RATIO);
const COVER_R = 18;

const GAP_COVER = 44;    // 封面 → 正文区
const DATE_W = 176;
const DATE_H = 190;
const DATE_R = 16;
const COL_GAP = 40;

const TITLE_SIZE = 44;
const TITLE_LH = 62;
const META_SIZE = 27;
const GAP_DIVIDER = 38;

const FOOT_GAP = 36;
const QR_SIZE = 190;
const FOOT_BOTTOM = 44;

const WEEK = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

const C = {
  paper: '#F6F5F2',
  card: '#FFFFFF',
  ink: '#22201E',
  body: '#3A4048',
  muted: '#9BA1A8',
  grey: '#9C9C98',
  line: '#E8E4DC',
  red: '#C0392F'
};

const FONT = '"PingFang SC", "Helvetica Neue", sans-serif';
const SERIF = '"Songti SC", Georgia, serif';

/** 圆角矩形路径 */
function roundPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 逐字换行，超出 maxLines 时最后一行截断加省略号 */
function wrapText(ctx, text, maxWidth, maxLines) {
  const lines = [];
  let cur = '';
  let truncated = false;
  for (const ch of String(text || '')) {
    if (ctx.measureText(cur + ch).width > maxWidth) {
      lines.push(cur);
      cur = ch;
      if (lines.length === maxLines) {
        truncated = true;
        break;
      }
    } else {
      cur += ch;
    }
  }
  if (!truncated && cur) lines.push(cur);
  if (truncated) {
    let last = lines[maxLines - 1];
    while (last && ctx.measureText(last + '…').width > maxWidth) {
      last = last.slice(0, -1);
    }
    lines[maxLines - 1] = last + '…';
  }
  return lines;
}

/** cover 模式把图片画进目标矩形（短边铺满、长边居中裁掉） */
function drawCover(ctx, img, x, y, w, h) {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function loadImage(canvas, src) {
  return new Promise(resolve => {
    if (!src) return resolve(null);
    let img;
    try {
      img = canvas.createImage();
    } catch (e) {
      return resolve(null);
    }
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** 站点 logo：包内路径 → 再换写法 → 退到 getImageInfo 拿本地路径，都不成返回 null */
function loadLogo(canvas) {
  return loadImage(canvas, '/assets/logo.png').then(img => {
    if (img) return img;
    return loadImage(canvas, 'assets/logo.png').then(img2 => {
      if (img2) return img2;
      return new Promise(resolve => {
        if (!client.getImageInfo) return resolve(null);
        client.getImageInfo({
          src: '/assets/logo.png',
          success: res => loadImage(canvas, res.path).then(resolve),
          fail: () => resolve(null)
        });
      });
    });
  });
}

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

/** 文章日期：优先发布时间戳，退回 createdText */
function dateOf(post) {
  const ts = post && post.created ? Number(post.created) * 1000 : 0;
  if (ts > 0) return new Date(ts);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((post && post.createdText) || '');
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date();
}

/** 网页端文章地址（二维码扫出来就是它） */
function urlOf(post) {
  const p = (post && (post.permalink || post.link || post.url)) || '';
  if (p) return p;
  const base = String(cfg.apiBase || '').replace(/\/+$/, '');
  return base + '/archives/' + ((post && post.cid) || '') + '.html';
}

/** 文件名主体：优先文章 slug（ASCII），纯数字 slug 或为空时用 post+id */
function baseName(post) {
  const slug = (post && post.slug) || '';
  if (/^[A-Za-z0-9_-]{2,40}$/.test(slug) && !/^\d+$/.test(slug)) return slug;
  return 'post' + ((post && post.cid) || Date.now());
}

/** xiehongwei-<slug|post+id>-YYYYMMDD-HHmm.jpg */
function fileNameFor(post) {
  const d = new Date();
  const stamp = '' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate())
    + '-' + pad2(d.getHours()) + pad2(d.getMinutes());
  return 'xiehongwei-' + baseName(post) + '-' + stamp + '.jpg';
}

/**
 * 给临时文件起正式文件名后返回路径（保存到相册时用，文件名会一路带到相册）
 * 预览仍用临时路径 —— 文件名进 <image src> 会被 URL 编码，务必别混用
 */
function renameForSave(tempPath, post) {
  return new Promise(resolve => {
    if (!client.getFileSystemManager || !client.env) return resolve(tempPath);
    try {
      client.getFileSystemManager().saveFile({
        tempFilePath: tempPath,
        filePath: client.env.USER_DATA_PATH + '/' + fileNameFor(post),
        success: res => resolve(res.savedFilePath || tempPath),
        fail: () => resolve(tempPath)
      });
    } catch (e) {
      resolve(tempPath);
    }
  });
}

/**
 * 生成海报
 * @param {Object} post 文章对象（title / cid / created / categories）
 * @param {Object} opts { cover }
 * @returns Promise<tempFilePath>
 */
function generate(post, opts) {
  opts = opts || {};
  if (!client.createOffscreenCanvas || !client.canvasToTempFilePath) {
    return Promise.reject(new Error('当前环境不支持生成海报'));
  }

  const date = dateOf(post);
  const target = urlOf(post);
  const category = (post && post.categories && post.categories[0] && post.categories[0].name) || '';
  const author = (cfg.author || '').trim();
  const metaBits = [];
  if (author) metaBits.push('作者：' + author);
  if (category) metaBits.push('分类：' + category);
  const metaText = metaBits.join('  |  ');

  // ---------- 第一遍：量标题行数 → 算总高 ----------
  const contentTop = PAD + COVER_H + GAP_COVER;
  const textX = PAD + DATE_W + COL_GAP;
  const textW = W - PAD - textX;
  let titleLines = [];

  // 页脚高度固定，正文区高度取「日期块 / 标题+元信息」里更高的那个
  const footTop0 = contentTop + DATE_H + GAP_DIVIDER + 2 + FOOT_GAP;
  let H = footTop0 + QR_SIZE + FOOT_BOTTOM;

  try {
    const gauge = client.createOffscreenCanvas({ type: '2d', width: W, height: 400 });
    const g = gauge.getContext('2d');
    g.font = '700 ' + TITLE_SIZE + 'px ' + FONT;
    titleLines = wrapText(g, (post && post.title) || '', textW, 2);
    const bodyH = Math.max(DATE_H, 66 + Math.max(1, titleLines.length) * TITLE_LH);
    H = contentTop + bodyH + GAP_DIVIDER + 2 + FOOT_GAP + QR_SIZE + FOOT_BOTTOM;
  } catch (e) {
    H = footTop0 + QR_SIZE + FOOT_BOTTOM;
  }
  H = Math.round(Math.max(900, Math.min(1600, H)));

  // ---------- 第二遍：按实际高度绘制 ----------
  let canvas;
  try {
    canvas = client.createOffscreenCanvas({ type: '2d', width: W, height: H });
  } catch (e) {
    return Promise.reject(e);
  }
  const ctx = canvas.getContext('2d');

  return Promise.all([
    loadImage(canvas, opts.cover || ''),
    loadLogo(canvas)
  ]).then(([cover, logo]) => {
    ctx.textBaseline = 'alphabetic';

    // ---------- 纸底 ----------
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, W, H);

    // ---------- 封面 ----------
    roundPath(ctx, PAD, PAD, COVER_W, COVER_H, COVER_R);
    if (cover) {
      ctx.save();
      ctx.clip();
      drawCover(ctx, cover, PAD, PAD, COVER_W, COVER_H);
      ctx.restore();
    } else {
      ctx.fillStyle = '#EFEAE3';
      ctx.fill();
      ctx.fillStyle = C.red;
      ctx.font = '600 60px ' + SERIF;
      ctx.textAlign = 'center';
      ctx.fillText('書', W / 2, PAD + COVER_H / 2 + 22);
      ctx.textAlign = 'left';
    }

    // ---------- 日期块 ----------
    ctx.save();
    ctx.shadowColor = 'rgba(60,50,40,0.07)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 4;
    roundPath(ctx, PAD, contentTop, DATE_W, DATE_H, DATE_R);
    ctx.fillStyle = C.card;
    ctx.fill();
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.fillStyle = C.red;
    ctx.font = '700 34px ' + FONT;
    ctx.fillText(WEEK[date.getDay()], PAD + DATE_W / 2, contentTop + 58);

    ctx.fillStyle = C.ink;
    ctx.font = '700 94px ' + FONT;
    ctx.fillText(String(date.getDate()), PAD + DATE_W / 2, contentTop + 158);
    ctx.textAlign = 'left';

    // ---------- 标题 ----------
    ctx.fillStyle = C.ink;
    ctx.font = '700 ' + TITLE_SIZE + 'px ' + FONT;
    let ty = contentTop + 52;
    titleLines.forEach(line => {
      ctx.fillText(line, textX, ty);
      ty += TITLE_LH;
    });

    // ---------- 作者 / 分类 ----------
    if (metaText) {
      ctx.fillStyle = C.muted;
      ctx.font = META_SIZE + 'px ' + FONT;
      ctx.fillText(metaText, textX, ty + 6);
    }

    // ---------- 分隔线 ----------
    const bodyH = Math.max(DATE_H, ty + 6 - contentTop + 8);
    const dividerY = contentTop + bodyH + GAP_DIVIDER;
    ctx.fillStyle = C.line;
    ctx.fillRect(PAD, dividerY, W - PAD * 2, 2);

    // ---------- 页脚 ----------
    const footTop = dividerY + 2 + FOOT_GAP;
    const logoSize = 46;
    if (logo) {
      ctx.drawImage(logo, PAD, footTop + 2, logoSize, logoSize);
    } else {
      // 兜底：画个小印
      roundPath(ctx, PAD, footTop + 2, logoSize, logoSize, 10);
      ctx.fillStyle = C.red;
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '600 26px ' + SERIF;
      ctx.textAlign = 'center';
      ctx.fillText('谢', PAD + logoSize / 2, footTop + 2 + 30);
      ctx.textAlign = 'left';
    }

    // 竖分隔
    ctx.fillStyle = '#D9D4CA';
    ctx.fillRect(PAD + logoSize + 16, footTop + 10, 2, 26);

    const brandX = PAD + logoSize + 34;
    ctx.fillStyle = C.ink;
    ctx.font = '700 31px ' + FONT;
    ctx.fillText('文章海报', brandX, footTop + 32);

    ctx.fillStyle = C.grey;
    ctx.font = '24px ' + FONT;
    ctx.fillText('扫码识别前往查看更多内容', brandX, footTop + 74);

    // ---------- 二维码（网页端文章页） ----------
    qr.draw(ctx, target, W - PAD - QR_SIZE, footTop, QR_SIZE);

    // ---------- 导出 ----------
    return new Promise((resolve, reject) => {
      client.canvasToTempFilePath({
        canvas: canvas,
        fileType: 'jpg',
        quality: 0.92,
        success: res => resolve(res.tempFilePath),
        fail: err => reject(new Error((err && err.errMsg) || '海报导出失败'))
      });
    });
  });
}

/** 是否跑在开发者工具里（工具不支持真正写入相册，API 可能不回调） */
function isDevtools() {
  try {
    const info = client.getSystemInfoSync ? client.getSystemInfoSync() : null;
    return !!(info && info.platform === 'devtools');
  } catch (e) {
    return false;
  }
}

/**
 * 保存到相册
 * 1) 先把临时文件重命名成 xiehongwei-<slug>-<时间>.jpg（相册里看到的就是这个名）
 * 2) 再交给相册；无权限时引导去设置页
 * 3) 开发者工具里该 API 常不回调，超时兜底避免按钮被永久锁死
 * @returns Promise<{ path, name }>
 */
function save(filePath, post) {
  return renameForSave(filePath, post).then(path => {
    const name = String(path).split('/').pop();
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        if (isDevtools()) {
          client.showModal({
            title: '海报已生成',
            content: '文件名：' + name + '（开发者工具不支持写入相册，请用真机保存）',
            showCancel: false,
            confirmText: '知道了'
          });
          resolve({ path: path, name: name, devtools: true });
        } else {
          reject({ errMsg: '保存超时，请重试' });
        }
      }, 5000);

      client.saveImageToPhotosAlbum({
        filePath: path,
        success: res => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve({ path: path, name: name, res: res });
        },
        fail: err => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          const msg = (err && err.errMsg) || '';
          if (msg.indexOf('auth') > -1 || msg.indexOf('deny') > -1 || msg.indexOf('denied') > -1) {
            client.showModal({
              title: '需要相册权限',
              content: '请在设置中允许「添加到相册」后再保存',
              confirmText: '去设置',
              success: r => {
                if (r.confirm && client.openSetting) {
                  client.openSetting({});
                }
                reject(err);
              }
            });
          } else {
            reject(err);
          }
        }
      });
    });
  });
}

module.exports = { generate: generate, save: save, urlOf: urlOf };
