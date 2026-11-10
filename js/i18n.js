/* FluidLab 3D — локализация интерфейса (EN / RU) */
(function () {
  'use strict';
  var FS = (window.FS = window.FS || {});

  var DICT = {
    en: {
      'app.title': 'FluidLab 3D — real-time fluid simulation',
      'app.loading': 'initialising GPU solver…',
      'app.tagline': 'Position Based Fluids · GPU',

      'stats.fps': 'FPS',
      'stats.particles': 'particles',
      'stats.ms': 'ms',

      'sec.mode': 'Mode',
      'sec.level': 'Level',
      'sec.scenario': 'Scenario',
      'sec.sky': 'Sky & background',
      'sec.sources': 'Sources',
      'sec.objects': 'Scene objects',
      'sec.physics': 'Physics',
      'sec.perf': 'Performance',
      'sec.scene': 'Scene',
      'sec.language': 'Language',

      'mode.nav': 'Navigate',
      'mode.edit': 'Edit',
      'mode.nav.tip': 'Navigate: drag to orbit, WASD to fly, Space/Shift — up/down, wheel — zoom. Objects are not selectable.',
      'mode.edit.tip': 'Edit: click an object to select it and drag its arrows. Empty space still orbits the camera.',

      'level.city_mini': 'Mini city',
      'level.city_mid': 'Mid city',
      'level.city_big': 'Giant city',
      'level.tank': 'Tank',
      'level.sphere': 'Snow globe',
      'level.volcano': 'Volcano',
      'level.open': 'Open ground',
      'level.portal': 'Portal lab',

      'scen.flood': 'Flood',
      'scen.tsunami': 'Tsunami',
      'scen.rain': 'Downpour',
      'scen.mix': 'Mixed fluids',
      'scen.sewer': 'Sewer burst',
      'scen.lavaflow': 'Lava flow',
      'scen.portaljet': 'Portal loop',
      'scen.fountain': 'Fountain',
      'scen.whirl': 'Whirlpool',
      'scen.snowfall': 'Snowfall',
      'scen.eruption': 'Eruption',
      'scen.river': 'River',

      'sky.grid': 'Grid',
      'sky.night': 'Night',
      'sky.sunset': 'Sunset',
      'sky.day': 'Day',
      'sky.nebula': 'Nebula',
      'sky.studio': 'Studio',
      'sky.xmas': 'Christmas',

      'type.water': 'Water',
      'type.oil': 'Oil',
      'type.lava': 'Lava',
      'type.slime': 'Slime',
      'type.snow': 'Snow',
      'type.sand': 'Sand',
      'type.dust': 'Dust',
      'type.rain': 'Rain',

      'kind.sphere': 'Sphere',
      'kind.building': 'Building',
      'kind.car': 'Car',
      'kind.portal': 'Portal',
      'kind.field': 'Field',
      'kind.tree': 'Fir tree',
      'kind.snowman': 'Snowman',
      'kind.house': 'Cabin',

      'field.repel': 'Repel',
      'field.attract': 'Attract',
      'field.accelerate': 'Accelerate',
      'field.drag': 'Slow down',

      'src.flow': 'Stream',
      'src.select': 'Select (arrows to move)',
      'src.rate': 'Flow rate',
      'src.rate.tip': 'Particles emitted per second. Higher means a denser jet and more GPU load.',
      'src.add': '+ Add source',
      'src.max': ' (max 10)',
      'src.delete': 'Delete source',
      'src.yaw': 'Jet heading',
      'src.yaw.tip': 'Azimuth of the emission direction in degrees. 0 shoots along the Z axis.',
      'src.pitch': 'Jet tilt',
      'src.pitch.tip': 'Vertical angle: −90° straight down, 0° horizontal, +90° straight up.',
      'src.speed': 'Ejection speed',
      'src.speed.tip': 'Initial particle speed in m/s. Sets the jet range and the impact strength.',
      'src.radius': 'Nozzle radius',
      'src.radius.tip': 'Jet thickness in metres. Wide nozzle gives a dense flow, narrow gives a thin stream.',

      'obj.add': '+ Add',
      'obj.empty': 'No objects',
      'obj.width': 'Width',
      'obj.width.tip': 'Half-size along X.',
      'obj.height': 'Height',
      'obj.height.tip': 'Half-size along Y — half of the object height.',
      'obj.depth': 'Depth',
      'obj.depth.tip': 'Half-size along Z.',
      'obj.rot': 'Rotation',
      'obj.rot.tip': 'Rotation around the vertical axis, degrees.',
      'obj.radius': 'Radius',
      'obj.radius.tip': 'Radius of the obstacle. Fluid flows around it and runs down its surface.',
      'obj.floating': 'Physical (floats and is pushed by the flow)',
      'obj.normal': 'Normal',
      'obj.normal.tip': 'Facing direction of the portal. Particles leave the paired portal along its normal.',
      'obj.pair': 'Pair',
      'obj.fieldRadius': 'Reach',
      'obj.fieldRadius.tip': 'Radius of influence. The force ramps up smoothly towards the centre.',
      'obj.strength': 'Strength',
      'obj.strength.tip': 'How hard the field pushes, pulls, accelerates or slows the particles.',
      'obj.dir': 'Direction',
      'obj.dir.tip': 'Acceleration vector. Particles inside the radius get an impulse along this direction.',
      'obj.delete': 'Delete object',
      'obj.floats': 'floats',
      'obj.pos': 'Position',

      'ph.gravity': 'Gravity',
      'ph.gravity.tip': 'Gravitational acceleration. Negative pulls the fluid down; positive flips the world upside down.',
      'ph.viscosity': 'Viscosity',
      'ph.viscosity.tip': 'How strongly neighbouring particles drag each other (XSPH smoothing). 0 — water splashes freely, 100 % — thick liquid, 250 % — almost honey.',
      'ph.tension': 'Surface tension',
      'ph.tension.tip': 'Artificial pressure (s_corr). Keeps particles from clumping and spraying: 0 — loose fluid, 300 % — dense and rubbery.',
      'ph.iterations': 'Solver iterations',
      'ph.iterations.tip': 'How many times per frame the incompressibility constraint is solved. More iterations means tighter pressure and less springiness, but more GPU time.',
      'ph.timeScale': 'Time scale',
      'ph.timeScale.tip': 'Simulation step multiplier. Below 1 is slow motion, above 1 speeds it up (risk of instability grows).',
      'ph.particleSize': 'Particle size',
      'ph.particleSize.tip': 'Visual radius of the rendered spheres. Does not affect physics — only how solid the surface looks.',

      'perf.count': 'Particle count',
      'perf.count.tip': 'Size of the particle pool. Up to 128 000 for powerful GPUs: surface detail grows, but so do frame time and the amount of data read back from the GPU.',
      'perf.apply': 'Apply count',

      'btn.reset': 'Reset fluid',
      'btn.pause': 'Pause',
      'btn.resume': 'Resume',
      'btn.rotate': 'Auto-orbit',
      'btn.vortex': 'Vortex',
      'btn.clear': 'Clear objects',
      'btn.resetall': 'Reset settings',

      'foot.orbit': 'LMB — orbit · wheel — zoom',
      'foot.fly': 'WASD — fly · Space/Shift — up/down',
      'foot.push': 'RMB — push fluid',
      'foot.edit': 'click an object — arrows',

      'hint.click': 'Click an object to move it with the arrows',
      'err.webgl2': 'Your browser does not support <b>WebGL2</b>.<br>Please open the app in a recent Chrome, Edge or Firefox.',
      'err.float': 'Could not enable <b>EXT_color_buffer_float</b>.<br>The GPU solver requires float texture support.'
    },

    ru: {
      'app.title': 'FluidLab 3D — симуляция жидкости в реальном времени',
      'app.loading': 'инициализация GPU-решателя…',
      'app.tagline': 'Position Based Fluids · GPU',

      'stats.fps': 'FPS',
      'stats.particles': 'частиц',
      'stats.ms': 'мс',

      'sec.mode': 'Режим',
      'sec.level': 'Уровень',
      'sec.scenario': 'Сценарий',
      'sec.sky': 'Небо и фон',
      'sec.sources': 'Источники',
      'sec.objects': 'Объекты сцены',
      'sec.physics': 'Физика',
      'sec.perf': 'Производительность',
      'sec.scene': 'Сцена',
      'sec.language': 'Язык',

      'mode.nav': 'Навигация',
      'mode.edit': 'Редактирование',
      'mode.nav.tip': 'Навигация: тяните мышью — орбита, WASD — полёт, Space/Shift — вверх/вниз, колесо — зум. Объекты не выбираются.',
      'mode.edit.tip': 'Редактирование: клик по объекту выбирает его и показывает стрелки. Пустое место по-прежнему вращает камеру.',

      'level.city_mini': 'Мини-город',
      'level.city_mid': 'Средний город',
      'level.city_big': 'Гигантский город',
      'level.tank': 'Резервуар',
      'level.sphere': 'Снежный шар',
      'level.volcano': 'Вулкан',
      'level.open': 'Открытая площадка',
      'level.portal': 'Портальная лаборатория',

      'scen.flood': 'Потоп',
      'scen.tsunami': 'Цунами',
      'scen.rain': 'Ливень',
      'scen.mix': 'Смешение',
      'scen.sewer': 'Прорыв канализации',
      'scen.lavaflow': 'Поток лавы',
      'scen.portaljet': 'Портальная петля',
      'scen.fountain': 'Фонтан',
      'scen.whirl': 'Водоворот',
      'scen.snowfall': 'Снегопад',
      'scen.eruption': 'Извержение',
      'scen.river': 'Река',

      'sky.grid': 'Сетка',
      'sky.night': 'Ночь',
      'sky.sunset': 'Закат',
      'sky.day': 'День',
      'sky.nebula': 'Туманность',
      'sky.studio': 'Студия',
      'sky.xmas': 'Рождество',

      'type.water': 'Вода',
      'type.oil': 'Нефть',
      'type.lava': 'Лава',
      'type.slime': 'Слизь',
      'type.snow': 'Снег',
      'type.sand': 'Песок',
      'type.dust': 'Пыль',
      'type.rain': 'Дождь',

      'kind.sphere': 'Сфера',
      'kind.building': 'Здание',
      'kind.car': 'Машина',
      'kind.portal': 'Портал',
      'kind.field': 'Поле',
      'kind.tree': 'Ёлка',
      'kind.snowman': 'Снеговик',
      'kind.house': 'Домик',

      'field.repel': 'Отталкивание',
      'field.attract': 'Притяжение',
      'field.accelerate': 'Ускорение',
      'field.drag': 'Торможение',

      'src.flow': 'Поток',
      'src.select': 'Выбрать (стрелки для перемещения)',
      'src.rate': 'Интенсивность',
      'src.rate.tip': 'Сколько частиц в секунду источник выбрасывает. Больше — плотнее струя и выше нагрузка на GPU.',
      'src.add': '+ Добавить источник',
      'src.max': ' (макс. 10)',
      'src.delete': 'Удалить источник',
      'src.yaw': 'Поворот струи',
      'src.yaw.tip': 'Азимут направления выброса частиц, градусы. 0 — струя летит вдоль оси Z.',
      'src.pitch': 'Наклон струи',
      'src.pitch.tip': 'Вертикальный угол выброса. −90° — строго вниз, 0° — горизонтально, +90° — вверх.',
      'src.speed': 'Скорость выброса',
      'src.speed.tip': 'Начальная скорость частиц, м/с. Влияет на дальность полёта струи и силу удара.',
      'src.radius': 'Радиус сопла',
      'src.radius.tip': 'Толщина струи в метрах. Широкое сопло даёт плотный поток, узкое — тонкую струйку.',

      'obj.add': '+ Добавить',
      'obj.empty': 'Объектов нет',
      'obj.width': 'Ширина',
      'obj.width.tip': 'Полуразмер по X.',
      'obj.height': 'Высота',
      'obj.height.tip': 'Полуразмер по Y — половина высоты объекта.',
      'obj.depth': 'Глубина',
      'obj.depth.tip': 'Полуразмер по Z.',
      'obj.rot': 'Поворот',
      'obj.rot.tip': 'Поворот вокруг вертикальной оси, градусы.',
      'obj.radius': 'Радиус',
      'obj.radius.tip': 'Радиус препятствия. Жидкость обтекает его и скатывается по поверхности.',
      'obj.floating': 'Физичный (плавает, его сносит потоком)',
      'obj.normal': 'Нормаль',
      'obj.normal.tip': 'Направление «лица» портала. Частица вылетает из парного портала вдоль его нормали.',
      'obj.pair': 'Пара',
      'obj.fieldRadius': 'Радиус действия',
      'obj.fieldRadius.tip': 'Радиус сферы влияния. Внутри неё сила плавно нарастает к центру.',
      'obj.strength': 'Сила',
      'obj.strength.tip': 'Интенсивность воздействия: отталкивание, притяжение, ускорение вдоль направления или торможение.',
      'obj.dir': 'Направление',
      'obj.dir.tip': 'Вектор ускорения. Частицы внутри радиуса получают импульс вдоль этого направления.',
      'obj.delete': 'Удалить объект',
      'obj.floats': 'плавает',
      'obj.pos': 'Позиция',

      'ph.gravity': 'Гравитация',
      'ph.gravity.tip': 'Ускорение свободного падения. Отрицательное тянет жидкость вниз; положительное переворачивает мир.',
      'ph.viscosity': 'Вязкость',
      'ph.viscosity.tip': 'Насколько сильно соседние частицы тянут друг друга (сглаживание XSPH). 0 — вода брызгает, 100 % — густая жидкость, 250 % — почти мёд.',
      'ph.tension': 'Поверхностное натяжение',
      'ph.tension.tip': 'Искусственное давление s_corr. Не даёт частицам слипаться в комки: 0 — рыхлая жидкость, 300 % — плотная и «резиновая».',
      'ph.iterations': 'Итерации решателя',
      'ph.iterations.tip': 'Сколько раз за кадр решается условие несжимаемости. Больше — точнее давление, но дороже по времени GPU.',
      'ph.timeScale': 'Скорость времени',
      'ph.timeScale.tip': 'Множитель шага симуляции. Меньше 1 — замедленная съёмка, больше 1 — ускорение (растёт риск нестабильности).',
      'ph.particleSize': 'Крупность частиц',
      'ph.particleSize.tip': 'Визуальный радиус сфер при рендере. Не влияет на физику — только на то, насколько плотной выглядит поверхность.',

      'perf.count': 'Количество частиц',
      'perf.count.tip': 'Размер парка частиц. До 128 000 — для мощных видеокарт: детализация растёт, но время кадра и объём данных с GPU тоже.',
      'perf.apply': 'Применить количество',

      'btn.reset': 'Сброс жидкости',
      'btn.pause': 'Пауза',
      'btn.resume': 'Продолжить',
      'btn.rotate': 'Авто-вращение',
      'btn.vortex': 'Водоворот',
      'btn.clear': 'Убрать объекты',
      'btn.resetall': 'Сбросить настройки',

      'foot.orbit': 'ЛКМ — орбита · колесо — зум',
      'foot.fly': 'WASD — полёт · Space/Shift — вверх/вниз',
      'foot.push': 'ПКМ — толкать',
      'foot.edit': 'клик по объекту — стрелки',

      'hint.click': 'Кликните по объекту, чтобы двигать его стрелками',
      'err.webgl2': 'Ваш браузер не поддерживает <b>WebGL2</b>.<br>Откройте приложение в Chrome, Edge или Firefox последней версии.',
      'err.float': 'Не удалось включить <b>EXT_color_buffer_float</b>.<br>GPU-решатель требует поддержки float-текстур.'
    }
  };

  var I = (FS.I18N = {});

  I.detect = function () {
    var stored = null;
    try { stored = localStorage.getItem('fluidlab3d.lang'); } catch (e) {}
    if (stored === 'en' || stored === 'ru') return stored;
    var nav = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
    return nav.indexOf('ru') === 0 ? 'ru' : 'en';
  };

  I.lang = I.detect();
  I.available = ['en', 'ru'];

  I.set = function (lang) {
    if (DICT[lang]) {
      I.lang = lang;
      try { localStorage.setItem('fluidlab3d.lang', lang); } catch (e) {}
      document.documentElement.lang = lang;
    }
  };

  I.t = function (key, vars) {
    var d = DICT[I.lang] || DICT.en;
    var s = d[key];
    if (s === undefined) s = (DICT.en[key] !== undefined ? DICT.en[key] : key);
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]);
      });
    }
    return s;
  };

  // статические узлы разметки: data-i18n="key"
  I.applyStatic = function (root) {
    var nodes = (root || document).querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var k = nodes[i].getAttribute('data-i18n');
      if (nodes[i].hasAttribute('data-i18n-title')) nodes[i].title = I.t(k);
      else nodes[i].textContent = I.t(k);
    }
    var tNodes = (root || document).querySelectorAll('[data-i18n-title]');
    for (var j = 0; j < tNodes.length; j++) {
      tNodes[j].title = I.t(tNodes[j].getAttribute('data-i18n-title'));
    }
    document.title = I.t('app.title');
  };
})();
