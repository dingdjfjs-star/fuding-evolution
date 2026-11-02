const T = require('../js/terrain.js');
for (const r of T.rivers) {
  const p = r.pts[r.pts.length - 1];
  const mx = Math.round(p[0]), my = Math.round(p[1]);
  let sea = 0, riv = 0, terr = 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const nx = mx + dx, ny = my + dy;
    if (nx < 0 || ny < 0 || nx >= T.W || ny >= T.H) continue;
    const j = T.idx(nx, ny);
    if (T.sea[j]) sea++;
    else if (T.river[j]) riv++;
    else terr++;
  }
  console.log(r.name.padEnd(6), 'mouth=(' + mx + ',' + my + ') 2格内: 海' + sea, '河' + riv, '陆' + terr);
}
