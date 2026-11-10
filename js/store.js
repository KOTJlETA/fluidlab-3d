/* FluidLab 3D — сохранение состояния в localStorage */
(function () {
  'use strict';
  var FS = (window.FS = window.FS || {});
  var Store = (FS.Store = {});

  Store.KEY = 'fluidlab3d.state.v5';

  Store.defaults = function () {
    return {
      v: 3,
      level: 'city_mini',
      scenario: 'flood',
      skybox: 'night',
      count: 24576,
      physics: {
        gravity: -9.81,
        viscosity: 1,
        tension: 1,
        iterations: 2,
        timeScale: 1,
        particleSize: 1
      },
      sources: FS.World.defaultSources('city_mini', 'flood'),
      objects: FS.World.defaultObjects('city_mini'),
      autoRotate: false,
      vortex: false,
      mode: 'nav'
    };
  };

  Store.load = function () {
    var d = Store.defaults();
    var raw = null;
    try { raw = localStorage.getItem(Store.KEY); } catch (e) { return d; }
    if (!raw) return d;
    var s;
    try { s = JSON.parse(raw); } catch (e) { return d; }
    if (!s || typeof s !== 'object') return d;

    var level = FS.World.LEVELS[s.level] ? s.level : d.level;
    var scenList = FS.World.SCENARIOS[level] || [];
    var scenario = scenList.indexOf(s.scenario) >= 0 ? s.scenario : FS.World.defaultScenario(level);

    var out = {
      v: 3,
      level: level,
      scenario: scenario,
      skybox: FS.World.SKIES.indexOf(s.skybox) >= 0 ? s.skybox : d.skybox,
      count: clampInt(s.count, 2048, 131072, d.count),
      physics: Object.assign({}, d.physics, s.physics || {}),
      sources: Array.isArray(s.sources) && s.sources.length ? s.sources : FS.World.defaultSources(level, scenario),
      objects: Array.isArray(s.objects) ? FS.World.normalize(s.objects) : FS.World.defaultObjects(level),
      autoRotate: !!s.autoRotate,
      vortex: !!s.vortex,
      mode: s.mode === 'edit' ? 'edit' : 'nav'
    };

    out.sources = out.sources.slice(0, 10).map(function (src, i) {
      return {
        id: src.id || ('s' + (i + 1)),
        pos: Array.isArray(src.pos) && src.pos.length === 3 ? src.pos : [0, 1, 0],
        dir: Array.isArray(src.dir) && src.dir.length === 3 ? src.dir : [0, -1, 0],
        radius: num(src.radius, 0.16),
        speed: num(src.speed, 2.0),
        type: clampInt(src.type, 0, 6, 0),
        rate: clampInt(src.rate, 40, 1600, 500),
        enabled: src.enabled !== false,
        acc: 0
      };
    });

    FS.World.syncUid(out.objects);
    return out;
  };

  var pending = null;
  Store.save = function (state) {
    if (pending) clearTimeout(pending);
    pending = setTimeout(function () {
      pending = null;
      Store.saveNow(state);
    }, 350);
  };

  Store.saveNow = function (state) {
    var snap = {
      v: 3,
      level: state.level,
      scenario: state.scenario,
      skybox: state.skybox,
      count: state.count,
      physics: state.physics,
      sources: state.sources.map(function (s) {
        return {
          id: s.id, pos: s.pos, dir: s.dir, radius: s.radius,
          speed: s.speed, type: s.type, rate: s.rate, enabled: s.enabled
        };
      }),
      objects: state.objects,
      autoRotate: state.autoRotate,
      vortex: state.vortex,
      mode: state.mode
    };
    try {
      localStorage.setItem(Store.KEY, JSON.stringify(snap));
    } catch (e) {
      /* переполнение или приватный режим — молча игнорируем */
    }
  };

  Store.clear = function () {
    try { localStorage.removeItem(Store.KEY); } catch (e) {}
  };

  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
  function clampInt(v, a, b, d) {
    if (typeof v !== 'number' || !isFinite(v)) return d;
    return Math.max(a, Math.min(b, Math.round(v)));
  }
})();
