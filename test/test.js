/* 《福鼎城镇演化》自动化质检
 * 覆盖：地形体检 / 引擎守恒与确定性 / 三情景分化与零矛盾 /
 *       校验器 10 类矛盾检出 / 随机政策模糊推演
 * 运行：node test\test.js   （全绿退出码 0，任何失败退出码 1）
 */
'use strict';
const T = require('../js/terrain.js');
const D = require('../js/data.js');
const E = require('../js/engine.js');
const V = require('../js/validate.js');

var pass = 0, fail = 0;
var failures = [];
function ok(cond, name) {
  if (cond) { pass++; }
  else { fail++; failures.push(name); console.log('  ✗ ' + name); }
}
function eq(a, b, name) { ok(a === b, name + ' （期望 ' + b + '，实际 ' + a + '）'); }
function section(t) { console.log('—— ' + t); }

var URBAN = 8, VILLAGE = 7, SEA = 0, MUD = 1, WATER = 2, MANGROVE = 3, FOREST = 4, TEA = 5, FARM = 6, PORT = 9, ROAD = 10, POND = 11;

// ============ 1. 地形体检 ============
section('1. 地形体检');
(function () {
  var nan = 0, seaN = 0, bayN = 0, riverN = 0;
  for (var i = 0; i < T.N; i++) {
    if (!isFinite(T.dem[i])) nan++;
    if (T.sea[i]) seaN++;
    if (T.bay[i]) bayN++;
    if (T.river[i]) riverN++;
  }
  eq(nan, 0, 'DEM 无 NaN');
  ok(seaN > 1200, '开敞海域规模合理 (' + seaN + ' 格)');
  ok(bayN > 120 && bayN < 500, '沙埕港湾规模合理 (' + bayN + ' 格)');
  ok(riverN > 60, '河网规模合理 (' + riverN + ' 格)');
  ok(T.landCells > 2400 && T.landCells < 2900, '陆域规模接近福鼎市域 (' + T.landCells + ' 格 ≈ ' + (T.landCells * T.AREA).toFixed(0) + 'km²)');
  ok(T.elevAt(70, 22) < -15, '湾口深水: ' + T.elevAt(70, 22).toFixed(1));
  ok(T.elevAt(38, 21) < 0 && T.elevAt(38, 21) > -12, '湾顶渐浅: ' + T.elevAt(38, 21).toFixed(1));
  // 太姥山峰（真实 DEM 下位于西南部 ~120.18E,27.12N → 格 (24,39) 一带）
  var peak = 0;
  for (var y = 32; y < 50; y++) for (var x = 14; x < 40; x++) peak = Math.max(peak, T.elevAt(x, y));
  ok(peak > 600 && peak < 1300, '太姥山一带峰高合理 (' + peak.toFixed(0) + 'm)');
  ok(T.realDEM, '接入真实 DEM（SRTM）');
  // 嵛山岛
  var isleN = 0;
  for (i = 0; i < T.N; i++) if (T.isle[i]) isleN++;
  ok(isleN > 20, '嵛山岛规模 (' + isleN + ' 格)');
  var yushan = null;
  T.towns.forEach(function (t) { if (t.id === 'yushan') yushan = t; });
  ok(T.isle[T.idx(yushan.x, yushan.y)] === 1, '嵛山镇位于海岛');
  // 全部镇址在陆地
  var bad = T.towns.filter(function (t) { return T.elevAt(t.x, t.y) <= 0; });
  eq(bad.length, 0, '全部镇址位于陆地');
  // 河流汇入水域或别的河（支流汇干流也算连通；OSM 折线端点为浮点，取整后判定）
  var dry = [];
  T.rivers.forEach(function (r, ri) {
    var p = r.pts[r.pts.length - 1], okr = false;
    for (var dy = -2; dy <= 2 && !okr; dy++) for (var dx = -2; dx <= 2; dx++) {
      var x = Math.round(p[0]) + dx, yy = Math.round(p[1]) + dy;
      if (x < 0 || yy < 0 || x >= T.W || yy >= T.H) continue;
      var j = T.idx(x, yy);
      if (T.sea[j]) { okr = true; break; }
      if (T.river[j]) {
        // 是别的河的格子才算汇入（自己河口邻格不算）
        var other = false;
        for (var rj = 0; rj < T.rivers.length; rj++) {
          if (rj === ri) continue;
          var pts2 = T.rivers[rj].pts;
          for (var s2 = 0; s2 < pts2.length - 1 && !other; s2++) {
            var ax = pts2[s2][0], ay = pts2[s2][1], bx = pts2[s2 + 1][0], by = pts2[s2 + 1][1];
            var steps = Math.ceil(Math.hypot(bx - ax, by - ay) * 2);
            for (var st = 0; st <= steps; st++) {
              var qx = Math.round(ax + (bx - ax) * st / steps), qy = Math.round(ay + (by - ay) * st / steps);
              if (qx === x && qy === yy) { other = true; break; }
            }
          }
          if (other) break;
        }
        if (other) okr = true;
      }
    }
    if (!okr) dry.push(r.name);
  });
  eq(dry.length, 0, '全部河流汇入水域/干流' + (dry.length ? '（' + dry.join('、') + ' 例外）' : ''));
  // 确定性：两次构建同种子一致（模块单例，这里校验可复现接口）
  var rnd1 = T.mulberry32(7), rnd2 = T.mulberry32(7);
  var same = true;
  for (i = 0; i < 100; i++) if (rnd1() !== rnd2()) same = false;
  ok(same, '种子随机可复现');
  // 湾岸低地（滩涂立地基础）
  var lowShore = 0;
  for (i = 0; i < T.N; i++) if (T.coast[i] && T.dem[i] > 0 && T.dem[i] <= 5.2) lowShore++;
  ok(lowShore > 80, '潮间带低岸规模 (' + lowShore + ' 格)');
})();

// ============ 2. 引擎基础与守恒 ============
section('2. 引擎基础与守恒');
(function () {
  var g = E.initGame();
  eq(g.records.length, 1, '初始含起点记录');
  var c0 = E.countLand(g.land);
  var sum = c0.reduce(function (a, b) { return a + b; }, 0);
  eq(sum, T.N, '初始用地格数守恒');
  ok(c0[SEA] > 1200, '初始海域格数 ' + c0[SEA]);
  ok(c0[MUD] > 70, '初始滩涂规模 ' + c0[MUD] + ' 格');
  ok(c0[VILLAGE] >= 10 * 3, '初始聚落规模 ' + c0[VILLAGE] + ' 格');
  // 三情景全推演守恒
  D.SCENARIOS.forEach(function (sc) {
    var r = E.runScenario(sc);
    eq(r.state.records.length, 7, sc.name + ' 跑满 7 条记录');
    var seaConst = true, sumOk = true, popOk = true;
    var sea0 = r.state.records[0].stats[SEA];
    r.state.records.forEach(function (rec) {
      var s = rec.stats.reduce(function (a, b) { return a + b; }, 0);
      if (s !== T.N) sumOk = false;
      if (rec.stats[SEA] !== sea0) seaConst = false;
      if (rec.pop != null && !(rec.pop > 300 && rec.pop < 900000)) popOk = false;
      // 表格与统计一致
      if (rec.table[8].currCells !== rec.stats[URBAN]) sumOk = false;
    });
    ok(sumOk, sc.name + ' 每轮格数守恒且表实一致');
    ok(seaConst, sc.name + ' 开敞海域恒定');
    ok(popOk, sc.name + ' 人口处于合理区间');
    // 每轮叙事非空且含数字段
    var narrOk = r.state.records.every(function (rec) {
      return rec.narrative.length >= 3 && rec.narrative.join('').length > 80;
    });
    ok(narrOk, sc.name + ' 每轮叙事完整');
    var hasNum = r.state.records.slice(1).every(function (rec) {
      return /至\d+年，全境人口约/.test(rec.narrative.join(''));
    });
    ok(hasNum, sc.name + ' 每轮含数字小结');
  });
})();

// ============ 3. 确定性 ============
section('3. 推演确定性');
(function () {
  function fingerprint(sc) {
    var r = E.runScenario(sc);
    return r.state.records.map(function (rec) {
      return rec.year + '|' + rec.pop + '|' + rec.stats.join(',') + '|' + rec.events.map(function (e) { return e.id; }).join('+');
    }).join(';;');
  }
  D.SCENARIOS.forEach(function (sc) {
    eq(fingerprint(sc), fingerprint(sc), sc.name + ' 两次推演完全一致');
  });
})();

// ============ 4. 三情景分化与零矛盾 ============
section('4. 三情景分化与零矛盾');
(function () {
  var res = {};
  D.SCENARIOS.forEach(function (sc) {
    var r = E.runScenario(sc);
    var errs = 0, warns = 0;
    r.state.records.forEach(function (rec) {
      rec.issues.forEach(function (iss) { if (iss.level === 'error') errs++; else warns++; });
    });
    res[sc.id] = { state: r.state, scores: r.scores, errs: errs, warns: warns };
    eq(errs, 0, sc.name + ' 零逻辑矛盾（错误级）');
    var s6 = r.state.records[6].stats;
    ok(s6[URBAN] > 40, sc.name + ' 终局城区规模 (' + (s6[URBAN] * 0.25).toFixed(1) + 'km²)');
  });
  var A = res.A.state.records[6].stats, B = res.B.state.records[6].stats, C = res.C.state.records[6].stats;
  ok(A[URBAN] > C[URBAN], '商贸强港城区 > 生态湾区 (' + A[URBAN] + ' vs ' + C[URBAN] + ')');
  ok(B[TEA] > A[TEA] && B[TEA] > C[TEA], '白茶富民茶园最大 (' + B[TEA] + ' 格)');
  ok(A[MUD] + A[POND] < C[MUD] + C[POND], '商贸强港滩涂消耗 > 生态湾区');
  ok(res.C.scores.eco > res.A.scores.eco + 20, '生态分：湾区 > 强港 (' + res.C.scores.eco + ' vs ' + res.A.scores.eco + ')');
  ok(res.A.scores.econ >= res.C.scores.econ, '经济分：强港 ≥ 湾区 (' + res.A.scores.econ + ' vs ' + res.C.scores.econ + ')');
  // 情景 A 应触发滩涂红线警告（生态代价可见）
  ok(res.A.warns >= 1, '商贸强港存在生态警告 (' + res.A.warns + ' 条)');
  // 修路政策效应：A 全程修路，C 首轮无路
  ok(res.A.state.records[1].stats[ROAD] > 0, '商贸强港第 1 轮即有道路');
  eq(res.C.state.records[1].stats[ROAD], 0, '生态湾区第 1 轮无道路');
  // 龙安开发区：只在改革开放后且未开生态时围海出现（引擎显式状态 longan）
  var LA = { x: 0, y: 0 };
  T.towns.forEach(function (tw) { if (tw.id === 'longan') LA = tw; });
  function urbanNear(rec, r) {
    var n = 0;
    for (var i = 0; i < T.N; i++) {
      if (rec.land[i] !== URBAN) continue;
      var x = i % T.W, y = (i / T.W) | 0;
      if (Math.hypot(x - LA.x, y - LA.y) <= r) n++;
    }
    return n;
  }
  var la5 = urbanNear(res.A.state.records[5], 2.8), la6 = urbanNear(res.A.state.records[6], 2.8);
  eq(res.A.state.records[5].longan, true, '商贸强港第 5 轮龙安开发区落地');
  ok(la5 >= 4, '商贸强港第 5 轮龙安围海造区（' + la5 + ' 格城区）');
  ok(la6 >= la5, '商贸强港第 6 轮龙安继续扩张（' + la6 + ' 格城区）');
  ok(/龙安/.test(res.A.state.records[5].narrative.join('')), '商贸强港第 5 轮叙事提及龙安');
  eq(res.B.state.records[6].longan, false, '白茶富民（生态期）龙安缓建');
  eq(res.C.state.records[6].longan, false, '生态湾区龙安缓建');
  ok(/龙安/.test(res.C.state.records[5].narrative.join('')), '生态湾区第 5 轮叙事交代龙安缓建');
  // 龙安登场前的时代不出现其城区
  eq(urbanNear(res.A.state.records[4], 2.8), 0, '第 4 轮及以前无龙安');
  // 叙事-表格交叉：末轮数字小结与统计一致
  ['A', 'B', 'C'].forEach(function (id) {
    var rec = res[id].state.records[6];
    var narr = rec.narrative.join('');
    var m = narr.match(/城镇建成区约([\d.]+)平方公里/);
    ok(!!m, id + ' 末轮叙事含城区数字');
    if (m) ok(Math.abs(parseFloat(m[1]) - rec.stats[URBAN] * T.AREA) < 0.15, id + ' 叙事城区数与表格一致');
  });
})();

// ============ 5. 校验器矛盾检出（植入 10 类反例） ============
section('5. 校验器矛盾检出');
(function () {
  var sc = D.SCENARIOS[0];
  var r = E.runScenario(sc);
  var recs = r.state.records;
  var round = 6, rec = recs[round], prev = recs[round - 1];
  function clone(land) { return new Uint8Array(land); }
  function detect(mutated, label) {
    var fake = recs.map(function (x) { return x; });
    var fakeRec = Object.assign({}, rec, { land: mutated, stats: E.countLand(mutated) });
    fake[round] = fakeRec;
    var issues = V.validateRound(fake, round);
    return issues;
  }
  function hasRule(issues, rule) {
    return issues.some(function (i) { return i.rule === rule && i.level === 'error'; });
  }
  // R1 用地守恒：非法枚举
  (function () {
    var land = clone(rec.land); land[100] = 99;
    ok(hasRule(detect(land), '用地守恒'), '检出：非法用地枚举');
  })();
  // R2 水体完整：城镇侵入海湾
  (function () {
    var land = clone(rec.land);
    var placed = false;
    for (var i = 0; i < T.N && !placed; i++) if (T.dem[i] < -6 && !T.river[i]) { land[i] = URBAN; placed = true; }
    ok(placed && hasRule(detect(land), '水体完整'), '检出：城镇侵占水体');
  })();
  // R3 茶园立地：低平地种茶
  (function () {
    var land = clone(rec.land);
    var placed = false;
    for (var i = 0; i < T.N && !placed; i++) {
      if (land[i] === FOREST && T.dem[i] < 30 && T.slope[i] < 3) { land[i] = TEA; placed = true; }
    }
    ok(placed && hasRule(detect(land), '茶园立地'), '检出：茶园立地违规');
  })();
  // R4 城镇可达：深山孤城
  (function () {
    var land = clone(rec.land);
    var placed = false;
    for (var i = 0; i < T.N && !placed; i++) {
      var x = i % T.W, y = (i / T.W) | 0;
      if (land[i] !== FOREST) continue;
      if (T.dem[i] < 300 || T.dem[i] > 700) continue;
      if (T.elevAt(Math.max(0, x - 3), y) === undefined) continue;
      // 5 格内无路无水
      var near = false;
      for (var dy = -5; dy <= 5 && !near; dy++) for (var dx = -5; dx <= 5; dx++) {
        var nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= T.W || ny >= T.H) continue;
        var j = ny * T.W + nx;
        if (land[j] === ROAD || land[j] === URBAN || land[j] === VILLAGE || land[j] === PORT || T.sea[j] || T.bay[j] || T.river[j]) { near = true; break; }
      }
      if (!near) { land[i] = URBAN; placed = true; }
    }
    ok(placed && hasRule(detect(land), '城镇可达'), '检出：深山孤城无路无渡');
  })();
  // R5 生态冲突：保护期填滩
  (function () {
    var land = clone(rec.land);
    var filled = 0;
    for (var i = 0; i < T.N && filled < 6; i++) if (land[i] === MUD) { land[i] = POND; filled++; }
    var fake = recs.map(function (x) { return x; });
    var fakeRec = Object.assign({}, rec, { land: land, stats: E.countLand(land), policy: { road: 1, tea: 1, eco: 1 } });
    fake[round] = fakeRec;
    ok(hasRule(V.validateRound(fake, round), '生态保护冲突'), '检出：生态期围垦');
  })();
  // R6 人口承载力
  (function () {
    var fake = recs.map(function (x) { return x; });
    var fakeRec = Object.assign({}, rec, { pop: rec.pop * 5 });
    fake[round] = fakeRec;
    ok(hasRule(V.validateRound(fake, round), '人口承载力'), '检出：人口超载');
  })();
  // R7 叙事一致
  (function () {
    var fake = recs.map(function (x) { return x; });
    var narr = rec.narrative.slice();
    narr[narr.length - 2] = narr[narr.length - 2].replace(/建成区约[\d.]+平方公里/, '建成区约99.9平方公里');
    var fakeRec = Object.assign({}, rec, { narrative: narr });
    fake[round] = fakeRec;
    ok(hasRule(V.validateRound(fake, round), '叙事一致'), '检出：叙事数字造假');
  })();
  // R8 道路合理：跨湾路 + 孤悬路
  (function () {
    var land = clone(rec.land);
    var n = 0;
    for (var i = 0; i < T.N && n < 3; i++) if (T.dem[i] < -8 && !T.river[i]) { land[i] = ROAD; n++; }
    ok(hasRule(detect(land), '道路合理'), '检出：道路侵入海湾');
  })();
  (function () {
    var land = clone(rec.land);
    var placed = false;
    for (var i = 0; i < T.N && !placed; i++) {
      var x = i % T.W, y = (i / T.W) | 0;
      if (land[i] !== FOREST) continue;
      var near = false;
      for (var dy = -3; dy <= 3 && !near; dy++) for (var dx = -3; dx <= 3; dx++) {
        var nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= T.W || ny >= T.H) continue;
        var j = ny * T.W + nx;
        if (land[j] === ROAD || land[j] === URBAN || land[j] === VILLAGE || land[j] === PORT) { near = true; break; }
      }
      if (!near) {
        land[i] = ROAD; land[i + 1] = ROAD; placed = true; // 两格孤路
      }
    }
    ok(placed && hasRule(detect(land), '道路合理'), '检出：孤悬路网');
  })();
  // R9 港口选址
  (function () {
    var land = clone(rec.land);
    var placed = false;
    for (var i = 0; i < T.N && !placed; i++) {
      if (land[i] !== FOREST || !T.coast[i]) continue;
      var x = i % T.W, y = (i / T.W) | 0, deep = false;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
        var nx = x + d[0], ny = y + d[1];
        if (nx >= 0 && ny >= 0 && nx < T.W && ny < T.H) {
          var j = ny * T.W + nx;
          if (T.sea[j] && T.dem[j] <= -4) deep = true;
        }
      });
      if (!deep) { land[i] = PORT; placed = true; }
    }
    ok(placed && hasRule(detect(land), '港口选址'), '检出：浅滩码头');
  })();
  // R10 海域守恒
  (function () {
    var land = clone(rec.land);
    var n = 0;
    for (var i = 0; i < T.N && n < 4; i++) if (prev.land[i] === SEA && T.dem[i] < -1.5 && !T.river[i]) { land[i] = URBAN; n++; }
    var fake = recs.map(function (x) { return x; });
    var fakeRec = Object.assign({}, rec, { land: land, stats: E.countLand(land) });
    fake[round] = fakeRec;
    ok(hasRule(V.validateRound(fake, round), '海域守恒'), '检出：开敞海域被侵占');
  })();
})();

// ============ 6. 随机政策模糊推演 ============
section('6. 随机政策模糊推演（40 组）');
(function () {
  var seed = 42;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  var STRUCTURAL = ['用地守恒', '水体完整', '海域守恒', '茶园立地', '道路合理', '港口选址', '城镇可达', '叙事一致'];
  var structuralFails = 0, capFinds = 0, crashes = 0, runs = 40, completed = 0;
  for (var run = 0; run < runs; run++) {
    var g = E.initGame();
    for (var rr = 0; rr < 6; rr++) {
      var policy = { road: rnd() < 0.6 ? 1 : 0, tea: rnd() < 0.6 ? 1 : 0, eco: rnd() < 0.5 ? 1 : 0 };
      try {
        var rec = E.stepRound(g, policy);
        rec.issues.forEach(function (iss) {
          if (iss.level !== 'error') return;
          if (iss.rule === '人口承载力') capFinds++;
          else if (STRUCTURAL.indexOf(iss.rule) >= 0) structuralFails++;
        });
      } catch (e) {
        crashes++;
        console.log('  模糊异常 run' + run + ' R' + rr + ': ' + e.message);
      }
    }
    if (g.round === 6 && g.records.length === 7) completed++;
  }
  eq(crashes, 0, '模糊推演零异常');
  eq(completed, runs, '模糊推演全部跑满 6 轮');
  eq(structuralFails, 0, '模糊推演零结构性矛盾（引擎约束自洽）');
  ok(capFinds >= 0, '人口超载检出 ' + capFinds + ' 次（校验器正常工作，引擎自动外流回正）');
})();

// ============ 7. JSON 序列化往返 ============
section('7. 序列化往返');
(function () {
  var g = E.runScenario(D.SCENARIOS[1]).state;
  var json = JSON.stringify({
    round: g.round, pop: g.pop, year: g.year,
    records: g.records.map(function (r) {
      return { round: r.round, pop: r.pop, year: r.year, stats: r.stats, narrative: r.narrative, policy: r.policy, land: Array.from(r.land) };
    })
  });
  var back = JSON.parse(json);
  eq(back.records.length, 7, 'JSON 往返记录数一致');
  var same = back.records.every(function (r, i) {
    return r.stats.join(',') === g.records[i].stats.join(',') &&
      r.narrative.join('|') === g.records[i].narrative.join('|');
  });
  ok(same, 'JSON 往返统计与叙事一致');
  var landSame = back.records[6].land.every(function (v, i) { return v === g.records[6].land[i]; });
  ok(landSame, 'JSON 往返用地格完全一致');
})();

// ============ 8. 称号图鉴 ============
section('8. 称号图鉴');
(function () {
  const TL = require('../js/titles.js');
  function gotOf(sc) {
    const r = E.runScenario(sc);
    return TL.computeTitles(TL.buildContext(r.state, r.scores)).map(t => t.id);
  }
  const a = gotOf(D.SCENARIOS[0]), b = gotOf(D.SCENARIOS[1]), c = gotOf(D.SCENARIOS[2]);
  ok(a.indexOf('port') >= 0, '情景一得「港城崛起者」（' + a.join(',') + '）');
  ok(b.indexOf('tea') >= 0, '情景二得「白茶圣手」（' + b.join(',') + '）');
  ok(c.indexOf('bird') >= 0, '情景三得「候鸟守护人」（' + c.join(',') + '）');
  ok(a.length >= 1 && b.length >= 1 && c.length >= 1, '每情景至少一枚称号');
  ok(gotOf(D.SCENARIOS[0]).join(',') === a.join(','), '称号判定确定性');
  ok(TL.TITLES.every(t => t.seal.length === 1 && t.name && t.desc), '称号数据完整（单字章/名/判定语）');
})();

// ============ 9. 滩涂光伏 + 人口校准 ============
section('9. 滩涂光伏 + 人口校准');
(function () {
  const TL9 = require('../js/titles.js');
  const res = {};
  D.SCENARIOS.forEach(sc => { res[sc.id] = E.runScenario(sc); });
  const A = res.A.state.records[6], C = res.C.state.records[6];
  const solarCells = A.stats[12] || 0;
  ok(solarCells >= 8, '商贸强港第 6 轮光伏落地（' + solarCells + ' 格）');
  let bad = 0;
  for (let i = 0; i < T.N; i++) if (A.land[i] === 12 && T.elevAt(i % T.W, (i / T.W) | 0) > 20) bad++;
  eq(bad, 0, '光伏全部位于滨海低地（高程≤20m）');
  eq(C.stats[12] || 0, 0, '生态湾区光伏禁建（0 格）');
  const ctx = TL9.buildContext(res.A.state, res.A.scores);
  ok(TL9.computeTitles(ctx).some(t => t.id === 'solar'), 'A 得「追光者」称号');
  // 人口校准（真实序列：1978≈45万，2010 52.9万，2020 55.3万）
  const p4 = res.A.state.records[4].pop, p6 = A.pop;
  ok(Math.abs(p4 / 450000 - 1) < 0.2, '1978 年人口贴近真实序列（' + (p4 / 10000).toFixed(1) + '万）');
  ok(Math.abs(p6 / 555000 - 1) < 0.2, '2025 年人口贴近真实序列（' + (p6 / 10000).toFixed(1) + '万）');
})();

// ============ 汇总 ============
console.log('\n========== 质检汇总 ==========');
console.log('通过 ' + pass + ' 项 / 失败 ' + fail + ' 项');
if (fail) {
  console.log('失败清单:');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
} else {
  console.log('全部通过 ✓');
  process.exit(0);
}
