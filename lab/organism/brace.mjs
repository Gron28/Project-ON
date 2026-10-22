// lab/organism/brace.mjs - the body's laws of impact and bracing. Pure module (no DOM).
//
// Muscle: a motor cell's spike adds a twitch to its activation (summation, decay 80 ms); stiffness follows activation
// through the electromechanical delay (rise tau 40 ms; Cavanagh & Komi 1979). So a contraction triggered by the impact
// itself is too late to stiffen the body at the moment of impact: only a contraction begun ~40-120 ms ahead protects.
// Impact: an exteroceptive event (a rising edge of the ear's onset signal) strikes the body. The body's brace B is the
// mean stiffness of its motor cells at that moment; protection p = 1 - exp(-B / B_HALF). The unprotected share of the
// impact damages integrity and costs energy (repair of the deformation), and only the unprotected share reaches the
// physical body (being/physics.mjs) as a hit. Holding tension costs energy all the time (milieu.mjs costMotor).
// So: a brace in time is cheap; a late brace pays the contraction and the impact; an early brace pays the contraction
// for longer and has decayed by the impact.

import { DT } from './network.mjs';

export const BRACE = { twitch: 0.25, tauAct: 0.08, tauRise: 0.04, bHalf: 0.12, damage: 0.0015, energy: 0.0005, onThr: 2, onRise: 1.5, refr: 0.05 };
const DEC_A = Math.exp(-DT / BRACE.tauAct), K_RISE = 1 - Math.exp(-DT / BRACE.tauRise);

/** one muscle: step(spiked) -> { act, stiff } */
export function createMuscle() {
  const m = { act: 0, stiff: 0 };
  m.step = (spiked) => { let a = m.act * DEC_A + (spiked ? BRACE.twitch : 0); if (a > 1) a = 1; m.act = a; m.stiff += K_RISE * (a - m.stiff); return m; };
  return m;
}
/** protection given the mean stiffness of the motor cells */
export const protection = (B) => 1 - Math.exp(-B / BRACE.bHalf);
/** the impact law: damage to integrity and energy for an impact of amplitude a (0..1) met with protection p */
export function impactCost(a, p) { const u = a * (1 - p); return { dI: BRACE.damage * u, dE: BRACE.energy * u }; }

/** impact events from the ear's onset signal: a rising edge above threshold, with a short refractory period */
export function createImpactDetector() {
  let prev = 0, since = 1;
  return (onset) => {
    since += DT; let a = 0;
    if (onset > BRACE.onThr && onset > BRACE.onRise * prev + 0.5 && since >= BRACE.refr) { a = Math.tanh(onset / 8); since = 0; }
    prev = onset; return a;
  };
}
