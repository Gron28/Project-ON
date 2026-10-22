// lab/organism/rhythm.mjs - a drum sequencer for the organism's worlds, generated sample by sample at 48 kHz. Pure module.
//
// Patterns on a 16th-note grid, any tempo, swing (the off-8ths late by a share of an 8th), a tempo ramp across the segment
// (bpm -> bpmEnd), omitted beats (every hit on that beat's downbeat step is left out: the expected-but-missing beat), and
// a shuffled-interval control: the same hits, sounds and levels, with the intervals between successive hit times
// rescaled by random factors (log-uniform 0.5-2x, renormalised so each 4-bar block keeps its span) and permuted within
// the block (same onsets and mean rate, no periodic grid; a plain permutation would leave an isochronous hat line as it was). Every beat of the nominal grid is logged with its
// time and whether it was omitted, and every hit with its time, so analysis can align what the organism did with the beat.
//
//   const q = createSequencer({ pattern: 'rock', bpm: 120, swing: 0.2, omit: 0.1, shuffle: false, seed: 3 });
//   q.sample() -> next sample; q.beats [{ t, omitted }], q.hits [{ t, amp }] (seconds from the sequencer's start)

import { oneShots } from '../prototypes/nervous-system/stimuli.mjs';
import { lcg } from './genome.mjs';

const SR = 48000;
// [kick steps, snare steps, hat steps] per 16-step bar; ghost: a quieter extra kick
export const PATTERNS = {
  pulse: { kick: [0, 4, 8, 12], snare: [], hat: [] },                                   // one event per beat (omission tests)
  rock: { kick: [0, 8], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], ghost: [10] },
  four: { kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14] },
  half: { kick: [0], snare: [8], hat: [0, 2, 4, 6, 8, 10, 12, 14], ghost: [11] },
  break: { kick: [0, 10], snare: [4, 12], hat: [0, 2, 3, 4, 6, 8, 10, 11, 12, 14], ghost: [7] },
};
const SHOTS = oneShots();

export function createSequencer({ pattern = 'rock', bpm = 120, bpmEnd = null, dur = Infinity, swing = 0, omit = 0, shuffle = false, seed = 1, level = 0.8 } = {}) {
  const P = PATTERNS[pattern] || PATTERNS.rock, r = lcg(seed), end = bpmEnd ?? bpm;
  const queue = [];                  // pending hits { n (sample), buf, amp }
  const voices = [], beats = [], hits = [];
  let n = 0, step = 0, tStep = 0;    // tStep: the grid time (s) of the next 16th step
  const bpmAt = (t) => (Number.isFinite(dur) ? bpm + (end - bpm) * Math.min(1, t / dur) : bpm);

  // one 4-bar block of the pattern on the nominal grid
  function block() {
    const out = [];
    for (let k = 0; k < 64; k++, step++) {
      const s = step % 16, len = 60 / bpmAt(tStep) / 4;
      const sw = s % 4 === 2 ? swing * 2 * len : 0;              // off-8ths late by swing x an 8th
      const t = tStep + sw;
      if (s % 4 === 0) {
        const omitted = omit > 0 && step > 16 && r() < omit;      // never in the first bar: there must be something to expect
        beats.push({ t: tStep, omitted });
        if (omitted) { tStep += len; continue; }
      }
      if (P.kick.includes(s)) out.push({ t, buf: SHOTS.kick, amp: s === 0 ? 0.95 : 0.85 });
      if (P.ghost && P.ghost.includes(s) && r() < 0.5) out.push({ t, buf: SHOTS.kick, amp: 0.6 });
      if (P.snare.includes(s)) out.push({ t, buf: SHOTS.snare, amp: 0.9 });
      if (P.hat.includes(s)) out.push({ t, buf: SHOTS.hat, amp: s % 4 === 0 ? 0.85 : 0.6 });
      tStep += len;
    }
    if (shuffle && out.length > 2) {
      // group simultaneous hits; rescale and permute the intervals between groups; keep the block's start and span
      const times = [...new Set(out.map((h) => h.t))].sort((a, b) => a - b), gaps = [];
      for (let i = 1; i < times.length; i++) gaps.push((times[i] - times[i - 1]) * 2 ** (2 * r() - 1));
      const span = times[times.length - 1] - times[0], sum = gaps.reduce((a, b) => a + b, 0); for (let i = 0; i < gaps.length; i++) gaps[i] *= span / sum;
      for (let i = gaps.length - 1; i > 0; i--) { const j = r.int(i + 1); [gaps[i], gaps[j]] = [gaps[j], gaps[i]]; }
      const map = new Map([[times[0], times[0]]]); let acc = times[0];
      for (let i = 1; i < times.length; i++) { acc += gaps[i - 1]; map.set(times[i], acc); }
      for (const h of out) h.t = map.get(h.t);
    }
    out.sort((a, b) => a.t - b.t);
    for (const h of out) { queue.push({ n: Math.round(h.t * SR), buf: h.buf, amp: h.amp }); hits.push({ t: h.t, amp: h.amp }); }
  }

  function sample() {
    while (!queue.length || queue[queue.length - 1].n < n + SR) { const before = queue.length; block(); if (queue.length === before && tStep * SR > n + 4 * SR) break; }
    while (queue.length && queue[0].n <= n) { const h = queue.shift(); voices.push({ b: h.buf, i: 0, a: h.amp }); }
    let x = 0;
    for (let v = voices.length - 1; v >= 0; v--) { const vo = voices[v]; x += vo.b[vo.i++] * vo.a; if (vo.i >= vo.b.length) voices.splice(v, 1); }
    n++;
    return x * level;
  }
  // the logs are generated ahead of time; trim what lies beyond the sequencer's current time on request
  const upTo = (list) => list.filter((e) => e.t <= n / SR);
  return { sample, beats, hits, get t() { return n / SR; }, heard: () => ({ beats: upTo(beats), hits: upTo(hits) }), get bpm() { return bpmAt(n / SR); }, pattern, shuffle, omit };
}
