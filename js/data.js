/* 《福鼎城镇演化》静态数据：用地类型 / 时代 / 政策 / 情景 / 事件 / 叙事素材
 * 纯数据与纯函数，Node 与浏览器共用
 */
'use strict';
(function (root) {

  // ---------- 用地类型（水彩海图配色） ----------
  var LAND = [
    { id: 0, name: '海域', color: 0x2c5f7f, css: '#2c5f7f', cat: 'water' },
    { id: 1, name: '滩涂', color: 0xb3a071, css: '#b3a071', cat: 'eco' },
    { id: 2, name: '河湖', color: 0x4b81a3, css: '#4b81a3', cat: 'water' },
    { id: 3, name: '红树林湿地', color: 0x4d7c5c, css: '#4d7c5c', cat: 'eco' },
    { id: 4, name: '林地', color: 0x556b47, css: '#556b47', cat: 'farm' },
    { id: 5, name: '茶园', color: 0x8ba05f, css: '#8ba05f', cat: 'farm' },
    { id: 6, name: '农田', color: 0xc9b46e, css: '#c9b46e', cat: 'farm' },
    { id: 7, name: '村落', color: 0xa87f52, css: '#a87f52', cat: 'built' },
    { id: 8, name: '城镇', color: 0x96503c, css: '#96503c', cat: 'built' },
    { id: 9, name: '港口', color: 0x53667d, css: '#53667d', cat: 'built' },
    { id: 10, name: '交通', color: 0x6b6157, css: '#6b6157', cat: 'built' },
    { id: 11, name: '养殖塘', color: 0x7ba3a8, css: '#7ba3a8', cat: 'eco' }
  ];
  var CATS = { water: '水域', eco: '海岸生态', farm: '农林生产', built: '建设用地' };

  // ---------- 时代（7 个锚点，6 轮推演） ----------
  var ERAS = [
    {
      key: 'song', year: 1250, label: '南宋 · 渔村渡口', round: -1, // 起点
      pop: 9000,
      intro: '南宋咸淳年间，闽东北一隅。沙埕湾像一条伸进山地的手臂，湾顶桐山溪水缓缓入海。' +
        '零星渔村挂在湾口与海滨：沙埕的渔汛、秦屿的滩涂、嵛山的草场天湖。桐山渡是闽浙古道过湾的咽喉，' +
        '一叶渡船，挑夫与茶担在渡口石阶上歇脚。群山阻隔，官道陡峻，山海之间靠潮水与脚力。',
      outro: '山海相隔的格局，将决定此后七百年每一次选择的代价。'
    },
    {
      key: 'ming', year: 1520, label: '明 · 卫所与渔汛', round: 1,
      pop: 18000, popMul: 1.9,
      urbanBudget: 3, farmBudget: 9, teaBudget: 4,
      tech: { teaTrade: true },
      intro: '明中叶，沙埕设巡检司备倭，烟墩与石寨立在湾口山头。渔汛带来了季节性的人流，' +
        '港湾里冬晒鳗鲞、夏收牡蛎。山民引茶籽入坡地，太姥山僧院的老茶树枝繁叶茂——绿雪芽的名字开始被山外的人提起。',
      outro: '渔盐之利与一芽新绿，是这座湾城最早的家底。'
    },
    {
      key: 'qing', year: 1795, label: '清中叶 · 白琳茶起', round: 2,
      pop: 90000, popMul: 4.7,
      urbanBudget: 6, farmBudget: 15, teaBudget: 16,
      tech: { teaTrade: true, teaExport: true, reclamation: false },
      intro: '清中叶，白琳茶馆林立，"白琳工夫"的名称随茶商的货单走南闯北。点头埠头茶箱堆积如山，' +
        '独轮车吱呀碾过石板路。桐山渡扩为街市，前岐的晒鲞场、店下的盐田各有营生。海禁松弛后，闽南人北迁垦殖，湾内人烟渐密。',
      outro: '茶，第一次成了这片土地与外部世界讨价还价的筹码。'
    },
    {
      key: 'min', year: 1930, label: '近代 · 开埠通商', round: 3,
      pop: 200000, popMul: 2.1,
      urbanBudget: 9, farmBudget: 12, teaBudget: 14,
      tech: { teaTrade: true, teaExport: true, reclamation: false, steamship: true },
      intro: '民国年间，轮船的汽笛代替了橹声。沙埕港开埠，茶、纸、明矾、鱼货在此过驳，' +
        '上海与福州的商行在埠头设栈。白琳工夫红茶远销欧洲，桐山街上新式学堂与电报局并排而立。' +
        '但山路依旧难行——茶箱出山，仍要肩挑马驮到埠头。',
      outro: '港口敞开了门，道路却还是一根卡在喉咙里的细竹管。'
    },
    {
      key: 'collective', year: 1978, label: '集体 · 围垦茶场', round: 4,
      pop: 380000, popMul: 1.8,
      urbanBudget: 8, farmBudget: 27, teaBudget: 26,
      tech: { teaTrade: true, teaExport: false, reclamation: true, steamship: true, machinery: true },
      intro: '集体化年代，国营茶场在丘陵上铺开，万人上山大种茶。海堤一道道合龙，' +
        '店下、秦屿的滩涂被围成农场与盐场。化肥与机耕路改变着平原的面貌，桐山镇第一次有了像样的街道。',
      outro: '向海要田、向山要茶——人定胜天的年代，欠下的账要留给后人算。'
    },
    {
      key: 'reform', year: 2005, label: '改革 · 公路时代', round: 5,
      pop: 500000, popMul: 1.26,
      urbanBudget: 26, farmBudget: 9, teaBudget: 30,
      tech: { teaTrade: true, teaExport: true, reclamation: true, steamship: true, machinery: true, highway: true },
      intro: '改革开放后，104国道拓宽，县乡公路成网，茶叶不再等船，而是等货车。' +
        '乡镇企业兴起，桐山城区沿溪铺开，沙埕港重开货运。打工的行囊与回乡的汇款单向对流，' +
        '城关的房价第一次成了茶余饭后的话题。',
      outro: '路通了，城大了，海边的滩涂开始了一场旷日持久的拉锯。'
    },
    {
      key: 'now', year: 2025, label: '当代 · 湾区与白茶热', round: 6,
      pop: 560000, popMul: 1.07,
      urbanBudget: 34, farmBudget: 6, teaBudget: 38,
      tech: { teaTrade: true, teaExport: true, reclamation: true, steamship: true, machinery: true, highway: true, rail: true, ecoRedline: true },
      intro: '沈海高速与温福铁路穿境而过，福鼎成了闽浙边界的节点城市。白茶热让荒山茶园身价倍增，' +
        '"世界白茶在中国，中国白茶在福鼎"。而生态红线与海湾治理也提上台面：退养还滩、红树林种植、' +
        '沙埕湾的蓝眼泪与候鸟成了新的名片。城市的边界，第一次需要跟自然商量着画。',
      outro: '七百年山海之争，如今到了必须给出答案的时候。'
    }
  ];

  // ---------- 政策 ----------
  var POLICIES = [
    {
      id: 'road', name: '修路开道', icon: '路',
      desc: '开凿官道/兴修公路：以桐山为枢纽连接各镇。路通则茶出山、城沿路长；未修路时，山区茶货只能肩挑到埠。',
      short: '路通百业兴，但每公里都要向山地付代价'
    },
    {
      id: 'tea', name: '发展茶园', icon: '茶',
      desc: '引茶上山：在 60~780m、坡度≤26° 的丘陵林地开辟茶园。有路通港则茶利倍增，无路则困于山中。',
      short: '一片叶子富一方，前提是它出得了山'
    },
    {
      id: 'eco', name: '海岸生态保护', icon: '海',
      desc: '守护滩涂与红树林：禁止围垦造塘，推动退养还滩、种植红树林。生态分上升，但建设用地向海扩张受限。',
      short: '滩涂是候鸟的食堂，也是纳潮的肺'
    }
  ];

  // ---------- 三种发展情景（每轮政策开关） ----------
  var R = 6; // 推演轮数
  var SCENARIOS = [
    {
      id: 'A', name: '情景一 · 商贸强港', tag: '以港兴城，以路通商',
      desc: '修路全期推进，前期茶贸跟进，不设生态约束——滩涂让位于码头与塘埭，城市沿湾疯长。',
      policy: [
        { road: 1, tea: 1, eco: 0 },
        { road: 1, tea: 1, eco: 0 },
        { road: 1, tea: 1, eco: 0 },
        { road: 1, tea: 1, eco: 0 },
        { road: 1, tea: 0, eco: 0 },
        { road: 1, tea: 0, eco: 0 }
      ]
    },
    {
      id: 'B', name: '情景二 · 白茶富民', tag: '一片叶子，路随茶走',
      desc: '茶园全期深耕，路网为茶山服务，后期补上生态课——茶山最广，城乡相对均衡。',
      policy: [
        { road: 1, tea: 1, eco: 0 },
        { road: 1, tea: 1, eco: 0 },
        { road: 1, tea: 1, eco: 0 },
        { road: 1, tea: 1, eco: 0 },
        { road: 1, tea: 1, eco: 1 },
        { road: 1, tea: 1, eco: 1 }
      ]
    },
    {
      id: 'C', name: '情景三 · 生态湾区', tag: '守住滩涂与红树林',
      desc: '生态保护全期优先，路网适度、茶上山下海——滩涂湿地最完整，城区最小而精。',
      policy: [
        { road: 0, tea: 0, eco: 1 },
        { road: 1, tea: 0, eco: 1 },
        { road: 1, tea: 1, eco: 1 },
        { road: 1, tea: 1, eco: 1 },
        { road: 1, tea: 1, eco: 1 },
        { road: 1, tea: 1, eco: 1 }
      ]
    }
  ];

  // ---------- 事件（每轮从当轮池中按权重抽 1~2 个，种子确定性） ----------
  var EVENTS = {
    1: [
      { id: 'fish_bonus', name: '渔汛大丰', weight: 3, mod: { popMul: 1.05 }, note: '大黄鱼汛期大丰，港湾内渔船满载而归。' },
      { id: 'taifeng_ming', name: '台风毁屋', weight: 2, mod: { popMul: 0.98, urbanAdd: -1 }, note: '秋台风正面登陆，沙埕渔寮十毁其三，重建耗去人力物力。' },
      { id: 'tea_seed', name: '茶籽入山', weight: 2, mod: { teaAdd: 2 }, note: '山僧与农户扩植茶树，绿雪芽的名声渐渐传出深山。' },
      { id: 'kao_wei', name: '倭警迁坰', weight: 1, mod: { popMul: 0.94, urbanAdd: -2 }, note: '倭警频传，湾口渔村一度内迁，街市萧条数年。' }
    ],
    2: [
      { id: 'tea_market', name: '白琳茶庄开秤', weight: 3, mod: { teaAdd: 4, popMul: 1.06 }, note: '各地茶商云集白琳设庄收购，茶价三年翻了一番。' },
      { id: 'ferry_bustle', name: '渡口兴盛', weight: 2, mod: { urbanAdd: 2 }, note: '桐山渡日过千人，渡口街市顺着坡势长了两条新巷。' },
      { id: 'flood', name: '溪洪冲田', weight: 2, mod: { farmAdd: -3, popMul: 0.99 }, note: '桐山溪夏洪冲毁沿岸田垄，乡民补种晚薯。' },
      { id: 'migrant', name: '闽南人北迁', weight: 2, mod: { popMul: 1.08, farmAdd: 2 }, note: '海禁松弛，闽南移民溯湾而上，垦殖沿海荒地。' }
    ],
    3: [
      { id: 'steamship', name: '轮船通航', weight: 3, mod: { portAdd: 2, popMul: 1.05 }, note: '小轮定期往返沙埕—福州—上海，埠头仓库应声而起。' },
      { id: 'tea_boom', name: '工夫茶远销', weight: 3, mod: { teaAdd: 3, popMul: 1.04 }, note: '白琳工夫红茶在欧洲市场走俏，茶栈连夜赶工装箱。' },
      { id: 'tea_crash', name: '茶价暴跌', weight: 2, mod: { teaAdd: -2, popMul: 0.97 }, note: '国际茶市崩盘，茶庄接连歇业，茶农砍茶改种番薯。' },
      { id: 'port_fire', name: '埠头失火', weight: 1, mod: { portAdd: -1, urbanAdd: -1 }, note: '沙埕埠栈房失火，半条街化为白地。' }
    ],
    4: [
      { id: 'state_farm', name: '国营茶场上山', weight: 3, mod: { teaAdd: 6, popMul: 1.02 }, note: '国营茶场在磻溪、管阳铺开，知青与农民一起开垦水平带。' },
      { id: 'reclaim', name: '围海造田', weight: 3, mod: { reclaimAdd: 8 }, note: '海堤合龙，店下外滩围出千亩新田。' },
      { id: 'storm_tide', name: '台风潮灾', weight: 2, mod: { popMul: 0.99, reclaimAdd: -2 }, note: '七月大潮顶托台风，新围的海堤溃口，田苗尽没。' },
      { id: 'machine_road', name: '机耕路进山', weight: 2, mod: { teaAdd: 2 }, note: '手扶拖拉机沿着新开的机耕路把茶苗运上高山。' }
    ],
    5: [
      { id: 'highway', name: '国道拓宽通车', weight: 3, mod: { roadAdd: 4, popMul: 1.04 }, note: '104国道改线拓宽，货车当天就能把茶青送出福鼎。' },
      { id: 'factories', name: '乡镇企业兴起', weight: 3, mod: { urbanAdd: 3, popMul: 1.03 }, note: '石板材厂、化油器厂在城郊落地，机器声盖过鸡鸣。' },
      { id: 'pond_boom', name: '虾塘遍地', weight: 2, mod: { reclaimAdd: 6 }, note: '滩涂被切割成一方方虾塘，电灯拉到了海边。' },
      { id: 'white_tea', name: '白茶悄然走红', weight: 2, mod: { teaAdd: 4 }, note: '南方茶市上白毫银针悄然涨价，老茶农直觉明年该多种。' }
    ],
    6: [
      { id: 'rail', name: '高铁设站', weight: 3, mod: { roadAdd: 3, popMul: 1.05, urbanAdd: 2 }, note: '温福铁路在桐山设站，距温州一小时，距上海半天。' },
      { id: 'tea_hot', name: '白茶热价涨', weight: 3, mod: { teaAdd: 5, popMul: 1.03 }, note: '白茶火遍全国，清明前的点头茶市一叶难求。' },
      { id: 'redline', name: '生态红线划定', weight: 3, mod: { ecoRestore: 4 }, note: '沙埕湾划入海湾生态治理，退养还滩，红树林成片补种。' },
      { id: 'typhoon_dujuan', name: '超强台风过境', weight: 2, mod: { popMul: 0.99, urbanAdd: -1, ecoRestore: 1 }, note: '台风过境，滨海大道积水倒灌，也冲垮了部分老化虾塘。' }
    ]
  };

  // ---------- 格式化 ----------
  function fmtWan(n) { // 人口 → 万
    if (n >= 10000) return (n / 10000).toFixed(1) + ' 万';
    return Math.round(n).toLocaleString('zh-CN') + ' 人';
  }
  function fmtKm2(cells) { return (cells * 0.25).toFixed(1); }
  function kmOfCells(cells) { return (cells * 0.5).toFixed(1); }

  // ---------- 土地承载力（全境口径，人） ----------
  // 用地类型下标：1 滩涂 3 红树林湿地 5 茶园 6 农田 8 城镇 9 港口 10 交通
  function capacityOf(stats) {
    return Math.round(stats[6] * 1300 + stats[5] * 600 + stats[1] * 200 +
      stats[8] * 6200 + stats[9] * 6000 + stats[10] * 36 + stats[3] * 200);
  }

  var api = {
    LAND: LAND, CATS: CATS, ERAS: ERAS, POLICIES: POLICIES,
    SCENARIOS: SCENARIOS, EVENTS: EVENTS,
    fmtWan: fmtWan, fmtKm2: fmtKm2, kmOfCells: kmOfCells, capacityOf: capacityOf,
    landById: function (id) { return LAND[id]; },
    eraByRound: function (r) { return ERAS[r] || ERAS[ERAS.length - 1]; }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FDData = api;
})(typeof self !== 'undefined' ? self : this);
