// being/species-lenia.mjs - every song grows its own species of living skin. Pure module.
//
// The skin is Lenia (Chan 2019): a continuous cellular automaton whose kernel (radius R, up to three rings) and growth
// band (mu, sigma) decide what forms: soft amoeba cells, branching coral, wriggling worms, dot lattices, travelling waves,
// boiling static, and many in-between creatures. In the being, a song's ABSOLUTE character (the analyzer's descriptors on
// fixed cross-song scales) chooses where in that parameter space it lives, and the song's own key adds a deterministic
// mutation of the kernel, so two songs are never the same species. The skin raises and carves the metal (height), it is
// never painted on top of it.

import { PATTERNS } from './skin/lenia.mjs';

const FAMILIES = ['cells', 'coral', 'worms', 'spots', 'waves', 'static'];
const NUM = ['R', 'mu', 'sigma', 'gt', 'dt', 'inh', 'ir', 'fade', 'lo', 'hi', 'bg', 'seedR', 'seedA', 'noise', 'init', 'kickN'];
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** how much a song's character calls for each skin family (all descriptors 0..1, 0.4 when unknown) */
export function familyAffinity(char) {
  char = char || {};
  const c = (k) => (Number.isFinite(char[k]) ? char[k] : 0.4);
  return {
    cells: 0.6 * c('regularity') + 0.35 * c('density') + 0.2 * c('bassWeight'),
    coral: 0.5 * c('intricacy') + 0.4 * c('tonality') + 0.3 * c('harmony'),
    worms: 0.45 * (1 - c('regularity')) + 0.4 * c('roughness') + 0.3 * c('intricacy'),
    spots: 0.45 * c('regularity') + 0.4 * (1 - c('density')) + 0.2 * c('tonality'),
    waves: 0.5 * c('tonality') + 0.35 * c('vocal') + 0.3 * (1 - c('density')),
    static: 0.9 * c('noisiness') + 0.35 * c('roughness'),
  };
}

/**
 * @param {object} char  the song's absolute character (loudness, noisiness, roughness, tonality, harmony, regularity,
 *                       density, intricacy, brightness, bassWeight, vocal, change, tempo)
 * @param {number} songSeed a stable number for the song (its key hash); beingSeed the being's own seed
 * @returns a Lenia pattern definition for createSkin().setParams({ pattern })
 */
export function speciesFor(char, songSeed, beingSeed = 1) {
  const aff = familyAffinity(char);
  // the being's taste bends the field a little (some beings tend to coral, some to worms)
  const rb = rng(beingSeed ^ 0x2545f491);
  const w = {}; let sum = 0;
  for (const f of FAMILIES) { w[f] = Math.exp(7 * (aff[f] + (rb() - 0.5) * 0.12)); sum += w[f]; }
  for (const f of FAMILIES) w[f] /= sum;
  const def = { rings: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] };
  for (const k of NUM) def[k] = 0;
  for (const f of FAMILIES) {
    const p = PATTERNS[f];
    for (const k of NUM) def[k] += w[f] * p[k];
    for (let r = 0; r < 3; r++) for (let j = 0; j < 3; j++) def.rings[r][j] += w[f] * p.rings[r][j];
  }
  // the song's own mutation: a different kernel and growth band, deterministic for this song and this being
  const r = rng((songSeed ^ Math.imul(beingSeed, 0x9e3779b1)) >>> 0);
  def.R = clamp(def.R + (r() - 0.5) * 4, 4, 10);
  const nRings = 1 + Math.floor(r() * 3);
  for (let i = 0; i < 3; i++) {
    const keep = 0.45;   // half inherited from the families, half its own
    const mine = i < nRings ? [0.15 + r() * 0.75, 0.06 + r() * 0.16, i === 0 ? 1 : 0.25 + r() * 0.75] : [0.5, 0.15, 0];
    for (let j = 0; j < 3; j++) def.rings[i][j] = def.rings[i][j] * keep + mine[j] * (1 - keep);
  }
  if (def.rings[0][2] < 0.4) def.rings[0][2] = 0.4 + r() * 0.6;   // always one strong ring, so something can grow
  def.mu = clamp(def.mu + (r() - 0.5) * 0.08, 0.1, 0.4);
  def.sigma = clamp(def.sigma * (0.7 + r() * 0.7), 0.025, 0.12);
  def.inh = clamp(def.inh * (0.5 + r() * 1.2), 0, 2.5);
  def.dt = clamp(def.dt, 0.08, 0.6);
  def.init = Math.round(clamp(def.init, 4, 24)); def.kickN = 1;
  def.family = FAMILIES.reduce((a, f) => (w[f] > w[a] ? f : a), FAMILIES[0]);
  return def;
}
