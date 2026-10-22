// lab/organism/brace.mjs - the body's laws of impact and bracing. Pure module (no DOM).
//
// Muscle: a motor cell's spike adds a twitch to its activation (summation, decay 80 ms). Stiffness follows activation
// after a pure electromechanical delay (32 ms: excitation-contraction coupling and taking up the series elastic slack)
// and then rises with tau 40 ms (Cavanagh & Komi 1979). So a contraction triggered by the impact itself comes too late.
// Co-contraction and fatigue: holding tension is paid all the time, superlinearly (milieu.mjs costStiff x the mean of
// each muscle's commanded stiffness squared: co-contracting antagonists to stay stiff burns ATP for as long as it lasts,
// and the price climbs steeply with the level; Hogan 1984, Gribble et al. 2003), and sustained tension fatigues the
// muscle: each muscle's fatigue phi rises with its stiffness squared (tau 2 s at full stiffness) and recovers with tau
// 8 s, and the stiffness it can actually present is its commanded stiffness x (1 - phi). A muscle held stiff all the
// time settles near phi 0.7 and protects less while paying more; brief contractions (a short brace before each hit,
// ~20% duty) stay near phi 0.15.
// Impact: an exteroceptive event strikes the body, and its force is brief: it rises and decays within tens of ms (an alpha
// profile f(tau) = (tau / 15 ms) e^(1 - tau / 15 ms), peak at 15 ms, 97% of it within the 80 ms window). Only strong
// hits strike (createImpactDetector): a rising edge of the ear's onset signal above an absolute threshold that also
// carries weight in the low band (the rise of the ear's units below 300 Hz: a kick or a snare has a body; a hi-hat is
// all high band and carries no momentum), that stands out against the song's own strong hits (above a share of the
// running level of its recent impact peaks) and that comes after a refractory 150 ms (the body still rings from the last
// strike). So at typical tempi strikes come >= ~250 ms apart; hats remain heard (organism.mjs hair cells) but never strike.
// The brace B is the stiffness met by that force, integrated against it over the window,
// B = sum stiff(t0 + tau) f(tau) / sum f(tau); protection p = 1 - exp(-B / B_HALF). A brace stiff only after the force
// has passed (any reaction to the impact: neural latency + 32 ms + the rise) protects ~nothing; only a contraction begun
// ~50-130 ms ahead does. Stiffness is read on the side the impact comes from (the motor cells weighted by a cardioid on
// their lateral position, organism.mjs): a sound panned left strikes the left side. The unprotected share of the impact
// damages integrity and costs energy (repair of the deformation). So: a brace in time is cheap; a late brace pays the
// contraction and the impact; an early or constant brace pays the contraction for longer, fatigues, and has decayed by
// the impact.

import { DT } from './network.mjs';

export const BRACE = { twitch: 0.25, tauAct: 0.08, tauRise: 0.04, emd: 0.032, bHalf: 0.12, damage: 0.0015, energy: 0.0005, onThr: 2, onRise: 1.5, refr: 0.15, tauForce: 0.015, window: 0.08,
  tauFat: 2, tauRec: 8, lowHz: 300, lowRise: 0.6, strong: 0.25, tauStrong: 4 };
const DEC_A = Math.exp(-DT / BRACE.tauAct), K_RISE = 1 - Math.exp(-DT / BRACE.tauRise);
/** steps of the electromechanical delay, and of the impact window */
export const EMD = Math.round(BRACE.emd / DT), WIN = Math.round(BRACE.window / DT);
/** the impact's force profile on the window's steps (step k is the k-th tick from the detection, at tau = (k + 0.5) DT) */
export const FORCE = Float64Array.from({ length: WIN }, (_, k) => { const u = (k + 0.5) * DT / BRACE.tauForce; return u * Math.exp(1 - u); });
const FSUM = FORCE.reduce((s, x) => s + x, 0);

/** fatigue after one step at commanded stiffness s (the law shared by createMuscle and organism.mjs) */
export const fatigueStep = (phi, s) => phi + DT * (s * s * (1 - phi) / BRACE.tauFat - phi / BRACE.tauRec);

/** one muscle: step(spiked) -> { act, raw (commanded stiffness), fat (fatigue), stiff (presented: raw x (1 - fat)) } */
export function createMuscle() {
  const ring = new Float32Array(EMD + 1); let k = 0;
  const m = { act: 0, raw: 0, fat: 0, stiff: 0 };
  m.step = (spiked) => {
    let a = m.act * DEC_A + (spiked ? BRACE.twitch : 0); if (a > 1) a = 1; m.act = a;
    ring[k] = a; k = (k + 1) % ring.length; const late = ring[k];      // the activation EMD steps ago
    m.raw += K_RISE * (late - m.raw); m.fat = fatigueStep(m.fat, m.raw); m.stiff = m.raw * (1 - m.fat); return m;
  };
  return m;
}
/** protection given the stiffness met by the impact */
export const protection = (B) => 1 - Math.exp(-B / BRACE.bHalf);
/** the impact law: damage to integrity and energy for an impact of amplitude a (0..1) met with protection p */
export function impactCost(a, p) { const u = a * (1 - p); return { dI: BRACE.damage * u, dE: BRACE.energy * u }; }
/** the brace an impact met: stiffness over its window (stiff[k], k = 0 .. WIN - 1 from the detection) against its force */
export function impactBrace(stiff) { let s = 0; for (let k = 0; k < WIN; k++) s += FORCE[k] * stiff[k]; return s / FSUM; }

/** an impact in progress: feed it the stiffness on its side at each tick; done after WIN ticks, then p is its protection */
export function createImpact(a, A, side, t) {
  const o = { a, A, side, t, k: 0, acc: 0, done: false, p: 0, B: 0 };
  o.feed = (stiff) => { o.acc += FORCE[o.k++] * stiff; if (o.k >= WIN) { o.done = true; o.B = o.acc / FSUM; o.p = protection(o.B); } return o.done; };
  return o;
}

/** strong hits from the ear's onset signal (see the header): detect(onset, low) -> amplitude (0 when nothing strikes).
 *  low: the rise of the ear's low band over the last 16 ms (createLowBand() below; omitted: the onset alone decides, as before
 *  the low-band law). A candidate is a rising edge above threshold; it strikes when it carries low-band weight, stands
 *  above `strong` x the running level of recent strike peaks, and the refractory period has passed. */
export function createImpactDetector() {
  let prev = 0, since = 1, level = 0;
  const kL = 1 - Math.exp(-1 / BRACE.tauStrong);           // per strike: the level follows the last ~4 strikes
  return (onset, low = Infinity) => {
    since += DT; let a = 0;
    if (onset > BRACE.onThr && onset > BRACE.onRise * prev + 0.5 && since >= BRACE.refr && low >= BRACE.lowRise && onset >= BRACE.strong * level) {
      a = Math.tanh(onset / 8); since = 0; level += kL * (onset - level);
    }
    prev = onset; return a;
  };
}
/** the low band's rise: log ratio of the summed amplitude of the ear's units below lowHz now against 16 ms ago */
export function createLowBand(cf) {
  const idx = []; for (let k = 0; k < cf.length; k++) if (cf[k] < BRACE.lowHz) idx.push(k);
  const hist = new Float32Array(4); let h = 0;
  return (amp) => {
    let s = 0; for (const k of idx) s += amp[k];
    const old = hist[h]; hist[h] = s; h = (h + 1) & 3;
    return old > 0 ? Math.log((s + 0.05) / (old + 0.05)) : 0;
  };
}
