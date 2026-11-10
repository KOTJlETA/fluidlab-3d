/* FluidLab 3D — приложение: камера, ввод, гизмо, цикл */
(function () {
  'use strict';
  var FS = window.FS;
  var M = FS.mat4;
  var World = FS.World;

  var App = {
    paused: false,
    autoRotate: false,
    vortex: false,
    lastT: 0,
    frames: 0,
    fpsT: 0,
    fps: 60,
    msAvg: 0,
    selected: null,
    gizmo: { origin: null, hoverAxis: -1, activeAxis: -1 },
    pendingCount: 0
  };

  /* ---------------- камера ---------------- */

  var cam = {
    target: [0, -0.10, 0],
    theta: 0.62,
    phi: 0.98,
    dist: 3.9,
    fov: 52 * Math.PI / 180,
    near: 0.05,
    far: 60,
    eye: [0, 0, 3],
    view: M.create(),
    proj: M.create(),
    tanHalf: 0.5,
    aspect: 1,
    lightDirView: [0, 0, -1],
    lightDir: [0.45, 0.82, 0.36]
  };

  cam.update = function (W, H) {
    var sp = Math.sin(this.phi), cp = Math.cos(this.phi);
    this.eye[0] = this.target[0] + this.dist * sp * Math.sin(this.theta);
    this.eye[1] = this.target[1] + this.dist * cp;
    this.eye[2] = this.target[2] + this.dist * sp * Math.cos(this.theta);

    M.lookAt(this.view, this.eye, this.target, [0, 1, 0]);
    this.aspect = W / Math.max(1, H);
    M.perspective(this.proj, this.fov, this.aspect, this.near, this.far);
    this.tanHalf = Math.tan(this.fov / 2);

    var L = this.lightDir, v = this.view;
    this.lightDirView = [
      v[0] * L[0] + v[4] * L[1] + v[8] * L[2],
      v[1] * L[0] + v[5] * L[1] + v[9] * L[2],
      v[2] * L[0] + v[6] * L[1] + v[10] * L[2]
    ];
  };

  cam.basis = function () {
    var f = FS.vec3.normalize(FS.vec3.sub(this.target, this.eye));
    var r = FS.vec3.normalize(FS.vec3.cross(f, [0, 1, 0]));
    var u = FS.vec3.cross(r, f);
    return { f: f, r: r, u: u };
  };

  cam.ray = function (sx, sy, W, H) {
    var nx = (sx / W) * 2 - 1;
    var ny = 1 - (sy / H) * 2;
    var b = this.basis();
    var d = [
      b.f[0] + b.r[0] * nx * this.tanHalf * this.aspect + b.u[0] * ny * this.tanHalf,
      b.f[1] + b.r[1] * nx * this.tanHalf * this.aspect + b.u[1] * ny * this.tanHalf,
      b.f[2] + b.r[2] * nx * this.tanHalf * this.aspect + b.u[2] * ny * this.tanHalf
    ];
    return { o: this.eye.slice(), d: FS.Gizmo.norm(d) };
  };

  /* ---------------- приложение ---------------- */

  var gl, sim, renderer, canvas;

  App.isSelected = function (kind, id) {
    return App.selected && App.selected.kind === kind && App.selected.id === id;
  };

  App.changed = function () {
    FS.Store.save(App.state);
  };

  App.select = function (kind, id) {
    if (kind === null) App.selected = null;
    else App.selected = { kind: kind, id: id };
    updateGizmoOrigin();
    FS.UI.buildInspector(App);
    FS.UI.buildSources(document.getElementById('sources'), App);
    FS.UI.buildObjects(document.getElementById('objects'), App);
  };

  App.rebuildInspector = function () { FS.UI.buildInspector(App); };
  App.rebuildLists = function () {
    FS.UI.buildSources(document.getElementById('sources'), App);
    FS.UI.buildObjects(document.getElementById('objects'), App);
  };

  function updateGizmoOrigin() {
    App.gizmo.origin = null;
    if (!App.selected) return;
    var o;
    if (App.selected.kind === 'object') {
      o = App.state.objects.filter(function (x) { return x.id === App.selected.id; })[0];
    } else {
      o = App.state.sources.filter(function (x) { return x.id === App.selected.id; })[0];
    }
    if (o) App.gizmo.origin = o.pos.slice();
  }

  App.applyPhysics = function () {
    var ph = App.state.physics;
    sim.gravity = ph.gravity;
    sim.iterations = ph.iterations | 0;
    sim.viscScale = ph.viscosity;
    sim.sCorrK = 0.0004 * ph.tension;
    sim.radiusRender = (sim.h || 0.17) * 0.95 * ph.particleSize;
    App.changed();
  };

  App.rebuildSim = function () {
    sim.setCount(App.state.count);
    sim.setObjects(App.state.objects);
    sim.sources = App.state.sources;
    sim.applyLevel(World.LEVELS[App.state.level], true);
    App.applyPhysics();
    sim.reset();
    sim.prewarm(25);
    FS.UI.buildPerf(document.getElementById('perf'), App);
    App.changed();
  };

  App.setLevel = function (key) {
    if (!World.LEVELS[key]) return;
    var L = World.LEVELS[key];
    if (L.camDist) cam.dist = L.camDist;
    if (L.camPhi) cam.phi = L.camPhi;
    App.state.level = key;
    App.state.skybox = L.sky;
    App.state.objects = World.defaultObjects(key);
    World.syncUid(App.state.objects);
    App.state.sources = World.defaultSources(key);
    sim.sources = App.state.sources;
    sim.setObjects(App.state.objects);
    App.selected = null;
    updateGizmoOrigin();
    sim.applyLevel(L);
    sim.reset();
    sim.prewarm(25);
    App.refreshAll();
    App.changed();
  };

  App.setSkybox = function (key) {
    App.state.skybox = key;
    FS.UI.buildSkies(document.getElementById('skies'), App);
    App.changed();
  };

  App.addSource = function () {
    var st = App.state;
    if (st.sources.length >= 10) return;
    var i = st.sources.length;
    var a = (i / 10) * Math.PI * 2;
    var src = {
      id: 's' + Date.now().toString(36) + i,
      pos: [Math.cos(a) * 0.6, 1.3, Math.sin(a) * 0.6],
      dir: [0, -1, 0], radius: 0.16, speed: 2.0, type: i % 4, rate: 450,
      enabled: true, acc: 0
    };
    st.sources.push(src);
    sim.sources = st.sources;
    App.select('source', src.id);
    App.changed();
  };

  App.deleteSource = function (id) {
    var st = App.state;
    if (st.sources.length <= 1) return;
    st.sources = st.sources.filter(function (s) { return s.id !== id; });
    sim.sources = st.sources;
    if (App.selected && App.selected.id === id) App.select(null);
    else App.rebuildLists();
    App.changed();
  };

  var _kindSeq = 0;
  App.addObject = function (kind) {
    var st = App.state;
    var o = null;
    var cx = (Math.random() - 0.5) * 0.7;
    var cz = (Math.random() - 0.5) * 0.7;
    if (kind === 'sphere') {
      o = World.sphere([cx, -0.55 + Math.random() * 0.5, cz], 0.12 + Math.random() * 0.12, [0.30, 0.38, 0.46]);
    } else if (kind === 'building') {
      o = World.building([cx, -0.72, cz], 0.09 + Math.random() * 0.07, 0.2 + Math.random() * 0.2, 0.09 + Math.random() * 0.07, Math.random() * 3, [0.22, 0.24, 0.30]);
    } else if (kind === 'car') {
      o = World.car([cx, -0.90, cz], Math.random() * 6, [0.55, 0.20, 0.16]);
    } else if (kind === 'portal') {
      var a = World.portalPair(
        [cx, 0.15, cz], [0, -1, 0],
        [-cx, 0.55, -cz], [0, -1, 0],
        [0.35, 0.95, 0.85]
      );
      st.objects.push(a[0]);
      st.objects.push(a[1]);
      World.syncUid(st.objects);
      sim.setObjects(st.objects);
      App.select('object', a[0].id);
      App.changed();
      return;
    } else if (kind === 'field') {
      o = World.field([cx, -0.35, cz], 'repel', 0.42, 14, [0, 1, 0]);
      o.color = World.FIELD_MODES.repel.color;
    }
    if (!o) return;
    st.objects.push(o);
    sim.setObjects(st.objects);
    App.select('object', o.id);
    App.changed();
  };

  App.deleteObject = function (id) {
    var st = App.state;
    var o = st.objects.filter(function (x) { return x.id === id; })[0];
    if (!o) return;
    var ids = [id];
    if (o.kind === 'portal' && o.link) ids.push(o.link);
    st.objects = st.objects.filter(function (x) { return ids.indexOf(x.id) < 0; });
    sim.setObjects(st.objects);
    if (App.selected && ids.indexOf(App.selected.id) >= 0) App.select(null);
    else App.rebuildLists();
    App.changed();
  };

  App.refreshAll = function () {
    FS.UI.buildLevels(document.getElementById('levels'), App);
    FS.UI.buildSkies(document.getElementById('skies'), App);
    FS.UI.buildSources(document.getElementById('sources'), App);
    FS.UI.buildObjects(document.getElementById('objects'), App);
    FS.UI.buildInspector(App);
  };

  /* ---------------- ввод ---------------- */

  var drag = { orbit: false, push: false, axis: -1, x: 0, y: 0, fx: 0, fy: 0, startPos: null, startT: 0 };

  function canvasPoint(e) {
    var r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (canvas.width / Math.max(1, r.width)),
      y: (e.clientY - r.top) * (canvas.height / Math.max(1, r.height))
    };
  }

  function pickAt(px, py) {
    var ray = cam.ray(px, py, canvas.width, canvas.height);
    var o = FS.Gizmo.pickObject(ray.o, ray.d, App.state.objects);
    if (o) return { kind: 'object', obj: o, ray: ray };

    var best = null, bestT = 1e9;
    for (var i = 0; i < App.state.sources.length; i++) {
      var s = App.state.sources[i];
      var t = FS.Gizmo.raySphere(ray.o, ray.d, s.pos, 0.11);
      if (t > 0 && t < bestT) { bestT = t; best = s; }
    }
    if (best) return { kind: 'source', obj: best, ray: ray };
    return { kind: null, ray: ray };
  }

  function bindInput() {
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    canvas.addEventListener('pointerdown', function (e) {
      canvas.setPointerCapture(e.pointerId);
      var p = canvasPoint(e);
      drag.x = p.x; drag.y = p.y;
      drag.fx = 0; drag.fy = 0;
      drag.axis = -1;

      if (e.button === 2 || e.shiftKey) { drag.push = true; return; }

      var hit = pickAt(p.x, p.y);

      // гизмо: тянем ось
      if (App.gizmo.origin) {
        var ax = FS.Gizmo.pickAxis(hit.ray.o, hit.ray.d, App.gizmo.origin);
        if (ax >= 0) {
          drag.axis = ax;
          App.gizmo.activeAxis = ax;
          var sel = selectedRef();
          if (sel) {
            drag.startPos = sel.pos.slice();
            drag.startT = FS.Gizmo.axisParam(hit.ray.o, hit.ray.d, App.gizmo.origin, FS.Gizmo.AXES[ax]);
          }
          return;
        }
      }

      if (hit.kind) {
        App.select(hit.kind, hit.obj.id);
        return;
      }

      if (App.selected) { App.select(null); }
      drag.orbit = true;
      document.getElementById('hint').classList.add('hide');
    });

    window.addEventListener('pointermove', function (e) {
      var p = canvasPoint(e);

      if (drag.axis >= 0 && App.gizmo.origin) {
        var ray = cam.ray(p.x, p.y, canvas.width, canvas.height);
        var t = FS.Gizmo.axisParam(ray.o, ray.d, App.gizmo.origin, FS.Gizmo.AXES[drag.axis]);
        var d = t - drag.startT;
        var sel = selectedRef();
        if (sel && drag.startPos) {
          var ax = FS.Gizmo.AXES[drag.axis];
          sel.pos[0] = clamp(drag.startPos[0] + ax[0] * d, -2.2, 2.2);
          sel.pos[1] = clamp(drag.startPos[1] + ax[1] * d, -2.2, 2.2);
          sel.pos[2] = clamp(drag.startPos[2] + ax[2] * d, -2.2, 2.2);
          updateGizmoOrigin();
          FS.UI.buildInspector(App);
          App.changed();
        }
        drag.x = p.x; drag.y = p.y;
        return;
      }

      var dx = p.x - drag.x;
      var dy = p.y - drag.y;
      drag.x = p.x; drag.y = p.y;

      if (drag.orbit) {
        var k = 0.0062 * (canvas.width / Math.max(1, canvas.getBoundingClientRect().width)) / (window.devicePixelRatio || 1);
        cam.theta -= dx * k;
        cam.phi = Math.min(1.78, Math.max(0.16, cam.phi - dy * k));
      }
      if (drag.push) { drag.fx += dx; drag.fy += dy; }

      if (!drag.orbit && !drag.push && drag.axis < 0 && App.gizmo.origin) {
        var r2 = cam.ray(p.x, p.y, canvas.width, canvas.height);
        App.gizmo.hoverAxis = FS.Gizmo.pickAxis(r2.o, r2.d, App.gizmo.origin);
        canvas.style.cursor = App.gizmo.hoverAxis >= 0 ? 'move' : 'grab';
      }
    });

    window.addEventListener('pointerup', function () {
      drag.orbit = false;
      drag.push = false;
      drag.axis = -1;
      App.gizmo.activeAxis = -1;
      if (sim) { sim.mouse.radius = 0; sim.mouse.force = [0, 0, 0]; }
    });

    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      cam.dist *= Math.exp(e.deltaY * 0.0011);
      cam.dist = Math.min(12, Math.max(1.3, cam.dist));
    }, { passive: false });

    window.addEventListener('keydown', function (e) {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (App.selected && document.activeElement === document.body) {
          if (App.selected.kind === 'object') App.deleteObject(App.selected.id);
          else App.deleteSource(App.selected.id);
          e.preventDefault();
        }
      }
      if (e.key === 'Escape') App.select(null);
    });

    document.getElementById('collapse').addEventListener('click', function () {
      document.getElementById('panel').classList.add('collapsed');
      document.getElementById('expand').classList.add('show');
    });
    document.getElementById('expand').addEventListener('click', function () {
      document.getElementById('panel').classList.remove('collapsed');
      document.getElementById('expand').classList.remove('show');
    });

    document.getElementById('btn-reset').addEventListener('click', function () {
      sim.reset();
      sim.prewarm(20);
    });
    var pb = document.getElementById('btn-pause');
    pb.addEventListener('click', function () {
      App.paused = !App.paused;
      pb.classList.toggle('active', App.paused);
      pb.textContent = App.paused ? 'Продолжить' : 'Пауза';
    });
    var rb = document.getElementById('btn-rotate');
    rb.classList.toggle('active', App.autoRotate);
    rb.addEventListener('click', function () {
      App.autoRotate = !App.autoRotate;
      App.state.autoRotate = App.autoRotate;
      rb.classList.toggle('active', App.autoRotate);
      App.changed();
    });
    var vb = document.getElementById('btn-preset');
    vb.classList.toggle('active', App.vortex);
    vb.addEventListener('click', function () {
      App.vortex = !App.vortex;
      App.state.vortex = App.vortex;
      vb.classList.toggle('active', App.vortex);
      App.changed();
    });
    document.getElementById('btn-clear').addEventListener('click', function () {
      App.state.objects = [];
      sim.setObjects(App.state.objects);
      App.select(null);
      App.changed();
    });
    document.getElementById('btn-resetall').addEventListener('click', function () {
      FS.Store.clear();
      location.reload();
    });

    window.addEventListener('resize', resize);
  }

  function selectedRef() {
    if (!App.selected) return null;
    if (App.selected.kind === 'object') {
      return App.state.objects.filter(function (x) { return x.id === App.selected.id; })[0] || null;
    }
    return App.state.sources.filter(function (x) { return x.id === App.selected.id; })[0] || null;
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ---------------- инициализация ---------------- */

  function fail(msg) {
    var e = document.getElementById('error');
    e.hidden = false;
    e.innerHTML = msg;
    document.getElementById('loading').classList.add('hide');
  }

  function init() {
    canvas = document.getElementById('gl');
    gl = canvas.getContext('webgl2', {
      antialias: false, alpha: false, depth: false, stencil: false,
      powerPreference: 'high-performance', preserveDrawingBuffer: false
    });

    if (!gl) {
      fail('Ваш браузер не поддерживает <b>WebGL2</b>.<br>Откройте приложение в Chrome, Edge или Firefox последней версии.');
      return;
    }
    if (!gl.getExtension('EXT_color_buffer_float')) {
      fail('Не удалось включить <b>EXT_color_buffer_float</b>.<br>GPU-решатель требует поддержки float-текстур.');
      return;
    }

    App.state = FS.Store.load();

    renderer = new FS.Renderer(gl, canvas);
    sim = new FS.FluidSim(gl, { count: App.state.count });
    sim.setLevel(World.LEVELS[App.state.level]);
    sim.setObjects(App.state.objects);
    sim.sources = App.state.sources;
    App.applyPhysics();

    App.sim = sim;
    App.renderer = renderer;
    App.cam = cam;
    App.pendingCount = App.state.count;
    App.autoRotate = !!App.state.autoRotate;
    App.vortex = !!App.state.vortex;

    FS.UI.bindTips();
    buildShell();
    resize();
    bindInput();
    App.refreshAll();

    document.getElementById('btn-rotate').classList.toggle('active', App.autoRotate);
    document.getElementById('btn-preset').classList.toggle('active', App.vortex);

    setTimeout(function () {
      try { sim.prewarm(30); } catch (err) { console.error(err); }
      document.getElementById('loading').classList.add('hide');
      App.lastT = performance.now();
      requestAnimationFrame(frame);
    }, 40);
  }

  function buildShell() {
    FS.UI.buildLevels(document.getElementById('levels'), App);
    FS.UI.buildSkies(document.getElementById('skies'), App);
    FS.UI.buildPhysics(document.getElementById('phys'), App);
    FS.UI.buildPerf(document.getElementById('perf'), App);
    FS.UI.buildSources(document.getElementById('sources'), App);
    FS.UI.buildObjects(document.getElementById('objects'), App);
    FS.UI.buildInspector(App);
  }

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    var w = Math.floor(window.innerWidth * dpr);
    var h = Math.floor(window.innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      renderer.resize(w, h);
    }
  }

  /* ---------------- цикл ---------------- */

  function updateMouseForce() {
    if (!drag.push) { sim.mouse.radius = 0; return; }
    var b = cam.basis();
    var K = 0.9;
    var f = [
      b.r[0] * drag.fx * K + b.u[0] * (-drag.fy) * K,
      b.r[1] * drag.fx * K + b.u[1] * (-drag.fy) * K,
      b.r[2] * drag.fx * K + b.u[2] * (-drag.fy) * K
    ];
    var mag = Math.hypot(f[0], f[1], f[2]);
    if (mag > 120) { f[0] *= 120 / mag; f[1] *= 120 / mag; f[2] *= 120 / mag; }

    var W = canvas.width, H = canvas.height;
    var nx = (drag.x / W) * 2 - 1;
    var ny = 1 - (drag.y / H) * 2;
    var depth = cam.dist;
    sim.mouse.pos = [
      cam.eye[0] + b.f[0] * depth + b.r[0] * nx * cam.tanHalf * cam.aspect * depth + b.u[0] * ny * cam.tanHalf * depth,
      cam.eye[1] + b.f[1] * depth + b.r[1] * nx * cam.tanHalf * cam.aspect * depth + b.u[1] * ny * cam.tanHalf * depth,
      cam.eye[2] + b.f[2] * depth + b.r[2] * nx * cam.tanHalf * cam.aspect * depth + b.u[2] * ny * cam.tanHalf * depth
    ];
    sim.mouse.force = f;
    sim.mouse.radius = 0.30;
    drag.fx *= 0.55;
    drag.fy *= 0.55;
  }

  function frame(now) {
    requestAnimationFrame(frame);
    var dt = (now - App.lastT) / 1000;
    App.lastT = now;
    if (!(dt > 0)) dt = 1 / 60;
    dt = Math.min(dt, 0.05);

    App.frames++;
    App.fpsT += dt;
    if (App.fpsT >= 0.4) {
      App.fps = App.frames / App.fpsT;
      App.frames = 0; App.fpsT = 0;
      document.getElementById('s-fps').textContent = App.fps.toFixed(0);
      document.getElementById('s-ms').textContent = App.msAvg.toFixed(1);
      document.getElementById('s-part').textContent = (sim.count / 1024).toFixed(0) + 'k';
    }

    if (App.autoRotate) cam.theta += dt * 0.22;

    var t0 = performance.now();

    if (!App.paused) {
      var sdt = Math.min(Math.max(dt * App.state.physics.timeScale, 1 / 240), 1 / 30);
      updateMouseForce();
      sim.vortex = App.vortex ? 1 : 0;
      sim.step(sdt);
      World.updateDynamic(sdt, sim, sim.level, App.state.objects, App.state.physics.gravity);
    }

    resize();
    cam.update(canvas.width, canvas.height);
    renderer.time = sim.time;
    renderer.renderScene(cam, sim, App.state, App.gizmo);
    renderer.renderFluid(cam, sim);

    App.msAvg = App.msAvg * 0.9 + (performance.now() - t0) * 0.1;
  }

  window.addEventListener('DOMContentLoaded', init);
  window.FLUIDLAB = { App: App, cam: cam };
})();
