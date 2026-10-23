// being/cellab/gpu.mjs - the CelLab automata on ON's own WebGL2 context: one on the body's surface, one inside it.
// Ported from the lab gallery (lab/prototypes/cellab/sphere2d.mjs, volume3d.mjs). Rules after CelLab / WebCA by Rudy
// Rucker and John Walker (https://www.fourmilab.ch/cellab/), public domain; see rules.mjs.
//
// The passes are raw WebGL2 (integer state textures, a two-target neighbour table), drawn between three.js renders; the
// page calls renderer.resetState() after them. Their results reach three as ExternalTextures (no copies):
//   surface: the sphere as an equi-angular cube, six faces of N x N cells packed 3 x 2 in one atlas. A cell's eight
//     neighbours are found once on the GPU by geometry (so neighbours across a seam are the true neighbours on the
//     sphere, plus the way back for the gases). Rule semantics follow CelLab: 8-bit state; lookup-table rules see a
//     neighbour through its bit 0; Rug sums full bytes (semi8), Hodge the low five bits (world type 10). The look pass
//     turns states into the rule's palette colour (rgb) and a height (a), blurred a little in space and time; the body
//     samples it with CA_GLSL as relief, pattern and stain.
//   inside: a G^3 volume clipped to a ball, its slices in a 2D atlas (8 per row): 26 neighbours by texelFetch, a look
//     pass to colour + density, and volumeFragment() ray-marches it inside the shell at half resolution.

const VS = `#version 300 es
layout(location = 0) in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

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

// the body's view of the surface automaton (same cube as above, uCaN cells a face): rgb palette colour, a height
export const CA_GLSL = /* glsl */`
  const float CA_QP = .78539816;
  vec2 caSt( int f, vec3 d ) {
    if ( f == 0 ) return vec2( - d.z, d.y ) / d.x;
    if ( f == 1 ) return vec2( d.z, d.y ) / - d.x;
    if ( f == 2 ) return vec2( d.x, - d.z ) / d.y;
    if ( f == 3 ) return vec2( d.x, d.z ) / - d.y;
    if ( f == 4 ) return vec2( d.x, d.y ) / d.z;
    return vec2( - d.x, d.y ) / - d.z;
  }
  vec4 caLook( vec3 d ) {
    vec3 a = abs( d ); int f = a.x >= a.y && a.x >= a.z ? ( d.x > 0. ? 0 : 1 ) : a.y >= a.z ? ( d.y > 0. ? 2 : 3 ) : ( d.z > 0. ? 4 : 5 );
    vec2 c = clamp( ( atan( caSt( f, d ) ) / CA_QP + 1. ) * .5 * uCaN, vec2( .5 ), vec2( uCaN - .5 ) );
    return textureLod( uCa, ( vec2( float( f % 3 ), float( f / 3 ) ) * uCaN + c ) / vec2( 3. * uCaN, 2. * uCaN ), 0. );
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

const COMMON2 = `#version 300 es
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

const STEP2_FS = COMMON2 + `
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
        float u = (c - uSeed[i].w) / (1.0 - uSeed[i].w);
        if (uRule == 4) n = (n + uint(150.0 * u)) & 255u;
        else if (rnd(hh.x) < uDens * (0.35 + 0.65 * u)) n = seedState(n, hh.y, hh.z);
      }
    }
  }
  o = uvec4(n, 0u, 0u, 0u);
}`;

const LOOK2_FS = COMMON2 + `
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
  else if (uRule == 8 || uRule == 9) {
    vec3 cn = vec3(0.0); for (int k = 0; k < 8; k++) cn += texelFetch(uPal, ivec2(int(idxOf(S[k])), 0), 0).rgb;
    col = (col * 2.0 + cn) / 10.0;
  }
  vec4 prev = texelFetch(uPrev, p, 0);
  o = mix(vec4(col, clamp(h, 0.0, 1.0)), prev, uKeep);
}`;

const COMMON3 = (G) => `#version 300 es
precision highp float; precision highp int; precision highp usampler2D;
uniform usampler2D uS;
uniform int uRule;
uniform uint uFrame;
const int G = ${G}, TL = 8;
ivec3 vox(ivec2 p) { return ivec3(p.x % G, p.y % G, (p.y / G) * TL + p.x / G); }
ivec2 tex(ivec3 v) { return ivec2((v.z % TL) * G + v.x, (v.z / TL) * G + v.y); }
bool inside(ivec3 v) { vec3 d = vec3(v) + 0.5 - float(G) * 0.5; return dot(d, d) < (float(G) * 0.5 - 1.0) * (float(G) * 0.5 - 1.0); }
uint at(ivec3 v) { return texelFetch(uS, tex(clamp(v, ivec3(0), ivec3(G - 1))), 0).r; }
uvec3 pcg3(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
float rnd(uint h) { return float(h & 0xffffffu) / 16777216.0; }
`;

const STEP3_FS = (G) => COMMON3(G) + `
uniform int uInit, uNSeed;
uniform float uDens;
uniform vec4 uSeed[8];
uniform vec4 uSeedN[8];
uniform uvec4 uP;
out uvec4 o;
uint stepRule(uint old, ivec3 v, uint h) {
  uint c1 = 0u, sum = 0u, cnt = 0u;
  float wex = 0.0;
  for (int dz = -1; dz <= 1; dz++) for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
    int m = abs(dx) + abs(dy) + abs(dz);
    if (m == 0) continue;
    uint s = at(v + ivec3(dx, dy, dz));
    c1 += s == 1u ? 1u : 0u;
    wex += (s >= 1u && s <= uP.y) ? (m == 1 ? 1.0 : m == 2 ? 0.6 : 0.35) : 0.0;
    sum += s;
    cnt += inside(v + ivec3(dx, dy, dz)) ? 1u : 0u;
  }
  if (uRule == 0) {   // scroll waves: Greenberg-Hastings with a soft, noisy threshold; uP = (threshold x10, excited, refractory)
    if (old > 0u) return old >= uP.y + uP.z ? 0u : old + 1u;
    float T = float(uP.x) * 0.1;
    return rnd(h) < smoothstep(T * 0.45, T * 1.25, wex) ? 1u : 0u;
  }
  if (uRule == 1) {   // Brian's Brain 3D; uP = (birth lo, birth hi, last refractory state)
    if (old >= 1u) return old >= uP.z ? 0u : old + 1u;
    return (c1 >= uP.x && c1 <= uP.y) ? 1u : 0u;
  }
  if (uRule == 2) {   // generations Life; uP = (survive mask, birth mask, states)
    if (old >= 2u) return old + 1u >= uP.z ? 0u : old + 1u;
    if (old == 1u) return ((uP.x >> c1) & 1u) == 1u ? 1u : (uP.z > 2u ? 2u : 0u);
    return ((uP.y >> c1) & 1u) == 1u ? 1u : 0u;
  }
  return (sum / max(cnt, 1u) + 1u) & 255u;   // Rug 3D
}
uint initState(uint h, uint h2) {
  float r = rnd(h);
  if (uRule == 0) return r < 0.015 * uDens ? 1u : (r < 0.25 * uDens ? 2u + h2 % (uP.y + uP.z - 1u) : 0u);
  if (uRule == 1) return r < 0.08 * uDens ? 1u : 0u;
  if (uRule == 2) return r < uDens ? 1u : 0u;
  return h2 & 255u;
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec3 v = vox(p);
  if (!inside(v)) { o = uvec4(0u); return; }
  uvec3 hh = pcg3(uvec3(uvec2(p), uFrame));
  if (uInit == 1) { o = uvec4(initState(hh.x, hh.y), 0u, 0u, 0u); return; }
  uint old = texelFetch(uS, p, 0).r;
  uint n = stepRule(old, v, hh.z);
  if (uNSeed > 0) {
    vec3 P = (vec3(v) + 0.5) / float(G) * 2.0 - 1.0;
    for (int i = 0; i < 8; i++) {
      if (i >= uNSeed) break;
      vec3 d = P - uSeed[i].xyz;
      float r = length(d);
      if (r < uSeed[i].w && (uRule == 3 || rnd(hh.x) < uDens * (1.0 - 0.6 * r / uSeed[i].w))) {
        if (uRule == 0) n = dot(d, uSeedN[i].xyz) > 0.0 ? 1u : uP.y + 1u + uP.z / 3u;
        else if (uRule == 1) n = 1u;
        else if (uRule == 2) n = 1u;
        else n = (old + uint(150.0 * (1.0 - r / uSeed[i].w))) & 255u;
      }
    }
  }
  o = uvec4(n, 0u, 0u, 0u);
}`;

const LOOK3_FS = (G) => COMMON3(G) + `
uniform sampler2D uPrev, uPal;
uniform uvec4 uP;
uniform float uKeep;
uniform int uPalMode;
out vec4 o;
void look(uint s, out float a, out float g, out uint idx) {
  a = 0.0; g = 0.0; idx = s & 255u;
  if (uRule == 0) {
    uint E = uP.y, R = uP.z;
    float k = s > E ? float(s - E) / float(R) : 0.0;
    a = s == 0u ? 0.0 : (s <= E ? 1.0 : 0.25 * pow(1.0 - k, 3.0));
    g = s == 0u ? 0.0 : (s <= E ? 1.0 : 0.75 * (1.0 - k));
    idx = s == 0u ? 0u : 1u + (s * 14u) / (E + R);
  } else if (uRule == 1) {
    a = s == 1u ? 1.0 : (s >= 2u ? 0.12 * (1.0 - float(s - 2u) / float(uP.z)) : 0.0);
    g = s == 1u ? 1.0 : (s >= 2u ? 0.45 * (1.0 - float(s - 2u) / float(uP.z)) : 0.0);
    idx = min(s, 3u);
  } else if (uRule == 2) {
    float k = s >= 2u ? float(s - 1u) / float(max(uP.z, 2u) - 1u) : 0.0;
    a = s == 1u ? 1.0 : (s >= 2u ? 0.35 * (1.0 - k) : 0.0);
    g = s == 1u ? 1.0 : (s >= 2u ? 0.7 * (1.0 - k) : 0.0);
    idx = s == 1u ? 1u : (s == 0u ? 0u : 2u + s);
  } else {
    g = float(s) / 255.0;
  }
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec3 v = vox(p);
  uint s = texelFetch(uS, p, 0).r;
  float a, g; uint idx;
  look(s, a, g, idx);
  float an = 0.0, gn = 0.0, wn = 0.0, d = 0.0, dn = 0.0;
  for (int dz = -1; dz <= 1; dz++) for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
    int m = abs(dx) + abs(dy) + abs(dz);
    if (m == 0) continue;
    ivec3 q = v + ivec3(dx, dy, dz);
    if (!inside(q)) continue;
    float w = m == 1 ? 1.0 : m == 2 ? 0.5 : 0.25;
    uint sq = at(q);
    if (uRule == 3) { int e = abs(int(sq) - int(s)); d += w * float(min(e, 256 - e)); dn += w; continue; }
    float a2, g2; uint i2; look(sq, a2, g2, i2); an += w * a2; gn += w * g2; wn += w;
  }
  if (uRule == 3) a = inside(v) && dn > 0.0 ? smoothstep(2.0, 24.0, d / dn) : 0.0;
  else if (wn > 0.0) { a = 0.35 * a + 0.65 * an / wn; g = max(g * 0.8, gn / wn); }
  vec3 col = uPalMode == 1 ? texelFetch(uPal, ivec2(int(clamp(g, 0.0, 1.0) * 255.0), 0), 0).rgb
                           : texelFetch(uPal, ivec2(int(idx), 0), 0).rgb;
  vec4 prev = texelFetch(uPrev, p, 0);
  o = mix(vec4(col, a), prev, uKeep);
}`;

/** the inside, ray-marched at half resolution in the body's own camera (three.js ShaderMaterial; the uniforms named as the
 *  body's are the body's own objects). Output: emitted light (rgb) and opacity (a), composited by the body shader. */
export const volumeFragment = (G) => /* glsl */`
  varying vec2 vUv;
  uniform sampler2D uVol; uniform vec2 uRes; uniform vec2 uShift; uniform float uScale; uniform vec2 uLook; uniform float uZoom; uniform float uWide;
  uniform float uShellR; uniform float uCoreR; uniform float uTime; uniform float uDensity; uniform float uGlowV; uniform float uSteps; uniform vec3 uHueC; uniform float uHue;
  const float G = ${G}.0, TL = 8.0, RW = ${G / 8}.0;
  vec4 vol( vec3 u ) {
    vec2 xy = clamp( u.xy * G, vec2( .5 ), vec2( G - .5 ) );
    float z = clamp( u.z * G - .5, 0., G - 1. ), z0 = floor( z ), z1 = min( z0 + 1., G - 1. );
    vec2 t0 = vec2( mod( z0, TL ), floor( z0 / TL ) ) * G, t1 = vec2( mod( z1, TL ), floor( z1 / TL ) ) * G;
    vec2 sz = vec2( G * TL, G * RW );
    return mix( textureLod( uVol, ( t0 + xy ) / sz, 0. ), textureLod( uVol, ( t1 + xy ) / sz, 0. ), z - z0 );
  }
  mat2 rot( float a ) { float c = cos( a ), s = sin( a ); return mat2( c, - s, s, c ); }
  float hash12( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * .1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
  void main() {
    vec2 fc = vUv * uRes;
    vec2 uv0 = ( fc - .5 * uRes ) / uRes.y - uShift, uv = uv0 / uScale;
    vec3 ro = vec3( 0., 0., 4.2 * uZoom );
    ro.yz *= rot( uLook.y * .35 ); ro.xz *= rot( uLook.x * .55 );
    vec3 ww = normalize( - ro ), uu = normalize( cross( ww, vec3( 0., 1., 0. ) ) ), vv = cross( uu, ww );
    vec3 rd = normalize( uu * uv.x + vv * uv.y + ww * 1.6 );
    float R = uShellR * .92;
    // the body is widened along x (map(): p.x /= 1 + uWide): march in its own space, scaled to the unit ball
    vec3 o3 = vec3( ro.x / ( 1. + uWide ), ro.yz ) / R, d3 = vec3( rd.x / ( 1. + uWide ), rd.yz ) / R;
    float a = dot( d3, d3 ), b = dot( o3, d3 ), c = dot( o3, o3 ) - 1., disc = b * b - a * c;
    if ( disc <= 0. ) { gl_FragColor = vec4( 0. ); return; }
    float t0 = max( ( - b - sqrt( disc ) ) / a, 0. ), t1 = ( - b + sqrt( disc ) ) / a;
    float bc = dot( ro, rd ), hc = bc * bc - dot( ro, ro ) + uCoreR * uCoreR;   // the core's light hides what is behind it
    if ( hc > 0. ) t1 = min( t1, - bc - sqrt( hc ) );
    if ( t1 <= t0 ) { gl_FragColor = vec4( 0. ); return; }
    float dt = ( t1 - t0 ) / uSteps, dl = dt * sqrt( a ), t = t0 + dt * hash12( fc + fract( uTime ) * 61. );
    vec3 acc = vec3( 0. ); float tr = 1.;
    for ( int i = 0; i < 96; i++ ) {
      if ( float( i ) >= uSteps || tr < .02 ) break;
      vec3 p = o3 + d3 * t;
      vec4 s = vol( p * .5 + .5 );
      float dens = s.a * uDensity;
      if ( dens > .002 ) {
        vec3 pc = s.rgb * s.rgb; float pl = dot( pc, vec3( .3, .5, .2 ) );
        vec3 e = mix( pc, uHueC * ( .25 + 1.3 * pl ), uHue ) * uGlowV;
        acc += tr * e * dens * dl;
        tr *= exp( - dens * dl * .35 );
      }
      t += dt;
    }
    gl_FragColor = vec4( 1. - exp( - acc ), 1. - tr );   // softly saturated: the inside never outshines the core
  }
`;

export function createCellabGPU(gl, { N = 128, G = 48 } = {}) {
  gl.getExtension('EXT_color_buffer_float');
  const compile = (fsSrc, name) => {
    const mk = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`cellab ${name}: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, VS)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fsSrc));
    gl.bindAttribLocation(p, 0, 'aPos'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`cellab ${name}: ${gl.getProgramInfoLog(p)}`);
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name); }
    return { p, u };
  };
  const target = (w, h, kind) => {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    const F = { u32: [gl.R32UI, gl.RED_INTEGER, gl.UNSIGNED_INT, gl.NEAREST], u32x4: [gl.RGBA32UI, gl.RGBA_INTEGER, gl.UNSIGNED_INT, gl.NEAREST],
      f16: [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR], rgba8: [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR] }[kind];
    gl.texImage2D(gl.TEXTURE_2D, 0, F[0], w, h, 0, F[1], F[2], null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, F[3]); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, F[3]);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`cellab framebuffer ${kind} ${w}x${h} incomplete: 0x${st.toString(16)}`);
    return { t, fb };
  };
  const bindTex = (unit, tex) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); return unit; };
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  // before our passes: three may have left blending, depth, scissor or culling on (the page resets three's state after)
  const begin = () => {
    gl.bindVertexArray(vao); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.STENCIL_TEST);
    gl.colorMask(true, true, true, true); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  };
  const end = () => { gl.bindVertexArray(null); gl.bindFramebuffer(gl.FRAMEBUFFER, null); };
  const draw = () => gl.drawArrays(gl.TRIANGLES, 0, 3);
  const palTex = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(1024)); return t; };
  const seedArrays = (seeds, three) => {
    const sd = new Float32Array(32), sn = new Float32Array(32), n = Math.min(8, seeds.length);
    for (let i = 0; i < n; i++) { const s = seeds[i]; sd.set([s.x, s.y, s.z, three ? s.r : Math.cos(s.r)], 4 * i); if (three) sn.set([s.nx || 0, s.ny || 0, s.nz || 1, 0], 4 * i); }
    return { sd, sn, n };
  };

  function surface() {
    const W = 3 * N, H = 2 * N;
    const pNbr = compile(NBR_FS, 'neighbours'), pStep = compile(STEP2_FS, 'surface step'), pLook = compile(LOOK2_FS, 'surface look');
    const nA = target(W, H, 'u32x4'), nB = target(W, H, 'u32x4');
    const fbN = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbN);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, nA.t, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, nB.t, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    const S = [target(W, H, 'u32'), target(W, H, 'u32')], Lk = [target(W, H, 'f16'), target(W, H, 'f16')], pal = palTex();
    let cur = 0, lk = 0, frame = 1, palMode = 0;
    begin(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbN); gl.viewport(0, 0, W, H); gl.useProgram(pNbr.p); gl.uniform1i(pNbr.u.uN, N); draw();
    for (const l of Lk) { gl.bindFramebuffer(gl.FRAMEBUFFER, l.fb); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
    end();
    return {
      N, W, H,
      get texture() { return Lk[lk].t; },
      setPalette(rgba, mode = 0) { palMode = mode; gl.bindTexture(gl.TEXTURE_2D, pal); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba); },
      step({ rule, init = false, seeds = [], dens = 0.5, leak = 0.0015 }) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, S[1 - cur].fb); gl.viewport(0, 0, W, H);
        const u = pStep.u; gl.useProgram(pStep.p);
        gl.uniform1i(u.uS, bindTex(0, S[cur].t)); gl.uniform1i(u.uNA, bindTex(1, nA.t)); gl.uniform1i(u.uNB, bindTex(2, nB.t));
        gl.uniform1i(u.uN, N); gl.uniform1i(u.uRule, rule); gl.uniform1ui(u.uFrame, frame++);
        gl.uniform1i(u.uInit, init ? 1 : 0); gl.uniform1f(u.uDens, dens); gl.uniform1f(u.uLeak, leak);
        const { sd, n } = seedArrays(seeds, false); gl.uniform4fv(u.uSeed, sd); gl.uniform1i(u.uNSeed, n);
        draw(); cur = 1 - cur;
      },
      look({ rule, keep = 0.3, blur = 0.5 }) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, Lk[1 - lk].fb); gl.viewport(0, 0, W, H);
        const u = pLook.u; gl.useProgram(pLook.p);
        gl.uniform1i(u.uS, bindTex(0, S[cur].t)); gl.uniform1i(u.uNA, bindTex(1, nA.t)); gl.uniform1i(u.uNB, bindTex(2, nB.t));
        gl.uniform1i(u.uPrev, bindTex(3, Lk[lk].t)); gl.uniform1i(u.uPal, bindTex(4, pal));
        gl.uniform1i(u.uN, N); gl.uniform1i(u.uRule, rule); gl.uniform1ui(u.uFrame, frame);
        gl.uniform1f(u.uKeep, keep); gl.uniform1f(u.uBlur, blur); gl.uniform1i(u.uPalMode, palMode);
        draw(); lk = 1 - lk;
      },
      readState() {   // lab/tests: the raw states (CPU)
        const o = new Uint32Array(W * H * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, S[cur].fb); gl.readPixels(0, 0, W, H, gl.RGBA_INTEGER, gl.UNSIGNED_INT, o); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        const s = new Uint32Array(W * H); for (let i = 0; i < s.length; i++) s[i] = o[4 * i]; return s;
      },
    };
  }

  function volume() {
    const W = G * 8, H = G * (G / 8);
    const pStep = compile(STEP3_FS(G), 'inside step'), pLook = compile(LOOK3_FS(G), 'inside look');
    const S = [target(W, H, 'u32'), target(W, H, 'u32')], Lk = [target(W, H, 'rgba8'), target(W, H, 'rgba8')], pal = palTex();
    let cur = 0, lk = 0, frame = 1, palMode = 0; const P = new Uint32Array(4);
    begin(); for (const l of Lk) { gl.bindFramebuffer(gl.FRAMEBUFFER, l.fb); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); } end();
    return {
      G, W, H,
      get texture() { return Lk[lk].t; },
      setPalette(rgba, mode = 0) { palMode = mode; gl.bindTexture(gl.TEXTURE_2D, pal); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba); },
      setParams(p) { P.set(p); },
      step({ rule, init = false, seeds = [], dens = 0.5 }) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, S[1 - cur].fb); gl.viewport(0, 0, W, H);
        const u = pStep.u; gl.useProgram(pStep.p);
        gl.uniform1i(u.uS, bindTex(0, S[cur].t));
        gl.uniform1i(u.uRule, rule); gl.uniform1ui(u.uFrame, frame++); gl.uniform1i(u.uInit, init ? 1 : 0); gl.uniform1f(u.uDens, dens);
        gl.uniform4uiv(u.uP, P);
        const { sd, sn, n } = seedArrays(seeds, true); gl.uniform4fv(u.uSeed, sd); gl.uniform4fv(u.uSeedN, sn); gl.uniform1i(u.uNSeed, n);
        draw(); cur = 1 - cur;
      },
      look({ rule, keep = 0.3 }) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, Lk[1 - lk].fb); gl.viewport(0, 0, W, H);
        const u = pLook.u; gl.useProgram(pLook.p);
        gl.uniform1i(u.uS, bindTex(0, S[cur].t)); gl.uniform1i(u.uPrev, bindTex(1, Lk[lk].t)); gl.uniform1i(u.uPal, bindTex(2, pal));
        gl.uniform1i(u.uRule, rule); gl.uniform4uiv(u.uP, P); gl.uniform1f(u.uKeep, keep); gl.uniform1i(u.uPalMode, palMode);
        draw(); lk = 1 - lk;
      },
    };
  }
  return { begin, end, surface, volume };
}
