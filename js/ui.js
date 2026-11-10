/* FluidLab 3D — построение интерфейса */
(function () {
  'use strict';
  var FS = window.FS;
  var UI = (FS.UI = {});
  var World = FS.World;
  var T = function (k) { return FS.I18N.t(k); };

  function typeItems() {
    return World.TYPES.map(function (t) {
      return { name: World.typeName(World.TYPES.indexOf(t)), css: t.css, key: t.key };
    });
  }
  UI.typeItems = typeItems;

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  UI.el = el;

  /* ---------- всплывающие подсказки ---------- */

  var tipEl = null, tipTarget = null;

  function ensureTip() {
    if (tipEl) return tipEl;
    tipEl = el('div', 'tooltip');
    document.body.appendChild(tipEl);
    return tipEl;
  }

  function showTip(text, anchor) {
    var t = ensureTip();
    t.textContent = text;
    t.classList.add('show');
    tipTarget = anchor;
    var r = anchor.getBoundingClientRect();
    var tr = t.getBoundingClientRect();
    var x = r.right + 10;
    var y = r.top + r.height / 2 - tr.height / 2;
    if (x + tr.width > window.innerWidth - 8) x = r.left - tr.width - 10;
    if (x < 8) x = 8;
    if (y < 8) y = 8;
    if (y + tr.height > window.innerHeight - 8) y = window.innerHeight - tr.height - 8;
    t.style.left = x + 'px';
    t.style.top = y + 'px';
  }

  function hideTip() {
    if (tipEl) tipEl.classList.remove('show');
    tipTarget = null;
  }

  UI.bindTips = function () {
    document.addEventListener('mouseover', function (e) {
      var t = e.target.closest ? e.target.closest('[data-tip]') : null;
      if (t && t !== tipTarget) showTip(t.getAttribute('data-tip'), t);
      else if (!t && tipTarget) hideTip();
    });
    document.addEventListener('mouseout', function (e) {
      if (e.target.closest && e.target.closest('[data-tip]')) hideTip();
    });
    window.addEventListener('scroll', hideTip, true);
  };

  UI.q = function (text) {
    var s = el('span', 'q', '!');
    s.setAttribute('data-tip', text);
    return s;
  };

  /* ---------- элементы управления ---------- */

  UI.slider = function (parent, opts) {
    var row = el('div', 'row');
    var top = el('div', 'row-top');
    var lab = el('label');
    lab.appendChild(document.createTextNode(opts.label));
    if (opts.tip) lab.appendChild(UI.q(opts.tip));
    top.appendChild(lab);
    var val = el('span', 'val');
    top.appendChild(val);
    row.appendChild(top);

    var inp = document.createElement('input');
    inp.type = 'range';
    inp.min = opts.min; inp.max = opts.max;
    inp.step = opts.step === undefined ? 0.01 : opts.step;
    inp.value = opts.value;
    row.appendChild(inp);
    parent.appendChild(row);

    function fmt(v) {
      if (opts.fmt) return opts.fmt(v);
      return (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));
    }
    function apply() {
      var v = parseFloat(inp.value);
      val.textContent = fmt(v);
      opts.onInput(v);
    }
    inp.addEventListener('input', apply);
    val.textContent = fmt(parseFloat(inp.value));
    return { input: inp, set: function (v) { inp.value = v; val.textContent = fmt(v); } };
  };

  UI.chips = function (parent, items, active, onPick, cls) {
    var wrap = el('div', 'chips' + (cls ? ' ' + cls : ''));
    items.forEach(function (it, i) {
      var c = el('button', 'chip' + (i === active ? ' active' : ''), it.name);
      if (i === active && it.css) { c.style.background = it.css; c.style.borderColor = it.css; }
      c.addEventListener('click', function () {
        wrap.querySelectorAll('.chip').forEach(function (x) {
          x.classList.remove('active'); x.style.background = ''; x.style.borderColor = '';
        });
        c.classList.add('active');
        if (it.css) { c.style.background = it.css; c.style.borderColor = it.css; }
        onPick(i);
      });
      wrap.appendChild(c);
    });
    parent.appendChild(wrap);
    return wrap;
  };

  UI.section = function (parent, title, open) {
    var d = document.createElement('details');
    if (open) d.open = true;
    var s = document.createElement('summary');
    s.textContent = title;
    d.appendChild(s);
    var body = el('div', 'sec-body');
    d.appendChild(body);
    parent.appendChild(d);
    return body;
  };

  /* ---------- режим работы ---------- */

  var ICON_HAND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 12V5.6a1.6 1.6 0 0 1 3.2 0V11"/><path d="M11.2 11V4.4a1.6 1.6 0 0 1 3.2 0V11"/><path d="M14.4 11.2V6.6a1.6 1.6 0 0 1 3.2 0v7.6A6.2 6.2 0 0 1 11.4 20h-.8A5.6 5.6 0 0 1 5 14.4V12a1.6 1.6 0 0 1 3.2 0"/></svg>';
  var ICON_CURSOR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3.2l14 7.6-6.1 1.6L10 19.4z"/></svg>';

  UI.buildModes = function (host, app) {
    if (!host) return;
    host.innerHTML = '';
    var row = el('div', 'modes');
    [['nav', ICON_HAND, 'mode.nav', 'mode.nav.tip'],
     ['edit', ICON_CURSOR, 'mode.edit', 'mode.edit.tip']].forEach(function (m) {
      var b = el('button', 'modebtn' + (app.mode === m[0] ? ' active' : ''));
      b.innerHTML = m[1] + '<span>' + T(m[2]) + '</span>';
      b.setAttribute('data-tip', T(m[3]));
      b.addEventListener('click', function () { app.setMode(m[0]); });
      row.appendChild(b);
    });
    host.appendChild(row);
  };

  UI.buildLanguages = function (host, app) {
    if (!host) return;
    host.innerHTML = '';
    var items = [{ name: 'English', css: '' }, { name: 'Русский', css: '' }];
    var cur = FS.I18N.lang === 'ru' ? 1 : 0;
    UI.chips(host, items, cur, function (i) {
      app.setLang(i === 1 ? 'ru' : 'en');
    }, 'wide');
  };

  /* ---------- список источников ---------- */

  UI.buildSources = function (host, app) {
    host.innerHTML = '';
    var st = app.state;
    var items = typeItems();

    st.sources.forEach(function (src, i) {
      var ti = Math.min(src.type, items.length - 1);
      var card = el('div', 'src' + (src.enabled ? ' on' : '') + (app.isSelected('source', src.id) ? ' sel' : ''));

      var head = el('div', 'src-head');
      var dot = el('div', 'dot');
      dot.style.background = items[ti].css;
      dot.style.color = items[ti].css;
      head.appendChild(dot);

      var nm = el('div', 'src-name', T('src.flow') + ' ' + (i + 1) + ' <small>· ' + items[ti].name + '</small>');
      head.appendChild(nm);

      var pick = el('button', 'mini', '✥');
      pick.title = T('src.select');
      pick.addEventListener('click', function (e) { e.stopPropagation(); app.select('source', src.id); });
      head.appendChild(pick);

      var sw = el('div', 'switch' + (src.enabled ? ' on' : ''));
      sw.addEventListener('click', function (e) {
        e.stopPropagation();
        src.enabled = !src.enabled;
        sw.classList.toggle('on', src.enabled);
        card.classList.toggle('on', src.enabled);
        app.changed();
      });
      head.appendChild(sw);
      card.appendChild(head);

      UI.chips(card, items, ti, function (k) {
        src.type = k;
        dot.style.background = items[k].css;
        dot.style.color = items[k].css;
        nm.innerHTML = T('src.flow') + ' ' + (i + 1) + ' <small>· ' + items[k].name + '</small>';
        app.changed();
      });

      UI.slider(card, {
        label: T('src.rate'), min: 40, max: 1600, step: 10, value: src.rate,
        tip: T('src.rate.tip'),
        fmt: function (v) { return Math.round(v) + '/s'; },
        onInput: function (v) { src.rate = v; app.changed(); }
      });

      card.addEventListener('click', function () { app.select('source', src.id); });
      host.appendChild(card);
    });

    var add = el('button', 'btn', T('src.add') + (st.sources.length >= 10 ? T('src.max') : ''));
    if (st.sources.length >= 10) add.disabled = true;
    add.addEventListener('click', function () { app.addSource(); });
    host.appendChild(add);
  };

  /* ---------- список объектов ---------- */

  var KIND_KEYS = ['sphere', 'building', 'car', 'tree', 'house', 'snowman', 'portal', 'field'];
  UI.KIND_KEYS = KIND_KEYS;

  UI.buildObjects = function (host, app) {
    host.innerHTML = '';
    var st = app.state;

    var adds = el('div', 'btnrow wrap');
    KIND_KEYS.forEach(function (k) {
      var b = el('button', 'btn sm', '+ ' + T('kind.' + k));
      b.addEventListener('click', function () { app.addObject(k); });
      adds.appendChild(b);
    });
    host.appendChild(adds);

    if (st.objects.length === 0) {
      host.appendChild(el('div', 'empty', T('obj.empty')));
      return;
    }

    var list = el('div', 'objlist');
    st.objects.forEach(function (o) {
      var row = el('div', 'objrow' + (app.isSelected('object', o.id) ? ' sel' : ''));
      var sw = el('span', 'swatch');
      sw.style.background = 'rgb(' + o.color.map(function (c) { return Math.round(c * 255); }).join(',') + ')';
      row.appendChild(sw);
      var name = T('kind.' + o.kind);
      if (o.kind === 'field') name += ' · ' + World.fieldName(o.mode);
      if (o.kind === 'car' && o.dynamic) name += ' · ' + T('obj.floats');
      row.appendChild(el('span', 'objname', name));
      var del = el('button', 'mini del', '×');
      del.addEventListener('click', function (e) { e.stopPropagation(); app.deleteObject(o.id); });
      row.appendChild(del);
      row.addEventListener('click', function () { app.select('object', o.id); });
      list.appendChild(row);
    });
    host.appendChild(list);
  };

  /* ---------- инспектор ---------- */

  UI.buildInspector = function (app) {
    var host = document.getElementById('inspector');
    host.innerHTML = '';
    var sel = app.selected;
    if (!sel) { host.classList.remove('show'); return; }
    host.classList.add('show');

    var obj = null, src = null;
    if (sel.kind === 'object') {
      obj = app.state.objects.filter(function (o) { return o.id === sel.id; })[0];
      if (!obj) { app.selected = null; host.classList.remove('show'); return; }
    } else {
      src = app.state.sources.filter(function (s) { return s.id === sel.id; })[0];
      if (!src) { app.selected = null; host.classList.remove('show'); return; }
    }

    var s = (app.sim && app.sim.scale) || 1;
    var half = (app.sim && app.sim.level && app.sim.level.half) || 2;
    var lim = half * 1.25;

    var head = el('div', 'insp-head');
    var title = obj ? T('kind.' + obj.kind) : T('sec.sources');
    head.appendChild(el('h3', null, title));
    var close = el('button', 'mini', '×');
    close.addEventListener('click', function () { app.select(null); });
    head.appendChild(close);
    host.appendChild(head);

    var body = el('div', 'insp-body');
    host.appendChild(body);

    // позиция
    var posHost = el('div');
    body.appendChild(posHost);
    ['X', 'Y', 'Z'].forEach(function (ax, i) {
      UI.slider(posHost, {
        label: T('obj.pos') + ' ' + ax, min: -lim, max: lim, step: lim / 200, value: (obj || src).pos[i],
        tip: T('obj.pos') + ' ' + ax,
        fmt: function (v) { return v.toFixed(2); },
        onInput: function (v) { (obj || src).pos[i] = v; app.changed(); }
      });
    });

    if (src) {
      var dir = src.dir;
      var pitch = Math.asin(Math.max(-1, Math.min(1, dir[1]))) * 180 / Math.PI;
      var yaw = Math.atan2(dir[0], dir[2]) * 180 / Math.PI;

      UI.slider(body, {
        label: T('src.yaw'), min: -180, max: 180, step: 1, value: yaw, tip: T('src.yaw.tip'),
        fmt: function (v) { return Math.round(v) + '°'; },
        onInput: function (v) { setDir(src, v, pitch); }
      });
      UI.slider(body, {
        label: T('src.pitch'), min: -90, max: 90, step: 1, value: pitch, tip: T('src.pitch.tip'),
        fmt: function (v) { return Math.round(v) + '°'; },
        onInput: function (v) { setDir(src, yaw, v); }
      });
      UI.slider(body, {
        label: T('src.speed'), min: 0, max: 12 * s, step: 0.05 * s, value: src.speed, tip: T('src.speed.tip'),
        fmt: function (v) { return v.toFixed(2) + ' m/s'; },
        onInput: function (v) { src.speed = v; app.changed(); }
      });
      UI.slider(body, {
        label: T('src.radius'), min: 0.03 * s, max: 0.5 * s, step: 0.005 * s, value: src.radius, tip: T('src.radius.tip'),
        fmt: function (v) { return v.toFixed(3) + ' m'; },
        onInput: function (v) { src.radius = v; app.changed(); }
      });

      var del = el('button', 'btn danger', T('src.delete'));
      del.addEventListener('click', function () { app.deleteSource(src.id); });
      body.appendChild(del);
    }

    if (obj) {
      if (obj.kind === 'sphere' || obj.kind === 'mound' || obj.kind === 'snowman') {
        UI.slider(body, {
          label: T('obj.radius'), min: 0.04 * s, max: 1.2 * s, step: 0.005 * s, value: obj.r, tip: T('obj.radius.tip'),
          fmt: function (v) { return v.toFixed(3) + ' m'; },
          onInput: function (v) { obj.r = v; app.changed(); }
        });
      }

      if (obj.kind === 'building' || obj.kind === 'car' || obj.kind === 'tree' || obj.kind === 'house') {
        UI.slider(body, {
          label: T('obj.width'), min: 0.03 * s, max: 0.8 * s, step: 0.005 * s, value: obj.size[0], tip: T('obj.width.tip'),
          fmt: function (v) { return v.toFixed(3); },
          onInput: function (v) { obj.size[0] = v; app.changed(); }
        });
        UI.slider(body, {
          label: T('obj.height'), min: 0.03 * s, max: 1.2 * s, step: 0.005 * s, value: obj.size[1], tip: T('obj.height.tip'),
          fmt: function (v) { return v.toFixed(3); },
          onInput: function (v) { obj.size[1] = v; app.changed(); }
        });
        UI.slider(body, {
          label: T('obj.depth'), min: 0.03 * s, max: 0.8 * s, step: 0.005 * s, value: obj.size[2], tip: T('obj.depth.tip'),
          fmt: function (v) { return v.toFixed(3); },
          onInput: function (v) { obj.size[2] = v; app.changed(); }
        });
        UI.slider(body, {
          label: T('obj.rot'), min: -180, max: 180, step: 1, value: (obj.rot || 0) * 180 / Math.PI, tip: T('obj.rot.tip'),
          fmt: function (v) { return Math.round(v) + '°'; },
          onInput: function (v) { obj.rot = v * Math.PI / 180; app.changed(); }
        });
      }

      if (obj.kind === 'car') {
        var tg = el('div', 'toggle-row');
        tg.appendChild(el('span', null, T('obj.floating')));
        var sw = el('div', 'switch' + (obj.dynamic ? ' on' : ''));
        sw.addEventListener('click', function () {
          obj.dynamic = !obj.dynamic;
          sw.classList.toggle('on', obj.dynamic);
          app.changed(); app.rebuildLists();
        });
        tg.appendChild(sw);
        body.appendChild(tg);
      }

      if (obj.kind === 'portal') {
        UI.slider(body, {
          label: T('obj.radius'), min: 0.08 * s, max: 0.6 * s, step: 0.005 * s, value: obj.r, tip: T('obj.radius.tip'),
          fmt: function (v) { return v.toFixed(3) + ' m'; },
          onInput: function (v) { obj.r = v; app.changed(); }
        });
        var nHost = el('div');
        body.appendChild(nHost);
        ['X', 'Y', 'Z'].forEach(function (ax, i) {
          UI.slider(nHost, {
            label: T('obj.normal') + ' ' + ax, min: -1, max: 1, step: 0.05, value: obj.normal[i], tip: T('obj.normal.tip'),
            fmt: function (v) { return v.toFixed(2); },
            onInput: function (v) {
              obj.normal[i] = v;
              var l = Math.hypot(obj.normal[0], obj.normal[1], obj.normal[2]) || 1;
              if (l > 0.01) { obj.normal[0] /= l; obj.normal[1] /= l; obj.normal[2] /= l; }
              app.changed();
            }
          });
        });
        body.appendChild(el('div', 'hintline', T('obj.pair') + ': ' + (obj.link || '—')));
      }

      if (obj.kind === 'field') {
        var modes = Object.keys(World.FIELD_MODES).map(function (k) {
          return {
            name: World.fieldName(k), key: k,
            css: '#' + World.FIELD_MODES[k].color.map(function (c) {
              return ('0' + Math.round(c * 255).toString(16)).slice(-2);
            }).join('')
          };
        });
        var cur = 0;
        modes.forEach(function (m, i) { if (m.key === obj.mode) cur = i; });
        UI.chips(body, modes, cur, function (i) {
          obj.mode = modes[i].key;
          obj.color = World.FIELD_MODES[obj.mode].color;
          app.changed(); app.rebuildLists(); app.rebuildInspector();
        });
        UI.slider(body, {
          label: T('obj.fieldRadius'), min: 0.08 * s, max: 2.0 * s, step: 0.01 * s, value: obj.radius, tip: T('obj.fieldRadius.tip'),
          fmt: function (v) { return v.toFixed(2) + ' m'; },
          onInput: function (v) { obj.radius = v; app.changed(); }
        });
        UI.slider(body, {
          label: T('obj.strength'), min: 0, max: 60, step: 0.5, value: obj.strength, tip: T('obj.strength.tip'),
          fmt: function (v) { return v.toFixed(1); },
          onInput: function (v) { obj.strength = v; app.changed(); }
        });
        if (obj.mode === 'accelerate') {
          var dHost = el('div');
          body.appendChild(dHost);
          ['X', 'Y', 'Z'].forEach(function (ax, i) {
            UI.slider(dHost, {
              label: T('obj.dir') + ' ' + ax, min: -1, max: 1, step: 0.05, value: obj.dir[i], tip: T('obj.dir.tip'),
              fmt: function (v) { return v.toFixed(2); },
              onInput: function (v) {
                obj.dir[i] = v;
                var l = Math.hypot(obj.dir[0], obj.dir[1], obj.dir[2]) || 1;
                if (l > 0.01) { obj.dir[0] /= l; obj.dir[1] /= l; obj.dir[2] /= l; }
                app.changed();
              }
            });
          });
        }
      }

      var del2 = el('button', 'btn danger', T('obj.delete'));
      del2.addEventListener('click', function () { app.deleteObject(obj.id); });
      body.appendChild(del2);
    }
  };

  function setDir(src, yawDeg, pitchDeg) {
    var y = yawDeg * Math.PI / 180, p = pitchDeg * Math.PI / 180;
    var cp = Math.cos(p);
    src.dir = [Math.sin(y) * cp, Math.sin(p), Math.cos(y) * cp];
    src.dir = FS.Gizmo.norm(src.dir);
  }

  /* ---------- физика ---------- */

  UI.buildPhysics = function (host, app) {
    host.innerHTML = '';
    var ph = app.state.physics;

    UI.slider(host, {
      label: T('ph.gravity'), min: -22, max: 2, step: 0.1, value: ph.gravity, tip: T('ph.gravity.tip'),
      fmt: function (v) { return v.toFixed(1) + ' m/s²'; },
      onInput: function (v) { ph.gravity = v; app.applyPhysics(); }
    });
    UI.slider(host, {
      label: T('ph.viscosity'), min: 0, max: 2.5, step: 0.05, value: ph.viscosity, tip: T('ph.viscosity.tip'),
      fmt: function (v) { return (v * 100).toFixed(0) + '%'; },
      onInput: function (v) { ph.viscosity = v; app.applyPhysics(); }
    });
    UI.slider(host, {
      label: T('ph.tension'), min: 0, max: 3, step: 0.05, value: ph.tension, tip: T('ph.tension.tip'),
      fmt: function (v) { return (v * 100).toFixed(0) + '%'; },
      onInput: function (v) { ph.tension = v; app.applyPhysics(); }
    });
    UI.slider(host, {
      label: T('ph.iterations'), min: 1, max: 4, step: 1, value: ph.iterations, tip: T('ph.iterations.tip'),
      fmt: function (v) { return v.toFixed(0); },
      onInput: function (v) { ph.iterations = v; app.applyPhysics(); }
    });
    UI.slider(host, {
      label: T('ph.timeScale'), min: 0.15, max: 2, step: 0.05, value: ph.timeScale, tip: T('ph.timeScale.tip'),
      fmt: function (v) { return '×' + v.toFixed(2); },
      onInput: function (v) { ph.timeScale = v; app.changed(); }
    });
    UI.slider(host, {
      label: T('ph.particleSize'), min: 0.6, max: 1.8, step: 0.02, value: ph.particleSize, tip: T('ph.particleSize.tip'),
      fmt: function (v) { return (v * 100).toFixed(0) + '%'; },
      onInput: function (v) { ph.particleSize = v; app.applyPhysics(); }
    });
  };

  /* ---------- производительность ---------- */

  UI.buildPerf = function (host, app) {
    host.innerHTML = '';
    var st = app.state;
    UI.slider(host, {
      label: T('perf.count'), min: 4096, max: 131072, step: 4096, value: st.count, tip: T('perf.count.tip'),
      fmt: function (v) { return (v / 1024).toFixed(0) + 'k'; },
      onInput: function (v) { app.pendingCount = v; }
    });
    var b = el('button', 'btn', T('perf.apply'));
    b.style.width = '100%';
    b.addEventListener('click', function () {
      if (app.pendingCount && app.pendingCount !== app.state.count) {
        app.state.count = app.pendingCount;
        app.rebuildSim();
      }
    });
    host.appendChild(b);
  };

  /* ---------- уровни / сценарии / небо ---------- */

  UI.buildLevels = function (host, app) {
    if (!host) return;
    host.innerHTML = '';
    var wrap = el('div', 'chips wide');
    Object.keys(World.LEVELS).forEach(function (key) {
      var L = World.LEVELS[key];
      var c = el('button', 'chip' + (app.state.level === key ? ' active' : ''),
        FS.I18N.t('level.' + key));
      if (app.state.level === key) { c.style.background = '#35d2e8'; c.style.borderColor = '#35d2e8'; c.style.color = '#041018'; }
      c.addEventListener('click', function () { app.setLevel(key); });
      wrap.appendChild(c);
    });
    host.appendChild(wrap);
  };

  UI.buildScenarios = function (host, app) {
    if (!host) return;
    host.innerHTML = '';
    var list = World.SCENARIOS[app.state.level] || [];
    var wrap = el('div', 'chips wide');
    list.forEach(function (key) {
      var c = el('button', 'chip' + (app.state.scenario === key ? ' active' : ''), World.scenarioName(key));
      if (app.state.scenario === key) { c.style.background = '#7ce8b0'; c.style.borderColor = '#7ce8b0'; c.style.color = '#04180f'; }
      c.addEventListener('click', function () { app.setScenario(key); });
      wrap.appendChild(c);
    });
    host.appendChild(wrap);
  };

  UI.buildSkies = function (host, app) {
    if (!host) return;
    host.innerHTML = '';
    var wrap = el('div', 'chips wide');
    World.SKIES.forEach(function (key) {
      var c = el('button', 'chip' + (app.state.skybox === key ? ' active' : ''), World.skyName(key));
      if (app.state.skybox === key) { c.style.background = '#35d2e8'; c.style.borderColor = '#35d2e8'; c.style.color = '#041018'; }
      c.addEventListener('click', function () { app.setSkybox(key); });
      wrap.appendChild(c);
    });
    host.appendChild(wrap);
  };
})();
