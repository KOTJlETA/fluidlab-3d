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
    { key: 'water', css: '#2173d1', fluid: true, spacing: 0.082, visc: 0.06, buoy: 0.0, grav: 1.0, drag: 0.0 },
    { key: 'oil', css: '#a86a1a', fluid: true, spacing: 0.094, visc: 0.35, buoy: 0.35, grav: 1.0, drag: 0.0 },
    { key: 'lava', css: '#ff5210', fluid: true, spacing: 0.075, visc: 8.0, buoy: -0.9, grav: 1.0, drag: 0.0 },
    { key: 'slime', css: '#33d961', fluid: true, spacing: 0.086, visc: 2.4, buoy: 0.0, grav: 1.0, drag: 0.0 },
    { key: 'snow', css: '#eef4ff', fluid: false, spacing: 0.070, visc: 0.0, buoy: 0.0, grav: 0.12, drag: 3.4 },
    { key: 'sand', css: '#d9c48a', fluid: false, spacing: 0.070, visc: 0.0, buoy: 0.0, grav: 0.95, drag: 0.7 },
    { key: 'dust', css: '#b9b2a6', fluid: false, spacing: 0.070, visc: 0.0, buoy: 0.0, grav: 0.10, drag: 3.2 },
    { key: 'rain', css: '#8aa2b4', fluid: false, spacing: 0.075, visc: 0.0, buoy: 0.0, grav: 1.0, drag: 0.35, rad: 0.17 }
  ];
  World.typeName = function (i) { return T('type.' + World.TYPES[i].key); };

  /* ---------------- уровни ----------------
     Города строятся по тайлам: размер клетки, зданий, машин и частиц одинаков
     на всех уровнях — отличается только число тайлов, то есть число зданий. */

  World.CITY = {
    cell: 0.22,
    foot: [0.54, 0.70],
    hMin: 0.09, hMax: 0.46, hTower: 0.62,
    fill: 0.74
  };

  function mkLevel(o) {
    var s = o.scale === undefined ? 1 : o.scale;
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
      city: !!o.city, cityN: o.cityN || 0, maxCars: o.maxCars || 0,
      cone: o.cone || null,
      frac: o.frac === undefined ? 0.16 : o.frac,
      island: !!o.island
    };
    if (o.kind === 'sphere') {
      L.center = [0, -0.15 * s, 0];
      L.radius = 2.0 * s;
      L.half = 2.0 * s;
      L.camDist = L.radius * 2.9;
    }
    if (L.city) {
      L.cell = World.CITY.cell;
      L.cityHalf = (L.cityN * L.cell) * 0.5;
      L.half = L.cityHalf;
      // частицы и скорости — под масштаб кварталов, геометрия арены остаётся 1:1
      L.scale = 0.12;
      L.floorY = -1.6;
      L.wallTop = 1.6;
      L.min = [-L.half, -1.6, -L.half];
      L.max = [L.half, 1.6, L.half];
      L.camDist = L.half * (o.camK || 1.55);
    }
    L.name = T('level.' + o.key);
    return L;
  }

  World.LEVELS = {
    city_mini: mkLevel({
      key: 'city_mini', kind: 'box', floorStyle: 1,
      sky: 'night', city: true, cityN: 12, maxCars: 0
    }),
    city_mid: mkLevel({
      key: 'city_mid', kind: 'box', floorStyle: 1,
      sky: 'night', city: true, cityN: 28, maxCars: 8
    }),
    city_big: mkLevel({
      key: 'city_big', kind: 'box', floorStyle: 1,
      sky: 'night', city: true, cityN: 58, maxCars: 26
    }),
    sphere: mkLevel({
      key: 'sphere', kind: 'sphere', scale: 1.05, half: 2.1, floorStyle: 3,
      sky: 'xmas', camK: 2.9, frac: 0.0
    }),
    volcano: mkLevel({
      key: 'volcano', kind: 'none', scale: 2.0, half: 17.0, floorStyle: 5,
      sky: 'day', camK: 1.38, island: true, frac: 0.0, terrain: true,
      cone: { r0: 5.4, r1: 1.55, h: 6.6 }
    }),
    portal: mkLevel({
      key: 'portal', kind: 'box', scale: 0.55, half: 2.0, floorStyle: 0,
      sky: 'nebula', camK: 2.35
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

  World.car = function (pos, rot, color) {
    return {
      id: World.uid(), kind: 'car', pos: pos.slice(), rot: rot || 0,
      size: [0.030, 0.020, 0.058], color: color || [0.55, 0.16, 0.14],
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

  /* пальма: коричневый ствол, зелёная крона */
  World.palm = function (pos, h, r) {
    return {
      id: World.uid(), kind: 'palm', pos: pos.slice(), rot: World.rr(0, Math.PI * 2),
      size: [r, h * 0.5, r], color: [1, 1, 1]
    };
  };

  World.rock = function (pos, r, color) {
    return {
      id: World.uid(), kind: 'rock', pos: pos.slice(), rot: World.rr(0, Math.PI * 2),
      size: [r, r * 0.72, r], color: color || [0.42, 0.42, 0.44]
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

  /* ---------------- город: тайловая сетка ---------------- */

  var PALETTE = [
    [0.30, 0.34, 0.44], [0.36, 0.31, 0.38], [0.26, 0.36, 0.44],
    [0.42, 0.36, 0.32], [0.32, 0.32, 0.38], [0.24, 0.30, 0.36]
  ];
  var CAR_COLORS = [
    [0.72, 0.20, 0.16], [0.20, 0.40, 0.72], [0.82, 0.70, 0.18],
    [0.62, 0.24, 0.62], [0.22, 0.62, 0.52], [0.70, 0.70, 0.72]
  ];

  /* Возвращает { tiles: Float32Array(n*n*4), objects: [...] }
     тайл: (hx, hy, hz, занят) — половина пятна застройки в мировых единицах */
  World.buildCity = function (L) {
    var C = World.CITY;
    var n = L.cityN;
    World.seed(90210 + n * 7919);
    var cell = C.cell;
    var x0 = -L.cityHalf;
    var tiles = new Float32Array(n * n * 4);
    var objs = [];

    var plazaI = Math.floor(n * 0.5), plazaJ = Math.floor(n * 0.5);
    var plazaR = Math.max(1, Math.round(n * 0.10));
    var avenue = Math.floor(n * World.rr(0.28, 0.72));

    for (var i = 0; i < n; i++) {
      for (var j = 0; j < n; j++) {
        var k = (j * n + i) * 4;
        var di = i - plazaI, dj = j - plazaJ;
        if ((di * di + dj * dj) <= plazaR * plazaR) continue;
        if (i === avenue || j === avenue) continue;
        if (World.rnd() > C.fill) continue;

        var fw = cell * World.rr(C.foot[0], C.foot[1]);
        var fd = cell * World.rr(C.foot[0], C.foot[1]);
        var h = World.rr(C.hMin, C.hMax);
        var cd = Math.hypot(di, dj) / (n * 0.5);
        if (cd < 0.55 && World.rnd() < 0.22) h = World.rr(C.hMax * 0.9, C.hTower);

        var cx = x0 + (i + 0.5) * cell;
        var cz = x0 + (j + 0.5) * cell;

        tiles[k] = fw * 0.5;
        tiles[k + 1] = h * 0.5;
        tiles[k + 2] = fd * 0.5;
        tiles[k + 3] = 1;

        objs.push(World.building(
          [cx, L.floorY + h * 0.5, cz], fw * 0.5, h * 0.5, fd * 0.5, 0,
          PALETTE[(i * 3 + j * 5) % PALETTE.length]
        ));
      }
    }

    var maxC = L.maxCars;
    for (var c = 0; c < maxC; c++) {
      var along = World.rnd() < 0.5;
      var line = (Math.floor(World.rnd() * (n - 1)) + 1) * cell + x0;
      var t = World.rr(-L.cityHalf * 0.9, L.cityHalf * 0.9);
      objs.push(World.car(
        [along ? t : line, L.floorY + 0.014, along ? line : t],
        along ? 0 : Math.PI / 2,
        CAR_COLORS[c % CAR_COLORS.length]
      ));
    }

    return { tiles: tiles, objects: objs };
  };

  /* Запрос тайла по мировой координате: { hx, hy, hz } или null */
  World.cityTileAt = function (L, x, z) {
    if (!L.city || !L.tiles) return null;
    var cell = L.cell, n = L.cityN;
    var i = Math.floor((x - L.min[0]) / cell);
    var j = Math.floor((z - L.min[2]) / cell);
    if (i < 0 || j < 0 || i >= n || j >= n) return null;
    var k = (j * n + i) * 4;
    var t = L.tiles;
    if (t[k + 3] < 0.5) return null;
    return { hx: t[k], hy: t[k + 1], hz: t[k + 2] };
  };

  /* ---------------- снежный шар ---------------- */

  World.snowObjects = function (L) {
    World.seed(777);
    var s = L.scale;
    var out = [];
    var y = L.floorY;
    var R = L.radius || 2.1;

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

  /* ---------------- рельеф острова ---------------- */

  function hash2(x, y) {
    var s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
  }
  function vnoise(x, y) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var xf = x - xi, yf = y - yi;
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    var a = hash2(xi, yi), b = hash2(xi + 1, yi);
    var c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }
  function fbm(x, y, oct) {
    var s = 0, a = 0.5, f = 1;
    for (var i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; }
    return s;
  }
  function sstep(a, b, x) {
    var t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  /* Высота рельефа в точке (от уровня пола) */
  World.volcanoHeight = function (x, z, half) {
    var R = half, r = Math.hypot(x, z), rn = r / R;
    var island = 1 - sstep(0.78, 1.0, rn);
    var hills = (fbm(x * 0.085 + 11, z * 0.085 - 4, 4) - 0.5) * 2.0;
    var h = island * (0.42 + hills * 0.9);

    // горные гребни
    var ridge = 1 - Math.abs(fbm(x * 0.055 - 2, z * 0.055 + 5, 4) * 2 - 1);
    h += Math.pow(ridge, 3) * 2.6 * island;

    // промоины и овраги на равнине
    var rv = Math.abs(fbm(x * 0.048 + 3.1, z * 0.048 + 7.7, 3) - 0.5);
    h -= Math.pow(1 - Math.min(1, rv * 7), 3) * 1.15 * island;

    // за пределами острова дно уходит под воду — иначе совпадает с плоскостью моря
    h -= (1 - island) * 2.2;

    // вулкан: усечённый конус с чашей кратера
    var R0 = 5.4, R1 = 1.55, H = 6.6;
    if (r < R0) {
      if (r < R1) {
        h += H * (0.40 + 0.60 * Math.pow(r / R1, 1.7));
      } else {
        var t = (r - R1) / (R0 - R1);
        h += H * Math.pow(1 - t, 1.30);
      }
      // радиальные расщелины по склону
      var ang = Math.atan2(z, x);
      var g = Math.pow(Math.max(0, Math.cos(ang * 9.0 + 0.6)), 5.0);
      var gs = Math.min(1, Math.max(0, (r - R1) / (R0 - R1)));
      h -= g * 1.45 * gs;
      // мелкая шероховатость склона
      h += (fbm(x * 0.9, z * 0.9, 2) - 0.5) * 0.28 * gs;
    }
    return h;
  };

  World.buildTerrain = function (L) {
    var n = 128, half = L.half;
    var t = { n: n, half: half, h: new Float32Array(n * n) };
    for (var j = 0; j < n; j++) {
      for (var i = 0; i < n; i++) {
        var x = -half + (i + 0.5) / n * (2 * half);
        var z = -half + (j + 0.5) / n * (2 * half);
        t.h[j * n + i] = World.volcanoHeight(x, z, half);
      }
    }
    L.terrain = t;
    return t;
  };

  World.terrainHeight = function (L, x, z) {
    var t = L.terrain;
    if (!t) return 0;
    var n = t.n, half = t.half;
    var fx = (x + half) / (2 * half) * n - 0.5;
    var fz = (z + half) / (2 * half) * n - 0.5;
    var i0 = Math.floor(fx), j0 = Math.floor(fz);
    var tx = fx - i0, tz = fz - j0;
    var g = function (i, j) {
      if (i < 0) i = 0; else if (i >= n) i = n - 1;
      if (j < 0) j = 0; else if (j >= n) j = n - 1;
      return t.h[j * n + i];
    };
    return (g(i0, j0) * (1 - tx) + g(i0 + 1, j0) * tx) * (1 - tz) +
           (g(i0, j0 + 1) * (1 - tx) + g(i0 + 1, j0 + 1) * tx) * tz;
  };

  /* ---------------- тропический остров с вулканом ---------------- */

  World.volcanoObjects = function (L) {
    World.seed(5150);
    var s = L.scale;
    var y = L.floorY;
    var H = L.half;
    var R0 = L.cone.r0;
    var out = [];

    function ground(x, z) { return y + World.terrainHeight(L, x, z); }

    // камни у подножия и по склонам
    for (var i = 0; i < 26; i++) {
      var a = (i / 26) * Math.PI * 2 + World.rr(-0.16, 0.16);
      var rad = R0 * World.rr(0.92, 1.65);
      var px = Math.cos(a) * rad, pz = Math.sin(a) * rad;
      var rr = World.rr(0.10, 0.30);
      out.push(World.rock([px, ground(px, pz) + rr * 0.35, pz], rr,
        [World.rr(0.36, 0.50), World.rr(0.36, 0.50), World.rr(0.38, 0.52)]));
    }

    // пальмы по всему острову
    var NP = 150;
    for (var t = 0; t < NP; t++) {
      var ang = World.rnd() * Math.PI * 2;
      var dist = Math.sqrt(World.rnd()) * H * 0.94;
      if (dist < R0 * 1.02) continue;
      var px2 = Math.cos(ang) * dist, pz2 = Math.sin(ang) * dist;
      var gy = World.terrainHeight(L, px2, pz2);
      if (gy < 0.10) continue;
      var h = World.rr(0.9, 2.1);
      out.push(World.palm([px2, y + gy + h * 0.5, pz2], h, h * 0.24));
    }

    // подлесок: кусты и мелкие камни
    var NB = 150;
    for (var b = 0; b < NB; b++) {
      var ang2 = World.rnd() * Math.PI * 2;
      var d2 = Math.sqrt(World.rnd()) * H * 0.96;
      if (d2 < R0 * 0.98) continue;
      var bx = Math.cos(ang2) * d2, bz = Math.sin(ang2) * d2;
      var gy2 = World.terrainHeight(L, bx, bz);
      if (gy2 < 0.08) continue;
      if (World.rnd() < 0.45) {
        var hr = World.rr(0.09, 0.22);
        out.push(World.rock([bx, y + gy2 + hr * 0.3, bz], hr,
          [World.rr(0.34, 0.46), World.rr(0.34, 0.46), World.rr(0.36, 0.48)]));
      } else {
        var hh = World.rr(0.35, 0.95);
        out.push(World.tree([bx, y + gy2 + hh * 0.5, bz], hh, hh * 0.32,
          [0.09, 0.30, 0.13]));
      }
    }

    // редкие валуны на склоне вулкана
    for (var k = 0; k < 18; k++) {
      var ak = World.rnd() * Math.PI * 2;
      var dk = R0 * World.rr(0.35, 0.95);
      var kx = Math.cos(ak) * dk, kz = Math.sin(ak) * dk;
      var kr = World.rr(0.16, 0.34);
      out.push(World.rock([kx, ground(kx, kz) + kr * 0.3, kz], kr,
        [World.rr(0.30, 0.42), World.rr(0.30, 0.42), World.rr(0.32, 0.44)]));
    }
    return out;
  };

  World.openObjects = function (L) {
    var s = L.scale, y = L.floorY;
    return [
      World.rock([-1.6 * s, y + 0.30 * s, 1.1 * s], 0.42 * s, [0.40, 0.40, 0.42]),
      World.palm([1.7 * s, y + 0.62 * s, -1.3 * s], 1.24 * s, 0.32 * s),
      World.rock([0.5 * s, y + 0.18 * s, -1.7 * s], 0.26 * s, [0.36, 0.36, 0.38])
    ];
  };

  /* ---------------- портальная лаборатория ---------------- */

  World.portalObjects = function (L) {
    World.seed(4242);
    var s = L.scale, y = L.floorY, out = [];
    var R = 0.30;

    // вода бьёт в A, вылетает из B
    var p1 = World.portalPair([-1.30, 0.72, 0.00], [1, 0, 0],
                              [1.24, 0.95, -0.92], [0, 0, 1], [0.35, 0.95, 0.85], R / 0.19);
    out.push(p1[0], p1[1]);

    // поток от B входит в C, выходит из D вниз
    var p2 = World.portalPair([1.24, 0.95, 0.92], [0, 0, -1],
                              [-0.92, 0.46, 1.34], [0, -1, 0], [0.95, 0.55, 0.95], R / 0.19);
    out.push(p2[0], p2[1]);

    // лужа на полу входит в E, фонтан выходит из F
    var p3 = World.portalPair([-0.92, y + 0.05, 1.34], [0, 1, 0],
                              [1.45, 1.32, 0.42], [0, -1, 0], [0.55, 0.85, 1.0], R / 0.19);
    out.push(p3[0], p3[1]);

    // препятствия между порталами
    out.push(World.building([0.10, y + 0.55, -0.35], 0.30, 0.55, 0.30, 0, [0.22, 0.26, 0.34]));
    out.push(World.building([-0.55, y + 0.30, -1.05], 0.42, 0.30, 0.26, 0, [0.26, 0.24, 0.30]));
    out.push(World.sphere([0.62, y + 0.34, 1.10], 0.34, [0.30, 0.38, 0.46]));
    out.push(World.sphere([-1.45, y + 0.24, -1.20], 0.24, [0.36, 0.30, 0.24]));
    return out;
  };

  World.defaultObjects = function (key) {
    var L = World.LEVELS[key];
    if (!L) return [];
    // объекты ставятся по карте высот: на свежей загрузке её ещё нет
    if (L.cone && !L.terrain) World.buildTerrain(L);
    if (L.city) {
      var city = World.buildCity(L);
      L.tiles = city.tiles;
      return city.objects;
    }
    if (key === 'sphere') return World.snowObjects(L);
    if (key === 'volcano') {
      World.buildTerrain(L);
      return World.volcanoObjects(L);
    }
    if (key === 'portal') return World.portalObjects(L);
    return World.openObjects(L);
  };

  /* ---------------- сценарии ----------------
     По умолчанию у уровня ОДИН источник. Несколько — только там, где это
     часть замысла сценария (цунами с четырёх стен, прорыв канализации). */

  var SID = 0;
  function src(pos, dir, radius, speed, type, rate) {
    SID++;
    return {
      id: 's' + SID, pos: pos, dir: dir, radius: radius, speed: speed,
      type: type, rate: rate, enabled: true, acc: 0
    };
  }

  function citySpots(L, count) {
    var out = [];
    var n = L.cityN, cell = L.cell, x0 = -L.cityHalf;
    for (var c = 0; c < count; c++) {
      var i = Math.floor(World.rnd() * n), j = Math.floor(World.rnd() * n);
      out.push([x0 + (i + 0.5) * cell, x0 + (j + 0.5) * cell]);
    }
    return out;
  }

  var SCEN = {
    /* Цунами: валы бьют горизонтально с четырёх стен */
    tsunami: function (L) {
      var H = L.half;
      var y = L.min[1] + (L.wallTop - L.min[1]) * 0.16;
      // один вал во всю стену
      return [
        src([-H * 0.99, y, 0], [1, 0, 0], H * 0.98, 4.6, 0, 3400)
      ];
    },

    /* Ливень: один широкий медленный поток сверху */
    rain: function (L) {
      // сопло размером во весь уровень: капли падают по всей площади, а не из трубы
      // для острова — выше вершины, иначе капли рождаются внутри горы
      var y = L.terrain ? (L.floorY + L.cone.h + 9.5) : L.wallTop * 1.6;
      return [
        src([0, y, 0], [0, -1, 0], L.half * 1.06, 0.7, 7, 2800)
      ];
    },

    /* Прорыв канализации: множество крошечных нефтяных струй из-под земли */
    sewer: function (L) {
      var y = L.floorY;
      return citySpots(L, 20).map(function (p) {
        return src([p[0], y + 0.02, p[1]], [0, 1, 0], 0.030, 0.75, 1, 70);
      });
    },

    /* Смешение: вода, нефть и лава */
    mix: function (L) {
      var H = L.half, top = L.wallTop;
      return [
        src([-0.55 * H, top * 0.86, 0.12 * H], [0, -1, 0], 0.05, 1.4, 0, 380),
        src([0.58 * H, top * 0.92, -0.16 * H], [0, -1, 0], 0.045, 1.5, 1, 300),
        src([0.03 * H, top * 0.98, 0.55 * H], [0, -1, 0], 0.045, 1.3, 2, 240)
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
      var y = L.floorY + L.cone.h * 0.44;
      return [
        src([0, y, 0], [0, 1, 0], 0.22, 6.5, 2, 1500)
      ];
    },

    /* Портальная петля: струя уходит в портал и гоняется по кругу */
    portaljet: function (L) {
      var y = L.floorY;
      return [
        src([-1.86, y + 2.32, 0], [1, 0, 0], 0.06, 1.1, 0, 520)
      ];
    },

    /* Река: горизонтальный поток с края */
    river: function (L) {
      var H = L.half, s = L.scale;
      var y = L.min[1] + 0.18 * s;
      return [
        src([-H * 0.92, y, 0], [1, 0, 0], 0.10 * s, 2.0 * s, 0, 1000)
      ];
    }
  };

  World.SCENARIOS = {
    city_mini: ['tsunami', 'sewer', 'rain', 'mix'],
    city_mid: ['tsunami', 'sewer', 'rain', 'mix'],
    city_big: ['tsunami', 'sewer', 'rain', 'mix'],
    sphere: ['snowfall'],
    volcano: ['eruption', 'rain'],
    portal: ['portaljet']
  };

  World.scenarioName = function (k) { return T('scen.' + k); };

  World.buildScenario = function (key, levelKey) {
    SID = 0;
    var L = World.LEVELS[levelKey] || World.LEVELS.city_mini;
    // сценарий мог исчезнуть из списка — берём первый доступный для уровня
    var list = World.SCENARIOS[levelKey] || [];
    var k = list.indexOf(key) >= 0 ? key : list[0];
    var fn = SCEN[k] || SCEN.rain || SCEN.eruption;
    return fn ? fn(L) : [];
  };

  World.defaultScenario = function (levelKey) {
    var list = World.SCENARIOS[levelKey];
    return (list && list[0]) || 'rain';
  };

  // валиден ли сценарий для уровня
  World.validScenario = function (levelKey, key) {
    var list = World.SCENARIOS[levelKey] || [];
    return list.indexOf(key) >= 0 ? key : list[0];
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

    // город: столкновение по тайлу, без перебора тысяч зданий
    if (level.city) {
      var tile = World.cityTileAt(level, pos[0], pos[2]);
      if (tile) {
        var cx = level.min[0] + (Math.floor((pos[0] - level.min[0]) / level.cell) + 0.5) * level.cell;
        var cz = level.min[2] + (Math.floor((pos[2] - level.min[2]) / level.cell) + 0.5) * level.cell;
        var ex = tile.hx + half[0], ez = tile.hz + half[2];
        var cy = level.floorY + tile.hy;
        var ey = tile.hy + half[1];
        var lx = pos[0] - cx, lz = pos[2] - cz, ly = pos[1] - cy;
        if (Math.abs(lx) < ex && Math.abs(lz) < ez && Math.abs(ly) < ey) {
          var px = ex - Math.abs(lx), pz = ez - Math.abs(lz), py = ey - Math.abs(ly);
          if (py <= px && py <= pz) pos[1] = cy + Math.sign(ly || 1) * ey;
          else if (px <= pz) pos[0] = cx + Math.sign(lx || 1) * ex;
          else pos[2] = cz + Math.sign(lz || 1) * ez;
          return 'box';
        }
      }
      return null;
    }

    for (var i = 0; i < objects.length; i++) {
      var o = objects[i];
      if (o.kind !== 'building') continue;
      var ca = Math.cos(-o.rot), sa = Math.sin(-o.rot);
      var rx = pos[0] - o.pos[0], rz = pos[2] - o.pos[2];
      var lx2 = rx * ca - rz * sa;
      var lz2 = rx * sa + rz * ca;
      var ex2 = o.size[0] + half[0], ez2 = o.size[2] + half[2];
      var ey2 = o.size[1] + half[1];
      var ly2 = pos[1] - o.pos[1];
      if (Math.abs(lx2) < ex2 && Math.abs(lz2) < ez2 && Math.abs(ly2) < ey2) {
        var px2 = ex2 - Math.abs(lx2), pz2 = ez2 - Math.abs(lz2), py2 = ey2 - Math.abs(ly2);
        if (py2 <= px2 && py2 <= pz2) {
          pos[1] = o.pos[1] + Math.sign(ly2 || 1) * ey2;
        } else if (px2 <= pz2) {
          var nlx = Math.sign(lx2 || 1) * ex2;
          pos[0] = o.pos[0] + nlx * ca + lz2 * sa;
          pos[2] = o.pos[2] - nlx * sa + lz2 * ca;
        } else {
          var nlz = Math.sign(lz2 || 1) * ez2;
          pos[0] = o.pos[0] + lx2 * ca + nlz * sa;
          pos[2] = o.pos[2] - lx2 * sa + nlz * ca;
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

      // машина НЕ плавает: только гравитация и пол, вода её толкает и опрокидывает
      v[1] -= g * dt;

      var k = 7.5 * sub;
      v[0] += (smp.vx - v[0]) * k * dt;
      v[2] += (smp.vz - v[2]) * k * dt;

      // кувырок: продольный поток валит носом, поперечный — на бок
      var fx = Math.sin(o.yaw), fz = Math.cos(o.yaw);
      var along = smp.vx * fx + smp.vz * fz;
      var side = smp.vx * fz - smp.vz * fx;
      o.tilt = o.tilt || 0; o.roll = o.roll || 0;
      o.tiltVel = (o.tiltVel || 0) + (along * 6.5 - o.tilt * 2.2) * sub * dt;
      o.rollVel = (o.rollVel || 0) + (side * 6.5 - o.roll * 2.2) * sub * dt;
      o.tilt = Math.max(-3.14, Math.min(3.14, o.tilt + o.tiltVel * dt));
      o.roll = Math.max(-3.14, Math.min(3.14, o.roll + o.rollVel * dt));
      o.tiltVel *= (1 - 1.1 * dt);
      o.rollVel *= (1 - 1.1 * dt);
      if (sub < 0.06) {
        o.tilt *= (1 - 2.2 * dt);
        o.roll *= (1 - 2.2 * dt);
        o.tiltVel *= (1 - 3.0 * dt);
        o.rollVel *= (1 - 3.0 * dt);
      }

      // рыскание: поток разворачивает корпус
      var yawTarget = (smp.vx * Math.cos(o.yaw) - smp.vz * Math.sin(o.yaw)) * 1.2 * sub;
      o.yawVel += (yawTarget - o.yawVel) * 3.0 * dt;
      o.yaw += o.yawVel * dt;

      v[0] *= (1 - 0.9 * dt);
      v[2] *= (1 - 0.9 * dt);
      if (sub < 0.05) { v[0] *= (1 - 2.0 * dt); v[2] *= (1 - 2.0 * dt); }

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
      if (o.kind === 'building' || o.kind === 'car' || o.kind === 'tree' ||
          o.kind === 'house' || o.kind === 'palm' || o.kind === 'rock') {
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
