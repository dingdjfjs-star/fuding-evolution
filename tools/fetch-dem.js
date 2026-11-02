/* 从 opentopodata.org 抓取福鼎真实高程（srtm30m 数据集）
 * 地理配准：轮廓图框即福鼎市域 bbox（119.917–120.717°E, 26.867–27.433°N，见 README）
 * 细采样 144×144 → 2×2 均值聚合成 72×72；带断点缓存
 * 用法：node tools\fetch-dem.js
 */
'use strict';
const fs = require('fs');
const https = require('https');

const GW = 72, GH = 72;
const CACHE_PATH = __dirname + '/_dem_cache.json';
const cache = fs.existsSync(CACHE_PATH) ? JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')) : {};
let cacheDirty = 0;

// 市域 bbox（福鼎市：东经 119°55′—120°43′，北纬 26°52′—27°26′）
const LON0 = 119.917, DLON = (120.717 - 119.917) / GW; // 0.011111 °/格
const LAT0 = 27.433, DLAT = (27.433 - 26.867) / GH;    // 0.007861 °/格

// ---------- 请求器：opentopodata，100 点/次，≥1.1s/次，退避重试 ----------
function getOnce(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        if (res.statusCode !== 200) { const e = new Error('HTTP ' + res.statusCode + ' ' + buf.slice(0, 120)); e.code = res.statusCode; reject(e); return; }
        try { resolve(JSON.parse(buf)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}
async function fetchPairs(pairs) {
  const out = new Array(pairs.length);
  const need = [];
  for (let i = 0; i < pairs.length; i++) {
    const key = pairs[i][1].toFixed(5) + ',' + pairs[i][0].toFixed(5);
    if (cache[key] !== undefined) out[i] = cache[key];
    else need.push(i);
  }
  console.log(`  需新采 ${need.length} 点（缓存命中 ${pairs.length - need.length}）`);
  const BATCH = 100;
  for (let i = 0; i < need.length; i += BATCH) {
    const idxs = need.slice(i, i + BATCH);
    const locs = idxs.map(k => pairs[k][1].toFixed(5) + ',' + pairs[k][0].toFixed(5)).join('|');
    const url = 'https://api.opentopodata.org/v1/srtm30m?locations=' + locs + '&interpolation=cubic';
    let r = null;
    for (let attempt = 0; attempt <= 6; attempt++) {
      try { r = await getOnce(url); break; }
      catch (e) {
        if (attempt === 6) throw e;
        const wait = e.code === 429 ? 5000 : 3000;
        process.stdout.write(`\n  [退避 ${wait / 1000}s: ${e.code || e.message}]`);
        await new Promise(res => setTimeout(res, wait));
      }
    }
    if (!r.results || r.results.length !== idxs.length) throw new Error('响应不完整 @' + i);
    for (let k = 0; k < idxs.length; k++) {
      const v = r.results[k].elevation;
      if (v === null) throw new Error('高程为 null @' + idxs[k]);
      out[idxs[k]] = v;
      cache[pairs[idxs[k]][1].toFixed(5) + ',' + pairs[idxs[k]][0].toFixed(5)] = v; cacheDirty++;
    }
    if (cacheDirty >= 500) { fs.writeFileSync(CACHE_PATH, JSON.stringify(cache)); cacheDirty = 0; }
    process.stdout.write(`\r  采样 ${Math.min(i + BATCH, need.length)}/${need.length}`);
    await new Promise(res => setTimeout(res, 1100));
  }
  process.stdout.write('\n');
  return out;
}

(async () => {
  console.log('细采样 144×144（bbox 全幅配准）…');
  const SG = 144;
  const sLon = [], sLat = [];
  for (let gy = 0; gy < SG; gy++) for (let gx = 0; gx < SG; gx++) {
    sLon.push(LON0 + (gx + 0.5) * (GW / SG) * DLON);
    sLat.push(LAT0 - (gy + 0.5) * (GH / SG) * DLAT);
  }
  const sElev = await fetchPairs(sLon.map((v, i) => [v, sLat[i]]));

  const dem = new Array(GW * GH);
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    let sum = 0;
    for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) sum += sElev[(gy * 2 + sy) * SG + (gx * 2 + sx)];
    dem[gy * GW + gx] = Math.max(0, Math.round(sum / 4));
  }

  // 校验报告：市域内真实海陆分布
  let seaN = 0, peak = 0, px = 0, py = 0, southPeak = 0;
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const e = dem[y * GW + x];
    if (e <= 0.5) seaN++;
    if (e > peak) { peak = e; px = x; py = y; }
    if (y > GH / 2) southPeak = Math.max(southPeak, e);
  }
  console.log(`bbox 内真实海面格: ${seaN} | 全域最高 ${peak}m @ (${px},${py})（应为太姥山一带）| 南半部最高 ${southPeak}m（应为嵛山/太姥山余脉）`);

  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache));
  const js = `/* 福鼎真实高程栅格（SRTM 30m，经 opentopodata.org 采样）
 * 由 tools/fetch-dem.js 于 ${new Date().toISOString().slice(0, 10)} 抓取，144×144 细采样聚合为 72×72
 * 地理配准（bbox 全幅）：lon = ${LON0.toFixed(4)} + x*${DLON.toFixed(6)}；lat = ${LAT0.toFixed(4)} - y*${DLAT.toFixed(6)}
 * 单位米，海面为 0
 */
'use strict';
(function (root) {
  var s = '${dem.join(',')}';
  var api = {
    W: ${GW}, H: ${GH},
    LON0: ${LON0.toFixed(6)}, DLON: ${DLON.toFixed(8)},
    LAT0: ${LAT0.toFixed(6)}, DLAT: ${DLAT.toFixed(8)},
    dem: s.split(',').map(Number)
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FDRealDEM = api;
})(typeof self !== 'undefined' ? self : this);
`;
  fs.writeFileSync(__dirname + '/../js/realdem.js', js);
  console.log('已写出 js/realdem.js');
})().catch(e => { console.error('\n失败:', e.message); fs.writeFileSync(CACHE_PATH, JSON.stringify(cache)); process.exit(1); });
