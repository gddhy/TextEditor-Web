/* 生成 PWA 图标（纯 Node，无第三方依赖）
   用法: node tools/gen-icons.js
*/
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'icons');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

/* ---------------- PNG 编码 ---------------- */
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------------- 绘图工具 ---------------- */
function inRoundRect(px, py, x, y, w, h, r) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  const dx = px - cx, dy = py - cy;
  return dx * dx + dy * dy <= r * r + 1e-6;
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t)
  ];
}

/**
 * 绘制图标
 * @param size 输出尺寸
 * @param opts { maskable: bool, mono: bool }
 */
function drawIcon(size, opts = {}) {
  const SS = 3;                       // 超采样倍率
  const W = size * SS, H = size * SS;
  const acc = new Float32Array(size * size * 4);

  // 布局参数（相对 0..1）
  const inset = opts.maskable ? 0.19 : 0.0;   // maskable 安全区
  const bgX = inset * W, bgY = inset * H;
  const bgW = W - bgX * 2, bgH = H - bgY * 2;
  const bgR = opts.maskable ? bgW * 0.24 : bgW * 0.225;

  // 文档形状
  const docW = bgW * 0.50, docH = bgH * 0.62;
  const docX = bgX + (bgW - docW) / 2, docY = bgY + (bgH - docH) / 2;
  const docR = docW * 0.11;
  const fold = docW * 0.34;           // 折角大小

  // 颜色
  const C_BG_TOP = [0x7F, 0x67, 0xBE];
  const C_BG_BOT = [0x5B, 0x44, 0x96];
  const C_DOC = [0xFF, 0xFF, 0xFF];
  const C_FOLD = [0xD8, 0xCB, 0xF0];
  const C_LINE = [0x7A, 0x63, 0xB8];
  const C_ACCENT = [0xEF, 0xB8, 0xC8];

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let color = null, alpha = 0;

      // 背景圆角方块 + 垂直渐变
      if (inRoundRect(x + 0.5, y + 0.5, bgX, bgY, bgW, bgH, bgR)) {
        const t = (y - bgY) / bgH;
        color = mix(C_BG_TOP, C_BG_BOT, Math.max(0, Math.min(1, t)));
        alpha = 1;
      }

      if (alpha > 0) {
        const px = x + 0.5, py = y + 0.5;
        const inDoc = inRoundRect(px, py, docX, docY, docW, docH, docR);
        // 右上角折角区域（三角形）
        const relX = px - (docX + docW - fold);
        const relY = py - docY;
        const inFoldTri = inDoc && relX > 0 && relY < fold && (relX + (fold - relY) > fold);

        if (inDoc && !inFoldTri) {
          color = C_DOC;
        } else if (inFoldTri) {
          color = C_FOLD;
        }

        // 文本线条
        if (inDoc && !inFoldTri) {
          const lineH = docH * 0.055;
          const lineX = docX + docW * 0.17;
          const gap = docH * 0.135;
          const startY = docY + docH * 0.40;
          for (let i = 0; i < 4; i++) {
            const ly = startY + i * gap;
            const lw = (i === 3) ? docW * 0.40 : docW * 0.66;
            if (inRoundRect(px, py, lineX, ly, lw, lineH, lineH / 2)) {
              color = (i === 0) ? C_ACCENT : C_LINE;
            }
          }
        }
      }

      if (alpha > 0 && color) {
        const ox = Math.floor(x / SS), oy = Math.floor(y / SS);
        const idx = (oy * size + ox) * 4;
        acc[idx] += color[0];
        acc[idx + 1] += color[1];
        acc[idx + 2] += color[2];
        acc[idx + 3] += 255;
      }
    }
  }

  const n = SS * SS;
  const rgba = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const a = acc[i * 4 + 3] / n;
    if (a < 0.5) { rgba[i * 4 + 3] = 0; continue; }
    const cover = acc[i * 4 + 3] / (n * 255);
    rgba[i * 4] = Math.round(acc[i * 4] / (n * cover));
    rgba[i * 4 + 1] = Math.round(acc[i * 4 + 1] / (n * cover));
    rgba[i * 4 + 2] = Math.round(acc[i * 4 + 2] / (n * cover));
    rgba[i * 4 + 3] = Math.round(a);
  }
  return encodePNG(size, size, rgba);
}

/* ---------------- 输出 ---------------- */
const targets = [
  { file: 'icon-64.png', size: 64 },
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-256.png', size: 256 },
  { file: 'icon-512.png', size: 512 },
  { file: 'icon-maskable-192.png', size: 192, maskable: true },
  { file: 'icon-maskable-512.png', size: 512, maskable: true }
];

targets.forEach(t => {
  const buf = drawIcon(t.size, { maskable: t.maskable });
  fs.writeFileSync(path.join(OUT, t.file), buf);
  console.log('生成 ' + t.file + '  ' + t.size + 'x' + t.size + '  ' + (buf.length / 1024).toFixed(1) + ' KB');
});

/* favicon.svg */
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7F67BE"/>
      <stop offset="1" stop-color="#5B4496"/>
    </linearGradient>
  </defs>
  <rect width="96" height="96" rx="21.6" fill="url(#g)"/>
  <path d="M32 20h20l12 12v32a4 4 0 0 1-4 4H32a4 4 0 0 1-4-4V24a4 4 0 0 1 4-4z" fill="#fff"/>
  <path d="M52 20l12 12H56a4 4 0 0 1-4-4z" fill="#D8CBF0"/>
  <rect x="36" y="42" width="24" height="4" rx="2" fill="#EFB8C8"/>
  <rect x="36" y="50" width="24" height="4" rx="2" fill="#7A63B8"/>
  <rect x="36" y="58" width="24" height="4" rx="2" fill="#7A63B8"/>
  <rect x="36" y="66" width="15" height="4" rx="2" fill="#7A63B8"/>
</svg>
`;
fs.writeFileSync(path.join(OUT, 'favicon.svg'), svg, 'utf8');
console.log('生成 favicon.svg');
