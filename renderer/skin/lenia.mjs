// Living skin: a GPU continuous cellular automaton (Lenia family) on a small wrapping texture.
//
//   import { createSkin } from './skin/lenia.mjs';
//   const skin = createSkin(renderer, THREE, { width: 192, height: 96 });
//   skin.setParams({ pattern: 'coral', growth: .5, speed: .5, contrast: .5 });
//   skin.feed({ energy, kick, snare, hat, bass, intensity });   // every frame, all 0..1
//   skin.step(dt);                                              // every frame, seconds
//   uniforms.uSkin.value = skin.texture;                        // R pattern, G edges/activity, B memory
//
// State lives in two ping-pong HalfFloat targets (RGBA: R = activation A, G = activity, B = slow
// memory / inhibitor, A unused). One substep = one full-screen pass that convolves A with a
// precomputed ring kernel (21x21 weight texture, radius <= 10 texels, wraps in x, clamps in y) and
// applies the Lenia growth map. Seeds (kicks), health control and output conditioning are separate
// cheap passes. `skin.texture` is a fixed output target (never swaps) so the shader can hold it.
//
// Nothing is allocated per frame. The only recurring allocation is the 2 Hz async read of a tiny
// 12x6 statistics target (three allocates a GL buffer + a promise per read).

const MAXR = 10;                 // kernel half-size in texels (weight texture is 21x21)
const KW = 2 * MAXR + 1;
const TICK = 1 / 60;             // fixed simulation tick (s); each tick runs `substeps` Lenia passes
const MAX_TICKS = 3;             // per step() call, avoids spiral of death after a stall
const MAX_SEEDS = 8;
const SW = 12, SH = 6;           // statistics grid
const TRANSITION = 0.55;         // time constant (s) of parameter smoothing (~95 % in 1.7 s)

// ---------------------------------------------------------------------------------------------
// Pattern parameter sets.
//   R      kernel radius (texels, <= 10)         rings  [[center, width, height] x3]  (r = d/R)
//   mu,sigma growth centre / width               gt     0 = gaussian bump growth, 1 = sigmoid growth
//   dt     Lenia dt per substep                  inh,ir inhibitor strength / rate (B channel)
//   fade   exponential fade rate (1/s)           lo,hi  healthy coverage band (fraction A>0.12)
//   bg     background seeds per second (only into thin areas)   seedR radius of a seed (x R)
//   seedA  seed amplitude                        noise  base fine-noise amplitude
//   init   number of initial blobs               kickN  seeds per kick
// ---------------------------------------------------------------------------------------------
const NO_RING = [0.5, 0.15, 0];
export const PATTERNS = {
  cells: {   // soft amoeba-like cells that wander, split and merge (inhibitor memory makes blobs drift)
    R: 10, rings: [[0.5, 0.15, 1], NO_RING, NO_RING], mu: 0.15, sigma: 0.04, gt: 0, dt: 0.1,
    inh: 2, ir: 0.01, fade: 0, lo: 0.04, hi: 0.4, bg: 0.15, seedR: 0.9, seedA: 0.95, noise: 0, init: 6, kickN: 1,
  },
  coral: {   // thick branching growth that is carved back, so it keeps regrowing from new nuclei
    R: 9, rings: [[0.33, 0.1, 1], [0.8, 0.1, 0.6], NO_RING], mu: 0.26, sigma: 0.035, gt: 0, dt: 0.1,
    inh: 0.4, ir: 0.006, fade: 0, lo: 0.05, hi: 0.17, bg: 0.4, seedR: 0.7, seedA: 0.9, noise: 0, init: 6, kickN: 1,
  },
  worms: {   // fine labyrinth of wriggling worms
    R: 6, rings: [[0.5, 0.15, 1], NO_RING, NO_RING], mu: 0.3, sigma: 0.07, gt: 0, dt: 0.1,
    inh: 0.8, ir: 0.01, fade: 0, lo: 0.1, hi: 0.7, bg: 0.15, seedR: 0.9, seedA: 0.9, noise: 0, init: 10, kickN: 1,
  },
  spots: {   // hexagonal dot lattice with drifting dislocations
    R: 7, rings: [[0.5, 0.15, 1], NO_RING, NO_RING], mu: 0.18, sigma: 0.035, gt: 0, dt: 0.1,
    inh: 0.8, ir: 0.01, fade: 0, lo: 0.05, hi: 0.45, bg: 0.15, seedR: 0.8, seedA: 0.9, noise: 0, init: 16, kickN: 1,
  },
  waves: {   // excitable medium: expanding rings and arcs, kicks launch new rings
    R: 4, rings: [[0.5, 0.3, 1], NO_RING, NO_RING], mu: 0.25, sigma: 0.1, gt: 1, dt: 0.1,
    inh: 2.5, ir: 0.03, fade: 0, lo: 0.04, hi: 0.7, bg: 0.15, seedR: 1.4, seedA: 1, noise: 0, init: 6, kickN: 1,
  },
  static: {  // fast boiling turbulence at fine scale
    R: 4, rings: [[0.5, 0.2, 1], NO_RING, NO_RING], mu: 0.35, sigma: 0.1, gt: 0, dt: 0.6,
    inh: 0, ir: 0.2, fade: 0, lo: 0.1, hi: 0.9, bg: 0.3, seedR: 1.5, seedA: 0.8, noise: 0.004, init: 30, kickN: 1,
  },
  none: {
    R: 6, rings: [[0.5, 0.15, 1], NO_RING, NO_RING], mu: 2, sigma: 0.05, gt: 0, dt: 0.1,   // mu out of reach: no growth, only decay
    inh: 0, ir: 0.05, fade: 2.5, lo: -1, hi: 2, bg: 0, seedR: 1, seedA: 0, noise: 0, init: 0, kickN: 0,
  },
};

// ---------------------------------------------------------------------------------------------
// GLSL
// ---------------------------------------------------------------------------------------------
const VERT = /* glsl */`
in vec3 position;
void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const HASH = /* glsl */`
uint pcg(uint v){ uint s = v * 747796405u + 2891336453u; uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
float hash(ivec2 p, uint seed){ return float(pcg(uint(p.x) * 73856093u ^ pcg(uint(p.y) * 19349663u + seed))) * (1.0 / 4294967295.0); }
`;

const FRAG_UPDATE = /* glsl */`
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D uState;
uniform sampler2D uKernel;
uniform ivec2 uSize;
uniform int uR;
uniform float uMu, uSigma, uDt, uGT, uInh, uIr, uFade, uDecay, uNoise;
uniform uint uSeedBase;
out vec4 o;
${HASH}
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(uState, p, 0);
  // convolution: kernel rows are stored as merged texel pairs (offset, weight) so each bilinear tap
  // (state target is LINEAR, x wraps, y clamps) covers two texels exactly
  float U = 0.0;
  vec2 inv = 1.0 / vec2(uSize);
  float fx = (float(p.x) + 0.5) * inv.x;
  for (int j = -uR; j <= uR; j++) {
    float v = (float(p.y + j) + 0.5) * inv.y;
    for (int k = 0; k <= uR; k++) {
      vec2 kw = texelFetch(uKernel, ivec2(k, j + ${MAXR}), 0).xy;
      U += kw.y * texture(uState, vec2(fx + kw.x * inv.x, v)).r;
    }
  }
  float d = U - uMu;
  float gBump = 2.0 * exp(-0.5 * d * d / (uSigma * uSigma)) - 1.0;
  float gSig = tanh(d / uSigma);
  float g = mix(gBump, gSig, uGT);
  float a = s.r;
  float an = a + uDt * (g - uInh * s.b);
  an -= uDecay * uDt * a;
  an *= exp(-uFade * uDt);
  an += uNoise * hash(p, uSeedBase) * (hash(p, uSeedBase + 7u) > 0.5 ? 1.0 : 0.0);
  an = clamp(an, 0.0, 1.0);
  float bn = s.b + uIr * uDt * (a - s.b) * 10.0;
  float act = mix(s.g, clamp(abs(an - a) * 14.0, 0.0, 1.0), 0.25);
  o = vec4(an, act, clamp(bn, 0.0, 1.0), 1.0);
}
`;

const FRAG_SEED = /* glsl */`
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D uState;
uniform ivec2 uSize;
uniform int uN;
uniform vec4 uSeed[${MAX_SEEDS}];   // x, y (texels), radius (texels), amplitude (<0 = erase)
uniform uint uSeedBase;
out vec4 o;
${HASH}
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(uState, p, 0);
  for (int i = 0; i < ${MAX_SEEDS}; i++) {
    if (i >= uN) break;
    vec4 sd = uSeed[i];
    vec2 d = vec2(p) + 0.5 - sd.xy;
    d.x -= float(uSize.x) * floor(d.x / float(uSize.x) + 0.5);
    float r = length(d) / sd.z;
    if (r < 1.0) {
      float f = smoothstep(1.0, 0.3, r);
      if (sd.w > 0.0) {
        float n = 0.55 + 0.45 * hash(p, uSeedBase + uint(i) * 131u);
        s.r = max(s.r, sd.w * f * n);
        s.b = mix(s.b, 0.0, f * 0.8);
      } else {
        s.r *= 1.0 + sd.w * f;
      }
    }
  }
  o = s;
}
`;

const FRAG_STATS = /* glsl */`
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D uState;
uniform ivec2 uSize;
uniform ivec2 uBlock;
out vec4 o;
void main(){
  ivec2 c = ivec2(gl_FragCoord.xy);
  ivec2 o0 = c * uBlock;
  float m = 0.0, cov = 0.0, n = 0.0;
  for (int j = 0; j < uBlock.y; j++) for (int i = 0; i < uBlock.x; i++) {
    ivec2 q = o0 + ivec2(i, j);
    if (q.x < uSize.x && q.y < uSize.y) { float a = texelFetch(uState, q, 0).r; m += a; cov += a > 0.12 ? 1.0 : 0.0; n += 1.0; }
  }
  o = vec4(m / n, cov / n, 0.0, 1.0);
}
`;

const FRAG_OUT = /* glsl */`
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D uState;
uniform ivec2 uSize;
uniform float uGain;
out vec4 o;
float A(int x, int y){ x += (x < 0 ? uSize.x : 0); x -= (x >= uSize.x ? uSize.x : 0); return texelFetch(uState, ivec2(x, clamp(y, 0, uSize.y - 1)), 0).r; }
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(uState, p, 0);
  float gx = A(p.x + 1, p.y) - A(p.x - 1, p.y);
  float gy = A(p.x, p.y + 1) - A(p.x, p.y - 1);
  float edge = clamp(length(vec2(gx, gy)) * 2.2, 0.0, 1.0);
  // 3x3 tent blur softens the saturated edges so displacement / normals sampled from it do not alias
  float bl = (4.0 * s.r + 2.0 * (A(p.x - 1, p.y) + A(p.x + 1, p.y) + A(p.x, p.y - 1) + A(p.x, p.y + 1))
            + A(p.x - 1, p.y - 1) + A(p.x + 1, p.y - 1) + A(p.x - 1, p.y + 1) + A(p.x + 1, p.y + 1)) * (1.0 / 16.0);
  float r = clamp(0.5 + (mix(s.r, bl, 0.75) - 0.5) * uGain, 0.0, 1.0);
  o = vec4(r, clamp(max(edge, s.g * 0.8), 0.0, 1.0), s.b, 1.0);
}
`;

// GLSL snippet for the consumer (ray-marching) shader. Prepend to your fragment source.
//   vec3 s = skinSample(uSkin, dir);   // dir = normalize(point - entityCentre) in the entity's local frame
//   s.r pattern 0..1, s.g edges/activity, s.b memory/age
export const SKIN_GLSL = /* glsl */`
vec2 skinUV(vec3 d){ return vec2(atan(d.z, d.x) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5); }
vec3 skinSample(sampler2D t, vec3 d){
  vec2 uv = skinUV(d);
  return textureLod(t, vec2(fract(uv.x), uv.y), 0.0).rgb;   // no mips, no derivatives -> no seam
}
`;

// ---------------------------------------------------------------------------------------------
function mulberry32(a) {
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// flat numeric view of a pattern so that all params can be lerped in one loop
const KEYS = ['R', 'mu', 'sigma', 'gt', 'dt', 'inh', 'ir', 'fade', 'lo', 'hi', 'bg', 'seedR', 'seedA', 'noise', 'kickN'];
const NK = KEYS.length;
const NF = NK + 9; // + 3 rings x (c, w, h)
function flatten(def, out) {
  for (let i = 0; i < NK; i++) out[i] = def[KEYS[i]];
  for (let r = 0; r < 3; r++) { out[NK + r * 3] = def.rings[r][0]; out[NK + r * 3 + 1] = def.rings[r][1]; out[NK + r * 3 + 2] = def.rings[r][2]; }
  return out;
}
const KI = {}; KEYS.forEach((k, i) => { KI[k] = i; });

export function createSkin(renderer, THREE, opts = {}) {
  const W = opts.width | 0 || 192, H = opts.height | 0 || 96;
  const substeps = Math.max(1, Math.min(6, opts.substeps | 0 || 2));
  const dtComp = 3 / substeps;     // pattern dt values are tuned for 3 substeps per tick; fewer substeps take bigger steps
  const halfOK = true;

  const saved = { rt: null, ac: true };
  const mkRT = (type, filter, wrapS, w = W, h = H) => {
    const rt = new THREE.WebGLRenderTarget(w, h, {
      type, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
      minFilter: filter, magFilter: filter, wrapS, wrapT: THREE.ClampToEdgeWrapping, generateMipmaps: false,
    });
    rt.texture.generateMipmaps = false;
    return rt;
  };
  let rtA = mkRT(THREE.HalfFloatType, THREE.LinearFilter, THREE.RepeatWrapping);   // linear: bilinear tap merging
  let rtB = mkRT(THREE.HalfFloatType, THREE.LinearFilter, THREE.RepeatWrapping);
  const rtOut = mkRT(halfOK ? THREE.HalfFloatType : THREE.UnsignedByteType, THREE.LinearFilter, THREE.RepeatWrapping);
  const rtStats = mkRT(THREE.UnsignedByteType, THREE.NearestFilter, THREE.ClampToEdgeWrapping, SW, SH);
  rtOut.texture.name = 'skin';

  // kernel weight texture (R32F, 21x21), mutated in place
  const kData = new Float32Array(KW * KW);          // plain weights (CPU scratch)
  const PW = MAXR + 1;                               // merged pairs per row
  const kPair = new Float32Array(PW * KW * 2);       // (offset, weight) per merged pair, RG32F
  const kTex = new THREE.DataTexture(kPair, PW, KW, THREE.RGFormat, THREE.FloatType);
  kTex.minFilter = kTex.magFilter = THREE.NearestFilter;
  kTex.generateMipmaps = false;
  kTex.needsUpdate = true;

  const size = new THREE.Vector2(W, H);
  const iSize = { value: new THREE.Vector2(W, H) };
  const seedArr = []; for (let i = 0; i < MAX_SEEDS; i++) seedArr.push(new THREE.Vector4());

  const mat = (frag, uniforms) => new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: frag, uniforms,
    depthTest: false, depthWrite: false, blending: THREE.NoBlending, transparent: false, toneMapped: false,
  });
  const U1 = (v) => ({ value: v });
  const updateMat = mat(FRAG_UPDATE, {
    uState: U1(null), uKernel: U1(kTex), uSize: iSize, uR: U1(8), uMu: U1(0.15), uSigma: U1(0.017), uDt: U1(0.1),
    uGT: U1(0), uInh: U1(0), uIr: U1(0.05), uFade: U1(0), uDecay: U1(0), uNoise: U1(0), uSeedBase: U1(1),
  });
  const seedMat = mat(FRAG_SEED, { uState: U1(null), uSize: iSize, uN: U1(0), uSeed: U1(seedArr), uSeedBase: U1(1) });
  const statsMat = mat(FRAG_STATS, { uState: U1(null), uSize: iSize, uBlock: U1(new THREE.Vector2(Math.ceil(W / SW), Math.ceil(H / SH))) });
  const outMat = mat(FRAG_OUT, { uState: U1(null), uSize: iSize, uGain: U1(1) });
  // ivec2 uniforms accept Vector2 in three

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const quad = new THREE.Mesh(geo, updateMat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const cam = new THREE.Camera();

  function pass(material, target) {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(scene, cam);
  }
  function begin() {
    saved.rt = renderer.getRenderTarget();
    saved.ac = renderer.autoClear;
    renderer.autoClear = false;
  }
  function end() {
    renderer.setRenderTarget(saved.rt);
    renderer.autoClear = saved.ac;
  }

  // ---- parameters -------------------------------------------------------------------------
  const cur = new Float32Array(NF), tgt = new Float32Array(NF);
  let patternName = 'cells';
  let user = { growth: 0.5, speed: 0.5, contrast: 0.5 };
  let kBuilt = new Float32Array(NF).fill(-1);
  let decayCur = 0;
  flatten(PATTERNS.cells, cur); flatten(PATTERNS.cells, tgt);

  function buildKernel() {
    const R = Math.max(1, Math.min(MAXR, cur[KI.R]));
    let sum = 0;
    for (let j = -MAXR; j <= MAXR; j++) for (let i = -MAXR; i <= MAXR; i++) {
      const r = Math.hypot(i, j) / R;
      let w = 0;
      if (r < 1) {
        for (let k = 0; k < 3; k++) {
          const c = cur[NK + k * 3], s = Math.max(0.02, cur[NK + k * 3 + 1]), h = cur[NK + k * 3 + 2];
          if (h > 1e-4) { const z = (r - c) / s; w += h * Math.exp(-0.5 * z * z); }
        }
        const t = Math.min(1, Math.max(0, (1 - r) / 0.15)); // smooth cut at the radius
        w *= t * t * (3 - 2 * t);
      }
      kData[(j + MAXR) * KW + (i + MAXR)] = w; sum += w;
    }
    const inv = sum > 0 ? 1 / sum : 0;
    for (let i = 0; i < kData.length; i++) kData[i] *= inv;
    const uR = Math.min(MAXR, Math.ceil(R + 0.5));
    kPair.fill(0);
    for (let j = -uR; j <= uR; j++) {
      const row = (j + MAXR) * KW + MAXR;
      for (let k = 0; k <= uR; k++) {
        const i = -uR + 2 * k;
        const wa = kData[row + i], wb = i + 1 <= uR ? kData[row + i + 1] : 0, sw = wa + wb;
        const o = ((j + MAXR) * PW + k) * 2;
        kPair[o] = sw > 0 ? i + wb / sw : i; kPair[o + 1] = sw;
      }
    }
    kTex.needsUpdate = true;
    kBuilt.set(cur);
    updateMat.uniforms.uR.value = uR;
  }

  function setParams(p = {}, immediate = false) {
    if (p.pattern !== undefined) {
      const def = typeof p.pattern === 'string' ? PATTERNS[p.pattern] : p.pattern;
      if (def) {
        const changed = (typeof p.pattern === 'string' ? p.pattern : 'custom') !== patternName;
        patternName = typeof p.pattern === 'string' ? p.pattern : 'custom';
        flatten({ ...PATTERNS.cells, ...def }, tgt);
        if (changed && !immediate && (def.seedA === undefined || def.seedA > 0)) burst = 5;
        if (immediate) { cur.set(tgt); kBuilt.fill(-1); }
      }
    }
    for (const k of ['growth', 'speed', 'contrast']) if (typeof p[k] === 'number') user[k] = Math.min(1, Math.max(0, p[k]));
  }

  // ---- feed -------------------------------------------------------------------------------
  const F = { energy: 0, kick: 0, snare: 0, hat: 0, bass: 0, intensity: 0.5 };
  let kickPrev = 0, snarePrev = 0, kickCool = 0, snareCool = 0;
  let pendKick = 0, pendSnare = 0, burst = 0;
  function feed(f = {}) {
    for (const k in F) if (typeof f[k] === 'number') F[k] = f[k] < 0 ? 0 : f[k] > 1 ? 1 : f[k];
    // onset detection: rising edge across 0.35 (envelopes or impulses both work)
    if (F.kick >= 0.35 && kickPrev < 0.35 && kickCool <= 0) { pendKick = Math.max(pendKick, F.kick); kickCool = 0.09; }
    if (F.snare >= 0.35 && snarePrev < 0.35 && snareCool <= 0) { pendSnare = Math.max(pendSnare, F.snare); snareCool = 0.09; }
    kickPrev = F.kick; snarePrev = F.snare;
  }

  // ---- seeds ------------------------------------------------------------------------------
  let rng = mulberry32(1234);
  let nSeeds = 0;
  function addSeed(x, y, r, a) {
    if (nSeeds >= MAX_SEEDS) return;
    seedArr[nSeeds++].set(x, y, Math.max(2, r), a);
  }
  const randX = () => rng() * W;
  const randY = () => H * (0.1 + 0.8 * rng());
  function flushSeeds(base) {
    if (!nSeeds) return;
    seedMat.uniforms.uN.value = nSeeds;
    seedMat.uniforms.uSeedBase.value = base;
    seedMat.uniforms.uState.value = rtA.texture;
    pass(seedMat, rtB);
    const t = rtA; rtA = rtB; rtB = t;
    nSeeds = 0;
  }

  // ---- health control (async coverage stats) ----------------------------------------------
  const statBuf = new Uint8Array(SW * SH * 4);
  const cellCov = new Float32Array(SW * SH).fill(0.1);
  let covMean = 0.1, statsPending = false, statsTimer = 0, statsValid = false, healthCool = 0, covHist = 0;
  const asyncOK = typeof renderer.readRenderTargetPixelsAsync === 'function';
  function requestStats() {
    statsMat.uniforms.uState.value = rtA.texture;
    pass(statsMat, rtStats);
    if (asyncOK) {
      statsPending = true;
      renderer.readRenderTargetPixelsAsync(rtStats, 0, 0, SW, SH, statBuf).then(consumeStats, () => { statsPending = false; });
    } else {
      renderer.readRenderTargetPixels(rtStats, 0, 0, SW, SH, statBuf);
      consumeStats();
    }
  }
  function consumeStats() {
    statsPending = false;
    let s = 0;
    for (let i = 0; i < SW * SH; i++) { cellCov[i] = statBuf[i * 4 + 1] / 255; s += cellCov[i]; }
    covMean = s / (SW * SH);
    statsValid = true;
  }
  function pickCell(low) {
    // among 3 random cells choose the thinnest (low) or fullest
    let best = -1, bv = low ? 9 : -1;
    for (let k = 0; k < 3; k++) {
      const c = Math.floor(rng() * SW * SH);
      const v = cellCov[c];
      if (low ? v < bv : v > bv) { bv = v; best = c; }
    }
    return best;
  }
  function cellPos(c) {
    const cx = c % SW, cy = (c / SW) | 0;
    return [(cx + rng()) * (W / SW), (cy + rng()) * (H / SH)];
  }
  function health(dt) {
    healthCool -= dt;
    const lo = cur[KI.lo], hi = cur[KI.hi];
    const en = F.energy;
    let wantDecay = 0;
    if (statsValid && healthCool <= 0) {
      if (covMean < lo) {
        const n = covMean < lo * 0.35 ? 2 : 1;
        for (let i = 0; i < n; i++) { const [x, y] = cellPos(pickCell(true)); addSeed(x, y, tgt[KI.R] * tgt[KI.seedR] * (1 + rng() * 0.4), tgt[KI.seedA]); }
        healthCool = 0.35;
      } else if (covMean > hi) {
        for (let i = 0; i < 2; i++) { const [x, y] = cellPos(pickCell(false)); addSeed(x, y, cur[KI.R] * (1.6 + rng()), -0.9); }
        healthCool = 0.35;
      }
      if (covMean > hi * 0.9) wantDecay = Math.min(0.15, (covMean - hi * 0.9) * 0.6);
    }
    decayCur += (wantDecay - decayCur) * Math.min(1, dt * 2);
    // background nucleation into thin areas (keeps the skin alive), faster with energy
    const rate = cur[KI.bg] * (1 + 3 * en) * dt;
    if (rate > 0 && rng() < rate) {
      const c = pickCell(true);
      if (!statsValid || cellCov[c] < Math.max(lo * 3, 0.12)) { const [x, y] = cellPos(c); addSeed(x, y, tgt[KI.R] * tgt[KI.seedR] * (0.8 + rng() * 0.6), tgt[KI.seedA]); }
    }
  }

  // ---- stepping ---------------------------------------------------------------------------
  let acc = 0, time = 0, tickCount = 0, contrastDirty = true;
  const stats = { ticks: 0, cpuMs: 0, avgCpuMs: 0, coverage: 0 };
  let seedCounter = 1;

  function tick(dt) {
    // dt: simulated seconds of this tick (already speed scaled)
    // one-shot injections from music
    const inten = 0.5 + 0.5 * F.intensity;
    if (pendKick > 0) {
      const n = tgt[KI.kickN] < 0.5 ? 0 : Math.max(1, (tgt[KI.kickN] | 0) + (F.intensity > 0.75 ? 1 : 0));
      for (let i = 0; i < n; i++) addSeed(randX(), randY(), tgt[KI.R] * tgt[KI.seedR] * (1 + 0.5 * F.bass + 0.3 * rng()), tgt[KI.seedA] * (0.6 + 0.4 * pendKick) * inten);
      pendKick = 0;
    }
    if (pendSnare > 0) {
      if (tgt[KI.seedA] > 0) addSeed(randX(), randY(), tgt[KI.R] * tgt[KI.seedR] * (1.5 + 0.6 * rng()), tgt[KI.seedA] * (0.5 + 0.4 * pendSnare) * inten);
      pendSnare = 0;
    }
    if (burst > 0) {
      for (let i = 0; i < burst && nSeeds < MAX_SEEDS; i++) addSeed(randX(), randY(), tgt[KI.R] * tgt[KI.seedR] * (0.8 + rng() * 0.8), tgt[KI.seedA]);
      burst = 0;
    }
    health(dt);
    seedCounter = (seedCounter + 7919) >>> 0;
    flushSeeds(seedCounter);

    const u = updateMat.uniforms;
    // growth: 0..1 -> dt x 0.5..1.5 and a small mu/sigma sharpening; energy adds up to +35 %
    const gMul = (0.5 + user.growth) * (1 + 0.35 * F.energy);
    u.uMu.value = cur[KI.mu];
    u.uSigma.value = cur[KI.sigma];
    u.uDt.value = cur[KI.dt] * gMul * dtComp;
    u.uGT.value = cur[KI.gt];
    u.uInh.value = cur[KI.inh];
    u.uIr.value = cur[KI.ir];
    u.uFade.value = cur[KI.fade] * 0.07; // 'none' (fade 2.5) -> ~2 s to vanish at speed 0.5
    u.uDecay.value = decayCur;
    u.uNoise.value = cur[KI.noise] + F.hat * 0.045 * inten;
    for (let s = 0; s < substeps; s++) {
      u.uState.value = rtA.texture;
      u.uSeedBase.value = (seedCounter + s * 31 + tickCount * 17) >>> 0;
      pass(updateMat, rtB);
      const t = rtA; rtA = rtB; rtB = t;
    }
    tickCount++;
  }

  function speedMul() { const s = user.speed; return s < 0.5 ? 0.2 + 1.6 * s : 1 + 4 * (s - 0.5); }

  function step(dt) {
    const t0 = performance.now();
    dt = Math.min(Math.max(dt, 0), 0.25);
    kickCool -= dt; snareCool -= dt;
    // smooth parameter transition (real time)
    const k = 1 - Math.exp(-dt / TRANSITION);
    let moved = false;
    for (let i = 0; i < NF; i++) { const d = tgt[i] - cur[i]; if (d !== 0) { cur[i] += Math.abs(d) < 1e-5 ? d : d * k; moved = true; } }
    if (moved) { let need = false; for (const i of [KI.R]) if (Math.abs(cur[i] - kBuilt[i]) > 0.01) need = true; for (let i = NK; i < NF; i++) if (Math.abs(cur[i] - kBuilt[i]) > 0.003) need = true; if (need) buildKernel(); }
    if (kBuilt[0] < 0) buildKernel();

    acc += dt * speedMul();
    let n = 0;
    begin();
    while (acc >= TICK && n < MAX_TICKS) { tick(TICK); acc -= TICK; n++; }
    if (acc > TICK * MAX_TICKS) acc = 0;
    time += dt;
    if (n || contrastDirty) {
      const g = Math.pow(2, (user.contrast - 0.5) * 3);
      outMat.uniforms.uGain.value = g;
      outMat.uniforms.uState.value = rtA.texture;
      pass(outMat, rtOut);
      contrastDirty = false;
    }
    statsTimer -= dt;
    if (statsTimer <= 0 && !statsPending) { requestStats(); statsTimer = 0.4; }
    end();
    stats.ticks = n; stats.cpuMs = performance.now() - t0; stats.avgCpuMs += (stats.cpuMs - stats.avgCpuMs) * 0.05; stats.coverage = covMean;
  }

  function clearTarget(rt) {
    renderer.setRenderTarget(rt);
    const c = renderer.getClearColor(new THREE.Color()), a = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.setClearColor(c, a);
  }

  function reseed(seed = 1) {
    rng = mulberry32((seed | 0) ^ 0x9E3779B9);
    begin();
    clearTarget(rtA); clearTarget(rtB);
    const n = Math.max(6, cur[KI.R] * 0 + (PATTERNS[patternName]?.init ?? 12));
    if (patternName !== 'none') {
      for (let b = 0; b < n; b++) {
        addSeed(randX(), H * (0.05 + 0.9 * rng()), cur[KI.R] * cur[KI.seedR] * (0.6 + 1.0 * rng()), 0.5 + 0.5 * rng());
        if (nSeeds === MAX_SEEDS || b === n - 1) flushSeeds(1 + b * 977);
      }
    }
    end();
    acc = 0; covMean = 0.1; statsValid = false; contrastDirty = true; pendKick = pendSnare = 0; decayCur = 0;
  }

  function dispose() {
    rtA.dispose(); rtB.dispose(); rtOut.dispose(); rtStats.dispose(); kTex.dispose(); geo.dispose();
    updateMat.dispose(); seedMat.dispose(); statsMat.dispose(); outMat.dispose();
  }

  rtOut.texture.wrapS = THREE.RepeatWrapping;
  rtOut.texture.wrapT = THREE.ClampToEdgeWrapping;
  buildKernel();
  reseed(1);

  return {
    get texture() { return rtOut.texture; },
    get target() { return rtOut; },
    get width() { return W; }, get height() { return H; },
    get stats() { return stats; },
    get pattern() { return patternName; },
    setParams, feed, step, reseed, dispose,
  };
}
