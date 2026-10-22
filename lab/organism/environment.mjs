// lab/organism/environment.mjs - the sound world an organism lives in during evolution and tests. Pure module.
//
// A schedule of segments [{ mode, dur, bpm? }]. Modes from lab/prototypes/nervous-system/stimuli.mjs (groove, tone, build,
// poly, click, rough, silence) plus two controls of our own: 'noise' (white noise) and 'scatter' (the same drum sounds as
// the groove at the same density, at random Poisson times: the structure-free control for a groove).
// earFrames() runs being/ear.mjs once over a schedule and keeps every 4 ms frame, so a whole population can live through
// the same sound without each organism re-running the ear (the ear does not depend on the organism: exact, not approx).

import { createStimuli, oneShots } from '../prototypes/nervous-system/stimuli.mjs';
import { createEar, SR, NE } from '../../being/ear.mjs';
import { lcg } from './genome.mjs';

const FRAME = 192;

/** an interactive source: the stimuli's modes plus 'noise' and 'scatter' (st: the stimuli, for tempo, level, bursts) */
export function createSource(seed = 1) {
  const st = createStimuli(), shots = oneShots(), r = lcg(seed), voices = [], one = new Float32Array(1);
  let mode = 'silence';
  function sample() {
    let x = st.fill(one)[0];
    if (mode === 'noise') x += 0.25 * (2 * r() - 1) * (st.o.level / 0.8);   // level 0.8 (the default) gives exactly the evolved noise
    if (mode === 'scatter' && r() < 6 / SR) {        // ~6 hits a second, kick : snare : hat as in the groove
      const u = r(); voices.push({ b: u < 0.2 ? shots.kick : u < 0.37 ? shots.snare : shots.hat, i: 0, a: u < 0.2 ? 0.9 : u < 0.37 ? 0.9 : 0.75 });
    }
    for (let v = voices.length - 1; v >= 0; v--) { const vo = voices[v]; x += vo.b[vo.i++] * vo.a * st.o.level; if (vo.i >= vo.b.length) voices.splice(v, 1); }
    return x;
  }
  return {
    st, sample,
    get mode() { return mode; },
    /** the tempo being played (0 when the mode has none) */
    get bpm() { return mode === 'scatter' || mode === 'noise' ? 0 : st.bpm; },
    setMode(m, { bpm, sync } = {}) { mode = m; if (bpm) st.o.bpm = bpm; if (sync !== undefined) st.o.sync = sync; st.setMode(m === 'noise' || m === 'scatter' ? 'silence' : m); },
    fill(buf) { for (let i = 0; i < buf.length; i++) buf[i] = sample(); return buf; },
  };
}

export function createEnvironment(schedule, seed = 1) {
  const src = createSource(seed), total = schedule.reduce((s, x) => s + x.dur, 0);
  let n = 0, seg = -1, segEnd = 0;
  function enter(i) { seg = i; const s = schedule[i]; segEnd += Math.round(s.dur * SR); src.setMode(s.mode, s); }
  enter(0);
  return {
    total, schedule,
    get t() { return n / SR; }, get segment() { return schedule[Math.min(seg, schedule.length - 1)]; },
    fill(buf) { for (let i = 0; i < buf.length; i++) { while (n >= segEnd && seg < schedule.length - 1) enter(seg + 1); buf[i] = src.sample(); n++; } return buf; },
  };
}

/** the ear's 4 ms frames over a whole schedule: { n, amp (n x NE), onset, rough, sub, mode (segment index per frame) } */
export function earFrames(schedule, seed = 1) {
  const env = createEnvironment(schedule, seed), ear = createEar();
  const n = Math.floor(env.total * SR / FRAME);
  const amp = new Float32Array(n * NE), onset = new Float32Array(n), rough = new Float32Array(n), sub = new Float32Array(n), seg = new Uint8Array(n);
  const buf = new Float32Array(FRAME);
  let si = 0, acc = schedule[0].dur;
  for (let f = 0; f < n; f++) {
    env.fill(buf); for (let i = 0; i < FRAME; i++) ear.sample(buf[i]);
    const fr = ear.frame(); amp.set(fr.amp, f * NE); onset[f] = fr.onset; rough[f] = fr.rough; sub[f] = fr.sub;
    while ((f + 1) * FRAME / SR > acc && si < schedule.length - 1) acc += schedule[++si].dur;
    seg[f] = si;
  }
  return { n, amp, onset, rough, sub, seg, schedule };
}
/** a reusable frame view for organism.tick() */
export function frameAt(F, f, view = { amp: null, onset: 0, rough: 0, sub: 0 }) {
  view.amp = F.amp.subarray(f * NE, (f + 1) * NE); view.onset = F.onset[f]; view.rough = F.rough[f]; view.sub = F.sub[f]; return view;
}

/** the standard mixed life used by evolve and the tests (seconds): grooves at several tempi, tone, build/drop, polyrhythm,
 *  silence and the two structure-free controls */
export const LIFE = [
  { mode: 'silence', dur: 10 }, { mode: 'groove', dur: 30, bpm: 120 }, { mode: 'noise', dur: 15 }, { mode: 'groove', dur: 20, bpm: 96 },
  { mode: 'tone', dur: 10 }, { mode: 'scatter', dur: 20 }, { mode: 'build', dur: 25, bpm: 128 }, { mode: 'silence', dur: 30 },
  { mode: 'poly', dur: 15, bpm: 110 }, { mode: 'groove', dur: 20, bpm: 140 },
];

/** live an organism through precomputed frames [from, to); returns what evolution and the tests score */
export function live(org, F, { from = 0, to = F.n, each = null } = {}) {
  const view = { amp: null, onset: 0, rough: 0, sub: 0 };
  let vSum = 0, n = 0, died = -1, interSum = 0, rateSum = 0, run = 0, win = 0, winN = 0, maxWin = 0;
  const seg = new Map();      // segment index -> per-segment record
  for (let f = from; f < to; f++) {
    const sg = F.seg[f]; let r = seg.get(sg);
    if (!r) { const s0 = org.state(); r = { mode: F.schedule[sg].mode, bpm: F.schedule[sg].bpm || 0, E0: s0.energy, I0: s0.integrity, need0: s0.need, inter: 0, rate: 0, pred: 0, n: 0 }; seg.set(sg, r); }
    org.tick(frameAt(F, f, view));
    const s = org.state();
    if (!s.alive && died < 0) died = s.t;
    vSum += s.alive ? s.viability : 0; n++;
    interSum += s.interHz; rateSum += s.rateHz; if (s.interHz > 40) run++;
    win += s.interHz; if (++winN === 250) { maxWin = Math.max(maxWin, win / 250); win = 0; winN = 0; }
    r.inter += s.interHz; r.rate += s.rateHz; r.pred += s.predFrac; r.n++; r.E1 = s.energy; r.I1 = s.integrity; r.need1 = s.need;
    if (each) each(org, f, s);
  }
  const segs = [...seg.values()].map((r) => ({ ...r, inter: r.inter / r.n, rate: r.rate / r.n, pred: r.pred / r.n }));
  return { viability: vSum / n, died, interHz: interSum / n, rateHz: rateSum / n, runaway: run / n, maxInter1s: maxWin, segs };
}

/** fitness: time-integrated viability, with balance as hard constraints (not silent, no runaway) */
export function fitnessOf(L) {
  const ok = L.interHz >= 1 && L.interHz <= 25 && L.runaway < 0.02;
  return { fitness: ok ? L.viability : 0.25 * L.viability, ok };
}
