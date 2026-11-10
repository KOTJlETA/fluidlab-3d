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
      blur: GL.program(gl, FS.SH.fullscreenVS, FS.SH.blurFS, 'blur'),
      blur4: GL.program(gl, FS.SH.fullscreenVS, FS.SH.blur4FS, 'blur4'),
      fluid: GL.program(gl, FS.SH.fullscreenVS, FS.SH.fluidFS, 'fluid'),
      glass: GL.program(gl, FS.SH.sceneVS, FS.SH.glassFS, 'glass'),
      field: GL.program(gl, FS.SH.sceneVS, FS.SH.fieldFS, 'field'),
      portal: GL.program(gl, FS.SH.sceneVS, FS.SH.portalFS, 'portal'),
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
    this.sphere = this._uploadMesh(meshData(pos, nor, null, new Uint16Array(idx)));

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
    this.tree = this._uploadMesh(meshData(pt, nt, ct, new Uint16Array(it)));

    // деревянный домик: сруб + двускатная крыша
    var ph = [], nh = [], ch = [], ih = [];
    pushBox(ph, nh, ch, ih, 0, -0.45, 0, 0.86, 0.55, 0.86, [0.62, 0.44, 0.26]);
    pushBox(ph, nh, ch, ih, 0, -0.36, 0.87, 0.16, 0.36, 0.02, [0.30, 0.20, 0.12]);
    pushBox(ph, nh, ch, ih, 0, -0.02, 0.87, 0.13, 0.13, 0.02, [0.98, 0.85, 0.45]);
    pushPrism(ph, nh, ch, ih, 0.98, 0.98, 0.10, 0.92, [0.72, 0.22, 0.18]);
    this.house = this._uploadMesh(meshData(ph, nh, ch, new Uint16Array(ih)));

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
      GL.u1f(gl, p, 'uBlock', level.city ? (level.half * 2) / level.cityN : 1.0);
      gl.bindVertexArray(this.plane.vao);
      gl.drawElements(gl.TRIANGLES, this.plane.count, gl.UNSIGNED_SHORT, 0);
    }

    // объекты
    p = this.progs.scene;
    gl.useProgram(p.program);
    GL.u3fv(gl, p, 'uLightDir', this.lightDir);
    GL.u3fv(gl, p, 'uCamPos', cam.eye);

    var objs = sim.objects;
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

    // второй проход размытия — сглаживает шум разреженной выборки
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

    // размытие толщины/цвета — иначе жидкость распадается на отдельные шарики
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
