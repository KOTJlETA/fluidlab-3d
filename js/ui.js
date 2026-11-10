/* FluidLab 3D — построение интерфейса */
(function () {
  'use strict';
  var FS = window.FS;
  var UI = (FS.UI = {});
  var World = FS.World;

  var TYPES = [
    { name: 'Вода', css: '#2173d1' },
    { name: 'Нефть', css: '#a86a1a' },
    { name: 'Лава', css: '#ff5210' },
    { name: 'Слизь', css: '#33d961' },
    { name: 'Снег', css: '#eef4ff' }
  ];
  UI.TYPES = TYPES;

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

  UI.chips = function (parent, items, active, onPick) {
    var wrap = el('div', 'chips');
    items.forEach(function (it, i) {
      var c = el('button', 'chip' + (i === active ? ' active' : ''), it.name);
      if (i === active) { c.style.background = it.css; c.style.borderColor = it.css; }
      c.addEventListener('click', function () {
        wrap.querySelectorAll('.chip').forEach(function (x) {
          x.classList.remove('active'); x.style.background = ''; x.style.borderColor = '';
        });
        c.classList.add('active');
        c.style.background = it.css;
        c.style.borderColor = it.css;
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

  /* ---------- список источников ---------- */

  UI.buildSources = function (host, app) {
    host.innerHTML = '';
    var st = app.state;

    st.sources.forEach(function (src, i) {
      var card = el('div', 'src' + (src.enabled ? ' on' : '') + (app.isSelected('source', src.id) ? ' sel' : ''));

      var head = el('div', 'src-head');
      var dot = el('div', 'dot');
      dot.style.background = TYPES[src.type].css;
      dot.style.color = TYPES[src.type].css;
      head.appendChild(dot);

      var nm = el('div', 'src-name', 'Поток ' + (i + 1) + ' <small>· ' + TYPES[src.type].name + '</small>');
      head.appendChild(nm);

      var pick = el('button', 'mini', '✥');
      pick.title = 'Выбрать (стрелки для перемещения)';
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

      UI.chips(card, TYPES, src.type, function (ti) {
        src.type = ti;
        dot.style.background = TYPES[ti].css;
        dot.style.color = TYPES[ti].css;
        nm.innerHTML = 'Поток ' + (i + 1) + ' <small>· ' + TYPES[ti].name + '</small>';
        app.changed();
      });

      UI.slider(card, {
        label: 'Интенсивность', min: 40, max: 1400, step: 10, value: src.rate,
        tip: 'Сколько частиц в секунду источник выбрасывает. Больше — плотнее струя и выше нагрузка на GPU.',
        fmt: function (v) { return Math.round(v) + '/с'; },
        onInput: function (v) { src.rate = v; app.changed(); }
      });

      card.addEventListener('click', function () { app.select('source', src.id); });
      host.appendChild(card);
    });

    var add = el('button', 'btn', '+ Добавить источник' + (st.sources.length >= 10 ? ' (макс. 10)' : ''));
    if (st.sources.length >= 10) add.disabled = true;
    add.addEventListener('click', function () { app.addSource(); });
    host.appendChild(add);
  };

  /* ---------- список объектов ---------- */

  var KIND_NAMES = {
    sphere: 'Сфера', building: 'Здание', car: 'Машина', portal: 'Портал', field: 'Поле'
  };
  UI.KIND_NAMES = KIND_NAMES;

  UI.buildObjects = function (host, app) {
    host.innerHTML = '';
    var st = app.state;

    var adds = el('div', 'btnrow wrap');
    [['sphere', 'Сфера'], ['building', 'Здание'], ['car', 'Машина'],
     ['portal', 'Портал'], ['field', 'Поле']].forEach(function (k) {
      var b = el('button', 'btn sm', '+ ' + k[1]);
      b.addEventListener('click', function () { app.addObject(k[0]); });
      adds.appendChild(b);
    });
    host.appendChild(adds);

    if (st.objects.length === 0) {
      host.appendChild(el('div', 'empty', 'Объектов нет'));
      return;
    }

    var list = el('div', 'objlist');
    st.objects.forEach(function (o) {
      var row = el('div', 'objrow' + (app.isSelected('object', o.id) ? ' sel' : ''));
      var sw = el('span', 'swatch');
      sw.style.background = 'rgb(' + o.color.map(function (c) { return Math.round(c * 255); }).join(',') + ')';
      row.appendChild(sw);
      var name = KIND_NAMES[o.kind] || o.kind;
      if (o.kind === 'field') name += ' · ' + (World.FIELD_MODES[o.mode] || { name: '' }).name;
      if (o.kind === 'car' && o.dynamic) name += ' · плавает';
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

    var head = el('div', 'insp-head');
    var title = obj ? (KIND_NAMES[obj.kind] || obj.kind) : 'Источник';
    head.appendChild(el('h3', null, title));
    var close = el('button', 'mini', '×');
    close.addEventListener('click', function () { app.select(null); });
    head.appendChild(close);
    host.appendChild(head);

    var body = el('div', 'insp-body');
    host.appendChild(body);

    var changed = function () { app.changed(); app.rebuildLists(); };

    // позиция
    var posHost = el('div');
    body.appendChild(posHost);
    ['X', 'Y', 'Z'].forEach(function (ax, i) {
      UI.slider(posHost, {
        label: 'Позиция ' + ax, min: -2.2, max: 2.2, step: 0.01, value: (obj || src).pos[i],
        tip: 'Положение объекта по оси ' + ax + '. Можно двигать и стрелками прямо в сцене.',
        fmt: function (v) { return v.toFixed(2); },
        onInput: function (v) { (obj || src).pos[i] = v; app.changed(); }
      });
    });

    if (src) {
      var dir = src.dir;
      var pitch = Math.asin(Math.max(-1, Math.min(1, dir[1]))) * 180 / Math.PI;
      var yaw = Math.atan2(dir[0], dir[2]) * 180 / Math.PI;

      UI.slider(body, {
        label: 'Поворот струи', min: -180, max: 180, step: 1, value: yaw,
        tip: 'Азимут направления выброса частиц, градусы. 0 — струя летит вдоль оси Z.',
        fmt: function (v) { return Math.round(v) + '°'; },
        onInput: function (v) { setDir(src, v, pitch); }
      });
      UI.slider(body, {
        label: 'Наклон струи', min: -90, max: 90, step: 1, value: pitch,
        tip: 'Вертикальный угол выброса. −90° — строго вниз, 0° — горизонтально, +90° — вверх.',
        fmt: function (v) { return Math.round(v) + '°'; },
        onInput: function (v) { setDir(src, yaw, v); }
      });
      UI.slider(body, {
        label: 'Скорость выброса', min: 0, max: 6, step: 0.05, value: src.speed,
        tip: 'Начальная скорость частиц, м/с. Влияет на дальность полёта струи и силу удара.',
        fmt: function (v) { return v.toFixed(2) + ' м/с'; },
        onInput: function (v) { src.speed = v; app.changed(); }
      });
      UI.slider(body, {
        label: 'Радиус сопла', min: 0.03, max: 0.35, step: 0.005, value: src.radius,
        tip: 'Толщина струи в метрах. Широкое сопло даёт плотный поток, узкое — тонкую струйку.',
        fmt: function (v) { return v.toFixed(3) + ' м'; },
        onInput: function (v) { src.radius = v; app.changed(); }
      });

      var del = el('button', 'btn danger', 'Удалить источник');
      del.addEventListener('click', function () { app.deleteSource(src.id); });
      body.appendChild(del);
    }

    if (obj) {
      if (obj.kind === 'sphere') {
        UI.slider(body, {
          label: 'Радиус', min: 0.04, max: 0.6, step: 0.005, value: obj.r,
          tip: 'Радиус сферы-препятствия. Жидкость обтекает её и скатывается по поверхности.',
          fmt: function (v) { return v.toFixed(3) + ' м'; },
          onInput: function (v) { obj.r = v; app.changed(); }
        });
      }

      if (obj.kind === 'building' || obj.kind === 'car') {
        UI.slider(body, {
          label: 'Ширина', min: 0.03, max: 0.5, step: 0.005, value: obj.size[0],
          tip: 'Полуразмер по X. Размеры задаются как половина стороны.',
          fmt: function (v) { return v.toFixed(3); },
          onInput: function (v) { obj.size[0] = v; app.changed(); }
        });
        UI.slider(body, {
          label: 'Высота', min: 0.03, max: 0.8, step: 0.005, value: obj.size[1],
          tip: 'Полуразмер по Y — половина высоты объекта.',
          fmt: function (v) { return v.toFixed(3); },
          onInput: function (v) { obj.size[1] = v; app.changed(); }
        });
        UI.slider(body, {
          label: 'Глубина', min: 0.03, max: 0.5, step: 0.005, value: obj.size[2],
          tip: 'Полуразмер по Z — половина глубины объекта.',
          fmt: function (v) { return v.toFixed(3); },
          onInput: function (v) { obj.size[2] = v; app.changed(); }
        });
        UI.slider(body, {
          label: 'Поворот', min: -180, max: 180, step: 1, value: (obj.rot || 0) * 180 / Math.PI,
          tip: 'Поворот вокруг вертикальной оси, градусы.',
          fmt: function (v) { return Math.round(v) + '°'; },
          onInput: function (v) { obj.rot = v * Math.PI / 180; app.changed(); }
        });
      }

      if (obj.kind === 'car') {
        var tg = el('div', 'toggle-row');
        tg.appendChild(el('span', null, 'Физичная (плавает и её сносит потоком)'));
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
          label: 'Радиус воронки', min: 0.08, max: 0.4, step: 0.005, value: obj.r,
          tip: 'Частица, попавшая в этот радиус и летящая «внутрь», мгновенно переносится ко второму порталу пары.',
          fmt: function (v) { return v.toFixed(3) + ' м'; },
          onInput: function (v) { obj.r = v; app.changed(); }
        });
        var nHost = el('div');
        body.appendChild(nHost);
        ['X', 'Y', 'Z'].forEach(function (ax, i) {
          UI.slider(nHost, {
            label: 'Нормаль ' + ax, min: -1, max: 1, step: 0.05, value: obj.normal[i],
            tip: 'Направление «лица» портала. Частица вылетает из второго портала вдоль его нормали.',
            fmt: function (v) { return v.toFixed(2); },
            onInput: function (v) {
              obj.normal[i] = v;
              var l = Math.hypot(obj.normal[0], obj.normal[1], obj.normal[2]) || 1;
              if (l > 0.01) { obj.normal[0] /= l; obj.normal[1] /= l; obj.normal[2] /= l; }
              app.changed();
            }
          });
        });
        var pair = el('div', 'hintline', 'Пара: ' + (obj.link || '—'));
        body.appendChild(pair);
      }

      if (obj.kind === 'field') {
        var modes = Object.keys(World.FIELD_MODES).map(function (k) {
          return { name: World.FIELD_MODES[k].name, css: '#' + World.FIELD_MODES[k].color.map(function (c) {
            return ('0' + Math.round(c * 255).toString(16)).slice(-2);
          }).join('') , key: k };
        });
        var cur = 0;
        modes.forEach(function (m, i) { if (m.key === obj.mode) cur = i; });
        UI.chips(body, modes, cur, function (i) {
          obj.mode = modes[i].key;
          obj.color = World.FIELD_MODES[obj.mode].color;
          app.changed(); app.rebuildLists(); app.rebuildInspector();
        });
        UI.slider(body, {
          label: 'Радиус действия', min: 0.08, max: 1.0, step: 0.01, value: obj.radius,
          tip: 'Радиус сферы влияния. Внутри неё сила плавно нарастает к центру.',
          fmt: function (v) { return v.toFixed(2) + ' м'; },
          onInput: function (v) { obj.radius = v; app.changed(); }
        });
        UI.slider(body, {
          label: 'Сила', min: 0, max: 40, step: 0.5, value: obj.strength,
          tip: 'Интенсивность воздействия на частицы: отталкивание, притяжение, ускорение вдоль направления или торможение.',
          fmt: function (v) { return v.toFixed(1); },
          onInput: function (v) { obj.strength = v; app.changed(); }
        });
        if (obj.mode === 'accelerate') {
          var dHost = el('div');
          body.appendChild(dHost);
          ['X', 'Y', 'Z'].forEach(function (ax, i) {
            UI.slider(dHost, {
              label: 'Направление ' + ax, min: -1, max: 1, step: 0.05, value: obj.dir[i],
              tip: 'Вектор ускорения. Частицы внутри радиуса получают импульс вдоль этого направления.',
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

      var del2 = el('button', 'btn danger', 'Удалить объект');
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
      label: 'Гравитация', min: -22, max: 2, step: 0.1, value: ph.gravity,
      tip: 'Ускорение свободного падения. Отрицательное тянет жидкость вниз; положительное переворачивает мир и жидкость «падает» вверх.',
      fmt: function (v) { return v.toFixed(1) + ' м/с²'; },
      onInput: function (v) { ph.gravity = v; app.applyPhysics(); }
    });
    UI.slider(host, {
      label: 'Вязкость', min: 0, max: 2.5, step: 0.05, value: ph.viscosity,
      tip: 'Насколько сильно соседние частицы тянут друг друга за собой (сглаживание XSPH). 0 — вода разлетается и брызгает, 100 % — густая жидкость, 250 % — почти мёд.',
      fmt: function (v) { return (v * 100).toFixed(0) + '%'; },
      onInput: function (v) { ph.viscosity = v; app.applyPhysics(); }
    });
    UI.slider(host, {
      label: 'Поверхностное натяжение', min: 0, max: 3, step: 0.05, value: ph.tension,
      tip: 'Искусственное давление s_corr. Не даёт частицам слипаться в комки и разлетаться пылью: при 0 жидкость рыхлая, при 300 % — плотная и «резиновая».',
      fmt: function (v) { return (v * 100).toFixed(0) + '%'; },
      onInput: function (v) { ph.tension = v; app.applyPhysics(); }
    });
    UI.slider(host, {
      label: 'Итерации решателя', min: 1, max: 4, step: 1, value: ph.iterations,
      tip: 'Сколько раз за кадр решается условие несжимаемости. Больше итераций — точнее давление и меньше «пружинистость», но дороже по времени GPU.',
      fmt: function (v) { return v.toFixed(0); },
      onInput: function (v) { ph.iterations = v; app.applyPhysics(); }
    });
    UI.slider(host, {
      label: 'Скорость времени', min: 0.15, max: 2, step: 0.05, value: ph.timeScale,
      tip: 'Множитель шага симуляции. Меньше 1 — замедленная съёмка, больше 1 — ускорение (растёт риск нестабильности).',
      fmt: function (v) { return '×' + v.toFixed(2); },
      onInput: function (v) { ph.timeScale = v; app.changed(); }
    });
    UI.slider(host, {
      label: 'Крупность частиц', min: 0.6, max: 1.8, step: 0.02, value: ph.particleSize,
      tip: 'Визуальный радиус сфер при рендере. Не влияет на физику — только на то, насколько плотной выглядит поверхность жидкости.',
      fmt: function (v) { return (v * 100).toFixed(0) + '%'; },
      onInput: function (v) { ph.particleSize = v; app.applyPhysics(); }
    });
  };

  /* ---------- производительность ---------- */

  UI.buildPerf = function (host, app) {
    host.innerHTML = '';
    var st = app.state;
    UI.slider(host, {
      label: 'Количество частиц', min: 4096, max: 131072, step: 4096, value: st.count,
      tip: 'Размер парка частиц. До 128 000 — для мощных видеокарт: качество поверхности и детализация брызг растут, но время кадра и объём данных, читаемых с GPU, тоже.',
      fmt: function (v) { return (v / 1024).toFixed(0) + 'k'; },
      onInput: function (v) { app.pendingCount = v; }
    });
    var b = el('button', 'btn', 'Применить количество');
    b.style.width = '100%';
    b.addEventListener('click', function () {
      if (app.pendingCount && app.pendingCount !== app.state.count) {
        app.state.count = app.pendingCount;
        app.rebuildSim();
      }
    });
    host.appendChild(b);
  };

  UI.buildLevels = function (host, app) {
    host.innerHTML = '';
    var wrap = el('div', 'chips wide');
    Object.keys(World.LEVELS).forEach(function (key) {
      var L = World.LEVELS[key];
      var c = el('button', 'chip' + (app.state.level === key ? ' active' : ''), L.name);
      if (app.state.level === key) { c.style.background = '#35d2e8'; c.style.borderColor = '#35d2e8'; c.style.color = '#041018'; }
      c.addEventListener('click', function () { app.setLevel(key); });
      wrap.appendChild(c);
    });
    host.appendChild(wrap);
  };

  UI.buildSkies = function (host, app) {
    host.innerHTML = '';
    var wrap = el('div', 'chips wide');
    Object.keys(World.SKIES).forEach(function (key) {
      var c = el('button', 'chip' + (app.state.skybox === key ? ' active' : ''), World.SKIES[key]);
      if (app.state.skybox === key) { c.style.background = '#35d2e8'; c.style.borderColor = '#35d2e8'; c.style.color = '#041018'; }
      c.addEventListener('click', function () { app.setSkybox(key); });
      wrap.appendChild(c);
    });
    host.appendChild(wrap);
  };
})();
