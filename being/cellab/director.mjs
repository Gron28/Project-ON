// being/cellab/director.mjs - which automaton ON grows, when it changes, how fast it runs and where it is seeded. Pure.
//
// The mood (calm / flowing / rough / wild, rules.mjs MOOD_WEIGHTS) comes from the mind's arousal and the song's absolute
// character, and must hold 3 s (and the last one 8 s) before it changes. A song keeps its first automaton in memory
// (meta.cellab: surface rule, inside rule, mood, share) and starts from it when it returns; sections walk the mood's list
// of rules from there. A mood change while the automaton is out of sight takes effect at once; while it shows, at the next
// section. Each surfacing of the song's skin belongs to the automaton with the song's share (shareFor), otherwise to the
// grown form. Growth is seeded where the sound lands: a seed at the song map's best-matching unit on each felt beat (as
// the Lenia skin is seeded), plus a few raindrops (RainZha's own way of being fed); the drop and startles seed more.

import { MOODS, RULES_2D, RULES_3D, moodOf, surfaceRuleFor, insideRuleFor, shareFor, validCellab, rule2d, rule3d } from './rules.mjs';

const MOOD_RATE = { calm: 0.6, flowing: 1, rough: 1.15, wild: 1.4 };
function mulberry32(a) { return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

export function createCellabDirector({ seed = 1 } = {}) {
  const rnd = mulberry32(seed ^ 0x3C6EF372);
  const st = {
    mood: 'flowing', cand: null, candT: 0, moodT: 0,
    rule: 'hodge', rule3d: 'scroll3d', songSeed: seed >>> 0, section: 0, share: 0.5, known: false, lead: false,
    force: null, force3d: null,   // the dashboard's choice ('auto' = null)
    v2: 0, v3: 0,                  // bumped whenever the shown rule changes: the GPU starts the new one from a fresh soup
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
      else { st.known = false; st.share = shareFor(char); set2(surfaceRuleFor(st.mood, st.songSeed, 0)); set3(insideRuleFor(st.mood)); }
      st.v2++; st.v3++;
      return v;
    },
    remember() { return { rule: st.rule, rule3d: st.rule3d, mood: st.mood, share: +st.share.toFixed(3) }; },
    /** the mood, held before it changes; shown: whether the surface automaton is visible now (then rules wait for a section) */
    feel(dt, arousal, char, shown = false) {
      st.moodT += dt;
      const m = moodOf(arousal, char);
      if (m === st.mood) { st.cand = null; return st.mood; }
      if (m !== st.cand) { st.cand = m; st.candT = 0; }
      st.candT += dt;
      if (st.candT > 3 && st.moodT > 8) {
        st.mood = m; st.cand = null; st.moodT = 0;
        if (!shown) { set2(surfaceRuleFor(m, st.songSeed, st.section)); set3(insideRuleFor(m)); }
      }
      return st.mood;
    },
    /** a new section: the next rule of the mood's list for this song */
    section() { st.section++; set2(surfaceRuleFor(st.mood, st.songSeed, st.section)); set3(insideRuleFor(st.mood)); },
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
    beatSeeds(dim, arousal, bmu = null) {
      const a = clamp(arousal, 0, 1), out = [];
      if (dim === 'surface') {
        const sr = rule2d(D.surfaceRule).seedR || 1, s = 0.6 + 0.6 * a;
        if (bmu) { const j = 0.12; const d = [bmu[0] + (rnd() - 0.5) * j, bmu[1] + (rnd() - 0.5) * j, bmu[2] + (rnd() - 0.5) * j], l = Math.hypot(...d) || 1;
          out.push({ x: d[0] / l, y: d[1] / l, z: d[2] / l, r: (0.05 + 0.07 * s) * sr * (0.7 + 0.6 * rnd()) }); }
        const drops = Math.round(a * 2 + (bmu ? 0 : 1));   // raindrops: RainZha's way of being fed
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
