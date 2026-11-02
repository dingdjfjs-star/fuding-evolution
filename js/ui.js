/* 《福鼎城镇演化》浏览器壳：时间轴 / 情景与政策 / 叙事 / 校验 / 表格 / 三维联动
 * 仅操作 DOM 与引擎暴露的纯数据
 */
'use strict';
(function () {
  var D = window.FDData, E = window.FDEngine, V = window.FDValidate, T = window.FDTerrain, TL = window.FDTitles;
  var $ = function (id) { return document.getElementById(id); };

  var game = E.initGame();
  var viewIdx = 0;          // 当前展示的轮次（可回看）
  var scenario = null;      // null = 自由推演
  var autoTimer = null;
  var view3d = null;
  var playing = false, playCancel = false;

  // ---------- 称号收集（localStorage 跨推演图鉴） ----------
  function loadCollection() {
    try { return JSON.parse(localStorage.getItem('fd-titles') || '[]'); } catch (e) { return []; }
  }
  function collectTitles(state, scores, scenarioId) {
    if (!TL) return [];
    var ctx = TL.buildContext(state, scores);
    ctx.scenarioId = scenarioId;
    var got = TL.computeTitles(ctx);
    var col = loadCollection(), added = false;
    got.forEach(function (t) { if (col.indexOf(t.id) < 0) { col.push(t.id); added = true; } });
    if (added) { try { localStorage.setItem('fd-titles', JSON.stringify(col)); } catch (e) { } }
    return got;
  }
  function openTitleModal() {
    if (!TL) return;
    var col = loadCollection();
    $('titleHead').textContent = '称号图鉴 · 已集 ' + col.length + ' / ' + TL.TITLES.length;
    $('titleGrid').innerHTML = TL.TITLES.map(function (t) {
      var got = col.indexOf(t.id) >= 0;
      return '<div class="title-card' + (got ? ' got' : '') + '">' +
        '<span class="tseal big">' + t.seal + '</span>' +
        '<div class="ttxt"><b>' + t.name + '</b><p>' + (got ? t.desc : '尚未达成——' + t.desc) + '</p></div></div>';
    }).join('');
    $('titleModal').classList.add('show');
  }

  // ---------- 时间轴 ----------
  function renderTimeline() {
    var el = $('timeline');
    el.innerHTML = '';
    D.ERAS.forEach(function (era, i) {
      var dot = document.createElement('div');
      dot.className = 'era-dot' + (i <= viewIdx ? ' past' : '') + (i === viewIdx ? ' now' : '');
      dot.innerHTML = '<span class="era-year">' + era.year + '</span><span class="era-name">' + era.label.split(' · ')[1] + '</span>';
      dot.title = era.label;
      if (i <= game.round) dot.onclick = function () { if (playing) return; viewIdx = i; renderAll(); };
      else dot.classList.add('lock');
      el.appendChild(dot);
    });
  }

  // ---------- 叙事 ----------
  function renderNarrative() {
    var rec = game.records[viewIdx];
    var el = $('narrative');
    var head = '<div class="narr-head"><span class="narr-era">' + rec.eraLabel + '</span>' +
      '<span class="narr-year">公元 ' + rec.year + ' 年</span></div>';
    el.innerHTML = head + rec.narrative.map(function (p) { return '<p>' + p + '</p>'; }).join('');
  }

  // ---------- 校验面板 ----------
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function renderValidation() {
    var rec = game.records[viewIdx];
    var el = $('validation');
    var errs = rec.issues.filter(function (i) { return i.level === 'error'; });
    var warns = rec.issues.filter(function (i) { return i.level === 'warn'; });
    var total = 0, tw = 0;
    game.records.forEach(function (r) {
      total += r.issues.filter(function (i) { return i.level === 'error'; }).length;
      tw += r.issues.filter(function (i) { return i.level === 'warn'; }).length;
    });
    var html = '<div class="val-head"><b>逻辑矛盾自检</b>' +
      '<span class="val-sum">历史累计：' + total + ' 错误 · ' + tw + ' 警告</span></div>';
    if (!errs.length && !warns.length) {
      html += '<div class="val-ok">✓ 本轮推演未发现逻辑矛盾</div>';
    } else {
      errs.concat(warns).forEach(function (iss) {
        html += '<div class="val-item ' + iss.level + '"><span class="val-tag">' + (iss.level === 'error' ? '矛盾' : '警告') + '</span>' +
          '<b>' + esc(iss.rule) + '</b>：' + esc(iss.msg) + '</div>';
      });
    }
    el.innerHTML = html;
  }

  // ---------- 土地利用变化表 ----------
  function renderTable() {
    var rec = game.records[viewIdx];
    var el = $('tableBox');
    var rows = '<tr><th>用地类型</th><th>上轮 km²</th><th>本轮 km²</th><th>变化 km²</th><th>变化格</th></tr>';
    rec.table.forEach(function (row) {
      var d = row.delta;
      var dTxt = d > 0 ? '+' + d : String(d);
      var cls = d > 0 ? 'up' : (d < 0 ? 'down' : '');
      rows += '<tr><td><i class="sw" style="background:' + D.LAND[row.id].css + '"></i>' + row.name + '</td>' +
        '<td>' + row.prevKm2.toFixed(1) + '</td><td>' + row.currKm2.toFixed(1) + '</td>' +
        '<td class="' + cls + '">' + row.deltaKm2.toFixed(1) + '</td>' +
        '<td class="' + cls + '">' + dTxt + '</td></tr>';
    });
    var sumP = 0, sumC = 0;
    rec.table.forEach(function (row) { sumP += row.prevCells; sumC += row.currCells; });
    rows += '<tr class="total"><td>合计（格数守恒校验）</td><td colspan="2">' + (sumP * 0.25).toFixed(1) + ' → ' + (sumC * 0.25).toFixed(1) + ' km²</td>' +
      '<td colspan="2">' + sumP + ' → ' + sumC + ' 格</td></tr>';
    el.innerHTML = '<div class="tbl-head"><b>土地利用变化表</b><span>' +
      (viewIdx === 0 ? '初始状态' : '第 ' + viewIdx + ' 轮推演') + '</span></div>' +
      '<div class="tbl-scroll"><table>' + rows + '</table></div>';
  }

  // ---------- 局势条 ----------
  function renderStats() {
    var rec = game.records[viewIdx];
    var s = rec.stats;
    var cap = D.capacityOf(s);
    $('stYear').textContent = rec.year + ' 年';
    $('stEra').textContent = rec.eraLabel;
    $('stPop').textContent = rec.pop != null ? D.fmtWan(rec.pop) : '—';
    $('stUrban').textContent = (s[8] * T.AREA).toFixed(1) + ' km²';
    $('stTea').textContent = (s[5] * T.AREA).toFixed(1) + ' km²';
    $('stMud').textContent = (s[1] * T.AREA).toFixed(1) + ' km²';
    $('stRoad').textContent = (s[10] * T.CELL).toFixed(1) + ' km';
    var ratio = rec.pop ? rec.pop / cap : 0;
    var bar = $('capBar');
    bar.style.width = Math.min(100, ratio * 100) + '%';
    bar.style.background = ratio > 1 ? '#d9534f' : (ratio > 0.9 ? '#e0a54a' : '#5aa469');
    $('capTxt').textContent = '承载力 ' + Math.round(cap / 10000 * 10) / 10 + ' 万 · ' + Math.round(ratio * 100) + '%';
    // 终评 + 称号
    var fin = $('finalStrip');
    if (rec.round === 6) {
      var sc = E.finalScores(game);
      var got = collectTitles(game, sc, scenario ? scenario.id : 'free');
      fin.style.display = 'block';
      fin.innerHTML = '<b>推演终评（' + (scenario ? scenario.name : '自由推演') + '）</b>' +
        '<span>经济 ' + sc.econ + '</span><span>生态 ' + sc.eco + '</span><span>民生 ' + sc.living + '</span>' +
        '<span class="fin-total">综合 ' + sc.total + '</span>' +
        '<span class="fin-title"><i class="tseal">' + got[0].seal + '</i> ' + got[0].name + '</span>';
    } else fin.style.display = 'none';
  }

  // ---------- 控制面板 ----------
  function renderControls() {
    // 情景卡
    var box = $('scenBox');
    if (!box.dataset.built) {
      var cards = [{ id: 'free', name: '自由推演', tag: '自己当主官', desc: '每轮自行切换三项政策，试试能不能既富民又不塌方。' }]
        .concat(D.SCENARIOS);
      box.innerHTML = cards.map(function (sc) {
        return '<div class="scen-card" data-id="' + sc.id + '"><b>' + sc.name + '</b><i>' + sc.tag + '</i><p>' + sc.desc + '</p></div>';
      }).join('');
      Array.prototype.forEach.call(box.querySelectorAll('.scen-card'), function (card) {
        card.onclick = function () { pickScenario(card.dataset.id); };
      });
      box.dataset.built = '1';
    }
    Array.prototype.forEach.call(box.querySelectorAll('.scen-card'), function (card) {
      var on = scenario ? card.dataset.id === scenario.id : card.dataset.id === 'free';
      card.classList.toggle('on', on);
    });
    // 政策开关
    var pol = $('policyBox');
    var rec = game.records[viewIdx];
    var nextPolicy = null;
    if (scenario && game.round < 6) nextPolicy = scenario.policy[game.round];
    else if (scenario && game.round >= 6) nextPolicy = null;
    pol.innerHTML = D.POLICIES.map(function (p, i) {
      var on;
      if (nextPolicy) on = !!nextPolicy[p.id];
      else on = viewIdx > 0 && rec.policy ? !!rec.policy[p.id] : false;
      return '<label class="pol' + (on ? ' on' : '') + (nextPolicy ? ' fixed' : '') + '">' +
        '<input type="checkbox" data-pol="' + p.id + '"' + (on ? ' checked' : '') + (nextPolicy ? ' disabled' : '') + '>' +
        '<span class="pol-ico">' + p.icon + '</span><span><b>' + p.name + '</b>' +
        '<small>' + (nextPolicy ? (on ? '本轮：开' : '本轮：关') : p.short) + '</small></span></label>';
    }).join('');
    if (!nextPolicy) {
      Array.prototype.forEach.call(pol.querySelectorAll('input[data-pol]'), function (cb) {
        cb.onchange = function () { renderControls(); };
      });
    }
    // 按钮态
    $('btnStep').disabled = game.round >= 6;
    $('btnAuto').disabled = game.round >= 6;
    $('btnStep').textContent = game.round >= 6 ? '推演完成' : '推进一轮 ▶';
    $('scenHint').textContent = scenario
      ? '已载入「' + scenario.name + '」：每轮自动按情景切换政策'
      : '自由推演：勾选政策后推进（可随时切换）';
  }

  function readFreePolicy() {
    var p = { road: 0, tea: 0, eco: 0 };
    Array.prototype.forEach.call(document.querySelectorAll('input[data-pol]'), function (cb) {
      if (cb.checked) p[cb.dataset.pol] = 1;
    });
    return p;
  }

  function pickScenario(id) {
    if (id === 'free') scenario = null;
    else scenario = D.SCENARIOS.filter(function (s) { return s.id === id; })[0] || null;
    resetGame();
  }

  // ---------- 主流程 ----------
  function stepOnce() {
    if (game.round >= 6) return;
    var policy = scenario ? scenario.policy[game.round] : readFreePolicy();
    E.stepRound(game, policy);
    viewIdx = game.records.length - 1;
    renderAll();
  }
  function toggleAuto() {
    if (autoTimer) {
      clearInterval(autoTimer); autoTimer = null;
      $('btnAuto').textContent = '自动推演 ⏩';
      return;
    }
    $('btnAuto').textContent = '暂停 ⏸';
    autoTimer = setInterval(function () {
      if (game.round >= 6) { toggleAuto(); return; }
      stepOnce();
    }, 1500);
  }
  function resetGame() {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; $('btnAuto').textContent = '自动推演 ⏩'; }
    if (playing) { playCancel = true; }
    game = E.initGame();
    viewIdx = 0;
    renderAll();
  }

  // ---------- 逐年回放动画 ----------
  function setPlayUI(on) {
    $('btnStep').disabled = on || game.round >= 6;
    $('btnAuto').disabled = on || game.round >= 6;
    $('btnReset').disabled = on;
    $('btnCompare').disabled = on;
    $('btnPlay').textContent = on ? '跳到终局 ⏭' : '逐年回放 ▷';
  }
  function togglePlay() {
    if (playing) { playCancel = true; return; }
    if (autoTimer) toggleAuto();
    // 未推演完则先静默推完（沿用当前情景/自由政策），再从头逐年播放
    while (game.round < 6) stepOnce();
    var recs = game.records;
    if (recs.length < 2) return;
    playing = true; playCancel = false;
    viewIdx = 0; renderAll();
    setPlayUI(true);
    var i = 0, SECS = 3.4;
    function next() {
      if (playCancel || i >= recs.length - 1) {
        playing = false; playCancel = false;
        viewIdx = recs.length - 1;
        setPlayUI(false); renderAll();
        return;
      }
      var a = recs[i], b = recs[i + 1], t0 = performance.now();
      (function frame(now) {
        if (playCancel) { i = recs.length; next(); return; }
        var t = Math.min(1, (now - t0) / (SECS * 1000));
        view3d.playStep(a, b, t);
        $('stYear').textContent = Math.round(a.year + (b.year - a.year) * t) + ' 年';
        $('stEra').textContent = t < 0.5 ? a.eraLabel : b.eraLabel;
        if (t >= 1) { i++; viewIdx = i; renderTimeline(); setTimeout(next, 260); return; }
        requestAnimationFrame(frame);
      })(performance.now());
    }
    next();
  }

  // ---------- 三情景对比 ----------
  function runCompare() {
    var results = D.SCENARIOS.map(function (sc) {
      var r = E.runScenario(sc);
      var errCount = 0, warnCount = 0;
      r.state.records.forEach(function (rec) {
        rec.issues.forEach(function (iss) { if (iss.level === 'error') errCount++; else warnCount++; });
      });
      var s = r.state.records[6].stats;
      return {
        sc: sc, scores: r.scores, err: errCount, warn: warnCount,
        pop: r.state.records[6].pop,
        urban: (s[8] * T.AREA).toFixed(1), tea: (s[5] * T.AREA).toFixed(1),
        mud: (s[1] * T.AREA).toFixed(1), wet: (s[3] * T.AREA).toFixed(1),
        road: (s[10] * T.CELL).toFixed(1), pond: s[11],
        title: collectTitles(r.state, r.scores, sc.id)[0]
      };
    });
    var verdicts = {
      A: '港城崛起、路网纵横，但滩涂与红树林付出代价——发展的账单写在了海岸线上。',
      B: '茶山最广、城乡均衡，一片叶子撑起了民生，后期补上了生态课。',
      C: '滩涂湿地几乎完整留存，城区精巧而克制——慢一些，但留住了湾区的肺。'
    };
    var rows = '<tr><th>情景</th><th>2025 人口</th><th>城区</th><th>茶园</th><th>滩涂+湿地</th><th>道路</th><th>矛盾/警告</th><th>经济</th><th>生态</th><th>民生</th><th>称号</th><th>综合</th></tr>';
    results.forEach(function (r) {
      rows += '<tr><td><b>' + r.sc.name + '</b></td><td>' + D.fmtWan(r.pop) + '</td>' +
        '<td>' + r.urban + '</td><td>' + r.tea + '</td><td>' + (+r.mud + +r.wet).toFixed(1) + '</td><td>' + r.road + '</td>' +
        '<td>' + r.err + ' / ' + r.warn + '</td>' +
        '<td>' + bar(r.scores.econ) + '</td><td>' + bar(r.scores.eco) + '</td><td>' + bar(r.scores.living) + '</td>' +
        '<td><span class="fin-title"><i class="tseal">' + r.title.seal + '</i>' + r.title.name + '</span></td>' +
        '<td class="fin-total">' + r.scores.total + '</td></tr>';
    });
    function bar(v) {
      return '<div class="mini-bar"><i style="width:' + v + '%"></i><em>' + v + '</em></div>';
    }
    var notes = results.map(function (r) { return '<p><b>' + r.sc.name + '</b>：' + verdicts[r.sc.id] + '</p>'; }).join('');
    $('cmpBody').innerHTML = '<div class="tbl-scroll"><table>' + rows + '</table></div>' + notes;
    $('cmpModal').classList.add('show');
  }

  // ---------- 渲染总入口 ----------
  function renderAll() {
    renderTimeline();
    renderNarrative();
    renderValidation();
    renderTable();
    renderStats();
    renderControls();
    if (view3d) view3d.update(game.records[viewIdx]);
  }

  // ---------- 启动 ----------
  window.addEventListener('DOMContentLoaded', function () {
    view3d = window.FDView.makeView($('view3d'));
    $('btnStep').onclick = stepOnce;
    $('btnAuto').onclick = toggleAuto;
    $('btnPlay').onclick = togglePlay;
    $('btnReset').onclick = resetGame;
    $('btnCompare').onclick = runCompare;
    $('btnTitles').onclick = openTitleModal;
    $('btnResetView').onclick = function () { view3d.resetView(); };
    $('cmpClose').onclick = function () { $('cmpModal').classList.remove('show'); };
    $('titleClose').onclick = function () { $('titleModal').classList.remove('show'); };
    // 图例
    $('legend').innerHTML = D.LAND.map(function (L) {
      return '<span><i style="background:' + L.css + '"></i>' + L.name + '</span>';
    }).join('');
    renderAll();
  });
})();
