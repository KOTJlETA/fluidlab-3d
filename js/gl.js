/* FluidLab 3D — обёртки над WebGL2 */
(function () {
  'use strict';
  var FS = (window.FS = window.FS || {});

  var GL = {};

  GL.compile = function (gl, type, src, label) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(s);
      var lines = src.split('\n').map(function (l, i) { return (i + 1) + ': ' + l; }).join('\n');
      console.error('[shader ' + label + '] ' + log + '\n' + lines);
      throw new Error('Shader compile error (' + label + '): ' + log);
    }
    return s;
  };

  GL.program = function (gl, vsSrc, fsSrc, label) {
    var p = gl.createProgram();
    gl.attachShader(p, GL.compile(gl, gl.VERTEX_SHADER, vsSrc, label + '.vs'));
    gl.attachShader(p, GL.compile(gl, gl.FRAGMENT_SHADER, fsSrc, label + '.fs'));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      var log = gl.getProgramInfoLog(p);
      console.error('[link ' + label + '] ' + log);
      throw new Error('Program link error (' + label + '): ' + log);
    }
    var n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    var u = {};
    for (var i = 0; i < n; i++) {
      var info = gl.getActiveUniform(p, i);
      var name = info.name.replace(/\[0\]$/, '');
      u[name] = gl.getUniformLocation(p, info.name);
    }
    return { program: p, u: u, label: label };
  };

  GL.texture = function (gl, w, h, internalFormat, format, type, data, filter) {
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, data || null);
    var f = filter || gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return t;
  };

  GL.fbo = function (gl, textures, depth) {
    var f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    for (var i = 0; i < textures.length; i++) {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, textures[i], 0);
    }
    if (textures.length > 1) {
      var bufs = [];
      for (var j = 0; j < textures.length; j++) bufs.push(gl.COLOR_ATTACHMENT0 + j);
      gl.drawBuffers(bufs);
    }
    if (depth) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    var st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) console.warn('FBO incomplete: 0x' + st.toString(16));
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return f;
  };

  GL.renderbuffer = function (gl, w, h, fmt) {
    var r = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, r);
    gl.renderbufferStorage(gl.RENDERBUFFER, fmt, w, h);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    return r;
  };

  GL.fullscreenVAO = function (gl) {
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return vao;
  };

  GL.emptyVAO = function (gl) {
    var vao = gl.createVertexArray();
    return vao;
  };

  GL.bindTex = function (gl, prog, name, tex, unit) {
    var loc = prog.u[name];
    if (loc === undefined || loc === null) return;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  };

  GL.u1f = function (gl, p, n, v) { var l = p.u[n]; if (l != null) gl.uniform1f(l, v); };
  GL.u1i = function (gl, p, n, v) { var l = p.u[n]; if (l != null) gl.uniform1i(l, v); };
  GL.u2f = function (gl, p, n, a, b) { var l = p.u[n]; if (l != null) gl.uniform2f(l, a, b); };
  GL.u3f = function (gl, p, n, a, b, c) { var l = p.u[n]; if (l != null) gl.uniform3f(l, a, b, c); };
  GL.u4f = function (gl, p, n, a, b, c, d) { var l = p.u[n]; if (l != null) gl.uniform4f(l, a, b, c, d); };
  GL.u4fv = function (gl, p, n, arr) { var l = p.u[n]; if (l != null) gl.uniform4fv(l, arr); };
  GL.u1fv = function (gl, p, n, arr) { var l = p.u[n]; if (l != null) gl.uniform1fv(l, arr); };
  GL.u3fv = function (gl, p, n, arr) { var l = p.u[n]; if (l != null) gl.uniform3fv(l, arr); };
  GL.um4 = function (gl, p, n, m) { var l = p.u[n]; if (l != null) gl.uniformMatrix4fv(l, false, m); };

  FS.GL = GL;
})();
