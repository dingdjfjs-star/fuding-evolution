/* 《福鼎城镇演化》推演引擎：状态机 + 用地转换 + 叙事生成
 * 纯逻辑、无 DOM、种子确定性；Node 与浏览器共用
 * 依赖 terrain.js / data.js / validate.js
 */
'use strict';
(function (root) {
  var T, D, V;
  if (typeof module !== 'undefined' && module.exports) {
    T = require('./terrain.js'); D = require('./data.js'); V = require('./validate.js');
  } else {
    T = root.FDTerrain; D = root.FDData; V = root.FDValidate;
  }
  var W = T.W, H = T.H, N = T.N, AREA = T.AREA;
  var SEA = 0, MUD = 1, WATER = 2, MANGROVE = 3, FOREST = 4, TEA = 5, FARM = 6, VILLAGE = 7, URBAN = 8, PORT = 9, ROAD = 10, POND = 11, SOLAR = 12;

  // ---------- 预计算 ----------
  var TEA_TOWN_IDX = { bailin: 1, diantou: 1, panxi: 1, guanyang: 1 }; // 茶乡
  var PRIORITY = { tongshan: 10, shacheng: 9, diantou: 7, bailin: 6.5, qianqi: 6, qinyu: 6, dianxia: 5.5, panxi: 4.5, guanyang: 3.5, yushan: 2.5, longan: 6 };
  var COAST_TOWN = { shacheng: 1, qinyu: 1, yushan: 1, tongshan: 1, diantou: 1, qianqi: 1, longan: 1 }; // 可走水路的镇
  // 各轮参数（索引 = 轮次 1..6）
  var ROAD_SLOTS = [0, 2, 2, 3, 4, 99, 99];
  var ROAD_COST_LIMIT = [0, 50, 70, 90, 115, 140, 160];
  var TEA_RADIUS = [0, 4, 6, 7, 9, 12, 14];
  var RECLAIM_BUDGET = [0, 0, 0, 0, 22, 30, 16];
  var UPGRADE_K = [0, 0, 1, 1, 2, 2, 2];

  function townCell(tw) { return tw.y * W + tw.x; }
  function inGrid(x, y) { return x >= 0 && y >= 0 && x < W && y < H; }
  // 镇是否已登场（龙安开发区 fromRound=5，此前不存在）
  function isActiveTown(tw, round) { return !tw.fromRound || round >= tw.fromRound; }
  function activeTownFilter(round) {
    var f = {};
    T.towns.forEach(function (tw) { if (isActiveTown(tw, round)) f[tw.id] = 1; });
    return f;
  }

  // ---------- 二叉小顶堆（Dijkstra 用） ----------
  function Heap() { this.a = []; this.p = []; }
  Heap.prototype.push = function (v, pri) {
    var a = this.a, p = this.p, i = a.length;
    a.push(v); p.push(pri);
    while (i > 0) { var par = (i - 1) >> 1; if (p[par] <= p[i]) break; var ta = a[i]; a[i] = a[par]; a[par] = ta; var tp = p[i]; p[i] = p[par]; p[par] = tp; i = par; }
  };
  Heap.prototype.pop = function () {
    var a = this.a, p = this.p, top = a[0], last = a.length - 1;
    a[0] = a[last]; p[0] = p[last]; a.pop(); p.pop();
    var i = 0, n = a.length;
    for (;;) {
      var l = 2 * i + 1, r = l + 1, m = i;
      if (l < n && p[l] < p[m]) m = l;
      if (r < n && p[r] < p[m]) m = r;
      if (m === i) break;
      var ta = a[i]; a[i] = a[m]; a[m] = ta; var tp = p[i]; p[i] = p[m]; p[m] = tp; i = m;
    }
    return top;
  };
  Object.defineProperty(Heap.prototype, 'size', { get: function () { return this.a.length; } });

  // ---------- 初始用地 ----------
  function initLand(rng) {
    var land = new Uint8Array(N);
    for (var i = 0; i < N; i++) {
      var x = i % W, y = (i / W) | 0;
      if (T.dem[i] <= 0) { land[i] = SEA; continue; }        // 海域/港湾
      if (T.river[i]) { land[i] = WATER; continue; }         // 河流
      land[i] = FOREST;                                       // 其余林地
    }
    // 滩涂：临湾/临海、高程低的潮间带（含河口滩）
    var mudCells = [];
    for (i = 0; i < N; i++) {
      if (land[i] !== FOREST) continue;
      if (T.coast[i] && T.dem[i] <= 6.8) { land[i] = MUD; mudCells.push(i); }
    }
    // 红树林：湾内 (t>0.45) 的低滩涂天然生长一片
    for (var m = 0; m < mudCells.length; m++) {
      var mi = mudCells[m];
      var mx = mi % W, my = (mi / W) | 0;
      if (bayT(mx, my) > 0.45 && rng() < 0.5) land[mi] = MANGROVE;
    }
    // 农田：镇周低平地（只认已登场的镇）
    var farmBudget = 140;
    var cand = [];
    var initActive = activeTownFilter(0);
    for (i = 0; i < N; i++) {
      if (land[i] !== FOREST) continue;
      var x2 = i % W, y2 = (i / W) | 0;
      if (T.dem[i] > 260 || T.slope[i] > 10) continue;
      var d = distTown(x2, y2, initActive);
      if (d <= 5) cand.push([i, d + rng() * 1.5]);
    }
    cand.sort(function (a, b) { return a[1] - b[1]; });
    for (var f = 0; f < Math.min(farmBudget, cand.length); f++) land[cand[f][0]] = FARM;
    // 镇落：镇心 3×2 或十字格（未登场的镇不落）
    for (var tn = 0; tn < T.towns.length; tn++) {
      var tw = T.towns[tn];
      if (!isActiveTown(tw, 0)) continue;
      var ci = townCell(tw);
      land[ci] = VILLAGE;
      var nbs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]];
      for (var nb = 0; nb < nbs.length; nb++) {
        var nx = tw.x + nbs[nb][0], ny = tw.y + nbs[nb][1];
        if (inGrid(nx, ny)) {
          var ni = ny * W + nx;
          if (land[ni] !== SEA && land[ni] !== WATER && land[ni] !== MANGROVE) land[ni] = VILLAGE;
        }
      }
    }
    return land;
  }
  // 湾道参数 t（0=口 1=顶）—— 委托地形模块的楔形公式
  function bayT(x, y) { return T.bayT(x, y); }
  function distTown(x, y, townFilter) {
    var best = 1e9;
    for (var i = 0; i < T.towns.length; i++) {
      var tw = T.towns[i];
      if (townFilter && !townFilter[tw.id]) continue;
      var d = Math.hypot(x - tw.x, y - tw.y);
      if (d < best) best = d;
    }
    return best;
  }

  // ---------- 建路 ----------
  function buildRoads(land, state, maxPaths, costLimit, round) {
    var hub = T.towns[0]; // 桐山
    var dist = new Float64Array(N).fill(Infinity);
    var prev = new Int32Array(N).fill(-1);
    var done = new Uint8Array(N);
    var heap = new Heap();
    var hubIdx = townCell(hub);
    dist[hubIdx] = 0; heap.push(hubIdx, 0);
    var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    while (heap.size) {
      var cur = heap.pop();
      if (done[cur]) continue;   // 跳过堆中过期条目
      done[cur] = 1;
      var cx = cur % W, cy = (cur / W) | 0;
      for (var d = 0; d < 8; d++) {
        var nx = cx + DIRS[d][0], ny = cy + DIRS[d][1];
        if (!inGrid(nx, ny)) continue;
        var ni = ny * W + nx;
        var c = stepCost(land, ni);
        if (c === Infinity) continue;
        var step = (d < 4 ? 1 : 1.414) * (c + 0.15 * T.slope[ni]);
        if (dist[cur] + step < dist[ni]) { dist[ni] = dist[cur] + step; prev[ni] = cur; heap.push(ni, dist[ni]); }
      }
    }
    // 目标镇：按优先级（只连已登场的镇）
    var targets = T.towns.filter(function (tw) { return tw !== hub && isActiveTown(tw, round) && PRIORITY[tw.id] >= 2.5; })
      .sort(function (a, b) { return PRIORITY[b.id] - PRIORITY[a.id]; });
    var added = 0, newTowns = [], bridges = [];
    var roadNear = roadNearSet(land, 3);
    for (var tt = 0; tt < targets.length && maxPaths > 0; tt++) {
      var tw = targets[tt], ti = townCell(tw);
      if (dist[ti] === Infinity || dist[ti] > costLimit) continue;
      if (roadNear[ti]) continue; // 已联网
      // 回溯路径
      var path = [], cur2 = ti, ok = true;
      while (cur2 !== -1 && cur2 !== hubIdx) {
        path.push(cur2);
        if (T.dem[cur2] <= 0 && !T.river[cur2]) { ok = false; break; } // 不穿海湾
        cur2 = prev[cur2];
      }
      if (!ok) continue;
      maxPaths--;
      for (var pi = 0; pi < path.length; pi++) {
        var cell = path[pi], t0 = land[cell];
        if (t0 === ROAD || t0 === URBAN || t0 === PORT || t0 === VILLAGE) continue;
        if (t0 === SEA || t0 === MANGROVE || t0 === MUD) continue;
        land[cell] = ROAD; added++;
        if (T.river[cell]) bridges.push(cell); // 河上桥
      }
      newTowns.push(tw.name);
    }
    return { added: added, newTowns: newTowns, bridges: bridges.length };
  }
  function stepCost(land, i) {
    var t = land[i];
    if (t === SEA) return Infinity;          // 湾海不穿
    if (t === MANGROVE) return 12;
    if (t === MUD) return 9;
    if (T.river[i]) return 7;                 // 河上架桥
    if (t === ROAD) return 0.4;
    if (t === URBAN || t === PORT) return 0.8;
    return 1;
  }
  function roadNearSet(land, radius) {
    var set = new Uint8Array(N);
    for (var i = 0; i < N; i++) {
      if (land[i] !== ROAD) continue;
      var x = i % W, y = (i / W) | 0;
      for (var dy = -radius; dy <= radius; dy++) for (var dx = -radius; dx <= radius; dx++) {
        var nx = x + dx, ny = y + dy;
        if (inGrid(nx, ny)) set[ny * W + nx] = 1;
      }
    }
    return set;
  }

  // ---------- 用地扩张通用 ----------
  function pickCandidates(land, from, radius, filterFn, scoreFn, budget, rng) {
    var cands = [];
    for (var i = 0; i < N; i++) {
      if (!filterFn(i, land[i], from)) continue;
      cands.push([i, scoreFn(i) + rng() * 0.2]);
    }
    cands.sort(function (a, b) { return b[1] - a[1]; });
    var picked = [];
    for (var k = 0; k < cands.length && picked.length < budget; k++) picked.push(cands[k][0]);
    return picked;
  }
  function withinDist(x, y, cx, cy, r) { return Math.abs(x - cx) <= r && Math.abs(y - cy) <= r; }

  function expandTea(land, budget, radius, connected) {
    if (budget <= 0) return 0;
    var eff = connected ? 1 : 0.45;
    var real = Math.max(1, Math.round(budget * eff));
    var cands = [];
    for (var i = 0; i < N; i++) {
      if (land[i] !== FOREST) continue;
      var x = i % W, y = (i / W) | 0;
      var e = T.dem[i], s = T.slope[i];
      if (e < 60 || e > 780 || s < 3 || s > 26) continue;
      var d = distTown(x, y, TEA_TOWN_IDX);
      if (d > radius) continue;
      var elevFit = 1 - Math.abs(e - 350) / 500;
      cands.push([i, 1 / (1 + d) + elevFit * 0.5]);
    }
    cands.sort(function (a, b) { return b[1] - a[1]; });
    var n = 0;
    for (var k = 0; k < cands.length && n < real; k++) { land[cands[k][0]] = TEA; n++; }
    return n;
  }
  function expandFarm(land, budget, round) {
    if (budget <= 0) return 0;
    var tf = activeTownFilter(round);
    var cands = [];
    for (var i = 0; i < N; i++) {
      if (land[i] !== FOREST) continue;
      var x = i % W, y = (i / W) | 0;
      if (T.dem[i] > 260 || T.slope[i] > 10) continue;
      var d = distTown(x, y, tf);
      if (d > 4.5) continue;
      cands.push([i, 1 / (1 + d)]);
    }
    cands.sort(function (a, b) { return b[1] - a[1]; });
    var n = 0;
    for (var k = 0; k < cands.length && n < budget; k++) { land[cands[k][0]] = FARM; n++; }
    return n;
  }
  function reclaimCoast(land, budget, toPond) {
    if (budget <= 0) return 0;
    var cands = [];
    for (var i = 0; i < N; i++) {
      if (land[i] !== MUD) continue;
      var x = i % W, y = (i / W) | 0;
      var d = distTown(x, y, null);
      if (d > 8) continue;
      cands.push([i, T.dem[i] * -1 + d * 0.4]); // 最低潮位优先、近镇优先
    }
    cands.sort(function (a, b) { return b[1] - a[1]; });
    var n = 0;
    for (var k = 0; k < cands.length && n < budget; k++) { land[cands[k][0]] = toPond ? POND : FARM; n++; }
    return n;
  }
  function growMangrove(land, budget) {
    if (budget <= 0) return 0;
    var cands = [];
    for (var i = 0; i < N; i++) {
      if (land[i] !== MUD) continue;
      var x = i % W, y = (i / W) | 0;
      if (bayT(x, y) < 0.4) continue;           // 湾内才宜红树林
      if (T.dem[i] > 2.5) continue;              // 只种低潮位滩面
      cands.push([i, 1 / (1 + T.dem[i])]);
    }
    cands.sort(function (a, b) { return b[1] - a[1]; });
    var n = 0;
    for (var k = 0; k < cands.length && n < budget; k++) { land[cands[k][0]] = MANGROVE; n++; }
    return n;
  }
  function restorePond(land, budget) { // 退养还滩
    var n = 0;
    for (var i = 0; i < N && n < budget; i++) if (land[i] === POND) { land[i] = MUD; n++; }
    return n;
  }
  // 滩涂光伏：优先占养殖塘，其次滨海低地（dem≤12 且临水）
  function buildSolar(land, budget) {
    if (budget <= 0) return 0;
    var cands = [];
    for (var i = 0; i < N; i++) {
      var t = land[i];
      if (t !== POND && t !== MUD && t !== FOREST && t !== FARM) continue;
      var x = i % W, y = (i / W) | 0;
      if (T.dem[i] > 12 || !T.coast[i]) continue;
      var pri = t === POND ? 3 : (t === MUD ? 2 : 1);
      cands.push([i, pri + 1 / (1 + T.dem[i])]);
    }
    cands.sort(function (a, b) { return b[1] - a[1]; });
    var n = 0;
    for (var k = 0; k < cands.length && n < budget; k++) { land[cands[k][0]] = SOLAR; n++; }
    return n;
  }

  // 港口：深水岸线
  function expandPort(land, budget, anchor) {
    var n = 0;
    var cands = [];
    for (var i = 0; i < N; i++) {
      if (land[i] !== VILLAGE && land[i] !== FOREST && land[i] !== FARM) continue;
      if (!T.coast[i]) continue;
      var x = i % W, y = (i / W) | 0;
      var d = Math.hypot(x - anchor.x, y - anchor.y);
      if (d > 4) continue;
      var deep = false;
      var nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var k = 0; k < 4; k++) {
        var nx = x + nb[k][0], ny = y + nb[k][1];
        if (inGrid(nx, ny) && T.sea[ny * W + nx] && T.dem[ny * W + nx] <= -4) { deep = true; break; }
      }
      if (deep) cands.push([i, 1 / (1 + d)]);
    }
    cands.sort(function (a, b) { return b[1] - a[1]; });
    for (var k2 = 0; k2 < cands.length && n < budget; k2++) { land[cands[k2][0]] = PORT; n++; }
    return n;
  }
  // 城镇升级 + 扩张
  function urbanize(land, state, upgradeK, urbanBudget, round) {
    var towns = T.towns.filter(function (tw) { return isActiveTown(tw, round); });
    var activeFilter = activeTownFilter(round);
    var upgraded = [];
    // 村→镇升级
    var scored = towns.map(function (tw) {
      var i = townCell(tw);
      var roadBonus = state.roadNear[i] ? 3 : 0;
      var coastBonus = COAST_TOWN[tw.id] ? 2.5 : 0;
      return { tw: tw, s: (PRIORITY[tw.id] || 1) + roadBonus + coastBonus };
    }).sort(function (a, b) { return b.s - a.s; });
    for (var u = 0; u < Math.min(upgradeK, scored.length); u++) {
      var tw = scored[u].tw, ci = townCell(tw);
      if (land[ci] !== VILLAGE) continue;
      land[ci] = URBAN; upgraded.push(tw.name);
      var nbs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var nb = 0; nb < nbs.length; nb++) {
        var nx = tw.x + nbs[nb][0], ny = tw.y + nbs[nb][1];
        if (inGrid(nx, ny)) {
          var ni = ny * W + nx;
          if (land[ni] === VILLAGE || land[ni] === FOREST || land[ni] === FARM) land[ni] = URBAN;
        }
      }
    }
    // 建成区扩张
    var grown = 0;
    if (urbanBudget > 0) {
      var src = new Uint8Array(N);
      for (var i = 0; i < N; i++) if (land[i] === URBAN || land[i] === PORT) src[i] = 1;
      var ring1 = new Uint8Array(N), ring2 = new Uint8Array(N);
      var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
      for (i = 0; i < N; i++) {
        if (!src[i]) continue;
        var x = i % W, y = (i / W) | 0;
        for (var dd = 0; dd < 8; dd++) {
          var nx2 = x + DIRS[dd][0], ny2 = y + DIRS[dd][1];
          if (!inGrid(nx2, ny2)) continue;
          ring1[ny2 * W + nx2] = 1;
        }
      }
      for (i = 0; i < N; i++) {
        if (land[i] !== ROAD) continue;
        var x3 = i % W, y3 = (i / W) | 0;
        for (dd = 0; dd < 8; dd++) {
          nx2 = x3 + DIRS[dd][0]; ny2 = y3 + DIRS[dd][1];
          if (!inGrid(nx2, ny2)) continue;
          ring2[ny2 * W + nx2] = 1;
        }
      }
      var cands = [];
      for (i = 0; i < N; i++) {
        var t = land[i], x4 = i % W, y4 = (i / W) | 0;
        var okType = (t === FOREST || t === FARM || t === VILLAGE || t === TEA || (t === POND));
        if (!okType) continue;
        if (T.slope[i] > 14 || T.dem[i] < 1.5 || T.dem[i] > 320) continue;
        var near = ring1[i];
        var nearRoad = ring2[i] && distTown(x4, y4, activeFilter) < 7;
        if (t === POND && state.policyEco) continue;    // 生态期不动养殖塘
        if (!(near || nearRoad)) continue;
        var sc = (near ? 1 : 0.5) + (state.roadNear[i] ? 0.6 : 0) + (t === VILLAGE ? 0.5 : 0);
        cands.push([i, sc]);
      }
      cands.sort(function (a, b) { return b[1] - a[1]; });
      for (var c = 0; c < cands.length && grown < urbanBudget; c++) { land[cands[c][0]] = URBAN; grown++; }
    }
    return { upgraded: upgraded, grown: grown };
  }
  function growVillages(land, budget, round) {
    var n = 0;
    var tf = activeTownFilter(round);
    var cands = [];
    for (var i = 0; i < N; i++) {
      if (land[i] !== FOREST && land[i] !== FARM) continue;
      var x = i % W, y = (i / W) | 0;
      if (T.slope[i] > 12 || T.dem[i] > 350) continue;
      var d = distTown(x, y, tf);
      if (d > 5) continue;
      cands.push([i, 1 / (1 + d)]);
    }
    cands.sort(function (a, b) { return b[1] - a[1]; });
    for (var k = 0; k < cands.length && n < budget; k++) { land[cands[k][0]] = VILLAGE; n++; }
    return n;
  }

  // 龙安开发区：湾口南岸填海造区（改革开放后且未开生态保护才出现）
  function spawnLongan(land, budget, round) {
    var tw = null;
    for (var i = 0; i < T.towns.length; i++) if (T.towns[i].id === 'longan') tw = T.towns[i];
    if (!tw || !isActiveTown(tw, round)) return 0;
    var cands = [];
    for (i = 0; i < N; i++) {
      var t = land[i];
      if (t !== MUD && t !== FARM && t !== POND && t !== FOREST && t !== VILLAGE) continue;
      var x = i % W, y = (i / W) | 0;
      var d = Math.hypot(x - tw.x, y - tw.y);
      if (d > 2.8 || T.dem[i] > 9) continue;
      cands.push([i, 1 / (1 + d)]);
    }
    cands.sort(function (a, b) { return b[1] - a[1]; });
    var n = 0;
    for (var k = 0; k < cands.length && n < budget; k++) { land[cands[k][0]] = URBAN; n++; }
    return n;
  }

  // ---------- 统计与表格 ----------
  function countLand(land) {
    var cnt = new Array(D.LAND.length).fill(0);
    for (var i = 0; i < N; i++) cnt[land[i]]++;
    return cnt;
  }
  function buildTable(prevLand, land) {
    var prevCnt = prevLand ? countLand(prevLand) : countLand(land);
    var curCnt = countLand(land);
    return D.LAND.map(function (L) {
      var id = L.id;
      return {
        id: id, name: L.name, cat: L.cat,
        prevCells: prevCnt[id], currCells: curCnt[id],
        delta: curCnt[id] - prevCnt[id],
        prevKm2: +(prevCnt[id] * AREA).toFixed(2), currKm2: +(curCnt[id] * AREA).toFixed(2),
        deltaKm2: +((curCnt[id] - prevCnt[id]) * AREA).toFixed(2)
      };
    });
  }

  // ---------- 叙事 ----------
  function numPara(year, pop, stats) {
    var popTxt = pop >= 10000 ? '约' + (pop / 10000).toFixed(1) + '万人' : '约' + Math.round(pop) + '人';
    return '至' + year + '年，全境人口' + popTxt + '，城镇建成区约' + (stats[URBAN] * AREA).toFixed(1) +
      '平方公里，茶园约' + (stats[TEA] * AREA).toFixed(1) + '平方公里，滩涂约' + (stats[MUD] * AREA).toFixed(1) +
      '平方公里，道路里程约' + (stats[ROAD] * 0.5).toFixed(1) + '公里。';
  }
  function policyPara(policy, rd, stats, prevStats, roadInfo, connected) {
    var parts = [];
    if (policy.road) {
      if (roadInfo.newTowns.length) {
        parts.push('官道自桐山延伸，' + roadInfo.newTowns.join('、') + '接入路网' +
          (rd >= 4 ? '，机耕路与公路开始替代石板道' : '') + '。');
      } else if (rd >= 4) {
        parts.push('公路网继续加密，货车可达的村坊又多了几个。');
      } else {
        parts.push('路工仍在山间一寸寸推进。');
      }
    } else if (rd >= 2) {
      parts.push('官道无人问津，山货依旧靠脚力与渡船。');
    }
    if (policy.tea) {
      var dTea = (stats[TEA] - prevStats[TEA]) * AREA;
      if (connected) {
        parts.push('茶园顺着坡地铺开，本季新增约' + Math.max(0, dTea).toFixed(1) + '平方公里茶山，茶青沿路直送埠头。');
      } else {
        parts.push('茶园虽在扩张，路未通港，茶箱仍要肩挑马驮出山，茶利折半。');
      }
    }
    if (policy.eco) {
      if (prevStats[POND] > 0 && rd >= 5) parts.push('退养还滩启动，' + (prevStats[POND] - stats[POND]) + '格虾塘还给了潮水。');
      else parts.push('滩涂与红树林受约保护，围垦造塘被叫停。');
    } else if (rd >= 4 && stats[POND] > prevStats[POND]) {
      parts.push('滩涂被围成' + (stats[POND] - prevStats[POND]) + '格养殖塘与田垄，候鸟的食堂一年比一年小。');
    }
    if (policy.solar && rd >= 5) {
      if (stats[SOLAR] > prevStats[SOLAR]) parts.push('养殖塘与滨海低地上架起成片光伏矩阵，风机的叶片接住了季风——向海要能。');
      else parts.push('光伏选址的测量队仍在海边拉尺。');
    }
    return parts.join('');
  }

  // ---------- 推演 ----------
  function initGame(seed) {
    seed = seed || 20261029;
    var rng = T.mulberry32(seed);
    var land = initLand(rng);
    var state = {
      seed: seed, round: 0, year: D.ERAS[0].year, pop: D.ERAS[0].pop,
      land: land, policyEco: false, roadNear: new Uint8Array(N),
      longanAlive: false,
      records: []
    };
    var stats = countLand(land);
    var record = {
      round: 0, year: state.year, eraLabel: D.ERAS[0].label, policy: null, events: [],
      land: land, table: buildTable(null, land), stats: stats,
      narrative: [D.ERAS[0].intro,
        '此刻：全境人口' + (D.ERAS[0].pop >= 10000 ? '约' + (D.ERAS[0].pop / 10000).toFixed(1) + '万人' : '约' + D.ERAS[0].pop + '人') +
        '，渔村渡口散布湾畔，官道尚未成形。',
        D.ERAS[0].outro],
      issues: [], roadNear: new Uint8Array(N), longan: false
    };
    state.records.push(record);
    return state;
  }

  function stepRound(state, policy) {
    if (state.round >= 6) return null;
    var round = state.round + 1;
    var era = D.ERAS[round];
    var rng = T.mulberry32(state.seed * 1000 + round);
    var land = new Uint8Array(state.land); // 拷贝推进
    var prevStats = state.records[state.records.length - 1].stats;

    // 1) 事件抽取（确定性：先事件后施策）
    var pool = D.EVENTS[round] || [];
    var events = [];
    var nEv = 1 + (rng() < 0.55 ? 1 : 0);
    var used = {};
    for (var e = 0; e < nEv; e++) {
      var totalW = 0;
      for (var p = 0; p < pool.length; p++) if (!used[pool[p].id]) totalW += pool[p].weight;
      if (!totalW) break;
      var roll = rng() * totalW, acc = 0, chosen = null;
      for (p = 0; p < pool.length; p++) {
        if (used[pool[p].id]) continue;
        acc += pool[p].weight;
        if (roll <= acc) { chosen = pool[p]; break; }
      }
      if (!chosen) chosen = pool[0];
      used[chosen.id] = 1; events.push(chosen);
    }
    var mod = { popMul: 1, urbanAdd: 0, teaAdd: 0, farmAdd: 0, roadAdd: 0, portAdd: 0, reclaimAdd: 0, ecoRestore: 0 };
    events.forEach(function (ev) {
      var m = ev.mod;
      for (var k in m) {
        if (k === 'popMul') mod[k] = mod[k] * m[k];  // 人口乘子按连乘聚合
        else mod[k] = (mod[k] || 0) + m[k];
      }
    });

    // 1.5) 龙安开发区（改革开放后、未开生态才围海造区；一旦落地不再消失）
    var longanSpawned = 0;
    if (round >= 5 && !policy.eco && !state.longanAlive) {
      longanSpawned = spawnLongan(land, 6, round);
      if (longanSpawned > 0) state.longanAlive = true;
    } else if (round >= 5 && state.longanAlive) {
      longanSpawned = spawnLongan(land, 4, round);
    }

    // 2) 修路
    var roadInfo = { added: 0, newTowns: [], bridges: 0 };
    if (policy.road) {
      roadInfo = buildRoads(land, state, ROAD_SLOTS[round] + Math.max(0, mod.roadAdd), ROAD_COST_LIMIT[round], round);
    }
    state.roadNear = roadNearSet(land, 3);

    // 3) 路是否通港（路网 3 格内有港口或湾岸深水镇）
    var connected = roadConnectedToPort(land);

    // 4) 茶园
    var teaBudget = era.teaBudget + Math.max(0, mod.teaAdd);
    var teaAdded = policy.tea ? expandTea(land, teaBudget, TEA_RADIUS[round], connected && policy.road) : 0;

    // 5) 农田
    var farmAdded = expandFarm(land, era.farmBudget + Math.max(0, mod.farmAdd), round);

    // 6) 围垦（需要技术 + 未开生态）
    var reclaimed = 0;
    if (era.tech.reclamation && !policy.eco) {
      reclaimed = reclaimCoast(land, RECLAIM_BUDGET[round] + Math.max(0, mod.reclaimAdd), round >= 5);
    }

    // 7) 生态：红树林 / 退养还滩
    var mangroved = 0, restored = 0;
    if (policy.eco) {
      mangroved = growMangrove(land, (round >= 3 ? 3 : 1) + Math.max(0, mod.ecoRestore));
      if (round >= 5) restored = restorePond(land, 4);
    } else if (mod.ecoRestore > 0) {
      mangroved = growMangrove(land, mod.ecoRestore);
    }

    // 7.5) 滩涂光伏（改革开放后可行；生态保护期禁建）
    var solarAdded = 0;
    if (policy.solar && round >= 5 && !policy.eco) {
      solarAdded = buildSolar(land, round === 5 ? 10 : 12);
    }

    // 8) 村→镇升级 + 城镇扩张
    var urbanBudget = Math.max(0, Math.round(era.urbanBudget * (policy.road ? 1.35 : 0.85)) + mod.urbanAdd);
    var urb = urbanize(land, { roadNear: state.roadNear, policyEco: policy.eco }, UPGRADE_K[round], urbanBudget, round);

    // 9) 港口
    var portAdded = 0;
    if (round >= 3) {
      portAdded += expandPort(land, Math.min(4, 1 + round - 3) + Math.max(0, mod.portAdd), T.towns[1]); // 沙埕
      if (round >= 4) portAdded += expandPort(land, 2, T.towns[0]); // 桐山
      if (round >= 6) portAdded += expandPort(land, 2, T.towns[8]); // 秦屿渔港
    }

    // 10) 村落增长
    var villGrown = growVillages(land, Math.ceil(era.farmBudget / 2), round);

    // 11) 人口（上轮已超载 → 本轮人口外流抑制）
    var capPrev = D.capacityOf(prevStats);
    var migration = state.pop > capPrev * 1.05 ? 0.9 : 1;
    var popMul = (era.popMul || 1) * mod.popMul;
    if (policy.road) popMul *= 1.02;
    if (policy.tea) popMul *= connected ? 1.03 : 1.015;
    if (policy.eco) popMul *= 0.995;
    if (policy.solar) popMul *= 1.005;
    if (migration < 1) popMul *= migration;
    var newPop = Math.max(500, Math.round(state.pop * popMul));

    // 12) 统计 / 表格 / 叙事 / 校验
    var stats = countLand(land);
    var table = buildTable(state.land, land);
    var paras = [era.intro];
    var pp = policyPara(policy, round, stats, prevStats, roadInfo, connected);
    if (pp) paras.push(pp);
    if (round === 5 && longanSpawned) paras.push('湾口南岸，龙安开发区在围垦出来的土地上破土而出——塔吊与厂房开始替代滩涂上的白鹭。');
    else if (round === 6 && longanSpawned) paras.push('龙安开发区继续向海要地，二期厂房沿着新岸线排开。');
    else if (round === 5 && !longanSpawned) paras.push('按海湾治理的规矩，龙安一带的填海造区计划被按下暂停键——那片滩涂留给了候鸟与纳潮。');
    if (migration < 1) paras.push('田不足养，生业不继，这一年人口明显外流——山海之间容不下失控的增长。');
    events.forEach(function (ev) { paras.push(ev.note); });
    paras.push(numPara(era.year, newPop, stats));
    paras.push(era.outro);

    var record = {
      round: round, year: era.year, eraLabel: era.label, policy: policy, events: events,
      land: land, table: table, stats: stats, pop: newPop, longan: state.longanAlive,
      narrative: paras, roadInfo: roadInfo, connected: connected,
      deltas: { teaAdded: teaAdded, farmAdded: farmAdded, reclaimed: reclaimed, mangroved: mangroved, restored: restored, portAdded: portAdded, villGrown: villGrown, urbanGrown: urb.grown, upgraded: urb.upgraded, longanSpawned: longanSpawned, solarAdded: solarAdded },
      issues: []
    };
    state.land = land; state.round = round; state.year = era.year; state.pop = newPop;
    state.policyEco = policy.eco;
    state.records.push(record);
    record.issues = V.validateRound(state.records, state.records.length - 1);
    return record;
  }

  function roadConnectedToPort(land) {
    // 路网触及港口或湾岸（湾岸即埠）即视为通港
    var near = roadNearSet(land, 3);
    for (var i = 0; i < N; i++) {
      if (!near[i]) continue;
      if (land[i] === PORT || T.bay[i]) return true;
    }
    return false;
  }

  // ---------- 终局评分 ----------
  function finalScores(state) {
    var s = state.records[state.records.length - 1].stats;
    var mud0 = state.records[0].stats[MUD];
    var ecoRounds = state.records.filter(function (r) { return r.policy && r.policy.eco; }).length;
    var urbanKm2 = s[URBAN] * AREA, teaKm2 = s[TEA] * AREA, roadKm = s[ROAD] * 0.5, solarKm2 = s[SOLAR] * AREA;
    var econ = clamp100(Math.round((urbanKm2 * 1.0 + s[PORT] * 2.6 + roadKm * 0.35 + teaKm2 * 0.25 + solarKm2 * 1.6 + state.pop / 12000) / 2.4));
    var eco = clamp100(Math.round(s[MUD] / Math.max(1, mud0) * 38 + s[MANGROVE] * 0.9 + ecoRounds * 5 - s[POND] * 0.22 - s[SOLAR] * 0.3));
    var cap = D.capacityOf(s);
    var ratio = state.pop / Math.max(1, cap);
    var liv = clamp100(Math.round(52 + (ratio <= 1 ? 24 : Math.max(0, 24 - (ratio - 1) * 90)) + teaKm2 * 0.45 + s[VILLAGE] * 0.12));
    return {
      econ: econ, eco: eco, living: liv,
      total: Math.round(econ * 0.4 + eco * 0.35 + liv * 0.25),
      capacity: cap, popRatio: +ratio.toFixed(2)
    };
  }
  function clamp100(v) { return Math.max(0, Math.min(100, v)); }

  // ---------- 情景一键推演 ----------
  function runScenario(sc) {
    var state = initGame();
    for (var r = 0; r < 6; r++) stepRound(state, sc.policy[r]);
    return { state: state, scores: finalScores(state) };
  }

  var api = {
    initGame: initGame, stepRound: stepRound, runScenario: runScenario,
    finalScores: finalScores, countLand: countLand, buildTable: buildTable,
    bayT: bayT, distTown: distTown,
    LAND_IDS: { SEA: SEA, MUD: MUD, WATER: WATER, MANGROVE: MANGROVE, FOREST: FOREST, TEA: TEA, FARM: FARM, VILLAGE: VILLAGE, URBAN: URBAN, PORT: PORT, ROAD: ROAD, POND: POND }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FDEngine = api;
})(typeof self !== 'undefined' ? self : this);
