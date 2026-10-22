// lab/organism/environment.mjs - the sound world an organism lives in during evolution and tests. Pure module.
//
// A schedule of segments [{ mode, dur, ... }]. Modes from lab/prototypes/nervous-system/stimuli.mjs (groove, tone, build,
// poly, click, rough, silence), two controls ('noise': white noise; 'scatter': the groove's drum sounds at random Poisson
// times), and 'rhythm' (rhythm.mjs: { pattern, bpm, bpmEnd, swing, omit, shuffle }), which logs every beat of its grid.
// earFrames() runs being/ear.mjs once over a schedule and keeps every 4 ms frame, so a whole population can live through
// the same sound without each organism re-running the ear (the ear does not depend on the organism: exact, not approx).
// It also returns the beat grid (times, omitted flags, local period) of every rhythmic segment, for alignment measures.

import { createStimuli, oneShots } from '../prototypes/nervous-system/stimuli.mjs';
import { createSequencer } from './rhythm.mjs';
import { createEar, SR, NE } from '../../being/ear.mjs';
import { lcg, mix } from './genome.mjs';
import { withClock } from './clock.mjs';

const FRAME = 192;
const GRID_MODES = new Set(['groove', 'build', 'poly', 'click']);

/** an interactive source: the stimuli's modes plus 'noise', 'scatter' and 'rhythm' (st: the stimuli, for tempo, level, bursts) */
export function createSource(seed = 1) {
  const st = createStimuli(), shots = oneShots(), r = lcg(seed), voices = [], one = new Float32Array(1);
  let mode = 'silence', seq = null, n = 0, seqAt = 0, opts = {};
  function sample() {
    let x = mode === 'rhythm' ? seq.sample() * (st.o.level / 0.8) : st.fill(one)[0];
    if (mode === 'noise') x += 0.25 * (2 * r() - 1) * (st.o.level / 0.8);   // level 0.8 (the default) gives exactly the evolved noise
    if (mode === 'scatter' && r() < 6 / SR) {        // ~6 hits a second, kick : snare : hat as in the groove
      const u = r(); voices.push({ b: u < 0.2 ? shots.kick : u < 0.37 ? shots.snare : shots.hat, i: 0, a: u < 0.2 ? 0.9 : u < 0.37 ? 0.9 : 0.75 });
    }
    for (let v = voices.length - 1; v >= 0; v--) { const vo = voices[v]; x += vo.b[vo.i++] * vo.a * st.o.level; if (vo.i >= vo.b.length) voices.splice(v, 1); }
    n++;
    return x;
  }
  return {
    st, sample,
    get mode() { return mode; }, get seq() { return seq; }, get opts() { return opts; }, get t() { return n / SR; },
    /** the tempo being played (0 when the mode has none; the nominal grid's tempo for shuffled intervals) */
    get bpm() { return mode === 'scatter' || mode === 'noise' ? 0 : mode === 'rhythm' ? seq.bpm : st.bpm; },
    /** beats of the current rhythm heard so far, in this source's time (s) */
    beats() { return seq ? seq.heard().beats.map((b) => ({ t: b.t + seqAt, omitted: b.omitted })) : []; },
    setMode(m, o = {}) {
      mode = m; opts = { ...o };
      if (o.bpm) st.o.bpm = o.bpm; if (o.sync !== undefined) st.o.sync = o.sync;
      if (m === 'rhythm') { seq = createSequencer({ bpm: st.o.bpm, ...o, seed: o.seed ?? mix(seed, n) }); seqAt = n / SR; } else seq = null;
      st.setMode(m === 'noise' || m === 'scatter' || m === 'rhythm' ? 'silence' : m);
    },
    fill(buf) { for (let i = 0; i < buf.length; i++) buf[i] = sample(); return buf; },
  };
}

export function createEnvironment(schedule, seed = 1) {
  const src = createSource(seed), total = schedule.reduce((s, x) => s + x.dur, 0);
  let n = 0, seg = -1, segEnd = 0;
  const grid = [];                    // { t, omitted, seg } absolute beat times of every rhythmic segment
  function closeSeg() {
    if (seg < 0) return; const s = schedule[seg], t0 = segEnd / SR - s.dur;
    if (s.mode === 'rhythm') for (const b of src.seq.beats) { if (b.t < s.dur) grid.push({ t: t0 + b.t, omitted: b.omitted, seg }); }
    else if (GRID_MODES.has(s.mode) && s.bpm) for (let t = 0; t < s.dur; t += 60 / s.bpm) grid.push({ t: t0 + t, omitted: false, seg });
  }
  function enter(i) { closeSeg(); seg = i; const s = schedule[i]; segEnd += Math.round(s.dur * SR); src.setMode(s.mode, { ...s, dur: s.dur, seed: mix(seed, i + 1) }); }
  enter(0);
  return {
    total, schedule, grid, close: closeSeg,
    get t() { return n / SR; }, get segment() { return schedule[Math.min(seg, schedule.length - 1)]; },
    fill(buf) { for (let i = 0; i < buf.length; i++) { while (n >= segEnd && seg < schedule.length - 1) enter(seg + 1); buf[i] = src.sample(); n++; } return buf; },
  };
}

/** the ear's 4 ms frames over a whole schedule: { n, amp (n x NE), onset, rough, sub, seg (segment index per frame),
 *  beats: { t, omitted, seg, period } } */
export function earFrames(schedule, seed = 1) {
  const env = createEnvironment(schedule, seed), ear = createEar();
  const n = Math.floor(env.total * SR / FRAME);
  const amp = new Float32Array(n * NE), onset = new Float32Array(n), rough = new Float32Array(n), sub = new Float32Array(n), level = new Float32Array(n), seg = new Uint8Array(n);
  const buf = new Float32Array(FRAME);
  let si = 0, acc = schedule[0].dur;
  for (let f = 0; f < n; f++) {
    env.fill(buf); for (let i = 0; i < FRAME; i++) ear.sample(buf[i]);
    const fr = ear.frame(); amp.set(fr.amp, f * NE); onset[f] = fr.onset; rough[f] = fr.rough; sub[f] = fr.sub; level[f] = fr.level;
    while ((f + 1) * FRAME / SR > acc && si < schedule.length - 1) acc += schedule[++si].dur;
    seg[f] = si;
  }
  env.close();
  const beats = env.grid.map((b, i, a) => { const nx = a[i + 1], pv = a[i - 1]; const period = nx && nx.seg === b.seg ? nx.t - b.t : pv && pv.seg === b.seg ? b.t - pv.t : 0.5; return { ...b, period }; });
  return { n, amp, onset, rough, sub, level, seg, schedule, beats };
}
/** a reusable frame view for organism.tick(); stereo frames (worlds.mjs framesOf) also carry each channel's amplitudes
 *  and onset (ampL, ampR, onsetL, onsetR) and the direction of the sounds that just began (pan); mono frames leave them
 *  null (pan 0: from all around) */
export function frameAt(F, f, view = { amp: null, onset: 0, rough: 0, sub: 0 }) {
  view.amp = F.amp.subarray(f * NE, (f + 1) * NE); view.onset = F.onset[f]; view.rough = F.rough[f]; view.sub = F.sub[f];
  if (F.ampL) { view.ampL = F.ampL.subarray(f * NE, (f + 1) * NE); view.ampR = F.ampR.subarray(f * NE, (f + 1) * NE); view.onsetL = F.onsetL[f]; view.onsetR = F.onsetR[f]; view.pan = F.pan ? F.pan[f] : 0; }
  else { view.ampL = view.ampR = null; view.pan = 0; }
  view.clockPhase = F.clockPhase ? F.clockPhase[f] : undefined; view.clockLock = F.clockLock ? F.clockLock[f] : 0;
  return view;
}

/** the standard mixed life used by measure and the tests (seconds, ~3.5 min): drum patterns at several tempi, with swing,
 *  a tempo ramp and omitted beats, tone, silence, and the structure-free controls (noise, scattered drums, shuffled
 *  intervals). Held-out tempi (HELD_OUT) never appear in it or in evolution's worlds. */
export const LIFE = [
  { mode: 'silence', dur: 10 }, { mode: 'rhythm', pattern: 'rock', bpm: 120, dur: 30 }, { mode: 'noise', dur: 15 },
  { mode: 'rhythm', pattern: 'four', bpm: 90, dur: 20 }, { mode: 'tone', dur: 10 }, { mode: 'rhythm', pattern: 'rock', bpm: 110, shuffle: true, dur: 20 },
  { mode: 'rhythm', pattern: 'break', bpm: 136, swing: 0.25, dur: 20 }, { mode: 'silence', dur: 25 },
  { mode: 'rhythm', pattern: 'half', bpm: 82, bpmEnd: 96, dur: 20 }, { mode: 'rhythm', pattern: 'rock', bpm: 160, omit: 0.1, dur: 20 }, { mode: 'scatter', dur: 15 },
];
/** tempi kept out of every life and every evolved world, for measuring generalisation */
export const HELD_OUT = [100, 150];
const TRAIN_BANDS = [[80, 95], [106, 144], [156, 160]];

/** a varied life for evolution generation `gen`: 6-8 rhythmic segments (random pattern, tempo from the training bands,
 *  swing, sometimes a tempo ramp or omitted beats), shuffled-interval and scattered controls, noise, tone and silence */
export function worldFor(gen, { rhythmic = 6, segDur = 20 } = {}) {
  const r = lcg(mix(gen, 977)), pats = ['rock', 'four', 'half', 'break', 'pulse'];
  const tempo = () => { const w = TRAIN_BANDS.map(([a, b]) => b - a), tot = w.reduce((s, x) => s + x, 0); let u = r() * tot, k = 0; while (u > w[k]) u -= w[k++]; return Math.round(TRAIN_BANDS[k][0] + u); };
  const segs = [];
  for (let i = 0; i < rhythmic; i++) {
    const bpm = tempo(), s = { mode: 'rhythm', pattern: pats[r.int(pats.length)], bpm, dur: segDur, swing: r() < 0.4 ? 0.1 + 0.2 * r() : 0 };
    if (r() < 0.25) { let e = bpm * (r() < 0.5 ? 1.12 : 0.88); e = Math.max(80, Math.min(160, Math.round(e))); if (!HELD_OUT.some((h) => Math.abs(h - e) < 4)) s.bpmEnd = e; }
    if (r() < 0.3) s.omit = 0.08;
    segs.push(s);
  }
  segs.push({ mode: 'rhythm', pattern: pats[r.int(4)], bpm: tempo(), shuffle: true, dur: segDur }, { mode: 'scatter', dur: 15 }, { mode: 'noise', dur: 12 }, { mode: 'tone', dur: 8 }, { mode: 'silence', dur: 20 });
  for (let i = segs.length - 1; i > 0; i--) { const j = r.int(i + 1); [segs[i], segs[j]] = [segs[j], segs[i]]; }
  return [{ mode: 'silence', dur: 6 }, ...segs];
}

/** live an organism through precomputed frames [from, to); returns what evolution and the tests score. Per segment:
 *  mode, spec, inter / rate (Hz), pred (mean running anticipation at impacts), events, anticIncome, impactLoss, E0/E1, I0/I1, need0/need1 */
export function live(org, F, { from = 0, to = F.n, each = null } = {}) {
  const view = { amp: null, onset: 0, rough: 0, sub: 0 };
  if (org.C && org.C.clock && org.C.clock.length) withClock(F);   // an organism with clock receptors hears ON's beat phase too
  let vSum = 0, n = 0, died = -1, interSum = 0, rateSum = 0, run = 0, win = 0, winN = 0, maxWin = 0;
  const seg = new Map();      // segment index -> per-segment record
  for (let f = from; f < to; f++) {
    const sg = F.seg[f]; let r = seg.get(sg);
    if (!r) { const s0 = org.state(); r = { mode: F.schedule[sg].mode, bpm: F.schedule[sg].bpm || 0, spec: F.schedule[sg], E0: s0.energy, I0: s0.integrity, need0: s0.need, ev0: s0.events, inc0: s0.anticIncome, loss0: s0.impactLoss, inter: 0, rate: 0, pred: 0, n: 0 }; seg.set(sg, r); }
    org.tick(frameAt(F, f, view));
    const s = org.state();
    if (!s.alive && died < 0) died = s.t;
    vSum += s.alive ? s.viability : 0; n++;
    interSum += s.interHz; rateSum += s.rateHz; if (s.interHz > 40) run++;
    win += s.interHz; if (++winN === 250) { maxWin = Math.max(maxWin, win / 250); win = 0; winN = 0; }
    r.inter += s.interHz; r.rate += s.rateHz; r.pred += s.predFrac; r.n++; r.E1 = s.energy; r.I1 = s.integrity; r.need1 = s.need; r.ev1 = s.events; r.inc1 = s.anticIncome; r.loss1 = s.impactLoss;
    if (each) each(org, f, s);
  }
  const segs = [...seg.values()].map((r) => ({ ...r, inter: r.inter / r.n, rate: r.rate / r.n, pred: r.pred / r.n, events: r.ev1 - r.ev0, anticIncome: r.inc1 - r.inc0, impactLoss: r.loss1 - r.loss0 }));
  return { viability: vSum / n, died, interHz: interSum / n, rateHz: rateSum / n, runaway: run / n, maxInter1s: maxWin, segs };
}

/** fitness: time-integrated viability, with balance as hard constraints (not silent, no runaway) */
export function fitnessOf(L) {
  const ok = L.interHz >= 1 && L.interHz <= 25 && L.runaway < 0.02;
  return { fitness: ok ? L.viability : 0.25 * L.viability, ok };
}
