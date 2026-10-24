// being/cellab/director.mjs - which automaton ON grows, when it changes, how fast it runs and where it is seeded. Pure.
//
// The mood (calm / flowing / rough / wild, rules.mjs MOOD_WEIGHTS) comes from the mind's arousal and the song's absolute
// character, and must hold 3 s (and the last one 8 s) before it changes. A song keeps its first automaton in memory
// (meta.cellab: surface rule, inside rule, mood, share) and starts from it when it returns; sections walk the mood's list
// of rules from there. A mood change while the automaton is out of sight takes effect at once; while it shows, at the next
// section. Each surfacing of the song's skin belongs to the automaton with the song's share (shareFor), otherwise to the
// grown form. Growth is seeded where the sound lands: a seed at the song map's best-matching unit on each felt beat (as
// the Lenia skin is seeded), plus a few raindrops (RainZha's own way of being fed) while no drum is heard; the drop and
// startles seed more. The shown materials lean the mood and choose the rule and palette (rules.mjs MAT_LEAN); a new
// leading material re-chooses while the automaton is out of sight. Heard drum hits seed as the tissue's closed loop
// feeds it (being/index.html, after Kagan et al. 2022): a hit it predicted lands where the sound lands on the song map
// (on the surface) or near the nucleus (inside), always the same place, so predictable music grows one ordered form; a hit
// that surprised it scatters seeds at random, so surprise breaks the form up. Kicks seed big, snares middling, hats small.

import { MOODS, RULES_2D, RULES_3D, moodOf, surfaceRuleFor, insideRuleFor, shareFor, validCellab, rule2d, rule3d, leadMaterial, paletteFor, LEAD_MIN } from './rules.mjs';

const MOOD_RATE = { calm: 0.6, flowing: 1, rough: 1.15, wild: 1.4 };
const HIT_SIZE = { kick: 1, snare: 0.7, hat: 0.35 };
function mulberry32(a) { return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

export function createCellabDirector({ seed = 1 } = {}) {
  const rnd = mulberry32(seed ^ 0x3C6EF372);
  const st = {
    mood: 'flowing', cand: null, candT: 0, moodT: 0,
    rule: 'hodge', rule3d: 'scroll3d', songSeed: seed >>> 0, section: 0, share: 0.5, known: false, lead: false,
    force: null, force3d: null,   // the dashboard's choice ('auto' = null)
    v2: 0, v3: 0,                  // bumped whenever the shown rule changes: the GPU starts the new one from a fresh soup
    mats: null, leadId: -1, leadNew: false,   // the shown materials ({ ids, w }), the leading one that leans somewhere, and whether it
                                            // changed since the automaton was last chosen (applied once it is out of sight)
  };
  const set2 = (id) => { if (id !== st.rule) { st.rule = id; if (!st.force) st.v2++; } };
  const set3 = (id) => { if (id !== st.rule3d) { st.rule3d = id; if (!st.force3d) st.v3++; } };
  const randDir = () => { const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z); return [r * Math.cos(a), z, r * Math.sin(a)]; };
  const D = {
    st,
    get surfaceRule() { return st.force || st.rule; },
    get insideRule() { return st.force3d || st.rule3d; },
    /** a new song: its remembered automaton, or a fresh choice from the mood (share from its character) */
    song(meta, songSeed, char) {
      st.songSeed = songSeed >>> 0; st.section = 0; st.lead = false;
      const v = validCellab(meta);
      if (v) { st.mood = v.mood; set2(v.rule); set3(v.rule3d); st.share = v.share; st.known = true; }
      else { st.known = false; st.share = shareFor(char); set2(surfaceRuleFor(st.mood, st.songSeed, 0, st.mats)); set3(insideRuleFor(st.mood, st.mats)); }
      st.v2++; st.v3++;
      return v;
    },
    remember() { return { rule: st.rule, rule3d: st.rule3d, mood: st.mood, share: +st.share.toFixed(3) }; },
    /** the mood, held before it changes; shown: whether the surface automaton is visible now (then rules wait for a section) */
    feel(dt, arousal, char, shown = false, mats = null) {
      st.moodT += dt;
      if (mats && mats.ids) st.mats = { ids: Array.from(mats.ids), w: Array.from(mats.w) };
      // a new leading material: its automaton is chosen once the automaton is out of sight (in sight, at the next section)
      const lead = leadMaterial(st.mats), leadId = lead && lead.w >= LEAD_MIN ? lead.id : -1;
      if (leadId !== st.leadId) { st.leadId = leadId; st.leadNew = true; }
      if (st.leadNew && !shown) { st.leadNew = false; if (!st.known) { set2(surfaceRuleFor(st.mood, st.songSeed, st.section, st.mats)); set3(insideRuleFor(st.mood, st.mats)); } }
      const m = moodOf(arousal, char, st.mats);
      if (m === st.mood) { st.cand = null; return st.mood; }
      if (m !== st.cand) { st.cand = m; st.candT = 0; }
      st.candT += dt;
      if (st.candT > 3 && st.moodT > 8) {
        st.mood = m; st.cand = null; st.moodT = 0;
        if (!shown) { set2(surfaceRuleFor(m, st.songSeed, st.section, st.mats)); set3(insideRuleFor(m, st.mats)); }
      }
      return st.mood;
    },
    /** a new section: the next rule of the mood's list for this song */
    section() { st.section++; set2(surfaceRuleFor(st.mood, st.songSeed, st.section, st.mats)); set3(insideRuleFor(st.mood, st.mats)); },
    /** the palette each automaton is shown in now (rules.mjs paletteFor: the leading material's own, or the rule's) */
    palette(dim) { return dim === 'surface' ? paletteFor('surface', D.surfaceRule, st.mats) : paletteFor('inside', D.insideRule, st.mats); },
    /** start the shown automaton again from a fresh soup ('not this', a new form) */
    renew(dim) { if (dim === 'surface') st.v2++; else st.v3++; },
    /** the song's skin surfaces again: is this surfacing the automaton's? */
    surfacing() { st.lead = rnd() < st.share; return st.lead; },
    force(dim, id) {
      if (dim === 'surface') { const v = id && RULES_2D.some((r) => r.id === id) ? id : null; if (v !== st.force) { st.force = v; st.v2++; } }
      else { const v = id && RULES_3D.some((r) => r.id === id) ? id : null; if (v !== st.force3d) { st.force3d = v; st.v3++; } }
    },
    /** cellular steps per second: the rule's own pace, quickened by arousal and the mood, still when asleep */
    rate(dim, arousal, sleep = 0) {
      const r = dim === 'surface' ? rule2d(D.surfaceRule) : rule3d(D.insideRule);
      return r.steps * (0.35 + 1.3 * clamp(arousal, 0, 1)) * MOOD_RATE[st.mood] * (1 - clamp(sleep, 0, 1));
    },
    /** seeds for one felt beat. bmu: the unit direction where the sound lands on the song map (or null) */
    beatSeeds(dim, arousal, bmu = null, quiet = true) {
      const a = clamp(arousal, 0, 1), out = [];
      if (dim === 'surface') {
        const sr = rule2d(D.surfaceRule).seedR || 1, s = 0.6 + 0.6 * a;
        if (bmu) { const j = 0.12; const d = [bmu[0] + (rnd() - 0.5) * j, bmu[1] + (rnd() - 0.5) * j, bmu[2] + (rnd() - 0.5) * j], l = Math.hypot(...d) || 1;
          out.push({ x: d[0] / l, y: d[1] / l, z: d[2] / l, r: (0.05 + 0.07 * s) * sr * (0.7 + 0.6 * rnd()) }); }
        const drops = quiet ? Math.round(a * 2 + (bmu ? 0 : 1)) : 0;   // raindrops: RainZha's way of being fed (while no drum feeds it)
        for (let i = 0; i < drops; i++) { const [x, y, z] = randDir(); out.push({ x, y, z, r: (0.03 + 0.04 * s) * sr * (0.7 + 0.6 * rnd()) }); }
      } else {
        const n = Math.max(1, Math.round(0.7 * (1 + 2 * a)));
        for (let i = 0; i < n; i++) {
          const [x, y, z] = randDir(), [nx, ny, nz] = randDir(), rr = 0.75 * Math.cbrt(rnd());
          out.push({ x: x * rr, y: y * rr, z: z * rr, r: (0.1 + 0.1 * (0.6 + 0.6 * a)) * (0.7 + 0.6 * rnd()), nx, ny, nz });
        }
      }
      return out;
    },
    /** seeds for one heard drum hit: predicted, the same ordered place (bmu on the surface, near the nucleus inside);
     *  a surprise, scattered at random. type: kick | snare | hat; s: its strength 0..1 */
    hitSeeds(dim, type, s, predicted, bmu = null) {
      const size = (HIT_SIZE[type] || 0.5) * (0.5 + 0.5 * clamp(s, 0, 1)), out = [];
      if (dim === 'surface') {
        const sr = rule2d(D.surfaceRule).seedR || 1;
        if (predicted && bmu) { const j = 0.06; const d = [bmu[0] + (rnd() - 0.5) * j, bmu[1] + (rnd() - 0.5) * j, bmu[2] + (rnd() - 0.5) * j], l = Math.hypot(...d) || 1;
          out.push({ x: d[0] / l, y: d[1] / l, z: d[2] / l, r: 0.1 * size * sr }); }
        else for (let i = 0, n = type === 'hat' ? 1 : 2; i < n; i++) { const [x, y, z] = randDir(); out.push({ x, y, z, r: 0.08 * size * sr * (0.7 + 0.6 * rnd()) }); }
      } else {
        const [x, y, z] = randDir(), [nx, ny, nz] = randDir(), rr = predicted ? 0.2 * rnd() : 0.35 + 0.4 * Math.cbrt(rnd());
        out.push({ x: x * rr, y: y * rr, z: z * rr, r: (0.08 + 0.12 * size), nx, ny, nz });
      }
      return out;
    },
    /** a burst (the drop, a startle): more and bigger seeds */
    burstSeeds(dim, strength = 1) {
      const out = [], n = 2 + Math.round(2 * clamp(strength, 0, 1.5));
      for (let i = 0; i < n; i++) {
        const [x, y, z] = randDir();
        if (dim === 'surface') out.push({ x, y, z, r: (0.05 + 0.1 * strength) * (rule2d(D.surfaceRule).seedR || 1) * (0.7 + 0.6 * rnd()) });
        else { const [nx, ny, nz] = randDir(), rr = 0.7 * Math.cbrt(rnd()); out.push({ x: x * rr, y: y * rr, z: z * rr, r: 0.14 + 0.12 * strength, nx, ny, nz }); }
      }
      return out;
    },
  };
  return D;
}
export { MOODS };
