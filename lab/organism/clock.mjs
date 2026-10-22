// lab/organism/clock.mjs - ON's own beat-prediction organ, given to the organism as a sense of time. Pure module.
//
// In animals beat timing has dedicated circuits (cerebellum, basal ganglia); ON already has one: the mind's felt pulse
// (being/mind.mjs: a critical Hopf bank, a motor oscillator and a Kuramoto population locked to the ear's onsets, pulled
// toward the analyzer's beat tracker by the rhythm dial) plus the timing grid that centres the heard drums on it
// (being/timing.mjs bias). The page shows the beat at
//   phase = frac((4 (pulseCount + pulsePhase) + bias) / 4)    (SHOW.phase in being/index.html, without its display lead)
// and that phase, with the mind's lock, is what the organism's clock receptors read (develop.mjs T.CLOCK, organism.mjs).
// What the organism does with it stays its own: laws, learning and evolution; nothing here times a motor.
//
// In the lab the clock is computed from the same sound the organism hears, with ON's real modules wired as the page wires
// them: being/analysis.mjs analyses the world's mono mix (drum events with their audio time, the beat tracker),
// createMind() is stepped once per 4 ms ear frame with that frame, its onset and the senses the page gives it for timing
// (the rhythm dial at the page's default 0.6 and the analyzer's beat; the page steps it once per rendered frame with the
// largest onset since the last: same dynamics, finer steps), and createTiming() observes the analyzer's kick, snare and hat
// events at their grid position (the page's gridAt()) and advances on the grid. Frames without a world to render
// (environment.mjs earFrames, gestation) get the mind alone (dial 0, no tracker, no drum events).
// The being's timing bias carries across songs in ON (timing.restoreSelf); here every world starts from selfBias(), the bias
// one timing learns living through the train worlds (worlds.mjs TRAIN) in turn, so no held-out world teaches it anything.
//
//   const c = createClock({ bias });  c.frame(earFrame, { beat, events }) -> { phase, lock, hz }
//   withClock(F) adds F.clockPhase / F.clockLock (Float32Array per frame) to a frames object (computed once)

import { createMind, traitsFor } from '../../being/mind.mjs';
import { createTiming } from '../../being/timing.mjs';
import { createAnalyzer } from '../../being/analysis.mjs';
import { EAR_CF, SR } from '../../being/ear.mjs';
import { TRAIN, makeWorld, framesOf, render } from './worlds.mjs';

export const CLOCK = { seed: 1, rhythm: 0.6, dt: 0.004 };
const DRUM = new Set(['kick', 'snare', 'hat']), HIST = 128;

/** a streaming clock, one ear frame (4 ms) at a time. extra: { beat } (the analyzer's state.beat) and { events } (its
 *  drained events: { type, time, strength }, time in s on the same clock as the frames) */
export function createClock({ seed = CLOCK.seed, bias = 0, timing = null, rhythm = CLOCK.rhythm } = {}) {
  const mind = createMind(traitsFor(seed), { earCF: EAR_CF }), tm = timing || createTiming();
  if (!timing) tm.restoreSelf({ v: 1, bias, errMs: 80 });
  const ear = { amp: null, onset: 0, rough: 0, sub: 0, level: 0 }, out = { phase: 0, lock: 0, hz: 0 };
  const hT = new Float64Array(HIST), hC = new Float64Array(HIST); let hn = 0, t = 0;
  // the grid position at a past time (the page's gridAt(): interpolated in the recent history)
  const gridAt = (x) => {
    for (let j = 0; j < Math.min(hn, HIST) - 1; j++) {
      const a = (hn - 2 - j) % HIST, b = (hn - 1 - j) % HIST;
      if (hT[a] <= x) { const u = (x - hT[a]) / Math.max(1e-9, hT[b] - hT[a]); return hC[a] + Math.min(1, u) * (hC[b] - hC[a]); }
    }
    return NaN;
  };
  function frame(f, { beat = null, events = null } = {}) {
    ear.amp = f.amp; ear.onset = f.onset; ear.rough = f.rough; ear.sub = f.sub; ear.level = f.level || 0;
    mind.step(CLOCK.dt, ear, f.onset, beat ? { rhythm, beat } : { rhythm: 0 });
    t += CLOCK.dt;
    const cum = (mind.pulseCountRaw + mind.pulsePhaseRaw) * 4;
    hT[hn % HIST] = t; hC[hn % HIST] = cum; hn++;
    tm.advance(cum);
    if (events) for (const e of events) if (DRUM.has(e.type)) tm.observe(e.type, e.strength || 0.6, gridAt(e.time), 250 / Math.max(0.3, mind.pulseHz));
    const shown = (cum + tm.bias) / 4;
    out.phase = shown - Math.floor(shown); out.lock = mind.lock; out.hz = mind.pulseHz;
    return out;
  }
  return { frame, mind, timing: tm, get t() { return t; } };
}

/** run a clock over a frames object (worlds.mjs framesOf: its world is re-rendered for the analyzer; environment.mjs
 *  earFrames: the mind alone). Returns { phase, lock, bias } (per frame, and the timing bias at the end) */
export function clockOver(F, { bias, timing = null } = {}) {
  const c = createClock({ bias: timing ? 0 : bias ?? selfBias(), timing }), phase = new Float32Array(F.n), lock = new Float32Array(F.n);
  const NE = F.amp.length / F.n, f0 = { amp: null, onset: 0, rough: 0, sub: 0, level: 0 }, FR = Math.round(CLOCK.dt * SR);
  let mono = null, an = null;
  if (F.world) { const x = render(F.world); mono = new Float32Array(x.L.length); for (let i = 0; i < mono.length; i++) mono[i] = 0.5 * (x.L[i] + x.R[i]); an = createAnalyzer({ sampleRate: SR }); }
  const extra = { beat: null, events: null };
  for (let f = 0; f < F.n; f++) {
    f0.amp = F.amp.subarray(f * NE, (f + 1) * NE); f0.onset = F.onset[f]; f0.rough = F.rough[f]; f0.sub = F.sub[f]; f0.level = F.level ? F.level[f] : 0;
    if (an) { an.push(mono.subarray(f * FR, (f + 1) * FR)); an.analyseUpTo(an.total); extra.events = an.drain(); extra.beat = an.state.beat; }
    const o = c.frame(f0, extra); phase[f] = o.phase; lock[f] = o.lock;
  }
  return { phase, lock, bias: c.timing.bias };
}

/** frames with the clock attached (F.clockPhase, F.clockLock), computed once per frames object */
export function withClock(F, opt) {
  if (!F.clockPhase) { const c = clockOver(F, opt); F.clockPhase = c.phase; F.clockLock = c.lock; }
  return F;
}

let SELF = null;
/** the timing bias ON's being would carry into a new song: one timing living through every train world in turn (groove,
 *  24 s, world seed 1001: the bench's life worlds), its bias at the end. Computed once per process */
export function selfBias() {
  if (SELF !== null) return SELF;
  const tm = createTiming();
  for (const spec of TRAIN) clockOver(framesOf(makeWorld(spec, 'groove', { seed: 1001, dur: 24 })), { timing: tm });
  return (SELF = tm.bias);
}
