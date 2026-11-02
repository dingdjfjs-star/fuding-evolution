/* 《福鼎城镇演化》逻辑矛盾自动校验器
 * 每轮推演后运行，检查用地守恒 / 水体完整性 / 立地约束 / 可达性 /
 * 围垦-生态冲突 / 人口承载力 / 叙事-数据一致性 / 道路与港口合理性
 * issues: [{ round, level: 'error'|'warn', rule, msg }]
 */
'use strict';
(function (root) {
  var T, D;
  if (typeof module !== 'undefined' && module.exports) {
    T = require('./terrain.js'); D = require('./data.js');
  } else {
    T = root.FDTerrain; D = root.FDData;
  }
  var W = T.W, H = T.H, N = T.N, AREA = T.AREA;
  var SEA = 0, MUD = 1, WATER = 2, MANGROVE = 3, FOREST = 4, TEA = 5, FARM = 6, VILLAGE = 7, URBAN = 8, PORT = 9, ROAD = 10, POND = 11, SOLAR = 12;

  function add(issues, round, level, rule, msg) {
    issues.push({ round: round, level: level, rule: rule, msg: msg });
  }

  // 单轮校验：records 为历史轮记录数组（含本轮），i 为本轮下标
  function validateRound(records, i) {
    var issues = [];
    var rec = records[i], prev = i > 0 ? records[i - 1] : null;
    var land = rec.land;
    var stats = rec.stats, prevStats = prev ? prev.stats : stats;

    // R1 用地守恒：格数守恒 + 枚举合法
    var sum = 0;
    for (var k = 0; k < stats.length; k++) sum += stats[k];
    if (sum !== N) add(issues, rec.round, 'error', '用地守恒', '用地格数合计 ' + sum + ' ≠ 格网总数 ' + N);
    for (var c = 0; c < N; c++) {
      if (land[c] < 0 || land[c] >= D.LAND.length) {
        add(issues, rec.round, 'error', '用地守恒', '存在非法用地枚举值 @' + c);
        break;
      }
    }

    // R2 水体完整性：建设/农茶用地不得侵占原始水体（河上桥=交通 例外）
    for (c = 0; c < N; c++) {
      var isOriginWater = T.dem[c] <= 0 || T.river[c];
      if (!isOriginWater) continue;
      var t = land[c];
      var bad = (t === URBAN || t === VILLAGE || t === FARM || t === TEA || t === POND || t === MANGROVE || t === FOREST || t === MUD);
      var bridgeOk = (t === ROAD && T.river[c] && T.dem[c] > 0); // 河桥例外
      var portOk = (t === PORT && T.dem[c] > 0);                 // 岸上港口
      if (bad && !bridgeOk && !portOk) {
        add(issues, rec.round, 'error', '水体完整',
          (D.LAND[t] ? D.LAND[t].name : '未知用地') + ' 侵占原始水体 @(' + (c % W) + ',' + ((c / W) | 0) + ')');
        if (issues.length > 12) break;
      }
    }

    // R3 茶园立地约束
    var teaBad = 0;
    for (c = 0; c < N; c++) {
      if (land[c] !== TEA) continue;
      var x = c % W, y = (c / W) | 0;
      var e = T.elevAt(x, y), s = T.slopeAt(x, y);
      if (e < 60 || e > 780 || s > 26) teaBad++;
    }
    if (teaBad) add(issues, rec.round, 'error', '茶园立地', teaBad + ' 格茶园位于不宜茶的高程/坡地（要求 60~780m、坡度≤26°）');

    // R4 城镇可达性：建成区须临路或临水（渡口）；孤悬村落给警告
    // 城镇聚落按 8 邻接连成一片（斜向巷弄相连），避免对角碎片误报
    var clusters = findClusters(land, [URBAN, VILLAGE], true);
    for (var ci = 0; ci < clusters.length; ci++) {
      var cl = clusters[ci];
      var hasRoad = false, hasWater = false, isUrban = false;
      var rad = 2; // 城镇/村落均允许 2 格内的道路或驳岸接驳
      for (var m = 0; m < cl.cells.length; m++) {
        var i0 = cl.cells[m], x0 = i0 % W, y0 = (i0 / W) | 0;
        if (land[i0] === URBAN) isUrban = true;
        for (var dy = -rad; dy <= rad && !(hasRoad && hasWater); dy++) for (var dx = -rad; dx <= rad; dx++) {
          var nx = x0 + dx, ny = y0 + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          var ni = ny * W + nx;
          if (land[ni] === ROAD) hasRoad = true;
          if (T.sea[ni] || T.bay[ni] || T.river[ni]) hasWater = true;
        }
        if (hasRoad && hasWater) break;
      }
      if (isUrban && !hasRoad && !hasWater) {
        add(issues, rec.round, 'error', '城镇可达', '建成区簇 @(' + cl.cells[0] % W + ',' + (cl.cells[0] / W | 0) + ') 无路无渡，孤悬不成逻辑');
      } else if (!isUrban && !hasRoad && !hasWater) {
        add(issues, rec.round, 'warn', '村落孤悬', '村落簇 @(' + cl.cells[0] % W + ',' + (cl.cells[0] / W | 0) + ') 无路无渡，困于山中');
      }
    }

    // R5 围垦-生态冲突（滩涂+湿地合并计——种红树林属良性转化）
    if (prev) {
      var ecoNow = stats[MUD] + stats[MANGROVE], ecoPrev = prevStats[MUD] + prevStats[MANGROVE];
      if (rec.policy && rec.policy.eco) {
        if (ecoNow < ecoPrev) add(issues, rec.round, 'error', '生态保护冲突', '生态保护期滩涂湿地净减少 ' + (ecoPrev - ecoNow) + ' 格');
        if (stats[POND] > prevStats[POND]) add(issues, rec.round, 'error', '生态保护冲突', '生态保护期新增养殖塘 ' + (stats[POND] - prevStats[POND]) + ' 格');
        if (stats[SOLAR] > prevStats[SOLAR]) add(issues, rec.round, 'error', '生态保护冲突', '生态保护期新增光伏 ' + (stats[SOLAR] - prevStats[SOLAR]) + ' 格');
      }
      if (stats[MUD] < stateInitMud(records) * 0.85) {
        add(issues, rec.round, 'warn', '滩涂生态红线', '滩涂仅存初值 ' + Math.round(stats[MUD] / stateInitMud(records) * 100) + '%，纳潮与候鸟栖息地告急');
      }
    }

    // R6 人口承载力（超载 15% 内视为紧张警告，超过则判逻辑矛盾）
    var cap = D.capacityOf(stats);
    if (rec.pop && rec.pop > cap * 1.15) {
      add(issues, rec.round, 'error', '人口承载力', '人口 ' + rec.pop + ' 超出土地承载力 ' + cap + '（超 ' + Math.round((rec.pop / cap - 1) * 100) + '%）');
    } else if (rec.pop && rec.pop > cap) {
      add(issues, rec.round, 'warn', '人口承载力', '人口 ' + rec.pop + ' 逼近承载力上限 ' + cap + '（超 ' + Math.round((rec.pop / cap - 1) * 100) + '%）');
    }

    // R7 叙事-数据一致性
    var narr = rec.narrative.join('');
    var mPop = narr.match(/人口约([\d.]+)万人/) || narr.match(/人口约(\d{3,})人/);
    if (mPop) {
      var narrPop = mPop[1].indexOf('.') >= 0 ? Math.round(parseFloat(mPop[1]) * 10000) : parseInt(mPop[1], 10);
      var realPop = rec.pop;
      // 叙事保留 1 位小数（万），容差须覆盖 0.05 万的舍入误差
      if (Math.abs(narrPop - realPop) > Math.max(600, realPop * 0.02)) {
        add(issues, rec.round, 'error', '叙事一致', '叙事人口 ' + narrPop + ' 与推演人口 ' + realPop + ' 不符');
      }
    }
    function checkKm2(re, cellsKey, label) {
      var mm = narr.match(re);
      if (mm) {
        var v = parseFloat(mm[1]);
        var real = +(stats[cellsKey] * AREA).toFixed(1);
        if (Math.abs(v - real) > 0.15) {
          add(issues, rec.round, 'error', '叙事一致', '叙事' + label + ' ' + v + 'km² 与推演 ' + real + 'km² 不符');
        }
      }
    }
    checkKm2(/城镇建成区约([\d.]+)平方公里/, URBAN, '城区面积');
    checkKm2(/茶园约([\d.]+)平方公里/, TEA, '茶园面积');
    checkKm2(/滩涂约([\d.]+)平方公里/, MUD, '滩涂面积');
    var mRoad = narr.match(/道路里程约([\d.]+)公里/);
    if (mRoad) {
      var rv = parseFloat(mRoad[1]);
      var realRoad = +(stats[ROAD] * 0.5).toFixed(1);
      if (Math.abs(rv - realRoad) > 0.15) add(issues, rec.round, 'error', '叙事一致', '叙事道路 ' + rv + 'km 与推演 ' + realRoad + 'km 不符');
    }

    // R8 道路合理性
    var roadOnWater = 0, orphan = 0;
    var roadCells = [];
    for (c = 0; c < N; c++) if (land[c] === ROAD) roadCells.push(c);
    for (var rc = 0; rc < roadCells.length; rc++) {
      var ic = roadCells[rc];
      if (T.dem[ic] <= 0) roadOnWater++;
    }
    if (roadOnWater) add(issues, rec.round, 'error', '道路合理', roadOnWater + ' 格道路落在海湾/深水上（本代无跨海工程）');
    // 连通性：每个路网片须触及聚落/港口
    var comps = findClusters(land, [ROAD], true);
    for (ci = 0; ci < comps.length; ci++) {
      var touch = false;
      for (m = 0; m < comps[ci].cells.length && !touch; m++) {
        var j0 = comps[ci].cells[m], xj = j0 % W, yj = (j0 / W) | 0;
        for (dy = -2; dy <= 2 && !touch; dy++) for (dx = -2; dx <= 2; dx++) {
          nx = xj + dx; ny = yj + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          var tj = land[ny * W + nx];
          if (tj === URBAN || tj === VILLAGE || tj === PORT) { touch = true; break; }
        }
      }
      if (!touch) orphan++;
    }
    if (orphan) add(issues, rec.round, 'error', '道路合理', orphan + ' 段路网未连接任何聚落/港口');

    // R8b 光伏选址：须在滨海低地（高程 ≤20m 且临水 ≤3 格），且不得压湿地
    var solarBad = 0;
    for (c = 0; c < N; c++) {
      if (land[c] !== SOLAR) continue;
      var xs = c % W, ys = (c / W) | 0;
      if (T.elevAt(xs, ys) > 20) { solarBad++; continue; }
      var nearW = false;
      for (var dys = -3; dys <= 3 && !nearW; dys++) for (var dxs = -3; dxs <= 3; dxs++) {
        var nxs = xs + dxs, nys = ys + dys;
        if (nxs < 0 || nys < 0 || nxs >= W || nys >= H) continue;
        if (!T.territory[nys * W + nxs]) { nearW = true; break; }
      }
      if (!nearW) solarBad++;
    }
    if (solarBad) add(issues, rec.round, 'error', '光伏选址', solarBad + ' 格光伏不在滨海低地（高程≤20m 且临水≤3 格）');

    // R9 港口选址
    var portBad = 0;
    for (c = 0; c < N; c++) {
      if (land[c] !== PORT) continue;
      var x9 = c % W, y9 = (c / W) | 0, deep = false;
      var nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var kb = 0; kb < 4; kb++) {
        var qx = x9 + nb[kb][0], qy = y9 + nb[kb][1];
        if (qx >= 0 && qy >= 0 && qx < W && qy < H) {
          var q = qy * W + qx;
          if (T.sea[q] && T.dem[q] <= -4) { deep = true; break; }
        }
      }
      if (!deep) portBad++;
    }
    if (portBad) add(issues, rec.round, 'error', '港口选址', portBad + ' 格码头不在深水岸（邻水水深须≤-4m）');

    // R10 海域守恒：开敞海域不可被任何用地转化
    if (prev) {
      var seaLost = 0;
      for (c = 0; c < N; c++) if (T.dem[c] < -1.5 && !T.river[c] && prev.land[c] === SEA && land[c] !== SEA) seaLost++;
      if (seaLost) add(issues, rec.round, 'error', '海域守恒', seaLost + ' 格开敞海域被侵占');
    }
    return issues;
  }

  function stateInitMud(records) { return records[0].stats[MUD]; }
  function isUrbanCl(land, cl) {
    for (var m = 0; m < cl.cells.length; m++) if (land[cl.cells[m]] === URBAN) return true;
    return false;
  }
  // 连通簇，cls: 用地类型数组；diag=true 用 8 邻接（道路网含斜向施工）
  function findClusters(land, types, diag) {
    var inType = new Uint8Array(N);
    for (var i = 0; i < N; i++) {
      for (var k = 0; k < types.length; k++) if (land[i] === types[k]) { inType[i] = 1; break; }
    }
    var seen = new Uint8Array(N), out = [];
    var stack = [];
    var nbs = diag
      ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
      : [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (i = 0; i < N; i++) {
      if (!inType[i] || seen[i]) continue;
      stack.length = 0; stack.push(i); seen[i] = 1;
      var cells = [];
      while (stack.length) {
        var cur = stack.pop(); cells.push(cur);
        var x = cur % W, y = (cur / W) | 0;
        for (var d = 0; d < nbs.length; d++) {
          var nx = x + nbs[d][0], ny = y + nbs[d][1];
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          var ni = ny * W + nx;
          if (inType[ni] && !seen[ni]) { seen[ni] = 1; stack.push(ni); }
        }
      }
      out.push({ cells: cells });
    }
    return out;
  }

  function validateAll(records) {
    var all = [];
    for (var i = 0; i < records.length; i++) {
      var iss = validateRound(records, i);
      all = all.concat(iss);
    }
    return all;
  }

  var api = { validateRound: validateRound, validateAll: validateAll, findClusters: findClusters };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FDValidate = api;
})(typeof self !== 'undefined' ? self : this);
