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

    this.h = opts.h || 0.11;
    this.cellSize = this.h;
    this.gridMin = [-1.5, -1.5, -1.5];
    var gn = Math.ceil(3.0 / this.h);
    this.GX = gn; this.GY = gn; this.GZ = gn;
    this.gridCells = this.GX * this.GY * this.GZ;

    this.boxMin = [-1.0, -1.0, -1.0];
    this.boxMax = [1.0, 0.9, 1.0];
    this.wallTop = 0.9;
    this.pRadius = 0.027;

    this.spacing = [0.055, 0.063, 0.051, 0.058];
    this.buoy = [0.0, 1.6, -2.2, 0.0];
    this.radiusRender = 0.079;

    this.gravity = -9.81;
    this.maxSpeed = 6.0;
    this.iterations = 2;
    this.visc = [0.10, 0.30, 0.55, 0.85];
    this.sCorrK = 0.0004;
    this.eps = 1e-5;
    this.cMin = -0.08;
    this.lamMax = 0.002;

    this.obstacles = { sph: [], box: [] };

    this.sources = [
      { pos: [-0.55, 1.20, 0.10], dir: [0, -1, 0], radius: 0.175, speed: 2.1, type: 0, rate: 620, enabled: true, acc: 0 },
      { pos: [0.58, 1.32, -0.15], dir: [0, -1, 0], radius: 0.155, speed: 2.3, type: 1, rate: 470, enabled: true, acc: 0 },
      { pos: [0.02, 1.58, 0.55], dir: [0, -1, 0], radius: 0.145, speed: 1.9, type: 3, rate: 380, enabled: true, acc: 0 }
    ];

    this.mouse = { pos: [0, 0, 0], force: [0, 0, 0], radius: 0 };
    this.lastDt = 1 / 60;
    this.time = 0;
    this._spawnList = [];

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

    // MRT для пасса скорости
    this.mrt = GL.fbo(gl, [this.posB.tex, this.velB.tex], null);

    // статическая текстура типа: x = тип, y = seed
    this.typeData = new Float32Array(N * 4);
    this.typeTex = GL.texture(gl, this.TW, this.TH, gl.RGBA32F, gl.RGBA, gl.FLOAT, this.typeData, gl.NEAREST);

    // сетка
    this.gridTex = GL.texture(gl, this.GX, this.GY * this.GZ, gl.RG32F, gl.RG, gl.FLOAT, null, gl.NEAREST);
    this.gridUpload = new Float32Array(this.gridCells * 2);
    this.cellCounts = new Int32Array(this.gridCells);
    this.cellStart = new Int32Array(this.gridCells);
    this.cursor = new Int32Array(this.gridCells);
    this.cellOf = new Int32Array(N);
    this.gridIdx = new Float32Array(N);
    this.gridIdxTex = GL.texture(gl, this.TW, this.TH, gl.R32F, gl.RED, gl.FLOAT, null, gl.NEAREST);

    // CPU-копии
    this.posCPU = new Float32Array(N * 4);
    this.velCPU = new Float32Array(N * 4);
    this.alive = new Uint8Array(N);
    this.free = [];
    for (var i = N - 1; i >= 0; i--) this.free.push(i);

    this.scratch = new Float32Array(4);
    this._dirtyFlag = new Uint8Array(N);
    this._spawnList = [];

    // программы
    this.prog = {
      predict: GL.program(gl, FS.SH.fullscreenVS, FS.SH.predictFS, 'predict'),
      density: GL.program(gl, FS.SH.fullscreenVS, FS.SH.densityFS, 'density'),
      delta: GL.program(gl, FS.SH.fullscreenVS, FS.SH.deltaFS, 'delta'),
      velocity: GL.program(gl, FS.SH.fullscreenVS, FS.SH.velocityFS, 'velocity')
    };

    this.quadVAO = GL.fullscreenVAO(gl);

    // константы ядра
    var h = this.h;
    var PI = Math.PI;
    this.kPoly6 = 315 / (64 * PI * Math.pow(h, 9));
    this.kSpiky = 45 / (PI * Math.pow(h, 6));
  };

  FluidSim.prototype.setCount = function (n) {
    // полная переаллокация — вызывается из UI
    var gl = this.gl;
    this.count = n;
    this.TH = Math.ceil(n / this.TW);
    this.N = this.TW * this.TH;
    this._alloc();
    this.reset();
  };

  FluidSim.prototype.blocked = function (x, y, z) {
    var m = 0.05;
    var i, o;
    for (i = 0; i < this.obstacles.sph.length; i++) {
      o = this.obstacles.sph[i];
      var dx = x - o.c[0], dy = y - o.c[1], dz = z - o.c[2];
      if (dx * dx + dy * dy + dz * dz < (o.r + m) * (o.r + m)) return true;
    }
    for (i = 0; i < this.obstacles.box.length; i++) {
      o = this.obstacles.box[i];
      if (Math.abs(x - o.c[0]) < o.h[0] + m && Math.abs(y - o.c[1]) < o.h[1] + m &&
          Math.abs(z - o.c[2]) < o.h[2] + m) return true;
    }
    return false;
  };

  FluidSim.prototype.reset = function () {
    var gl = this.gl, N = this.N;
    this.posCPU.fill(0);
    this.velCPU.fill(0);
    for (var i = 0; i < N; i++) {
      this.posCPU[i * 4] = 0;
      this.posCPU[i * 4 + 1] = PARK_Y;
      this.posCPU[i * 4 + 2] = 0;
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

    // начальная лужа: решётка в нижней части резервуара
    var sp = this.spacing[0];
    var y0 = this.boxMin[1] + 0.05;
    var lim = 0.94;
    var nx = Math.floor((lim * 2) / sp);
    var ny = Math.floor(0.34 / sp);
    var want = Math.min(Math.floor(N * 0.42), nx * ny * nx);
    var placed = 0;
    for (var yy = 0; yy < ny && placed < want; yy++) {
      for (var zz = 0; zz < nx && placed < want; zz++) {
        for (var xx = 0; xx < nx && placed < want; xx++) {
          var jx = (Math.random() - 0.5) * 0.008;
          var jy = (Math.random() - 0.5) * 0.008;
          var jz = (Math.random() - 0.5) * 0.008;
          var px = -lim + (xx + 0.5) * sp + jx;
          var py = y0 + (yy + 0.5) * sp + jy;
          var pz = -lim + (zz + 0.5) * sp + jz;
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

  FluidSim.prototype._spawnAt = function (i, src, yOverride) {
    var r = Math.sqrt(Math.random()) * src.radius;
    var a = Math.random() * Math.PI * 2;
    var jitter = 0.02;
    this.posCPU[i * 4] = src.pos[0] + Math.cos(a) * r;
    this.posCPU[i * 4 + 1] = (yOverride !== undefined) ? yOverride : src.pos[1] + (Math.random() - 0.5) * 0.05;
    this.posCPU[i * 4 + 2] = src.pos[2] + Math.sin(a) * r;

    this.velCPU[i * 4] = (Math.random() - 0.5) * jitter;
    this.velCPU[i * 4 + 1] = -src.speed + (Math.random() - 0.5) * jitter;
    this.velCPU[i * 4 + 2] = (Math.random() - 0.5) * jitter;

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
    this._mark(i);   // нужно отправить новую позицию на GPU
  };

  FluidSim.prototype.killOutOfBounds = function () {
    var p = this.posCPU;
    for (var i = 0; i < this.N; i++) {
      if (!this.alive[i]) continue;
      var y = p[i * 4 + 1], x = p[i * 4], z = p[i * 4 + 2];
      if (y < -1.45 || y > 3.0 || Math.abs(x) > 1.45 || Math.abs(z) > 1.45) this._kill(i);
    }
  };

  // забираем частицы из глубины лужи, чтобы обеспечить непрерывный поток
  FluidSim.prototype._reclaim = function (need) {
    var p = this.posCPU, guard = 0, killed = 0;
    var maxGuard = this.N * 2;
    while (this.free.length < need && guard < maxGuard) {
      var i = this.killCursor;
      this.killCursor = (this.killCursor + 1) % this.N;
      guard++;
      if (!this.alive[i]) continue;
      if (p[i * 4 + 1] < -0.45) { this._kill(i); killed++; }
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

  FluidSim.prototype._collisionUniforms = function (gl, p) {
    GL.u3fv(gl, p, 'uBoxMin', this.boxMin);
    GL.u3fv(gl, p, 'uBoxMax', this.boxMax);
    GL.u1f(gl, p, 'uWallTop', this.wallTop);
    GL.u1f(gl, p, 'uPRadius', this.pRadius);

    var sph = new Float32Array(32);
    var ns = Math.min(this.obstacles.sph.length, 8);
    for (var i = 0; i < ns; i++) {
      var o = this.obstacles.sph[i];
      sph[i * 4] = o.c[0]; sph[i * 4 + 1] = o.c[1]; sph[i * 4 + 2] = o.c[2]; sph[i * 4 + 3] = o.r;
    }
    GL.u4fv(gl, p, 'uSph', sph);
    GL.u1i(gl, p, 'uSphCount', ns);

    var bx = new Float32Array(16);
    var bh = new Float32Array(12);
    var nb = Math.min(this.obstacles.box.length, 4);
    for (var j = 0; j < nb; j++) {
      var b = this.obstacles.box[j];
      bx[j * 4] = b.c[0]; bx[j * 4 + 1] = b.c[1]; bx[j * 4 + 2] = b.c[2]; bx[j * 4 + 3] = 0;
      bh[j * 3] = b.h[0]; bh[j * 3 + 1] = b.h[1]; bh[j * 3 + 2] = b.h[2];
    }
    GL.u4fv(gl, p, 'uObsBox', bx);
    GL.u3fv(gl, p, 'uObsBoxHalf', bh);
    GL.u1i(gl, p, 'uObsBoxCount', nb);
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

    // --- предсказание ---
    p = this.prog.predict;
    gl.useProgram(p.program);
    GL.bindTex(gl, p, 'uPos', this.pos.tex, 0);
    GL.bindTex(gl, p, 'uVel', this.vel.tex, 1);
    GL.bindTex(gl, p, 'uType', this.typeTex, 2);
    GL.u2f(gl, p, 'uTexSize', this.TW, this.TH);
    GL.u1f(gl, p, 'uDt', dt);
    GL.u1f(gl, p, 'uMaxSpeed', this.maxSpeed);
    GL.u3f(gl, p, 'uGravity', 0, this.gravity, 0);
    GL.u4fv(gl, p, 'uBuoy', this.buoy);
    GL.u4f(gl, p, 'uMouse', this.mouse.pos[0], this.mouse.pos[1], this.mouse.pos[2], this.mouse.radius);
    GL.u3fv(gl, p, 'uMouseForce', this.mouse.force);
    GL.u1f(gl, p, 'uVortex', this.vortex || 0);
    this._draw(this.predA.fbo, p);

    var predSrc = this.predA, predDst = this.predB;

    // --- итерации решателя ---
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
      GL.u4fv(gl, p, 'uSpacing', this.spacing);
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
      GL.u4fv(gl, p, 'uSpacing', this.spacing);
      GL.u1f(gl, p, 'uSCorrK', this.sCorrK);
      GL.u1f(gl, p, 'uMaxDp', this.h * 0.25);
      this._draw(predDst.fbo, p);

      var tmp = predSrc; predSrc = predDst; predDst = tmp;
    }

    // --- скорость + финальная позиция (MRT) ---
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
    GL.u4fv(gl, p, 'uSpacing', this.spacing);
    GL.u1f(gl, p, 'uDt', dt);

    // вязкость и т.п.
    GL.u4fv(gl, p, 'uVisc', this.visc);
    GL.u1f(gl, p, 'uViscScale', this.viscScale === undefined ? 1.0 : this.viscScale);
    GL.u1f(gl, p, 'uMaxSpeed', this.maxSpeed);

    // ВАЖНО: после свапа текстур перепривязываем MRT-аттачменты
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
