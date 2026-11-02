/* 《福鼎城镇演化》结局称号图鉴：按终局评分与用地构成判定
 * 纯函数；UI 侧负责把所得称号并入 localStorage 收藏（跨推演收集）
 */
'use strict';
(function (root) {
  var T;
  if (typeof module !== 'undefined' && module.exports) T = require('./terrain.js');
  else T = root.FDTerrain;
  // 判定上下文 ctx：{
  //   scores: {econ, eco, living, total}, pop, popRatio,
  //   stats: 终局用地统计, stats0: 初始用地统计,
  //   urbanKm2, teaKm2, mudKm2, pondKm2, mangroveN, roadKm, portN,
  //   mudRatio: 滩涂/初值, warns, errs, scenarioId, ecoRounds
  // }
  var TITLES = [
    { id: 'bird', seal: '鸟', name: '候鸟守护人', desc: '滩涂近乎完整留存（≥97%），生态分 ≥80——候鸟的食堂一寸未失。' },
    { id: 'port', seal: '港', name: '港城崛起者', desc: '城区 ≥70km² 且滩涂所剩不足八成——城市赢了，海岸退了半步。' },
    { id: 'tea', seal: '茶', name: '白茶圣手', desc: '茶园 ≥80km²——一片叶子撑起了半座城。' },
    { id: 'mangrove', seal: '林', name: '红树林园丁', desc: '红树林湿地 ≥13km²——亲手种回一片海上森林。' },
    { id: 'tea_trapped', seal: '困', name: '茶困于山', desc: '茶园成片却路网稀疏（<30km）——好茶出不了山。' },
    { id: 'mud_loss', seal: '殇', name: '滩涂之殇', desc: '滩涂损失超过四成——纳潮的肺被填掉了大半。' },
    { id: 'reclaim', seal: '垦', name: '围垦狂潮', desc: '养殖塘 ≥12km²——滩涂被切割成一方方塘埭。' },
    { id: 'living', seal: '安', name: '民生之父', desc: '民生分 ≥98——山海之间人人有其业。' },
    { id: 'allround', seal: '全', name: '山海全才', desc: '综合 ≥80 且经济/生态/民生俱佳——三难困境的高分解法。' },
    { id: 'ecowarn', seal: '警', name: '生态警钟', desc: '累计警告 ≥6 条——发展的账单越积越厚。' },
    { id: 'sail', seal: '帆', name: '帆影孤港', desc: '港口 ≥8 处而城区不足 60km²——港兴而城未兴。' },
    { id: 'first', seal: '初', name: '山海初见', desc: '完成一次完整推演——七百年山海，从此有了你的注脚。' }
  ];

  function computeTitles(ctx) {
    var got = [];
    function add(id) {
      for (var i = 0; i < TITLES.length; i++) if (TITLES[i].id === id) got.push(TITLES[i]);
    }
    if (ctx.mudRatio >= 0.97 && ctx.scores.eco >= 80) add('bird');
    if (ctx.urbanKm2 >= 70 && ctx.mudRatio <= 0.8) add('port');
    if (ctx.teaKm2 >= 80) add('tea');
    if (ctx.mangroveN >= 20) add('mangrove');
    if (ctx.teaKm2 >= 30 && ctx.roadKm < 30) add('tea_trapped');
    if (ctx.mudRatio <= 0.6) add('mud_loss');
    if (ctx.pondKm2 >= 12) add('reclaim');
    if (ctx.scores.living >= 98) add('living');
    if (ctx.scores.total >= 80 && ctx.scores.econ >= 65 && ctx.scores.eco >= 65 && ctx.scores.living >= 85) add('allround');
    if (ctx.warns >= 6) add('ecowarn');
    if (ctx.portN >= 8 && ctx.urbanKm2 < 60) add('sail');
    add('first'); // 兜底：完成推演即得
    return got;
  }

  // 从一条推演历史构造判定上下文（state 为完整 state，含 records）
  function buildContext(state, scores) {
    var rec0 = state.records[0], rec6 = state.records[state.records.length - 1];
    var s = rec6.stats, s0 = rec0.stats;
    var warns = 0, errs = 0, ecoRounds = 0;
    state.records.forEach(function (r) {
      (r.issues || []).forEach(function (iss) { if (iss.level === 'error') errs++; else warns++; });
      if (r.policy && r.policy.eco) ecoRounds++;
    });
    return {
      scores: scores, pop: rec6.pop, popRatio: scores.popRatio,
      stats: s, stats0: s0,
      urbanKm2: s[8] * T.AREA, teaKm2: s[5] * T.AREA,
      mudKm2: s[1] * T.AREA, pondKm2: s[11] * T.AREA,
      mangroveN: s[3], portN: s[9], roadKm: s[10] * T.CELL,
      mudRatio: rec0.stats[1] ? s[1] / rec0.stats[1] : 1,
      warns: warns, errs: errs, ecoRounds: ecoRounds,
      scenarioId: null
    };
  }

  var api = { TITLES: TITLES, computeTitles: computeTitles, buildContext: buildContext };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FDTitles = api;
})(typeof self !== 'undefined' ? self : this);
