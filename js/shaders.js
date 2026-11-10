/* FluidLab 3D — все GLSL-программы */
(function () {
  'use strict';
  var FS = (window.FS = window.FS || {});
  var SH = (FS.SH = {});

  SH.fullscreenVS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

  /* ---------- общие куски ---------- */

  SH.kernel = `
uniform float uH;
uniform float uH2;
uniform float uPoly6;   // 315/(64*pi*h^9)
uniform float uSpikyK;  // 45/(pi*h^6)

float poly6(float r2) {
  float d = uH2 - r2;
  return uPoly6 * d * d * d;
}
float spikyMag(float r) {
  float d = uH - r;
  return -uSpikyK * d * d;
}
`;

  SH.collision = `
uniform int uLevelKind;      // 0 = коробка, 1 = сфера, 2 = без границ
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform float uWallTop;
uniform vec3 uSphereC;
uniform float uSphereR;
uniform float uPRadius;

uniform float uConeOn;
uniform vec3 uConeC;
uniform float uConeR0;
uniform float uConeR1;
uniform float uConeH;

uniform vec4 uSph[16];
uniform int uSphCount;
uniform vec4 uObsBox[40];    // xyz центр, w = поворот вокруг Y
uniform vec3 uObsBoxHalf[40];
uniform int uObsBoxCount;

vec3 pushOut(vec3 p, out vec3 nrm) {
  nrm = vec3(0.0);
  float r = uPRadius;

  if (uLevelKind == 0) {
    if (p.y < uBoxMin.y + r) { p.y = uBoxMin.y + r; nrm = vec3(0.0, 1.0, 0.0); }
    if (p.y < uWallTop) {
      if (p.x < uBoxMin.x + r)      { p.x = uBoxMin.x + r;      nrm = vec3(1.0, 0.0, 0.0); }
      else if (p.x > uBoxMax.x - r) { p.x = uBoxMax.x - r;      nrm = vec3(-1.0, 0.0, 0.0); }
      if (p.z < uBoxMin.z + r)      { p.z = uBoxMin.z + r;      nrm = vec3(0.0, 0.0, 1.0); }
      else if (p.z > uBoxMax.z - r) { p.z = uBoxMax.z - r;      nrm = vec3(0.0, 0.0, -1.0); }
    }
  } else if (uLevelKind == 1) {
    vec3 d = p - uSphereC;
    float L = length(d);
    float lim = uSphereR - r;
    if (L > lim && L > 1e-5) {
      nrm = -d / L;
      p = uSphereC + d / L * lim;
    }
  } else {
    if (p.y < uBoxMin.y + r) { p.y = uBoxMin.y + r; nrm = vec3(0.0, 1.0, 0.0); }
  }

  // усечённый конус (вулкан): частица скользит по внешней поверхности,
  // сверху жерло открыто — туда можно упасть
  if (uConeOn > 0.5) {
    vec3 q = p - uConeC;
    if (q.y < uConeH && q.y > -0.35 * uConeH) {
      float t = clamp(q.y / uConeH, 0.0, 1.0);
      float rad = mix(uConeR0, uConeR1, t) + r;
      float rho = length(q.xz);
      if (rho < rad && rho > uConeR1 * 0.9) {
        vec2 dir = rho > 1e-4 ? q.xz / rho : vec2(1.0, 0.0);
        p.xz = uConeC.xz + dir * rad;
        nrm = normalize(vec3(dir.x, 0.35, dir.y));
      }
    }
    if (q.y < 0.0 && q.y > -0.35 * uConeH) {
      float rho2 = length(q.xz);
      if (rho2 < uConeR0) {
        p.y = uConeC.y;
        nrm = vec3(0.0, 1.0, 0.0);
      }
    }
  }

  for (int i = 0; i < uSphCount; i++) {
    vec3 d = p - uSph[i].xyz;
    float L = length(d);
    float rr = uSph[i].w + r;
    if (L < rr && L > 1e-5) { nrm = d / L; p = uSph[i].xyz + nrm * rr; }
  }

  for (int i = 0; i < uObsBoxCount; i++) {
    vec3 c = uObsBox[i].xyz;
    float a = uObsBox[i].w;
    vec3 h = uObsBoxHalf[i] + r;
    vec3 d = p - c;
    float ca = cos(a), sa = sin(a);
    vec3 lp = vec3(d.x * ca - d.z * sa, d.y, d.x * sa + d.z * ca);
    vec3 ad = abs(lp) - h;
    if (max(ad.x, max(ad.y, ad.z)) < 0.0) {
      if (ad.x >= ad.y && ad.x >= ad.z) {
        float s = lp.x >= 0.0 ? 1.0 : -1.0;
        lp.x = s * h.x;
        nrm = vec3(s * ca, 0.0, -s * sa);
      } else if (ad.y >= ad.z) {
        float s = lp.y >= 0.0 ? 1.0 : -1.0;
        lp.y = s * h.y;
        nrm = vec3(0.0, s, 0.0);
      } else {
        float s = lp.z >= 0.0 ? 1.0 : -1.0;
        lp.z = s * h.z;
        nrm = vec3(s * sa, 0.0, s * ca);
      }
      p = c + vec3(lp.x * ca + lp.z * sa, lp.y, -lp.x * sa + lp.z * ca);
    }
  }
  return p;
}
`;

  SH.gridDecl = `
uniform sampler2D uGridStart;
uniform sampler2D uGridIdx;
uniform vec3 uGridMin;
uniform vec3 uGridDim;
uniform float uCellSize;
uniform int uGX;
uniform int uGY;
uniform int uGZ;
uniform int uTW;
`;

  /* ---------- 1. предсказание положения ---------- */

  SH.predictFS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uPos;
uniform sampler2D uVel;
uniform sampler2D uType;
uniform vec2 uTexSize;
uniform float uDt;
uniform float uMaxSpeed;
uniform vec3 uGravity;
uniform float uBuoy[8];
uniform float uGravScale[8];
uniform float uDragK[8];
uniform float uIsFluid[8];
uniform float uTime;
uniform vec4 uMouse;
uniform vec3 uMouseForce;
uniform float uVortex;

uniform vec4 uField[8];
uniform vec4 uFieldP[8];
uniform vec4 uFieldDir[8];
uniform int uFieldCount;

uniform vec4 uPortalA[4];
uniform vec4 uPortalB[4];
uniform vec4 uPortalAn[4];
uniform vec4 uPortalBn[4];
uniform int uPortalCount;

out vec4 oPos;

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 P = texelFetch(uPos, c, 0);
  vec4 V = texelFetch(uVel, c, 0);
  if (P.y < -500.0) { oPos = vec4(P.xyz, 0.0); return; }

  int t = int(texelFetch(uType, c, 0).x + 0.5);
  float buoy = uBuoy[t];
  bool fluid = uIsFluid[t] > 0.5;

  vec3 v = V.xyz + (uGravity * uGravScale[t] + vec3(0.0, buoy, 0.0)) * uDt;

  if (!fluid) {
    // сыпучая частица: вязкое трение + лёгкое «порхание»
    float dk = uDragK[t];
    v *= 1.0 / (1.0 + dk * uDt);
    float ph = P.x * 3.1 + P.z * 2.3 + uTime * 1.7 + P.y * 0.7;
    v.x += sin(ph) * 0.55 * uGravScale[t] * uDt * 3.0;
    v.z += cos(ph * 1.31 + 1.7) * 0.55 * uGravScale[t] * uDt * 3.0;
  }

  if (uMouse.w > 0.0) {
    vec3 d = P.xyz - uMouse.xyz;
    float f = exp(-dot(d, d) / (uMouse.w * uMouse.w));
    v += uMouseForce * f * uDt;
  }
  if (uVortex > 0.0) {
    vec3 q = P.xyz - vec3(0.0, -0.45, 0.0);
    vec3 tang = vec3(-q.z, 0.0, q.x);
    float tl = length(tang);
    if (tl > 1e-4) {
      float fall = exp(-dot(q.xz, q.xz) * 1.1);
      v += (tang / tl) * uVortex * 9.0 * fall * uDt;
      v.y += uVortex * 1.2 * fall * uDt;
    }
  }

  for (int i = 0; i < uFieldCount; i++) {
    vec3 d = P.xyz - uField[i].xyz;
    float L = length(d);
    float R = uField[i].w;
    if (L < R && L > 1e-4) {
      float f = 1.0 - L / R;
      f = f * f;
      int mode = int(uFieldP[i].y + 0.5);
      float s = uFieldP[i].x;
      vec3 dir = normalize(uFieldDir[i].xyz + vec3(0.0, 1e-6, 0.0));
      if (mode == 0) v += (d / L) * s * f * uDt;
      else if (mode == 1) v -= (d / L) * s * f * uDt;
      else if (mode == 2) v += dir * s * f * uDt;
      else v -= v * s * f * uDt;
    }
  }

  float sp = length(v);
  if (sp > uMaxSpeed) v *= uMaxSpeed / sp;

  vec3 p = P.xyz + v * uDt;

  for (int i = 0; i < uPortalCount; i++) {
    vec3 d = p - uPortalA[i].xyz;
    if (dot(d, d) < uPortalA[i].w * uPortalA[i].w) {
      vec3 na = normalize(uPortalAn[i].xyz);
      if (dot(v, na) < 0.0) {
        vec3 nb = normalize(uPortalBn[i].xyz);
        float sv = max(length(v), 0.8);
        p = uPortalB[i].xyz + nb * 0.07;
        v = nb * sv * 0.85;
      }
    }
  }

  oPos = vec4(p, 0.0);
}`;

  /* ---------- 2. плотность + лямбда ---------- */

  SH.densityFS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uPred;
uniform sampler2D uType;
uniform vec2 uTexSize;
uniform float uSpacing[8];
uniform float uIsFluid[8];
uniform float uEps;
uniform float uCMin;
uniform float uLamMax;
${SH.kernel}
${SH.gridDecl}
out vec4 oOut;

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec3 p = texelFetch(uPred, c, 0).xyz;
  if (p.y < -500.0) { oOut = vec4(0.0); return; }

  int ti = int(texelFetch(uType, c, 0).x + 0.5);
  if (uIsFluid[ti] < 0.5) { oOut = vec4(0.0); return; }
  float sp = uSpacing[ti];
  float n0 = 1.0 / (sp * sp * sp);

  ivec3 cell = ivec3(clamp(floor((p - uGridMin) / uCellSize), vec3(0.0), uGridDim - 1.0));

  float dens = poly6(0.0);
  float grad2 = 0.0;

  for (int dz = -1; dz <= 1; dz++)
  for (int dy = -1; dy <= 1; dy++)
  for (int dx = -1; dx <= 1; dx++) {
    ivec3 cc = cell + ivec3(dx, dy, dz);
    if (cc.x < 0 || cc.y < 0 || cc.z < 0 || cc.x >= uGX || cc.y >= uGY || cc.z >= uGZ) continue;
    vec2 sc = texelFetch(uGridStart, ivec2(cc.x, cc.y + cc.z * uGY), 0).rg;
    int start = int(sc.x + 0.5);
    int cnt = int(sc.y + 0.5);
    for (int k = 0; k < cnt; k++) {
      int li = start + k;
      int j = int(texelFetch(uGridIdx, ivec2(li % uTW, li / uTW), 0).x + 0.5);
      ivec2 jc = ivec2(j % uTW, j / uTW);
      vec3 pj = texelFetch(uPred, jc, 0).xyz;
      vec3 r = p - pj;
      float r2 = dot(r, r);
      if (r2 < uH2 && r2 > 1e-10) {
        if (uIsFluid[int(texelFetch(uType, jc, 0).x + 0.5)] < 0.5) continue;
        float rl = sqrt(r2);
        dens += poly6(r2);
        float gm = spikyMag(rl);
        vec3 gw = gm * (r / rl);
        grad2 += dot(gw, gw);
      }
    }
  }

  float C = dens / n0 - 1.0;
  C = max(C, uCMin);
  float lambda = -C / (grad2 / (n0 * n0) + uEps);
  lambda = clamp(lambda, -uLamMax, uLamMax);
  oOut = vec4(lambda, dens, C, 1.0);
}`;

  /* ---------- 3. коррекция положения ---------- */

  SH.deltaFS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uPred;
uniform sampler2D uLambda;
uniform sampler2D uType;
uniform vec2 uTexSize;
uniform float uSpacing[8];
uniform float uIsFluid[8];
uniform float uSCorrK;
uniform float uMaxDp;
${SH.kernel}
${SH.gridDecl}
${SH.collision}
out vec4 oOut;

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 Pd = texelFetch(uPred, c, 0);
  vec3 p = Pd.xyz;
  if (p.y < -500.0) { oOut = Pd; return; }

  float lamI = texelFetch(uLambda, c, 0).x;
  int ti = int(texelFetch(uType, c, 0).x + 0.5);
  if (uIsFluid[ti] < 0.5) { oOut = vec4(p, Pd.w); return; }
  float sp = uSpacing[ti];
  float n0 = 1.0 / (sp * sp * sp);
  float wdq = poly6(0.04 * uH2);

  ivec3 cell = ivec3(clamp(floor((p - uGridMin) / uCellSize), vec3(0.0), uGridDim - 1.0));
  vec3 dp = vec3(0.0);

  for (int dz = -1; dz <= 1; dz++)
  for (int dy = -1; dy <= 1; dy++)
  for (int dx = -1; dx <= 1; dx++) {
    ivec3 cc = cell + ivec3(dx, dy, dz);
    if (cc.x < 0 || cc.y < 0 || cc.z < 0 || cc.x >= uGX || cc.y >= uGY || cc.z >= uGZ) continue;
    vec2 sc = texelFetch(uGridStart, ivec2(cc.x, cc.y + cc.z * uGY), 0).rg;
    int start = int(sc.x + 0.5);
    int cnt = int(sc.y + 0.5);
    for (int k = 0; k < cnt; k++) {
      int li = start + k;
      int j = int(texelFetch(uGridIdx, ivec2(li % uTW, li / uTW), 0).x + 0.5);
      ivec2 jc = ivec2(j % uTW, j / uTW);
      vec3 pj = texelFetch(uPred, jc, 0).xyz;
      vec3 r = p - pj;
      float r2 = dot(r, r);
      if (r2 < uH2 && r2 > 1e-10) {
        if (uIsFluid[int(texelFetch(uType, jc, 0).x + 0.5)] < 0.5) continue;
        float rl = sqrt(r2);
        float w = poly6(r2);
        float q = w / wdq;
        float sCorr = -uSCorrK * q * q * q * q;
        float gm = spikyMag(rl);
        vec3 gw = gm * (r / rl);
        float lamJ = texelFetch(uLambda, jc, 0).x;
        dp += (lamI + lamJ + sCorr) * gw;
      }
    }
  }

  dp /= n0;
  float dl = length(dp);
  if (dl > uMaxDp) dp *= uMaxDp / dl;

  vec3 nrm;
  p = pushOut(p + dp, nrm);
  oOut = vec4(p, Pd.w);
}`;

  /* ---------- 4. скорость (MRT) ---------- */

  SH.velocityFS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
layout(location = 0) out vec4 oPos;
layout(location = 1) out vec4 oVel;

uniform sampler2D uPos;
uniform sampler2D uPred;
uniform sampler2D uType;
uniform vec2 uTexSize;
uniform float uDt;
uniform float uVisc[8];
uniform float uViscScale;
uniform float uMaxSpeed;
uniform float uSpacing[8];
uniform float uIsFluid[8];
uniform float uDragK[8];
${SH.kernel}
${SH.gridDecl}
${SH.collision}

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 P = texelFetch(uPos, c, 0);
  vec4 Pd = texelFetch(uPred, c, 0);
  vec3 p = Pd.xyz;
  if (p.y < -500.0) { oPos = Pd; oVel = vec4(0.0); return; }

  vec3 v = (p - P.xyz) / uDt;

  int ti = int(texelFetch(uType, c, 0).x + 0.5);
  bool fluid = uIsFluid[ti] > 0.5;
  float sp = uSpacing[ti];
  float n0 = 1.0 / (sp * sp * sp);

  ivec3 cell = ivec3(clamp(floor((p - uGridMin) / uCellSize), vec3(0.0), uGridDim - 1.0));
  vec3 dv = vec3(0.0);

  for (int dz = -1; dz <= 1; dz++)
  for (int dy = -1; dy <= 1; dy++)
  for (int dx = -1; dx <= 1; dx++) {
    ivec3 cc = cell + ivec3(dx, dy, dz);
    if (cc.x < 0 || cc.y < 0 || cc.z < 0 || cc.x >= uGX || cc.y >= uGY || cc.z >= uGZ) continue;
    vec2 sc = texelFetch(uGridStart, ivec2(cc.x, cc.y + cc.z * uGY), 0).rg;
    int start = int(sc.x + 0.5);
    int cnt = int(sc.y + 0.5);
    for (int k = 0; k < cnt; k++) {
      int li = start + k;
      int j = int(texelFetch(uGridIdx, ivec2(li % uTW, li / uTW), 0).x + 0.5);
      ivec2 jc = ivec2(j % uTW, j / uTW);
      vec3 pj = texelFetch(uPred, jc, 0).xyz;
      vec3 r = p - pj;
      float r2 = dot(r, r);
      if (fluid && r2 < uH2 && r2 > 1e-10) {
        if (uIsFluid[int(texelFetch(uType, jc, 0).x + 0.5)] < 0.5) continue;
        vec3 pj0 = texelFetch(uPos, jc, 0).xyz;
        vec3 vj = (pj - pj0) / uDt;
        dv += (vj - v) * poly6(r2);
      }
    }
  }
  dv /= n0;
  if (fluid) {
    float visc = uVisc[ti];
    v += dv * visc * uViscScale;
  } else {
    // сыпучие частицы не вязкие: гасим скорость и добавляем трение о пол
    v *= 1.0 / (1.0 + uDragK[ti] * uDt);
  }

  vec3 nrm;
  vec3 pc = pushOut(p, nrm);
  if (length(nrm) > 0.5) {
    float vn = dot(v, nrm);
    if (vn < 0.0) v -= nrm * vn * 1.25;
    p = pc;
  }
  float vs = length(v);
  if (vs > uMaxSpeed) v *= uMaxSpeed / vs;
  oPos = vec4(p, 0.0);
  oVel = vec4(v, 0.0);
}`;

  /* ---------- рендер частиц ---------- */

  SH.pointsVS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uPos;
uniform sampler2D uType;
uniform sampler2D uVel;
uniform mat4 uView;
uniform mat4 uProj;
uniform vec2 uTexSize;
uniform float uRadius;
uniform float uPointScale;
uniform float uIsFluid[8];
uniform vec3 uColors[8];
uniform float uRadScale[8];
uniform float uPass;   // 1 — только жидкости, 2 — только сыпучие частицы
out float vDepth;
out float vR;
out vec3 vColor;
out float vType;
out float vSpeed;

void main() {
  int id = gl_VertexID;
  ivec2 c = ivec2(id % int(uTexSize.x), id / int(uTexSize.x));
  vec3 p = texelFetch(uPos, c, 0).xyz;
  int t = int(texelFetch(uType, c, 0).x + 0.5);
  vec3 vv = texelFetch(uVel, c, 0).xyz;
  vSpeed = length(vv);
  vColor = uColors[t].rgb;
  vType = float(t);

  bool isFluid = uIsFluid[t] > 0.5;
  if ((uPass > 1.5 && isFluid) || (uPass < 1.5 && uPass > 0.5 && !isFluid)) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 1.0;
    vDepth = 1e6;
    return;
  }

  vec4 vp = uView * vec4(p, 1.0);
  vDepth = -vp.z;
  if (vDepth < 0.02 || p.y < -500.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 1.0;
    vDepth = 1e6;
    return;
  }
  gl_Position = uProj * vp;
  gl_PointSize = clamp(uRadius * uRadScale[t] * uPointScale / max(vDepth, 0.02), 1.0, 128.0);
  vR = uRadius * uRadScale[t];
}`;

  SH.pointsDepthFS = `#version 300 es
precision highp float;
in float vDepth;
in float vR;
uniform float uM10;
uniform float uM14;
out vec4 oOut;

void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  // плоская глубина: сферическая реконструкция превращала массу в отдельные шары
  oOut = vec4(vDepth, 0.0, 0.0, 1.0);
}`;

  SH.particleFS = `#version 300 es
precision highp float;
in float vDepth;
in vec3 vColor;
in float vType;
in float vSpeed;
uniform float uAlpha;
out vec4 oOut;

void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  float a = smoothstep(1.0, 0.25, r2);
  vec3 c = vColor * (0.85 + 0.35 * (1.0 - r2));
  oOut = vec4(c, a * uAlpha);
}`;

  SH.pointsThickFS = `#version 300 es
precision highp float;
in float vDepth;
in float vR;
in vec3 vColor;
in float vType;
in float vSpeed;
out vec4 oOut;

void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  float w = 1.0 - r2 * 0.55;
  float foam = smoothstep(3.2, 6.5, vSpeed) * 0.55;
  vec3 c = mix(vColor, vec3(0.88, 0.95, 0.99), foam);
  oOut = vec4(c * w, w);
}`;

  /* ---------- размытие карты глубины ---------- */

  SH.blurFS = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uSrc;
uniform vec2 uRes;
uniform vec2 uDir;
uniform float uPx;
out vec4 oOut;

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float d0 = texture(uSrc, uv).r;

  // дилатация: промежутки между частицами заполняем ближайшей поверхностью
  if (d0 > 900.0) {
    float best = 1e9;
    for (int i = -5; i <= 5; i++) {
      float di = texture(uSrc, uv + uDir * float(i)).r;
      if (di < best) best = di;
    }
    oOut = vec4(best > 1e8 ? 1e9 : best);
    return;
  }

  float sum = 0.0, wsum = 0.0;
  for (int i = -20; i <= 20; i++) {
    float di = texture(uSrc, uv + uDir * float(i)).r;
    if (di > 900.0) continue;
    float w = exp(-float(i * i) / 110.0) * exp(-abs(di - d0) * uPx);
    sum += di * w; wsum += w;
  }
  oOut = vec4(wsum > 1e-5 ? sum / wsum : d0);
}`;

  /* ---------- размытие толщины/цвета ---------- */

  SH.blur4FS = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uSrc;
uniform vec2 uRes;
uniform vec2 uDir;
uniform float uPx;
out vec4 oOut;

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 c0 = texture(uSrc, uv);
  vec4 sum = c0 * 2.0;
  float wsum = 2.0;
  for (int i = -20; i <= 20; i++) {
    vec4 ci = texture(uSrc, uv + uDir * float(i));
    float w = exp(-float(i * i) / 110.0);
    sum += ci * w; wsum += w;
  }
  oOut = sum / wsum;
}`;

  /* ---------- финальный композит жидкости ---------- */

  SH.fluidFS = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uScene;
uniform sampler2D uSceneDepth;
uniform sampler2D uBlur;
uniform sampler2D uThick;
uniform vec2 uRes;
uniform float uNear;
uniform float uFar;
uniform float uTanHalf;
uniform float uAspect;
uniform vec3 uLightDirView;
uniform float uThickScale;
uniform float uRefract;
uniform float uAbsorb;
uniform float uOpacity;
uniform float uDbg;
out vec4 fragColor;

vec3 viewPos(vec2 uv, float d) {
  vec2 ndc = uv * 2.0 - 1.0;
  return vec3(ndc.x * uTanHalf * uAspect, ndc.y * uTanHalf, -1.0) * d;
}

float linDepth(float d) {
  float z = d * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 sceneCol = texture(uScene, uv).rgb;

  float d = texture(uBlur, uv).r;
  if (uDbg > 0.5) { fragColor = vec4(vec3(clamp(1.0 - d * 0.12, 0.0, 1.0)), 1.0); return; }
  if (d > 900.0) { fragColor = vec4(sceneCol, 1.0); return; }

  float sceneZ = linDepth(texture(uSceneDepth, uv).r);
  if (d > sceneZ) { fragColor = vec4(sceneCol, 1.0); return; }

  vec4 th = texture(uThick, uv);
  float thick = th.a;
  vec3 fluidCol = th.rgb / max(th.a, 1e-4);

  float dx = 9.0 / uRes.x;
  float dy = 9.0 / uRes.y;
  float dR = texture(uBlur, uv + vec2(dx, 0.0)).r; if (dR > 900.0) dR = d;
  float dL = texture(uBlur, uv - vec2(dx, 0.0)).r; if (dL > 900.0) dL = d;
  float dU = texture(uBlur, uv + vec2(0.0, dy)).r; if (dU > 900.0) dU = d;
  float dD = texture(uBlur, uv - vec2(0.0, dy)).r; if (dD > 900.0) dD = d;

  vec3 P  = viewPos(uv, d);
  vec3 Px = viewPos(uv + vec2(dx, 0.0), dR) - viewPos(uv - vec2(dx, 0.0), dL);
  vec3 Py = viewPos(uv + vec2(0.0, dy), dU) - viewPos(uv - vec2(0.0, dy), dD);
  vec3 N = normalize(cross(Px, Py));
  vec3 V = normalize(-P);
  if (dot(N, V) < 0.0) N = -N;

  vec3 L = normalize(uLightDirView);
  vec3 H = normalize(L + V);
  float diff = clamp(dot(N, L) * 0.5 + 0.5, 0.0, 1.0);
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);

  float t = thick * uThickScale;

  vec2 ruv = clamp(uv + N.xy * uRefract * (0.5 + 0.9 * fres), vec2(0.002), vec2(0.998));
  vec3 refr = texture(uScene, ruv).rgb;

  vec3 absorb = exp(-t * (1.0 - fluidCol * 0.72) * uAbsorb);
  vec3 body = refr * absorb;

  vec3 scatter = fluidCol * (0.34 + 0.72 * diff) + vec3(0.02, 0.05, 0.08);
  float alpha = clamp(1.0 - exp(-t * uOpacity), 0.0, 0.985);

  vec3 env = mix(vec3(0.025, 0.05, 0.075), vec3(0.20, 0.40, 0.55), clamp(N.y * 0.5 + 0.5, 0.0, 1.0));
  float sp = pow(clamp(dot(N, H), 0.0, 1.0), 42.0);

  vec3 col = mix(body, scatter, clamp(0.46 + 0.42 * fres, 0.0, 0.92));
  col = mix(col, env, fres * 0.62);
  col += vec3(1.0) * sp * (0.14 + 0.42 * fres);
  col += fluidCol * smoothstep(0.55, 1.0, fluidCol.r) * 0.9 * alpha;

  vec3 outc = mix(sceneCol, col, alpha);
  // дизеринг убирает полосы 8-битного квантования на плавных градиентах
  float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  outc += (n - 0.5) * (0.75 / 255.0);
  fragColor = vec4(outc, 1.0);
}`;

  /* ---------- сцена ---------- */

  SH.sceneVS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aColor;
uniform mat4 uMVP;
uniform mat4 uModel;
out vec3 vN;
out vec3 vW;
out vec3 vC;
out vec3 vLocal;

void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vW = w.xyz;
  vN = mat3(uModel) * aNormal;
  vC = aColor;
  vLocal = aPos;
  gl_Position = uMVP * vec4(aPos, 1.0);
}`;

  SH.sceneFS = `#version 300 es
precision highp float;
in vec3 vN;
in vec3 vW;
in vec3 vC;
in vec3 vLocal;
uniform vec3 uColor;
uniform vec3 uLightDir;
uniform vec3 uCamPos;
uniform float uAlpha;
uniform float uEmissive;
uniform int uStyle;
uniform float uSeed;
uniform vec2 uWinA;
uniform vec2 uWinB;
out vec4 oOut;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(uCamPos - vW);
  if (dot(N, V) < 0.0) N = -N;

  float diff = clamp(dot(N, uLightDir) * 0.5 + 0.5, 0.0, 1.0);
  vec3 H = normalize(uLightDir + V);
  float spec = pow(clamp(dot(N, H), 0.0, 1.0), 64.0);
  float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);

  vec3 base = uColor * vC;
  vec3 col = base * (0.22 + 0.85 * diff);
  col += vec3(1.0) * spec * 0.45;
  col += vec3(0.25, 0.65, 1.0) * rim * 0.35;

  if (uStyle == 1) {
    // затемнение к основанию — имитация затенения у воды
    col *= mix(0.30, 1.0, smoothstep(-1.0, 0.35, vLocal.y));
    float side = max(step(0.55, abs(N.x)), step(0.55, abs(N.z)));
    float u = abs(N.z) > 0.5 ? vLocal.x : vLocal.z;
    vec2 cell = abs(N.z) > 0.5 ? uWinB : uWinA;
    vec2 q = vec2(u, vLocal.y) * 0.5 + 0.5;
    vec2 g = fract(q * cell) - 0.5;
    float win = step(0.24, abs(g.x)) * step(0.26, abs(g.y));
    float lit = hash21(floor(q * cell) * 1.7 + uSeed);
    float on = step(0.34, lit);
    vec3 winCol = mix(vec3(0.055, 0.07, 0.10), vec3(1.0, 0.86, 0.58) * (0.55 + 0.75 * on), on);
    col = mix(col, winCol, win * side * 0.95);
  } else if (uStyle == 2) {
    col = base * (0.55 + 1.1 * rim);
  }

  col += base * uEmissive;
  oOut = vec4(col, uAlpha);
}`;

  SH.clearFS = `#version 300 es
precision highp float;
uniform vec4 uValue;
out vec4 oOut;
void main() { oOut = uValue; }`;

  /* ---------- небо ---------- */

  SH.skyVS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vUV;
void main() { vUV = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

  SH.skyFS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform vec2 uRes;
uniform int uMode;
uniform float uTime;
out vec4 oOut;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise2(p); p *= 2.03; a *= 0.5; }
  return v;
}
float starField(vec2 uv, float density, float size) {
  vec2 g = uv * 260.0;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float r = hash21(id);
  vec2 off = vec2(hash21(id + 3.1), hash21(id + 8.7)) - 0.5;
  float d = length(f - off * 0.6);
  return smoothstep(size, 0.0, d) * step(1.0 - density, r);
}

void main() {
  vec2 uv = vUV;
  float asp = uRes.x / max(1.0, uRes.y);
  vec2 p = vec2(uv.x * asp, uv.y);
  vec3 col;

  if (uMode == 0) {
    col = mix(vec3(0.012, 0.018, 0.028), vec3(0.030, 0.058, 0.082), smoothstep(0.0, 1.0, uv.y));
    col += vec3(0.04, 0.10, 0.14) * exp(-pow(length((uv - vec2(0.5, 0.58)) * vec2(1.5, 1.0)) * 3.2, 2.0));
  } else if (uMode == 1) {
    col = mix(vec3(0.010, 0.016, 0.045), vec3(0.045, 0.075, 0.150), smoothstep(0.0, 1.0, uv.y));
    col += vec3(0.30, 0.16, 0.34) * smoothstep(0.55, 1.0, uv.y) * 0.35;
    col += vec3(1.0, 0.95, 0.90) * starField(uv, 0.055, 0.10) * 1.4;
    col += vec3(0.90, 0.85, 1.0) * starField(uv, 0.012, 0.18) * 0.9;
    float glow = exp(-pow(length((uv - vec2(0.5, 0.04)) * vec2(1.1, 2.6)) * 2.4, 2.0));
    col += vec3(0.55, 0.28, 0.12) * glow * 0.40;
  } else if (uMode == 2) {
    col = mix(vec3(0.90, 0.42, 0.22), vec3(0.12, 0.09, 0.26), smoothstep(0.0, 0.9, uv.y));
    col = mix(col, vec3(0.02, 0.03, 0.10), smoothstep(0.6, 1.0, uv.y));
    float sun = exp(-pow(length((uv - vec2(0.52, 0.30)) * vec2(1.6, 1.0)) * 5.5, 2.0));
    col += vec3(1.0, 0.72, 0.35) * sun * 0.85;
    col += vec3(1.0, 0.55, 0.28) * exp(-pow(length((uv - vec2(0.52, 0.30)) * vec2(0.9, 1.6)) * 2.2, 2.0)) * 0.25;
  } else if (uMode == 3) {
    col = mix(vec3(0.62, 0.78, 0.92), vec3(0.16, 0.36, 0.72), smoothstep(0.0, 1.0, uv.y));
    float cl = fbm(p * 3.0 + vec2(uTime * 0.01, 0.0));
    col = mix(col, vec3(0.95, 0.97, 1.0), smoothstep(0.52, 0.85, cl) * 0.55 * smoothstep(0.15, 0.75, uv.y));
  } else if (uMode == 4) {
    col = mix(vec3(0.02, 0.01, 0.05), vec3(0.05, 0.02, 0.12), smoothstep(0.0, 1.0, uv.y));
    float n1 = fbm(p * 2.2 + vec2(uTime * 0.008, 0.0));
    float n2 = fbm(p * 3.7 - vec2(0.0, uTime * 0.005));
    col += vec3(0.35, 0.08, 0.55) * pow(n1, 2.2) * 1.5;
    col += vec3(0.05, 0.35, 0.45) * pow(n2, 2.6) * 1.2;
    col += vec3(1.0, 0.92, 0.95) * starField(uv, 0.07, 0.09) * 1.3;
  } else if (uMode == 6) {
    // рождественская ночь
    col = mix(vec3(0.012, 0.020, 0.048), vec3(0.030, 0.058, 0.125), smoothstep(0.0, 1.0, uv.y));
    col += vec3(1.0, 0.94, 0.82) * starField(uv, 0.08, 0.10) * 1.45;
    col += vec3(1.0, 0.58, 0.24) * exp(-pow((uv.y - 0.04) * 4.2, 2.0)) * 0.34;
    float au = fbm(p * 1.7 + vec2(uTime * 0.02, 0.0));
    col += vec3(0.10, 0.52, 0.34) * pow(au, 3.2) * smoothstep(0.30, 0.98, uv.y) * 0.55;
    col += vec3(0.55, 0.65, 0.85) * 0.022;
  } else {
    col = mix(vec3(0.055, 0.060, 0.070), vec3(0.020, 0.022, 0.028), smoothstep(0.0, 1.0, uv.y));
    col += vec3(0.10, 0.11, 0.13) * exp(-pow(length((uv - vec2(0.5, 0.75)) * vec2(1.0, 1.4)) * 2.0, 2.0));
  }

  oOut = vec4(col, 1.0);
}`;

  /* ---------- пол ---------- */

  SH.floorFS = `#version 300 es
precision highp float;
in vec3 vN;
in vec3 vW;
in vec3 vC;
in vec3 vLocal;
uniform vec3 uLightDir;
uniform vec3 uCamPos;
uniform vec3 uColor;
uniform float uGridFade;
uniform int uFloorStyle;
uniform float uBlock;
out vec4 oOut;

float gridLine(vec2 p, float s) {
  vec2 q = p / s;
  vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q);
  return 1.0 - min(min(g.x, g.y), 1.0);
}

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(uCamPos - vW);
  float diff = clamp(dot(N, uLightDir), 0.0, 1.0);

  float d = length(vW.xz);
  float fade = 1.0 - smoothstep(3.0, 9.0 * uGridFade, d);
  vec3 base = uColor * (0.35 + 0.75 * diff);

  if (uFloorStyle == 1) {
    /* город: кварталы, асфальт, разметка */
    float blk = uBlock;
    vec2 g = abs(fract(vW.xz / blk) - 0.5) * blk;
    float half2 = blk * 0.5;
    float roadW = blk * 0.13;
    float road = max(smoothstep(half2 - roadW, half2 - roadW * 0.6, g.x),
                     smoothstep(half2 - roadW, half2 - roadW * 0.6, g.y));
    vec3 walk = vec3(0.105, 0.110, 0.125);
    vec3 asph = vec3(0.042, 0.044, 0.052);
    vec3 ground = mix(walk, asph, road);

    // тротуарная кромка
    float curb = max(smoothstep(roadW * 1.35, roadW * 1.05, abs(half2 - g.x)),
                     smoothstep(roadW * 1.35, roadW * 1.05, abs(half2 - g.y)));
    ground += vec3(0.10, 0.10, 0.11) * curb * 0.5;

    // прерывистая разметка по центру дорог
    float markX = 1.0 - smoothstep(0.0, blk * 0.010, abs(g.x - half2));
    float markZ = 1.0 - smoothstep(0.0, blk * 0.010, abs(g.y - half2));
    float dashX = step(0.45, fract(vW.z / (blk * 0.16)));
    float dashZ = step(0.45, fract(vW.x / (blk * 0.16)));
    float mark = max(markX * dashX, markZ * dashZ) * step(0.35, road);
    ground += vec3(0.85, 0.78, 0.42) * mark * 0.55;

    // мелкая зернистость асфальта
    ground *= 0.94 + 0.12 * fract(sin(dot(floor(vW.xz * 90.0), vec2(12.9898, 78.233))) * 43758.5453);

    base = ground * (0.45 + 0.85 * diff);
    base += vec3(0.10, 0.35, 0.45) * gridLine(vW.xz, blk) * 0.05 * fade;
  } else if (uFloorStyle == 3) {
    /* снежный шар: снег с мягкими сугробами */
    float n = 0.5 + 0.5 * sin(vW.x * 3.1 + 1.3) * sin(vW.z * 2.7 - 0.7);
    vec3 snow = mix(vec3(0.72, 0.78, 0.90), vec3(0.92, 0.95, 1.0), n);
    base = snow * (0.55 + 0.55 * diff);
    base += vec3(0.20, 0.35, 0.62) * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.0) * 0.55;
  } else if (uFloorStyle == 2) {
    /* открытая площадка: тёмный бетон */
    base = uColor * (0.30 + 0.70 * diff);
    base += vec3(0.10, 0.35, 0.45) * gridLine(vW.xz, 0.5) * 0.09 * fade;
    base += vec3(0.18, 0.55, 0.70) * gridLine(vW.xz, 2.0) * 0.14 * fade;
  } else {
    /* резервуар: техническая сетка */
    base += vec3(0.10, 0.35, 0.45) * gridLine(vW.xz, 0.25) * 0.26 * fade;
    base += vec3(0.18, 0.55, 0.70) * gridLine(vW.xz, 1.0) * 0.45 * fade;
  }

  float refl = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.0);
  base += vec3(0.05, 0.10, 0.16) * refl;

  oOut = vec4(base, 1.0);
}`;

  /* ---------- линии / гизмо ---------- */

  SH.lineVS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
uniform mat4 uMVP;
void main() { gl_Position = uMVP * vec4(aPos, 1.0); }`;

  SH.lineFS = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 oOut;
void main() { oOut = uColor; }`;

  /* ---------- стекло ---------- */

  SH.glassFS = `#version 300 es
precision highp float;
in vec3 vN;
in vec3 vW;
in vec3 vC;
in vec3 vLocal;
uniform vec3 uLightDir;
uniform vec3 uCamPos;
uniform float uAlphaScale;
out vec4 oOut;

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(uCamPos - vW);
  float fres = pow(1.0 - abs(dot(N, V)), 3.0);
  float top = smoothstep(0.0, 1.0, vLocal.y);
  vec3 col = vec3(0.035, 0.075, 0.10) + vec3(0.30, 0.70, 0.92) * fres * 0.55;
  col += vec3(0.05, 0.16, 0.20) * top * 0.5;
  float a = (0.06 + fres * 0.20 + top * 0.05) * uAlphaScale;
  oOut = vec4(col, a);
}`;

  /* ---------- силовое поле ---------- */

  SH.fieldFS = `#version 300 es
precision highp float;
in vec3 vN;
in vec3 vW;
in vec3 vC;
in vec3 vLocal;
uniform vec3 uColor;
uniform vec3 uCamPos;
uniform float uTime;
uniform float uMode;
out vec4 oOut;

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(uCamPos - vW);
  float fres = pow(1.0 - abs(dot(N, V)), 2.4);
  float band = 0.5 + 0.5 * sin(vW.y * 26.0 - uTime * 3.0 + uMode * 1.7);
  float pulse = 0.75 + 0.25 * sin(uTime * 2.2);
  vec3 col = uColor * (0.30 + 1.5 * fres) * pulse;
  col += uColor * band * 0.18 * (0.3 + fres);
  oOut = vec4(col, (0.07 + 0.5 * fres) * pulse);
}`;

  /* ---------- портал ---------- */

  SH.portalFS = `#version 300 es
precision highp float;
in vec3 vN;
in vec3 vW;
in vec3 vC;
in vec3 vLocal;
uniform vec3 uColor;
uniform vec3 uCamPos;
uniform float uTime;
out vec4 oOut;

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(uCamPos - vW);
  float fres = pow(1.0 - abs(dot(N, V)), 2.0);
  float r = length(vLocal.xy);
  float swirl = 0.5 + 0.5 * sin(atan(vLocal.y, vLocal.x) * 3.0 + r * 14.0 - uTime * 4.0);
  vec3 col = uColor * (0.55 + 1.6 * swirl) + vec3(1.0) * fres * 0.5;
  float a = clamp(0.30 + 0.55 * swirl + 0.4 * fres, 0.0, 1.0);
  oOut = vec4(col, a);
}`;
})();
