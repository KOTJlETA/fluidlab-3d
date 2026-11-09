/* FluidLab 3D — приложение: камера, интерфейс, цикл */
(function () {
  'use strict';
  var FS = window.FS;
  var M = FS.mat4;

  var TYPES = [
    { name: 'Вода', css: '#2173d1' },
    { name: 'Нефть', css: '#a86a1a' },
    { name: 'Лава', css: '#ff5210' },
    { name: 'Слизь', css: '#33d961' }
  ];

  var App = {
    paused: false,
    speed: 1.0,
    autoRotate: false,
    vortex: 0,
    lastT: 0,
    acc: 0,
    frames: 0,
    fpsT: 0,
    fps: 60,
    msAvg: 0
  };

  /* ---------------- камера ---------------- */

  var cam = {
    target: [0, -0.05, 0],
    theta: 0.62,
    phi: 1.10,
    dist: 4.35,
    fov: 52 * Math.PI / 180,
    near: 0.05,
    far: 40,
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

  /* ---------------- UI ---------------- */

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function slider(parent, opts) {
    var row = el('div', 'row');
    var top = el('div', 'row-top');
    top.appendChild(el('label', null, opts.label));
    var val = el('span', 'val');
    top.appendChild(val);
    row.appendChild(top);

    var inp = document.createElement('input');
    inp.type = 'range';
    inp.min = opts.min; inp.max = opts.max; inp.step = opts.step || 0.01;
    inp.value = opts.value;
    row.appendChild(inp);
    parent.appendChild(row);

    function apply() {
      var v = parseFloat(inp.value);
      val.textContent = opts.fmt ? opts.fmt(v) : v.toFixed(2);
      opts.onInput(v);
    }
    inp.addEventListener('input', apply);
    val.textContent = opts.fmt ? opts.fmt(parseFloat(inp.value)) : parseFloat(inp.value).toFixed(2);
    return inp;
  }

  var App_ui = {};

  function buildUI(sim) {
    // --- источники ---
    var host = document.getElementById('sources');
    host.innerHTML = '';
    sim.sources.forEach(function (src, i) {
      var card = el('div', 'src' + (src.enabled ? ' on' : ''));

      var head = el('div', 'src-head');
      var dot = el('div', 'dot');
      dot.style.background = TYPES[src.type].css;
      dot.style.color = TYPES[src.type].css;
      head.appendChild(dot);

      var nm = el('div', 'src-name', 'Поток ' + (i + 1) + ' <small>· ' + TYPES[src.type].name + '</small>');
      head.appendChild(nm);

      var sw = el('div', 'switch' + (src.enabled ? ' on' : ''));
      sw.addEventListener('click', function () {
        src.enabled = !src.enabled;
        sw.classList.toggle('on', src.enabled);
        card.classList.toggle('on', src.enabled);
      });
      head.appendChild(sw);
      card.appendChild(head);

      var chips = el('div', 'chips');
      TYPES.forEach(function (t, ti) {
        var c = el('button', 'chip' + (ti === src.type ? ' active' : ''), t.name);
        if (ti === src.type) { c.style.background = t.css; c.style.borderColor = t.css; }
        c.addEventListener('click', function () {
          src.type = ti;
          chips.querySelectorAll('.chip').forEach(function (x) {
            x.classList.remove('active');
            x.style.background = '';
            x.style.borderColor = '';
          });
          c.classList.add('active');
          c.style.background = t.css;
          c.style.borderColor = t.css;
          dot.style.background = t.css;
          dot.style.color = t.css;
          nm.innerHTML = 'Поток ' + (i + 1) + ' <small>· ' + t.name + '</small>';
        });
        chips.appendChild(c);
      });
      card.appendChild(chips);

      slider(card, {
        label: 'Интенсивность', min: 40, max: 1400, step: 10, value: src.rate,
        fmt: function (v) { return Math.round(v) + '/с'; },
        onInput: function (v) { src.rate = v; }
      });

      host.appendChild(card);
    });

    // --- физика ---
    var ph = document.getElementById('phys');
    ph.innerHTML = '';
    slider(ph, {
      label: 'Гравитация', min: -22, max: 2, step: 0.1, value: sim.gravity,
      fmt: function (v) { return v.toFixed(1) + ' м/с²'; },
      onInput: function (v) { sim.gravity = v; }
    });
    slider(ph, {
      label: 'Вязкость', min: 0, max: 2.5, step: 0.05, value: 1,
      fmt: function (v) { return (v * 100).toFixed(0) + '%'; },
      onInput: function (v) { sim.viscScale = v; }
    });
    slider(ph, {
      label: 'Поверхностное натяжение', min: 0, max: 3, step: 0.05, value: 1,
      fmt: function (v) { return (v * 100).toFixed(0) + '%'; },
      onInput: function (v) { sim.sCorrK = 0.0004 * v; }
    });
    slider(ph, {
      label: 'Итерации решателя', min: 1, max: 4, step: 1, value: sim.iterations,
      fmt: function (v) { return v.toFixed(0); },
      onInput: function (v) { sim.iterations = v | 0; }
    });
    slider(ph, {
      label: 'Скорость времени', min: 0.15, max: 2, step: 0.05, value: 1,
      fmt: function (v) { return '×' + v.toFixed(2); },
      onInput: function (v) { App.speed = v; }
    });
    slider(ph, {
      label: 'Крупность частиц', min: 0.6, max: 1.8, step: 0.02, value: 1,
      fmt: function (v) { return (v * 100).toFixed(0) + '%'; },
      onInput: function (v) { sim.radiusRender = 0.079 * v; }
    });

    // --- жидкости ---
    var fl = document.getElementById('fluids');
    fl.innerHTML = '';
    var info = el('div');
    info.style.cssText = 'font-size:10.5px;color:#6d8595;line-height:1.6;margin-bottom:8px';
    info.innerHTML = 'Вода · Нефть (легче) · Лава (тяжелее, светится) · Слизь (густая).<br>Фазы не смешиваются — тяжёлые тонут.';
    fl.appendChild(info);

    slider(fl, {
      label: 'Количество частиц', min: 4096, max: 32768, step: 4096, value: sim.count,
      fmt: function (v) { return (v / 1024).toFixed(0) + 'k'; },
      onInput: function (v) { App_ui.pendingCount = v; }
    });
    var applyBtn = el('button', 'btn', 'Применить количество');
    applyBtn.style.width = '100%';
    applyBtn.addEventListener('click', function () {
      if (App_ui.pendingCount && App_ui.pendingCount !== sim.count) {
        sim.setCount(App_ui.pendingCount);
        App_ui.pendingCount = null;
      }
    });
    fl.appendChild(applyBtn);
  }

  /* ---------------- сцена / препятствия ---------------- */

  function defaultObstacles(sim) {
    sim.obstacles.sph = [
      { c: [-0.45, -0.63, 0.12], r: 0.30, color: [0.30, 0.38, 0.46] },
      { c: [0.20, -0.18, -0.55], r: 0.14, color: [0.42, 0.30, 0.20] }
    ];
    sim.obstacles.box = [
      { c: [0.45, -0.72, -0.15], h: [0.22, 0.28, 0.22], color: [0.26, 0.30, 0.38] }
    ];
  }

  function addSphere(sim) {
    if (sim.obstacles.sph.length >= 8) return;
    var x = (Math.random() - 0.5) * 1.2;
    var z = (Math.random() - 0.5) * 1.2;
    var y = -0.85 + Math.random() * 0.7;
    sim.obstacles.sph.push({
      c: [x, y, z], r: 0.10 + Math.random() * 0.16,
      color: [0.28 + Math.random() * 0.16, 0.34, 0.42]
    });
  }

  function addBox(sim) {
    if (sim.obstacles.box.length >= 4) return;
    var x = (Math.random() - 0.5) * 1.1;
    var z = (Math.random() - 0.5) * 1.1;
    sim.obstacles.box.push({
      c: [x, -0.75 + Math.random() * 0.35, z],
      h: [0.12 + Math.random() * 0.16, 0.14 + Math.random() * 0.2, 0.12 + Math.random() * 0.16],
      color: [0.26, 0.30, 0.38]
    });
  }

  /* ---------------- инициализация ---------------- */

  var gl, sim, renderer, canvas;

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
      return false;
    }
    if (!gl.getExtension('EXT_color_buffer_float')) {
      fail('Не удалось включить <b>EXT_color_buffer_float</b>.<br>GPU-решатель требует поддержки float-текстур.');
      return false;
    }

    renderer = new FS.Renderer(gl, canvas);
    sim = new FS.FluidSim(gl, { count: 24576 });
    defaultObstacles(sim);
    sim.reset();

    App.sim = sim;
    App.renderer = renderer;

    buildUI(sim);
    resize();
    bindInput();

    // прогрев
    setTimeout(function () {
      var t0 = performance.now();
      try {
        sim.prewarm(50);
      } catch (err) {
        console.error(err);
      }
      console.log('prewarm', (performance.now() - t0).toFixed(0) + 'ms');
      document.getElementById('loading').classList.add('hide');
      App.lastT = performance.now();
      requestAnimationFrame(frame);
    }, 40);

    return true;
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

  /* ---------------- ввод ---------------- */

  var drag = { orbit: false, push: false, x: 0, y: 0, fx: 0, fy: 0 };

  function bindInput() {
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    canvas.addEventListener('pointerdown', function (e) {
      canvas.setPointerCapture(e.pointerId);
      drag.x = e.clientX; drag.y = e.clientY;
      drag.fx = 0; drag.fy = 0;
      if (e.button === 2 || e.shiftKey) { drag.push = true; }
      else { drag.orbit = true; }
      document.getElementById('hint').classList.add('hide');
    });

    window.addEventListener('pointermove', function (e) {
      var dx = e.clientX - drag.x;
      var dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.orbit) {
        cam.theta -= dx * 0.0062;
        cam.phi = Math.min(1.78, Math.max(0.16, cam.phi - dy * 0.0062));
      }
      if (drag.push) {
        drag.fx += dx; drag.fy += dy;
      }
    });

    window.addEventListener('pointerup', function () {
      drag.orbit = false;
      drag.push = false;
      if (sim) { sim.mouse.radius = 0; sim.mouse.force = [0, 0, 0]; }
    });

    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      cam.dist *= Math.exp(e.deltaY * 0.0011);
      cam.dist = Math.min(9, Math.max(1.3, cam.dist));
    }, { passive: false });

    document.getElementById('collapse').addEventListener('click', function () {
      document.getElementById('panel').classList.add('collapsed');
      document.getElementById('expand').classList.add('show');
    });
    document.getElementById('expand').addEventListener('click', function () {
      document.getElementById('panel').classList.remove('collapsed');
      document.getElementById('expand').classList.remove('show');
    });

    document.getElementById('btn-obst-sphere').addEventListener('click', function () {
      addSphere(sim);
    });
    document.getElementById('btn-obst-box').addEventListener('click', function () {
      addBox(sim);
    });
    document.getElementById('btn-obst-clear').addEventListener('click', function () {
      sim.obstacles.sph = [];
      sim.obstacles.box = [];
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
    rb.addEventListener('click', function () {
      App.autoRotate = !App.autoRotate;
      rb.classList.toggle('active', App.autoRotate);
    });
    var vb = document.getElementById('btn-preset');
    vb.addEventListener('click', function () {
      App.vortex = App.vortex > 0 ? 0 : 1;
      vb.classList.toggle('active', App.vortex > 0);
      if (sim) sim.vortex = App.vortex;
    });

    window.addEventListener('resize', resize);
  }

  /* ---------------- цикл ---------------- */

  function updateMouseForce(dt) {
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

    // точка под курсором на плоскости, проходящей через цель камеры
    var W = window.innerWidth, H = window.innerHeight;
    var nx = (drag.x / W) * 2 - 1;
    var ny = 1 - (drag.y / H) * 2;
    var depth = cam.dist;
    var p = [
      cam.eye[0] + b.f[0] * depth + b.r[0] * nx * cam.tanHalf * cam.aspect * depth + b.u[0] * ny * cam.tanHalf * depth,
      cam.eye[1] + b.f[1] * depth + b.r[1] * nx * cam.tanHalf * cam.aspect * depth + b.u[1] * ny * cam.tanHalf * depth,
      cam.eye[2] + b.f[2] * depth + b.r[2] * nx * cam.tanHalf * cam.aspect * depth + b.u[2] * ny * cam.tanHalf * depth
    ];
    sim.mouse.pos = p;
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
      var sdt = Math.min(Math.max(dt * App.speed, 1 / 240), 1 / 30);
      updateMouseForce(sdt);
      sim.vortex = App.vortex;
      sim.step(sdt);
    }

    resize();
    cam.update(canvas.width, canvas.height);
    renderer.renderScene(cam, sim);
    renderer.renderFluid(cam, sim);

    App.msAvg = App.msAvg * 0.9 + (performance.now() - t0) * 0.1;
  }

  window.addEventListener('DOMContentLoaded', init);

  // отладочный доступ
  window.FLUIDLAB = { App: App, cam: cam };
})();
