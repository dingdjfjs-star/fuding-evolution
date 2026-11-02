/* 《福鼎城镇演化》三维 DEM 预览（Three.js）
 * 用地配色驱动的地形网格 + 半透明海面 + 城镇标签 + 自制轨道控制
 * 仅在浏览器运行（依赖 vendor/three.min.js）
 */
'use strict';
(function (root) {
  function makeView(container) {
    var T = root.FDTerrain, D = root.FDData;
    var W = T.W, H = T.H, N = T.N;
    var VS = 0.02;               // 垂直夸张系数：米 → 场景单位
    var worldW = W, worldH = H;  // 1 格 = 1 单位

    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe9dfc8);   // 纸色
    scene.fog = new THREE.Fog(0xe9dfc8, 140, 320);

    var camera = new THREE.PerspectiveCamera(46, 1, 0.1, 600);
    var renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);

    // 光照：暖纸上的日光
    var ambient = new THREE.AmbientLight(0xfff6e2, 0.85);
    var sun = new THREE.DirectionalLight(0xffeecf, 1.0);
    sun.position.set(-40, 60, -30);
    scene.add(ambient); scene.add(sun);

    // ---------- 地形网格 ----------
    var positions = new Float32Array(N * 3);
    var colors = new Float32Array(N * 3);
    var indices = [];
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var i = y * W + x, o = i * 3;
        positions[o] = x - W / 2 + 0.5;
        positions[o + 1] = Math.max(T.dem[i], -6) * VS;
        positions[o + 2] = y - H / 2 + 0.5;
      }
    }
    for (y = 0; y < H - 1; y++) {
      for (x = 0; x < W - 1; x++) {
        var a = y * W + x, b = a + 1, c = a + W, d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    var terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    scene.add(terrain);

    // ---------- 海面（海图蓝，纸上半透明） ----------
    var sea = new THREE.Mesh(
      new THREE.PlaneGeometry(worldW + 10, worldH + 10),
      new THREE.MeshLambertMaterial({ color: 0x4a7fa0, transparent: true, opacity: 0.58 })
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = 0.02;
    scene.add(sea);

    // ---------- 城镇标签（canvas sprite，按时代登场） ----------
    var labelGroup = new THREE.Group();
    scene.add(labelGroup);
    var lastLabelRound = -1;
    function makeLabel(text, x, y) {
      var i = y * W + x;
      var h = Math.max(T.dem[i], 0) * VS;
      var cv = document.createElement('canvas');
      var ctx = cv.getContext('2d');
      var fs = 42;
      ctx.font = 'bold ' + fs + 'px "Microsoft YaHei", sans-serif';
      var w = ctx.measureText(text).width + 26;
      cv.width = Math.ceil(w); cv.height = fs + 18;
      ctx = cv.getContext('2d');
      ctx.font = 'bold ' + fs + 'px "Kaiti SC","STKaiti","KaiTi","楷体",serif';
      ctx.fillStyle = 'rgba(247,241,224,0.88)';
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.strokeStyle = 'rgba(60,55,40,0.85)';
      ctx.lineWidth = 3;
      ctx.strokeRect(1.5, 1.5, cv.width - 3, cv.height - 3);
      ctx.fillStyle = '#2c332b';
      ctx.shadowColor = 'rgba(240,230,200,0.9)'; ctx.shadowBlur = 4;
      ctx.fillText(text, 13, fs + 2);
      var tex = new THREE.CanvasTexture(cv);
      tex.minFilter = THREE.LinearFilter;
      var spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
      spr.scale.set(cv.width / 15, cv.height / 15, 1);
      spr.position.set(x - W / 2 + 0.5, h + 2.6, y - H / 2 + 0.5);
      labelGroup.add(spr);
    }
    function rebuildLabels(round, longanAlive) {
      var key = round + '|' + (longanAlive ? 1 : 0);
      if (key === lastLabelRound) return;
      lastLabelRound = key;
      while (labelGroup.children.length) {
        var spr = labelGroup.children.pop();
        if (spr.material && spr.material.map) spr.material.map.dispose();
        if (spr.material) spr.material.dispose();
      }
      T.towns.forEach(function (tw) {
        if (tw.fromRound) { if (!longanAlive) return; } // 龙安仅在开发区落地后挂牌
        makeLabel(tw.name, tw.x, tw.y);
      });
    }
    rebuildLabels(0, false);

    // ---------- 用地配色（landuse）与分层设色（chart 海图模式） ----------
    var cTmp = new THREE.Color();
    var mode = 'landuse';
    var lastLand = null;
    function shade(base, elev) { // 高程明暗：山头略亮、谷底略暗
      var k = 0.82 + Math.min(0.35, Math.max(0, elev) / 1000 * 0.35);
      return cTmp.setHex(base).multiplyScalar(k);
    }
    function chartColor(i) { // 分层设色：海按水深、陆按高程分带
      var e = T.dem[i];
      var bands;
      if (e <= 0) bands = [[-40, 0x27506f], [-12, 0x2c5f7f], [-4, 0x457c9c], [-99, 0x6399b4]];
      else bands = [[6, 0xc9b46e], [20, 0xd8c98e], [60, 0xa8b585], [150, 0x7d9a5f], [350, 0x5d7a4e], [650, 0x4a6344], [9999, 0x8a8a78]];
      for (var b = 0; b < bands.length; b++) if (e <= bands[b][0]) return cTmp.setHex(bands[b][1]);
      return cTmp.setHex(0x8a8a78);
    }
    function paintCell(i, t) {
      var col = mode === 'chart' ? chartColor(i) : shade(D.LAND[t].color, T.dem[i]);
      var o = i * 3;
      colors[o] = col.r; colors[o + 1] = col.g; colors[o + 2] = col.b;
    }
    function updateLand(land) {
      lastLand = land;
      for (var i = 0; i < N; i++) paintCell(i, land[i]);
      geo.attributes.color.needsUpdate = true;
    }
    // 逐年过渡：t∈[0,1]，每格按确定性哈希错峰翻色——形成自发的“蔓延”节奏
    function cellPhase(i) {
      var h = Math.imul((i % W) + 1, 73856093) ^ Math.imul(((i / W) | 0) + 1, 19349663);
      return ((h >>> 0) % 1000) / 1000;
    }
    function setTransition(landA, landB, t) {
      lastLand = landB;
      for (var i = 0; i < N; i++) {
        var a = landA[i], b2 = landB[i];
        var tt = a === b2 ? 0 : cellPhase(i);
        var t2 = t < tt ? a : b2;
        paintCell(i, t2);
      }
      geo.attributes.color.needsUpdate = true;
    }

    // ---------- 自制轨道控制 ----------
    var target = new THREE.Vector3(0, 0, 4);
    var sph = { r: 95, theta: -0.5, phi: 0.98 }; // 方位角 / 极角
    var dragging = false, moved = false, lx = 0, ly = 0, autoSpin = true;
    function applyCam() {
      sph.phi = Math.max(0.18, Math.min(1.42, sph.phi));
      sph.r = Math.max(28, Math.min(220, sph.r));
      camera.position.set(
        target.x + sph.r * Math.sin(sph.phi) * Math.cos(sph.theta),
        target.y + sph.r * Math.cos(sph.phi),
        target.z + sph.r * Math.sin(sph.phi) * Math.sin(sph.theta)
      );
      camera.lookAt(target);
    }
    function onDown(e) { dragging = true; moved = false; lx = e.clientX; ly = e.clientY; autoSpin = false; }
    function onMove(e) {
      if (!dragging) return;
      var dx = e.clientX - lx, dy = e.clientY - ly;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      sph.theta += dx * 0.0055;
      sph.phi -= dy * 0.0045;
      lx = e.clientX; ly = e.clientY;
      applyCam();
    }
    function onUp() { dragging = false; }
    function onWheel(e) {
      e.preventDefault();
      sph.r *= (e.deltaY > 0 ? 1.09 : 0.92);
      applyCam();
    }
    var dom = renderer.domElement;
    dom.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    dom.addEventListener('wheel', onWheel, { passive: false });
    dom.addEventListener('touchstart', function (e) {
      if (e.touches.length === 1) { onDown(e.touches[0]); }
    }, { passive: true });
    dom.addEventListener('touchmove', function (e) {
      if (e.touches.length === 1) onMove(e.touches[0]);
    }, { passive: true });
    dom.addEventListener('touchend', onUp);
    dom.addEventListener('dblclick', function () { autoSpin = !autoSpin; });

    // ---------- 渲染循环 ----------
    function resize() {
      var w = container.clientWidth || 640, h = container.clientHeight || 420;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', resize);
    resize(); applyCam();
    (function loop() {
      requestAnimationFrame(loop);
      if (autoSpin) { sph.theta += 0.0016; applyCam(); }
      renderer.render(scene, camera);
    })();

    // ---------- 台风气旋（有台风事件的轮次自动播放一次） ----------
    var cyclone = null, cycloneRound = -1;
    function makeCyclone() {
      var cv = document.createElement('canvas');
      cv.width = cv.height = 96;
      var cx = cv.getContext('2d');
      cx.translate(48, 48);
      cx.strokeStyle = '#f2ecdd';
      cx.lineWidth = 5;
      for (var arm = 0; arm < 3; arm++) {
        cx.beginPath();
        for (var a = 0; a <= Math.PI * 0.9; a += 0.1) {
          var r = 6 + a * 12;
          var ang = arm * (Math.PI * 2 / 3) + a;
          var px = r * Math.cos(ang), py = r * Math.sin(ang);
          if (a === 0) cx.moveTo(px, py); else cx.lineTo(px, py);
        }
        cx.stroke();
      }
      cx.beginPath(); cx.arc(0, 0, 4, 0, Math.PI * 2); cx.fillStyle = '#f2ecdd'; cx.fill();
      var tex = new THREE.CanvasTexture(cv);
      var spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthTest: false }));
      spr.scale.set(16, 16, 1);
      scene.add(spr);
      return spr;
    }
    function playCyclone() {
      if (!cyclone) cyclone = makeCyclone();
      var t0 = performance.now(), DUR = 2800;
      var p0 = { x: 30, y: 10 }, p1 = { x: 46, y: 22 }, p2 = { x: 38, y: 25 }; // 海上→湾口→湾内（格坐标）
      (function frame(now) {
        var t = Math.min(1, (now - t0) / DUR);
        var u = 1 - t;
        var gx = u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x;
        var gy = u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y;
        cyclone.position.set(gx - W / 2 + 0.5, 14, gy - H / 2 + 0.5);
        cyclone.material.rotation += 0.18;
        cyclone.material.opacity = t < 0.15 ? t / 0.15 : (t > 0.8 ? (1 - t) / 0.2 : 1);
        if (t < 1) requestAnimationFrame(frame);
        else cyclone.material.opacity = 0;
      })(t0);
    }

    return {
      update: function (record) {
        updateLand(record.land);
        rebuildLabels(record.round, record.longan);
        var hasTyphoon = (record.events || []).some(function (e) { return /taifeng|storm|typhoon/i.test(e.id); });
        if (hasTyphoon && cycloneRound !== record.round) { cycloneRound = record.round; playCyclone(); }
      },
      playStep: function (recA, recB, t) {
        setTransition(recA.land, recB.land, t);
        rebuildLabels(t > 0.96 ? recB.round : recA.round, t > 0.96 ? recB.longan : recA.longan);
      },
      setMode: function (m) { mode = m; if (lastLand) updateLand(lastLand); },
      getMode: function () { return mode; },
      resetView: function () { sph = { r: 95, theta: -0.5, phi: 0.98 }; applyCam(); autoSpin = false; }
    };
  }

  var api = { makeView: makeView };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FDView = api;
})(typeof self !== 'undefined' ? self : this);
