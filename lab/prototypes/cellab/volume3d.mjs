// lab/prototypes/cellab/volume3d.mjs - automata living inside the body, in a G^3 volume (G = 64) clipped to the sphere.
//
// WebGL2 cannot render into a 3D texture in one draw, so the state lives in a 2D atlas of 8 x 8 slices (R32UI, one pass
// per step, 26 neighbours by texelFetch). A look pass turns each cell into an RGBA8 colour + density (blended in time)
// in a second atlas, which the renderer samples directly: hardware bilinear inside a slice (clamped half a texel from the
// tile edge), and a manual blend between the two nearest slices. (Copying the slices into a real 3D texture with 64
// copyTexSubImage3D calls cost ~60 ms a frame on ANGLE / D3D11.) The renderer ray-marches the sphere: emission and
// absorption from the volume, one shadow tap toward the key light, a nucleus at the centre and a thin liquid-metal skin
// (Fresnel reflection only) around it.

import { compile, VS, target, bindTex } from './gl.mjs';

const G = 64, T = 8;   // grid, tiles per atlas row

const COMMON = `#version 300 es
precision highp float; precision highp int; precision highp usampler2D;
uniform usampler2D uS;
uniform int uRule;
uniform uint uFrame;
const int G = ${G}, TL = ${T};
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

const STEP_FS = COMMON + `
uniform int uInit, uNSeed;
uniform float uDens;
uniform vec4 uSeed[8];
uniform vec4 uSeedN[8];
uniform uvec4 uP;      // rule parameters
out uvec4 o;

uint stepRule(uint old, ivec3 v, uint h) {
  uint c1 = 0u, sum = 0u, cnt = 0u;
  float wex = 0.0;
  for (int dz = -1; dz <= 1; dz++) for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
    int m = abs(dx) + abs(dy) + abs(dz);
    if (m == 0) continue;
    uint s = at(v + ivec3(dx, dy, dz));
    c1 += s == 1u ? 1u : 0u;
    // excited neighbours weighted by distance (face 1, edge .6, corner .35), so fronts grow round rather than as cubes
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
  return (sum / max(cnt, 1u) + 1u) & 255u;   // Rug 3D: the mean of the neighbours inside the body, plus one
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
        if (uRule == 0) n = dot(d, uSeedN[i].xyz) > 0.0 ? 1u : uP.y + 1u + uP.z / 3u;   // half excited, half refractory: a broken wave
        else if (uRule == 1) n = 1u;
        else if (uRule == 2) n = 1u;
        else n = (old + uint(150.0 * (1.0 - r / uSeed[i].w))) & 255u;   // rug: a smooth bump of ink
      }
    }
  }
  o = uvec4(n, 0u, 0u, 0u);
}`;

const LOOK_FS = COMMON + `
uniform sampler2D uPrev, uPal;
uniform uvec4 uP;
uniform float uKeep;
uniform int uPalMode;   // 0: CelLab palette by state, 1: gradient by activity
out vec4 o;
void look(uint s, out float a, out float g, out uint idx) {
  a = 0.0; g = 0.0; idx = s & 255u;
  if (uRule == 0) {          // scroll waves: the excited front, a short fading wake
    uint E = uP.y, R = uP.z;
    float k = s > E ? float(s - E) / float(R) : 0.0;
    a = s == 0u ? 0.0 : (s <= E ? 1.0 : 0.25 * pow(1.0 - k, 3.0));
    g = s == 0u ? 0.0 : (s <= E ? 1.0 : 0.75 * (1.0 - k));
    idx = s == 0u ? 0u : 1u + (s * 14u) / (E + R);
  } else if (uRule == 1) {   // brain: firing bright, refractory a faint ember
    a = s == 1u ? 1.0 : (s >= 2u ? 0.12 * (1.0 - float(s - 2u) / float(uP.z)) : 0.0);
    g = s == 1u ? 1.0 : (s >= 2u ? 0.45 * (1.0 - float(s - 2u) / float(uP.z)) : 0.0);
    idx = min(s, 3u);
  } else if (uRule == 2) {   // life: alive solid, dying glows out
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
  if (uRule == 3) a = inside(v) && dn > 0.0 ? smoothstep(2.0, 24.0, d / dn) : 0.0;   // rug: show where the melting value changes fast
  else if (wn > 0.0) { a = 0.35 * a + 0.65 * an / wn; g = max(g * 0.8, gn / wn); }
  vec3 col = uPalMode == 1 ? texelFetch(uPal, ivec2(int(clamp(g, 0.0, 1.0) * 255.0), 0), 0).rgb
                           : texelFetch(uPal, ivec2(int(idx), 0), 0).rgb;
  vec4 prev = texelFetch(uPrev, p, 0);
  o = mix(vec4(col, a), prev, uKeep);
}`;

const RENDER_FS = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uVol;
const float G = ${G}.0, TL = ${T}.0;
vec4 vol(vec3 u) {
  vec2 xy = clamp(u.xy * G, vec2(0.5), vec2(G - 0.5));
  float z = clamp(u.z * G - 0.5, 0.0, G - 1.0), z0 = floor(z), z1 = min(z0 + 1.0, G - 1.0);
  vec2 t0 = vec2(mod(z0, TL), floor(z0 / TL)) * G, t1 = vec2(mod(z1, TL), floor(z1 / TL)) * G;
  vec4 a = textureLod(uVol, (t0 + xy) / (G * TL), 0.0), b = textureLod(uVol, (t1 + xy) / (G * TL), 0.0);
  return mix(a, b, z - z0);
}
uniform vec2 uRes;
uniform mat3 uRot;
uniform float uDensity, uGlow, uTime, uPulse, uAspect, uShell, uSteps, uNucleus;
in vec2 vUv;
out vec4 o;
vec3 env(vec3 r) {
  float y = r.y;
  vec3 c = mix(vec3(0.015, 0.016, 0.022), vec3(0.16, 0.17, 0.2), smoothstep(-0.5, 0.9, y));
  c += vec3(1.0, 0.95, 0.88) * pow(max(dot(r, normalize(vec3(-0.55, 0.65, 0.55))), 0.0), 60.0) * 4.0;
  c += vec3(1.0, 0.97, 0.92) * smoothstep(0.9, 0.97, dot(r, normalize(vec3(-0.4, 0.75, 0.3)))) * 1.2;
  c += vec3(0.55, 0.68, 1.0) * pow(max(dot(r, normalize(vec3(0.8, 0.15, -0.3))), 0.0), 14.0) * 0.9;
  c += vec3(0.3) * exp(-abs(y - 0.08) * 6.0) * 0.12;
  return c;
}
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec2 q = (vUv * 2.0 - 1.0) * vec2(uAspect, 1.0);
  vec3 ro = vec3(0.0, 0.0, 3.3), rd = normalize(vec3(q * 0.52, -1.0));
  vec3 bg = mix(vec3(0.012, 0.012, 0.016), vec3(0.04, 0.042, 0.05), 1.0 - length(q) * 0.6);
  vec3 o3 = uRot * ro, d3 = uRot * rd;
  float b = dot(o3, d3), cc = dot(o3, o3) - 1.0, disc = b * b - cc;
  vec3 col = bg;
  float near = length(cross(o3, d3));
  col += vec3(0.25, 0.27, 0.32) * exp(-max(near - 1.0, 0.0) * 9.0) * (0.25 + 0.4 * uPulse) * 0.35;
  if (disc > 0.0) {
    float t0 = -b - sqrt(disc), t1 = -b + sqrt(disc);
    vec3 pn = normalize(o3 + d3 * t0);
    float ndv = max(dot(pn, -d3), 0.0);
    float F = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
    vec3 L = normalize(uRot * vec3(-0.5, 0.7, 0.5));
    int n = int(uSteps);
    float dt = (t1 - t0) / uSteps;
    float t = t0 + dt * hash12(gl_FragCoord.xy + fract(uTime) * 61.0);
    vec3 acc = vec3(0.0); float tr = 1.0;
    for (int i = 0; i < 160; i++) {
      if (i >= n || tr < 0.01) break;
      vec3 p = o3 + d3 * t;
      vec4 s = vol(p * 0.5 + 0.5);
      float dens = s.a * uDensity;
      float r2 = dot(p, p);
      // nucleus: a small hot core that breathes with the pulse
      float nuc = uNucleus * exp(-r2 * 70.0) * (0.6 + 0.8 * uPulse);
      if (dens > 0.002 || nuc > 0.001) {
        float sh = vol((p + L * 0.06) * 0.5 + 0.5).a;
        vec3 e = pow(s.rgb, vec3(2.2)) * uGlow * (0.4 + 0.6 * exp(-sh * uDensity * 0.15));
        acc += tr * (e * dens * dt + vec3(1.0, 0.86, 0.66) * nuc * dt);
        tr *= exp(-dens * dt * 0.35);
      }
      t += dt;
    }
    // a thin liquid-metal skin: reflection at the rim, mostly see-through at the centre
    vec3 rw = transpose(uRot) * reflect(d3, pn);
    vec3 skin = env(rw) * mix(vec3(0.72, 0.74, 0.78), vec3(1.0), F) * uShell * (0.12 + 0.88 * F);
    col = bg * tr * (1.0 - uShell * F) + acc + skin;
  }
  col = 1.0 - exp(-col * 1.15);
  o = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}`;

export function createVolume3D(gl) {
  const W = G * T, H = G * T;
  const pStep = compile(gl, VS, STEP_FS, 'step3d');
  const pLook = compile(gl, VS, LOOK_FS, 'look3d');
  const pRender = compile(gl, VS, RENDER_FS, 'render3d');
  const S = [target(gl, W, H, 'u32'), target(gl, W, H, 'u32')];
  const Lk = [target(gl, W, H, 'rgba8'), target(gl, W, H, 'rgba8')];
  let cur = 0, lk = 0, frame = 1;
  const palTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, palTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const P = new Uint32Array(4);
  let palMode = 0;

  return {
    G,
    setPalette(rgba, mode = 0) { palMode = mode; gl.bindTexture(gl.TEXTURE_2D, palTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba); },
    setParams(p) { P.set(p); },
    // seeds: [{ x, y, z (in -1..1), r, nx, ny, nz }]
    step(draw, { rule, init = false, seeds = [], dens = 0.5 }) {
      const dst = S[1 - cur];
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb); gl.viewport(0, 0, W, H);
      const u = pStep.u; gl.useProgram(pStep.p);
      gl.uniform1i(u.uS, bindTex(gl, 0, S[cur].t));
      gl.uniform1i(u.uRule, rule); gl.uniform1ui(u.uFrame, frame++); gl.uniform1i(u.uInit, init ? 1 : 0); gl.uniform1f(u.uDens, dens);
      gl.uniform4uiv(u.uP, P);
      const sd = new Float32Array(32), sn = new Float32Array(32), n = Math.min(8, seeds.length);
      for (let i = 0; i < n; i++) { const s = seeds[i]; sd.set([s.x, s.y, s.z, s.r], 4 * i); sn.set([s.nx || 0, s.ny || 0, s.nz || 1, 0], 4 * i); }
      gl.uniform4fv(u.uSeed, sd); gl.uniform4fv(u.uSeedN, sn); gl.uniform1i(u.uNSeed, n);
      draw();
      cur = 1 - cur;
    },
    look(draw, { rule, keep = 0.3 }) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, Lk[1 - lk].fb); gl.viewport(0, 0, W, H);
      const u = pLook.u; gl.useProgram(pLook.p);
      gl.uniform1i(u.uS, bindTex(gl, 0, S[cur].t)); gl.uniform1i(u.uPrev, bindTex(gl, 1, Lk[lk].t)); gl.uniform1i(u.uPal, bindTex(gl, 2, palTex));
      gl.uniform1i(u.uRule, rule); gl.uniform4uiv(u.uP, P); gl.uniform1f(u.uKeep, keep); gl.uniform1i(u.uPalMode, palMode);
      draw();
      lk = 1 - lk;
    },
    render(draw, { w, h, rot, density, glow, time, pulse, shell, steps, nucleus }) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h);
      const u = pRender.u; gl.useProgram(pRender.p);
      gl.uniform1i(u.uVol, bindTex(gl, 0, Lk[lk].t));
      gl.uniform2f(u.uRes, w, h); gl.uniform1f(u.uAspect, w / h);
      gl.uniformMatrix3fv(u.uRot, false, rot);
      gl.uniform1f(u.uDensity, density); gl.uniform1f(u.uGlow, glow); gl.uniform1f(u.uTime, time); gl.uniform1f(u.uPulse, pulse);
      gl.uniform1f(u.uShell, shell); gl.uniform1f(u.uSteps, steps); gl.uniform1f(u.uNucleus, nucleus);
      draw();
    },
  };
}
