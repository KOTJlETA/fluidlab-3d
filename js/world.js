/* FluidLab 3D — уровни, сценарии, объекты сцены, зондирование жидкости, физика машин */
(function () {
  'use strict';
  var FS = (window.FS = window.FS || {});
  var World = (FS.World = {});
  var T = function (k) { return FS.I18N.t(k); };

  /* ---------------- типы «жидкостей» ----------------
     fluid: true  — участвует в PBF-решателе (давление, вязкость, поверхность)
     fluid: false — сыпучая частица: своя баллистика, трение, никакого давления */

  World.TYPES = [
    { key: 'water', css: '#2173d1', fluid: true, spacing: 0.082, visc: 0.10, buoy: 0.0, grav: 1.0, drag: 0.0 },
    { key: 'oil', css: '#a86a1a', fluid: true, spacing: 0.094, visc: 0.30, buoy: 0.35, grav: 1.0, drag: 0.0 },
    { key: 'lava', css: '#ff5210', fluid: true, spacing: 0.075, visc: 0.55, buoy: -0.9, grav: 1.0, drag: 0.0 },
    { key: 'slime', css: '#33d961', fluid: true, spacing: 0.086, visc: 0.85, buoy: 0.0, grav: 1.0, drag: 0.0 },
    { key: 'snow', css: '#eef4ff', fluid: false, spacing: 0.070, visc: 0.0, buoy: 0.0, grav: 0.12, drag: 3.4 },
    { key: 'sand', css: '#d9c48a', fluid: false, spacing: 0.070, visc: 0.0, buoy: 0.0, grav: 0.95, drag: 0.7 },
    { key: 'dust', css: '#b9b2a6', fluid: false, spacing: 0.070, visc: 0.0, buoy: 0.0, grav: 0.10, drag: 3.2 }
  ];
  World.typeName = function (i) { return T('type.' + World.TYPES[i].key); };

  /* ---------------- уровни ----------------
     scale — единый масштаб мира: шаг решётки, размеры частиц, скорости и арена
     растут вместе, поэтому кадр всегда заполнен, а плотность жидкости одинакова. */

  function mkLevel(o) {
    var s = o.scale;
    var L = {
      key: o.key,
      kind: o.kind, scale: s, floorStyle: o.floorStyle,
      sky: o.sky, ground: true,
      floorY: -1.6 * s,
      wallTop: o.wallTop === undefined ? 1.6 * s : o.wallTop * s,
      half: o.half,
      min: [-o.half, -1.6 * s, -o.half],
      max: [o.half, 1.6 * s, o.half],
      camDist: o.half * (o.camK || 1.85),
      camPhi: o.camPhi || 0.98,
      city: !!o.city, cityN: o.cityN || 0, maxBuildings: o.maxBuildings || 0,
      maxCars: o.maxCars || 0,
      cone: o.cone || null
    };
    if (o.kind === 'sphere') {
      L.center = [0, -0.15 * s, 0];
      L.radius = 2.0 * s;
      L.half = 2.0 * s;
      L.camDist = L.radius * 2.9;
    }
    L.name = T('level.' + o.key);
    return L;
  }

  World.LEVELS = {
    city_mini: mkLevel({
      key: 'city_mini', kind: 'box', scale: 1.0, half: 2.0, floorStyle: 1,
      sky: 'night', city: true, cityN: 4, maxBuildings: 18, maxCars: 5
    }),
    city_mid: mkLevel({
      key: 'city_mid', kind: 'box', scale: 2.5, half: 5.0, floorStyle: 1,
      sky: 'night', city: true, cityN: 5, maxBuildings: 30, maxCars: 8
    }),
    city_big: mkLevel({
      key: 'city_big', kind: 'box', scale: 16, half: 32.0, floorStyle: 1,
      sky: 'night', city: true, cityN: 10, maxBuildings: 62, maxCars: 12, camK: 1.55
    }),
    tank: mkLevel({
      key: 'tank', kind: 'box', scale: 0.95, half: 1.8, floorStyle: 0,
      sky: 'grid', camK: 2.05
    }),
    sphere: mkLevel({
      key: 'sphere', kind: 'sphere', scale: 1.05, half: 2.1, floorStyle: 3,
      sky: 'xmas', camK: 2.9
    }),
    volcano: mkLevel({
      key: 'volcano', kind: 'none', scale: 3.0, half: 6.0, floorStyle: 2,
      sky: 'sunset', camK: 2.6,
      cone: { r0: 3.3, r1: 0.75, h: 7.4 }
    }),
    open: mkLevel({
      key: 'open', kind: 'none', scale: 1.5, half: 3.0, floorStyle: 2,
      sky: 'sunset', camK: 2.2
    })
  };

  World.SKIES = ['grid', 'night', 'sunset', 'day', 'nebula', 'studio', 'xmas'];
  World.skyName = function (k) { return T('sky.' + k); };

  /* ---------------- утилиты ---------------- */

  var _seed = 1337;
  World.seed = function (s) { _seed = s | 0 || 1337; };
  World.rnd = function () {
    _seed = (_seed * 1664525 + 1013904223) & 0x7fffffff;
    return _seed / 0x7fffffff;
  };
  World.rr = function (a, b) { return a + (b - a) * World.rnd(); };

  var _uid = 1;
  World.uid = function () { return 'o' + (_uid++); };
  World.syncUid = function (objects) {
    _uid = 1;
    objects.forEach(function (o) {
      var n = parseInt(String(o.id).replace('o', ''), 10);
      if (n >= _uid) _uid = n + 1;
    });
  };

  /* ---------------- фабрики объектов ---------------- */

  World.sphere = function (pos, r, color) {
    return { id: World.uid(), kind: 'sphere', pos: pos.slice(), r: r, color: color || [0.30, 0.38, 0.46] };
  };

  World.mound = function (pos, r, color) {
    return { id: World.uid(), kind: 'mound', pos: pos.slice(), r: r, color: color || [0.94, 0.96, 1.0] };
  };

  World.building = function (pos, hx, hy, hz, rot, color) {
    return {
      id: World.uid(), kind: 'building', pos: pos.slice(), rot: rot || 0,
      size: [hx, hy, hz], color: color || [0.20, 0.23, 0.30]
    };
  };

  World.car = function (pos, rot, color, scale) {
    var s = scale || 1;
    return {
      id: World.uid(), kind: 'car', pos: pos.slice(), rot: rot || 0,
      size: [0.085 * s, 0.055 * s, 0.16 * s], color: color || [0.55, 0.16, 0.14],
      dynamic: true, vel: [0, 0, 0], yaw: rot || 0, yawVel: 0
    };
  };

  World.portalPair = function (posA, normalA, posB, normalB, color, scale) {
    var s = scale || 1;
    var a = {
      id: World.uid(), kind: 'portal', pos: posA.slice(), r: 0.19 * s,
      normal: normalA.slice(), color: color || [0.35, 0.95, 0.85], link: null
    };
    var b = {
      id: World.uid(), kind: 'portal', pos: posB.slice(), r: 0.19 * s,
      normal: normalB.slice(), color: color || [0.95, 0.55, 0.95], link: a.id
    };
    a.link = b.id;
    return [a, b];
  };

  World.field = function (pos, mode, radius, strength, dir) {
    return {
      id: World.uid(), kind: 'field', pos: pos.slice(), mode: mode || 'repel',
      radius: radius || 0.42, strength: strength === undefined ? 14 : strength,
      dir: (dir || [0, 1, 0]).slice(),
      color: [0.55, 0.85, 1.0]
    };
  };

  World.FIELD_MODES = {
    repel: { color: [1.0, 0.45, 0.35] },
    attract: { color: [0.45, 0.75, 1.0] },
    accelerate: { color: [0.55, 1.0, 0.55] },
    drag: { color: [0.85, 0.75, 0.35] }
  };
  World.fieldName = function (m) { return T('field.' + m); };

  World.tree = function (pos, h, r, color) {
    return {
      id: World.uid(), kind: 'tree', pos: pos.slice(), rot: World.rr(0, Math.PI * 2),
      size: [r, h * 0.5, r], color: color || [0.12, 0.42, 0.22]
    };
  };

  World.snowman = function (pos, r) {
    return {
      id: World.uid(), kind: 'snowman', pos: pos.slice(), r: r,
      color: [0.97, 0.98, 1.0]
    };
  };

  World.house = function (pos, hx, hy, hz, rot, color) {
    return {
      id: World.uid(), kind: 'house', pos: pos.slice(), rot: rot || 0,
      size: [hx, hy, hz], color: color || [0.62, 0.44, 0.26]
    };
  };

  /* ---------------- шаблоны уровней ---------------- */

  var PALETTE = [
    [0.30, 0.34, 0.44], [0.36, 0.31, 0.38], [0.26, 0.36, 0.44],
    [0.42, 0.36, 0.32], [0.32, 0.32, 0.38], [0.24, 0.30, 0.36]
  ];
  var CAR_COLORS = [
    [0.72, 0.20, 0.16], [0.20, 0.40, 0.72], [0.82, 0.70, 0.18],
    [0.62, 0.24, 0.62], [0.22, 0.62, 0.52], [0.70, 0.70, 0.72]
  ];

  World.cityObjects = function (L) {
    World.seed(90210 + Math.round(L.half * 10));
    var out = [];
    var s = L.scale;
    var H = L.half;
    var floorY = L.floorY;
    var height = L.wallTop - L.floorY;
    var n = L.cityN;
    var cell = (H * 2) / n;
    var plaza = H * 0.34;
    var maxB = L.maxBuildings;

    for (var i = 0; i < n && out.length < maxB; i++) {
      for (var j = 0; j < n && out.length < maxB; j++) {
        var x = -H + (i + 0.5) * cell;
        var z = -H + (j + 0.5) * cell;
        var dist = Math.hypot(x, z);
        if (dist < plaza) continue;
        if (World.rnd() < 0.14) continue;
        var w = cell * World.rr(0.21, 0.33);
        var d = cell * World.rr(0.21, 0.33);
        var h = height * World.rr(0.10, 0.27) * (dist > H * 0.72 ? 1.35 : 1.0);
        if (h < 0.12 * s) h = 0.12 * s;
        out.push(World.building(
          [x, floorY + h, z], w, h, d,
          World.rr(0, Math.PI),
          PALETTE[(i * 3 + j * 5) % PALETTE.length]
        ));
      }
    }

    var maxC = L.maxCars;
    for (var c = 0; c < maxC; c++) {
      var along = World.rnd() < 0.5;
      var line = Math.floor(World.rnd() * n) * cell - H + cell * 0.5;
      var t = World.rr(-H * 0.85, H * 0.85);
      var px = along ? t : line;
      var pz = along ? line : t;
      if (Math.hypot(px, pz) < plaza * 0.55) continue;
      out.push(World.car(
        [px, floorY + 0.06 * s, pz],
        along ? 0 : Math.PI / 2,
        CAR_COLORS[c % CAR_COLORS.length], s
      ));
    }
    return out;
  };

  World.tankObjects = function (L) {
    var s = L.scale, y = L.floorY;
    return [
      World.sphere([-0.85 * s, y + 0.60 * s, 0.20 * s], 0.50 * s, [0.30, 0.38, 0.46]),
      World.sphere([0.38 * s, y + 1.30 * s, -1.00 * s], 0.24 * s, [0.42, 0.30, 0.20]),
      World.building([0.85 * s, y + 0.45 * s, -0.26 * s], 0.38 * s, 0.45 * s, 0.38 * s, 0, [0.26, 0.30, 0.38])
    ];
  };

  /* Снежный шар: ёлочки, снеговики, деревянные домики, снежный наст */
  World.snowObjects = function (L) {
    World.seed(777);
    var s = L.scale;
    var out = [];
    var y = L.floorY;
    var R = L.radius || 2.1;

    // снежный наст — плоская «подушка» на дне шара
    out.push(World.mound([0, y + 0.02 * s, 0], R * 0.86));

    var NT = 9;
    for (var i = 0; i < NT; i++) {
      var a = (i / NT) * Math.PI * 2 + 0.3;
      var rad = World.rr(0.95, 1.55) * s;
      if (rad > R * 0.72) rad = R * 0.72;
      var h = World.rr(0.55, 1.15) * s;
      out.push(World.tree([Math.cos(a) * rad, y + h * 0.5, Math.sin(a) * rad], h, h * 0.30));
    }

    var NH = 4;
    for (var j = 0; j < NH; j++) {
      var a2 = (j / NH) * Math.PI * 2 + 1.05;
      var r2 = World.rr(1.15, 1.6) * s;
      if (r2 > R * 0.74) r2 = R * 0.74;
      var hh = World.rr(0.24, 0.34) * s;
      var hw = hh * World.rr(0.85, 1.15);
      out.push(World.house(
        [Math.cos(a2) * r2, y + hh * 1.05, Math.sin(a2) * r2],
        hw, hh, hw * World.rr(0.9, 1.1), a2 + Math.PI * 0.5
      ));
    }

    out.push(World.snowman([-0.34 * s, y + 0.36 * s, 0.28 * s], 0.30 * s));
    out.push(World.snowman([0.42 * s, y + 0.26 * s, -0.30 * s], 0.22 * s));
    out.push(World.snowman([0.05 * s, y + 0.30 * s, 0.72 * s], 0.25 * s));
    out.push(World.house([-0.70 * s, y + 0.14 * s, -0.55 * s], 0.16 * s, 0.14 * s, 0.16 * s, 0.4));
    return out;
  };

  World.volcanoObjects = function (L) {
    World.seed(5150);
    var s = L.scale;
    var y = L.floorY;
    var out = [];
    for (var i = 0; i < 7; i++) {
      var a = (i / 7) * Math.PI * 2 + 0.4;
      var rad = L.cone.r0 * World.rr(1.15, 1.7);
      out.push(World.sphere(
        [Math.cos(a) * rad, y + World.rr(0.10, 0.35) * s, Math.sin(a) * rad],
        World.rr(0.10, 0.24) * s, [0.26, 0.22, 0.20]
      ));
    }
    return out;
  };

  World.openObjects = function (L) {
    var s = L.scale, y = L.floorY;
    return [
      World.sphere([-1.6 * s, y + 0.55 * s, 1.1 * s], 0.55 * s, [0.32, 0.36, 0.42]),
      World.sphere([1.7 * s, y + 0.40 * s, -1.3 * s], 0.40 * s, [0.40, 0.34, 0.28]),
      World.car([0.4 * s, y + 0.06 * s, -1.8 * s], 1.2, [0.20, 0.40, 0.72], s)
    ];
  };

  World.defaultObjects = function (key) {
    var L = World.LEVELS[key];
    if (!L) return [];
    if (L.city) return World.cityObjects(L);
    if (key === 'tank') return World.tankObjects(L);
    if (key === 'sphere') return World.snowObjects(L);
    if (key === 'volcano') return World.volcanoObjects(L);
    return World.openObjects(L);
  };

  /* ---------------- сценарии ----------------
     Сценарий задаёт набор источников — именно он решает, что и откуда льётся,
     поэтому по умолчанию не включаются все три потока сразу. */

  var SID = 0;
  function src(pos, dir, radius, speed, type, rate) {
    SID++;
    return {
      id: 's' + SID, pos: pos, dir: dir, radius: radius, speed: speed,
      type: type, rate: rate, enabled: true, acc: 0
    };
  }

  var SCEN = {
    /* Потоп: три вертикальных потока сверху */
    flood: function (L) {
      var s = L.scale, H = L.half, top = L.wallTop;
      return [
        src([-0.55 * H, top * 0.86, 0.12 * H], [0, -1, 0], 0.12 * s, 2.4 * s, 0, 420),
        src([0.55 * H, top * 0.92, -0.15 * H], [0, -1, 0], 0.105 * s, 2.6 * s, 0, 340),
        src([0.03 * H, top * 0.98, 0.52 * H], [0, -1, 0], 0.10 * s, 2.2 * s, 0, 280)
      ];
    },

    /* Цунами: валы воды бьют горизонтально, под 90° к стенкам */
    tsunami: function (L) {
      var s = L.scale, H = L.half;
      var y = L.min[1] + (L.wallTop - L.min[1]) * 0.42;
      return [
        src([-H * 0.96, y, 0], [1, 0, 0], 0.30 * s, 7.0 * s, 0, 1400),
        src([H * 0.96, y, 0], [-1, 0, 0], 0.30 * s, 7.0 * s, 0, 1400),
        src([0, y, -H * 0.96], [0, 0, 1], 0.26 * s, 6.4 * s, 0, 850),
        src([0, y, H * 0.96], [0, 0, -1], 0.26 * s, 6.4 * s, 0, 850)
      ];
    },

    /* Ливень: широкие медленные струи */
    rain: function (L) {
      var s = L.scale, H = L.half, top = L.wallTop;
      return [
        src([-0.45 * H, top * 0.95, -0.45 * H], [0, -1, 0], 0.26 * s, 1.2 * s, 0, 380),
        src([0.45 * H, top * 0.95, -0.45 * H], [0, -1, 0], 0.26 * s, 1.2 * s, 0, 380),
        src([-0.45 * H, top * 0.95, 0.45 * H], [0, -1, 0], 0.26 * s, 1.2 * s, 0, 380),
        src([0.45 * H, top * 0.95, 0.45 * H], [0, -1, 0], 0.26 * s, 1.2 * s, 0, 380)
      ];
    },

    /* Смешение: вода, нефть и лава */
    mix: function (L) {
      var s = L.scale, H = L.half, top = L.wallTop;
      return [
        src([-0.55 * H, top * 0.86, 0.12 * H], [0, -1, 0], 0.12 * s, 2.4 * s, 0, 400),
        src([0.58 * H, top * 0.92, -0.16 * H], [0, -1, 0], 0.105 * s, 2.6 * s, 1, 300),
        src([0.03 * H, top * 0.98, 0.55 * H], [0, -1, 0], 0.10 * s, 2.2 * s, 2, 240)
      ];
    },

    /* Фонтан: один поток бьёт вверх из центра */
    fountain: function (L) {
      var s = L.scale;
      return [
        src([0, L.min[1] + 0.10 * s, 0], [0, 1, 0], 0.09 * s, 5.4 * s, 0, 1100)
      ];
    },

    /* Водоворот */
    whirl: function (L) {
      var s = L.scale, H = L.half, top = L.wallTop;
      return [
        src([0.62 * H, top * 0.90, 0.10 * H], [0, -1, 0], 0.13 * s, 2.6 * s, 0, 700)
      ];
    },

    /* Снегопад: единственный источник — снег */
    snowfall: function (L) {
      var s = L.scale;
      var c = L.center || [0, 0, 0];
      return [
        src([c[0], c[1] + L.radius * 0.72, c[2]], [0, -1, 0],
          L.radius * 0.62, 0.12 * s, 4, 240)
      ];
    },

    /* Извержение: лава фонтаном вверх из жерла */
    eruption: function (L) {
      var s = L.scale;
      var y = L.floorY + L.cone.h;
      return [
        src([0, y + 0.20 * s, 0], [0, 1, 0], 0.15 * s, 5.6 * s, 2, 1200),
        src([0, y + 0.30 * s, 0], [0.20, 1, 0.12], 0.10 * s, 4.8 * s, 2, 420)
      ];
    },

    /* Река: горизонтальный поток с края */
    river: function (L) {
      var s = L.scale, H = L.half;
      var y = L.min[1] + 0.18 * s;
      return [
        src([-H * 0.92, y, 0], [1, 0, 0], 0.22 * s, 4.2 * s, 0, 1000)
      ];
    }
  };

  World.SCENARIOS = {
    city_mini: ['flood', 'tsunami', 'rain', 'mix'],
    city_mid: ['flood', 'tsunami', 'rain', 'mix'],
    city_big: ['flood', 'tsunami', 'rain', 'mix'],
    tank: ['mix', 'fountain', 'whirl'],
    sphere: ['snowfall'],
    volcano: ['eruption', 'rain'],
    open: ['river', 'rain', 'mix']
  };

  World.scenarioName = function (k) { return T('scen.' + k); };

  World.buildScenario = function (key, levelKey) {
    SID = 0;
    var L = World.LEVELS[levelKey] || World.LEVELS.city_mini;
    var fn = SCEN[key] || SCEN.flood;
    var list = fn(L);
    // на крупных уровнях поток должен быть плотнее, иначе он тонет в масштабе
    var k = Math.max(1, Math.sqrt(L.scale));
    list.forEach(function (s) {
      s.rate = Math.min(1600, Math.round(s.rate * k));
    });
    return list;
  };

  World.defaultScenario = function (levelKey) {
    var list = World.SCENARIOS[levelKey];
    return (list && list[0]) || 'flood';
  };

  World.defaultSources = function (levelKey, scenarioKey) {
    return World.buildScenario(scenarioKey || World.defaultScenario(levelKey), levelKey);
  };

  /* ---------------- зонд жидкости (карта высот + поток) ---------------- */

  function Probe(n) {
    this.n = n;
    var sz = n * n;
    this.h = new Float32Array(sz);
    this.vx = new Float32Array(sz);
    this.vy = new Float32Array(sz);
    this.vz = new Float32Array(sz);
    this.cnt = new Float32Array(sz);
    this.minX = -1; this.maxX = 1; this.minZ = -1; this.maxZ = 1;
    this.baseY = -1;
  }

  Probe.prototype.configure = function (minX, maxX, minZ, maxZ, baseY) {
    this.minX = minX; this.maxX = maxX;
    this.minZ = minZ; this.maxZ = maxZ;
    this.baseY = baseY;
  };

  Probe.prototype.update = function (sim) {
    var n = this.n, sz = n * n;
    this.h.fill(-999);
    this.vx.fill(0); this.vy.fill(0); this.vz.fill(0); this.cnt.fill(0);
    var spanX = this.maxX - this.minX || 1;
    var spanZ = this.maxZ - this.minZ || 1;
    var invX = n / spanX, invZ = n / spanZ;
    var p = sim.posCPU, v = sim.velCPU;
    for (var i = 0; i < sim.N; i++) {
      if (!sim.alive[i]) continue;
      var y = p[i * 4 + 1];
      if (y < -500) continue;
      var x = p[i * 4], z = p[i * 4 + 2];
      var cx = ((x - this.minX) * invX) | 0;
      var cz = ((z - this.minZ) * invZ) | 0;
      if (cx < 0) cx = 0; else if (cx >= n) cx = n - 1;
      if (cz < 0) cz = 0; else if (cz >= n) cz = n - 1;
      var k = cz * n + cx;
      if (y > this.h[k]) this.h[k] = y;
      this.vx[k] += v[i * 4];
      this.vy[k] += v[i * 4 + 1];
      this.vz[k] += v[i * 4 + 2];
      this.cnt[k] += 1;
    }
    for (var j = 0; j < sz; j++) {
      var c = this.cnt[j];
      if (c > 0) {
        this.vx[j] /= c; this.vy[j] /= c; this.vz[j] /= c;
      } else {
        this.h[j] = this.baseY;
      }
    }

    if (!this._sh) {
      this._sh = new Float32Array(sz);
      this._svx = new Float32Array(sz);
      this._svy = new Float32Array(sz);
      this._svz = new Float32Array(sz);
    }
    var sh = this._sh, svx = this._svx, svy = this._svy, svz = this._svz;
    for (var z2 = 0; z2 < n; z2++) {
      for (var x2 = 0; x2 < n; x2++) {
        var k2 = z2 * n + x2;
        var accH = 0, accN = 0, ax = 0, ay = 0, az = 0;
        for (var dz2 = -1; dz2 <= 1; dz2++) {
          for (var dx2 = -1; dx2 <= 1; dx2++) {
            var nx2 = x2 + dx2, nz2 = z2 + dz2;
            if (nx2 < 0 || nz2 < 0 || nx2 >= n || nz2 >= n) continue;
            var kk = nz2 * n + nx2;
            if (this.cnt[kk] < 4) continue;
            var w = (dx2 === 0 && dz2 === 0) ? 2 : 1;
            accH += this.h[kk] * w; accN += w;
            ax += this.vx[kk] * w; ay += this.vy[kk] * w; az += this.vz[kk] * w;
          }
        }
        if (accN > 0) {
          sh[k2] = accH / accN;
          svx[k2] = ax / accN; svy[k2] = ay / accN; svz[k2] = az / accN;
        } else {
          sh[k2] = this.baseY; svx[k2] = 0; svy[k2] = 0; svz[k2] = 0;
        }
      }
    }
  };

  Probe.prototype.sample = function (x, z) {
    var n = this.n;
    var spanX = this.maxX - this.minX || 1;
    var spanZ = this.maxZ - this.minZ || 1;
    var fx = (x - this.minX) / spanX * n - 0.5;
    var fz = (z - this.minZ) / spanZ * n - 0.5;
    var x0 = Math.floor(fx), z0 = Math.floor(fz);
    var tx = fx - x0, tz = fz - z0;
    var out = { height: this.baseY, vx: 0, vy: 0, vz: 0, count: 0 };
    var acc = [0, 0, 0, 0, 0];
    for (var dz = 0; dz <= 1; dz++) {
      for (var dx = 0; dx <= 1; dx++) {
        var cx = x0 + dx, cz = z0 + dz;
        if (cx < 0) cx = 0; else if (cx >= n) cx = n - 1;
        if (cz < 0) cz = 0; else if (cz >= n) cz = n - 1;
        var k = cz * n + cx;
        var w = (dx ? tx : 1 - tx) * (dz ? tz : 1 - tz);
        acc[0] += this._sh[k] * w;
        acc[1] += this._svx[k] * w;
        acc[2] += this._svy[k] * w;
        acc[3] += this._svz[k] * w;
        acc[4] += this.cnt[k] * w;
      }
    }
    out.height = acc[0];
    out.vx = acc[1]; out.vy = acc[2]; out.vz = acc[3];
    out.count = acc[4];
    return out;
  };

  World.Probe = Probe;
  World.probe = new Probe(28);

  /* ---------------- физика машин ---------------- */

  function pushOutJS(pos, half, level, objects) {
    if (level.kind === 'box') {
      var lo = level.min, hi = level.max;
      if (pos[1] - half[1] < lo[1]) { pos[1] = lo[1] + half[1]; return 'floor'; }
      if (pos[1] < level.wallTop) {
        if (pos[0] - half[0] < lo[0]) pos[0] = lo[0] + half[0];
        if (pos[0] + half[0] > hi[0]) pos[0] = hi[0] - half[0];
        if (pos[2] - half[2] < lo[2]) pos[2] = lo[2] + half[2];
        if (pos[2] + half[2] > hi[2]) pos[2] = hi[2] - half[2];
      }
    } else if (level.kind === 'sphere') {
      var c = level.center, R = level.radius;
      var dx = pos[0] - c[0], dy = pos[1] - c[1], dz = pos[2] - c[2];
      var d = Math.hypot(dx, dy, dz);
      var lim = R - Math.max(half[0], half[1], half[2]);
      if (d > lim && d > 1e-6) {
        pos[0] = c[0] + dx / d * lim;
        pos[1] = c[1] + dy / d * lim;
        pos[2] = c[2] + dz / d * lim;
      }
    } else {
      if (pos[1] - half[1] < level.min[1]) { pos[1] = level.min[1] + half[1]; return 'floor'; }
      if (pos[0] < level.min[0] + half[0]) pos[0] = level.min[0] + half[0];
      if (pos[0] > level.max[0] - half[0]) pos[0] = level.max[0] - half[0];
      if (pos[2] < level.min[2] + half[2]) pos[2] = level.min[2] + half[2];
      if (pos[2] > level.max[2] - half[2]) pos[2] = level.max[2] - half[2];
    }
    for (var i = 0; i < objects.length; i++) {
      var o = objects[i];
      if (o.kind !== 'building') continue;
      var ca = Math.cos(-o.rot), sa = Math.sin(-o.rot);
      var rx = pos[0] - o.pos[0], rz = pos[2] - o.pos[2];
      var lx = rx * ca - rz * sa;
      var lz = rx * sa + rz * ca;
      var ex = o.size[0] + half[0], ez = o.size[2] + half[2];
      var ey = o.size[1] + half[1];
      var ly = pos[1] - o.pos[1];
      if (Math.abs(lx) < ex && Math.abs(lz) < ez && Math.abs(ly) < ey) {
        var px = ex - Math.abs(lx), pz = ez - Math.abs(lz), py = ey - Math.abs(ly);
        if (py <= px && py <= pz) {
          pos[1] = o.pos[1] + Math.sign(ly || 1) * ey;
        } else if (px <= pz) {
          var nlx = Math.sign(lx || 1) * ex;
          pos[0] = o.pos[0] + nlx * ca + lz * sa;
          pos[2] = o.pos[2] - nlx * sa + lz * ca;
        } else {
          var nlz = Math.sign(lz || 1) * ez;
          pos[0] = o.pos[0] + lx * ca + nlz * sa;
          pos[2] = o.pos[2] - lx * sa + nlz * ca;
        }
        return 'box';
      }
    }
    return null;
  }

  World.updateDynamic = function (dt, sim, level, objects, gravity) {
    var probe = World.probe;
    var s = level.scale || 1;
    if (level.kind === 'box' || level.kind === 'none') {
      probe.configure(level.min[0], level.max[0], level.min[2], level.max[2], level.min[1]);
    } else {
      probe.configure(-level.radius, level.radius, -level.radius, level.radius,
        level.center[1] - level.radius);
    }
    probe.update(sim);

    var g = Math.abs(gravity === undefined ? -9.81 : gravity) * s;

    for (var i = 0; i < objects.length; i++) {
      var o = objects[i];
      if (!o.dynamic) continue;
      if (!o.vel) { o.vel = [0, 0, 0]; o.yaw = o.rot || 0; o.yawVel = 0; }

      var smp = probe.sample(o.pos[0], o.pos[2]);
      var bottom = o.pos[1] - o.size[1];
      var sub = (smp.height - bottom) / (o.size[1] * 2);
      if (sub < 0) sub = 0; else if (sub > 1) sub = 1;

      var v = o.vel;
      var buoy = 19.5;
      v[1] += (buoy * sub - g * (1 - sub * 0.8)) * dt;

      var k = 4.2 * sub;
      v[0] += (smp.vx - v[0]) * k * dt;
      v[2] += (smp.vz - v[2]) * k * dt;
      v[1] += (smp.vy - v[1]) * k * 0.35 * dt;

      var yawTarget = (smp.vx * Math.cos(o.yaw) - smp.vz * Math.sin(o.yaw)) * 1.4;
      o.yawVel += (yawTarget - o.yawVel) * 3.0 * dt;
      o.yaw += o.yawVel * dt;

      v[0] *= (1 - 0.9 * dt);
      v[2] *= (1 - 0.9 * dt);
      if (sub < 0.05) v[1] *= (1 - 0.2 * dt);

      o.pos[0] += v[0] * dt;
      o.pos[1] += v[1] * dt;
      o.pos[2] += v[2] * dt;
      o.rot = o.yaw;

      var hit = pushOutJS(o.pos, o.size, level, objects);
      if (hit === 'floor' || hit === 'box') {
        if (v[1] < 0) v[1] *= -0.15;
      }
      if (level.kind === 'box') {
        if (o.pos[0] <= level.min[0] + o.size[0] + 1e-4 || o.pos[0] >= level.max[0] - o.size[0] - 1e-4) v[0] *= -0.2;
        if (o.pos[2] <= level.min[2] + o.size[2] + 1e-4 || o.pos[2] >= level.max[2] - o.size[2] - 1e-4) v[2] *= -0.2;
      }

      var sp = Math.hypot(v[0], v[1], v[2]);
      var lim = 5 * s;
      if (sp > lim) { v[0] *= lim / sp; v[1] *= lim / sp; v[2] *= lim / sp; }
    }
  };

  World.pushOutJS = pushOutJS;

  /* ---------------- нормализация объектов из storage ---------------- */

  World.normalize = function (list) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (o) {
      return o && typeof o === 'object' && o.kind && Array.isArray(o.pos);
    }).map(function (o) {
      if (!Array.isArray(o.color)) o.color = [0.4, 0.45, 0.5];
      if (o.kind === 'building' || o.kind === 'car' || o.kind === 'tree' || o.kind === 'house') {
        if (!Array.isArray(o.size)) o.size = [0.15, 0.25, 0.15];
        o.rot = o.rot || 0;
      }
      if ((o.kind === 'sphere' || o.kind === 'mound' || o.kind === 'snowman') && typeof o.r !== 'number') o.r = 0.2;
      if (o.kind === 'portal') {
        if (!Array.isArray(o.normal)) o.normal = [0, 1, 0];
        if (typeof o.r !== 'number') o.r = 0.19;
      }
      if (o.kind === 'field') {
        if (!Array.isArray(o.dir)) o.dir = [0, 1, 0];
        if (typeof o.radius !== 'number') o.radius = 0.42;
        if (typeof o.strength !== 'number') o.strength = 14;
        if (!o.mode) o.mode = 'repel';
      }
      if (o.kind === 'car') o.dynamic = true;
      return o;
    });
  };
})();
