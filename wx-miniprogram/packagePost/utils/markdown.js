/**
 * Markdown 解析器 —— 输出「结构化块」而非单一 HTML 字符串
 *
 * 为什么要分块：<rich-text> 内的图片无法绑定点击事件，
 * 所以把图片、代码块、表格单独抽成块，交给 image / scroll-view 渲染，
 * 既能点击预览大图，也能让代码块横向滚动。
 *
 * 兼容 Typecho 编辑器实际产物：
 *   <!--markdown--> 前缀
 *   ![名称][1] + 下方 [1]: https://... 的引用式图片
 */
const { absUrl } = require('../../utils/format');

const ENTITY = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>',
  '&quot;': '"', '&#39;': "'", '&ldquo;': '“', '&rdquo;': '”',
  '&hellip;': '…', '&mdash;': '—', '&middot;': '·'
};

function unentity(s) {
  return String(s).replace(/&(?:[a-zA-Z]+|#\d+);/g, m => (ENTITY[m] !== undefined ? ENTITY[m] : m));
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 行内格式：`code` **粗** *斜* ~~删~~ [文字](链接) */
function inline(text, base) {
  const codes = [];
  let s = unentity(String(text || ''));

  // 行内代码先抽走，避免内部符号被当成格式
  s = s.replace(/`([^`]+)`/g, (m, c) => {
    codes.push('<code style="font-family:Menlo,Consolas,monospace;background:#F2EDE5;'
      + 'padding:2rpx 8rpx;border-radius:6rpx;color:#B54A34;font-size:0.92em">' + esc(c) + '</code>');
    return '\u0002' + (codes.length - 1) + '\u0002';
  });

  s = esc(s);

  // 行内图片（与文字混排的情形）
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (m, alt, u) => '<img src="' + absUrl(u, base) + '" alt="' + alt + '" style="max-width:100%"/>');

  // 链接
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (m, t, u) => '<a href="' + absUrl(u, base) + '" style="color:#B54A34">' + t + '</a>');

  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong style="font-weight:600">$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em style="font-style:italic">$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<s style="color:#9AA0A6">$1</s>');

  s = s.replace(/\u0002(\d+)\u0002/g, (m, n) => codes[parseInt(n, 10)] || '');
  return s;
}

function splitRow(line) {
  let s = line.trim();
  if (s.charAt(0) === '|') s = s.slice(1);
  if (s.charAt(s.length - 1) === '|') s = s.slice(0, -1);
  return s.split('|').map(c => c.trim());
}

function alignOf(cell) {
  const c = cell.trim();
  const left = c.charAt(0) === ':';
  const right = c.charAt(c.length - 1) === ':';
  if (left && right) return 'center';
  if (right) return 'right';
  return 'left';
}

/**
 * @param {string} md 原始 Markdown
 * @param {object} opts { base: 站点根地址 }
 * @returns {Array} blocks
 */
function parse(md, opts) {
  const base = (opts && opts.base) || '';
  let src = String(md || '').replace(/\r\n?/g, '\n');

  // 1) 去掉 HTML 注释（含 Typecho 的 <!--markdown-->）
  src = src.replace(/<!--[\s\S]*?-->/g, '');

  // 2) 抽出引用式链接定义 [1]: https://...，并从正文移除这些行
  const refs = {};
  src = src.replace(/^[ \t]{0,3}\[([^\]]+)\]:[ \t]*(\S+)(?:[ \t]+["'(][^\n]*)?$/gm, (m, key, url) => {
    refs[key.toLowerCase().trim()] = url;
    return '';
  });

  // 3) 引用式图片 / 链接 → 内联式
  src = src.replace(/!\[([^\]]*)\]\[([^\]]*)\]/g, (m, alt, key) => {
    const k = ((key || alt) || '').toLowerCase().trim();
    const url = refs[k];
    return url ? '![' + alt + '](' + url + ')' : '';
  });
  src = src.replace(/\[([^\]]+)\]\[([^\]]*)\]/g, (m, text, key) => {
    const k = ((key || text) || '').toLowerCase().trim();
    const url = refs[k];
    return url ? '[' + text + '](' + url + ')' : text;
  });

  // 4) 代码块先抽出占位，防止内部内容被当成正文
  const codes = [];
  src = src.replace(/```([a-zA-Z0-9_+#.-]*)[ \t]*\n([\s\S]*?)```/g, (m, lang, code) => {
    codes.push({ lang: lang || '', code: code.replace(/\n$/, '') });
    return '\n\u0000C' + (codes.length - 1) + '\u0000\n';
  });

  const lines = src.split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();

    // 空行
    if (!line) { i++; continue; }

    // 代码块占位
    const cm = line.match(/^\u0000C(\d+)\u0000$/);
    if (cm) {
      const c = codes[parseInt(cm[1], 10)];
      if (c) blocks.push({ type: 'code', lang: c.lang, code: c.code });
      i++;
      continue;
    }

    // 标题
    const hm = line.match(/^(#{1,6})\s+(.*)$/);
    if (hm) {
      blocks.push({ type: 'h', level: hm[1].length, html: inline(hm[2], base) });
      i++;
      continue;
    }

    // 分割线
    if (/^([-*_])\1{2,}$/.test(line.replace(/\s/g, ''))) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // 引用
    if (/^>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      blocks.push({
        type: 'quote',
        html: buf.filter(Boolean).map(l => inline(l, base)).join('<br/>')
      });
      continue;
    }

    // 列表（无序 / 有序）
    const liU = line.match(/^[-*+]\s+(.*)$/);
    const liO = line.match(/^(\d+)[.)、]\s+(.*)$/);
    if (liU || liO) {
      const ordered = !!liO;
      const items = [];
      while (i < lines.length) {
        const cur = lines[i].trim();
        const mu = cur.match(/^[-*+]\s+(.*)$/);
        const mo = cur.match(/^(\d+)[.)、]\s+(.*)$/);
        if (ordered && mo) {
          items.push({ html: inline(mo[2], base) });
        } else if (!ordered && mu) {
          let body = mu[1];
          // 任务列表 - [ ] / - [x]
          const tm = body.match(/^\[([ xX])\]\s+(.*)$/);
          if (tm) body = (tm[1].toLowerCase() === 'x' ? '☑ ' : '☐ ') + tm[2];
          items.push({ html: inline(body, base) });
        } else {
          break;
        }
        i++;
      }
      blocks.push({ type: 'list', ordered: ordered, items: items });
      continue;
    }

    // 表格：| 表头 | 下一行 |---|---|
    if (/^\|.*\|$/.test(line) && i + 1 < lines.length
      && /^\|[\s:|-]+\|$/.test(lines[i + 1].trim())) {
      const headCells = splitRow(line);
      const alignCells = splitRow(lines[i + 1].trim());
      const aligns = alignCells.map(alignOf);
      const head = headCells.map((c, idx) => ({ html: inline(c, base), align: aligns[idx] || 'left' }));
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
        const cells = splitRow(lines[i].trim());
        const row = [];
        for (let c = 0; c < headCells.length; c++) {
          row.push({ html: inline(cells[c] || '', base), align: aligns[c] || 'left' });
        }
        rows.push(row);
        i++;
      }
      blocks.push({ type: 'table', head: head, rows: rows });
      continue;
    }

    // 整行只有图片 → 独立图片块（可点击预览）
    if (/^(?:!\[[^\]]*\]\([^)]+\)\s*)+$/.test(line) || /^(?:<img[^>]+>\s*)+$/i.test(line)) {
      const imgRe = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
      let m;
      let matched = false;
      while ((m = imgRe.exec(line))) {
        blocks.push({ type: 'img', src: absUrl(m[2], base), alt: m[1] || '' });
        matched = true;
      }
      if (!matched) {
        const htmlRe = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
        while ((m = htmlRe.exec(line))) {
          blocks.push({ type: 'img', src: absUrl(m[1], base), alt: '' });
        }
      }
      i++;
      continue;
    }

    // 普通段落：一行为一段（散文写作习惯，配合首行缩进更自然）
    blocks.push({ type: 'p', html: inline(line, base) });
    i++;
  }

  return blocks;
}

/** 从块中提取纯文本，用于字数统计 */
function plainText(blocks) {
  const parts = [];
  const strip = h => String(h || '').replace(/<[^>]*>/g, '');

  (blocks || []).forEach(b => {
    if (b.type === 'p' || b.type === 'h' || b.type === 'quote') parts.push(strip(b.html));
    if (b.type === 'code') parts.push(b.code);
    if (b.type === 'list') b.items.forEach(it => parts.push(strip(it.html)));
    if (b.type === 'table') {
      b.head.forEach(c => parts.push(strip(c.html)));
      b.rows.forEach(r => r.forEach(c => parts.push(strip(c.html))));
    }
  });
  return parts.join(' ');
}

/** 收集文中所有图片地址 */
function images(blocks) {
  return (blocks || []).filter(b => b.type === 'img').map(b => b.src);
}

module.exports = { parse, plainText, images };
