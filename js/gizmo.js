/* FluidLab 3D — выбор объектов мышью и гизмо из трёх осей */
(function () {
  'use strict';
  var FS = (window.FS = window.FS || {});
  var G = (FS.Gizmo = {});

  G.AXES = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  G.COLORS = [[1.0, 0.32, 0.34], [0.38, 1.0, 0.45], [0.36, 0.62, 1.0]];
  G.LEN = 0.42;
  G.HANDLE = 0.045;

  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function len(a) { return Math.hypot(a[0], a[1], a[2]); }
  function norm(a) { var l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

  G.raySphere = function (ro, rd, c, r) {
    var oc = sub(ro, c);
    var b = dot(oc, rd);
    var cc = dot(oc, oc) - r * r;
    var disc = b * b - cc;
    if (disc < 0) return -1;
    var sq = Math.sqrt(disc);
    var t1 = -b - sq, t2 = -b + sq;
    if (t1 > 0) return t1;
    if (t2 > 0) return t2;
    return -1;
  };

  // луч против повёрнутой вокруг Y коробки
  G.rayBox = function (ro, rd, c, half, rot) {
    var ca = Math.cos(-rot), sa = Math.sin(-rot);
    var ox = ro[0] - c[0], oy = ro[1] - c[1], oz = ro[2] - c[2];
    var lo = [ox * ca - oz * sa, oy, ox * sa + oz * ca];
    var ld = [rd[0] * ca - rd[2] * sa, rd[1], rd[0] * sa + rd[2] * ca];
    var tmin = -1e9, tmax = 1e9;
    for (var i = 0; i < 3; i++) {
      var o = lo[i], d = ld[i], h = half[i];
      if (Math.abs(d) < 1e-8) {
        if (o < -h || o > h) return -1;
      } else {
        var t1 = (-h - o) / d, t2 = (h - o) / d;
        if (t1 > t2) { var tt = t1; t1 = t2; t2 = tt; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return -1;
      }
    }
    if (tmin > 0) return tmin;
    if (tmax > 0) return tmax;
    return -1;
  };

  G.hitTest = function (ro, rd, o) {
    if (o.kind === 'sphere') return G.raySphere(ro, rd, o.pos, o.r);
    if (o.kind === 'building' || o.kind === 'car') return G.rayBox(ro, rd, o.pos, o.size, o.rot || 0);
    if (o.kind === 'portal') return G.raySphere(ro, rd, o.pos, o.r * 1.1);
    if (o.kind === 'field') return G.raySphere(ro, rd, o.pos, Math.min(0.16, o.radius * 0.5));
    return -1;
  };

  G.pickObject = function (ro, rd, objects) {
    var best = null, bestT = 1e9;
    for (var i = 0; i < objects.length; i++) {
      var t = G.hitTest(ro, rd, objects[i]);
      if (t > 0 && t < bestT) { bestT = t; best = objects[i]; }
    }
    return best;
  };

  // расстояние между лучом и отрезком [a, a+dir*len]
  G.raySegment = function (ro, rd, a, dir, length) {
    var b = [a[0] + dir[0] * length, a[1] + dir[1] * length, a[2] + dir[2] * length];
    var u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    var w0 = [ro[0] - a[0], ro[1] - a[1], ro[2] - a[2]];
    var A = dot(rd, rd), B = dot(rd, u), C = dot(u, u);
    var D = dot(rd, w0), E = dot(u, w0);
    var den = A * C - B * B;
    var sc, tc;
    if (Math.abs(den) < 1e-9) {
      sc = 0;
      tc = (C > 1e-9) ? E / C : 0;
    } else {
      sc = (B * E - C * D) / den;
      tc = (A * E - B * D) / den;
    }
    if (sc < 0) sc = 0;
    if (tc < 0) tc = 0; else if (tc > 1) tc = 1;
    var p1 = [ro[0] + rd[0] * sc, ro[1] + rd[1] * sc, ro[2] + rd[2] * sc];
    var p2 = [a[0] + u[0] * tc, a[1] + u[1] * tc, a[2] + u[2] * tc];
    return { dist: len(sub(p1, p2)), t: tc };
  };

  G.pickAxis = function (ro, rd, origin) {
    var best = -1, bestD = G.HANDLE;
    for (var i = 0; i < 3; i++) {
      var r = G.raySegment(ro, rd, origin, G.AXES[i], G.LEN);
      if (r.dist < bestD) { bestD = r.dist; best = i; }
    }
    return best;
  };

  // параметр вдоль оси, ближайший к лучу
  G.axisParam = function (ro, rd, origin, axis) {
    var u = axis;
    var w0 = [ro[0] - origin[0], ro[1] - origin[1], ro[2] - origin[2]];
    var A = dot(rd, rd), B = dot(rd, u), C = dot(u, u);
    var D = dot(rd, w0), E = dot(u, w0);
    var den = A * C - B * B;
    if (Math.abs(den) < 1e-9) return 0;
    var sc = (B * E - C * D) / den;
    var tc = (A * E - B * D) / den;
    return tc;
  };

  G.norm = norm;
  G.dot = dot;
  G.len = len;
})();
