/* 从 OpenStreetMap Overpass API 抓取福鼎真实河网（waterway=river/stream）
 * bbox 与 realdem.js 同一地理配准；产出的格网折线写入 js/realrivers.js
 * 地形合成时：轮廓形状优先——河口若未接上手绘水面，自动向最近水面延伸
 * 带断点缓存；失败时 terrain.js 自动退回手绘水系
 * 用法：node tools\fetch-rivers.js
 */
'use strict';
const fs = require('fs');
const https = require('https');

const GW = 72, GH = 72;
const LON0 = 119.917, DLON = (120.717 - 119.917) / GW;
const LAT0 = 27.433, DLAT = (27.433 - 26.867) / GH;
const CACHE_PATH = __dirname + '/_rivers_cache.json';
const cache = fs.existsSync(CACHE_PATH) ? JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')) : null;
const ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter'
];
const QUERY = '[out:json][timeout:90];(way["waterway"~"^(river|stream)$"](26.867,119.917,27.433,120.717););out geom;';

function postOnce(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST', timeout: 90000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), 'User-Agent': 'fuding-sandbox/1.0' }
    }, res => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => {
        if (res.statusCode !== 200) { const e = new Error('HTTP ' + res.statusCode + ' ' + b.slice(0, 100)); e.code = res.statusCode; reject(e); return; }
        try { resolve(JSON.parse(b)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
async function fetchQuery() {
  const body = 'data=' + encodeURIComponent(QUERY);
  for (let round = 0; round < 4; round++) {
    for (const ep of ENDPOINTS) {
      try {
        console.log('尝试', ep.split('/')[2], '…');
        const r = await postOnce(ep, body);
        return r;
      } catch (e) {
        console.log('  失败:', e.code || e.message);
        await new Promise(res => setTimeout(res, 4000));
      }
    }
  }
  throw new Error('Overpass 全部端点不可用');
}

(async () => {
  let data;
  if (cache && cache.elements) {
    console.log('使用缓存河网数据');
    data = cache;
  } else {
    console.log('[1/2] 抓取 OSM 河网…');
    data = await fetchQuery();
    fs.writeFileSync(CACHE_PATH, JSON.stringify(data));
  }
  const ways = (data.elements || []).filter(e => e.type === 'way' && e.geometry && e.geometry.length > 3);
  console.log('OSM 河流 way 数:', ways.length);

  // 转格网坐标 + 过滤/择优（市域内占比 ≥30%，有名优先）
  const B = require('../js/boundary.js');
  function insideFrac(pts) {
    let inn = 0, tot = 0;
    for (const [px, py] of pts) {
      const gx = Math.round(px), gy = Math.round(py);
      if (gx < 0 || gy < 0 || gx >= GW || gy >= GH) continue;
      tot++;
      if (B.maskStr.charAt(gy * GW + gx) === '1') inn++;
    }
    return tot ? inn / tot : 0;
  }
  const rivers = [];
  const byName = {};
  for (const w of ways) {
    const name = (w.tags && w.tags.name) || '';
    const pts = w.geometry.map(g => [
      +( (g.lon - LON0) / DLON ).toFixed(2),
      +( (LAT0 - g.lat) / DLAT ).toFixed(2)
    ]).filter(p => p[0] >= -2 && p[0] <= GW + 2 && p[1] >= -2 && p[1] <= GH + 2);
    if (pts.length < 6) continue;
    const simp = pts.filter((_, i) => i % Math.max(1, Math.ceil(pts.length / 36)) === 0 || i === pts.length - 1);
    if (insideFrac(simp) < 0.3) continue; // 邻县河流剔除
    const river = { name: name || '未名溪', pts: simp, len: simp.length, named: !!name };
    if (name) {
      if (!byName[name] || byName[name].len < river.len) {
        if (byName[name]) rivers.splice(rivers.indexOf(byName[name]), 1);
        byName[name] = river; rivers.push(river);
      }
    } else rivers.push(river);
  }
  const named = rivers.filter(r => r.named).sort((a, b) => b.len - a.len);
  const unnamed = rivers.filter(r => !r.named).sort((a, b) => b.len - a.len);
  const keep = named.slice(0, 8).concat(unnamed.slice(0, Math.max(0, 9 - Math.min(8, named.length))));
  console.log('保留河流:', keep.map(r => r.name + '(' + r.len + '点)').join('、'));

  fs.writeFileSync(__dirname + '/../js/realrivers.js',
    `/* 福鼎真实河网折线（OpenStreetMap waterway，经 Overpass API 抓取）
 * 由 tools/fetch-rivers.js 生成；格网坐标与 boundary/realdem 同一 bbox 配准
 * 地形合成时河口自动向手绘水面延伸（轮廓形状优先）
 */
'use strict';
(function (root) {
  var api = { rivers: ${JSON.stringify(keep)} };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FDRealRivers = api;
})(typeof self !== 'undefined' ? self : this);
`);
  console.log('已写出 js/realrivers.js');
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
