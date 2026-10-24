// being/cellab/rules.mjs - the automata ON grows on and in its body, and how its feeling and the song's character choose
// them. Pure module (node --test: tests/cellab.test.mjs).
//
// The surface rules are CelLab / WebCA rules by Rudy Rucker and John Walker (Fourmilab, https://www.fourmilab.ch/cellab/),
// which they placed in the public domain ("All of these programs are in the public domain and may be used in any way
// without any restrictions whatsoever"). 'faithful' means the update is the CelLab rule definition line for line (8-bit
// state, neighbours seen through their bit-0 plane, the same evaluator semantics); 'adaptation' means the idea is kept but
// the mechanism changed to live on a closed sphere. The inside rules are not in CelLab; they are volumetric relatives.
// Ported from the lab gallery (lab/prototypes/cellab/).

import { SECTOR_ID, GEM_ID, KIN } from '../materials.mjs';

export const CREDIT = 'Rules and palettes after CelLab / WebCA by Rudy Rucker and John Walker (fourmilab.ch/cellab), public domain.';

// index = the rule's number in the surface step shader (being/cellab/gpu.mjs); relief = how deep it carves (body units)
export const RULES_2D = [
  { id: 'rainzha', name: 'RainZha', tag: 'faithful', palette: 'default', steps: 18, dens: 0.5, relief: 0.03 },
  { id: 'zhabo', name: 'Zhabotinsky', tag: 'faithful', palette: 'on-gold', steps: 14, dens: 0.5, relief: 0.026 },
  { id: 'brain', name: "Brian's Brain", tag: 'faithful', palette: 'on-ember', steps: 16, dens: 0.35, relief: 0.03 },
  { id: 'faders', name: 'Faders', tag: 'faithful', palette: 'faders', steps: 20, dens: 0.6, relief: 0.03 },
  { id: 'rug', name: 'Rug', tag: 'faithful', palette: 'rainbow', steps: 10, dens: 1, relief: 0.022, seedR: 2.5 },
  { id: 'hodge', name: 'Hodge', tag: 'faithful', palette: 'autocad', steps: 12, dens: 1, relief: 0.03 },
  { id: 'venus', name: 'Venus', tag: 'faithful', palette: 'aurora', steps: 12, dens: 1, relief: 0.022 },
  { id: 'life', name: 'Life', tag: 'faithful', palette: 'brailife', steps: 12, dens: 0.35, relief: 0.03 },
  { id: 'perfume', name: 'Perfume', tag: 'adaptation', palette: 'on-violet', steps: 24, dens: 0.6, relief: 0.036, seedR: 2 },
  { id: 'pond', name: 'Pond', tag: 'adaptation', palette: 'on-ice', steps: 20, dens: 0.45, relief: 0.036, seedR: 1.6 },
];

// index = the rule's number in the volume step shader; params = uP (see gpu.mjs)
export const LIFE3D = { S: [4, 5, 6, 7], B: [6, 7, 8], states: 10 };   // Pyroclastic 4-7/6-8/10: lives on its own, beats add to it
const mask = (a) => a.reduce((x, c) => (x | (1 << c)) >>> 0, 0);
export const RULES_3D = [
  { id: 'scroll3d', name: 'Scroll waves', tag: '3D', palette: 'on-ice', steps: 14, dens: 0.5, params: [22, 1, 10, 0] },
  { id: 'brain3d', name: "Brian's Brain 3D", tag: '3D', palette: 'on-ember', steps: 14, dens: 0.4, params: [4, 6, 5, 0] },
  { id: 'life3d', name: 'Life 3D', tag: '3D', palette: 'on-moss', steps: 10, dens: 0.12, params: [mask(LIFE3D.S), mask(LIFE3D.B), LIFE3D.states, 0] },
  { id: 'rug3d', name: 'Rug 3D', tag: '3D', palette: 'on-violet', steps: 8, dens: 1, params: [0, 0, 0, 0] },
];
export const INDEX_2D = Object.fromEntries(RULES_2D.map((r, i) => [r.id, i]));
export const INDEX_3D = Object.fromEntries(RULES_3D.map((r, i) => [r.id, i]));
export const rule2d = (id) => RULES_2D[INDEX_2D[id] ?? 0];
export const rule3d = (id) => RULES_3D[INDEX_3D[id] ?? 0];

export const MOODS = ['calm', 'flowing', 'rough', 'wild'];
// what each mood grows, in the order a song's sections walk through them
export const MOOD_RULES = {
  surface: { calm: ['rug', 'pond'], flowing: ['hodge', 'zhabo', 'rainzha'], rough: ['brain', 'faders'], wild: ['life', 'perfume', 'venus'] },
  inside: { calm: ['rug3d'], flowing: ['scroll3d'], rough: ['brain3d'], wild: ['life3d'] },
};
// The mood is a score per mood: bias + sum of weight x input, inputs 0..1 (the mind's arousal, then the song's absolute
// character from the analyzer, 0.4 when unknown). calm: low arousal, sparse and smooth; flowing: tonal, smooth, regular or
// sung; rough: rough and noisy, not tonal; wild: high arousal, dense and changing.
export const MOOD_WEIGHTS = {
  calm: { bias: 0.55, arousal: -1.1, roughness: -0.3, density: -0.3, tonality: 0.15 },
  flowing: { bias: 0.1, arousal: 0.15, roughness: -0.55, noisiness: -0.25, tonality: 0.5, regularity: 0.1, vocal: 0.15 },
  rough: { bias: -0.2, arousal: 0.25, roughness: 0.85, noisiness: 0.55, tonality: -0.3 },
  wild: { bias: -0.5, arousal: 1.05, density: 0.4, change: 0.35, intricacy: 0.2 },
};
const num = (x, d = 0.4) => (Number.isFinite(x) ? x : d);

// What each material grows (being/materials.mjs ids): the automaton whose mechanism is the material's own nature, so a
// body that is turning to fire grows fire's automaton, and the sky reaches the automata through the materials it leans
// (stones and gems inherit from their kin). mood: how it leans calm / flowing / rough / wild; palette: null keeps the rule's.
//   fire, obsidian: Brian's Brain (ready -> burning -> spent, a front that consumes what it crosses)
//   iron, glass: Faders (a strike and its fading trail)       water: Pond (waves on a surface)
//   air: Perfume (a gas diffusing)                            earth: Rug (averaging, settling, sediment)
//   lead: Life (birth and death, time)                        tin, gold: Zhabotinsky (spirals, radiating rings)
//   copper, iridescent: Venus                                 quicksilver, fluorescent: RainZha (drops)
//   silver, velvet flesh: Hodge (a cycle that waxes and wanes, infection in tissue)
const L = (calm, flowing, rough, wild, rule, rule3d, palette = null) => ({ mood: { calm, flowing, rough, wild }, rule, rule3d, palette });
const BASE_LEAN = [
  null,                                                    // 0 liquid metal: the home material leans nowhere
  L(0.3, 0.2, 0, 0.1, 'faders', 'scroll3d', 'on-ice'),     // 1 glass
  L(0.2, 0.4, 0, 0, 'hodge', 'scroll3d', 'on-violet'),     // 2 velvet flesh
  L(0, 0, 0.4, 0.1, 'brain', 'brain3d', 'on-ember'),       // 3 obsidian
  L(0, 0.2, 0, 0.3, 'venus', 'life3d'),                    // 4 iridescent
  L(0, 0.1, 0.1, 0.3, 'rainzha', 'brain3d'),               // 5 fluorescent
  L(-0.2, 0, 0.5, 0.3, 'brain', 'brain3d', 'on-ember'),    // 6 fire
  L(0.2, 0.5, -0.2, 0, 'pond', 'scroll3d', 'on-ice'),      // 7 water
  L(0, 0.2, 0, 0.4, 'perfume', 'scroll3d', 'on-violet'),   // 8 air
  L(0.5, 0, 0.1, -0.2, 'rug', 'rug3d', 'on-moss'),         // 9 earth
  L(0.5, 0, 0, -0.2, 'life', 'life3d', 'on-moss'),         // 10 lead
  L(0, 0.5, 0, 0.1, 'zhabo', 'scroll3d'),                  // 11 tin
  L(-0.1, 0, 0.5, 0.2, 'faders', 'brain3d', 'on-ember'),   // 12 iron
  L(0, 0.4, 0, 0.2, 'zhabo', 'scroll3d', 'on-gold'),       // 13 gold
  L(0.1, 0.3, 0, 0.2, 'venus', 'life3d', 'aurora'),        // 14 copper
  L(0, 0.4, 0, 0.2, 'rainzha', 'scroll3d', 'on-ice'),      // 15 quicksilver
  L(0.3, 0.3, 0, 0, 'hodge', 'scroll3d', 'on-ice'),        // 16 silver
];
// each stone (sector k of the sky, SECTOR_ID[k] = 17 + k): its sector's element and its metal, as the page's particle and
// serpent weights already pair them; each gem: its kin (materials.mjs KIN), the first one giving its rule
const STONE_KIN = [[6, 12], [9, 14], [8, 15], [7, 16], [6, 13], [9, 15], [8, 14], [7, 12], [6, 11], [9, 10], [8, 10], [7, 11]];
function blend(ids) {
  const ls = ids.map((i) => MAT_LEAN[i]).filter(Boolean), mood = {};
  for (const m of MOODS) mood[m] = ls.reduce((s, l) => s + l.mood[m], 0) / ls.length;
  return { mood, rule: ls[0].rule, rule3d: ls[0].rule3d, palette: ls[0].palette };
}
export const MAT_LEAN = BASE_LEAN.slice();
STONE_KIN.forEach((k, i) => { MAT_LEAN[SECTOR_ID[i]] = blend(k); });
KIN.forEach((k, i) => { MAT_LEAN[GEM_ID[i]] = blend(k); });
MAT_LEAN[38] = blend([6, 7, 8, 9]);   // fourfold earth: the four elements in balance (its rule is fire's, the first)
export const MAT_GAIN = 0.8;          // how far the shown materials move the mood, against arousal and the song's character

/** the strongest shown material that leans somewhere: { id, w, lean } or null. mats: { ids, w } (the shader's four slots) */
export function leadMaterial(mats) {
  if (!mats || !mats.ids) return null;
  let best = null;
  for (let s = 0; s < mats.ids.length; s++) {
    const id = mats.ids[s] | 0, w = num(mats.w[s], 0), lean = MAT_LEAN[id];
    if (lean && w > 0 && (!best || w > best.w)) best = { id, w, lean };
  }
  return best;
}
export function moodScores(arousal, char, mats = null) {
  const c = char || {}, o = {};
  for (const m of MOODS) {
    const w = MOOD_WEIGHTS[m]; let s = w.bias;
    for (const [k, v] of Object.entries(w)) if (k !== 'bias') s += v * (k === 'arousal' ? num(arousal, 0.3) : num(c[k]));
    if (mats && mats.ids) for (let i = 0; i < mats.ids.length; i++) { const l = MAT_LEAN[mats.ids[i] | 0]; if (l) s += MAT_GAIN * num(mats.w[i], 0) * l.mood[m]; }
    o[m] = s;
  }
  return o;
}
export function moodOf(arousal, char, mats = null) { const s = moodScores(arousal, char, mats); return MOODS.reduce((a, b) => (s[b] > s[a] ? b : a), MOODS[0]); }

// a small stable hash, so a song and a section always pick the same rule
export function mix32(a, b = 0) { let h = (Math.imul(a >>> 0, 0x9E3779B1) ^ Math.imul((b >>> 0) + 0x7F4A7C15, 0x85EBCA77)) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D) >>> 0; h ^= h >>> 12; return h >>> 0; }
/** the surface rule a mood grows for this song at this section (sections walk through the mood's list from a song's own start) */
export function surfaceRuleFor(mood, songSeed, section = 0, mats = null) {
  const list = MOOD_RULES.surface[mood] || MOOD_RULES.surface.flowing, lead = leadMaterial(mats);
  // a material clearly present grows its own automaton: the walk through the mood's list starts at it, and a material that
  // dominates the body (LEAD_ALL) grows it whatever the mood
  if (lead && lead.w >= LEAD_ALL && !list.includes(lead.lean.rule)) return lead.lean.rule;
  const at = lead && lead.w >= LEAD_MIN ? list.indexOf(lead.lean.rule) : -1;
  return list[((at >= 0 ? at : mix32(songSeed, 0x51)) + section) % list.length];
}
export const LEAD_MIN = 0.3, LEAD_ALL = 0.55;
export function insideRuleFor(mood, mats = null) {
  const lead = leadMaterial(mats);
  return lead && lead.w >= LEAD_MIN ? lead.lean.rule3d : (MOOD_RULES.inside[mood] || MOOD_RULES.inside.flowing)[0];
}
/** the palette for a rule: the leading material's own when it is clearly present and grows this rule, else the rule's */
export function paletteFor(dim, id, mats = null) {
  const lead = leadMaterial(mats), r = dim === 'surface' ? rule2d(id) : rule3d(id);
  return lead && lead.w >= LEAD_MIN && lead.lean.palette && (dim === 'surface' ? lead.lean.rule : lead.lean.rule3d) === r.id ? lead.lean.palette : r.palette;
}

/** how often this song's surfacings belong to the automaton rather than the grown form (0.3..0.8): regular, dense,
 *  intricate music leans to it, very tonal music to the grown form */
export function shareFor(char) {
  const c = char || {};
  const s = 0.35 + 0.35 * num(c.regularity) + 0.2 * num(c.intricacy) + 0.15 * num(c.density) - 0.25 * num(c.tonality);
  return Math.min(0.8, Math.max(0.3, s));
}
/** a song's remembered automaton (memory meta.cellab), or null when it is not one */
export function validCellab(m) {
  if (!m || typeof m !== 'object') return null;
  if (!(m.rule in INDEX_2D) || !(m.rule3d in INDEX_3D) || !MOODS.includes(m.mood)) return null;
  return { rule: m.rule, rule3d: m.rule3d, mood: m.mood, share: Number.isFinite(m.share) ? Math.min(0.8, Math.max(0.3, m.share)) : 0.5 };
}
