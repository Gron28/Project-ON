// lab/organism/worlds.mjs - a library of sound worlds for the bench and for evolution. Pure module (Node or page).
//
// A world is a score, not a stream: every drum hit is an event { t, type, amp } placed in time, and the beat grid is
// known exactly. That makes the controls exact:
//   groove     the world as written (grooves at 80-160 bpm, swing, syncopation, tempo ramps and jumps, 3:2 polyrhythm,
//              build and drop, stretches of silence and of white noise)
//   shuffled   the same onset groups (identical count, identical sounds, identical continuous layers) in a shuffled order,
//              with the intervals between them shuffled and jittered inside each rhythmic segment (seeded). Beats travel with the onset group
//              they sat on, so a pure reflex is locked to them exactly as in the groove; only anticipation can tell them
//              apart.
//   omission   the groove with whole beats (every sound at that instant) removed at known times
// Sounds are lab/prototypes/nervous-system/stimuli.mjs's one-shots at its level; layers (white noise, the build's rising
// wash, the drop's sub-bass) follow lab/organism/environment.mjs. framesOf() runs being/ear.mjs once over the audio and
// returns frames in environment.mjs's earFrames() format, so environment.live() runs an organism through a world.
// Everything is deterministic by world seed.

import { oneShots } from '../prototypes/nervous-system/stimuli.mjs';
import { createEar, SR, NE } from '../../being/ear.mjs';
import { lcg, mix } from './genome.mjs';

const FRAME = 192, LEVEL = 0.8, TAU = 2 * Math.PI;
export const DT_FRAME = FRAME / SR;                 // 4 ms
const SAME = 0.001;                                 // events closer than 1 ms are one onset group
const RHYTHMIC = new Set(['groove', 'poly', 'build']);

const strHash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

// ---- the written score ---------------------------------------------------------------------------------------------------

/** the 16th-step pattern of a groove (stimuli.mjs onStep, its syncopation levels), plus the drop's extra hats */
function grooveStep(k, sync, drop, push) {
  if (k === 0 || (k === 8 && sync < 0.8)) push('kick', drop ? 1 : 0.9);
  if (sync > 0.3 && k === 10) push('kick', 0.7);
  if (sync > 0.55 && k === 7) push('kick', 0.6);
  if (sync > 0.8 && (k === 3 || k === 14)) push('kick', 0.6);
  if (k === 4 || k === 12) push('snare', 0.9);
  if (sync > 0.65 && k === 15) push('snare', 0.35);
  if (k % 2 === 0) push('hat', k % 4 === 0 ? 0.9 : 0.6);
  if (drop && k % 2 === 1) push('hat', 0.5);
}

/** events, beats and layers of one segment starting at t0 */
function segmentScore(seg, t0) {
  const ev = [], beats = [], layers = [], end = t0 + seg.dur;
  const bpm0 = seg.bpm || 120, bpm1 = seg.bpm2 || bpm0;
  // tempo as a function of time in the segment: constant, a linear ramp, or a jump at the first bar after the middle
  const bpmAt = (u, barStart) => (seg.change === 'jump' ? (barStart >= seg.dur / 2 ? bpm1 : bpm0) : bpm0 + (bpm1 - bpm0) * Math.min(1, Math.max(0, u / seg.dur)));
  if (seg.style === 'silence') return { ev, beats, layers };
  if (seg.style === 'noise') { layers.push({ kind: 'noise', t0, t1: end }); return { ev, beats, layers }; }
  if (seg.noise) layers.push({ kind: 'noise', t0, t1: end, amp: seg.noise });
  const swing = seg.swing || 0, sync = seg.sync ?? 0.25;
  let t = t0, step = 0, barStart = 0, bpm = bpmAt(0, 0);
  while (t < end - 1e-9) {
    const k = step % 16, bar = Math.floor(step / 16);
    if (k === 0) { barStart = t - t0; bpm = bpmAt(t - t0, barStart); }
    const len = 60 / bpm / 4, at = t + (k % 2 === 1 ? swing * len : 0);
    const push = (type, amp) => { if (at < end) ev.push({ t: at, type, amp }); };
    if (seg.style === 'groove') grooveStep(k, sync, false, push);
    else if (seg.style === 'poly') {      // two kicks against three woodblocks per bar; the felt pulse is the kicks'
      if (k === 0 || k === 8) push('kick', 0.9);
      if (k === 0) { const bar4 = 16 * len; for (let j = 0; j < 3; j++) { const tb = t + j * bar4 / 3; if (tb < end) ev.push({ t: tb, type: 'block', amp: 0.8 }); } }
    } else if (seg.style === 'build') {   // a 10-bar cycle: 2 bars groove, 4 bars of a doubling snare roll (wash rising, last beat silent), 4 bars drop
      const c = bar % 10;
      if (c < 2) grooveStep(k, sync, false, push);
      else if (c < 6) {
        const b = c - 2, every = [4, 2, 1, 1][b];
        if (!(b === 3 && k >= 12) && k % every === 0) push('snare', 0.35 + 0.15 * b + 0.03 * k / 4);
        if (k === 0) layers.push({ kind: 'wash', t0: t, t1: Math.min(end, t + 16 * len), b, bar: 16 * len });
      } else {
        grooveStep(k, sync, true, push);
        if (k === 0) layers.push({ kind: 'sub', t0: t, t1: Math.min(end, t + 16 * len) });
      }
    }
    const beatEvery = seg.style === 'poly' ? 8 : 4;
    if (k % beatEvery === 0) beats.push({ t, period: beatEvery * len });
    t += len; step++;
  }
  return { ev, beats, layers };
}

/** the full written score of a world spec: { events, beats, layers, segs: [{ t0, t1, style }] } */
export function scoreOf(spec) {
  let t0 = 0; const events = [], beats = [], layers = [], segs = [];
  for (const seg of spec.segments) {
    const s = segmentScore(seg, t0);
    events.push(...s.ev); beats.push(...s.beats); layers.push(...s.layers);
    segs.push({ t0, t1: t0 + seg.dur, style: seg.style, rhythmic: RHYTHMIC.has(seg.style), bpm: seg.bpm || 0 });
    t0 += seg.dur;
  }
  events.sort((a, b) => a.t - b.t);
  return { events, beats, layers, segs, dur: t0 };
}

/** onset groups: events within 1 ms of each other, each with the beat it carries (if any) */
function groupsOf(events, beats) {
  const groups = [];
  for (const e of events) { const g = groups[groups.length - 1]; if (g && e.t - g.t < SAME) g.ev.push(e); else groups.push({ t: e.t, ev: [e], beat: null }); }
  let j = 0;
  for (const b of beats) { while (j < groups.length && groups[j].t < b.t - SAME) j++; if (j < groups.length && Math.abs(groups[j].t - b.t) < SAME) groups[j].beat = b; }
  return groups;
}

// ---- variants --------------------------------------------------------------------------------------------------------------

/** the same onset groups inside each rhythmic segment, in a shuffled order, separated by the segment's own intervals
 *  shuffled and jittered (each x0.3-1.7, renormalised to the same span: a steady hat line has nothing to shuffle
 *  otherwise); first and last onset times are kept. Beats move with their group. */
export function shuffleScore(sc, seed) {
  const r = lcg(mix(seed, 0x5f1)), groups = groupsOf(sc.events, sc.beats), events = [], beats = [];
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const k = r.int(i + 1); [a[i], a[k]] = [a[k], a[i]]; } return a; };
  for (const sg of sc.segs) {
    let gs = groups.filter((g) => g.t >= sg.t0 - 1e-9 && g.t < sg.t1 - 1e-9);
    if (!gs.length) continue;
    if (!sg.rhythmic || gs.length < 3) { for (const g of gs) { events.push(...g.ev); if (g.beat) beats.push(g.beat); } continue; }
    let ioi = shuffle(gs.slice(1).map((g, i) => g.t - gs[i].t));
    const span = ioi.reduce((s, x) => s + x, 0); ioi = ioi.map((x) => x * (0.3 + 1.4 * r()));
    const k = span / ioi.reduce((s, x) => s + x, 0); ioi = ioi.map((x) => x * k);
    const t0 = gs[0].t; gs = shuffle(gs.slice());
    let t = t0;
    gs.forEach((g, i) => {
      if (i > 0) t += ioi[i - 1];
      for (const e of g.ev) events.push({ ...e, t: t + (e.t - g.t) });
      if (g.beat) beats.push({ t, period: g.beat.period });
    });
  }
  events.sort((a, b) => a.t - b.t); beats.sort((a, b) => a.t - b.t);
  return { ...sc, events, beats };
}

/** the groove with whole beats removed: every sound at that instant; one eligible beat in every 4-8 (seeded), so never two
 *  in a row, never in the first `after` seconds, on a segment's first beat or in its last half second */
export function omitScore(sc, seed, { gap = [4, 8], after = 4 } = {}) {
  const r = lcg(mix(seed, 0x0b1)), groups = groupsOf(sc.events, sc.beats), drop = new Set(), omitted = [];
  let wait = gap[0] + r.int(gap[1] - gap[0] + 1);
  for (const g of groups) {
    if (!g.beat) continue;
    const sg = sc.segs.find((s) => g.t >= s.t0 && g.t < s.t1);
    const first = !sg || g.t - sg.t0 < g.beat.period * 0.99;
    if (!(sg && sg.rhythmic && g.t >= after && !first && g.t < sc.dur - 0.5)) continue;
    if (--wait <= 0) { drop.add(g); omitted.push(g.t); wait = gap[0] + r.int(gap[1] - gap[0] + 1); }
  }
  const events = []; for (const g of groups) if (!drop.has(g)) events.push(...g.ev);
  return { ...sc, events, omitted };
}

// ---- the library -------------------------------------------------------------------------------------------------------------

const G = (bpm, dur, o = {}) => ({ style: 'groove', bpm, dur, ...o });
/** world specs (durations in s; `dur` scales every segment proportionally). Train and held-out sets share no tempo and the
 *  held-out set adds a triplet shuffle, heavy syncopation, a tempo jump and the tempo extremes 80 and 160 bpm. */
export const TRAIN = [
  { name: 'groove-96', segments: [G(96, 24, { sync: 0.25 })] },
  { name: 'swing-120', segments: [G(120, 24, { sync: 0.5, swing: 0.2 })] },
  { name: 'sync-140', segments: [G(140, 24, { sync: 0.7 })] },
  { name: 'poly-100', segments: [{ style: 'poly', bpm: 100, dur: 24 }] },
  { name: 'build-124', segments: [{ style: 'build', bpm: 124, dur: 24 }] },
  { name: 'ramp-108-132', segments: [G(108, 24, { bpm2: 132, sync: 0.4 })] },
  { name: 'silence-104', segments: [G(104, 10), { style: 'silence', dur: 4 }, G(104, 10)] },
  { name: 'noise-132', segments: [G(132, 10, { sync: 0.3 }), { style: 'noise', dur: 4 }, G(132, 10, { sync: 0.3, noise: 0.08 })] },
];
export const TEST = [
  { name: 'groove-80', segments: [G(80, 24, { sync: 0.25 })] },
  { name: 'shuffle-88', segments: [G(88, 24, { sync: 0.4, swing: 0.33 })] },
  { name: 'sync-152', segments: [G(152, 24, { sync: 0.9 })] },
  { name: 'jump-116-92', segments: [G(116, 24, { bpm2: 92, change: 'jump', sync: 0.4 })] },
  { name: 'poly-136', segments: [{ style: 'poly', bpm: 136, dur: 24 }] },
  { name: 'build-146', segments: [{ style: 'build', bpm: 146, dur: 24 }] },
  { name: 'stretch-160', segments: [G(160, 8), { style: 'silence', dur: 3 }, G(160, 6), { style: 'noise', dur: 3 }, G(160, 4)] },
];
export const VARIANTS = ['groove', 'shuffled', 'omission'];

/** a world: spec + variant -> the score to render, deterministic by (spec name, variant, seed) */
export function makeWorld(spec, variant = 'groove', { seed = 1, dur = null, set = '' } = {}) {
  const total = spec.segments.reduce((s, x) => s + x.dur, 0), k = dur ? dur / total : 1;
  const segments = spec.segments.map((s) => ({ ...s, dur: s.dur * k }));
  const wseed = mix(seed, strHash(spec.name));
  let sc = scoreOf({ segments });
  if (variant === 'shuffled') sc = shuffleScore(sc, wseed);
  else if (variant === 'omission') sc = omitScore(sc, wseed);
  else if (variant !== 'groove') throw new Error('unknown variant ' + variant);
  return { name: spec.name, set, variant, seed: wseed, segments, ...sc, omitted: sc.omitted || [] };
}
/** every world of a set in the requested variants */
export function worldSet(specs, { variants = VARIANTS, seed = 1, dur = null, set = '' } = {}) {
  const out = []; for (const s of specs) for (const v of variants) out.push(makeWorld(s, v, { seed, dur, set })); return out;
}
export const onsetCount = (w) => groupsOf(w.events, []).length;

// ---- rendering -------------------------------------------------------------------------------------------------------------

let SHOTS = null;
/** the world's audio at 48 kHz */
export function render(w) {
  SHOTS = SHOTS || oneShots();
  const n = Math.floor(w.dur * SR), x = new Float32Array(n), r = lcg(mix(w.seed, 0xa0d));
  for (const e of w.events) {
    const b = SHOTS[e.type], i0 = Math.round(e.t * SR), a = e.amp * LEVEL;
    for (let i = 0; i < b.length && i0 + i < n; i++) if (i0 + i >= 0) x[i0 + i] += b[i] * a;
  }
  for (const L of w.layers) {
    const i0 = Math.max(0, Math.round(L.t0 * SR)), i1 = Math.min(n, Math.round(L.t1 * SR));
    if (L.kind === 'noise') { const a = (L.amp ?? 0.25) * (LEVEL / 0.8); for (let i = i0; i < i1; i++) x[i] += a * (2 * r() - 1); }
    else if (L.kind === 'wash') for (let i = i0; i < i1; i++) { const u = (L.b + (i - i0) / (L.bar * SR)) / 4; if (u < 0.94) x[i] += LEVEL * 0.12 * u * u * (2 * r() - 1); }
    else if (L.kind === 'sub') for (let i = i0; i < i1; i++) x[i] += LEVEL * 0.35 * Math.sin(TAU * 45 * i / SR);
  }
  return x;
}

/** being/ear.mjs over the world, in environment.mjs earFrames() format (+ the world itself) */
export function framesOf(w) {
  const x = render(w), ear = createEar(), n = Math.floor(x.length / FRAME);
  const amp = new Float32Array(n * NE), onset = new Float32Array(n), rough = new Float32Array(n), sub = new Float32Array(n), seg = new Uint8Array(n);
  const schedule = w.segs.map((s) => ({ mode: s.style, dur: s.t1 - s.t0, bpm: s.bpm }));
  let si = 0;
  for (let f = 0; f < n; f++) {
    for (let i = f * FRAME, e = i + FRAME; i < e; i++) ear.sample(x[i]);
    const fr = ear.frame(); amp.set(fr.amp, f * NE); onset[f] = fr.onset; rough[f] = fr.rough; sub[f] = fr.sub;
    while (si < w.segs.length - 1 && (f + 1) * DT_FRAME > w.segs[si].t1) si++;
    seg[f] = si;
  }
  return { n, amp, onset, rough, sub, seg, schedule, world: w };
}
