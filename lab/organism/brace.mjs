// lab/organism/brace.mjs - the body's laws of impact and bracing. Pure module (no DOM).
//
// Muscle: a motor cell's spike adds a twitch to its activation (summation, decay 80 ms). Stiffness follows activation
// after a pure electromechanical delay (32 ms: excitation-contraction coupling and taking up the series elastic slack)
// and then rises with tau 40 ms (Cavanagh & Komi 1979). So a contraction triggered by the impact itself comes too late.
// Impact: an exteroceptive event (a rising edge of the ear's onset signal) strikes the body, and its force is brief: it
// rises and decays within tens of ms (an alpha profile f(tau) = (tau / 15 ms) e^(1 - tau / 15 ms), peak at 15 ms, 97% of
// it within the 80 ms window). The brace B is the stiffness met by that force, integrated against it over the window,
// B = sum stiff(t0 + tau) f(tau) / sum f(tau); protection p = 1 - exp(-B / B_HALF). A brace stiff only after the force
// has passed (any reaction to the impact: neural latency + 32 ms + the rise) protects ~nothing; only a contraction begun
// ~50-130 ms ahead does. Stiffness is read on the side the impact comes from (the motor cells weighted by a cardioid on
// their lateral position, organism.mjs): a sound panned left strikes the left side. The unprotected share of the impact
// damages integrity and costs energy (repair of the deformation). Holding tension costs energy all the time (milieu.mjs
// costMotor). So: a brace in time is cheap; a late brace pays the contraction and the impact; an early brace pays the
// contraction for longer and has decayed by the impact.

import { DT } from './network.mjs';

export const BRACE = { twitch: 0.25, tauAct: 0.08, tauRise: 0.04, emd: 0.032, bHalf: 0.12, damage: 0.0015, energy: 0.0005, onThr: 2, onRise: 1.5, refr: 0.05, tauForce: 0.015, window: 0.08 };
const DEC_A = Math.exp(-DT / BRACE.tauAct), K_RISE = 1 - Math.exp(-DT / BRACE.tauRise);
/** steps of the electromechanical delay, and of the impact window */
export const EMD = Math.round(BRACE.emd / DT), WIN = Math.round(BRACE.window / DT);
/** the impact's force profile on the window's steps (step k is the k-th tick from the detection, at tau = (k + 0.5) DT) */
export const FORCE = Float64Array.from({ length: WIN }, (_, k) => { const u = (k + 0.5) * DT / BRACE.tauForce; return u * Math.exp(1 - u); });
const FSUM = FORCE.reduce((s, x) => s + x, 0);

/** one muscle: step(spiked) -> { act, stiff } (stiffness follows the activation of EMD steps ago) */
export function createMuscle() {
  const ring = new Float32Array(EMD + 1); let k = 0;
  const m = { act: 0, stiff: 0 };
  m.step = (spiked) => {
    let a = m.act * DEC_A + (spiked ? BRACE.twitch : 0); if (a > 1) a = 1; m.act = a;
    ring[k] = a; k = (k + 1) % ring.length; const late = ring[k];      // the activation EMD steps ago
    m.stiff += K_RISE * (late - m.stiff); return m;
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

/** impact events from the ear's onset signal: a rising edge above threshold, with a short refractory period */
export function createImpactDetector() {
  let prev = 0, since = 1;
  return (onset) => {
    since += DT; let a = 0;
    if (onset > BRACE.onThr && onset > BRACE.onRise * prev + 0.5 && since >= BRACE.refr) { a = Math.tanh(onset / 8); since = 0; }
    prev = onset; return a;
  };
}
