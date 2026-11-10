/* FluidLab 3D — GPU-симуляция жидкости (Position Based Fluids / SPH) */
(function () {
  'use strict';
  var FS = window.FS;
  var GL = FS.GL;

  var PARK_Y = -1000.0;

  function FluidSim(gl, opts) {
    opts = opts || {};
    this.gl = gl;

    this.TW = 128;
    this.count = opts.count || 24576;
    this.TH = Math.ceil(this.count / this.TW);
    this.N = this.TW * this.TH;

    this.level = FS.World.LEVELS.city_mini;
    this.scale = this.level.scale;
    this.h = 0.17 * this.scale;
    this.cellSize = this.h;
    this.gridMin = [-3, -3, -3];
    this.GX = 36; this.GY = 36; this.GZ = 36;
    this.gridCells = this.GX * this.GY * this.GZ;

    this.objects = [];
    this.sources = FS.World.defaultSources('city_mini');

    this.pRadius = 0.040 * this.scale;
    this.spacing = new Float32Array(8);
    this.buoy = new Float32Array(8);
    this.visc = new Float32Array(8);
    this.isFluid = new Float32Array(8);
    this.gravScale = new Float32Array(8);
    this.drag = new Float32Array(8);
    this.radiusRender = 0.95 * this.h;

    this.gravity = -9.81;
    this.maxSpeed = 6.0 * this.scale;
    this.iterations = 2;
    this.sCorrK = 0.0004;
    this.eps = 1e-5;
    this.cMin = -0.08;
    this.lamMax = 0.002;
    this.viscScale = 1.0;
    this.vortex = 0;

    this.mouse = { pos: [0, 0, 0], force: [0, 0, 0], radius: 0 };
    this.lastDt = 1 / 60;
    this.time = 0;
    this._spawnList = [];

    this.uSph = new Float32Array(16 * 4);
    this.uBox = new Float32Array(40 * 4);
    this.uBoxHalf = new Float32Array(40 * 3);
    this.uField = new Float32Array(8 * 4);
    this.uFieldP = new Float32Array(8 * 4);
    this.uFieldDir = new Float32Array(8 * 4);
    this.uPortalA = new Float32Array(4 * 4);
    this.uPortalB = new Float32Array(4 * 4);
    this.uPortalAn = new Float32Array(4 * 4);
    this.uPortalBn = new Float32Array(4 * 4);
    this.counts = { sph: 0, box: 0, field: 0, portal: 0 };

    this._alloc();
    this.reset();
  }

  FluidSim.prototype._mkTarget = function () {
    var gl = this.gl;
    var tex = GL.texture(gl, this.TW, this.TH, gl.RGBA32F, gl.RGBA, gl.FLOAT, null, gl.NEAREST);
    var fbo = GL.fbo(gl, [tex], null);
    return { tex: tex, fbo: fbo };
  };

  FluidSim.prototype._alloc = function () {
    var gl = this.gl;
    var N = this.N;

    if (this.pos) {
      var old = [this.pos, this.vel, this.predA, this.predB, this.lam, this.posB, this.velB];
      for (var o = 0; o < old.length; o++) {
        gl.deleteFramebuffer(old[o].fbo);
        gl.deleteTexture(old[o].tex);
      }
      gl.deleteFramebuffer(this.mrt);
      gl.deleteTexture(this.typeTex);
      gl.deleteTexture(this.gridTex);
      gl.deleteTexture(this.gridIdxTex);
    }

    this.pos = this._mkTarget();
    this.vel = this._mkTarget();
    this.predA = this._mkTarget();
    this.predB = this._mkTarget();
    this.lam = this._mkTarget();
    this.posB = this._mkTarget();
    this.velB = this._mkTarget();
    this.mrt = GL.fbo(gl, [this.posB.tex, this.velB.tex], null);

    this.typeData = new Float32Array(N * 4);
    this.typeTex = GL.texture(gl, this.TW, this.TH, gl.RGBA32F, gl.RGBA, gl.FLOAT, this.typeData, gl.NEAREST);

    this.gridTex = null;
    this._allocGrid();
    this.cellOf = new Int32Array(N);
    this.gridIdx = new Float32Array(N);
    this.gridIdxTex = GL.texture(gl, this.TW, this.TH, gl.R32F, gl.RED, gl.FLOAT, null, gl.NEAREST);

    this.posCPU = new Float32Array(N * 4);
    this.velCPU = new Float32Array(N * 4);
    this.alive = new Uint8Array(N);
    this.free = [];
    for (var i = N - 1; i >= 0; i--) this.free.push(i);

    this.scratch = new Float32Array(4);
    this._dirtyFlag = new Uint8Array(N);
    this._spawnList = [];

    this.prog = {
      predict: GL.program(gl, FS.SH.fullscreenVS, FS.SH.predictFS, 'predict'),
      density: GL.program(gl, FS.SH.fullscreenVS, FS.SH.densityFS, 'density'),
      delta: GL.program(gl, FS.SH.fullscreenVS, FS.SH.deltaFS, 'delta'),
      velocity: GL.program(gl, FS.SH.fullscreenVS, FS.SH.velocityFS, 'velocity')
    };

    this.quadVAO = GL.fullscreenVAO(gl);

    var h = this.h;
    var PI = Math.PI;
    this.kPoly6 = 315 / (64 * PI * Math.pow(h, 9));
    this.kSpiky = 45 / (PI * Math.pow(h, 6));
  };

  FluidSim.prototype._syncTypes = function () {
    var T = FS.World.TYPES;
    for (var i = 0; i < 8; i++) {
      var t = T[i] || T[0];
      this.spacing[i] = t.spacing * this.scale;
      this.buoy[i] = t.buoy;
      this.visc[i] = t.visc;
      this.isFluid[i] = t.fluid ? 1 : 0;
      this.gravScale[i] = t.grav;
      this.drag[i] = t.drag;
    }
  };

  FluidSim.prototype._allocGrid = function () {
    var gl = this.gl;
    if (this.gridTex) gl.deleteTexture(this.gridTex);
    this.gridTex = GL.texture(gl, this.GX, this.GY * this.GZ, gl.RG32F, gl.RG, gl.FLOAT, null, gl.NEAREST);
    this.gridUpload = new Float32Array(this.gridCells * 2);
    this.cellCounts = new Int32Array(this.gridCells);
    this.cellStart = new Int32Array(this.gridCells);
    this.cursor = new Int32Array(this.gridCells);
  };

  /* Перестроить мир под уровень: масштаб частиц, шаг решётки, границы */
  FluidSim.prototype.applyLevel = function (level, keepFluid) {
    this.level = level;
    var s = level.scale || 1;
    this.scale = s;
    this.h = 0.17 * s;
    this.cellSize = this.h;
    this.pRadius = 0.040 * s;
    this.radiusRender = 0.95 * this.h;
    this.maxSpeed = 6.0 * s;
    this._syncTypes();

    var PI = Math.PI, h = this.h;
    this.kPoly6 = 315 / (64 * PI * Math.pow(h, 9));
    this.kSpiky = 45 / (PI * Math.pow(h, 6));

    var L = level, pad = 6 * this.h, lo, hi;
    if (L.kind === 'sphere') {
      lo = [L.center[0] - L.radius, L.center[1] - L.radius, L.center[2] - L.radius];
      hi = [L.center[0] + L.radius, L.center[1] + L.radius, L.center[2] + L.radius];
    } else if (L.kind === 'none') {
      // открытые уровни: жидкость растекается заметно шире арены
      var ext = L.half * 1.85;
      lo = [-ext, L.min[1] - 1.5 * s, -ext];
      hi = [ext, L.max[1], ext];
      pad = 4 * this.h;
    } else {
      lo = L.min.slice(); hi = L.max.slice();
    }
    this.GMAX = L.terrain ? 72 : 48;
    this.gridExtent = [hi[0] - lo[0] + 2 * pad, hi[1] - lo[1] + 2 * pad, hi[2] - lo[2] + 2 * pad];
    this.GX = Math.min(this.GMAX, Math.ceil(this.gridExtent[0] / this.h));
    this.GY = Math.min(L.terrain ? 24 : 32, Math.ceil(this.gridExtent[1] / this.h));
    this.GZ = Math.min(this.GMAX, Math.ceil(this.gridExtent[2] / this.h));
    // сетка центрируется по уровню: после ограничения числа ячеек границы не должны «съезжать»
    var cxL = (lo[0] + hi[0]) * 0.5, cyL = (lo[1] + hi[1]) * 0.5, czL = (lo[2] + hi[2]) * 0.5;
    this.gridMin = [
      cxL - this.GX * this.h * 0.5,
      cyL - this.GY * this.h * 0.5,
      czL - this.GZ * this.h * 0.5
    ];
    this.gridCells = this.GX * this.GY * this.GZ;
    this._allocGrid();
    if (!keepFluid) this.reset();
  };

  FluidSim.prototype.setCount = function (n) {
    this.count = n;
    this.TH = Math.ceil(n / this.TW);
    this.N = this.TW * this.TH;
    this._alloc();
    this.reset();
  };

  FluidSim.prototype.setLevel = function (level) { this.level = level; };
  FluidSim.prototype.setObjects = function (objects) { this.objects = objects; };

  /* ---------------- границы уровня ---------------- */

  FluidSim.prototype.levelKind = function () {
    var k = this.level.kind;
    return k === 'sphere' ? 1 : (k === 'none' ? 2 : 0);
  };

  FluidSim.prototype.insideContainer = function (x, y, z) {
    var L = this.level;
    if (L.kind === 'sphere') {
      var dx = x - L.center[0], dy = y - L.center[1], dz = z - L.center[2];
      return dx * dx + dy * dy + dz * dz < (L.radius - 0.03) * (L.radius - 0.03);
    }
    var mn = L.min || [-1, -1, -1], mx = L.max || [1, 0.9, 1];
    var s = this.scale || 1;
    return x > mn[0] + 0.03 && x < mx[0] - 0.03 &&
           z > mn[2] + 0.03 && z < mx[2] - 0.03 &&
           y > mn[1] && y < (L.wallTop || mx[1]) + 1.0 * s;
  };

  FluidSim.prototype.outOfBounds = function (x, y, z) {
    var L = this.level;
    if (L.kind === 'sphere') {
      var dx = x - L.center[0], dy = y - L.center[1], dz = z - L.center[2];
      var d = Math.hypot(dx, dy, dz);
      return d > L.radius + 0.35 || y < L.center[1] - L.radius - 0.35;
    }
    if (L.kind === 'none') {
      var lim = L.half * 1.78;
      return y < L.min[1] - 1.0 * (this.scale || 1) ||
             Math.abs(x) > lim || Math.abs(z) > lim;
    }
    var s = this.scale || 1;
    return y < L.min[1] - 0.45 * s || y > (L.wallTop || L.max[1]) + 1.2 * s ||
           Math.abs(x) > L.max[0] + 0.45 * s || Math.abs(z) > L.max[2] + 0.45 * s;
  };

  FluidSim.prototype.blocked = function (x, y, z) {
    var m = 0.05, i, o;
    for (i = 0; i < this.objects.length; i++) {
      o = this.objects[i];
      if (o.kind === 'sphere') {
        var dx = x - o.pos[0], dy = y - o.pos[1], dz = z - o.pos[2];
        if (dx * dx + dy * dy + dz * dz < (o.r + m) * (o.r + m)) return true;
      } else if (o.kind === 'building' || o.kind === 'car') {
        var ca = Math.cos(-(o.rot || 0)), sa = Math.sin(-(o.rot || 0));
        var rx = x - o.pos[0], rz = z - o.pos[2];
        var lx = rx * ca - rz * sa, lz = rx * sa + rz * ca;
        if (Math.abs(lx) < o.size[0] + m && Math.abs(y - o.pos[1]) < o.size[1] + m &&
            Math.abs(lz) < o.size[2] + m) return true;
      }
    }
    return false;
  };

  /* ---------------- сброс ---------------- */

  FluidSim.prototype.reset = function () {
    var gl = this.gl, N = this.N;
    this.posCPU.fill(0);
    this.velCPU.fill(0);
    for (var i = 0; i < N; i++) {
      this.posCPU[i * 4 + 1] = PARK_Y;
      this.typeData[i * 4] = 0;
      this.typeData[i * 4 + 1] = Math.random();
    }
    this.alive.fill(0);
    this.free.length = 0;
    for (var j = N - 1; j >= 0; j--) this.free.push(j);

    gl.bindTexture(gl.TEXTURE_2D, this.pos.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.TW, this.TH, gl.RGBA, gl.FLOAT, this.posCPU);
    gl.bindTexture(gl.TEXTURE_2D, this.vel.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.TW, this.TH, gl.RGBA, gl.FLOAT, this.velCPU);
    gl.bindTexture(gl.TEXTURE_2D, this.typeTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.TW, this.TH, gl.RGBA, gl.FLOAT, this.typeData);
    gl.bindTexture(gl.TEXTURE_2D, null);

    this.time = 0;
    this.killCursor = 0;

    var L = this.level;
    var scl = this.scale || 1;
    var sp = this.spacing[0];
    var cx = 0, cz = 0, botY = -1, lim = 0.94;
    if (L.kind === 'sphere') {
      cx = L.center[0]; cz = L.center[2];
      botY = L.center[1] - L.radius + 0.05 * scl;
      lim = L.radius * 0.62;
    } else {
      cx = (L.min[0] + L.max[0]) / 2;
      cz = (L.min[2] + L.max[2]) / 2;
      botY = L.min[1] + 0.05 * scl;
      lim = (Math.min(L.max[0] - L.min[0], L.max[2] - L.min[2]) / 2 - 0.06) * 0.62;
    }

    var nx = Math.floor((lim * 2) / sp);
    var ny = Math.floor(0.95 * scl / sp);
    var frac = (L.frac === undefined) ? (L.kind === 'sphere' ? 0 : 0.16) : L.frac;
    var want = Math.min(Math.floor(N * frac), nx * ny * nx);
    var placed = 0;
    for (var yy = 0; yy < ny && placed < want; yy++) {
      for (var zz = 0; zz < nx && placed < want; zz++) {
        for (var xx = 0; xx < nx && placed < want; xx++) {
          var px = cx - lim + (xx + 0.5) * sp + (Math.random() - 0.5) * 0.008;
          var py = botY + (yy + 0.5) * sp + (Math.random() - 0.5) * 0.008;
          var pz = cz - lim + (zz + 0.5) * sp + (Math.random() - 0.5) * 0.008;
          if (!this.insideContainer(px, py, pz)) continue;
          if (L.kind === 'sphere') {
            var avail = Math.sqrt(Math.max(0, (L.radius - 0.06) * (L.radius - 0.06) - (py - L.center[1]) * (py - L.center[1])));
            if (Math.hypot(px - cx, pz - cz) > avail) continue;
          }
          if (this.blocked(px, py, pz)) continue;
          var idx = this.free.pop();
          if (idx === undefined) break;
          this.posCPU[idx * 4] = px;
          this.posCPU[idx * 4 + 1] = py;
          this.posCPU[idx * 4 + 2] = pz;
          this.velCPU[idx * 4] = 0;
          this.velCPU[idx * 4 + 1] = 0;
          this.velCPU[idx * 4 + 2] = 0;
          this.typeData[idx * 4] = 0;
          this.alive[idx] = 1;
          this._mark(idx);
          placed++;
        }
      }
    }
    this._flushSpawns();
  };

  /* ---------------- спавн ---------------- */

  function perpBasis(d) {
    var up = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    var ux = up[1] * d[2] - up[2] * d[1];
    var uy = up[2] * d[0] - up[0] * d[2];
    var uz = up[0] * d[1] - up[1] * d[0];
    var l = Math.hypot(ux, uy, uz) || 1;
    ux /= l; uy /= l; uz /= l;
    var vx = d[1] * uz - d[2] * uy;
    var vy = d[2] * ux - d[0] * uz;
    var vz = d[0] * uy - d[1] * ux;
    return [ux, uy, uz, vx, vy, vz];
  }

  FluidSim.prototype._spawnAt = function (i, src) {
    var d = src.dir || [0, -1, 0];
    var dl = Math.hypot(d[0], d[1], d[2]) || 1;
    var dx = d[0] / dl, dy = d[1] / dl, dz = d[2] / dl;
    var b = perpBasis([dx, dy, dz]);

    var r = Math.sqrt(Math.random()) * src.radius;
    var a = Math.random() * Math.PI * 2;
    var ca = Math.cos(a) * r, sa = Math.sin(a) * r;
    var jitter = 0.03;

    this.posCPU[i * 4] = src.pos[0] + b[0] * ca + b[3] * sa;
    this.posCPU[i * 4 + 1] = src.pos[1] + b[1] * ca + b[4] * sa;
    this.posCPU[i * 4 + 2] = src.pos[2] + b[2] * ca + b[5] * sa;

    var sp = src.speed;
    this.velCPU[i * 4] = dx * sp + (Math.random() - 0.5) * jitter;
    this.velCPU[i * 4 + 1] = dy * sp + (Math.random() - 0.5) * jitter;
    this.velCPU[i * 4 + 2] = dz * sp + (Math.random() - 0.5) * jitter;

    this.typeData[i * 4] = src.type;
    this.alive[i] = 1;
  };

  FluidSim.prototype._flushSpawns = function () {
    var gl = this.gl;
    var list = this._spawnList;
    var n = list.length;
    if (n === 0) return;
    var s = this.scratch;
    gl.bindTexture(gl.TEXTURE_2D, this.pos.tex);
    for (var k = 0; k < n; k++) {
      var i = list[k];
      s[0] = this.posCPU[i * 4]; s[1] = this.posCPU[i * 4 + 1];
      s[2] = this.posCPU[i * 4 + 2]; s[3] = 0;
      gl.texSubImage2D(gl.TEXTURE_2D, 0, i % this.TW, (i / this.TW) | 0, 1, 1, gl.RGBA, gl.FLOAT, s);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.vel.tex);
    for (var k2 = 0; k2 < n; k2++) {
      var j = list[k2];
      s[0] = this.velCPU[j * 4]; s[1] = this.velCPU[j * 4 + 1];
      s[2] = this.velCPU[j * 4 + 2]; s[3] = 0;
      gl.texSubImage2D(gl.TEXTURE_2D, 0, j % this.TW, (j / this.TW) | 0, 1, 1, gl.RGBA, gl.FLOAT, s);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.typeTex);
    for (var k3 = 0; k3 < n; k3++) {
      var m = list[k3];
      s[0] = this.typeData[m * 4]; s[1] = this.typeData[m * 4 + 1]; s[2] = 0; s[3] = 0;
      gl.texSubImage2D(gl.TEXTURE_2D, 0, m % this.TW, (m / this.TW) | 0, 1, 1, gl.RGBA, gl.FLOAT, s);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    for (var q = 0; q < n; q++) this._dirtyFlag[list[q]] = 0;
    list.length = 0;
  };

  FluidSim.prototype._mark = function (i) {
    if (this._dirtyFlag[i]) return;
    this._dirtyFlag[i] = 1;
    this._spawnList.push(i);
  };

  FluidSim.prototype.readback = function () {
    var gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pos.fbo);
    gl.readPixels(0, 0, this.TW, this.TH, gl.RGBA, gl.FLOAT, this.posCPU);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.vel.fbo);
    gl.readPixels(0, 0, this.TW, this.TH, gl.RGBA, gl.FLOAT, this.velCPU);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  FluidSim.prototype._kill = function (i) {
    this.alive[i] = 0;
    this.posCPU[i * 4] = 0;
    this.posCPU[i * 4 + 1] = PARK_Y;
    this.posCPU[i * 4 + 2] = 0;
    this.velCPU[i * 4] = this.velCPU[i * 4 + 1] = this.velCPU[i * 4 + 2] = 0;
    this.free.push(i);
    this._mark(i);
  };

  FluidSim.prototype.killOutOfBounds = function () {
    var p = this.posCPU;
    for (var i = 0; i < this.N; i++) {
      if (!this.alive[i]) continue;
      if (this.outOfBounds(p[i * 4], p[i * 4 + 1], p[i * 4 + 2])) this._kill(i);
    }
  };

  FluidSim.prototype._reclaim = function (need) {
    var p = this.posCPU, guard = 0, killed = 0;
    var maxGuard = this.N * 2;
    var floorY = this.level.kind === 'sphere'
      ? this.level.center[1] - this.level.radius * 0.55
      : -0.45;
    while (this.free.length < need && guard < maxGuard) {
      var i = this.killCursor;
      this.killCursor = (this.killCursor + 1) % this.N;
      guard++;
      if (!this.alive[i]) continue;
      if (p[i * 4 + 1] < floorY) { this._kill(i); killed++; }
    }
    return killed;
  };

  FluidSim.prototype.emit = function (dt) {
    var total = 0, i, src, wants = [];
    for (i = 0; i < this.sources.length; i++) {
      src = this.sources[i];
      if (!src.enabled) { src.acc = 0; wants.push(0); continue; }
      src.acc += src.rate * dt;
      var n = Math.floor(src.acc);
      src.acc -= n;
      if (n > 60) n = 60;
      wants.push(n);
      total += n;
    }
    if (total > this.free.length) this._reclaim(total);

    for (i = 0; i < this.sources.length; i++) {
      src = this.sources[i];
      for (var k = 0; k < wants[i]; k++) {
        if (this.free.length === 0) break;
        var idx = this.free.pop();
        this._spawnAt(idx, src);
        this._mark(idx);
      }
    }
    this._flushSpawns();
  };

  /* Сетка соседей следует за облаком жидкости: клетка не мельче h, но и не
     раздувается на всю арену — иначе перебор соседей становится квадратичным. */
  FluidSim.prototype.refitGrid = function () {
    var p = this.posCPU, n = this.N;
    var mnx = 1e9, mny = 1e9, mnz = 1e9, mxx = -1e9, mxy = -1e9, mxz = -1e9, cnt = 0;
    for (var i = 0; i < n; i++) {
      if (!this.alive[i]) continue;
      var y = p[i * 4 + 1];
      if (y < -500) continue;
      var x = p[i * 4], z = p[i * 4 + 2];
      if (x < mnx) mnx = x; if (x > mxx) mxx = x;
      if (y < mny) mny = y; if (y > mxy) mxy = y;
      if (z < mnz) mnz = z; if (z > mxz) mxz = z;
      cnt++;
    }
    if (cnt < 8) return;

    var h = this.h, pad = 3 * h;
    var ex = Math.max(mxx - mnx + 2 * pad, 10 * h);
    var ey = Math.max(mxy - mny + 2 * pad, 8 * h);
    var ez = Math.max(mxz - mnz + 2 * pad, 10 * h);
    var cs = Math.max(h, ex / this.GMAX, ey / 32, ez / this.GMAX);

    var inside = this.gridMin &&
      mnx > this.gridMin[0] && mxx < this.gridMin[0] + this.GX * this.cellSize &&
      mnz > this.gridMin[2] && mxz < this.gridMin[2] + this.GZ * this.cellSize;
    var need = !inside || cs > this.cellSize * 1.30 || cs < this.cellSize * 0.58;
    if (!need) return;

    this.cellSize = cs;
    this.GX = Math.min(this.GMAX, Math.max(8, Math.ceil(ex / cs)));
    this.GY = Math.min(32, Math.max(6, Math.ceil(ey / cs)));
    this.GZ = Math.min(this.GMAX, Math.max(8, Math.ceil(ez / cs)));
    var cx = (mnx + mxx) * 0.5, cy = (mny + mxy) * 0.5, cz = (mnz + mxz) * 0.5;
    this.gridMin = [
      cx - this.GX * cs * 0.5,
      cy - this.GY * cs * 0.5,
      cz - this.GZ * cs * 0.5
    ];
    this.gridCells = this.GX * this.GY * this.GZ;
    this._allocGrid();
  };

  FluidSim.prototype.buildGrid = function () {
    var N = this.N, GX = this.GX, GY = this.GY, GZ = this.GZ;
    var gmin = this.gridMin, cs = this.cellSize;
    var pos = this.posCPU, vel = this.velCPU, dt = this.lastDt;
    var counts = this.cellCounts, cellOf = this.cellOf;
    counts.fill(0);

    var total = this.gridCells;
    for (var i = 0; i < N; i++) {
      if (!this.alive[i] || pos[i * 4 + 1] < -500) { cellOf[i] = -1; continue; }
      var x = pos[i * 4] + vel[i * 4] * dt;
      var y = pos[i * 4 + 1] + vel[i * 4 + 1] * dt;
      var z = pos[i * 4 + 2] + vel[i * 4 + 2] * dt;
      var ix = Math.floor((x - gmin[0]) / cs);
      var iy = Math.floor((y - gmin[1]) / cs);
      var iz = Math.floor((z - gmin[2]) / cs);
      if (ix < 0) ix = 0; else if (ix >= GX) ix = GX - 1;
      if (iy < 0) iy = 0; else if (iy >= GY) iy = GY - 1;
      if (iz < 0) iz = 0; else if (iz >= GZ) iz = GZ - 1;
      var c = ix + iy * GX + iz * GX * GY;
      cellOf[i] = c;
      counts[c]++;
    }

    var start = this.cellStart, acc = 0;
    for (var c2 = 0; c2 < total; c2++) { start[c2] = acc; acc += counts[c2]; }

    var cursor = this.cursor;
    cursor.set(start);
    var gi = this.gridIdx;
    for (var j = 0; j < N; j++) {
      var cc = cellOf[j];
      if (cc < 0) continue;
      gi[cursor[cc]++] = j;
    }

    var up = this.gridUpload;
    for (var k = 0; k < total; k++) {
      up[k * 2] = start[k];
      up[k * 2 + 1] = counts[k];
    }
  };

  FluidSim.prototype.uploadGrid = function () {
    var gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.gridTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.GX, this.GY * this.GZ, gl.RG, gl.FLOAT, this.gridUpload);
    gl.bindTexture(gl.TEXTURE_2D, this.gridIdxTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.TW, this.TH, gl.RED, gl.FLOAT, this.gridIdx);
    gl.bindTexture(gl.TEXTURE_2D, null);
  };

  FluidSim.prototype._gridUniforms = function (gl, p) {
    GL.u3fv(gl, p, 'uGridMin', this.gridMin);
    GL.u3f(gl, p, 'uGridDim', this.GX, this.GY, this.GZ);
    GL.u1f(gl, p, 'uCellSize', this.cellSize);
    GL.u1i(gl, p, 'uGX', this.GX);
    GL.u1i(gl, p, 'uGY', this.GY);
    GL.u1i(gl, p, 'uGZ', this.GZ);
    GL.u1i(gl, p, 'uTW', this.TW);
    GL.u2f(gl, p, 'uTexSize', this.TW, this.TH);
  };

  FluidSim.prototype._packScene = function () {
    var objs = this.objects;
    // для огромных уровней в uniform-массивы попадают ближайшие к центру объекты
    if (objs.length > 44) {
      var cx0 = 0, cz0 = 0;
      objs = objs.slice().sort(function (a, b) {
        var da = Math.hypot(a.pos[0] - cx0, a.pos[2] - cz0);
        var db = Math.hypot(b.pos[0] - cx0, b.pos[2] - cz0);
        return da - db;
      });
    }
    var S = this.uSph, B = this.uBox, BH = this.uBoxHalf;
    var F = this.uField, FP = this.uFieldP, FD = this.uFieldDir;
    var PA = this.uPortalA, PB = this.uPortalB, PAn = this.uPortalAn, PBn = this.uPortalBn;
    var ns = 0, nb = 0, nf = 0, np = 0;
    var byId = {};

    for (var i = 0; i < objs.length; i++) {
      var o = objs[i];
      if (o.kind === 'sphere' || o.kind === 'snowman' || o.kind === 'mound') {
        if (ns < 16) {
          S[ns * 4] = o.pos[0]; S[ns * 4 + 1] = o.pos[1]; S[ns * 4 + 2] = o.pos[2]; S[ns * 4 + 3] = o.r;
          ns++;
        }
      } else if (o.kind === 'building' || o.kind === 'car' ||
                 o.kind === 'tree' || o.kind === 'house') {
        if (nb < 48) {
          B[nb * 4] = o.pos[0]; B[nb * 4 + 1] = o.pos[1]; B[nb * 4 + 2] = o.pos[2]; B[nb * 4 + 3] = o.rot || 0;
          BH[nb * 3] = o.size[0]; BH[nb * 3 + 1] = o.size[1]; BH[nb * 3 + 2] = o.size[2];
          nb++;
        }
      } else if (o.kind === 'field') {
        if (nf < 8) {
          F[nf * 4] = o.pos[0]; F[nf * 4 + 1] = o.pos[1]; F[nf * 4 + 2] = o.pos[2]; F[nf * 4 + 3] = o.radius;
          var mi = o.mode === 'attract' ? 1 : (o.mode === 'accelerate' ? 2 : (o.mode === 'drag' ? 3 : 0));
          FP[nf * 4] = o.strength; FP[nf * 4 + 1] = mi;
          FD[nf * 4] = o.dir[0]; FD[nf * 4 + 1] = o.dir[1]; FD[nf * 4 + 2] = o.dir[2];
          nf++;
        }
      } else if (o.kind === 'portal') {
        byId[o.id] = o;
      }
    }

    for (var k = 0; k < objs.length; k++) {
      var a = objs[k];
      if (a.kind !== 'portal' || np >= 4) continue;
      if (!a.link || String(a.id) > String(a.link)) continue;
      var b = byId[a.link];
      if (!b) continue;
      PA[np * 4] = a.pos[0]; PA[np * 4 + 1] = a.pos[1]; PA[np * 4 + 2] = a.pos[2]; PA[np * 4 + 3] = a.r;
      PB[np * 4] = b.pos[0]; PB[np * 4 + 1] = b.pos[1]; PB[np * 4 + 2] = b.pos[2]; PB[np * 4 + 3] = b.r;
      PAn[np * 4] = a.normal[0]; PAn[np * 4 + 1] = a.normal[1]; PAn[np * 4 + 2] = a.normal[2];
      PBn[np * 4] = b.normal[0]; PBn[np * 4 + 1] = b.normal[1]; PBn[np * 4 + 2] = b.normal[2];
      np++;
    }

    this.counts.sph = ns;
    this.counts.box = nb;
    this.counts.field = nf;
    this.counts.portal = np;
  };

  FluidSim.prototype._collisionUniforms = function (gl, p) {
    var L = this.level;
    GL.u1i(gl, p, 'uLevelKind', this.levelKind());
    var mn = L.min || [-1, -1, -1];
    var mx = L.max || [1, 0.9, 1];
    GL.u3f(gl, p, 'uBoxMin', mn[0], mn[1], mn[2]);
    GL.u3f(gl, p, 'uBoxMax', mx[0], mx[1], mx[2]);
    GL.u1f(gl, p, 'uWallTop', L.wallTop === undefined ? 0.9 : L.wallTop);
    var c = L.center || [0, 0, 0];
    GL.u3f(gl, p, 'uSphereC', c[0], c[1], c[2]);
    GL.u1f(gl, p, 'uSphereR', L.radius === undefined ? 1.16 : L.radius);
    GL.u1f(gl, p, 'uPRadius', this.pRadius);

    var cone = L.cone;
    if (cone && !L.terrain) {
      GL.u1f(gl, p, 'uConeOn', 1);
      GL.u3f(gl, p, 'uConeC', 0, L.floorY, 0);
      GL.u1f(gl, p, 'uConeR0', cone.r0);
      GL.u1f(gl, p, 'uConeR1', cone.r1);
      GL.u1f(gl, p, 'uConeH', cone.h);
    } else {
      GL.u1f(gl, p, 'uConeOn', 0);
    }

    // рельеф острова: карта высот
    if (L.terrain) {
      if (!this.terrainTex || this.terrainN !== L.terrain.n) {
        if (this.terrainTex) gl.deleteTexture(this.terrainTex);
        this.terrainTex = GL.texture(gl, L.terrain.n, L.terrain.n, gl.R32F, gl.RED, gl.FLOAT, L.terrain.h, gl.NEAREST);
        this.terrainN = L.terrain.n;
      }
      GL.bindTex(gl, p, 'uTerrainTex', this.terrainTex, 7);
      GL.u1i(gl, p, 'uTerrainOn', 1);
      GL.u2f(gl, p, 'uTerrainMin', -L.half, -L.half);
      GL.u1f(gl, p, 'uTerrainSize', 2 * L.half);
      GL.u1f(gl, p, 'uTerrainN', L.terrain.n);
      GL.u1f(gl, p, 'uTerrainFloorY', L.floorY);
    } else {
      GL.u1i(gl, p, 'uTerrainOn', 0);
    }

    // город: сетка кварталов текстурой (n x n, RGBA32F)
    if (L.city && L.tiles) {
      if (!this.cityTex || this.cityN !== L.cityN) {
        if (this.cityTex) gl.deleteTexture(this.cityTex);
        this.cityTex = GL.texture(gl, L.cityN, L.cityN, gl.RGBA32F, gl.RGBA, gl.FLOAT, L.tiles, gl.NEAREST);
        this.cityN = L.cityN;
      }
      GL.bindTex(gl, p, 'uCityTex', this.cityTex, 6);
      GL.u1i(gl, p, 'uCityOn', 1);
      GL.u3f(gl, p, 'uCityOrigin', L.min[0], 0, L.min[2]);
      GL.u1f(gl, p, 'uCityCell', L.cell);
      GL.u1f(gl, p, 'uCityN', L.cityN);
      GL.u1f(gl, p, 'uCityFloorY', L.floorY);
    } else {
      GL.u1i(gl, p, 'uCityOn', 0);
    }

    GL.u4fv(gl, p, 'uSph', this.uSph);
    GL.u1i(gl, p, 'uSphCount', this.counts.sph);
    GL.u4fv(gl, p, 'uObsBox', this.uBox);
    GL.u3fv(gl, p, 'uObsBoxHalf', this.uBoxHalf);
    GL.u1i(gl, p, 'uObsBoxCount', this.counts.box);
  };

  FluidSim.prototype._fieldUniforms = function (gl, p) {
    GL.u4fv(gl, p, 'uField', this.uField);
    GL.u4fv(gl, p, 'uFieldP', this.uFieldP);
    GL.u4fv(gl, p, 'uFieldDir', this.uFieldDir);
    GL.u1i(gl, p, 'uFieldCount', this.counts.field);
    GL.u4fv(gl, p, 'uPortalA', this.uPortalA);
    GL.u4fv(gl, p, 'uPortalB', this.uPortalB);
    GL.u4fv(gl, p, 'uPortalAn', this.uPortalAn);
    GL.u4fv(gl, p, 'uPortalBn', this.uPortalBn);
    GL.u1i(gl, p, 'uPortalCount', this.counts.portal);
  };

  FluidSim.prototype._draw = function (fbo, prog) {
    var gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, this.TW, this.TH);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(prog.program);
    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  FluidSim.prototype.simulate = function (dt) {
    var gl = this.gl;
    var p, i;

    this._packScene();

    p = this.prog.predict;
    gl.useProgram(p.program);
    GL.bindTex(gl, p, 'uPos', this.pos.tex, 0);
    GL.bindTex(gl, p, 'uVel', this.vel.tex, 1);
    GL.bindTex(gl, p, 'uType', this.typeTex, 2);
    GL.u2f(gl, p, 'uTexSize', this.TW, this.TH);
    GL.u1f(gl, p, 'uDt', dt);
    GL.u1f(gl, p, 'uMaxSpeed', this.maxSpeed);
    GL.u3f(gl, p, 'uGravity', 0, this.gravity, 0);
    GL.u1fv(gl, p, 'uBuoy', this.buoy);
    GL.u1fv(gl, p, 'uGravScale', this.gravScale);
    GL.u1fv(gl, p, 'uDragK', this.drag);
    GL.u1fv(gl, p, 'uIsFluid', this.isFluid);
    GL.u1f(gl, p, 'uTime', this.time);
    GL.u4f(gl, p, 'uMouse', this.mouse.pos[0], this.mouse.pos[1], this.mouse.pos[2], this.mouse.radius);
    GL.u3fv(gl, p, 'uMouseForce', this.mouse.force);
    GL.u1f(gl, p, 'uVortex', this.vortex || 0);
    this._fieldUniforms(gl, p);
    this._draw(this.predA.fbo, p);

    var predSrc = this.predA, predDst = this.predB;

    for (i = 0; i < this.iterations; i++) {
      p = this.prog.density;
      gl.useProgram(p.program);
      GL.bindTex(gl, p, 'uPred', predSrc.tex, 0);
      GL.bindTex(gl, p, 'uType', this.typeTex, 1);
      GL.bindTex(gl, p, 'uGridStart', this.gridTex, 2);
      GL.bindTex(gl, p, 'uGridIdx', this.gridIdxTex, 3);
      this._gridUniforms(gl, p);
      GL.u1f(gl, p, 'uH', this.h);
      GL.u1f(gl, p, 'uH2', this.h * this.h);
      GL.u1f(gl, p, 'uPoly6', this.kPoly6);
      GL.u1f(gl, p, 'uSpikyK', this.kSpiky);
      GL.u1fv(gl, p, 'uSpacing', this.spacing);
      GL.u1fv(gl, p, 'uIsFluid', this.isFluid);
      GL.u1f(gl, p, 'uEps', this.eps);
      GL.u1f(gl, p, 'uCMin', this.cMin);
      GL.u1f(gl, p, 'uLamMax', this.lamMax);
      this._draw(this.lam.fbo, p);

      p = this.prog.delta;
      gl.useProgram(p.program);
      GL.bindTex(gl, p, 'uPred', predSrc.tex, 0);
      GL.bindTex(gl, p, 'uLambda', this.lam.tex, 1);
      GL.bindTex(gl, p, 'uType', this.typeTex, 2);
      GL.bindTex(gl, p, 'uGridStart', this.gridTex, 3);
      GL.bindTex(gl, p, 'uGridIdx', this.gridIdxTex, 4);
      this._gridUniforms(gl, p);
      this._collisionUniforms(gl, p);
      GL.u1f(gl, p, 'uH', this.h);
      GL.u1f(gl, p, 'uH2', this.h * this.h);
      GL.u1f(gl, p, 'uPoly6', this.kPoly6);
      GL.u1f(gl, p, 'uSpikyK', this.kSpiky);
      GL.u1fv(gl, p, 'uSpacing', this.spacing);
      GL.u1fv(gl, p, 'uIsFluid', this.isFluid);
      GL.u1f(gl, p, 'uSCorrK', this.sCorrK);
      GL.u1f(gl, p, 'uMaxDp', this.h * 0.25);
      this._draw(predDst.fbo, p);

      var tmp = predSrc; predSrc = predDst; predDst = tmp;
    }

    p = this.prog.velocity;
    gl.useProgram(p.program);
    GL.bindTex(gl, p, 'uPos', this.pos.tex, 0);
    GL.bindTex(gl, p, 'uPred', predSrc.tex, 1);
    GL.bindTex(gl, p, 'uType', this.typeTex, 2);
    GL.bindTex(gl, p, 'uGridStart', this.gridTex, 3);
    GL.bindTex(gl, p, 'uGridIdx', this.gridIdxTex, 4);
    this._gridUniforms(gl, p);
    this._collisionUniforms(gl, p);
    GL.u1f(gl, p, 'uH', this.h);
    GL.u1f(gl, p, 'uH2', this.h * this.h);
    GL.u1f(gl, p, 'uPoly6', this.kPoly6);
    GL.u1f(gl, p, 'uSpikyK', this.kSpiky);
    GL.u1fv(gl, p, 'uSpacing', this.spacing);
    GL.u1fv(gl, p, 'uIsFluid', this.isFluid);
    GL.u1fv(gl, p, 'uDragK', this.drag);
    GL.u1f(gl, p, 'uDt', dt);
    GL.u1fv(gl, p, 'uVisc', this.visc);
    GL.u1f(gl, p, 'uViscScale', this.viscScale === undefined ? 1.0 : this.viscScale);
    GL.u1f(gl, p, 'uMaxSpeed', this.maxSpeed);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.mrt);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.posB.tex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.velB.tex, 0);

    this._draw(this.mrt, p);

    var t = this.pos; this.pos = this.posB; this.posB = t;
    t = this.vel; this.vel = this.velB; this.velB = t;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
  };

  FluidSim.prototype.step = function (dt) {
    this.readback();
    this.killOutOfBounds();
    this.emit(dt);
    this.refitGrid();
    this.buildGrid();
    this.uploadGrid();
    this.simulate(dt);
    this.lastDt = dt;
    this.time += dt;
  };

  FluidSim.prototype.prewarm = function (steps) {
    for (var i = 0; i < steps; i++) this.step(1 / 60);
  };

  FS.FluidSim = FluidSim;
})();
