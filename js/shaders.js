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
float spikyMag(float r) {          // dW/dr  (отрицательная)
  float d = uH - r;
  return -uSpikyK * d * d;
}
`;

  SH.collision = `
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform float uWallTop;
uniform float uPRadius;
uniform vec4 uSph[8];
uniform int uSphCount;
uniform vec4 uObsBox[4];
uniform vec3 uObsBoxHalf[4];
uniform int uObsBoxCount;

vec3 pushOut(vec3 p, out vec3 nrm) {
  nrm = vec3(0.0);
  float r = uPRadius;
  if (p.y < uBoxMin.y + r) { p.y = uBoxMin.y + r; nrm = vec3(0.0, 1.0, 0.0); }
  if (p.y < uWallTop) {
    if (p.x < uBoxMin.x + r)      { p.x = uBoxMin.x + r;      nrm = vec3(1.0, 0.0, 0.0); }
    else if (p.x > uBoxMax.x - r) { p.x = uBoxMax.x - r;      nrm = vec3(-1.0, 0.0, 0.0); }
    if (p.z < uBoxMin.z + r)      { p.z = uBoxMin.z + r;      nrm = vec3(0.0, 0.0, 1.0); }
    else if (p.z > uBoxMax.z - r) { p.z = uBoxMax.z - r;      nrm = vec3(0.0, 0.0, -1.0); }
  }
  for (int i = 0; i < uSphCount; i++) {
    vec3 d = p - uSph[i].xyz;
    float L = length(d);
    float rr = uSph[i].w + r;
    if (L < rr && L > 1e-5) { nrm = d / L; p = uSph[i].xyz + nrm * rr; }
  }
  for (int i = 0; i < uObsBoxCount; i++) {
    vec3 c = uObsBox[i].xyz;
    vec3 h = uObsBoxHalf[i] + r;
    vec3 d = p - c;
    vec3 ad = abs(d) - h;
    if (max(ad.x, max(ad.y, ad.z)) < 0.0) {
      if (ad.x >= ad.y && ad.x >= ad.z) {
        float s = d.x >= 0.0 ? 1.0 : -1.0; nrm = vec3(s, 0.0, 0.0); p.x = c.x + s * h.x;
      } else if (ad.y >= ad.z) {
        float s = d.y >= 0.0 ? 1.0 : -1.0; nrm = vec3(0.0, s, 0.0); p.y = c.y + s * h.y;
      } else {
        float s = d.z >= 0.0 ? 1.0 : -1.0; nrm = vec3(0.0, 0.0, s); p.z = c.z + s * h.z;
      }
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
uniform vec4 uBuoy;
uniform vec4 uMouse;
uniform vec3 uMouseForce;
uniform float uVortex;
out vec4 oPos;

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 P = texelFetch(uPos, c, 0);
  vec4 V = texelFetch(uVel, c, 0);
  if (P.y < -500.0) { oPos = vec4(P.xyz, 0.0); return; }

  int t = int(texelFetch(uType, c, 0).x + 0.5);
  float buoy = t == 0 ? uBuoy.x : (t == 1 ? uBuoy.y : (t == 2 ? uBuoy.z : uBuoy.w));

  vec3 v = V.xyz + (uGravity + vec3(0.0, buoy, 0.0)) * uDt;

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
  float sp = length(v);
  if (sp > uMaxSpeed) v *= uMaxSpeed / sp;

  oPos = vec4(P.xyz + v * uDt, 0.0);
}`;

  /* ---------- 2. плотность + лямбда ---------- */

  SH.densityFS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uPred;
uniform sampler2D uType;
uniform vec2 uTexSize;
uniform vec4 uSpacing;
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
  float sp = ti == 0 ? uSpacing.x : (ti == 1 ? uSpacing.y : (ti == 2 ? uSpacing.z : uSpacing.w));
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
      vec3 pj = texelFetch(uPred, ivec2(j % uTW, j / uTW), 0).xyz;
      vec3 r = p - pj;
      float r2 = dot(r, r);
      if (r2 < uH2 && r2 > 1e-10) {
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
uniform vec4 uSpacing;
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
  float sp = ti == 0 ? uSpacing.x : (ti == 1 ? uSpacing.y : (ti == 2 ? uSpacing.z : uSpacing.w));
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
uniform vec4 uVisc;
uniform float uViscScale;
uniform float uMaxSpeed;
uniform vec4 uSpacing;
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
  float sp = ti == 0 ? uSpacing.x : (ti == 1 ? uSpacing.y : (ti == 2 ? uSpacing.z : uSpacing.w));
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
      if (r2 < uH2 && r2 > 1e-10) {
        vec3 pj0 = texelFetch(uPos, jc, 0).xyz;
        vec3 vj = (pj - pj0) / uDt;
        dv += (vj - v) * poly6(r2);
      }
    }
  }
  dv /= n0;
  float visc = ti == 0 ? uVisc.x : (ti == 1 ? uVisc.y : (ti == 2 ? uVisc.z : uVisc.w));
  v += dv * visc * uViscScale;

  vec3 nrm;
  vec3 pc = pushOut(p, nrm);
  if (length(nrm) > 0.5) {
    float vn = dot(v, nrm);
    if (vn < 0.0) v -= nrm * vn * 1.25;      // небольшой отскок
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
uniform vec4 uColors[4];
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

  vec4 vp = uView * vec4(p, 1.0);
  vDepth = -vp.z;
  if (vDepth < 0.02 || p.y < -500.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 1.0;
    vDepth = 1e6;
    return;
  }
  gl_Position = uProj * vp;
  gl_PointSize = clamp(uRadius * uPointScale / vDepth, 1.0, 160.0);
  vR = uRadius;
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
  float zs = vDepth - vR * sqrt(1.0 - r2);
  float ndc = -uM10 + uM14 / max(zs, 1e-3);
  gl_FragDepth = clamp(0.5 * ndc + 0.5, 0.0, 1.0);
  oOut = vec4(zs, 0.0, 0.0, 1.0);
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
  if (d0 > 900.0) { oOut = vec4(d0); return; }
  float sum = 0.0, wsum = 0.0;
  for (int i = -12; i <= 12; i++) {
    float di = texture(uSrc, uv + uDir * float(i)).r;
    if (di > 900.0) continue;
    float w = exp(-float(i * i) / 40.0) * exp(-abs(di - d0) * uPx);
    sum += di * w; wsum += w;
  }
  oOut = vec4(wsum > 1e-5 ? sum / wsum : d0);
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
  if (d > 900.0) { fragColor = vec4(sceneCol, 1.0); return; }

  float sceneZ = linDepth(texture(uSceneDepth, uv).r);
  if (d > sceneZ) { fragColor = vec4(sceneCol, 1.0); return; }

  vec4 th = texture(uThick, uv);
  float thick = th.a;
  vec3 fluidCol = th.rgb / max(th.a, 1e-4);

  float dx = 2.0 / uRes.x;
  float dy = 2.0 / uRes.y;
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
  float spec = pow(clamp(dot(N, H), 0.0, 1.0), 110.0);
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);

  float t = thick * uThickScale;

  vec2 ruv = clamp(uv + N.xy * uRefract * (0.4 + 1.3 * fres), vec2(0.002), vec2(0.998));
  vec3 refr = texture(uScene, ruv).rgb;

  vec3 absorb = exp(-t * (1.0 - fluidCol * 0.72) * uAbsorb);
  vec3 body = refr * absorb;

  vec3 scatter = fluidCol * (0.34 + 0.72 * diff) + vec3(0.02, 0.05, 0.08);
  float alpha = clamp(1.0 - exp(-t * uOpacity), 0.0, 0.985);

  vec3 env = mix(vec3(0.025, 0.05, 0.075), vec3(0.20, 0.40, 0.55), clamp(N.y * 0.5 + 0.5, 0.0, 1.0));
  float sp = pow(clamp(dot(N, H), 0.0, 1.0), 190.0);

  vec3 col = mix(body, scatter, clamp(0.22 + 0.50 * fres, 0.0, 0.85));
  col = mix(col, env, fres * 0.88);
  col += vec3(1.0) * sp * (0.45 + 2.6 * fres);
  col += fluidCol * smoothstep(0.55, 1.0, fluidCol.r) * 0.9 * alpha;

  fragColor = vec4(mix(sceneCol, col, alpha), 1.0);
}`;

  /* ---------- сцена ---------- */

  SH.sceneVS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
uniform mat4 uMVP;
uniform mat4 uModel;
out vec3 vN;
out vec3 vW;

void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vW = w.xyz;
  vN = mat3(uModel) * aNormal;
  gl_Position = uMVP * vec4(aPos, 1.0);
}`;

  SH.sceneFS = `#version 300 es
precision highp float;
in vec3 vN;
in vec3 vW;
uniform vec3 uColor;
uniform vec3 uLightDir;
uniform vec3 uCamPos;
uniform float uAlpha;
uniform float uEmissive;
out vec4 oOut;

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(uCamPos - vW);
  if (dot(N, V) < 0.0) N = -N;
  float diff = clamp(dot(N, uLightDir), 0.0, 1.0);
  vec3 H = normalize(uLightDir + V);
  float spec = pow(clamp(dot(N, H), 0.0, 1.0), 64.0);
  float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
  vec3 col = uColor * (0.20 + 0.85 * diff);
  col += vec3(1.0) * spec * 0.55;
  col += vec3(0.25, 0.65, 1.0) * rim * 0.45;
  col += uColor * uEmissive;
  oOut = vec4(col, uAlpha);
}`;

  SH.clearFS = `#version 300 es
precision highp float;
uniform vec4 uValue;
out vec4 oOut;
void main() { oOut = uValue; }`;

  SH.skyVS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vUV;
void main() { vUV = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

  SH.skyFS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform vec2 uRes;
out vec4 oOut;

void main() {
  vec2 uv = vUV;
  vec3 top = vec3(0.020, 0.030, 0.055);
  vec3 mid = vec3(0.035, 0.070, 0.105);
  vec3 bot = vec3(0.010, 0.015, 0.025);
  vec3 col = mix(bot, mid, smoothstep(0.0, 0.55, uv.y));
  col = mix(col, top, smoothstep(0.45, 1.0, uv.y));
  float glow = exp(-pow(length((uv - vec2(0.5, 0.62)) * vec2(1.4, 1.0)) * 3.0, 2.0));
  col += vec3(0.05, 0.12, 0.18) * glow;
  oOut = vec4(col, 1.0);
}`;

  SH.floorFS = `#version 300 es
precision highp float;
in vec3 vN;
in vec3 vW;
uniform vec3 uLightDir;
uniform vec3 uCamPos;
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

  float g1 = gridLine(vW.xz, 0.25);
  float g2 = gridLine(vW.xz, 1.0);
  float d = length(vW.xz);
  float fade = 1.0 - smoothstep(2.0, 7.0, d);

  vec3 base = vec3(0.035, 0.045, 0.06) * (0.35 + 0.75 * diff);
  base += vec3(0.10, 0.35, 0.45) * g1 * 0.30 * fade;
  base += vec3(0.18, 0.55, 0.70) * g2 * 0.55 * fade;

  float refl = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.0);
  base += vec3(0.05, 0.10, 0.16) * refl;

  oOut = vec4(base, 1.0);
}`;

  SH.lineVS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
uniform mat4 uMVP;
void main() { gl_Position = uMVP * vec4(aPos, 1.0); }`;

  SH.glassFS = `#version 300 es
precision highp float;
in vec3 vN;
in vec3 vW;
uniform vec3 uLightDir;
uniform vec3 uCamPos;
out vec4 oOut;

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(uCamPos - vW);
  float fres = pow(1.0 - abs(dot(N, V)), 3.0);
  float top = smoothstep(-1.0, 0.9, vW.y);
  vec3 col = vec3(0.035, 0.075, 0.10) + vec3(0.30, 0.70, 0.92) * fres * 0.55;
  col += vec3(0.05, 0.16, 0.20) * top * 0.5;
  float a = 0.06 + fres * 0.20 + top * 0.05;
  oOut = vec4(col, a);
}`;

  SH.lineFS = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 oOut;
void main() { oOut = uColor; }`;
})();
