/* 《福鼎城镇演化》时代音效：WebAudio 程序化短乐句，无外部资源
 * playEra(round) 在轮次推进/回看时给出对应时代的听感提示；muted 开关由 UI 控制
 */
'use strict';
(function (root) {
  var ctx = null, muted = false;
  function ac() {
    if (!ctx) {
      var AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function env(gainNode, t0, a, d, peak) {
    var g = gainNode.gain;
    g.setValueAtTime(0.0001, t0);
    g.linearRampToValueAtTime(peak, t0 + a);
    g.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }
  function tone(freq, type, t0, dur, peak) {
    var c = ctx;
    var o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq;
    o.connect(g); g.connect(c.destination);
    env(g, t0, 0.02, dur, peak);
    o.start(t0); o.stop(t0 + dur + 0.1);
  }
  function noise(t0, dur, peak, freq) {
    var c = ctx;
    var len = Math.floor(c.sampleRate * dur);
    var buf = c.createBuffer(1, len, c.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    var src = c.createBufferSource(); src.buffer = buf;
    var f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    var g = c.createGain();
    src.connect(f); f.connect(g); g.connect(c.destination);
    env(g, t0, 0.15, dur, peak);
    src.start(t0);
  }
  // 各时代听感：南宋/明 海浪；清 茶勺轻叩；民国 汽笛；集体 机杼低鸣；改革 车流掠过；当代 高铁双音
  var CUES = {
    0: function (t) { noise(t, 1.6, 0.16, 500); noise(t + 0.9, 1.2, 0.12, 380); },
    1: function (t) { noise(t, 1.4, 0.15, 560); },
    2: function (t) { [523, 659, 784].forEach(function (f, i) { tone(f, 'triangle', t + i * 0.22, 0.5, 0.09); }); },
    3: function (t) { tone(98, 'sine', t, 1.1, 0.2); tone(147, 'sine', t + 0.05, 1.0, 0.12); },
    4: function (t) { [0, 0.5, 1.0].forEach(function (dt) { tone(72, 'square', t + dt, 0.22, 0.07); }); },
    5: function (t) { noise(t, 1.2, 0.14, 1400); tone(660, 'sawtooth', t + 0.7, 0.4, 0.05); },
    6: function (t) { tone(880, 'sine', t, 0.35, 0.12); tone(1174, 'sine', t + 0.3, 0.5, 0.12); }
  };
  function playEra(round) {
    if (muted) return;
    var c = ac();
    if (!c) return;
    var fn = CUES[Math.max(0, Math.min(6, round))];
    if (fn) fn(c.currentTime + 0.03);
  }
  var api = {
    playEra: playEra,
    get muted() { return muted; },
    toggle: function () { muted = !muted; return muted; }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FDSfx = api;
})(typeof self !== 'undefined' ? self : this);
