// lab/prototypes/cellab/sphere2d.mjs - CelLab rules running on the body's surface.
//
// The sphere is an equi-angular cube: six faces of N x N cells, packed 3 x 2 in one atlas. A cell's eight neighbours are
// found once, on the GPU, by stepping its centre one cell in the face's own grid and asking which cube cell that point
// falls in (so neighbours across a seam are the true neighbours on the sphere), and for each neighbour the direction that
// points back at the cell in the neighbour's own frame (gases need it to carry particles across seams). No poles, no
// pinching; equi-angular cells vary in area by under 1.5x.
//
// Rule semantics follow CelLab (https://www.fourmilab.ch/cellab/, Rucker & Walker, public domain): 8-bit cell state; for
// the lookup-table rules a neighbour is seen through its bit 0; Rug sums full bytes (semi8), Hodge sums the low five bits
// (world type 10). Every step is one fullscreen pass over the atlas; a 'look' pass turns states into a palette colour and
// a height, blurred a little in space and time, and the body is sphere-traced with that height as radial relief.

import { compile, VS, target, bindTex } from './gl.mjs';

const CUBE = `
const float QP = 0.78539816;
vec3 faceDir(int f, vec2 st) {
  if (f == 0) return vec3(1.0, st.y, -st.x);
  if (f == 1) return vec3(-1.0, st.y, st.x);
  if (f == 2) return vec3(st.x, 1.0, -st.y);
  if (f == 3) return vec3(st.x, -1.0, st.y);
  if (f == 4) return vec3(st.x, st.y, 1.0);
  return vec3(-st.x, st.y, -1.0);
}
vec2 stOnFace(int f, vec3 d) {
  if (f == 0) return vec2(-d.z, d.y) / d.x;
  if (f == 1) return vec2(d.z, d.y) / -d.x;
  if (f == 2) return vec2(d.x, -d.z) / d.y;
  if (f == 3) return vec2(d.x, d.z) / -d.y;
  if (f == 4) return vec2(d.x, d.y) / d.z;
  return vec2(-d.x, d.y) / -d.z;
}
int faceOf(vec3 d) {
  vec3 a = abs(d);
  if (a.x >= a.y && a.x >= a.z) return d.x > 0.0 ? 0 : 1;
  if (a.y >= a.z) return d.y > 0.0 ? 2 : 3;
  return d.z > 0.0 ? 4 : 5;
}
`;

const NBR_FS = `#version 300 es
precision highp float; precision highp int;
uniform int uN;
layout(location = 0) out uvec4 oA;
layout(location = 1) out uvec4 oB;
${CUBE}
const ivec2 OFF[8] = ivec2[8](ivec2(1,0), ivec2(1,1), ivec2(0,1), ivec2(-1,1), ivec2(-1,0), ivec2(-1,-1), ivec2(0,-1), ivec2(1,-1));
uint pack(int f, ivec2 c, int back) {
  ivec2 a = ivec2((f % 3) * uN + c.x, (f / 3) * uN + c.y);
  return uint(a.x) | (uint(a.y) << 12) | (uint(back) << 24);
}
// the cell one step in direction k from cell c of face f: in the face's own grid, or across a seam by geometry
void step1(int f, ivec2 c, int k, out int g, out ivec2 cq) {
  ivec2 q = c + OFF[k];
  if (q.x >= 0 && q.y >= 0 && q.x < uN && q.y < uN) { g = f; cq = q; return; }
  float fn = float(uN);
  vec2 ab2 = ((vec2(c) + 0.5) / fn * 2.0 - 1.0) + vec2(OFF[k]) * 2.0 / fn;
  vec3 Q = normalize(faceDir(f, tan(ab2 * QP)));
  g = faceOf(Q);
  vec2 abq = atan(stOnFace(g, Q)) / QP;
  cq = clamp(ivec2(floor((abq + 1.0) * 0.5 * fn)), ivec2(0), ivec2(uN - 1));
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int f = p.x / uN + 3 * (p.y / uN);
  ivec2 c = ivec2(p.x % uN, p.y % uN);
  float fn = float(uN);
  vec3 P = normalize(faceDir(f, tan(((vec2(c) + 0.5) / fn * 2.0 - 1.0) * QP)));
  uint code[8];
  for (int k = 0; k < 8; k++) {
    int g; ivec2 cq;
    step1(f, c, k, g, cq);
    if (g == f) { code[k] = pack(f, cq, (k + 4) % 8); continue; }
    // the way back: the direction from that cell whose own step lands here (orthogonal first, so gases keep their
    // particles); if none does (cube corners), the nearest direction by geometry
    int back = -1;
    for (int j = 0; j < 8; j++) {
      int k2 = (k & 1) == 0 ? (j < 4 ? 2 * j : 2 * (j - 4) + 1) : (j < 4 ? 2 * j + 1 : 2 * (j - 4));
      int g2; ivec2 c2; step1(g, cq, k2, g2, c2);
      if (g2 == f && c2 == c) { back = k2; break; }
    }
    if (back < 0) {
      vec2 dl = atan(stOnFace(g, P)) / QP - ((vec2(cq) + 0.5) / fn * 2.0 - 1.0);
      back = int(mod(floor(atan(dl.y, dl.x) / QP + 0.5) + 8.0, 8.0));
    }
    code[k] = pack(g, cq, back);
  }
  oA = uvec4(code[0], code[1], code[2], code[3]);
  oB = uvec4(code[4], code[5], code[6], code[7]);
}`;

const COMMON = `#version 300 es
precision highp float; precision highp int; precision highp usampler2D;
uniform usampler2D uS, uNA, uNB;
uniform int uN, uRule;
uniform uint uFrame;
${CUBE}
uvec3 pcg3(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
float rnd(uint h) { return float(h & 0xffffffu) / 16777216.0; }
uint S[8]; uint BK[8];
void gather(ivec2 p) {
  uvec4 A = texelFetch(uNA, p, 0), B = texelFetch(uNB, p, 0);
  uint code[8] = uint[8](A.x, A.y, A.z, A.w, B.x, B.y, B.z, B.w);
  for (int k = 0; k < 8; k++) {
    S[k] = texelFetch(uS, ivec2(int(code[k] & 4095u), int((code[k] >> 12) & 4095u)), 0).r;
    BK[k] = code[k] >> 24;
  }
}
vec3 cellDir(ivec2 p) {
  int f = p.x / uN + 3 * (p.y / uN);
  vec2 ab = (vec2(p.x % uN, p.y % uN) + 0.5) / float(uN) * 2.0 - 1.0;
  return normalize(faceDir(f, tan(ab * QP)));
}
`;

const STEP_FS = COMMON + `
uniform int uInit, uNSeed;
uniform float uDens, uLeak;
uniform vec4 uSeed[8];
out uvec4 o;

uint sum1() { uint t = 0u; for (int k = 0; k < 8; k++) t += S[k] & 1u; return t; }
uint nluky(uint old, uint s, uint N, uint L, uint U, uint K, uint Y) {
  uint n = 0u;
  if (old == 0u && L <= s && s <= U) n = 1u;
  if (old == 1u) n = (K <= s && s <= Y) ? 1u : 2u;
  if ((old & 1u) == 0u && 0u < old && old < 2u * N) n = old + 2u;
  return n;
}
// HPP gases: direction k (0 E, 1 NE, 2 N, ... 7 SE) lives in bit k/2 (orthogonal gas) or 4 + k/2 (diagonal gas)
uint dbit(uint k) { return (k & 1u) == 0u ? k >> 1 : 4u + (k >> 1); }
uint collide(uint x) {
  uint t = x & 15u, d = (x >> 4) & 15u;
  if (t == 5u) t = 10u; else if (t == 10u) t = 5u;
  if (d == 5u) d = 10u; else if (d == 10u) d = 5u;
  return t | (d << 4);
}
uint stream(bool diag) {
  uint n = 0u;
  for (uint k = 0u; k < 8u; k++) {
    if (!diag && (k & 1u) == 1u) continue;
    uint j = (k + 4u) & 7u;
    uint q = collide(S[j]);
    n |= ((q >> dbit(BK[j])) & 1u) << dbit(k);
  }
  return n;
}

uint stepRule(uint old, uint h) {
  uint self = old & 1u;
  if (uRule == 0) return nluky(old, sum1(), 8u, 2u, 3u, 2u, 2u);                   // RainZha
  if (uRule == 1) {                                                                // Zhabotinsky (Margolus & Toffoli)
    uint s = sum1();
    uint alarmset = (old >> 3) & 1u, time = (old >> 1) & 3u;
    uint newself = time == 0u ? 1u : 0u;
    time = time > 0u ? time - 1u : 0u;
    if (self == 1u && alarmset == 1u) time = 3u;
    uint alarm = (s == 2u || s > 3u) ? 1u : 0u;
    return (alarm << 3) | (time << 1) | newself;
  }
  if (uRule == 2) {                                                                // Brian's Brain
    if (old == 2u) return 0u;
    if (old == 1u) return 2u;
    return sum1() + self == 2u ? 1u : 0u;
  }
  if (uRule == 3) return nluky(old, sum1(), 127u, 2u, 2u, 2u, 2u);               // Faders
  if (uRule == 4) {                                                                // Rug (semi8)
    uint s = 0u; for (int k = 0; k < 8; k++) s += S[k] & 255u;
    return ((s >> 3) + 1u) & 255u;
  }
  if (uRule == 5) {                                                                // Hodge (world type 10)
    uint s = 0u; for (int k = 0; k < 8; k++) s += S[k] & 31u;
    uint t = 0u;
    if (old == 0u) t = s < 5u ? 0u : (s < 100u ? 2u : 3u);
    else if (old < 31u) t = ((s >> 3) + 5u) & 255u;
    if (t > 31u) t = 31u;
    if (old == 31u) t = 0u;
    return t;
  }
  if (uRule == 6) {                                                                // Venus
    uint e = S[0] & 1u, ne = S[1] & 1u, n = S[2] & 1u, nw = S[3] & 1u, w = S[4] & 1u, sw = S[5] & 1u, s = S[6] & 1u, se = S[7] & 1u;
    uint d = old & 3u;
    if (d == 0u) return 2u * (nw ^ sw) + w;
    if (d == 1u) return 2u * (nw ^ ne) + n;
    if (d == 2u) return 2u * (ne ^ se) + e;
    return 2u * (se ^ sw) + s;
  }
  if (uRule == 7) { uint s = sum1(); return self == 1u ? ((s == 2u || s == 3u) ? 1u : 0u) : (s == 3u ? 1u : 0u); }   // Life
  if (uRule == 8) {                                                                // Perfume (HPP gas) with a slow leak
    uint n = stream(false);
    if (n != 0u && rnd(h >> 3) < uLeak) n &= ~(1u << ((h >> 1) & 3u));
    return n;
  }
  return stream(true);                                                             // Pond (orthogonal + diagonal gas)
}

uint initState(uint h, uint h2) {
  float r = rnd(h), r2 = rnd(h2);
  bool on = r < uDens;
  if (uRule == 0) return on ? (r2 < 0.3 ? 1u : 2u * (1u + (h2 >> 4) % 8u)) : 0u;
  if (uRule == 1) return on ? (h2 & 15u) : 0u;
  if (uRule == 2) return on ? (r2 < 0.5 ? 1u : 2u) : 0u;
  if (uRule == 3) return on ? (r2 < 0.1 ? 1u : 2u * (1u + (h2 >> 4) % 126u)) : 0u;
  if (uRule == 4) return h2 & 255u;
  if (uRule == 5) return on ? (h2 % 32u) : 0u;
  if (uRule == 6) return h2 & 3u;
  if (uRule == 7) return r < uDens * 0.5 ? 1u : 0u;
  if (uRule == 8) return r < 0.03 ? (h2 & 15u) : 0u;
  uint g = 0u; for (uint b = 0u; b < 8u; b++) if (rnd(h2 >> b ^ (h * (b + 1u))) < 0.42) g |= 1u << b;
  return g;
}
uint seedState(uint cur, uint h, uint h2) {
  if (uRule == 0 || uRule == 2 || uRule == 3 || uRule == 7) return 1u;
  if (uRule == 1) return 1u | (h2 & 8u);
  if (uRule == 4) return (cur + 96u + (h2 & 63u)) & 255u;
  if (uRule == 5) return 1u + h2 % 30u;
  if (uRule == 6) return h2 & 3u;
  if (uRule == 8) return cur | (h2 & 15u);
  return 255u;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  uvec3 hh = pcg3(uvec3(uvec2(p), uFrame));
  if (uInit == 1) { o = uvec4(initState(hh.x, hh.y), 0u, 0u, 0u); return; }
  uint old = texelFetch(uS, p, 0).r;
  gather(p);
  uint n = stepRule(old, hh.z);
  if (uNSeed > 0) {
    vec3 P = cellDir(p);
    for (int i = 0; i < 8; i++) {
      if (i >= uNSeed) break;
      float c = dot(P, uSeed[i].xyz);
      if (c > uSeed[i].w) {
        // denser at the centre of the drop
        float u = (c - uSeed[i].w) / (1.0 - uSeed[i].w);
        if (uRule == 4) n = (n + uint(150.0 * u)) & 255u;   // rug: a smooth bump, which melts out as rings
        else if (rnd(hh.x) < uDens * (0.35 + 0.65 * u)) n = seedState(n, hh.y, hh.z);
      }
    }
  }
  o = uvec4(n, 0u, 0u, 0u);
}`;

// state -> palette index, height (0..1)
const LOOK_FS = COMMON + `
uniform sampler2D uPrev, uPal;
uniform float uKeep, uBlur;
uniform int uPalMode;   // 0: CelLab palette by state, 1: gradient by activity
out vec4 o;
uint popc(uint x) { x = x - ((x >> 1) & 0x55u); x = (x & 0x33u) + ((x >> 2) & 0x33u); return (x + (x >> 4)) & 0x0fu; }
float hOf(uint s) {
  if (uRule == 0) return s == 0u ? 0.0 : (s == 1u ? 1.0 : 1.0 - float(s) / 17.0);
  if (uRule == 1) return float(s & 1u) * 0.35 + float((s >> 1) & 3u) / 3.0 * 0.65;
  if (uRule == 2) return s == 1u ? 1.0 : (s == 2u ? 0.45 : 0.0);
  if (uRule == 3) return s == 0u ? 0.0 : (s == 1u ? 1.0 : 1.0 - float(s) / 256.0);
  if (uRule == 4) return 0.5 - 0.5 * cos(6.2831853 * float(s & 255u) / 256.0);
  if (uRule == 5) return float(s) / 31.0;
  if (uRule == 6) return float(s & 1u) * 0.7 + float((s >> 1) & 1u) * 0.3;
  if (uRule == 7) return float(s & 1u);
  if (uRule == 8) return float(popc(s & 15u)) / 2.0;
  return float(popc(s & 255u)) / 8.0;
}
uint idxOf(uint s) {
  if (uRule == 8) return min(popc(s & 15u), 4u);
  if (uRule == 9) return ((s & 15u) == 15u ? 2u : 0u) | ((s & 240u) == 240u ? 4u : 0u) | (popc(s) >= 6u ? 6u : 0u);
  return s & 255u;
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  uint s = texelFetch(uS, p, 0).r;
  gather(p);
  float hs = hOf(s), hn = 0.0;
  for (int k = 0; k < 8; k++) hn += hOf(S[k]);
  float h = mix(hs, (hs * 2.0 + hn) / 10.0, uBlur);
  vec3 col = texelFetch(uPal, ivec2(int(idxOf(s)), 0), 0).rgb;
  if (uPalMode == 1) col = texelFetch(uPal, ivec2(int(clamp(uRule == 8 ? h * 4.0 : uRule == 9 ? h * 1.6 : mix(hs, h, 0.5), 0.0, 1.0) * 255.0), 0), 0).rgb;
  else if (uRule == 8 || uRule == 9) {   // gases: show the local density, not single particles
    vec3 cn = vec3(0.0); for (int k = 0; k < 8; k++) cn += texelFetch(uPal, ivec2(int(idxOf(S[k])), 0), 0).rgb;
    col = (col * 2.0 + cn) / 10.0;
  }
  vec4 prev = texelFetch(uPrev, p, 0);
  o = mix(vec4(col, h), prev, uKeep);
}`;

const RENDER_FS = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uLook;
uniform int uN;
uniform vec2 uRes;
uniform mat3 uRot;
uniform float uAmp, uTint, uGlow, uTime, uPulse, uAspect;
in vec2 vUv;
out vec4 o;
${CUBE}
vec4 look(vec3 d) {
  int f = faceOf(d);
  vec2 ab = atan(stOnFace(f, d)) / QP;
  float fn = float(uN);
  vec2 c = clamp((ab + 1.0) * 0.5 * fn, vec2(0.5), vec2(fn - 0.5));
  vec2 uv = (vec2(float(f % 3), float(f / 3)) * fn + c) / vec2(3.0 * fn, 2.0 * fn);
  return textureLod(uLook, uv, 0.0);
}
float rad(vec3 d) { return 1.0 + uAmp * look(d).a; }
vec3 env(vec3 r) {
  float y = r.y;
  vec3 c = mix(vec3(0.015, 0.016, 0.022), vec3(0.16, 0.17, 0.2), smoothstep(-0.5, 0.9, y));
  c += vec3(1.0, 0.95, 0.88) * pow(max(dot(r, normalize(vec3(-0.55, 0.65, 0.55))), 0.0), 60.0) * 4.0;
  c += vec3(1.0, 0.97, 0.92) * smoothstep(0.9, 0.97, dot(r, normalize(vec3(-0.4, 0.75, 0.3)))) * 1.2;
  c += vec3(0.55, 0.68, 1.0) * pow(max(dot(r, normalize(vec3(0.8, 0.15, -0.3))), 0.0), 14.0) * 0.9;
  c += vec3(0.9, 0.6, 0.4) * pow(max(dot(r, normalize(vec3(0.2, -0.8, 0.5))), 0.0), 8.0) * 0.25;
  c += vec3(0.3) * exp(-abs(y - 0.08) * 6.0) * 0.12;
  return c;
}
vec3 toLin(vec3 c) { return pow(c, vec3(2.2)); }
void main() {
  vec2 q = (vUv * 2.0 - 1.0) * vec2(uAspect, 1.0);
  vec3 ro = vec3(0.0, 0.0, 3.3), rd = normalize(vec3(q * 0.52, -1.0));
  vec3 bg = mix(vec3(0.012, 0.012, 0.016), vec3(0.04, 0.042, 0.05), 1.0 - length(q) * 0.6);
  // into the body's frame
  vec3 o3 = uRot * ro, d3 = uRot * rd;
  float R = 1.0 + uAmp + 0.002;
  float b = dot(o3, d3), cc = dot(o3, o3) - R * R, disc = b * b - cc;
  vec3 col = bg;
  float alpha = 0.0;
  // a faint aura around the body
  float near = length(cross(o3, d3));
  col += vec3(0.25, 0.27, 0.32) * exp(-max(near - 1.0, 0.0) * 9.0) * (0.25 + 0.4 * uPulse) * 0.35;
  if (disc > 0.0) {
    float t = -b - sqrt(disc), tEnd = -b + sqrt(disc);
    bool hit = false; vec3 p;
    for (int i = 0; i < 72; i++) {
      p = o3 + d3 * t;
      float r = length(p);
      float dd = r - rad(p / r);
      if (dd < 0.0006) { hit = true; break; }
      t += dd * 0.8;
      if (t > tEnd) break;
    }
    if (hit) {
      vec3 n0 = normalize(p);
      vec3 up = abs(n0.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
      vec3 e1 = normalize(cross(up, n0)), e2 = cross(n0, e1);
      float eps = 1.6 / float(uN);
      float hx = look(normalize(n0 + e1 * eps)).a - look(normalize(n0 - e1 * eps)).a;
      float hy = look(normalize(n0 + e2 * eps)).a - look(normalize(n0 - e2 * eps)).a;
      vec4 L = look(n0);
      float r0 = 1.0 + uAmp * L.a;
      vec3 n = normalize(n0 - uAmp * (hx * e1 + hy * e2) / (2.0 * eps * r0));
      vec3 pal = toLin(L.rgb);
      vec3 v = -d3;
      float ndv = max(dot(n, v), 0.0);
      vec3 F0 = mix(vec3(0.72, 0.74, 0.78), max(pal, vec3(0.04)), uTint);
      vec3 F = F0 + (1.0 - F0) * pow(1.0 - ndv, 5.0);
      // the environment is fixed in the world: reflect in the body's frame, then rotate back out
      vec3 rw = transpose(uRot) * reflect(d3, n);
      float ao = 0.55 + 0.45 * smoothstep(0.0, 0.7, L.a);
      col = env(rw) * F * ao;
      float lum = dot(pal, vec3(0.3, 0.5, 0.2));
      col += pal * uGlow * (0.15 + 0.85 * L.a) * (0.6 + 0.4 * uPulse) * (0.5 + 0.5 * smoothstep(0.02, 0.3, lum));
      col += vec3(0.5, 0.55, 0.65) * pow(1.0 - ndv, 3.0) * 0.12;
    }
  }
  col = 1.0 - exp(-col * 1.15);
  o = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}`;

export function createSphere2D(gl, { N = 256, half = true } = {}) {
  const W = 3 * N, H = 2 * N;
  const pNbr = compile(gl, VS, NBR_FS, 'neighbours');
  const pStep = compile(gl, VS, STEP_FS, 'step2d');
  const pLook = compile(gl, VS, LOOK_FS, 'look2d');
  const pRender = compile(gl, VS, RENDER_FS, 'render2d');
  const lookKind = half ? 'f16' : 'rgba8';

  // neighbour tables: two RGBA32UI targets written at once
  const nA = target(gl, W, H, 'u32x4'), nB = target(gl, W, H, 'u32x4');
  const fbN = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbN);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, nA.t, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, nB.t, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  const S = [target(gl, W, H, 'u32'), target(gl, W, H, 'u32')];
  const Lk = [target(gl, W, H, lookKind), target(gl, W, H, lookKind)];
  let cur = 0, lk = 0, frame = 1, palMode = 0;
  const palTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, palTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  return {
    N, W, H,
    build(draw) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbN); gl.viewport(0, 0, W, H);
      gl.useProgram(pNbr.p); gl.uniform1i(pNbr.u.uN, N); draw();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
    setPalette(rgba, mode = 0) { palMode = mode; gl.bindTexture(gl.TEXTURE_2D, palTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba); },
    // init: true re-randomizes; seeds: [{ x, y, z, r (radians) }]
    step(draw, { rule, init = false, seeds = [], dens = 0.5, leak = 0.002 }) {
      const dst = S[1 - cur];
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb); gl.viewport(0, 0, W, H);
      const u = pStep.u; gl.useProgram(pStep.p);
      gl.uniform1i(u.uS, bindTex(gl, 0, S[cur].t)); gl.uniform1i(u.uNA, bindTex(gl, 1, nA.t)); gl.uniform1i(u.uNB, bindTex(gl, 2, nB.t));
      gl.uniform1i(u.uN, N); gl.uniform1i(u.uRule, rule); gl.uniform1ui(u.uFrame, frame++);
      gl.uniform1i(u.uInit, init ? 1 : 0); gl.uniform1f(u.uDens, dens); gl.uniform1f(u.uLeak, leak);
      const sd = new Float32Array(32), n = Math.min(8, seeds.length);
      for (let i = 0; i < n; i++) { const s = seeds[i]; sd.set([s.x, s.y, s.z, Math.cos(s.r)], 4 * i); }
      gl.uniform4fv(u.uSeed, sd); gl.uniform1i(u.uNSeed, n);
      draw();
      cur = 1 - cur;
    },
    look(draw, { rule, keep = 0.3, blur = 0.5 }) {
      const dst = Lk[1 - lk];
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb); gl.viewport(0, 0, W, H);
      const u = pLook.u; gl.useProgram(pLook.p);
      gl.uniform1i(u.uS, bindTex(gl, 0, S[cur].t)); gl.uniform1i(u.uNA, bindTex(gl, 1, nA.t)); gl.uniform1i(u.uNB, bindTex(gl, 2, nB.t));
      gl.uniform1i(u.uPrev, bindTex(gl, 3, Lk[lk].t)); gl.uniform1i(u.uPal, bindTex(gl, 4, palTex));
      gl.uniform1i(u.uN, N); gl.uniform1i(u.uRule, rule); gl.uniform1ui(u.uFrame, frame);
      gl.uniform1f(u.uKeep, keep); gl.uniform1f(u.uBlur, blur); gl.uniform1i(u.uPalMode, palMode);
      draw();
      lk = 1 - lk;
    },
    render(draw, { w, h, rot, amp, tint, glow, time, pulse }) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h);
      const u = pRender.u; gl.useProgram(pRender.p);
      gl.uniform1i(u.uLook, bindTex(gl, 0, Lk[lk].t)); gl.uniform1i(u.uN, N);
      gl.uniform2f(u.uRes, w, h); gl.uniform1f(u.uAspect, w / h);
      gl.uniformMatrix3fv(u.uRot, false, rot);
      gl.uniform1f(u.uAmp, amp); gl.uniform1f(u.uTint, tint); gl.uniform1f(u.uGlow, glow); gl.uniform1f(u.uTime, time); gl.uniform1f(u.uPulse, pulse);
      draw();
    },
    // for a test: read the neighbour table and the state back (small, CPU)
    readTables() {
      const a = new Uint32Array(W * H * 4), b = new Uint32Array(W * H * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, nA.fb); gl.readPixels(0, 0, W, H, gl.RGBA_INTEGER, gl.UNSIGNED_INT, a);
      gl.bindFramebuffer(gl.FRAMEBUFFER, nB.fb); gl.readPixels(0, 0, W, H, gl.RGBA_INTEGER, gl.UNSIGNED_INT, b);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { a, b };
    },
    readState() {
      // R32UI reads back as RGBA_INTEGER / UNSIGNED_INT
      const o = new Uint32Array(W * H * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, S[cur].fb); gl.readPixels(0, 0, W, H, gl.RGBA_INTEGER, gl.UNSIGNED_INT, o);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const s = new Uint32Array(W * H); for (let i = 0; i < s.length; i++) s[i] = o[4 * i];
      return s;
    },
  };
}
