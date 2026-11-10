/* FluidLab 3D — рендер сцены и экранно-пространственной жидкости */
(function () {
  'use strict';
  var FS = window.FS;
  var GL = FS.GL;
  var M = FS.mat4;

  FS.TYPE_COLORS = [
    [0.16, 0.50, 0.88],
    [0.66, 0.42, 0.10],
    [1.00, 0.34, 0.05],
    [0.22, 0.88, 0.40],
    [0.94, 0.96, 1.00],
    [0.55, 0.55, 0.62],
    [0.80, 0.30, 0.90],
    [0.40, 0.85, 0.75]
  ];

  var SKY_ORDER = ['grid', 'night', 'sunset', 'day', 'nebula', 'studio', 'xmas'];

  function Renderer(gl, canvas) {
    this.gl = gl;
    this.canvas = canvas;
    this.W = 1; this.H = 1;
    var l = [0.45, 0.82, 0.36];
    var ll = Math.hypot(l[0], l[1], l[2]);
    this.lightDir = [l[0] / ll, l[1] / ll, l[2] / ll];

    this.thickScale = 1.0;
    this.refract = 0.022;
    this.absorb = 0.80;
    this.opacity = 0.55;
    this.time = 0;

    this.progs = {
      scene: GL.program(gl, FS.SH.sceneVS, FS.SH.sceneFS, 'scene'),
      sky: GL.program(gl, FS.SH.skyVS, FS.SH.skyFS, 'sky'),
      floor: GL.program(gl, FS.SH.sceneVS, FS.SH.floorFS, 'floor'),
      line: GL.program(gl, FS.SH.lineVS, FS.SH.lineFS, 'line'),
      pointsDepth: GL.program(gl, FS.SH.pointsVS, FS.SH.pointsDepthFS, 'pointsDepth'),
      pointsThick: GL.program(gl, FS.SH.pointsVS, FS.SH.pointsThickFS, 'pointsThick'),
      particles: GL.program(gl, FS.SH.pointsVS, FS.SH.particleFS, 'particles'),
      blur: GL.program(gl, FS.SH.fullscreenVS, FS.SH.blurFS, 'blur'),
      blur4: GL.program(gl, FS.SH.fullscreenVS, FS.SH.blur4FS, 'blur4'),
      fluid: GL.program(gl, FS.SH.fullscreenVS, FS.SH.fluidFS, 'fluid'),
      glass: GL.program(gl, FS.SH.sceneVS, FS.SH.glassFS, 'glass'),
      field: GL.program(gl, FS.SH.sceneVS, FS.SH.fieldFS, 'field'),
      portal: GL.program(gl, FS.SH.sceneVS, FS.SH.portalFS, 'portal'),
      bld: GL.program(gl, FS.SH.bldVS, FS.SH.bldFS, 'bld'),
      terrain: GL.program(gl, FS.SH.terrainVS, FS.SH.terrainFS, 'terrain'),
      clear: GL.program(gl, FS.SH.fullscreenVS, FS.SH.clearFS, 'clear')
    };

    this.quadVAO = GL.fullscreenVAO(gl);
    this.pointsVAO = GL.emptyVAO(gl);
    this._buildGeometry();
    this._initTargets(1, 1);
  }

  /* ---------- геометрия ---------- */

  function meshData(pos, nor, col, idx) {
    var n = pos.length / 3;
    var inter = new Float32Array(n * 9);
    for (var i = 0; i < n; i++) {
      inter[i * 9] = pos[i * 3];
      inter[i * 9 + 1] = pos[i * 3 + 1];
      inter[i * 9 + 2] = pos[i * 3 + 2];
      inter[i * 9 + 3] = nor[i * 3];
      inter[i * 9 + 4] = nor[i * 3 + 1];
      inter[i * 9 + 5] = nor[i * 3 + 2];
      inter[i * 9 + 6] = col ? col[i * 3] : 1;
      inter[i * 9 + 7] = col ? col[i * 3 + 1] : 1;
      inter[i * 9 + 8] = col ? col[i * 3 + 2] : 1;
    }
    return { inter: inter, indices: idx || null };
  }

  function pushBox(pos, nor, col, idx, cx, cy, cz, hx, hy, hz, c) {
    var faces = [
      [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      [[-1, 0, 0], [0, 1, 0], [0, 0, -1]],
      [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
      [[0, -1, 0], [0, 0, -1], [1, 0, 0]],
      [[0, 0, 1], [0, 1, 0], [-1, 0, 0]],
      [[0, 0, -1], [0, 1, 0], [1, 0, 0]]
    ];
    faces.forEach(function (f) {
      var n = f[0], t = f[1], b = f[2];
      var base = pos.length / 3;
      var corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      corners.forEach(function (cc) {
        pos.push(
          cx + n[0] * hx + t[0] * cc[0] * hx + b[0] * cc[1] * hx,
          cy + n[1] * hy + t[1] * cc[0] * hy + b[1] * cc[1] * hy,
          cz + n[2] * hz + t[2] * cc[0] * hz + b[2] * cc[1] * hz
        );
        nor.push(n[0], n[1], n[2]);
        col.push(c[0], c[1], c[2]);
      });
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
  }

  // бокс, повёрнутый вокруг Y (для створок пальмы)
  function pushBoxRot(pos, nor, col, idx, cx, cy, cz, hx, hy, hz, yaw, c) {
    var ca = Math.cos(yaw), sa = Math.sin(yaw);
    var faces = [
      [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      [[-1, 0, 0], [0, 1, 0], [0, 0, -1]],
      [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
      [[0, -1, 0], [0, 0, -1], [1, 0, 0]],
      [[0, 0, 1], [0, 1, 0], [-1, 0, 0]],
      [[0, 0, -1], [0, 1, 0], [1, 0, 0]]
    ];
    var corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    faces.forEach(function (f) {
      var n = f[0], t = f[1], b = f[2];
      var base = pos.length / 3;
      var rnx = n[0] * ca + n[2] * sa, rnz = -n[0] * sa + n[2] * ca;
      corners.forEach(function (cc) {
        var lx = n[0] * hx + t[0] * cc[0] * hx + b[0] * cc[1] * hx;
        var ly = n[1] * hy + t[1] * cc[0] * hy + b[1] * cc[1] * hy;
        var lz = n[2] * hz + t[2] * cc[0] * hz + b[2] * cc[1] * hz;
        pos.push(cx + lx * ca + lz * sa, cy + ly, cz - lx * sa + lz * ca);
        nor.push(rnx, n[1], rnz);
        col.push(c[0], c[1], c[2]);
      });
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
  }

  function nrm3(x, y, z) {
    var l = Math.hypot(x, y, z) || 1;
    return [x / l, y / l, z / l];
  }

  // конус: основание в cy-h, вершина в cy+h
  function pushCone(pos, nor, col, idx, cx, cy, cz, r, h, seg, c) {
    var y0 = cy - h, y1 = cy + h;
    var slope = r / (2 * h);
    for (var i = 0; i < seg; i++) {
      var a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      var x0 = cx + Math.cos(a0) * r, z0 = cz + Math.sin(a0) * r;
      var x1 = cx + Math.cos(a1) * r, z1 = cz + Math.sin(a1) * r;
      var am = (a0 + a1) * 0.5;
      var nm = nrm3(Math.cos(am), slope, Math.sin(am));
      var base = pos.length / 3;
      pos.push(x0, y0, z0); nor.push(nm[0], nm[1], nm[2]); col.push(c[0], c[1], c[2]);
      pos.push(x1, y0, z1); nor.push(nm[0], nm[1], nm[2]); col.push(c[0], c[1], c[2]);
      pos.push(cx, y1, cz); nor.push(nm[0], nm[1], nm[2]); col.push(c[0], c[1], c[2]);
      idx.push(base, base + 1, base + 2);
      // дно
      var b2 = pos.length / 3;
      pos.push(x0, y0, z0); nor.push(0, -1, 0); col.push(c[0] * 0.7, c[1] * 0.7, c[2] * 0.7);
      pos.push(cx, y0, cz); nor.push(0, -1, 0); col.push(c[0] * 0.7, c[1] * 0.7, c[2] * 0.7);
      pos.push(x1, y0, z1); nor.push(0, -1, 0); col.push(c[0] * 0.7, c[1] * 0.7, c[2] * 0.7);
      idx.push(b2, b2 + 1, b2 + 2);
    }
  }

  // двускатная крыша: конёк вдоль X, скаты в ZY
  function pushPrism(pos, nor, col, idx, hx, hz, y0, y1, c) {
    var A = [-hx, y0, -hz], B = [-hx, y0, hz], C = [-hx, y1, 0];
    var D = [hx, y0, -hz], E = [hx, y0, hz], F = [hx, y1, 0];
    function tri(p1, p2, p3, n) {
      var b = pos.length / 3;
      [p1, p2, p3].forEach(function (q) {
        pos.push(q[0], q[1], q[2]); nor.push(n[0], n[1], n[2]); col.push(c[0], c[1], c[2]);
      });
      idx.push(b, b + 1, b + 2);
    }
    function quad(p1, p2, p3, p4, n) {
      var b = pos.length / 3;
      [p1, p2, p3, p4].forEach(function (q) {
        pos.push(q[0], q[1], q[2]); nor.push(n[0], n[1], n[2]); col.push(c[0], c[1], c[2]);
      });
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    var nBack = nrm3(0, hz, -1), nFront = nrm3(0, hz, 1);
    quad(A, B, E, D, [0, -1, 0]);
    quad(A, C, F, D, nBack);
    quad(B, E, F, C, nFront);
    tri(A, D, F, [-1, 0, 0]);
    tri(A, F, C, [-1, 0, 0]);
    tri(B, C, F, [1, 0, 0]);
    tri(B, F, E, [1, 0, 0]);
  }

  // усечённый конус: нижний радиус r0, верхний r1, высота h
  function pushFrustum(pos, nor, col, idx, r0, r1, h, seg, c, topC) {
    for (var i = 0; i < seg; i++) {
      var a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      var am = (a0 + a1) * 0.5;
      var slope = (r0 - r1) / h;
      var nm = nrm3(Math.cos(am), slope, Math.sin(am));
      var b = pos.length / 3;
      var x0 = Math.cos(a0), z0 = Math.sin(a0), x1 = Math.cos(a1), z1 = Math.sin(a1);
      pos.push(x0 * r0, 0, z0 * r0); nor.push(nm[0], nm[1], nm[2]); col.push(c[0], c[1], c[2]);
      pos.push(x1 * r0, 0, z1 * r0); nor.push(nm[0], nm[1], nm[2]); col.push(c[0], c[1], c[2]);
      pos.push(x1 * r1, h, z1 * r1); nor.push(nm[0], nm[1], nm[2]); col.push(c[0], c[1], c[2]);
      pos.push(x0 * r1, h, z0 * r1); nor.push(nm[0], nm[1], nm[2]); col.push(c[0], c[1], c[2]);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);

      if (topC) {
        var t2 = pos.length / 3;
        pos.push(0, h, 0); nor.push(0, 1, 0); col.push(topC[0], topC[1], topC[2]);
        pos.push(x0 * r1, h, z0 * r1); nor.push(0, 1, 0); col.push(topC[0], topC[1], topC[2]);
        pos.push(x1 * r1, h, z1 * r1); nor.push(0, 1, 0); col.push(topC[0], topC[1], topC[2]);
        idx.push(t2, t2 + 1, t2 + 2);
      }
    }
  }

  /* Собрать все здания в один меш. Пересобирается только при изменении списка. */
  Renderer.prototype._rebuildBuildings = function (objs) {
    var gl = this.gl;
    var n = 0, sig = objs.length * 7919, i;
    for (i = 0; i < objs.length; i++) {
      var o = objs[i];
      if (o.kind !== 'building') continue;
      n++;
      sig += (o.pos[0] * 13.1 + o.pos[1] * 7.3 + o.pos[2] * 3.7 + o.size[1] * 101.0);
    }
    sig = Math.round(sig * 100) / 100 + ':' + n;
    if (sig === this.bldSig) return;
    this.bldSig = sig;

    var tmpl = this.cubeTmpl.inter, tn = tmpl.length / 9;
    var tidx = this.cubeTmpl.indices;
    var needV = n * tn * 16, needI = n * tidx.length;
    if (this.bldBufV.length < needV) this.bldBufV = new Float32Array(needV);
    if (this.bldBufI.length < needI) this.bldBufI = new Uint32Array(needI);
    var V = this.bldBufV, I = this.bldBufI;

    var vi = 0, ii = 0, base = 0;
    for (i = 0; i < objs.length; i++) {
      var ob = objs[i];
      if (ob.kind !== 'building') continue;
      var cx = ob.pos[0], cy = ob.pos[1], cz = ob.pos[2];
      var hx = ob.size[0], hy = ob.size[1], hz = ob.size[2];
      var col = ob.color;
      var rows = Math.min(24, Math.max(2, Math.round(hy * 2 / 0.045)));
      var cX = Math.min(16, Math.max(2, Math.round(hx * 2 / 0.040)));
      var cZ = Math.min(16, Math.max(2, Math.round(hz * 2 / 0.040)));
      var seed = (i * 17) % 97;
      for (var v = 0; v < tn; v++) {
        var lx = tmpl[v * 9], ly = tmpl[v * 9 + 1], lz = tmpl[v * 9 + 2];
        V[vi] = cx + lx * hx; V[vi + 1] = cy + ly * hy; V[vi + 2] = cz + lz * hz;
        V[vi + 3] = tmpl[v * 9 + 3]; V[vi + 4] = tmpl[v * 9 + 4]; V[vi + 5] = tmpl[v * 9 + 5];
        V[vi + 6] = col[0]; V[vi + 7] = col[1]; V[vi + 8] = col[2];
        V[vi + 9] = lx; V[vi + 10] = ly; V[vi + 11] = lz;
        V[vi + 12] = seed; V[vi + 13] = rows; V[vi + 14] = cX; V[vi + 15] = cZ;
        vi += 16;
      }
      for (var t = 0; t < tidx.length; t++) I[ii++] = base + tidx[t];
      base += tn;
    }

    gl.bindVertexArray(this.bldVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bldVB);
    gl.bufferData(gl.ARRAY_BUFFER, V.subarray(0, vi), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.bldIB);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, I.subarray(0, ii), gl.DYNAMIC_DRAW);
    gl.bindVertexArray(null);
    this.bldVerts = n;
    this.bldIdx = ii;
  };

  /* Статичные объекты (пальмы, камни, деревья, дома) — одним мешем */
  Renderer.prototype._rebuildProps = function (objs) {
    var gl = this.gl;
    var tplMap = { palm: this.palmTpl, rock: this.rockTpl, tree: this.treeTpl, house: this.houseTpl };
    var n = 0, sig = 0, i, o;
    for (i = 0; i < objs.length; i++) {
      o = objs[i];
      if (!tplMap[o.kind]) continue;
      n++;
      sig += o.pos[0] * 11.3 + o.pos[1] * 5.1 + o.pos[2] * 2.7 + (o.size ? o.size[1] * 37 : 0);
    }
    sig = Math.round(sig * 100) / 100 + ':' + n;
    if (sig === this.propSig) return;
    this.propSig = sig;
    if (!n) { this.propIdx = 0; return; }

    var totalV = 0, totalI = 0;
    for (i = 0; i < objs.length; i++) {
      o = objs[i];
      var tp = tplMap[o.kind];
      if (!tp) continue;
      totalV += tp.inter.length / 9;
      totalI += tp.indices.length;
    }
    var V = new Float32Array(totalV * 9);
    var I = new Uint32Array(totalI);
    var vi = 0, ii = 0, base = 0;

    for (i = 0; i < objs.length; i++) {
      o = objs[i];
      var tpl = tplMap[o.kind];
      if (!tpl) continue;
      var sx, sy, sz;
      if (o.kind === 'rock') { sx = o.size[0]; sy = o.size[1]; sz = o.size[2]; }
      else if (o.kind === 'house') { sx = o.size[0]; sy = o.size[1]; sz = o.size[2]; }
      else { sx = o.size[0]; sy = o.size[1]; sz = o.size[0]; }
      var ca = Math.cos(o.rot || 0), sa = Math.sin(o.rot || 0);
      var tint = o.kind === 'rock' ? o.color : null;
      var tv = tpl.inter, tvn = tv.length / 9;
      for (var v = 0; v < tvn; v++) {
        var lx = tv[v * 9] * sx, ly = tv[v * 9 + 1] * sy, lz = tv[v * 9 + 2] * sz;
        var wx = o.pos[0] + lx * ca + lz * sa;
        var wy = o.pos[1] + ly;
        var wz = o.pos[2] - lx * sa + lz * ca;
        var nx = tv[v * 9 + 3] / sx, ny = tv[v * 9 + 4] / sy, nz = tv[v * 9 + 5] / sz;
        var nl = Math.hypot(nx, ny, nz) || 1;
        var rnx = (nx * ca + nz * sa) / nl, rnz = (-nx * sa + nz * ca) / nl;
        var cr = tv[v * 9 + 6], cg = tv[v * 9 + 7], cb = tv[v * 9 + 8];
        if (tint) { cr *= tint[0]; cg *= tint[1]; cb *= tint[2]; }
        V[vi] = wx; V[vi + 1] = wy; V[vi + 2] = wz;
        V[vi + 3] = rnx; V[vi + 4] = ny / nl; V[vi + 5] = rnz;
        V[vi + 6] = cr; V[vi + 7] = cg; V[vi + 8] = cb;
        vi += 9;
      }
      var ti = tpl.indices;
      for (var t2 = 0; t2 < ti.length; t2++) I[ii++] = base + ti[t2];
      base += tvn;
    }

    if (!this.propVAO) {
      this.propVAO = gl.createVertexArray();
      this.propVB = gl.createBuffer();
      this.propIB = gl.createBuffer();
    }
    gl.bindVertexArray(this.propVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.propVB);
    gl.bufferData(gl.ARRAY_BUFFER, V, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 36, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 36, 24);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.propIB);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, I, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.propIdx = ii;
  };

  /* Рельеф острова: сетка из карты высот, цвета по высоте и уклону */
  Renderer.prototype._buildTerrain = function (level) {
    var gl = this.gl, T = level.terrain;
    if (!T) { this.terrainIdx = 0; this.terrainKey = ''; return; }
    var key = T.n + ':' + T.half + ':' + level.floorY;
    if (key === this.terrainKey) return;
    this.terrainKey = key;

    var n = T.n, half = T.half, fy = level.floorY;
    var step = (2 * half) / n;
    var vcount = n * n;
    var V = new Float32Array(vcount * 9);
    var I = new Uint32Array((n - 1) * (n - 1) * 6);
    var H = T.h;
    var hAt = function (i, j) {
      if (i < 0) i = 0; else if (i >= n) i = n - 1;
      if (j < 0) j = 0; else if (j >= n) j = n - 1;
      return H[j * n + i];
    };

    for (var j = 0; j < n; j++) {
      for (var i = 0; i < n; i++) {
        var x = -half + (i + 0.5) * step;
        var z = -half + (j + 0.5) * step;
        var h = H[j * n + i];
        var hx = (hAt(i + 1, j) - hAt(i - 1, j)) / (2 * step);
        var hz = (hAt(i, j + 1) - hAt(i, j - 1)) / (2 * step);
        var nx = -hx, ny = 1, nz = -hz;
        var nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;

        var slope = 1 - ny;                       // 0 — ровно, 1 — отвесно
        var r = Math.hypot(x, z);
        var col;
        var sand = [0.60, 0.53, 0.38], grass = [0.14, 0.33, 0.12];
        var grass2 = [0.20, 0.42, 0.16], rock = [0.31, 0.29, 0.27];
        var dark = [0.19, 0.17, 0.15];
        if (h < 0.22) {
          col = sand;
        } else {
          var g = Math.min(1, (h - 0.22) / 0.8);
          col = [
            sand[0] + (grass[0] - sand[0]) * g,
            sand[1] + (grass[1] - sand[1]) * g,
            sand[2] + (grass[2] - sand[2]) * g
          ];
          var v = h * 0.55 + Math.sin(x * 1.7) * 0.12 + Math.cos(z * 1.3) * 0.12;
          col = [
            col[0] + (grass2[0] - col[0]) * Math.min(1, Math.max(0, v)),
            col[1] + (grass2[1] - col[1]) * Math.min(1, Math.max(0, v)),
            col[2] + (grass2[2] - col[2]) * Math.min(1, Math.max(0, v))
          ];
        }
        var rk = Math.min(1, Math.max(0, (slope - 0.28) * 3.2));
        col = [
          col[0] + (rock[0] - col[0]) * rk,
          col[1] + (rock[1] - col[1]) * rk,
          col[2] + (rock[2] - col[2]) * rk
        ];
        var dk = Math.min(1, Math.max(0, (h - 4.6) / 1.6 + (r < 1.7 ? 0.5 : 0)));
        col = [
          col[0] + (dark[0] - col[0]) * dk,
          col[1] + (dark[1] - col[1]) * dk,
          col[2] + (dark[2] - col[2]) * dk
        ];

        var o = (j * n + i) * 9;
        V[o] = x; V[o + 1] = fy + h; V[o + 2] = z;
        V[o + 3] = nx; V[o + 4] = ny; V[o + 5] = nz;
        V[o + 6] = col[0]; V[o + 7] = col[1]; V[o + 8] = col[2];
      }
    }
    var k2 = 0;
    for (var jj = 0; jj < n - 1; jj++) {
      for (var ii = 0; ii < n - 1; ii++) {
        var a = jj * n + ii, b = a + 1, c = a + n, d = c + 1;
        I[k2++] = a; I[k2++] = c; I[k2++] = b;
        I[k2++] = b; I[k2++] = c; I[k2++] = d;
      }
    }

    if (!this.terrainVAO) {
      this.terrainVAO = gl.createVertexArray();
      this.terrainVB = gl.createBuffer();
      this.terrainIB = gl.createBuffer();
    }
    gl.bindVertexArray(this.terrainVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.terrainVB);
    gl.bufferData(gl.ARRAY_BUFFER, V, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 36, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 36, 24);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.terrainIB);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, I, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.terrainIdx = I.length;
  };

  Renderer.prototype._buildGeometry = function () {
    var gl = this.gl;

    // сфера
    var seg = 32, ring = 20;
    var pos = [], nor = [], idx = [];
    for (var y = 0; y <= ring; y++) {
      var v = y / ring, phi = v * Math.PI;
      for (var x = 0; x <= seg; x++) {
        var u = x / seg, theta = u * Math.PI * 2;
        var nx = Math.sin(phi) * Math.cos(theta);
        var ny = Math.cos(phi);
        var nz = Math.sin(phi) * Math.sin(theta);
        pos.push(nx, ny, nz);
        nor.push(nx, ny, nz);
      }
    }
    for (var yy = 0; yy < ring; yy++) {
      for (var xx = 0; xx < seg; xx++) {
        var a = yy * (seg + 1) + xx;
        var b = a + seg + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    this.sphereTpl = meshData(pos, nor, null, new Uint16Array(idx));
    this.sphere = this._uploadMesh(this.sphereTpl);

    // низкополигональный камень (для объединённого меша)
    var rseg = 9, rring = 6;
    var rp = [], rn = [], ri = [];
    for (var ry = 0; ry <= rring; ry++) {
      var rv = ry / rring, rphi = rv * Math.PI;
      for (var rx = 0; rx <= rseg; rx++) {
        var rt = rx / rseg * Math.PI * 2;
        var rnx = Math.sin(rphi) * Math.cos(rt);
        var rny = Math.cos(rphi);
        var rnz = Math.sin(rphi) * Math.sin(rt);
        var jitter = 0.82 + 0.36 * ((rx * 7 + ry * 13) % 5) / 5;
        rp.push(rnx * jitter, rny * jitter, rnz * jitter);
        rn.push(rnx, rny, rnz);
      }
    }
    for (var ryy = 0; ryy < rring; ryy++) {
      for (var rxx = 0; rxx < rseg; rxx++) {
        var ra = ryy * (rseg + 1) + rxx, rb = ra + rseg + 1;
        ri.push(ra, rb, ra + 1, rb, rb + 1, ra + 1);
      }
    }
    this.rockTpl = meshData(rp, rn, null, new Uint16Array(ri));

    // куб
    var p2 = [], n2 = [], c2 = [], i2 = [];
    pushBox(p2, n2, c2, i2, 0, 0, 0, 1, 1, 1, [1, 1, 1]);
    this.cube = this._uploadMesh(meshData(p2, n2, c2, new Uint16Array(i2)));

    // машина (в локальных координатах -1..1)
    var pc = [], nc = [], cc = [], ic = [];
    pushBox(pc, nc, cc, ic, 0, -0.18, 0, 1.0, 0.34, 1.0, [1, 1, 1]);
    pushBox(pc, nc, cc, ic, 0, 0.30, -0.05, 0.60, 0.30, 0.52, [0.78, 0.82, 0.88]);
    pushBox(pc, nc, cc, ic, -0.78, -0.62, 0.62, 0.20, 0.26, 0.30, [0.10, 0.10, 0.12]);
    pushBox(pc, nc, cc, ic, 0.78, -0.62, 0.62, 0.20, 0.26, 0.30, [0.10, 0.10, 0.12]);
    pushBox(pc, nc, cc, ic, -0.78, -0.62, -0.62, 0.20, 0.26, 0.30, [0.10, 0.10, 0.12]);
    pushBox(pc, nc, cc, ic, 0.78, -0.62, -0.62, 0.20, 0.26, 0.30, [0.10, 0.10, 0.12]);
    this.car = this._uploadMesh(meshData(pc, nc, cc, new Uint16Array(ic)));

    // ёлочка: ствол + три яруса кроны (локально: радиус 1, y -1..1)
    var pt = [], nt = [], ct = [], it = [];
    pushBox(pt, nt, ct, it, 0, -0.80, 0, 0.11, 0.20, 0.11, [0.42, 0.28, 0.16]);
    pushCone(pt, nt, ct, it, 0, -0.30, 0, 0.80, 0.34, 14, [0.10, 0.40, 0.20]);
    pushCone(pt, nt, ct, it, 0, 0.10, 0, 0.62, 0.30, 14, [0.13, 0.48, 0.24]);
    pushCone(pt, nt, ct, it, 0, 0.48, 0, 0.42, 0.28, 12, [0.16, 0.56, 0.28]);
    this.treeTpl = meshData(pt, nt, ct, new Uint16Array(it));
    this.tree = this._uploadMesh(this.treeTpl);

    // пальма: изогнутый ствол + створки кроны
    var pp = [], np = [], cp = [], ip = [];
    var lean = 0.10;
    for (var seg2 = 0; seg2 < 5; seg2++) {
      var ty = -0.92 + seg2 * 0.36;
      var off = lean * (seg2 * seg2) * 0.25;
      pushBoxRot(pp, np, cp, ip, off, ty, 0, 0.075, 0.19, 0.075,
        seg2 * 0.05, [0.34, 0.235, 0.145]);
    }
    var NF = 7;
    for (var fr = 0; fr < NF; fr++) {
      var fyaw = (fr / NF) * Math.PI * 2 + 0.4;
      var fc = Math.cos(fyaw), fs = Math.sin(fyaw);
      var g1 = [0.115, 0.375, 0.145];
      var g2 = [0.085, 0.300, 0.115];
      pushBoxRot(pp, np, cp, ip, fc * 0.42, 0.86, fs * 0.42, 0.42, 0.028, 0.085, -fyaw, g1);
      pushBoxRot(pp, np, cp, ip, fc * 1.00, 0.72, fs * 1.00, 0.30, 0.022, 0.062, -fyaw, g2);
      pushBoxRot(pp, np, cp, ip, fc * 0.20, 0.94, fs * 0.20, 0.20, 0.024, 0.055, -fyaw, g1);
    }
    pushBoxRot(pp, np, cp, ip, 0.10, 0.80, 0.05, 0.055, 0.055, 0.055, 0, [0.30, 0.22, 0.10]);
    pushBoxRot(pp, np, cp, ip, -0.08, 0.76, -0.09, 0.05, 0.05, 0.05, 0, [0.28, 0.20, 0.09]);
    this.palmTpl = meshData(pp, np, cp, new Uint16Array(ip));
    this.palm = this._uploadMesh(this.palmTpl);

    // здания: объединённый меш (один draw call на весь город)
    var bp = [], bn = [], bc = [], bi = [];
    pushBox(bp, bn, bc, bi, 0, 0, 0, 1, 1, 1, [1, 1, 1]);
    this.cubeTmpl = meshData(bp, bn, bc, new Uint16Array(bi));
    this.bldVAO = gl.createVertexArray();
    gl.bindVertexArray(this.bldVAO);
    this.bldVB = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bldVB);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 64, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 64, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 64, 24);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 64, 36);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 64, 48);
    this.bldIB = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.bldIB);
    gl.bindVertexArray(null);
    this.bldVerts = 0;
    this.bldIdx = 0;
    this.bldSig = '';
    this.bldBufV = new Float32Array(0);
    this.bldBufI = new Uint32Array(0);

    // деревянный домик: сруб + двускатная крыша
    var ph = [], nh = [], ch = [], ih = [];
    pushBox(ph, nh, ch, ih, 0, -0.45, 0, 0.86, 0.55, 0.86, [0.62, 0.44, 0.26]);
    pushBox(ph, nh, ch, ih, 0, -0.36, 0.87, 0.16, 0.36, 0.02, [0.30, 0.20, 0.12]);
    pushBox(ph, nh, ch, ih, 0, -0.02, 0.87, 0.13, 0.13, 0.02, [0.98, 0.85, 0.45]);
    pushPrism(ph, nh, ch, ih, 0.98, 0.98, 0.10, 0.92, [0.72, 0.22, 0.18]);
    this.houseTpl = meshData(ph, nh, ch, new Uint16Array(ih));
    this.house = this._uploadMesh(this.houseTpl);

    // вулкан: усечённый конус с тёмным жерлом
    var pv = [], nv = [], cv = [], iv = [];
    pushFrustum(pv, nv, cv, iv, 1.0, 0.235, 1.0, 30, [0.26, 0.21, 0.18], [0.10, 0.07, 0.06]);
    this.cone = this._uploadMesh(meshData(pv, nv, cv, new Uint16Array(iv)));

    // тор (портал), плоскость XY, ось Z
    var tp = [], tn = [], ti = [];
    var R = 0.78, r = 0.22, SEG = 28, TUBE = 12;
    for (var i = 0; i <= SEG; i++) {
      var u2 = (i / SEG) * Math.PI * 2;
      var cu = Math.cos(u2), su = Math.sin(u2);
      for (var j = 0; j <= TUBE; j++) {
        var v2 = (j / TUBE) * Math.PI * 2;
        var cv = Math.cos(v2), sv = Math.sin(v2);
        var px = (R + r * cv) * cu;
        var py = (R + r * cv) * su;
        var pz = r * sv;
        tp.push(px, py, pz);
        var nx2 = cv * cu, ny2 = cv * su, nz2 = sv;
        tn.push(nx2, ny2, nz2);
      }
    }
    for (var ii = 0; ii < SEG; ii++) {
      for (var jj = 0; jj < TUBE; jj++) {
        var a1 = ii * (TUBE + 1) + jj;
        var b1 = a1 + TUBE + 1;
        ti.push(a1, b1, a1 + 1, b1, b1 + 1, a1 + 1);
      }
    }
    this.torus = this._uploadMesh(meshData(tp, tn, null, new Uint16Array(ti)));

    // диск (центр портала)
    var dp = [0, 0, 0], dn = [0, 0, 1], di = [];
    var DS = 36;
    for (var k = 0; k <= DS; k++) {
      var ang = (k / DS) * Math.PI * 2;
      dp.push(Math.cos(ang) * 0.78, Math.sin(ang) * 0.78, 0);
      dn.push(0, 0, 1);
    }
    for (var k2 = 1; k2 <= DS; k2++) di.push(0, k2, k2 + 1);
    this.disc = this._uploadMesh(meshData(dp, dn, null, new Uint16Array(di)));

    // плоскость
    var s = 40;
    this.plane = this._uploadMesh(meshData(
      [-s, 0, -s, s, 0, -s, s, 0, s, -s, 0, s],
      [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
      null,
      new Uint16Array([0, 2, 1, 0, 3, 2])
    ));

    // каркас резервуара (единичный куб, масштабируется под уровень)
    var bx = 1.0, bz = 1.0, y0 = 0.0, y1 = 1.0;
    var lp = [];
    function edge(a, b) { lp.push(a[0], a[1], a[2], b[0], b[1], b[2]); }
    var t = [[-bx, y1, -bz], [bx, y1, -bz], [bx, y1, bz], [-bx, y1, bz]];
    for (var q = 0; q < 4; q++) {
      edge(t[q], t[(q + 1) % 4]);
      edge([t[q][0], y1 - 0.045, t[q][2]], t[q]);
    }
    this.lineVAO = gl.createVertexArray();
    gl.bindVertexArray(this.lineVAO);
    var lbuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, lbuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lp), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.lineCount = lp.length / 3;

    // стеклянные стенки
    var gp = [], gn = [], gi = [];
    var walls = [
      { a: [-bx, y0, -bz], b: [-bx, y0, bz], n: [1, 0, 0] },
      { a: [bx, y0, bz], b: [bx, y0, -bz], n: [-1, 0, 0] },
      { a: [bx, y0, -bz], b: [-bx, y0, -bz], n: [0, 0, 1] },
      { a: [-bx, y0, bz], b: [bx, y0, bz], n: [0, 0, -1] }
    ];
    walls.forEach(function (w) {
      var base = gp.length / 3;
      gp.push(w.a[0], w.a[1], w.a[2], w.b[0], w.b[1], w.b[2],
        w.b[0], y1, w.b[2], w.a[0], y1, w.a[2]);
      for (var k3 = 0; k3 < 4; k3++) gn.push(w.n[0], w.n[1], w.n[2]);
      gi.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
    this.glass = this._uploadMesh(meshData(gp, gn, null, new Uint16Array(gi)));

    // динамические линии гизмо
    this.gizmoVAO = gl.createVertexArray();
    gl.bindVertexArray(this.gizmoVAO);
    this.gizmoBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gizmoBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(18), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  };

  Renderer.prototype._uploadMesh = function (data) {
    var gl = this.gl;
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    var vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, data.inter, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 36, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 36, 24);
    if (data.indices) {
      var ib = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW);
    }
    gl.bindVertexArray(null);
    return { vao: vao, count: data.indices ? data.indices.length : data.inter.length / 9 };
  };

  /* ---------- render targets ---------- */

  Renderer.prototype._initTargets = function (w, h) {
    var gl = this.gl;
    if (this.rtScene) this._destroyTargets();

    this.W = w; this.H = h;

    var colorTex = GL.texture(gl, w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, null, gl.LINEAR);
    var depthTex = GL.texture(gl, w, h, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null, gl.NEAREST);
    var fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTex, 0);
    var st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) console.warn('scene FBO incomplete 0x' + st.toString(16));
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.rtScene = { tex: colorTex, depth: depthTex, fbo: fbo };

    var fdTex = GL.texture(gl, w, h, gl.RGBA32F, gl.RGBA, gl.FLOAT, null, gl.NEAREST);
    var fdDepth = GL.renderbuffer(gl, w, h, gl.DEPTH_COMPONENT24);
    this.rtFluidDepth = { tex: fdTex, fbo: GL.fbo(gl, [fdTex], fdDepth) };

    var thTex = GL.texture(gl, w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, null, gl.NEAREST);
    this.rtThick = { tex: thTex, fbo: GL.fbo(gl, [thTex], null) };

    this.rtBlurA = { tex: GL.texture(gl, w, h, gl.RGBA32F, gl.RGBA, gl.FLOAT, null, gl.NEAREST) };
    this.rtBlurA.fbo = GL.fbo(gl, [this.rtBlurA.tex], null);
    this.rtBlurB = { tex: GL.texture(gl, w, h, gl.RGBA32F, gl.RGBA, gl.FLOAT, null, gl.NEAREST) };
    this.rtBlurB.fbo = GL.fbo(gl, [this.rtBlurB.tex], null);
    this.rtThickB = { tex: GL.texture(gl, w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, null, gl.NEAREST) };
    this.rtThickB.fbo = GL.fbo(gl, [this.rtThickB.tex], null);
  };

  Renderer.prototype._destroyTargets = function () {
    var gl = this.gl;
    var list = [this.rtScene, this.rtFluidDepth, this.rtThick, this.rtBlurA, this.rtBlurB, this.rtThickB];
    list.forEach(function (t) {
      if (!t) return;
      if (t.fbo) gl.deleteFramebuffer(t.fbo);
      if (t.tex) gl.deleteTexture(t.tex);
      if (t.depth) gl.deleteTexture(t.depth);
    });
  };

  Renderer.prototype.resize = function (w, h) {
    this._initTargets(Math.max(2, w), Math.max(2, h));
  };

  /* ---------- матрицы ---------- */

  function modelTRS(x, y, z, rotY, sx, sy, sz) {
    var c = Math.cos(rotY || 0), s = Math.sin(rotY || 0);
    var m = new Float32Array(16);
    m[0] = c * sx; m[1] = 0; m[2] = -s * sx; m[3] = 0;
    m[4] = 0; m[5] = sy; m[6] = 0; m[7] = 0;
    m[8] = s * sz; m[9] = 0; m[10] = c * sz; m[11] = 0;
    m[12] = x; m[13] = y; m[14] = z; m[15] = 1;
    return m;
  }

  function modelFromNormal(x, y, z, n, scale) {
    var nx = n[0], ny = n[1], nz = n[2];
    var l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    var ux = Math.abs(ny) > 0.9 ? 1 : 0;
    var uy = Math.abs(ny) > 0.9 ? 0 : 1;
    var uz = 0;
    var xx = uy * nz - uz * ny, xy = uz * nx - ux * nz, xz = ux * ny - uy * nx;
    var xl = Math.hypot(xx, xy, xz) || 1;
    xx /= xl; xy /= xl; xz /= xl;
    var yx = ny * xz - nz * xy, yy = nz * xx - nx * xz, yz = nx * xy - ny * xx;
    var m = new Float32Array(16);
    m[0] = xx * scale; m[1] = xy * scale; m[2] = xz * scale; m[3] = 0;
    m[4] = yx * scale; m[5] = yy * scale; m[6] = yz * scale; m[7] = 0;
    m[8] = nx * scale; m[9] = ny * scale; m[10] = nz * scale; m[11] = 0;
    m[12] = x; m[13] = y; m[14] = z; m[15] = 1;
    return m;
  }

  /* ---------- сцена ---------- */

  Renderer.prototype._fullscreen = function (fbo, w, h) {
    var gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.bindVertexArray(this.quadVAO);
  };

  Renderer.prototype._clearColorPass = function (fbo, w, h, r, g, b, a, clearDepth) {
    var gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.clearColor(0, 0, 0, 1);
    if (clearDepth) { gl.clearDepth(1.0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); }
    else gl.clear(gl.COLOR_BUFFER_BIT);
    var p = this.progs.clear;
    gl.useProgram(p.program);
    GL.u4f(gl, p, 'uValue', r, g, b, a);
    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  Renderer.prototype.renderScene = function (cam, sim, state, gizmo) {
    var gl = this.gl;
    var W = this.W, H = this.H;
    var level = sim.level;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.rtScene.fbo);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0.01, 0.015, 0.02, 1);
    gl.clearDepth(1.0);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // небо
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    var p = this.progs.sky;
    gl.useProgram(p.program);
    GL.u2f(gl, p, 'uRes', W, H);
    GL.u1i(gl, p, 'uMode', Math.max(0, SKY_ORDER.indexOf(state.skybox)));
    GL.u1f(gl, p, 'uTime', this.time);
    GL.u1f(gl, p, 'uClouds', this.clouds ? 1 : 0);
    if (this.clouds) {
      var V = cam.view;
      GL.u3f(gl, p, 'uCamPos', cam.eye[0], cam.eye[1], cam.eye[2]);
      GL.u3f(gl, p, 'uCamRight', V[0], V[4], V[8]);
      GL.u3f(gl, p, 'uCamUp', V[1], V[5], V[9]);
      GL.u3f(gl, p, 'uCamFwd', -V[2], -V[6], -V[10]);
      GL.u1f(gl, p, 'uTanFov', 1.0 / Math.max(0.01, cam.proj[5]));
      var cy0 = (level.terrain ? 9.0 : (level.wallTop || 1.6) + 1.6);
      GL.u1f(gl, p, 'uCloudY0', cy0);
      GL.u1f(gl, p, 'uCloudY1', cy0 + 9.0);
    }
    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);

    var vp = M.multiply(M.create(), cam.proj, cam.view);

    // модель контейнера уровня (единичный куб -> реальные границы)
    var boxModel = null;
    if (level.kind === 'box') {
      var hx = (level.max[0] - level.min[0]) / 2;
      var hz = (level.max[2] - level.min[2]) / 2;
      var hy = (level.wallTop === undefined ? level.max[1] : level.wallTop) - level.min[1];
      boxModel = new Float32Array(16);
      boxModel[0] = hx; boxModel[5] = hy; boxModel[10] = hz;
      boxModel[12] = (level.min[0] + level.max[0]) / 2;
      boxModel[13] = level.min[1];
      boxModel[14] = (level.min[2] + level.max[2]) / 2;
      boxModel[15] = 1;
    }

    // пол
    if (level.kind !== 'sphere') {
      p = this.progs.floor;
      gl.useProgram(p.program);
      var floorY = level.min ? level.min[1] : -1;
      var model = M.translation(M.create(), 0, floorY, 0);
      GL.um4(gl, p, 'uMVP', M.multiply(M.create(), vp, model));
      GL.um4(gl, p, 'uModel', model);
      GL.u3fv(gl, p, 'uLightDir', this.lightDir);
      GL.u3fv(gl, p, 'uCamPos', cam.eye);
      GL.u3f(gl, p, 'uColor', 0.035, 0.045, 0.06);
      GL.u1f(gl, p, 'uGridFade', Math.max(1.0, (level.half || 2) / 2));
      GL.u1i(gl, p, 'uFloorStyle', level.floorStyle || 0);
      GL.u1f(gl, p, 'uBlock', level.city ? level.cell : 1.0);
      GL.u1f(gl, p, 'uIslandR', (level.half || 2) * 1.02);
      GL.u1f(gl, p, 'uTime', this.time);
      gl.bindVertexArray(this.plane.vao);
      gl.drawElements(gl.TRIANGLES, this.plane.count, gl.UNSIGNED_SHORT, 0);
    }

    // рельеф острова
    if (level.terrain) {
      this._buildTerrain(level);
      if (this.terrainIdx > 0) {
        var pt = this.progs.terrain;
        gl.useProgram(pt.program);
        GL.um4(gl, pt, 'uMVP', vp);
        GL.u3fv(gl, pt, 'uLightDir', this.lightDir);
        GL.u3fv(gl, pt, 'uCamPos', cam.eye);
        gl.bindVertexArray(this.terrainVAO);
        gl.drawElements(gl.TRIANGLES, this.terrainIdx, gl.UNSIGNED_INT, 0);
        gl.bindVertexArray(null);
        p = this.progs.scene;
        gl.useProgram(p.program);
        GL.u3fv(gl, p, 'uLightDir', this.lightDir);
        GL.u3fv(gl, p, 'uCamPos', cam.eye);
      }
    }

    // вулкан (если нет рельефа — рисуем отдельным конусом)
    if (level.cone && !level.terrain) {
      p = this.progs.scene;
      gl.useProgram(p.program);
      GL.u3fv(gl, p, 'uLightDir', this.lightDir);
      GL.u3fv(gl, p, 'uCamPos', cam.eye);
      var mc2 = modelTRS(0, level.floorY, 0, 0, level.cone.r0, level.cone.h, level.cone.r0);
      GL.um4(gl, p, 'uMVP', M.multiply(M.create(), vp, mc2));
      GL.um4(gl, p, 'uModel', mc2);
      GL.u3f(gl, p, 'uColor', 1, 1, 1);
      GL.u1f(gl, p, 'uAlpha', 1.0);
      GL.u1f(gl, p, 'uEmissive', 0.0);
      GL.u1i(gl, p, 'uStyle', 3);
      GL.u1f(gl, p, 'uSeed', 0);
      GL.u2f(gl, p, 'uWinA', 1, 1);
      GL.u2f(gl, p, 'uWinB', 1, 1);
      gl.bindVertexArray(this.cone.vao);
      gl.drawElements(gl.TRIANGLES, this.cone.count, gl.UNSIGNED_SHORT, 0);
    }

    // объекты
    p = this.progs.scene;
    gl.useProgram(p.program);
    GL.u3fv(gl, p, 'uLightDir', this.lightDir);
    GL.u3fv(gl, p, 'uCamPos', cam.eye);

    var objs = sim.objects;

    // --- статичные объекты одним вызовом ---
    this._rebuildProps(objs);
    if (this.propIdx > 0) {
      var pp2 = this.progs.terrain;
      gl.useProgram(pp2.program);
      GL.um4(gl, pp2, 'uMVP', vp);
      GL.u3fv(gl, pp2, 'uLightDir', this.lightDir);
      GL.u3fv(gl, pp2, 'uCamPos', cam.eye);
      gl.bindVertexArray(this.propVAO);
      gl.drawElements(gl.TRIANGLES, this.propIdx, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(null);
      p = this.progs.scene;
      gl.useProgram(p.program);
      GL.u3fv(gl, p, 'uLightDir', this.lightDir);
      GL.u3fv(gl, p, 'uCamPos', cam.eye);
    }

    // --- все здания одним вызовом ---
    this._rebuildBuildings(objs);
    if (this.bldIdx > 0) {
      var pb = this.progs.bld;
      gl.useProgram(pb.program);
      GL.um4(gl, pb, 'uMVP', vp);
      GL.u3fv(gl, pb, 'uLightDir', this.lightDir);
      GL.u3fv(gl, pb, 'uCamPos', cam.eye);
      gl.bindVertexArray(this.bldVAO);
      gl.drawElements(gl.TRIANGLES, this.bldIdx, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(null);
      p = this.progs.scene;
      gl.useProgram(p.program);
      GL.u3fv(gl, p, 'uLightDir', this.lightDir);
      GL.u3fv(gl, p, 'uCamPos', cam.eye);
    }

    for (var i = 0; i < objs.length; i++) {
      var o = objs[i];
      if (o.kind === 'sphere') {
        var ms = modelTRS(o.pos[0], o.pos[1], o.pos[2], 0, o.r, o.r, o.r);
        GL.um4(gl, p, 'uMVP', M.multiply(M.create(), vp, ms));
        GL.um4(gl, p, 'uModel', ms);
        GL.u3fv(gl, p, 'uColor', o.color);
        GL.u1f(gl, p, 'uAlpha', 1.0);
        GL.u1f(gl, p, 'uEmissive', 0.0);
        GL.u1i(gl, p, 'uStyle', 0);
        GL.u1f(gl, p, 'uSeed', 0);
        GL.u2f(gl, p, 'uWinA', 1, 1);
        GL.u2f(gl, p, 'uWinB', 1, 1);
        gl.bindVertexArray(this.sphere.vao);
        gl.drawElements(gl.TRIANGLES, this.sphere.count, gl.UNSIGNED_SHORT, 0);
      } else if (o.kind === 'building') {
        continue;   // рисуются инстансно выше
      } else if (o.kind === 'palm' || o.kind === 'rock' || o.kind === 'tree' || o.kind === 'house') {
        continue;   // объединены в общий меш выше
      } else if (o.kind === 'palmOLD') {
        var mpa = modelTRS(o.pos[0], o.pos[1], o.pos[2], o.rot || 0, o.size[0], o.size[1], o.size[0]);
        GL.um4(gl, p, 'uMVP', M.multiply(M.create(), vp, mpa));
        GL.um4(gl, p, 'uModel', mpa);
        GL.u3f(gl, p, 'uColor', 1, 1, 1);
        GL.u1f(gl, p, 'uAlpha', 1.0);
        GL.u1f(gl, p, 'uEmissive', 0.0);
        GL.u1i(gl, p, 'uStyle', 0);
        GL.u1f(gl, p, 'uSeed', 0);
        GL.u2f(gl, p, 'uWinA', 1, 1);
        GL.u2f(gl, p, 'uWinB', 1, 1);
        gl.bindVertexArray(this.palm.vao);
        gl.drawElements(gl.TRIANGLES, this.palm.count, gl.UNSIGNED_SHORT, 0);
      } else if (o.kind === 'rock') {
        var mrk = modelTRS(o.pos[0], o.pos[1], o.pos[2], o.rot || 0, o.size[0], o.size[1], o.size[2]);
        GL.um4(gl, p, 'uMVP', M.multiply(M.create(), vp, mrk));
        GL.um4(gl, p, 'uModel', mrk);
        GL.u3fv(gl, p, 'uColor', o.color);
        GL.u1f(gl, p, 'uAlpha', 1.0);
        GL.u1f(gl, p, 'uEmissive', 0.0);
        GL.u1i(gl, p, 'uStyle', 2);
        GL.u1f(gl, p, 'uSeed', 0);
        GL.u2f(gl, p, 'uWinA', 1, 1);
        GL.u2f(gl, p, 'uWinB', 1, 1);
        gl.bindVertexArray(this.sphere.vao);
        gl.drawElements(gl.TRIANGLES, this.sphere.count, gl.UNSIGNED_SHORT, 0);
      } else if (o.kind === 'buildingOLD') {
        var mb = modelTRS(o.pos[0], o.pos[1], o.pos[2], o.rot || 0, o.size[0], o.size[1], o.size[2]);
        GL.um4(gl, p, 'uMVP', M.multiply(M.create(), vp, mb));
        GL.um4(gl, p, 'uModel', mb);
        GL.u3fv(gl, p, 'uColor', o.color);
        GL.u1f(gl, p, 'uAlpha', 1.0);
        GL.u1f(gl, p, 'uEmissive', 0.0);
        GL.u1i(gl, p, 'uStyle', 1);
        GL.u1f(gl, p, 'uSeed', (i * 17) % 97);
        GL.u2f(gl, p, 'uWinA', Math.max(2, Math.round(o.size[2] * 2 / 0.115)),
          Math.max(3, Math.round(o.size[1] * 2 / 0.125)));
        GL.u2f(gl, p, 'uWinB', Math.max(2, Math.round(o.size[0] * 2 / 0.115)),
          Math.max(3, Math.round(o.size[1] * 2 / 0.125)));
        gl.bindVertexArray(this.cube.vao);
        gl.drawElements(gl.TRIANGLES, this.cube.count, gl.UNSIGNED_SHORT, 0);
      } else if (o.kind === 'car') {
        var mc = modelTRS(o.pos[0], o.pos[1], o.pos[2], o.rot || 0, o.size[0], o.size[1], o.size[2]);
        GL.um4(gl, p, 'uMVP', M.multiply(M.create(), vp, mc));
        GL.um4(gl, p, 'uModel', mc);
        GL.u3fv(gl, p, 'uColor', o.color);
        GL.u1f(gl, p, 'uAlpha', 1.0);
        GL.u1f(gl, p, 'uEmissive', 0.05);
        GL.u1i(gl, p, 'uStyle', 0);
        GL.u1f(gl, p, 'uSeed', 0);
        GL.u2f(gl, p, 'uWinA', 1, 1);
        GL.u2f(gl, p, 'uWinB', 1, 1);
        gl.bindVertexArray(this.car.vao);
        gl.drawElements(gl.TRIANGLES, this.car.count, gl.UNSIGNED_SHORT, 0);
      } else if (o.kind === 'mound') {
        var mm = modelTRS(o.pos[0], o.pos[1], o.pos[2], 0, o.r, o.r * 0.30, o.r);
        GL.um4(gl, p, 'uMVP', M.multiply(M.create(), vp, mm));
        GL.um4(gl, p, 'uModel', mm);
        GL.u3fv(gl, p, 'uColor', o.color);
        GL.u1f(gl, p, 'uAlpha', 1.0);
        GL.u1f(gl, p, 'uEmissive', 0.05);
        GL.u1i(gl, p, 'uStyle', 0);
        GL.u1f(gl, p, 'uSeed', 0);
        GL.u2f(gl, p, 'uWinA', 1, 1);
        GL.u2f(gl, p, 'uWinB', 1, 1);
        gl.bindVertexArray(this.sphere.vao);
        gl.drawElements(gl.TRIANGLES, this.sphere.count, gl.UNSIGNED_SHORT, 0);
      } else if (o.kind === 'tree') {
        var mt = modelTRS(o.pos[0], o.pos[1], o.pos[2], o.rot || 0, o.size[0], o.size[1], o.size[2]);
        GL.um4(gl, p, 'uMVP', M.multiply(M.create(), vp, mt));
        GL.um4(gl, p, 'uModel', mt);
        GL.u3f(gl, p, 'uColor', 1, 1, 1);
        GL.u1f(gl, p, 'uAlpha', 1.0);
        GL.u1f(gl, p, 'uEmissive', 0.0);
        GL.u1i(gl, p, 'uStyle', 0);
        GL.u1f(gl, p, 'uSeed', 0);
        GL.u2f(gl, p, 'uWinA', 1, 1);
        GL.u2f(gl, p, 'uWinB', 1, 1);
        gl.bindVertexArray(this.tree.vao);
        gl.drawElements(gl.TRIANGLES, this.tree.count, gl.UNSIGNED_SHORT, 0);
      } else if (o.kind === 'house') {
        var mh = modelTRS(o.pos[0], o.pos[1], o.pos[2], o.rot || 0, o.size[0], o.size[1], o.size[2]);
        GL.um4(gl, p, 'uMVP', M.multiply(M.create(), vp, mh));
        GL.um4(gl, p, 'uModel', mh);
        GL.u3f(gl, p, 'uColor', 1, 1, 1);
        GL.u1f(gl, p, 'uAlpha', 1.0);
        GL.u1f(gl, p, 'uEmissive', 0.04);
        GL.u1i(gl, p, 'uStyle', 0);
        GL.u1f(gl, p, 'uSeed', 0);
        GL.u2f(gl, p, 'uWinA', 1, 1);
        GL.u2f(gl, p, 'uWinB', 1, 1);
        gl.bindVertexArray(this.house.vao);
        gl.drawElements(gl.TRIANGLES, this.house.count, gl.UNSIGNED_SHORT, 0);
      } else if (o.kind === 'snowman') {
        var r0 = o.r;
        var parts = [
          [0, -0.62 * r0, 0, 0.86 * r0, [0.97, 0.98, 1.0]],
          [0, 0.20 * r0, 0, 0.60 * r0, [0.96, 0.97, 1.0]],
          [0, 0.86 * r0, 0, 0.42 * r0, [0.98, 0.99, 1.0]]
        ];
        for (var sp2 = 0; sp2 < parts.length; sp2++) {
          var pp = parts[sp2];
          var msp = modelTRS(o.pos[0] + pp[0], o.pos[1] + pp[1], o.pos[2] + pp[2],
            0, pp[3], pp[3], pp[3]);
          GL.um4(gl, p, 'uMVP', M.multiply(M.create(), vp, msp));
          GL.um4(gl, p, 'uModel', msp);
          GL.u3fv(gl, p, 'uColor', pp[4]);
          GL.u1f(gl, p, 'uAlpha', 1.0);
          GL.u1f(gl, p, 'uEmissive', 0.02);
          GL.u1i(gl, p, 'uStyle', 0);
          GL.u1f(gl, p, 'uSeed', 0);
          GL.u2f(gl, p, 'uWinA', 1, 1);
          GL.u2f(gl, p, 'uWinB', 1, 1);
          gl.bindVertexArray(this.sphere.vao);
          gl.drawElements(gl.TRIANGLES, this.sphere.count, gl.UNSIGNED_SHORT, 0);
        }
        // ведро на голове
        var mh2 = modelTRS(o.pos[0], o.pos[1] + 1.22 * r0, o.pos[2], 0.3, 0.30 * r0, 0.22 * r0, 0.30 * r0);
        GL.um4(gl, p, 'uMVP', M.multiply(M.create(), vp, mh2));
        GL.um4(gl, p, 'uModel', mh2);
        GL.u3f(gl, p, 'uColor', 0.16, 0.17, 0.20);
        GL.u1f(gl, p, 'uEmissive', 0.0);
        gl.bindVertexArray(this.cube.vao);
        gl.drawElements(gl.TRIANGLES, this.cube.count, gl.UNSIGNED_SHORT, 0);
      }
    }

    // сыпучие частицы (снег, песок, пыль) — отдельные точки, а не поверхность жидкости
    var hasParticles = false;
    for (var q = 0; q < objs.length && !hasParticles; q++) {
      if (objs[q].kind === 'mound') hasParticles = true;
    }
    if (hasParticles || (sim.sources && sim.sources.some(function (s) {
      return FS.World.TYPES[s.type] && !FS.World.TYPES[s.type].fluid;
    }))) {
      var pp = this.progs.particles;
      gl.useProgram(pp.program);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      GL.bindTex(gl, pp, 'uPos', sim.pos.tex, 0);
      GL.bindTex(gl, pp, 'uType', sim.typeTex, 1);
      GL.bindTex(gl, pp, 'uVel', sim.vel.tex, 2);
      GL.um4(gl, pp, 'uView', cam.view);
      GL.um4(gl, pp, 'uProj', cam.proj);
      GL.u2f(gl, pp, 'uTexSize', sim.TW, sim.TH);
      GL.u1f(gl, pp, 'uRadius', sim.radiusRender);
      GL.u1f(gl, pp, 'uPointScale', H * cam.proj[5]);
      GL.u3fv(gl, pp, 'uColors', flattenColors());
      GL.u1fv(gl, pp, 'uRadScale', radScales());
      GL.u1fv(gl, pp, 'uIsFluid', fluidFlags());
      GL.u1f(gl, pp, 'uPass', 2);
      GL.u1f(gl, pp, 'uAlpha', 0.95);
      gl.bindVertexArray(this.pointsVAO);
      gl.drawArrays(gl.POINTS, 0, sim.N);
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
    }

    // стеклянные стенки
    if (level.kind === 'box') {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      p = this.progs.glass;
      gl.useProgram(p.program);
      GL.um4(gl, p, 'uMVP', M.multiply(M.create(), vp, boxModel));
      GL.um4(gl, p, 'uModel', boxModel);
      GL.u3fv(gl, p, 'uLightDir', this.lightDir);
      GL.u3fv(gl, p, 'uCamPos', cam.eye);
      GL.u1f(gl, p, 'uAlphaScale', 1.0);
      gl.bindVertexArray(this.glass.vao);
      gl.drawElements(gl.TRIANGLES, this.glass.count, gl.UNSIGNED_SHORT, 0);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    } else if (level.kind === 'sphere') {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      p = this.progs.glass;
      gl.useProgram(p.program);
      var sm = modelTRS(level.center[0], level.center[1], level.center[2], 0, level.radius, level.radius, level.radius);
      GL.um4(gl, p, 'uMVP', M.multiply(M.create(), vp, sm));
      GL.um4(gl, p, 'uModel', sm);
      GL.u3fv(gl, p, 'uLightDir', this.lightDir);
      GL.u3fv(gl, p, 'uCamPos', cam.eye);
      GL.u1f(gl, p, 'uAlphaScale', 0.85);
      gl.bindVertexArray(this.sphere.vao);
      gl.drawElements(gl.TRIANGLES, this.sphere.count, gl.UNSIGNED_SHORT, 0);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    // порталы и поля (аддитивно)
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);
    for (var j = 0; j < objs.length; j++) {
      var ob = objs[j];
      if (ob.kind === 'portal') {
        p = this.progs.portal;
        gl.useProgram(p.program);
        var pm = modelFromNormal(ob.pos[0], ob.pos[1], ob.pos[2], ob.normal, ob.r / 0.78);
        GL.um4(gl, p, 'uMVP', M.multiply(M.create(), vp, pm));
        GL.um4(gl, p, 'uModel', pm);
        GL.u3fv(gl, p, 'uColor', ob.color);
        GL.u3fv(gl, p, 'uCamPos', cam.eye);
        GL.u1f(gl, p, 'uTime', this.time);
        gl.bindVertexArray(this.torus.vao);
        gl.drawElements(gl.TRIANGLES, this.torus.count, gl.UNSIGNED_SHORT, 0);
        gl.bindVertexArray(this.disc.vao);
        gl.drawElements(gl.TRIANGLES, this.disc.count, gl.UNSIGNED_SHORT, 0);
      } else if (ob.kind === 'field') {
        p = this.progs.field;
        gl.useProgram(p.program);
        var fm = modelTRS(ob.pos[0], ob.pos[1], ob.pos[2], 0, ob.radius, ob.radius, ob.radius);
        GL.um4(gl, p, 'uMVP', M.multiply(M.create(), vp, fm));
        GL.um4(gl, p, 'uModel', fm);
        GL.u3fv(gl, p, 'uColor', ob.color);
        GL.u3fv(gl, p, 'uCamPos', cam.eye);
        GL.u1f(gl, p, 'uTime', this.time);
        GL.u1f(gl, p, 'uMode', ob.mode === 'attract' ? 1 : (ob.mode === 'accelerate' ? 2 : (ob.mode === 'drag' ? 3 : 0)));
        gl.bindVertexArray(this.sphere.vao);
        gl.drawElements(gl.TRIANGLES, this.sphere.count, gl.UNSIGNED_SHORT, 0);
      }
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    // каркас
    if (level.kind === 'box') {
      p = this.progs.line;
      gl.useProgram(p.program);
      GL.um4(gl, p, 'uMVP', M.multiply(M.create(), vp, boxModel));
      GL.u4f(gl, p, 'uColor', 0.10, 0.30, 0.38, 0.26);
      gl.bindVertexArray(this.lineVAO);
      gl.drawArrays(gl.LINES, 0, this.lineCount);
    }

    // гизмо
    if (gizmo && gizmo.origin) this._drawGizmo(cam, vp, gizmo);

    // маркеры источников
    if (state && state.sources) this._drawSources(cam, vp, state);

    gl.bindVertexArray(null);
  };

  Renderer.prototype._drawSources = function (cam, vp, state) {
    var gl = this.gl;
    var p = this.progs.scene;
    gl.useProgram(p.program);
    GL.u3fv(gl, p, 'uLightDir', this.lightDir);
    GL.u3fv(gl, p, 'uCamPos', cam.eye);
    GL.u1f(gl, p, 'uAlpha', 1.0);
    GL.u1i(gl, p, 'uStyle', 2);
    GL.u1f(gl, p, 'uSeed', 0);
    GL.u1f(gl, p, 'uEmissive', 0.9);

    var cols = FS.TYPE_COLORS;
    for (var i = 0; i < state.sources.length; i++) {
      var s = state.sources[i];
      var c = cols[s.type] || cols[0];
      var dim = s.enabled ? 1 : 0.35;
      var rs = 0.045;
      var mm = modelTRS(s.pos[0], s.pos[1], s.pos[2], 0, rs, rs, rs);
      GL.um4(gl, p, 'uMVP', M.multiply(M.create(), vp, mm));
      GL.um4(gl, p, 'uModel', mm);
      GL.u3f(gl, p, 'uColor', c[0] * dim, c[1] * dim, c[2] * dim);
      gl.bindVertexArray(this.sphere.vao);
      gl.drawElements(gl.TRIANGLES, this.sphere.count, gl.UNSIGNED_SHORT, 0);

      var d = s.dir || [0, -1, 0];
      var l = Math.hypot(d[0], d[1], d[2]) || 1;
      var len = 0.26;
      var buf = new Float32Array([
        s.pos[0], s.pos[1], s.pos[2],
        s.pos[0] + d[0] / l * len, s.pos[1] + d[1] / l * len, s.pos[2] + d[2] / l * len
      ]);
      gl.bindVertexArray(this.gizmoVAO);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.gizmoBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, buf);
      var lp = this.progs.line;
      gl.useProgram(lp.program);
      GL.um4(gl, lp, 'uMVP', vp);
      GL.u4f(gl, lp, 'uColor', c[0] * dim, c[1] * dim, c[2] * dim, 0.9);
      gl.drawArrays(gl.LINES, 0, 2);
      gl.useProgram(p.program);
    }
    GL.u1f(gl, p, 'uEmissive', 0.0);
  };

  Renderer.prototype._drawGizmo = function (cam, vp, gizmo) {
    var gl = this.gl;
    var o = gizmo.origin;
    var L = FS.Gizmo.LEN;
    var p = this.progs.line;
    gl.useProgram(p.program);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    GL.um4(gl, p, 'uMVP', vp);

    var axes = FS.Gizmo.AXES;
    var cols = FS.Gizmo.COLORS;
    for (var i = 0; i < 3; i++) {
      var a = axes[i], c = cols[i];
      var buf = new Float32Array([
        o[0], o[1], o[2],
        o[0] + a[0] * L, o[1] + a[1] * L, o[2] + a[2] * L
      ]);
      gl.bindVertexArray(this.gizmoVAO);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.gizmoBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, buf);
      var hot = (gizmo.hoverAxis === i || gizmo.activeAxis === i);
      GL.u4f(gl, p, 'uColor', c[0], c[1], c[2], hot ? 1.0 : 0.85);
      gl.drawArrays(gl.LINES, 0, 2);
    }

    // наконечники
    p = this.progs.scene;
    gl.useProgram(p.program);
    GL.u3fv(gl, p, 'uLightDir', this.lightDir);
    GL.u3fv(gl, p, 'uCamPos', cam.eye);
    GL.u1f(gl, p, 'uAlpha', 1.0);
    GL.u1i(gl, p, 'uStyle', 2);
    GL.u1f(gl, p, 'uSeed', 0);
    var rs = L * 0.075;
    for (var k = 0; k < 3; k++) {
      var ax = axes[k], cc = cols[k];
      var mm = modelTRS(o[0] + ax[0] * L, o[1] + ax[1] * L, o[2] + ax[2] * L, 0, rs, rs, rs);
      GL.um4(gl, p, 'uMVP', M.multiply(M.create(), vp, mm));
      GL.um4(gl, p, 'uModel', mm);
      GL.u3fv(gl, p, 'uColor', cc);
      GL.u1f(gl, p, 'uEmissive', 1.4);
      gl.bindVertexArray(this.sphere.vao);
      gl.drawElements(gl.TRIANGLES, this.sphere.count, gl.UNSIGNED_SHORT, 0);
    }
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.bindVertexArray(null);
  };

  /* ---------- жидкость ---------- */

  Renderer.prototype.renderFluid = function (cam, sim) {
    var gl = this.gl;
    var W = this.W, H = this.H;

    this._clearColorPass(this.rtFluidDepth.fbo, W, H, 1000.0, 0, 0, 1, true);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    var p = this.progs.pointsDepth;
    gl.useProgram(p.program);
    GL.bindTex(gl, p, 'uPos', sim.pos.tex, 0);
    GL.bindTex(gl, p, 'uType', sim.typeTex, 1);
    GL.bindTex(gl, p, 'uVel', sim.vel.tex, 2);
    GL.um4(gl, p, 'uView', cam.view);
    GL.um4(gl, p, 'uProj', cam.proj);
    GL.u2f(gl, p, 'uTexSize', sim.TW, sim.TH);
    GL.u1f(gl, p, 'uRadius', sim.radiusRender);
    GL.u1f(gl, p, 'uPointScale', H * cam.proj[5]);
    GL.u3fv(gl, p, 'uColors', flattenColors());
    GL.u1fv(gl, p, 'uRadScale', radScales());
    GL.u1fv(gl, p, 'uIsFluid', fluidFlags());
    GL.u1f(gl, p, 'uPass', 1);
    GL.u1f(gl, p, 'uM10', cam.proj[10]);
    GL.u1f(gl, p, 'uM14', cam.proj[14]);
    gl.bindVertexArray(this.pointsVAO);
    gl.drawArrays(gl.POINTS, 0, sim.N);

    this._clearColorPass(this.rtThick.fbo, W, H, 0, 0, 0, 0, false);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    p = this.progs.pointsThick;
    gl.useProgram(p.program);
    GL.bindTex(gl, p, 'uPos', sim.pos.tex, 0);
    GL.bindTex(gl, p, 'uType', sim.typeTex, 1);
    GL.bindTex(gl, p, 'uVel', sim.vel.tex, 2);
    GL.um4(gl, p, 'uView', cam.view);
    GL.um4(gl, p, 'uProj', cam.proj);
    GL.u2f(gl, p, 'uTexSize', sim.TW, sim.TH);
    GL.u1f(gl, p, 'uRadius', sim.radiusRender);
    GL.u1f(gl, p, 'uPointScale', H * cam.proj[5]);
    GL.u3fv(gl, p, 'uColors', flattenColors());
    GL.u1fv(gl, p, 'uRadScale', radScales());
    GL.u1fv(gl, p, 'uIsFluid', fluidFlags());
    GL.u1f(gl, p, 'uPass', 1);
    gl.drawArrays(gl.POINTS, 0, sim.N);

    gl.disable(gl.BLEND);

    var bl = this.progs.blur;
    gl.useProgram(bl.program);
    gl.disable(gl.DEPTH_TEST);

    var prPx = sim.radiusRender * (H * cam.proj[5]) / Math.max(0.5, cam.dist);
    var blurPx = Math.min(150, Math.max(3, prPx * 2.6));
    var blurTh = Math.min(90, Math.max(2, prPx * 1.05));
    var depthEps = 1.6;

    this._fullscreen(this.rtBlurA.fbo, W, H);
    GL.bindTex(gl, bl, 'uSrc', this.rtFluidDepth.tex, 0);
    GL.u2f(gl, bl, 'uRes', W, H);
    GL.u2f(gl, bl, 'uDir', blurPx / (20 * W), 0);
    GL.u1f(gl, bl, 'uPx', depthEps);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this._fullscreen(this.rtBlurB.fbo, W, H);
    GL.bindTex(gl, bl, 'uSrc', this.rtBlurA.tex, 0);
    GL.u2f(gl, bl, 'uRes', W, H);
    GL.u2f(gl, bl, 'uDir', 0, blurPx / (20 * H));
    GL.u1f(gl, bl, 'uPx', depthEps);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // второй проход — сглаживает шум разреженной выборки
    this._fullscreen(this.rtBlurA.fbo, W, H);
    GL.bindTex(gl, bl, 'uSrc', this.rtBlurB.tex, 0);
    GL.u2f(gl, bl, 'uRes', W, H);
    GL.u2f(gl, bl, 'uDir', blurPx / (20 * W), 0);
    GL.u1f(gl, bl, 'uPx', depthEps);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this._fullscreen(this.rtBlurB.fbo, W, H);
    GL.bindTex(gl, bl, 'uSrc', this.rtBlurA.tex, 0);
    GL.u2f(gl, bl, 'uRes', W, H);
    GL.u2f(gl, bl, 'uDir', 0, blurPx / (20 * H));
    GL.u1f(gl, bl, 'uPx', depthEps);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // размытие толщины и цвета
    var b4 = this.progs.blur4;
    gl.useProgram(b4.program);
    this._fullscreen(this.rtBlurA.fbo, W, H);
    GL.bindTex(gl, b4, 'uSrc', this.rtThick.tex, 0);
    GL.u2f(gl, b4, 'uRes', W, H);
    GL.u2f(gl, b4, 'uDir', blurTh / (20 * W), 0);
    GL.u1f(gl, b4, 'uPx', 1.0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this._fullscreen(this.rtThickB.fbo, W, H);
    GL.bindTex(gl, b4, 'uSrc', this.rtBlurA.tex, 0);
    GL.u2f(gl, b4, 'uRes', W, H);
    GL.u2f(gl, b4, 'uDir', 0, blurTh / (20 * H));
    GL.u1f(gl, b4, 'uPx', 1.0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    var f = this.progs.fluid;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(f.program);
    GL.bindTex(gl, f, 'uScene', this.rtScene.tex, 0);
    GL.bindTex(gl, f, 'uSceneDepth', this.rtScene.depth, 1);
    GL.bindTex(gl, f, 'uBlur', this.rtBlurB.tex, 2);
    GL.bindTex(gl, f, 'uThick', this.rtThickB.tex, 3);
    GL.u2f(gl, f, 'uRes', W, H);
    GL.u1f(gl, f, 'uNear', cam.near);
    GL.u1f(gl, f, 'uFar', cam.far);
    GL.u1f(gl, f, 'uTanHalf', cam.tanHalf);
    GL.u1f(gl, f, 'uAspect', cam.aspect);
    GL.u3fv(gl, f, 'uLightDirView', cam.lightDirView);
    GL.u1f(gl, f, 'uThickScale', this.thickScale);
    GL.u1f(gl, f, 'uRefract', this.refract);
    GL.u1f(gl, f, 'uAbsorb', this.absorb);
    GL.u1f(gl, f, 'uOpacity', this.opacity);
    GL.u1f(gl, f, 'uDbg', this.debugDepth ? 1.0 : 0.0);
    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindVertexArray(null);
  };

  var _fluidBuf = new Float32Array(8);
  function fluidFlags() {
    var T = FS.World.TYPES;
    for (var i = 0; i < 8; i++) _fluidBuf[i] = (T[i] && T[i].fluid) ? 1 : 0;
    return _fluidBuf;
  }

  var _radBuf = new Float32Array(8);
  function radScales() {
    var T = FS.World.TYPES;
    for (var i = 0; i < 8; i++) {
      var t = T[i];
      _radBuf[i] = t ? (t.rad || (t.fluid ? 1.0 : 0.32)) : 0;
    }
    return _radBuf;
  }

  var _colorBuf = new Float32Array(24);
  function flattenColors() {
    var c = FS.TYPE_COLORS;
    for (var i = 0; i < 8; i++) {
      var v = c[i] || [0.5, 0.5, 0.5];
      _colorBuf[i * 3] = v[0];
      _colorBuf[i * 3 + 1] = v[1];
      _colorBuf[i * 3 + 2] = v[2];
    }
    return _colorBuf;
  }

  FS.Renderer = Renderer;
})();
