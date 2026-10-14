// being/organism.mjs - the swarm the body bursts into: a particle-life organism (Ventrella's Clusters, Mohr's particle
// life), one per song. Pure module (no GPU).
//
// Particles of a few species attract or repel each other within a short radius (the Mohr force: hard repulsion below
// beta, then a tent of attraction or repulsion set by the matrix M[me][other]). Local rules alone settle into a scatter
// of small clumps (lab/research/particles.md), so each species also has a BODY PLAN that the matrix only textures:
// a spring holding it at distance r from its anchor (the centre, or an organelle's own drifting centre), an optional
// flattening onto the song's equator (rings), and a swirl about the song's axis.
//
// Roles, from the inspiration board (inspo/: cells with organelles, shells, rings of beads, outer chains):
//   core       a dense glowing nucleus at the centre
//   membrane   a thin shell at the body radius: a stiff spring and slight SELF-REPULSION, so it spreads evenly over the
//              sphere like charges (the Thomson problem) instead of clumping; any self-attraction makes berries
//   cytoplasm  sparse fine dust inside
//   vesicle    a hollow sphere around its own anchor, drifting inside the cell
//   nucleolus  a dense blob around its own anchor
//   ring       a band flattened onto the song's equator, orbiting outside the membrane
//   beads      large sparse beads in an outer shell that string together (strong self-attraction, weak spring)
// The song's character picks which roles appear and how strongly; its key seeds the rest, so each song is a new organism.

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const clamp01 = (x) => clamp(x, 0, 1);
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export const MAX_SPECIES = 8;
//            r: radius (x membrane R), k: spring, swirl, share, size, glow, flat (equator), self (matrix), anchored (own centre)
const ROLE = {
  core: { r: 0, k: 3, swirl: 0, share: 0.03, size: 1.0, glow: 0.7, flat: 0, self: 0.5 },
  membrane: { r: 1, k: 7, swirl: 0.12, share: 0.36, size: 0.6, glow: 0.35, flat: 0, self: -0.15 },
  cytoplasm: { r: 0.45, k: 0.5, swirl: 0.08, share: 0.12, size: 0.45, glow: 0.25, flat: 0, self: -0.1 },
  vesicle: { r: 0.3, k: 6, swirl: 0, share: 0.1, size: 0.55, glow: 0.6, flat: 0, self: -0.15, anchored: true },
  nucleolus: { r: 0, k: 2.5, swirl: 0, share: 0.05, size: 0.9, glow: 0.8, flat: 0, self: 0.6, anchored: true },
  ring: { r: 1.3, k: 5, swirl: 1.2, share: 0.12, size: 0.7, glow: 0.7, flat: 5, self: -0.05 },
  beads: { r: 1.75, k: 0.9, swirl: 0.35, share: 0.04, size: 1.8, glow: 0.6, flat: 0, self: 0.15 },
};

/**
 * @param char song character (0..1 descriptors); songSeed stable per song; beingSeed; hue0 the being's own hue (0..1)
 */
export function organismFor(char, songSeed, beingSeed = 1, hue0 = 0.55) {
  char = char || {};
  const c = (k) => (Number.isFinite(char[k]) ? clamp01(char[k]) : 0.4);
  const r = rng((songSeed ^ Math.imul(beingSeed | 0, 0x2c1b3c6d)) >>> 0);
  const roles = ['core', 'membrane', 'cytoplasm'];
  const extra = [
    ['vesicle', 0.6 * c('harmony') + 0.3 * c('intricacy') + 0.35 * r()],
    ['nucleolus', 0.5 * c('bassWeight') + 0.3 * c('density') + 0.35 * r()],
    ['vesicle', 0.5 * c('intricacy') + 0.3 * c('tonality') + 0.35 * r() - 0.25],
    ['ring', 0.5 * c('regularity') + 0.4 * c('density') + 0.35 * r()],
    ['beads', 0.5 * c('roughness') + 0.4 * c('change') + 0.35 * r()],
  ].sort((a, b) => b[1] - a[1]);
  const nExtra = clamp(Math.round(1.5 + 3 * c('intricacy') + r()), 2, 5);
  for (let i = 0; i < nExtra; i++) roles.push(extra[i][0]);
  const S = roles.length;
  // the matrix: weak, so the body plan holds the form; self-cohesion per role, the song's noise, lopsided outer species
  const M = roles.map((a, i) => roles.map((b, j) => {
    let v = i === j ? ROLE[a].self : -0.05 + (r() - 0.5) * (0.25 + 0.3 * c('change'));
    if (i !== j && (a === 'ring' || a === 'beads') && (b === 'ring' || b === 'beads')) v += a === 'ring' ? 0.3 : -0.3;   // rings chase beads: motion
    return +clamp(v, -1, 1).toFixed(3);
  }));
  const R = 0.42 + 0.2 * c('loudness') + 0.08 * r();   // membrane radius (world units; the metal shell is ~0.36)
  const spin = (r() < 0.5 ? -1 : 1) * (0.4 + 0.9 * c('regularity') * c('density') + 0.3 * r());
  const baseHue = (hue0 + r() * 0.5 - 0.25 + 1) % 1;
  const species = roles.map((role, i) => {
    const p = ROLE[role];
    const z = r() * 2 - 1, a = r() * 6.2832, q = Math.sqrt(1 - z * z);
    return {
      role, r: +(p.r * R * (role === 'vesicle' ? 0.6 + 0.6 * r() : role === 'beads' || role === 'ring' ? 0.9 + 0.25 * r() : 1)).toFixed(3),
      k: +(p.k * (0.8 + 0.4 * r())).toFixed(3), swirl: +(p.swirl * spin * (0.7 + 0.6 * r())).toFixed(3), flat: p.flat,
      share: p.share * (0.75 + 0.5 * r()), size: +(p.size * (0.85 + 0.3 * r())).toFixed(3), glow: p.glow,
      // an organelle's own centre: a direction, a distance (x R) and an orbit speed about the song's axis (rad/s)
      anchor: p.anchored ? { dir: [q * Math.cos(a), z, q * Math.sin(a)], dist: +(0.3 + 0.3 * r()).toFixed(3), omega: +((r() - 0.5) * 0.5).toFixed(3) } : null,
      hue: +((baseHue + i * 0.381966) % 1).toFixed(4), sat: role === 'core' ? 0.4 : +(0.75 + 0.25 * r()).toFixed(3),
    };
  });
  const tot = species.reduce((s, x) => s + x.share, 0); for (const s of species) s.share = +(s.share / tot).toFixed(4);
  const th = Math.acos(2 * r() - 1), ph = 2 * Math.PI * r();
  return {
    v: 2, S, M, species, R: +R.toFixed(3),
    axis: [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)],
    rmax: +(0.06 + 0.02 * (1 - c('density'))).toFixed(4),   // interaction radius (world)
    beta: 0.3, force: +(4 + 4 * c('loudness')).toFixed(2), friction: 0.05, ball: +(0.009 + 0.004 * c('bassWeight')).toFixed(4),
  };
}

export function validOrganism(o) {
  if (!o || o.v !== 2 || !Number.isInteger(o.S) || o.S < 2 || o.S > MAX_SPECIES) return null;
  if (!Array.isArray(o.M) || o.M.length !== o.S || !o.M.every((row) => Array.isArray(row) && row.length === o.S && row.every(Number.isFinite))) return null;
  if (!Array.isArray(o.species) || o.species.length !== o.S) return null;
  for (const k of ['rmax', 'beta', 'force', 'friction', 'ball', 'R']) if (!Number.isFinite(o[k])) return null;
  return o;
}

/** where each species' centre is at time t (organelles orbit the song's axis; everything else is centred) */
export function anchorsAt(o, t, out = []) {
  const ax = o.axis;
  for (let i = 0; i < o.S; i++) {
    const a = o.species[i].anchor;
    if (!a) { out[i] = [0, 0, 0]; continue; }
    // Rodrigues rotation of the anchor direction about the axis by omega * t
    const th = a.omega * t, c = Math.cos(th), s = Math.sin(th), v = a.dir, d = v[0] * ax[0] + v[1] * ax[1] + v[2] * ax[2];
    const cr = [ax[1] * v[2] - ax[2] * v[1], ax[2] * v[0] - ax[0] * v[2], ax[0] * v[1] - ax[1] * v[0]];
    const rd = [0, 1, 2].map((k) => v[k] * c + cr[k] * s + ax[k] * d * (1 - c));
    out[i] = rd.map((x) => x * a.dist * o.R);
  }
  return out;
}

/** HSL (0..1) to RGB, for species colours */
export function hsl(h, s, l) {
  const f = (n) => { const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0), f(8), f(4)];
}
