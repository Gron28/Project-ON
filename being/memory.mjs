// being/memory.mjs - the being's memory of songs: a self-organizing map grown on its skin. Pure module.
//
// Kohonen's self-organizing map (Kohonen 1982) is the classic model of how cortical sensory maps form: units on a sheet
// compete for each input, the winner and its neighbours move towards it, and over time neighbouring units come to stand
// for similar sounds (tonotopic and timbre maps in auditory cortex form this way during development).
//
// Here the sheet is the being's skin (MW x MH units wrapped around the body, longitude wraps). Each song gets its own
// map. A new song starts from the being's general map (everything it has learned from other songs) mixed with its DNA;
// a known song starts from what it remembered of that song. While it listens, each frame of sound finds its best-matching
// patch of skin (it lights up: recognition), and the map moves towards the sound, fast at first, then more and more
// finely: the longer it listens, the more the skin becomes the song. The general map learns slowly from every song.
//
// Features (DIM = 32, all 0..1): the ear's spectral shape (28 bands, relative to the loudest), loudness, onset strength,
// roughness, sub-bass. A unit's prototype is turned into colour and height for the body: hue from spectral centroid
// (bent around the being's own hue), lightness from loudness, height from loudness and attack.

export const MW = 48, MH = 24, NU = MW * MH, DIM = 32;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** one feature vector from an ear frame (see ear.mjs frame()) */
export function featureOf(ear, out = new Float32Array(DIM)) {
  let mx = 0; const a = new Float32Array(28);
  for (let k = 0; k < 28; k++) { a[k] = Math.log1p(ear.amp[k] / 0.015); if (a[k] > mx) mx = a[k]; }
  let mean = 0; for (let k = 0; k < 28; k++) mean += a[k]; mean /= 28;
  for (let k = 0; k < 28; k++) out[k] = clamp01(a[k] / (mx + 0.3));
  out[28] = clamp01(mean / 4); out[29] = clamp01(ear.onset / 1.5); out[30] = clamp01(ear.rough * 2.5); out[31] = clamp01(ear.sub * 6);
  return out;
}

/** the being's DNA as a map: smooth, seeded prototypes, so an unlearned skin already has its own character */
export function dnaWeights(seed) {
  const r = rng(seed), w = new Float32Array(NU * DIM);
  // a few smooth "blobs" of preference over the sheet, each a random sound prototype
  const blobs = Array.from({ length: 9 }, () => ({ x: r() * MW, y: r() * MH, s: MW * (0.05 + r() * 0.12), p: Float32Array.from({ length: DIM }, () => r()) }));
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    let ws = 0; const acc = new Float32Array(DIM);
    for (const b of blobs) { let dx = Math.abs(x - b.x); dx = Math.min(dx, MW - dx); const g = Math.exp(-(dx * dx + (y - b.y) ** 2) / (2 * b.s * b.s)); ws += g; for (let d = 0; d < DIM; d++) acc[d] += g * b.p[d]; }
    for (let d = 0; d < DIM; d++) w[(y * MW + x) * DIM + d] = acc[d] / (ws + 1e-6);
  }
  return w;
}

/**
 * @param {{weights?:Float32Array, meta?:object, fast?:boolean}} o  fast: per-song map (fast learning, shrinking neighbourhood);
 *        otherwise the slow general map
 */
export function createMap({ weights, meta = {}, fast = true } = {}) {
  let m_valid = false;
  // a stored map from another map size (or damaged) is not this skin: start from a neutral sheet instead
  const ok = weights && weights.length === NU * DIM && weights.every(Number.isFinite);
  const w = ok ? Float32Array.from(weights) : new Float32Array(NU * DIM).fill(0.5);
  m_valid = !!ok;
  const hits = new Float32Array(NU);                    // how much of the song each patch has come to stand for
  if (meta.hits && meta.hits.length === NU) hits.set(meta.hits);
  const act = new Float32Array(NU);                     // recognition glow, decays
  let experience = meta.experience || 0;                // seconds of listening this map has had
  let qeFast = 0.3, qeSlow = 0.3, lastBmu = -1;
  const m = {
    weights: w, hits, act, fast, get valid() { return m_valid; },
    get experience() { return experience; },
    get familiarity() { return clamp01((0.1 - qeFast) / 0.07); },  // how well the current sound is already represented (qe ~0.08 new, ~0.04 learned)
    get progress() { return qeSlow - qeFast; },                // learning progress: error falling = it is learning the song
    get bmu() { return lastBmu; },
    /** learn one feature vector; dt = seconds of sound it stands for */
    learn(x, dt) {
      for (let d = 0; d < DIM; d++) if (!Number.isFinite(x[d])) return { bmu: lastBmu, qe: qeFast };   // never learn a broken sample
      let best = -1, bd = Infinity;
      for (let u = 0; u < NU; u++) { let s = 0; const o = u * DIM; for (let d = 0; d < DIM; d++) { const e = x[d] - w[o + d]; s += e * e; } if (s < bd) { bd = s; best = u; } }
      const qe = Math.sqrt(bd / DIM);
      qeFast += 0.15 * (qe - qeFast); qeSlow += 0.01 * (qe - qeSlow);
      lastBmu = best;
      experience += dt;
      // fast maps: wide and plastic at first, then fine (a critical period); the general map stays slow and broad
      const radius = fast ? 1.2 + 4.3 * Math.exp(-experience / 60) : 2.2;
      const rate = fast ? (0.02 + 0.2 * Math.exp(-experience / 25)) : 0.004;
      const bx = best % MW, by = (best / MW) | 0, r2 = 2 * radius * radius, reach = Math.ceil(radius * 3);
      for (let dy = -reach; dy <= reach; dy++) {
        const y = by + dy; if (y < 0 || y >= MH) continue;
        for (let dx = -reach; dx <= reach; dx++) {
          const xx = (bx + dx + MW) % MW, u = y * MW + xx, h = Math.exp(-(dx * dx + dy * dy) / r2);
          if (h < 0.01) continue;
          const k = rate * h, o = u * DIM;
          for (let d = 0; d < DIM; d++) w[o + d] += k * (x[d] - w[o + d]);
          act[u] = Math.max(act[u], h);
        }
      }
      hits[best] += dt;
      return { bmu: best, qe };
    },
    decay(dt) { const k = Math.exp(-dt / 0.35); for (let u = 0; u < NU; u++) act[u] *= k; },
    serialize() { return { weights: b64(w), meta: { ...meta, experience, hits: Array.from(hits, (h) => Math.round(h * 10) / 10) } }; },
  };
  return m;
}

/** mix two weight sets: a * (1 - t) + b * t */
export function blend(a, b, t) { if (!a || !b || a.length !== b.length) return Float32Array.from(b && b.length === NU * DIM ? b : a); const out = new Float32Array(a.length); for (let i = 0; i < a.length; i++) out[i] = a[i] * (1 - t) + b[i] * t; return out; }

/**
 * colour + height (RGBA) and recognition glow (R, G = how much of the song a patch stands for), MW x MH, for the body.
 * Colour comes from where each patch sits among THIS map's sounds: its position on the map's own two principal axes
 * (so a song's variety becomes a palette around the being's hue). Height is cellular: patches bulge by their loudness
 * and sink where neighbouring patches disagree (the U-matrix boundaries between the song's sound categories; Ultsch 1993).
 */
/**
 * A song's look, from its absolute character (the analyzer's 14 descriptors on fixed cross-song scales, averaged over the
 * listen). This is what makes two songs' skins different: palette, how wide it spreads, which texture family dominates,
 * scale, warp, sharpness. hue0 is the being's own hue; a per-being projection bends each song's hue differently.
 */
export const CHAR_KEYS = ['loudness', 'dynamics', 'noisiness', 'roughness', 'tonality', 'harmony', 'regularity', 'density', 'intricacy', 'brightness', 'bassWeight', 'vocal', 'change', 'tempo'];
export function songLook(char, hue0, beingSeed = 1) {
  const c = (k) => (char && Number.isFinite(char[k]) ? char[k] : 0.4);
  const r = rng(beingSeed ^ 0x5f3759df), proj = CHAR_KEYS.map(() => r() * 2 - 1);
  let pr = 0; CHAR_KEYS.forEach((k, i) => { pr += proj[i] * (c(k) - 0.4); });
  const hue = (((hue0 + 0.4 * (c('brightness') - 0.45) - 0.3 * (c('bassWeight') - 0.4) + 0.42 * Math.tanh(1.6 * pr)) % 1) + 1) % 1;
  return {
    hue,
    spread: 0.1 + 0.35 * c('harmony') + 0.25 * c('intricacy') + 0.15 * c('change'),       // simple music: few hues; rich music: many
    sat: clamp01(0.45 + 0.45 * c('tonality') - 0.3 * c('noisiness') + 0.15 * c('vocal')),
    light: clamp01(0.28 + 0.25 * c('brightness') + 0.1 * c('vocal') - 0.15 * c('bassWeight') - 0.08 * c('roughness')),
    fam: [0.9 * c('tonality') + 0.5 * (1 - c('density')), 0.8 * c('regularity') + 0.6 * c('density'), 0.9 * c('noisiness') + 0.4 * c('intricacy'), 1.0 * c('roughness') + 0.4 * c('bassWeight')],
    scale: clamp01(0.25 + 0.4 * c('tempo') + 0.3 * c('density') - 0.2 * c('bassWeight')),
    warp: clamp01(0.15 + 0.45 * c('change') + 0.3 * (1 - c('regularity'))),
    sharp: clamp01(0.25 + 0.4 * c('roughness') + 0.3 * c('loudness') + 0.2 * c('regularity')),
  };
}
/** a stable number for a song key, so each song grows its own starting layout */
export function keyHash(key) { let h = 2166136261; for (const ch of String(key)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

// scratch for paint(): it runs ~10 times a second, so nothing is allocated per call (it used to make ~1.4 MB/s of garbage)
const S_P1 = new Float32Array(NU), S_P2 = new Float32Array(NU), S_U = new Float32Array(NU), S_EDGE = new Float32Array(NU);
const S_DH = new Float64Array(NU), S_DV = new Float64Array(NU);          // distance to the right / lower neighbour (each pair measured once)
const S_VAL = [0, 1, 2, 3, 4].map(() => new Float32Array(NU)), S_MEAN = new Float32Array(5), S_SD = new Float32Array(5);
const FALLBACK_LOOK = { hue: 0, spread: 0.3, sat: 0.6, light: 0.36, fam: null, scale: 0.5, warp: 0.3, sharp: 0.45 };
function hslInto(h, s, l, out, o) {   // 0..255 into out[o..o+2], same arithmetic as hsl()
  const a = s * Math.min(l, 1 - l);
  let k = (0 + h * 12) % 12; out[o] = (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255;
  k = (8 + h * 12) % 12; out[o + 1] = (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255;
  k = (4 + h * 12) % 12; out[o + 2] = (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255;
}

export function paint(map, hue0, color = new Uint8Array(NU * 4), glow = new Uint8Array(NU * 4), gene = new Uint8Array(NU * 4), dna = DNA0, look = null) {
  const LK = look || (FALLBACK_LOOK.hue = hue0, FALLBACK_LOOK);
  const w = map.weights;
  const P = map._pca || (map._pca = { mean: new Float32Array(DIM), c1: Float32Array.from({ length: DIM }, (_, d) => Math.sin(d + 1)), c2: Float32Array.from({ length: DIM }, (_, d) => Math.cos(2 * d + 1)), n: 0 });
  if (P.n++ % 10 === 0) pca(w, P);
  const p1 = S_P1, p2 = S_P2, U = S_U, edgeA = S_EDGE, dH = S_DH, dV = S_DV;
  let a1 = 1e-6, a2 = 1e-6, uMax = 1e-6, hmax = 1e-6, lMin = 1, lMax = 0;
  for (let u = 0; u < NU; u++) {
    const o = u * DIM; let x = 0, y = 0;
    for (let d = 0; d < DIM; d++) { const v = w[o + d] - P.mean[d]; x += v * P.c1[d]; y += v * P.c2[d]; }
    p1[u] = x; p2[u] = y; a1 = Math.max(a1, Math.abs(x)); a2 = Math.max(a2, Math.abs(y));
    const ux = u % MW, uy = (u / MW) | 0;
    const vr = uy * MW + (ux + 1) % MW, vd = u + MW;   // right neighbour (the sheet wraps in x) and lower neighbour
    let e = 0; for (let d = 0; d < DIM; d++) { const t = w[o + d] - w[vr * DIM + d]; e += t * t; } dH[u] = Math.sqrt(e);
    if (uy + 1 < MH) { e = 0; for (let d = 0; d < DIM; d++) { const t = w[o + d] - w[vd * DIM + d]; e += t * t; } dV[u] = Math.sqrt(e); }
    if (map.hits[u] > hmax) hmax = map.hits[u];
    lMin = Math.min(lMin, w[o + 28]); lMax = Math.max(lMax, w[o + 28]);
  }
  for (let u = 0; u < NU; u++) {   // U-matrix: mean distance to the neighbours, summed in the same order as before (right, left, lower, upper)
    const ux = u % MW, uy = (u / MW) | 0;
    let ds = dH[u] + dH[uy * MW + (ux - 1 + MW) % MW], dn = 2;
    if (uy + 1 < MH) { ds += dV[u]; dn++; }
    if (uy > 0) { ds += dV[u - MW]; dn++; }
    U[u] = ds / dn; if (U[u] > uMax) uMax = U[u];
  }
  for (let u = 0; u < NU; u++) {
    const o = u * DIM, x = p1[u] / a1, y = p2[u] / a2, edge = Math.pow(U[u] / uMax, 0.7);
    const loudRel = (w[o + 28] - lMin) / (lMax - lMin + 1e-6), attack = w[o + 29], used = Math.sqrt(map.hits[u] / hmax);
    const hue = (((LK.hue + LK.spread * (0.8 * x + 0.25 * y)) % 1) + 1) % 1;
    const sat = clamp01(LK.sat + 0.25 * y * y + 0.2 * used - 0.15 * w[o + 30]);
    const light = clamp01(LK.light + 0.2 * y + 0.18 * loudRel - 0.18 * edge);
    hslInto(hue, sat, light, color, u * 4);
    color[u * 4 + 3] = clamp01(0.12 + (1 - edge) * (0.45 + 0.35 * loudRel + 0.15 * attack)) * 255;   // cells bulge, boundaries sink
    glow[u * 4] = clamp01(map.act[u]) * 255; glow[u * 4 + 1] = used * 255; glow[u * 4 + 2] = edge * 255; glow[u * 4 + 3] = 255;
    edgeA[u] = edge;
  }
  // genes of the procedural texture each patch grows (decoded in the shader's songPattern). The ear compresses so much that
  // absolute spectral measures hardly differ between sounds, so each patch is judged against the other patches of THIS song
  // (z-scores), and the song's overall character tilts the whole skin:
  //   family: smooth tonal sound -> warped marble (0), attack -> crisp cells (1/3), noise-like -> fractal filigree (2/3), roughness -> ridged veins (1)
  //   scale: brighter -> finer, sub-bass -> larger;  warp: soft sounds and category boundaries swirl;  sharpness: attack and roughness
  const [v0, v1, v2, v3, v4] = S_VAL, mean = S_MEAN, sd = S_SD;
  for (let u = 0; u < NU; u++) {
    const o = u * DIM; let m1 = 0, m2 = 0, c = 0;
    for (let k = 0; k < 28; k++) { const v = w[o + k]; m1 += v; m2 += v * v; c += v * k; }
    m1 /= 28; const contrast = Math.sqrt(Math.max(0, m2 / 28 - m1 * m1)) / (m1 + 1e-6);
    v0[u] = w[o + 29]; v1[u] = -contrast; v2[u] = w[o + 30]; v3[u] = c / (m1 * 28 * 27 + 1e-6); v4[u] = w[o + 31];
  }
  for (let f = 0; f < 5; f++) { const val = S_VAL[f]; let a = 0, b = 0; for (let u = 0; u < NU; u++) { a += val[u]; b += val[u] * val[u]; } mean[f] = a / NU; sd[f] = Math.sqrt(Math.max(1e-8, b / NU - mean[f] * mean[f])); }
  // the song's own character, on absolute scales (the same for every song)
  const songAttack = clamp01(mean[0] * 2.5), songRough = clamp01(mean[2] * 3), songNoise = clamp01((mean[1] + 0.35) * 3);
  const fam0 = LK.fam ? LK.fam[0] : 0.6 * (1 - songAttack) * (1 - songRough), fam1 = LK.fam ? LK.fam[1] : 1.2 * songAttack, fam2 = LK.fam ? LK.fam[2] : 1.2 * songNoise, fam3 = LK.fam ? LK.fam[3] : 1.4 * songRough;   // the song's character tilts the whole skin
  const m0 = mean[0], m1_ = mean[1], m2_ = mean[2], m3 = mean[3], m4 = mean[4], s0 = sd[0], s1 = sd[1], s2 = sd[2], s3 = sd[3], s4 = sd[4];
  for (let u = 0; u < NU; u++) {
    const z0 = (v0[u] - m0) / s0, z1 = (v1[u] - m1_) / s1, z2 = (v2[u] - m2_) / s2, z3 = (v3[u] - m3) / s3, z4 = (v4[u] - m4) / s4;
    const sc0 = Math.exp(2.2 * (-0.5 * (z0 + z1 + z2) + 1.8 * fam0)), sc1 = Math.exp(2.2 * (0.9 * z0 + 1.8 * fam1)), sc2 = Math.exp(2.2 * (0.9 * z1 + 1.8 * fam2)), sc3 = Math.exp(2.2 * (0.9 * z2 + 1.8 * fam3));
    const ssum = 0 + sc0 + sc1 + sc2 + sc3;
    const fam = (sc1 * (1 / 3) + sc2 * (2 / 3) + sc3) / ssum;
    gene[u * 4] = clamp01(fam + dna[0]) * 255;
    gene[u * 4 + 1] = clamp01(LK.scale + 0.15 * z3 - 0.12 * z4 + dna[1]) * 255;
    gene[u * 4 + 2] = clamp01(LK.warp - 0.1 * z0 + 0.45 * edgeA[u] + dna[2]) * 255;
    gene[u * 4 + 3] = clamp01(LK.sharp + 0.15 * z0 + 0.12 * z2 + dna[3]) * 255;
  }
  return { color, glow, gene };
}

// the map's own two main axes of variation (power iteration on the covariance, signs kept stable between calls)
function pca(w, P) {
  P.mean.fill(0);
  for (let u = 0; u < NU; u++) for (let d = 0; d < DIM; d++) P.mean[d] += w[u * DIM + d] / NU;
  const cov = (v, out) => { out.fill(0); for (let u = 0; u < NU; u++) { let dot = 0; const o = u * DIM; for (let d = 0; d < DIM; d++) dot += (w[o + d] - P.mean[d]) * v[d]; for (let d = 0; d < DIM; d++) out[d] += dot * (w[o + d] - P.mean[d]); } };
  const norm = (v) => { let l = 0; for (const x of v) l += x * x; l = Math.sqrt(l) || 1; for (let d = 0; d < DIM; d++) v[d] /= l; };
  const tmp = new Float32Array(DIM);
  for (const [c, other] of [[P.c1, null], [P.c2, P.c1]]) {
    const prev = Float32Array.from(c);
    for (let it = 0; it < 12; it++) {
      cov(c, tmp);
      if (other) { let dot = 0; for (let d = 0; d < DIM; d++) dot += tmp[d] * other[d]; for (let d = 0; d < DIM; d++) tmp[d] -= dot * other[d]; }
      c.set(tmp); norm(c);
    }
    let dot = 0; for (let d = 0; d < DIM; d++) dot += c[d] * prev[d];
    if (dot < 0) for (let d = 0; d < DIM; d++) c[d] = -c[d];
  }
}

const DNA0 = [0, 0, 0, 0];
/** a being's small, fixed bias on the genes of every texture it grows */
export function geneDna(seed) { const r = rng(seed ^ 0x9e3779b9); return [(r() - 0.5) * 0.25, (r() - 0.5) * 0.3, (r() - 0.5) * 0.3, (r() - 0.5) * 0.2]; }

function hsl(h, s, l) {
  const f = (n) => { const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0), f(8), f(4)];
}
export function b64(f32) { const u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
export function unb64(s) { const bin = atob(s), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return new Float32Array(u8.buffer); }
