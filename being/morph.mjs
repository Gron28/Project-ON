// being/morph.mjs - the song's morphogenetic genome: what shape its skin grows into. Pure module (no DOM, no GPU).
//
// A genome blends a few generator families (the GPU bake in morph-gl.mjs evaluates them on the sphere). Each answers a
// look from the being's inspiration board (inspo/):
//   cppn      a compositional pattern-producing network (Stanley 2007): symmetric fields, rings, lattices, organic blots
//   cells     a cell mosaic on the sphere (spherical Voronoi): epithelium, honeycomb, blastula; the cell count CLEAVES
//             2, 4, 8, ... as the being gets to know the song (development as learning)
//   pollen    a pollen grain: apertures (pores), furrows (colpi), spines (echinate), net wall (reticulate)
//   turing    reaction-diffusion-like patterns (Turing 1952; Kondo & Miura 2010): spots, labyrinths, radial stripes
//   lace      a circle-inversion limit set (Apollonian / Kleinian lace) on the Riemann sphere, which is the body's surface
//   attractor a strange attractor drawn as luminous filaments (de Jong, Clifford, Gumowski-Mira, Ikeda point maps; Lorenz and
//             Thomas flows drawn as continuous lines), picked like Sprott (1993) by a positive Lyapunov exponent and good
//             coverage, wrapped around the song's axis
// The bake writes four structures per texel, each stained in its own dye (as in a fluorescence micrograph): membranes,
// nuclei, organelles (the third dye) and height. Cells nest: rim > compartments > cells > nuclei (cellFabric).
//   living    the existing Lenia skin (species-lenia.mjs), as the family that grows and moves by itself
// The song's ABSOLUTE character (fixed cross-song scales) picks families and parameters, and its key seeds every free
// choice, so two songs are never the same and the same song always is. The being's own DNA genome is where every song
// starts; the skin matures from it into the song's genome while it listens (lerpGenome). Sections mutate it a little
// (mutate), deterministically per section, so a replay grows the same way.

export const FAMILIES = ['cppn', 'cells', 'pollen', 'turing', 'lace', 'attractor', 'living'];
// fluorescent dyes (approximate emission colours) and the membrane / nucleus pairs seen in the inspiration micrographs:
// a plant stem (cyan walls, magenta organelles), intestinal villi (orange membranes, blue nuclei), an islet (green, blue)...
export const DYES = { dapi: [0.25, 0.45, 1], gfp: [0.3, 1, 0.42], mcherry: [1, 0.22, 0.38], orange: [1, 0.58, 0.12], cy5: [0.85, 0.3, 1], cyan: [0.15, 0.88, 1], yellow: [1, 0.92, 0.25], teal: [0.1, 0.78, 0.7] };
export const STAIN_PAIRS = [['cyan', 'cy5'], ['orange', 'dapi'], ['gfp', 'dapi'], ['dapi', 'mcherry'], ['teal', 'yellow'], ['cy5', 'gfp'], ['mcherry', 'cyan'], ['yellow', 'cy5']];
// the third dye of each pair (organelles, rims, spine tips): a stem section's yellow granules, the red rim of villi, an islet's magenta
export const STAIN_ORG = ['yellow', 'mcherry', 'cy5', 'yellow', 'cy5', 'orange', 'yellow', 'cyan'];
/** a song's stains: membranes, nuclei/organelles, and a faint cytoplasm tint (bright, tonal music leans cool; dark, noisy warm) */
export function stainFor(c, r) {
  const x = clamp01(0.45 * c('brightness') + 0.3 * c('tonality') + 0.25 * (1 - c('noisiness')) + (r() - 0.5) * 0.6);
  const pi = Math.min(STAIN_PAIRS.length - 1, Math.floor(x * STAIN_PAIRS.length)), [m, n] = STAIN_PAIRS[pi];
  const mem = DYES[m], nuc = DYES[n], org = DYES[STAIN_ORG[pi]];
  return { mem: mem.slice(), nuc: nuc.slice(), org: org.slice(), cyto: mem.map((v, i) => +((0.6 * v + 0.4 * nuc[i]) * 0.14).toFixed(3)), names: [m, n] };
}
const DEFAULT_STAIN = { mem: [0.15, 0.88, 1], nuc: [0.85, 0.3, 1], org: [1, 0.92, 0.25], cyto: [0.09, 0.15, 0.2], names: ['cyan', 'cy5'] };
export const CPPN_UNITS = 8, CPPN_LAYERS = 3, CPPN_W = CPPN_LAYERS * CPPN_UNITS * 8 + 2 * 8;   // 208 weights
export const ACTS = ['sin', 'gauss', 'tri', 'tanh', 'abs'];
export const ATTRACTOR_KINDS = 6;   // 0 de Jong, 1 Clifford, 2 Gumowski-Mira, 3 Ikeda (point maps); 4 Lorenz, 5 Thomas (flows, drawn as lines)
const SECTORS = [5, 7, 8, 9];   // vascular bundles of a ring layout (six reads as a star)
const SYM = [1, 1, 1, 2, 3, 4, 5, 7, 8];   // mostly none; six- and twelve-fold read as stars (hexagrams), so they are left out
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const clamp01 = (x) => clamp(x, 0, 1);
const lerp = (a, b, t) => a * (1 - t) + b * t;   // exact at both ends

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const gaussR = (r) => { let u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };

/** how much a song's character calls for each family (descriptors 0..1, 0.4 when unknown) */
export function familyAffinity(char) {
  char = char || {};
  const c = (k) => (Number.isFinite(char[k]) ? clamp01(char[k]) : 0.4);
  return {
    cppn: 0.5 * c('intricacy') + 0.3 * c('change') + 0.2 * (1 - c('regularity')) + 0.12,
    cells: 0.45 * c('regularity') + 0.35 * c('density') + 0.25 * c('bassWeight'),
    pollen: 0.35 * c('brightness') + 0.3 * c('roughness') + 0.25 * c('regularity') + 0.15 * c('density'),
    turing: 0.4 * c('noisiness') + 0.3 * c('density') + 0.25 * (1 - c('tonality')),
    lace: 0.15 + 0.4 * c('tonality') + 0.3 * c('harmony') + 0.15 * c('intricacy') + 0.1 * (1 - c('noisiness')),   // fifteen kinds of fractal now: more of the music finds one
    attractor: 0.3 * c('noisiness') + 0.35 * c('intricacy') + 0.25 * c('change') + 0.2 * (1 - c('regularity')),
    living: 0.4 * c('vocal') + 0.3 * c('dynamics') + 0.2 * (1 - c('density')),
  };
}

/**
 * the song's genome
 * @param char the song's absolute character; songSeed a stable number for the song; beingSeed the being's seed
 */
// the fractal family (genome 'lace', drawn by morph-gl.mjs fractalHemi): fifteen kinds, each with parameters of its own
export const FRACTAL_KINDS = ['apollonian', 'kleinian', 'julia', 'mandelbrot', 'burning ship', 'newton', 'sierpinski', 'pentaflake', 'hexaflake', 'carpet', 'tricorn', 'phoenix', 'doyle spiral', 'hyperbolic', 'julia pearls'];
const JULIA_C = [[-0.8, 0.156], [-0.7269, 0.1889], [0.285, 0.01], [-0.4, 0.6], [0.355, 0.355], [-0.123, 0.745], [-0.391, -0.587], [0.37, 0.1], [-0.54, 0.54], [0, 0.8], [-0.835, -0.2321], [-0.70176, -0.3842]];
const MANDEL = [[-0.745, 0.113, 0.03], [0.275, 0.006, 0.02], [-0.7445, 0.121, 0.006], [-0.088, 0.654, 0.02], [-1.7497, 0, 0.02], [-0.1592, 1.0317, 0.02], [0.3245, 0.04855, 0.012]];
const SHIP = [[-1.762, -0.028, 0.045], [-1.755, -0.03, 0.07], [-0.5, -0.55, 0.5]];
const HYPER = [[7, 3], [5, 4], [8, 3], [6, 4], [4, 5], [10, 3], [5, 5], [4, 6]];
/** a fractal kind and its parameters: ordered, tonal music leans to the geometric kinds, rough and intricate music to the escape-time sets */
export function fractalFor(r, c = () => 0.4) {
  const ordered = 0.5 * c('regularity') + 0.3 * c('tonality') + 0.2 * c('harmony'), wild = 0.4 * c('noisiness') + 0.3 * c('roughness') + 0.3 * c('intricacy');
  const wt = [1 + ordered, 0.7 + 0.5 * wild, 0.8 + 0.6 * wild, 0.7 + 0.7 * wild, 0.5 + 0.9 * wild, 0.6 + 0.5 * c('density'), 0.6 + ordered, 0.5 + ordered, 0.5 + ordered, 0.5 + ordered, 0.5 + 0.7 * wild, 0.6 + 0.4 * wild, 0.7 + 0.6 * c('harmony'), 0.8 + ordered, 0.6 + 0.4 * c('tonality')];
  let x = r() * wt.reduce((a, b) => a + b, 0), kind = 0; while (kind < wt.length - 1 && (x -= wt[kind]) > 0) kind++;
  const one = (a) => a[Math.floor(r() * a.length)], j = (v, a) => +(v + (r() - 0.5) * a).toFixed(5);
  let p = [0, 0, 0.03];
  if (kind === 1 || kind === 5) p = [+r().toFixed(3), 0, 0];
  else if (kind === 2) { const c0 = one(JULIA_C); p = [j(c0[0], 0.02), j(c0[1], 0.02), 0]; }
  else if (kind === 14) { const c0 = one(JULIA_C); p = [j(c0[0], 0.02), j(c0[1], 0.02), +(0.25 + 0.4 * r()).toFixed(3)]; }
  else if (kind === 3) { const m = one(MANDEL); p = [j(m[0], m[2] * 0.3), j(m[1], m[2] * 0.3), +(m[2] * (0.6 + 0.8 * r())).toFixed(5)]; }
  else if (kind === 4) { const m = one(SHIP); p = [m[0], m[1], +(m[2] * (0.7 + 0.6 * r())).toFixed(4)]; }
  else if (kind === 10) p = [j(-0.1, 0.2), j(0, 0.2), +(1.1 + 0.6 * r()).toFixed(3)];
  else if (kind === 11) p = [j(0.5667, 0.02), j(-0.5, 0.05), 0];
  else if (kind >= 6 && kind <= 8) p = [+(r() * 6.28).toFixed(3), 0, 0];
  else if (kind === 12) p = [8 + Math.floor(r() * 13), 1 + Math.floor(r() * 5), 0];
  else if (kind === 13) { const h = one(HYPER); p = [h[0], h[1], 0]; }
  return { kind, p1: p[0], p2: p[1], p3: p[2] };
}

export function morphFor(char, songSeed, beingSeed = 1) {
  char = char || {};
  const c = (k) => (Number.isFinite(char[k]) ? clamp01(char[k]) : 0.4);
  const r = rng((songSeed ^ Math.imul(beingSeed | 0, 0x9e3779b1)) >>> 0), rb = rng((beingSeed ^ 0x51ed270b) >>> 0);
  // families: softmax of affinity, plus the being's taste and the song's own whim; keep the strongest two (or three)
  const aff = familyAffinity(char), raw = {};
  for (const f of FAMILIES) raw[f] = Math.exp(9 * (aff[f] + (rb() - 0.5) * 0.12 + (r() - 0.5) * 0.22));
  const order = FAMILIES.slice().sort((a, b) => raw[b] - raw[a]);
  const w = Object.fromEntries(FAMILIES.map((f) => [f, 0]));
  w[order[0]] = 1; w[order[1]] = clamp(raw[order[1]] / raw[order[0]], 0.25, 0.8);
  if (r() < 0.35) w[order[2]] = 0.25 * w[order[1]];
  const sum = FAMILIES.reduce((s, f) => s + w[f], 0); for (const f of FAMILIES) w[f] /= sum;
  // a song axis (its poles), symmetry and scale
  const th = Math.acos(2 * r() - 1), ph = 2 * Math.PI * r();
  const axis = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
  const symIdx = Math.floor(clamp01(0.5 * c('tonality') * c('harmony') + 0.3 * c('regularity') * c('tonality') + (r() - 0.5) * 0.45) * (SYM.length - 0.001));   // symmetry only for clearly tonal, ordered music
  const W = new Array(CPPN_W), sigma = 0.9 + 2.4 * c('intricacy') + 0.6 * r();
  for (let i = 0; i < CPPN_W; i++) W[i] = +(gaussR(r) * sigma / Math.sqrt(8)).toFixed(4);
  const act = Array.from({ length: CPPN_LAYERS * CPPN_UNITS }, () => Math.floor(r() * ACTS.length));
  const colpiOpts = [0, 3, 3, 4, 6];
  const g = {
    v: 1, w, axis,
    sym: SYM[symIdx], mirror: c('regularity') + (r() - 0.5) * 0.4 > 0.5 ? 1 : 0,
    freq: +(0.7 + 1.5 * c('brightness') + 0.4 * r()).toFixed(3),
    crisp: +(3 + 13 * c('density') + 5 * c('roughness') * r()).toFixed(2),
    depth: +(0.022 + 0.035 * c('bassWeight') + 0.015 * c('loudness')).toFixed(4),
    cppn: { W, act, latent: [r() * 6.28, r() * 6.28, r() * 6.28] },
    cells: { n: Math.round(24 + 230 * c('density') * (0.6 + 0.8 * r())), jitter: +(0.25 + 0.65 * (1 - c('regularity'))).toFixed(3),
      dome: +clamp01(0.8 * c('bassWeight') + 0.3 * c('vocal') + (r() - 0.5) * 0.4).toFixed(3), wall: +(0.04 + 0.12 * r()).toFixed(3), nucleus: +clamp01(c('harmony') + (r() - 0.5) * 0.5).toFixed(3) },
    pollen: { spines: Math.round(clamp01(c('brightness') * 0.6 + c('roughness') * 0.6 + (r() - 0.5) * 0.4) * 320), spineH: +(0.3 + 0.7 * c('roughness')).toFixed(3),
      pores: Math.floor(r() * 13), colpi: colpiOpts[Math.floor(r() * colpiOpts.length)], reticulum: +clamp01(1 - c('roughness') + (r() - 0.5) * 0.4).toFixed(3) },
    turing: { k: +(9 + 26 * c('brightness') + 6 * r()).toFixed(2), thr: +clamp((c('density') - 0.5) * 0.9 + (r() - 0.5) * 0.5, -0.6, 0.6).toFixed(3),
      radial: +clamp01(c('harmony') * c('regularity') * 1.6 + (r() - 0.5) * 0.4).toFixed(3), seed: Math.floor(r() * 1e6) },
    lace: { s: +(1.0 + 0.35 * r()).toFixed(3), scale: +(0.6 + 0.9 * c('intricacy')).toFixed(3), twist: +(r() * 6.28).toFixed(3), ...fractalFor(rng((songSeed ^ 0x0f4ac7a1) >>> 0), c) },
    attractor: { kind: Math.floor(r() * ATTRACTOR_KINDS), seed: Math.floor(r() * 1e9) },
    stain: stainFor(c, r),
  };
  // nesting (drawn last, so the older choices above keep their values): how the mosaic is organised into compartments
  g.cells.layout = r() < clamp01(0.2 + 0.5 * c('harmony') * c('tonality') + 0.25 * c('regularity')) ? 1 : 0;   // 1: concentric about the song axis (a stem section), 0: islets
  g.cells.comps = 4 + Math.floor(r() * 7);
  g.cells.sectors = SECTORS[Math.floor(r() * SECTORS.length)];
  return g;
}

/** a being's own genome: the skin every song starts from */
export function dnaGenome(beingSeed) {
  const r = rng((beingSeed ^ 0x7f4a7c15) >>> 0), char = {};
  for (const k of ['loudness', 'dynamics', 'noisiness', 'roughness', 'tonality', 'harmony', 'regularity', 'density', 'intricacy', 'brightness', 'bassWeight', 'vocal', 'change']) char[k] = r();
  return morphFor(char, (beingSeed * 2654435761) >>> 0, beingSeed);
}

/** a genome between two (t: 0 = a, 1 = b); discrete choices switch at the midpoint, weights and numbers glide */
export function lerpGenome(a, b, t) {
  t = clamp01(t);
  if (!a) return b; if (!b) return a;
  const pick = (x, y) => (t < 0.5 ? x : y);
  const num = (x, y) => (Number.isFinite(x) && Number.isFinite(y) ? lerp(x, y, t) : pick(x, y));
  const obj = (x, y) => { const o = {}; for (const k of new Set([...Object.keys(x || {}), ...Object.keys(y || {})])) o[k] = num(x?.[k], y?.[k]); return o; };
  const ax = a.axis.map((v, i) => lerp(v, b.axis[i], t)), al = Math.hypot(...ax) || 1;
  return {
    v: 1, w: obj(a.w, b.w), axis: ax.map((v) => v / al), sym: pick(a.sym, b.sym), mirror: pick(a.mirror, b.mirror),
    freq: num(a.freq, b.freq), crisp: num(a.crisp, b.crisp), depth: num(a.depth, b.depth),
    cppn: { W: a.cppn.W.map((x, i) => lerp(x, b.cppn.W[i], t)), act: pick(a.cppn.act, b.cppn.act), latent: a.cppn.latent.map((x, i) => lerp(x, b.cppn.latent[i], t)) },
    cells: obj(a.cells, b.cells), pollen: obj(a.pollen, b.pollen), turing: { ...obj(a.turing, b.turing), seed: pick(a.turing.seed, b.turing.seed) },
    lace: (a.lace.kind || 0) === (b.lace.kind || 0) ? obj(a.lace, b.lace) : { ...obj(a.lace, b.lace), ...(t < 0.5 ? { kind: a.lace.kind || 0, p1: a.lace.p1, p2: a.lace.p2, p3: a.lace.p3 } : { kind: b.lace.kind || 0, p1: b.lace.p1, p2: b.lace.p2, p3: b.lace.p3 }) }, attractor: pick(a.attractor, b.attractor),
    stain: lerpStain(a.stain, b.stain, t),
  };
}
function lerpStain(a, b, t) {
  a = a || DEFAULT_STAIN; b = b || DEFAULT_STAIN;
  const mix = (x, y) => x.map((v, i) => v * (1 - t) + y[i] * t);
  return { mem: mix(a.mem, b.mem), nuc: mix(a.nuc, b.nuc), org: mix(a.org || a.mem, b.org || b.mem), cyto: mix(a.cyto, b.cyto), names: t < 0.5 ? a.names : b.names };
}

/** a section of the song nudges the genome (deterministic for this song and section): the skin evolves while it plays */
export function mutate(g, seed, amount = 0.12) {
  const r = rng(seed >>> 0), o = JSON.parse(JSON.stringify(g));
  o.cppn.W = o.cppn.W.map((x) => +(x * (1 + (r() - 0.5) * 2 * amount) + gaussR(r) * amount * 0.15).toFixed(4));
  o.cppn.latent = o.cppn.latent.map((x) => x + (r() - 0.5) * amount * 4);
  o.freq = +clamp(o.freq * (1 + (r() - 0.5) * amount), 0.5, 3).toFixed(3);
  o.turing.thr = +clamp(o.turing.thr + (r() - 0.5) * amount, -0.6, 0.6).toFixed(3);
  o.lace.twist = +(o.lace.twist + (r() - 0.5) * amount * 6).toFixed(3);
  if (r() < 0.35) Object.assign(o.lace, fractalFor(r));   // a section can bring another kind of fractal (the skin dissolves into it)
  else if (o.lace.kind === 2 || o.lace.kind === 14) { o.lace.p1 = +(o.lace.p1 + (r() - 0.5) * amount * 0.2).toFixed(5); o.lace.p2 = +(o.lace.p2 + (r() - 0.5) * amount * 0.2).toFixed(5); }   // a Julia set drifts
  o.cells.jitter = +clamp(o.cells.jitter + (r() - 0.5) * amount * 0.5, 0.1, 0.95).toFixed(3);
  return o;
}

/** a valid genome, or null (what comes back from disk may be old or broken) */
export function validGenome(g) {
  if (!g || g.v !== 1 || !g.w || !Array.isArray(g.axis) || g.axis.length !== 3) return null;
  if (!g.cppn || !Array.isArray(g.cppn.W) || g.cppn.W.length !== CPPN_W || !g.cppn.W.every(Number.isFinite)) return null;
  if (!Array.isArray(g.cppn.act) || g.cppn.act.length !== CPPN_LAYERS * CPPN_UNITS) return null;
  for (const k of ['cells', 'pollen', 'turing', 'lace', 'attractor']) if (!g[k] || typeof g[k] !== 'object') return null;
  if (!FAMILIES.some((f) => Number.isFinite(g.w[f]) && g.w[f] > 0)) return null;
  if (!Number.isInteger(g.lace.kind) || g.lace.kind < 0 || g.lace.kind >= FRACTAL_KINDS.length) g.lace.kind = 0;   // genomes saved before the fractal kinds: the circles
  const okC = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  if (!g.stain || !okC(g.stain.mem) || !okC(g.stain.nuc) || !okC(g.stain.cyto)) g.stain = { ...DEFAULT_STAIN };   // genomes saved before stains
  if (!okC(g.stain.org)) g.stain.org = g.stain.mem.map((v, i) => Math.min(1, 0.55 * v + 0.9 * g.stain.nuc[(i + 1) % 3] + 0.1));   // before the third dye: a mix of the other two
  return g;
}

/** the cell centres of a mosaic of n cells: a Fibonacci sphere, jittered (seeded), relaxed a little (Lloyd-like) */
export function cellCentres(n, jitter, seed) {
  n = clamp(Math.round(n), 2, 256);
  const r = rng(seed >>> 0), P = [], ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n, rad = Math.sqrt(1 - y * y), a = i * ga;
    let x = Math.cos(a) * rad + (r() - 0.5) * jitter * 2 / Math.sqrt(n) * 2, yy = y + (r() - 0.5) * jitter * 2 / Math.sqrt(n) * 2, z = Math.sin(a) * rad + (r() - 0.5) * jitter * 2 / Math.sqrt(n) * 2;
    const l = Math.hypot(x, yy, z) || 1; P.push([x / l, yy / l, z / l]);
  }
  if (n === 2) return [[0, 1, 0], [0, -1, 0]];
  // two passes of repulsion keep cells from collapsing into slivers
  for (let it = 0; it < 2; it++) {
    const F = P.map(() => [0, 0, 0]), s = 0.35 / n;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const d = [P[i][0] - P[j][0], P[i][1] - P[j][1], P[i][2] - P[j][2]], q = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] + 1e-4, f = s / q;
      for (let k = 0; k < 3; k++) { F[i][k] += d[k] * f; F[j][k] -= d[k] * f; }
    }
    for (let i = 0; i < n; i++) { const v = P[i].map((x, k) => x + F[i][k] * (1 - jitter * 0.7)), l = Math.hypot(...v) || 1; P[i] = v.map((x) => x / l); }
  }
  return P;
}

/**
 * the tissue of a cell mosaic: every cell gets a code = compartment + 0.5 * rim + 0.49 * variation, which the bake decodes.
 * Nesting as in a stem or root cross-section: compartments (islets, or rings and bundles about the song's axis) hold cells,
 * cells hold nuclei; the cells on a compartment's border are its rim (epidermis).
 *   layout 0: spherical-Voronoi islets (farthest-point seeds), like the compartments of a villus or an islet
 *   layout 1: a stem section about the axis: pith, a ring of vascular bundles (sectors) in cortex, an epidermal rim at the equator
 */
export function cellFabric(P, { layout = 0, comps = 6, sectors = 7, axis = [0, 1, 0], seed = 1 } = {}) {
  const n = P.length, r = rng((seed ^ 0x2545f491) >>> 0), comp = new Array(n).fill(0), rimC = new Array(n).fill(0);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (layout === 1 && n >= 24) {
    const al = Math.hypot(...axis) || 1, a = axis.map((v) => v / al);
    const tx0 = Math.abs(a[1]) < 0.99 ? [a[2], 0, -a[0]] : [0, -a[2], a[1]], tl = Math.hypot(...tx0) || 1, tx = tx0.map((v) => v / tl);
    const bz = [a[1] * tx[2] - a[2] * tx[1], a[2] * tx[0] - a[0] * tx[2], a[0] * tx[1] - a[1] * tx[0]];
    const S = clamp(Math.round(sectors), 3, 9), cortex = 1 + S, rimId = 2 + S, off = r();
    for (let i = 0; i < n; i++) {
      const y = dot(P[i], a), t = Math.acos(clamp(Math.abs(y), 0, 1)) / (Math.PI / 2);   // 0 at the pole, 1 at the equator
      const ph = Math.atan2(dot(P[i], bz), dot(P[i], tx)), u = ((ph / (2 * Math.PI) + 1 + off) % 1) * S, k = Math.floor(u), f = u - k;
      if (t < 0.24) comp[i] = 0;
      else if (t < 0.58 && f > 0.18 && f < 0.82 && t > 0.3) comp[i] = 1 + (k % S);
      else if (t < 0.86) comp[i] = cortex;
      else { comp[i] = rimId; rimC[i] = 1; }
    }
  } else {
    const m = clamp(Math.min(Math.round(comps), Math.floor(n / 5)), 1, 15), seeds = [Math.floor(r() * n)];
    while (seeds.length < m) {   // farthest-point sampling: islets of similar size
      let best = -1, bd = -1;
      for (let i = 0; i < n; i++) { let md = 9; for (const s of seeds) md = Math.min(md, 1 - dot(P[i], P[s])); if (md > bd) { bd = md; best = i; } }
      seeds.push(best);
    }
    const wgt = seeds.map(() => 0.9 + 0.2 * r());
    for (let i = 0; i < n; i++) { let bk = -1, bv = -9; seeds.forEach((s, j) => { const v = dot(P[i], P[s]) * wgt[j]; if (v > bv) { bv = v; bk = j; } }); comp[i] = bk; }
    for (let i = 0; i < n; i++) {   // rim: a cell with one of its nearest neighbours in another compartment
      const ds = []; for (let j = 0; j < n; j++) if (j !== i) ds.push([dot(P[i], P[j]), j]);
      ds.sort((x, y) => y[0] - x[0]);
      for (let k = 0; k < Math.min(6, ds.length); k++) if (comp[ds[k][1]] !== comp[i]) { rimC[i] = 1; break; }
    }
    if (m < 2) rimC.fill(0);
  }
  return P.map((_, i) => comp[i] + 0.5 * rimC[i] + 0.49 * ((i * 0.618034) % 1));
}

const dotv = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** a seeded random rotation of 3-space as three row vectors (the view a flow attractor is drawn from) */
function rotation3(r) {
  const a = r() * 6.2832, b = Math.acos(2 * r() - 1), c = r() * 6.2832, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  return [[ca * cc - sa * cb * sc, -ca * sc - sa * cb * cc, sa * sb], [sa * cc + ca * cb * sc, -sa * sc + ca * cb * cc, -ca * sb], [sb * sc, sb * cc, cb]];
}

/**
 * a strange attractor drawn as luminous filaments on a size x size grid, searched like Sprott: random parameters of the
 * chosen map, kept if the orbit stays bounded, has a positive Lyapunov exponent and covers the frame.
 * kinds: 0 de Jong, 1 Clifford, 2 Gumowski-Mira, 3 Ikeda (point maps: sub-pixel splats, so the thin curves stay sharp);
 *        4 Lorenz, 5 Thomas (flows: the trajectory is a continuous line, sampled every half pixel, so it reads as wire)
 * returns density (0..1, soft volume), and tex (RGBA bytes): r soft volume, g filament (thin bright lines), b nodes
 * (where many strands cross), a 255.
 */
export function attractorDensity(spec, size = 256, points = 400000) {
  const kind = ((spec && spec.kind) | 0) % ATTRACTOR_KINDS, r = rng(((spec && spec.seed) || 1) >>> 0), flow = kind >= 4;
  const mapStep = (k, p, x, y, out) => {
    if (k === 0) { out[0] = Math.sin(p[0] * y) - Math.cos(p[1] * x); out[1] = Math.sin(p[2] * x) - Math.cos(p[3] * y); }
    else if (k === 1) { out[0] = Math.sin(p[0] * y) + p[2] * Math.cos(p[0] * x); out[1] = Math.sin(p[1] * x) + p[3] * Math.cos(p[1] * y); }
    else if (k === 2) { const F = (v) => p[0] * v + (2 * (1 - p[0]) * v * v) / (1 + v * v); const nx = p[1] * y + F(x); out[0] = nx; out[1] = -x + F(nx); }
    else { const t = p[2] - p[3] / (1 + x * x + y * y), c = Math.cos(t), s = Math.sin(t); out[0] = 1 + p[0] * (x * c - y * s); out[1] = p[0] * (x * s + y * c); }
  };
  const deriv = (k, p, s, o) => {
    if (k === 4) { o[0] = 10 * (s[1] - s[0]); o[1] = s[0] * (p[0] - s[2]) - s[1]; o[2] = s[0] * s[1] - (8 / 3) * s[2]; }
    else { o[0] = Math.sin(s[1]) - p[0] * s[0]; o[1] = Math.sin(s[2]) - p[0] * s[1]; o[2] = Math.sin(s[0]) - p[0] * s[2]; }
  };
  const H = kind === 4 ? 0.006 : 0.07, k1 = [0, 0, 0], k2 = [0, 0, 0], k3 = [0, 0, 0], k4 = [0, 0, 0], tmp = [0, 0, 0];
  const rk4 = (p, s, out) => {   // one step of the flow
    deriv(kind, p, s, k1); for (let i = 0; i < 3; i++) tmp[i] = s[i] + k1[i] * H / 2;
    deriv(kind, p, tmp, k2); for (let i = 0; i < 3; i++) tmp[i] = s[i] + k2[i] * H / 2;
    deriv(kind, p, tmp, k3); for (let i = 0; i < 3; i++) tmp[i] = s[i] + k3[i] * H;
    deriv(kind, p, tmp, k4); for (let i = 0; i < 3; i++) out[i] = s[i] + H * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]) / 6;
  };
  const draw = () => {
    if (kind === 0) return [r() * 6 - 3, r() * 6 - 3, r() * 6 - 3, r() * 6 - 3];
    if (kind === 1) return [r() * 4 - 2, r() * 4 - 2, r() * 2 - 1, r() * 2 - 1];
    if (kind === 2) return [r() * 1.2 - 0.6, 0.92 + r() * 0.08, 0, 0];
    if (kind === 3) return [0.6 + r() * 0.35, 0, 0.4, 5 + r() * 4];
    if (kind === 4) return [24 + r() * 10];   // the Lorenz rho (chaotic from 24.74)
    return [0.176 + r() * 0.03];              // the Thomas b (chaotic below 0.208)
  };
  const o = [0, 0], o2 = [0, 0];
  let best = null, bestScore = -1;
  if (!flow) {
    for (let tries = 0; tries < 60 && bestScore < 0.9; tries++) {
      const p = draw();
      let x = 0.1, y = 0.1, xe = 0.1 + 1e-7, ye = 0.1, lsum = 0, ok = true;
      let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
      const g = new Uint8Array(32 * 32);
      for (let i = 0; i < 4000; i++) {
        mapStep(kind, p, x, y, o); mapStep(kind, p, xe, ye, o2);
        x = o[0]; y = o[1];
        if (!Number.isFinite(x) || Math.abs(x) + Math.abs(y) > 1e4) { ok = false; break; }
        const dx = o2[0] - x, dy = o2[1] - y, d = Math.hypot(dx, dy) || 1e-12;
        if (i > 100) lsum += Math.log(d / 1e-7);
        xe = x + (dx / d) * 1e-7; ye = y + (dy / d) * 1e-7;
        if (i > 100) { if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y; }
      }
      if (!ok || !(mxx - mnx > 1e-3) || !(mxy - mny > 1e-3)) continue;
      const lyap = lsum / 3900;
      if (lyap < 0.005) continue;   // a fixed point or a cycle, not a strange attractor
      x = 0.1; y = 0.1;
      for (let i = 0; i < 6000; i++) { mapStep(kind, p, x, y, o); x = o[0]; y = o[1]; if (i > 100) g[Math.min(31, Math.floor(((x - mnx) / (mxx - mnx)) * 32)) * 32 + Math.min(31, Math.floor(((y - mny) / (mxy - mny)) * 32))] = 1; }
      let cov = 0; for (let i = 0; i < g.length; i++) cov += g[i]; cov /= g.length;
      const score = Math.exp(-((cov - 0.35) ** 2) / 0.03) * clamp01(lyap * 4);
      if (score > bestScore) { bestScore = score; best = { p, bounds: [mnx, mxx, mny, mxy], lyap, cov }; }
    }
  } else {
    // a flow: the chosen parameter, a seeded view (rotation), Lyapunov exponent per unit time from two shadowing trajectories
    const p = draw(), R = rotation3(r), c0 = kind === 4 ? [0, 0, 25] : [0, 0, 0];
    let s = kind === 4 ? [1 + r(), 1, 20] : [1 + r() * 0.5, -1, 0.5], se = [s[0] + 1e-7, s[1], s[2]], lsum = 0, n = 0;
    const out = [0, 0, 0], oute = [0, 0, 0];
    const proj = (q) => { const v = [q[0] - c0[0], q[1] - c0[1], q[2] - c0[2]]; return [dotv(R[0], v), dotv(R[1], v)]; };
    let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
    for (let i = 0; i < 9000; i++) {
      rk4(p, s, out); const sn = out.slice(); rk4(p, se, oute);
      s = sn;
      const dx = oute[0] - s[0], dy = oute[1] - s[1], dz = oute[2] - s[2], d = Math.hypot(dx, dy, dz) || 1e-12;
      if (!s.every(Number.isFinite) || Math.abs(s[0]) + Math.abs(s[1]) + Math.abs(s[2]) > 1e4) break;
      if (i > 1500) { lsum += Math.log(d / 1e-7); n++; const q = proj(s); if (q[0] < mnx) mnx = q[0]; if (q[0] > mxx) mxx = q[0]; if (q[1] < mny) mny = q[1]; if (q[1] > mxy) mxy = q[1]; }
      se = [s[0] + (dx / d) * 1e-7, s[1] + (dy / d) * 1e-7, s[2] + (dz / d) * 1e-7];
    }
    if (n > 1000 && mxx - mnx > 1e-3) best = { p, bounds: [mnx, mxx, mny, mxy], lyap: lsum / (n * H), cov: 0.35, flow: { R, c0, s0: s.slice() } };
  }
  const N = size * size, acc = new Float32Array(N);
  if (!best) return { density: new Float32Array(N), tex: new Uint8Array(N * 4), params: null, kind };
  const [mnx, mxx, mny, mxy] = best.bounds, span = Math.max(mxx - mnx, mxy - mny) * 1.08, cx = (mnx + mxx) / 2, cy = (mny + mxy) / 2;
  const splat = (u, v, w) => {   // bilinear: sub-pixel positions keep thin curves thin and smooth
    const iu = Math.floor(u - 0.5), iv = Math.floor(v - 0.5), fu = u - 0.5 - iu, fv = v - 0.5 - iv;
    if (iu < -1 || iv < -1 || iu >= size || iv >= size) return;
    for (let dv = 0; dv < 2; dv++) for (let du = 0; du < 2; du++) {
      const x = iu + du, y = iv + dv; if (x < 0 || y < 0 || x >= size || y >= size) continue;
      acc[y * size + x] += w * (du ? fu : 1 - fu) * (dv ? fv : 1 - fv);
    }
  };
  if (!flow) {
    let x = 0.1, y = 0.1;
    for (let i = 0; i < points; i++) {
      mapStep(kind, best.p, x, y, o); x = o[0]; y = o[1];
      if (i < 100) continue;
      splat(((x - cx) / span + 0.5) * size, ((y - cy) / span + 0.5) * size, 1);
    }
  } else {
    const { R, c0 } = best.flow, p = best.p, cur = best.flow.s0.slice(), out = [0, 0, 0];
    const px0 = (q) => ((dotv(R[0], [q[0] - c0[0], q[1] - c0[1], q[2] - c0[2]]) - cx) / span + 0.5) * size, py0 = (q) => ((dotv(R[1], [q[0] - c0[0], q[1] - c0[1], q[2] - c0[2]]) - cy) / span + 0.5) * size;
    let ax = px0(cur), ay = py0(cur);
    const steps = Math.round((kind === 4 ? 26000 : Math.max(2000, points / 5) * 2) * (size / 512));   // a Lorenz orbit wraps many times: fewer steps keep the lines apart
    for (let i = 0; i < steps; i++) {
      rk4(p, cur, out); cur[0] = out[0]; cur[1] = out[1]; cur[2] = out[2];
      const bx = px0(cur), by = py0(cur), len = Math.hypot(bx - ax, by - ay), m = Math.max(1, Math.ceil(len / 0.5));
      for (let k = 1; k <= m; k++) { const t = k / m; splat(ax + (bx - ax) * t, ay + (by - ay) * t, 1); }
      ax = bx; ay = by;
    }
  }
  return { ...shade(acc, size, flow), params: best.p, kind, lyapunov: best.lyap, coverage: best.cov };
}

/** accumulated line / point density -> soft volume (r), filaments (g) and nodes (b) */
function shade(acc, size, flow) {
  const N = size * size, T = new Float32Array(N);
  // a robust reference level: the 99.7th percentile of the lit texels
  const sample = []; for (let i = 0; i < N; i += 11) if (acc[i] > 0) sample.push(acc[i]);
  sample.sort((a, b) => a - b);
  const ref = sample.length ? Math.max(1, sample[Math.min(sample.length - 1, Math.floor(sample.length * 0.997))]) : 1, lr = Math.log1p(ref);
  for (let i = 0; i < N; i++) T[i] = flow ? 1 - Math.exp(-acc[i] * 0.9) : clamp01(Math.log1p(acc[i]) / lr);
  const tmp = new Float32Array(N), tmp2 = new Float32Array(N), blur = (src, rad) => {   // two box passes per axis: close to a Gaussian
    const out = new Float32Array(N), inv = 1 / (2 * rad + 1);
    const pass = (a, b, horizontal) => {
      const st = horizontal ? 1 : size, ls = horizontal ? size : 1;   // stride along the line, stride between lines
      for (let l = 0; l < size; l++) {
        const o = l * ls; let sum = 0;
        for (let k = -rad; k <= rad; k++) sum += a[o + Math.min(size - 1, Math.max(0, k)) * st];
        for (let k = 0; k < size; k++) { b[o + k * st] = sum * inv; sum += a[o + Math.min(size - 1, k + rad + 1) * st] - a[o + Math.max(0, k - rad) * st]; }
      }
    };
    pass(src, tmp, true); pass(tmp, tmp2, false); pass(tmp2, tmp, true); pass(tmp, out, false);
    return out;
  };
  const wide = blur(T, Math.max(2, Math.round(size / 90))), soft = blur(T, Math.max(1, Math.round(size / 340)));
  const tex = new Uint8Array(N * 4), density = new Float32Array(N), bg = blur(T, Math.max(2, Math.round(size / 64)));
  for (let i = 0; i < N; i++) {
    const t = T[i], rid = clamp01((t - bg[i]) * (flow ? 2.2 : 4.5) + (flow ? 0.15 * t : 0));   // thin bright lines: what stands out of its surroundings
    const vol = clamp01(wide[i] * 1.9), node = clamp01((soft[i] - 0.62) * 4.5);
    density[i] = vol;
    tex[i * 4] = Math.round(vol * 255); tex[i * 4 + 1] = Math.round(rid * 255); tex[i * 4 + 2] = Math.round(node * 255); tex[i * 4 + 3] = 255;
  }
  return { density, tex };
}
