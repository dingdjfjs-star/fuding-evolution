/* 《福鼎城镇演化》地形模块 v2：真实市域轮廓版
 * 掩膜来自用户提供的福鼎市域轮廓图（tools/extract-boundary.js → js/boundary.js）
 * 格网 72×72，CELL=0.8km，陆域约 2662 格 ≈ 1700km²（福鼎市域约 1526km²，沙盘略大 12%）
 * 水系/湾道/山体按真实格局重排：沙埕港楔形深水湾（口 -26m → 顶 -6.5m）、
 * 桐山溪/水北溪/管阳溪/照澜溪/点头溪/秦屿溪/店下溪、太姥山（南）、磻溪/管阳山地（西）、嵛山岛（东南）
 * 高程单位米；不变量：陆域格 dem ≥ 1.2m，水域格 dem ≤ -1.2m（与掩膜严格一致）
 */
'use strict';
(function (root) {
  var B = (typeof module !== 'undefined' && module.exports)
    ? require('./boundary.js')
    : root.FDBoundary;
  // 真实高程（SRTM，由 tools/fetch-dem.js 抓取；缺失时退回程序化地形）
  var R = null;
  if (typeof module !== 'undefined' && module.exports) {
    try { R = require('./realdem.js'); } catch (e) { R = null; }
  } else {
    R = root.FDRealDEM || null;
  }
  if (R && (R.W !== 72 || R.H !== 72)) R = null;
  // 真实河网（OSM，由 tools/fetch-rivers.js 抓取；缺失时退回手绘水系）
  var RR = null;
  if (typeof module !== 'undefined' && module.exports) {
    try { RR = require('./realrivers.js'); } catch (e) { RR = null; }
  } else {
    RR = root.FDRealRivers || null;
  }
  if (!RR || !RR.rivers || RR.rivers.length < 4) RR = null;
  var W = 72, H = 72, CELL = 0.8;          // 格网 72×72，格距 0.8km
  var N = W * H;
  var AREA = CELL * CELL;                  // 0.64 km²/格
  var SEED = 20261029;

  // ---------- 解析掩膜 ----------
  var territory = new Uint8Array(N);
  for (var i = 0; i < N; i++) territory[i] = +B.maskStr.charAt(i);

  // ---------- 确定性随机 ----------
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash2(x, y, seed) {
    var h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function valueNoise(x, y, seed) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var xf = x - xi, yf = y - yi;
    var a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
    var c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
    var u = smooth(xf), v = smooth(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, seed, oct) {
    var v = 0, amp = 1, f = 1, sum = 0;
    for (var k = 0; k < oct; k++) {
      v += valueNoise(x * f, y * f, seed + k * 101) * amp;
      sum += amp; amp *= 0.5; f *= 2;
    }
    return v / sum;
  }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function mix(a, b, t) { return a + (b - a) * t; }

  // ---------- 沙埕湾楔形（与提取工具同一公式） ----------
  var BAY_TIP_X = 36, BAY_MOUTH_X = 71, BAY_MID_Y = 21;
  function wedgeTop(x) { return 21 - 4.6 * (x - BAY_TIP_X) / (BAY_MOUTH_X - BAY_TIP_X); }
  function wedgeBot(x) { return 21 + 5.6 * (x - BAY_TIP_X) / (BAY_MOUTH_X - BAY_TIP_X); }
  function inWedge(x, y) {
    if (x < BAY_TIP_X || x > BAY_MOUTH_X) return false;
    return y >= wedgeTop(x) && y <= wedgeBot(x);
  }
  function bayT(x, y) { // 0=湾口 → 1=湾顶；湾体与近岸带（上下岸外 3 格）都计入，供红树林/滩涂判定
    if (x < BAY_TIP_X - 2 || x > BAY_MOUTH_X) return 0;
    var t = 1 - (x - BAY_TIP_X) / (BAY_MOUTH_X - BAY_TIP_X);
    if (y >= wedgeTop(x) - 3 && y <= wedgeBot(x) + 3) return t;
    return 0;
  }
  var BAY_PTS = [[BAY_MOUTH_X, 22], [62, 20], [50, 21], [43, 21], [BAY_TIP_X, 21]];

  // ---------- 地理骨架 ----------
  var BUMPS = [
    { x: 34, y: 39, h: 640, s: 3.0, name: '太姥山' },
    { x: 20, y: 26, h: 700, s: 5.0, name: '磻溪群山' },
    { x: 7, y: 22, h: 620, s: 4.0, name: '管阳界岭' },
    { x: 32, y: 6, h: 460, s: 6.0, name: '北岭' },
    { x: 44, y: 32, h: 300, s: 4.0, name: '白琳丘陵' },
    { x: 56, y: 12, h: 260, s: 3.5, name: '前岐丘陵' }
  ];
  var ISLANDS = [
    { x: 60, y: 68, h: 541, s: 1.8, name: '大嵛山岛' }  // 真实主峰红纪洞山 541.4m
  ];
  var RIVERS = [
    { name: '桐山溪', pts: [[18, 16], [24, 17], [30, 19], [34, 20], [37, 21]] },   // 汇入湾顶
    { name: '水北溪', pts: [[28, 6], [31, 10], [33, 14], [34, 18], [34, 20]] },    // 汇入桐山溪
    { name: '管阳溪', pts: [[6, 20], [10, 19], [14, 18], [18, 16]] },              // 汇入桐山溪
    { name: '照澜溪', pts: [[54, 8], [56, 12], [57, 15], [57, 17]] },              // 汇入湾北岸
    { name: '点头溪', pts: [[40, 10], [42, 14], [43, 18], [43, 20]] },             // 汇入湾南岸
    { name: '秦屿溪', pts: [[24, 42], [30, 44], [36, 45], [42, 47], [45, 52]] },   // 入东海
    { name: '店下溪', pts: [[46, 30], [50, 32], [54, 32], [58, 32], [61, 32], [63, 33]] } // 入东海（绕开店下镇址）
  ];
  var TOWNS = [
    { id: 'tongshan', name: '桐山渡', x: 37, y: 20, kind: '渡口', lon: 120.214, lat: 27.327, note: '沙埕港顶、桐山溪汇口，闽浙古道咽喉' },
    { id: 'shacheng', name: '沙埕', x: 62, y: 17, kind: '渔港', lon: 120.442, lat: 27.163, note: '湾口北岸深水良港，渔汛商船辐辏' },
    { id: 'qianqi', name: '前岐', x: 50, y: 16, kind: '山乡', lon: 120.322, lat: 27.303, note: '湾北岸，照澜溪畔门户' },
    { id: 'diantou', name: '点头', x: 44, y: 23, kind: '山乡渡口', lon: 120.234, lat: 27.274, note: '湾南岸，茶叶集散埠' },
    { id: 'bailin', name: '白琳', x: 36, y: 27, kind: '山乡', lon: 120.185, lat: 27.236, note: '白琳工夫茶原乡' },
    { id: 'panxi', name: '磻溪', x: 24, y: 26, kind: '山乡', lon: 120.093, lat: 27.212, note: '西部高山茶区' },
    { id: 'guanyang', name: '管阳', x: 10, y: 25, kind: '山乡', lon: 120.014, lat: 27.279, note: '界岭山区，云雾茶园' },
    { id: 'dianxia', name: '店下', x: 52, y: 30, kind: '农乡', lon: 120.352, lat: 27.120, note: '东南滨海平原谷仓' },
    { id: 'qinyu', name: '秦屿', x: 42, y: 50, kind: '渔村', lon: 120.205, lat: 27.060, note: '太姥山东南海滨，渔汛良港' },
    { id: 'yushan', name: '嵛山', x: 60, y: 68, kind: '海岛渔村', lon: 120.348, lat: 26.947, note: '大嵛山岛，天湖草场' },
    // 龙安开发区：1990s 围垦造区，只在改革开放后且未开生态保护时出现
    { id: 'longan', name: '龙安', x: 58, y: 26, kind: '开发区', fromRound: 5, lon: 120.388, lat: 27.117, note: '前身为店下杨岐垦区（1991 年海堤堵口），1998 年设区；合成革与化工集聚' }
  ];

  // ---------- BFS 距离场 ----------
  function bfsDist(seedArr) {
    var dist = new Float64Array(N).fill(Infinity);
    var q = [];
    for (var i = 0; i < N; i++) if (seedArr[i]) { dist[i] = 0; q.push(i); }
    var head = 0;
    while (head < q.length) {
      var cur = q[head++];
      var cx = cur % W, cy = (cur / W) | 0;
      var nbs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var d = 0; d < 4; d++) {
        var nx = cx + nbs[d][0], ny = cy + nbs[d][1];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        var j = ny * W + nx;
        if (dist[j] > dist[cur] + 1) { dist[j] = dist[cur] + 1; q.push(j); }
      }
    }
    return dist;
  }

  // ---------- DEM 生成 ----------
  function buildTerrain() {
    var dem = new Float64Array(N);
    var x, y, b;
    if (R) {
      // 1) 真实高程基底（Copernicus DEM）：陆域用实测高程，海域留 0 交由后续水处理
      for (i = 0; i < N; i++) dem[i] = R.dem[i];
    } else {
      // 1) 程序化兜底：西高东低 + 山体 + 噪声
      for (y = 0; y < H; y++) {
        for (x = 0; x < W; x++) {
          var e0 = 14 + 12.2 * (W - 1 - x);
          for (b = 0; b < BUMPS.length; b++) {
            var p = BUMPS[b], dx = x - p.x, dy = y - p.y;
            e0 += p.h * Math.exp(-(dx * dx + dy * dy) / (2 * p.s * p.s));
          }
          e0 += (fbm(x * 0.09, y * 0.09, SEED + 1, 4) - 0.5) * 95;
          e0 += (fbm(x * 0.27, y * 0.27, SEED + 2, 3) - 0.5) * 34;
          dem[y * W + x] = e0;
        }
      }
    }
    // 2) 滨海低地：
    //    真实 DEM：轮廓形状优先——采样到真实海面的陆域格按距水给滨海低地（3~30m）
    //    程序化：阶梯式帽盖（距水 1 格 ≈ 3m，2 格 ≈ 13m，3 格 ≈ 25m）
    var waterSeed = new Uint8Array(N);
    for (i = 0; i < N; i++) waterSeed[i] = territory[i] ? 0 : 1;
    var dWater = bfsDist(waterSeed);
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      var i2 = y * W + x;
      if (!territory[i2]) continue;
      var dw = dWater[i2];
      if (R) {
        if (dem[i2] <= 0.5) {
          // 手绘轮廓盖在真实海岸线之外：按滨海低地处理（形状优先，高度取真实滨海带）
          dem[i2] = mix(2.5, 28, clamp((dw - 1) / 4, 0, 1)) + fbm(x * 0.2, y * 0.2, SEED + 3, 2) * 6;
        } else if (dw <= 2) {
          var capR = mix(3.2, 18, dw - 1) + fbm(x * 0.2, y * 0.2, SEED + 3, 2) * 4;
          dem[i2] = Math.min(dem[i2], capR);
        }
      } else if (dw <= 4) {
        var tier = clamp((dw - 1) / 3, 0, 1);
        var cap = mix(2.8, 42, tier) + fbm(x * 0.2, y * 0.2, SEED + 3, 2) * 7;
        dem[i2] = Math.min(dem[i2], cap);
      }
    }
    // 3) 沙埕湾槽加深 + 岸带陆地保持
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      var i3 = y * W + x;
      if (inWedge(x, y)) {
        var t = (x - BAY_TIP_X) / (BAY_MOUTH_X - BAY_TIP_X);
        var mid = (wedgeTop(x) + wedgeBot(x)) / 2;
        var half = (wedgeBot(x) - wedgeTop(x)) / 2;
        var centerK = clamp(1 - Math.abs(y - mid) / Math.max(0.5, half), 0, 1);
        dem[i3] = Math.min(dem[i3], mix(-6.5, -26, t) - centerK * 2.5);
        } else if (territory[i3]) {
        // 湾岸 2 格带：低而陆（潮间带滩涂主要来源）
        var nearBay = 1e9;
        for (var yy = Math.max(0, y - 2); yy <= Math.min(H - 1, y + 2); yy++)
          for (var xx = Math.max(0, x - 2); xx <= Math.min(W - 1, x + 2); xx++)
            if (inWedge(xx, yy)) nearBay = Math.min(nearBay, Math.max(Math.abs(xx - x), Math.abs(yy - y)));
        if (nearBay <= 2) dem[i3] = Math.max(1.0, Math.min(dem[i3], 2.2 + fbm(x * 0.3, y * 0.3, SEED + 5, 2) * 2.2));
      }
    }
    // 4) 开敞海域：距陆越远越深
    var landSeed = new Uint8Array(N);
    for (i = 0; i < N; i++) landSeed[i] = territory[i] ? 1 : 0;
    var dLand = bfsDist(landSeed);
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      var i4 = y * W + x;
      if (territory[i4] || inWedge(x, y)) continue;
      dem[i4] = Math.min(dem[i4], -(2.2 + 9.5 * clamp(dLand[i4] / 6, 0, 1) + fbm(x * 0.18, y * 0.18, SEED + 4, 2) * 3));
    }
    // 5) 岛屿：嵛山岛按真实主峰 541m 造山（bbox 配准下岛位以手绘轮廓为准）
    for (var s = 0; s < ISLANDS.length; s++) {
      var is = ISLANDS[s];
      for (y = Math.max(0, is.y - 5); y <= Math.min(H - 1, is.y + 5); y++) {
        for (x = Math.max(0, is.x - 5); x <= Math.min(W - 1, is.x + 5); x++) {
          var i5 = y * W + x;
          if (!territory[i5]) continue;
          var dx2 = x - is.x, dy2 = y - is.y;
          var v = is.h * Math.exp(-(dx2 * dx2 + dy2 * dy2) / (2 * is.s * is.s)) - 6;
          if (v > dem[i5]) dem[i5] = v;
        }
      }
    }
    // 6) 陆地平滑（<8m 潮间带不参与，防岸线回抬）
    var dem2 = new Float64Array(dem);
    for (y = 1; y < H - 1; y++) for (x = 1; x < W - 1; x++) {
      var i6 = y * W + x;
      if (!territory[i6] || dem[i6] < 8) continue;
      var sum = 0, cnt = 0;
      for (var yy2 = -1; yy2 <= 1; yy2++) for (var xx2 = -1; xx2 <= 1; xx2++) {
        var j = (y + yy2) * W + (x + xx2);
        if (territory[j] && dem[j] >= 8) { sum += dem[j]; cnt++; }
      }
      if (cnt) dem2[i6] = mix(dem[i6], sum / cnt, 0.5);
    }
    dem = dem2;
    // 7) 河道下切：单调下降（真实河网优先，河口自动延伸至手绘水面）
    var river = new Uint8Array(N);
    var riverList;
    if (RR) {
      var HAND_NAMES = ['照澜溪', '水北溪', '点头溪', '秦屿溪', '店下溪', '管阳溪'];
      var handPt = {};
      RIVERS.forEach(function (r) { handPt[r.name] = r.pts[r.pts.length - 1]; });
      function nearWaterCell(cx, cy, r2) {
        for (var dy = -r2; dy <= r2; dy++) for (var dx = -r2; dx <= r2; dx++) {
          var nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          if (!territory[ny * W + nx]) return true;
        }
        return false;
      }
      riverList = RR.rivers.map(function (r) {
        var pts = r.pts.map(function (p) { return [p[0], p[1]]; });
        // 定向：河口 = 离手绘水面更近的一端（OSM way 方向不定）
        function dWater(x0, y0) {
          var bd = 99;
          for (var dy = -15; dy <= 15; dy++) for (var dx = -15; dx <= 15; dx++) {
            var nx = Math.round(x0) + dx, ny = Math.round(y0) + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            if (!territory[ny * W + nx]) return Math.abs(dx) + Math.abs(dy);
            bd = Math.min(bd, Math.abs(dx) + Math.abs(dy));
          }
          return bd;
        }
        if (dWater(pts[0][0], pts[0][1]) < dWater(pts[pts.length - 1][0], pts[pts.length - 1][1])) pts.reverse();
        var mx = Math.max(0, Math.min(W - 1, Math.round(pts[pts.length - 1][0])));
        var my = Math.max(0, Math.min(H - 1, Math.round(pts[pts.length - 1][1])));
        if (!nearWaterCell(mx, my, 2)) {
          // 河口延伸：BFS 陆地找最近手绘水面（≤10 步）
          var src = my * W + mx;
          var prev = {}; var q = [src]; var qk = {}; qk[src] = 1;
          var found = -1;
          for (var qi = 0; qi < q.length && found < 0; qi++) {
            var cur = q[qi], cx = cur % W, cy = (cur / W) | 0;
            var nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            for (var d3 = 0; d3 < 4; d3++) {
              var nx = cx + nb[d3][0], ny = cy + nb[d3][1];
              if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
              var j3 = ny * W + nx;
              if (qk[j3]) continue;
              qk[j3] = 1; prev[j3] = cur;
              if (!territory[j3]) { found = j3; break; }
              q.push(j3);
            }
          }
          if (found >= 0) {
            var path = [], walk = found;
            while (walk !== src && prev[walk] !== undefined) { path.push(walk); walk = prev[walk]; }
            path.reverse();
            for (var pi3 = 0; pi3 < path.length; pi3++) pts.push([(path[pi3] % W) + 0.5, ((path[pi3] / W) | 0) + 0.5]);
          }
        }
        var name = r.name;
        if (name === '未名溪') {
          var bd = 1e9, bn = '溪';
          for (var hn = 0; hn < HAND_NAMES.length; hn++) {
            var hp = handPt[HAND_NAMES[hn]];
            var dd2 = Math.hypot(mx - hp[0], my - hp[1]);
            if (dd2 < bd) { bd = dd2; bn = HAND_NAMES[hn]; }
          }
          if (bd <= 9) name = bn;
        }
        return { name: name, pts: pts };
      });
    } else {
      riverList = RIVERS;
    }
    for (var rv = 0; rv < riverList.length; rv++) {
      var pts = riverList[rv].pts;
      var prevBed = 1e9;
      for (i = 0; i < pts.length; i++) {
        var xi = Math.max(0, Math.min(W - 1, Math.round(pts[i][0]))), yi = Math.max(0, Math.min(H - 1, Math.round(pts[i][1])));
        var gi = yi * W + xi;
        var sample = dem[gi] > 0 ? dem[gi] : 30;
        var bed = Math.min(sample - 2.5, prevBed - 0.6);
        if (i === 0) bed = Math.min(sample - 2.5, 780);
        prevBed = bed;
        for (yy = Math.max(0, yi - 1); yy <= Math.min(H - 1, yi + 1); yy++) {
          for (xx = Math.max(0, xi - 1); xx <= Math.min(W - 1, xi + 1); xx++) {
            var dd = Math.hypot(xx - pts[i][0], yy - pts[i][1]);
            if (dd <= 0.9 && territory[yy * W + xx]) {
              var gj = yy * W + xx;
              dem[gj] = Math.min(dem[gj], bed + dd * 2.2);
            }
          }
        }
      }
    }
    // 标记 + 河口连通补全
    var riverIdx = new Int16Array(N).fill(-1);
    for (rv = 0; rv < riverList.length; rv++) {
      pts = riverList[rv].pts;
      for (i = 0; i < pts.length - 1; i++) {
        var ax = pts[i][0], ay = pts[i][1], bx = pts[i + 1][0], by = pts[i + 1][1];
        var steps = Math.ceil(Math.hypot(bx - ax, by - ay) * 2);
        for (var st = 0; st <= steps; st++) {
          var qx2 = Math.round(ax + (bx - ax) * st / steps), qy2 = Math.round(ay + (by - ay) * st / steps);
          if (qx2 >= 0 && qy2 >= 0 && qx2 < W && qy2 < H) river[qy2 * W + qx2] = 1, riverIdx[qy2 * W + qx2] = rv;
        }
      }
    }
    function mouthConnected(mx, my, self) {
      for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) {
        var nx = mx + dx, ny = my + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        var j4 = ny * W + nx;
        if (!territory[j4]) return true;
        if (river[j4] && riverIdx[j4] !== self) return true;
      }
      return false;
    }
    for (rv = 0; rv < riverList.length; rv++) {
      var tail = riverList[rv].pts[riverList[rv].pts.length - 1];
      var mx2 = Math.max(0, Math.min(W - 1, Math.round(tail[0]))), my2 = Math.max(0, Math.min(H - 1, Math.round(tail[1])));
      if (mouthConnected(mx2, my2, rv)) continue;
      var src2 = my2 * W + mx2;
      var prev2 = {}, q2 = [src2], qk2 = {}; qk2[src2] = 1;
      var found2 = -1;
      for (var qi2 = 0; qi2 < q2.length && found2 < 0; qi2++) {
        var cur2 = q2[qi2], cx2 = cur2 % W, cy2 = (cur2 / W) | 0;
        var nb2 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (var d4 = 0; d4 < 4; d4++) {
          var nx2 = cx2 + nb2[d4][0], ny2 = cy2 + nb2[d4][1];
          if (nx2 < 0 || ny2 < 0 || nx2 >= W || ny2 >= H) continue;
          var j5 = ny2 * W + nx2;
          if (qk2[j5]) continue;
          qk2[j5] = 1; prev2[j5] = cur2;
          if (!territory[j5] || (river[j5] && riverIdx[j5] !== rv)) { found2 = j5; break; }
          q2.push(j5);
        }
      }
      if (found2 >= 0) {
        var path2 = [], walk2 = found2;
        while (walk2 !== src2 && prev2[walk2] !== undefined) { path2.push(walk2); walk2 = prev2[walk2]; }
        path2.reverse();
        for (var pi4 = 0; pi4 < path2.length; pi4++) {
          var cell4 = path2[pi4];
          river[cell4] = 1; riverIdx[cell4] = rv;
          if (territory[cell4]) dem[cell4] = Math.min(dem[cell4], 2.5);
          riverList[rv].pts.push([(cell4 % W) + 0.5, ((cell4 / W) | 0) + 0.5]);
        }
      }
    }
    // 8) 不变量兜底：陆域 ≥1.2m，水域 ≤-1.2m；城镇锚点平台（穿镇河道暗渠化）
    for (i = 0; i < N; i++) {
      if (territory[i]) dem[i] = Math.max(dem[i], 1.2);
      else dem[i] = Math.min(dem[i], -1.2);
    }
    for (var tn = 0; tn < TOWNS.length; tn++) {
      var tw = TOWNS[tn];
      for (var ty = Math.max(0, tw.y - 1); ty <= Math.min(H - 1, tw.y + 1); ty++) {
        for (var tx = Math.max(0, tw.x - 1); tx <= Math.min(W - 1, tw.x + 1); tx++) {
          var gi0 = ty * W + tx;
          if (!territory[gi0]) continue;
          dem[gi0] = Math.max(dem[gi0], 2.5);
          river[gi0] = 0; // 穿镇河段按暗渠处理，避免镇心落在河格上
        }
      }
    }
    // 9) 掩膜派生
    var sea = new Uint8Array(N), bay = new Uint8Array(N), isle = new Uint8Array(N);
    for (i = 0; i < N; i++) {
      if (!territory[i]) { sea[i] = 1; if (inWedge(i % W, (i / W) | 0)) bay[i] = 1; }
    }
    // 岛屿：与主陆不连通的陆域格（4 邻接洪泛）
    var comp = new Int32Array(N).fill(-1);
    var comps = [];
    for (i = 0; i < N; i++) {
      if (!territory[i] || comp[i] >= 0) continue;
      var id = comps.length, cells = [], q2 = [i];
      comp[i] = id;
      while (q2.length) {
        var cur = q2.pop(); cells.push(cur);
        var cx = cur % W, cy = (cur / W) | 0;
        var nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (var d2 = 0; d2 < 4; d2++) {
          var nx = cx + nb[d2][0], ny = cy + nb[d2][1];
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          var j2 = ny * W + nx;
          if (territory[j2] && comp[j2] < 0) { comp[j2] = id; q2.push(j2); }
        }
      }
      comps.push(cells);
    }
    comps.sort(function (a, b) { return b.length - a.length; });
    for (var cc = 1; cc < comps.length; cc++) {
      if (comps[cc].length < 3) continue;
      for (var c3 = 0; c3 < comps[cc].length; c3++) isle[comps[cc][c3]] = 1;
    }
    // 海岸带（陆侧邻水）
    var coast = new Uint8Array(N);
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      var i7 = y * W + x;
      if (!territory[i7] || river[i7]) continue;
      var touch = false;
      for (yy = Math.max(0, y - 1); yy <= Math.min(H - 1, y + 1) && !touch; yy++)
        for (xx = Math.max(0, x - 1); xx <= Math.min(W - 1, x + 1) && !touch; xx++)
          if (!territory[yy * W + xx] || river[yy * W + xx]) touch = true;
      if (touch) coast[i7] = 1;
    }
    // 坡度
    var slope = new Float64Array(N);
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      var i8 = y * W + x;
      if (!territory[i8]) continue;
      var xl = Math.max(0, x - 1), xr = Math.min(W - 1, x + 1);
      var yu = Math.max(0, y - 1), yd = Math.min(H - 1, y + 1);
      var dzx = (dem[y * W + xr] - dem[y * W + xl]) / ((xr - xl) * CELL * 1000);
      var dzy = (dem[yd * W + x] - dem[yu * W + x]) / ((yd - yu) * CELL * 1000);
      slope[i8] = Math.atan(Math.hypot(dzx, dzy)) * 180 / Math.PI;
    }
    return {
      W: W, H: H, N: N, CELL: CELL, AREA: AREA, SEED: SEED,
      dem: dem, territory: territory, sea: sea, bay: bay, river: river,
      coast: coast, isle: isle, slope: slope,
      bayPts: BAY_PTS, rivers: riverList, bumps: BUMPS, islands: ISLANDS, towns: TOWNS,
      mulberry32: mulberry32,
      idx: function (x, y) { return y * W + x; },
      elevAt: function (x, y) { return dem[y * W + x]; },
      slopeAt: function (x, y) { return slope[y * W + x]; }
    };
  }

  var T = buildTerrain();
  var landCells = 0;
  for (i = 0; i < N; i++) if (territory[i]) landCells++;

  var api = {
    W: T.W, H: T.H, N: T.N, CELL: T.CELL, AREA: T.AREA, SEED: T.SEED,
    realDEM: !!R,
    dem: T.dem, territory: T.territory, sea: T.sea, bay: T.bay, river: T.river,
    coast: T.coast, isle: T.isle, slope: T.slope,
    towns: T.towns, rivers: T.rivers, bayPts: T.bayPts, islands: T.islands, bumps: T.bumps,
    landCells: landCells,
    idx: T.idx, elevAt: T.elevAt, slopeAt: T.slopeAt, mulberry32: T.mulberry32,
    bayT: bayT, inWedge: inWedge,
    nameOf: function (x, y) {
      var best = null, bd = 1e9;
      for (var k = 0; k < T.towns.length; k++) {
        var t = T.towns[k], d = Math.hypot(x - t.x, y - t.y);
        if (d < bd) { bd = d; best = t.name; }
      }
      return bd < 8 ? best : '乡野';
    }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FDTerrain = api;
})(typeof self !== 'undefined' ? self : this);
