// 探测 Nominatim / Overpass 连通性
const https = require('https');
function get(u, hdr) {
  return new Promise((res, rej) => {
    const r = https.get(u, { headers: hdr || {}, timeout: 15000 }, x => {
      let b = '';
      x.on('data', d => b += d);
      x.on('end', () => res({ code: x.statusCode, body: b.slice(0, 300) }));
    });
    r.on('timeout', () => { r.destroy(); rej(new Error('timeout')); });
    r.on('error', e => rej(e));
  });
}
(async () => {
  try { const r = await get('https://nominatim.openstreetmap.org/search?q=' + encodeURIComponent('福鼎市点头镇') + '&format=json&limit=1', { 'User-Agent': 'fuding-sandbox/1.0' }); console.log('nominatim:', r.code, r.body); }
  catch (e) { console.log('nominatim FAIL:', e.message); }
  try { const r = await get('https://overpass-api.de/api/status'); console.log('overpass:', r.code, r.body.replace(/\n/g, ' ').slice(0, 150)); }
  catch (e) { console.log('overpass FAIL:', e.message); }
})();
