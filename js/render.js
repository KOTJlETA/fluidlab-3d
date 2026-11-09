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
    [0.22, 0.88, 0.40]
  ];

  function Renderer(gl, canvas) {
    this.gl = gl;
    this.canvas = canvas;
    this.W = 1; this.H = 1;
    this.lightDir = [0.45, 0.82, 0.36];
    var l = Math.hypot(this.lightDir[0], this.lightDir[1], this.lightDir[2]);
    this.lightDir = [this.lightDir[0] / l, this.lightDir[1] / l, this.lightDir[2] / l];

    this.thickScale = 1.0;
    this.refract = 0.06;
    this.absorb = 1.5;
    this.opacity = 0.70;

    this.progs = {
      scene: GL.program(gl, FS.SH.sceneVS, FS.SH.sceneFS, 'scene'),
      sky: GL.program(gl, FS.SH.skyVS, FS.SH.skyFS, 'sky'),
      floor: GL.program(gl, FS.SH.sceneVS, FS.SH.floorFS, 'floor'),
      line: GL.program(gl, FS.SH.lineVS, FS.SH.lineFS, 'line'),
      pointsDepth: GL.program(gl, FS.SH.pointsVS, FS.SH.pointsDepthFS, 'pointsDepth'),
      pointsThick: GL.program(gl, FS.SH.pointsVS, FS.SH.pointsThickFS, 'pointsThick'),
      blur: GL.program(gl, FS.SH.fullscreenVS, FS.SH.blurFS, 'blur'),
      fluid: GL.program(gl, FS.SH.fullscreenVS, FS.SH.fluidFS, 'fluid'),
      glass: GL.program(gl, FS.SH.sceneVS, FS.SH.glassFS, 'glass'),
      clear: GL.program(gl, FS.SH.fullscreenVS, FS.SH.clearFS, 'clear')
    };

    this.quadVAO = GL.fullscreenVAO(gl);
    this.pointsVAO = GL.emptyVAO(gl);
    this._buildGeometry();
    this._initTargets(1, 1);
  }

  /* ---------- геометрия ---------- */

  function meshData(positions, normals, indices) {
    var n = positions.length / 3;
    var inter = new Float32Array(n * 6);
    for (var i = 0; i < n; i++) {
      inter[i * 6] = positions[i * 3];
      inter[i * 6 + 1] = positions[i * 3 + 1];
      inter[i * 6 + 2] = positions[i * 3 + 2];
      inter[i * 6 + 3] = normals[i * 3];
      inter[i * 6 + 4] = normals[i * 3 + 1];
      inter[i * 6 + 5] = normals[i * 3 + 2];
    }
    return { inter: inter, indices: indices || null };
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
    this.sphere = this._uploadMesh(meshData(pos, nor, new Uint16Array(idx)));

    // куб (единичный, -1..1)
    var p2 = [], n2 = [], i2 = [];
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
      var base = p2.length / 3;
      var corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      corners.forEach(function (c) {
        var px = n[0] + t[0] * c[0] + b[0] * c[1];
        var py = n[1] + t[1] * c[0] + b[1] * c[1];
        var pz = n[2] + t[2] * c[0] + b[2] * c[1];
        p2.push(px, py, pz);
        n2.push(n[0], n[1], n[2]);
      });
      i2.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
    this.cube = this._uploadMesh(meshData(p2, n2, new Uint16Array(i2)));

    // плоскость
    var s = 12;
    this.plane = this._uploadMesh(meshData(
      [-s, 0, -s, s, 0, -s, s, 0, s, -s, 0, s],
      [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
      new Uint16Array([0, 2, 1, 0, 3, 2])
    ));

    // рамка резервуара: только верхний обрез + уголки
    var bx = 1.0, bz = 1.0, y0 = -1.0, y1 = 0.9;
    var lp = [];
    function edge(a, b) { lp.push(a[0], a[1], a[2], b[0], b[1], b[2]); }
    var t = [[-bx, y1, -bz], [bx, y1, -bz], [bx, y1, bz], [-bx, y1, bz]];
    for (var i = 0; i < 4; i++) {
      edge(t[i], t[(i + 1) % 4]);
      edge([t[i][0], y1 - 0.12, t[i][2]], t[i]);
    }
    var c = [[-bx, y0, -bz], [bx, y0, -bz], [bx, y0, bz], [-bx, y0, bz]];
    for (var j = 0; j < 4; j++) edge(c[j], c[(j + 1) % 4]);
    this.lineVAO = gl.createVertexArray();
    gl.bindVertexArray(this.lineVAO);
    var lbuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, lbuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lp), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.lineCount = lp.length / 3;

    // стеклянные стенки резервуара
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
      for (var k = 0; k < 4; k++) gn.push(w.n[0], w.n[1], w.n[2]);
      gi.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
    this.glass = this._uploadMesh(meshData(gp, gn, new Uint16Array(gi)));
  };

  Renderer.prototype._uploadMesh = function (data) {
    var gl = this.gl;
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    var vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, data.inter, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    var ib = null;
    if (data.indices) {
      ib = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW);
    }
    gl.bindVertexArray(null);
    return { vao: vao, count: data.indices ? data.indices.length : data.inter.length / 6, ib: ib };
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
    var fdDepth = GL.renderbuffer(gl, w, h, gl.DEPTH_COMPONENT16);
    this.rtFluidDepth = { tex: fdTex, fbo: GL.fbo(gl, [fdTex], fdDepth) };

    var thTex = GL.texture(gl, w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, null, gl.NEAREST);
    this.rtThick = { tex: thTex, fbo: GL.fbo(gl, [thTex], null) };

    this.rtBlurA = { tex: GL.texture(gl, w, h, gl.RGBA32F, gl.RGBA, gl.FLOAT, null, gl.NEAREST) };
    this.rtBlurA.fbo = GL.fbo(gl, [this.rtBlurA.tex], null);
    this.rtBlurB = { tex: GL.texture(gl, w, h, gl.RGBA32F, gl.RGBA, gl.FLOAT, null, gl.NEAREST) };
    this.rtBlurB.fbo = GL.fbo(gl, [this.rtBlurB.tex], null);
  };

  Renderer.prototype._destroyTargets = function () {
    var gl = this.gl;
    var list = [this.rtScene, this.rtFluidDepth, this.rtThick, this.rtBlurA, this.rtBlurB];
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

  Renderer.prototype.renderScene = function (cam, sim) {
    var gl = this.gl;
    var W = this.W, H = this.H;

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
    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // пол
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    p = this.progs.floor;
    gl.useProgram(p.program);
    var model = M.translation(M.create(), 0, sim.boxMin[1], 0);
    var mvp = M.multiply(M.create(), cam.proj, cam.view);
    mvp = M.multiply(M.create(), mvp, model);
    GL.um4(gl, p, 'uMVP', mvp);
    GL.um4(gl, p, 'uModel', model);
    GL.u3fv(gl, p, 'uLightDir', this.lightDir);
    GL.u3fv(gl, p, 'uCamPos', cam.eye);
    gl.bindVertexArray(this.plane.vao);
    gl.drawElements(gl.TRIANGLES, this.plane.count, gl.UNSIGNED_SHORT, 0);

    // препятствия
    p = this.progs.scene;
    gl.useProgram(p.program);
    GL.u3fv(gl, p, 'uLightDir', this.lightDir);
    GL.u3fv(gl, p, 'uCamPos', cam.eye);

    var self = this;
    sim.obstacles.sph.forEach(function (o) {
      var m = M.translation(M.create(), o.c[0], o.c[1], o.c[2]);
      m = M.multiply(M.create(), m, M.scaling(M.create(), o.r, o.r, o.r));
      var mm = M.multiply(M.create(), cam.proj, cam.view);
      mm = M.multiply(M.create(), mm, m);
      GL.um4(gl, p, 'uMVP', mm);
      GL.um4(gl, p, 'uModel', m);
      GL.u3fv(gl, p, 'uColor', o.color || [0.35, 0.40, 0.46]);
      GL.u1f(gl, p, 'uAlpha', 1.0);
      GL.u1f(gl, p, 'uEmissive', 0.0);
      gl.bindVertexArray(self.sphere.vao);
      gl.drawElements(gl.TRIANGLES, self.sphere.count, gl.UNSIGNED_SHORT, 0);
    });

    sim.obstacles.box.forEach(function (o) {
      var m = M.translation(M.create(), o.c[0], o.c[1], o.c[2]);
      m = M.multiply(M.create(), m, M.scaling(M.create(), o.h[0], o.h[1], o.h[2]));
      var mm = M.multiply(M.create(), cam.proj, cam.view);
      mm = M.multiply(M.create(), mm, m);
      GL.um4(gl, p, 'uMVP', mm);
      GL.um4(gl, p, 'uModel', m);
      GL.u3fv(gl, p, 'uColor', o.color || [0.30, 0.34, 0.40]);
      GL.u1f(gl, p, 'uAlpha', 1.0);
      GL.u1f(gl, p, 'uEmissive', 0.0);
      gl.bindVertexArray(self.cube.vao);
      gl.drawElements(gl.TRIANGLES, self.cube.count, gl.UNSIGNED_SHORT, 0);
    });

    // стеклянные стенки
    if (this.glass) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      p = this.progs.glass;
      gl.useProgram(p.program);
      GL.um4(gl, p, 'uMVP', M.multiply(M.create(), cam.proj, cam.view));
      GL.um4(gl, p, 'uModel', M.identity(M.create()));
      GL.u3fv(gl, p, 'uLightDir', this.lightDir);
      GL.u3fv(gl, p, 'uCamPos', cam.eye);
      gl.bindVertexArray(this.glass.vao);
      gl.drawElements(gl.TRIANGLES, this.glass.count, gl.UNSIGNED_SHORT, 0);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    // каркас
    p = this.progs.line;
    gl.useProgram(p.program);
    GL.um4(gl, p, 'uMVP', M.multiply(M.create(), cam.proj, cam.view));
    GL.u4f(gl, p, 'uColor', 0.10, 0.30, 0.38, 0.30);
    gl.bindVertexArray(this.lineVAO);
    gl.drawArrays(gl.LINES, 0, this.lineCount);

    gl.bindVertexArray(null);
  };

  /* ---------- жидкость ---------- */

  Renderer.prototype.renderFluid = function (cam, sim) {
    var gl = this.gl;
    var W = this.W, H = this.H;

    // 1. карта глубины частиц
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
    GL.u4fv(gl, p, 'uColors', flattenColors());
    GL.u1f(gl, p, 'uM10', cam.proj[10]);
    GL.u1f(gl, p, 'uM14', cam.proj[14]);
    gl.bindVertexArray(this.pointsVAO);
    gl.drawArrays(gl.POINTS, 0, sim.N);

    // 2. толщина + цвет
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
    GL.u4fv(gl, p, 'uColors', flattenColors());
    gl.drawArrays(gl.POINTS, 0, sim.N);

    gl.disable(gl.BLEND);

    // 3. размытие глубины (радиус привязан к экранному размеру частицы)
    var bl = this.progs.blur;
    gl.useProgram(bl.program);
    gl.disable(gl.DEPTH_TEST);

    var prPx = sim.radiusRender * (H * cam.proj[5]) / Math.max(0.5, cam.dist);
    var blurPx = Math.min(64, Math.max(2, prPx * 1.35));
    var depthEps = 4.0;

    this._fullscreen(this.rtBlurA.fbo, W, H);
    GL.bindTex(gl, bl, 'uSrc', this.rtFluidDepth.tex, 0);
    GL.u2f(gl, bl, 'uRes', W, H);
    GL.u2f(gl, bl, 'uDir', blurPx / (12 * W), 0);
    GL.u1f(gl, bl, 'uPx', depthEps);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this._fullscreen(this.rtBlurB.fbo, W, H);
    GL.bindTex(gl, bl, 'uSrc', this.rtBlurA.tex, 0);
    GL.u2f(gl, bl, 'uRes', W, H);
    GL.u2f(gl, bl, 'uDir', 0, blurPx / (12 * H));
    GL.u1f(gl, bl, 'uPx', depthEps);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 4. композит
    var f = this.progs.fluid;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(f.program);
    GL.bindTex(gl, f, 'uScene', this.rtScene.tex, 0);
    GL.bindTex(gl, f, 'uSceneDepth', this.rtScene.depth, 1);
    GL.bindTex(gl, f, 'uBlur', this.rtBlurB.tex, 2);
    GL.bindTex(gl, f, 'uThick', this.rtThick.tex, 3);
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
    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindVertexArray(null);
  };

  var _colorBuf = new Float32Array(16);
  function flattenColors() {
    var c = FS.TYPE_COLORS;
    for (var i = 0; i < 4; i++) {
      _colorBuf[i * 4] = c[i][0];
      _colorBuf[i * 4 + 1] = c[i][1];
      _colorBuf[i * 4 + 2] = c[i][2];
      _colorBuf[i * 4 + 3] = 1;
    }
    return _colorBuf;
  }

  FS.Renderer = Renderer;
})();
