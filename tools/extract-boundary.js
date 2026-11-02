/* 从用户提供的福鼎市域轮廓图提取边界：
 * PNG 解码 → 找青色图框 → 红色轮廓掩膜 → 洪泛标记域外 → 降采样到 72×48
 * 产出 js/boundary.js（掩膜 + 海湾轴线提示 + 岛屿中心）并在控制台打印 ASCII 预览
 * 用法：node tools\extract-boundary.js <图片路径>
 */
'use strict';
const fs = require('fs');
const zlib = require('zlib');

// ---------- 最小 PNG 解码（8bit RGB/RGBA，非隔行） ----------
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504E47) throw new Error('不是 PNG');
  let pos = 8, w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
      if (bitDepth !== 8) throw new Error('仅支持 8bit（当前 ' + bitDepth + '）');
      if (data[12] !== 0) throw new Error('不支持隔行 PNG');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : -1;
  if (channels < 0) throw new Error('不支持 colorType ' + colorType);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const out = Buffer.alloc(w * h * channels);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const row = raw.slice(p, p + stride); p += stride;
    const prev = y ? out.slice((y - 1) * stride, y * stride) : null;
    const cur = out.slice(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = (x >= channels && prev) ? prev[x - channels] : 0;
      let v = row[x];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      cur[x] = v;
    }
  }
  return { w, h, channels, data: out };
}

// ---------- 主流程 ----------
const imgPath = process.argv[2];
if (!imgPath) { console.error('用法: node tools\\extract-boundary.js <轮廓图.png>'); process.exit(1); }
const img = decodePNG(fs.readFileSync(imgPath));
const { w: W, h: H, channels: C, data: px } = img;
const at = (x, y) => { const o = (y * W + x) * C; return [px[o], px[o + 1], px[o + 2]]; };
console.log(`图像 ${W}x${H} ch=${C}`);

const isRed = (r, g, b) => r > 140 && r - g > 55 && r - b > 55;
const isCyan = (r, g, b) => g > 130 && b > 130 && r < 130 && Math.abs(g - b) < 90;

// 图框（青色矩形）
let bx0 = W, bx1 = 0, by0 = H, by1 = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const [r, g, b] = at(x, y);
  if (isCyan(r, g, b)) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
}
if (bx1 <= bx0) { bx0 = 0; bx1 = W - 1; by0 = 0; by1 = H - 1; console.log('未找到青框，退化为全图'); }
console.log(`图框: x ${bx0}~${bx1}, y ${by0}~${by1}`);
const BW = bx1 - bx0 + 1, BH = by1 - by0 + 1;

// 域外洪泛（从框角出发，红色为屏障；红线先膨胀 2px 堵抗锯齿缝隙）
const redRaw = new Uint8Array(W * H);
for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
  const [r, g, b] = at(x, y);
  if (r > 120 && r - g > 30 && r - b > 30) redRaw[y * W + x] = 1;
}
const redBar = new Uint8Array(W * H);
for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
  if (!redRaw[y * W + x]) continue;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const nx = x + dx, ny = y + dy;
    if (nx < bx0 || ny < by0 || nx > bx1 || ny > by1) continue;
    redBar[ny * W + nx] = 1;
  }
}
// 多种子洪泛：图框周长上所有非屏障像素都是"域外"起点（轮廓可能与图框相切）
const outside = new Uint8Array(W * H);
const stack = [];
for (let x = bx0; x <= bx1; x++) {
  if (!redBar[by0 * W + x]) { outside[by0 * W + x] = 1; stack.push(by0 * W + x); }
  if (!redBar[by1 * W + x]) { outside[by1 * W + x] = 1; stack.push(by1 * W + x); }
}
for (let y = by0; y <= by1; y++) {
  if (!redBar[y * W + bx0]) { outside[y * W + bx0] = 1; stack.push(y * W + bx0); }
  if (!redBar[y * W + bx1]) { outside[y * W + bx1] = 1; stack.push(y * W + bx1); }
}
while (stack.length) {
  const cur = stack.pop();
  const cx = cur % W, cy = (cur / W) | 0;
  const nbs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dx, dy] of nbs) {
    const nx = cx + dx, ny = cy + dy;
    if (nx < bx0 || ny < by0 || nx > bx1 || ny > by1) continue;
    const j = ny * W + nx;
    if (outside[j] || redBar[j]) continue;
    outside[j] = 1; stack.push(j);
  }
}

// 降采样到 72×72（方格网，匹配方形图框比例）
const GW = 72, GH = 72;
const mask = new Uint8Array(GW * GH);
for (let gy = 0; gy < GH; gy++) {
  for (let gx = 0; gx < GW; gx++) {
    const px0 = bx0 + Math.floor(BW * gx / GW), px1 = bx0 + Math.floor(BW * (gx + 1) / GW);
    const py0 = by0 + Math.floor(BH * gy / GH), py1 = by0 + Math.floor(BH * (gy + 1) / GH);
    let out = 0, tot = 0;
    for (let y = py0; y < Math.max(py0 + 1, py1); y++) for (let x = px0; x < Math.max(px0 + 1, px1); x++) {
      const isOut = outside[y * W + x] && !redRaw[y * W + x];
      if (isOut) out++;
      tot++;
    }
    mask[gy * GW + gx] = out / Math.max(1, tot) < 0.38 ? 1 : 0; // 湾道窄，水面阈值放宽
  }
}
// 只翻转真孤点（保留 1~2 格宽的湾道）
const sm = new Uint8Array(mask);
for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
  const i = gy * GW + gx;
  let n = 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = gx + dx, ny = gy + dy;
    if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
    if (mask[ny * GW + nx] === mask[i]) n++;
  }
  if (n === 0) sm[i] = mask[i] ? 0 : 1;
}
// 沙埕湾楔形补刻：洪泛进不去的窄湾按图像目测坐标强制开为水面
// 顶点 (36,21)，向东张开的楔：上岸 y=21-4.6t，下岸 y=21+5.6t，t=(x-36)/35
let wedge = 0;
for (let gx = 36; gx <= 71; gx++) {
  const t = (gx - 36) / 35;
  const top = Math.round(21 - 4.6 * t), bot = Math.round(21 + 5.6 * t);
  for (let gy = Math.max(0, top); gy <= Math.min(GH - 1, bot); gy++) {
    if (sm[gy * GW + gx] === 1) { sm[gy * GW + gx] = 0; wedge++; }
  }
}
console.log('湾楔补刻水面格:', wedge);

// 连通域：主陆 + 岛屿
const seen = new Uint8Array(GW * GH);
const comps = [];
for (let i = 0; i < GW * GH; i++) {
  if (!sm[i] || seen[i]) continue;
  const cells = [];
  const st = [i]; seen[i] = 1;
  while (st.length) {
    const cur = st.pop(); cells.push(cur);
    const cx = cur % GW, cy = (cur / GW) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const j = ny * GW + nx;
      if (sm[j] && !seen[j]) { seen[j] = 1; st.push(j); }
    }
  }
  comps.push(cells.sort((a, b) => a - b));
}
comps.sort((a, b) => b.length - a.length);
const mainland = comps[0] || [];
const island = comps[1] && comps[1].length >= 2 ? comps[1] : null;
const landCells = mainland.length + (island ? island.length : 0);
console.log(`陆域格: ${landCells} / ${GW * GH}（主陆 ${mainland.length}${island ? ' + 岛 ' + island.length : ''}）`);
const cx0 = island ? island.reduce((s, i) => s + i % GW, 0) / island.length : 0;
const cy0 = island ? island.reduce((s, i) => s + ((i / GW) | 0), 0) / island.length : 0;

// ASCII 预览
const inMain = new Set(mainland), inIsle = new Set(island || []);
let art = '';
for (let gy = 0; gy < GH; gy++) {
  let row = '';
  for (let gx = 0; gx < GW; gx++) {
    const i = gy * GW + gx;
    row += inMain.has(i) ? '#' : inIsle.has(i) ? 'o' : '.';
  }
  art += String(gy).padStart(2) + ' ' + row + '\n';
}
console.log(art);

// 输出 js/boundary.js
const maskStr = Array.from(sm).join('');
const js = `/* 由 tools/extract-boundary.js 从用户提供的福鼎市域轮廓图提取
 * 掩膜：1=陆域 0=海域/域外；格网 72×48，x 向东 y 向南
 * 主陆 ${mainland.length} 格${island ? '，岛屿（嵛山岛）中心 (' + cx0.toFixed(1) + ',' + cy0.toFixed(1) + ')' : '，未检出岛屿'}
 */
'use strict';
(function (root) {
  var api = {
    GW: ${GW}, GH: ${GH},
    maskStr: '${maskStr}',
    islandCenter: ${island ? '[' + cx0.toFixed(1) + ',' + cy0.toFixed(1) + ']' : 'null'}
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FDBoundary = api;
})(typeof self !== 'undefined' ? self : this);
`;
fs.writeFileSync(__dirname + '/../js/boundary.js', js);
console.log('已写出 js/boundary.js');
