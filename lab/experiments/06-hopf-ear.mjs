// Experiment 06 - does the being's ear behave like a critical hair-cell oscillator?
//
// Predictions from the literature (Eguiluz et al. 2000; Camalet et al. 2000; Hudspeth 2014):
//   (a) at its characteristic frequency (CF), with mu = 0, response grows ~ F^(1/3): a slope of ~0.33 dB per dB;
//       off CF it is nearly linear (~1 dB/dB)
//   (b) two tones f1, f2 make the ear hear 2f1 - f2, a tone that is not in the sound (distortion product, "phantom note")
//   (c) self-tuned: in silence each unit settles at its hum amplitude (spontaneous emission); loud sound pushes it subcritical
//       (fatigue) and it recovers over seconds
//
//   node lab/experiments/06-hopf-ear.mjs   ->  lab/results/06-hopf-ear.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEar, EAR_CF, SR, DELTA } from '../../being/ear.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const K = 12;                           // unit at 55 * 2^3 = 440 Hz
const cf = EAR_CF[K];
const run = (ear, sec, gen) => { for (let n = 0; n < sec * SR; n++) ear.sample(gen(n / SR)); };
const steady = (ear, k, sec, gen) => { run(ear, sec * 0.6, gen); let s = 0, m = 0; for (let n = 0; n < sec * 0.4 * SR; n++) { ear.sample(gen(n / SR)); if (n % 48 === 0) { s += ear.env[k]; m++; } } return s / m; };
const out = { cf };

// (a) level sweep at CF and an octave above CF, mu frozen at 0
const levels = [1e-4, 3e-4, 1e-3, 3e-3, 1e-2, 3e-2, 1e-1];
const sweep = (f) => levels.map((L) => steady(createEar({ freezeMu: 0 }), K, 0.6, (t) => L * Math.sin(2 * Math.PI * f * t)));
const atCF = sweep(cf), offCF = sweep(cf * 2);
const slope = (r) => { const s = []; for (let i = 1; i < r.length; i++) s.push(Math.log10(r[i] / r[i - 1]) / Math.log10(levels[i] / levels[i - 1])); return s.map((x) => +x.toFixed(2)); };
out.a = { levels, atCF: atCF.map((x) => +x.toExponential(3)), offCF: offCF.map((x) => +x.toExponential(3)), slopeAtCF: slope(atCF), slopeOffCF: slope(offCF) };
console.log('(a) response slope (dB/dB) at CF  :', out.a.slopeAtCF.join(' '));
console.log('    response slope (dB/dB) off CF :', out.a.slopeOffCF.join(' '));

// (b) distortion product: f1 = 1.25 CF, f2 = 1.5 CF -> 2 f1 - f2 = CF. Measured by lock-in: the unit's complex state
// projected onto exp(-i 2 pi f t) at the distortion frequency, so only energy AT 2f1-f2 counts.
const lockIn = (ear, k, sec, gen, f) => { run(ear, sec * 0.5, gen); let re = 0, im = 0, n0 = sec * 0.5 * SR, m = 0;
  for (let n = 0; n < sec * 0.5 * SR; n++) { const t = (n0 + n) / SR; ear.sample(gen(t)); const c = Math.cos(2 * Math.PI * f * t), s = Math.sin(2 * Math.PI * f * t); re += ear.zr[k] * c + ear.zi[k] * s; im += ear.zi[k] * c - ear.zr[k] * s; m++; }
  return Math.hypot(re, im) / m; };
const A = 0.03, f1 = cf * 1.25, f2 = cf * 1.5;
const two = (t) => A * (Math.sin(2 * Math.PI * f1 * t + 0.3) + Math.sin(2 * Math.PI * f2 * t + 1.1));
const dpCritical = lockIn(createEar({ freezeMu: 0 }), K, 1, two, 2 * f1 - f2);
const dpLinear = lockIn(createEar({ freezeMu: -0.08, kappa: 0 }), K, 1, two, 2 * f1 - f2);
const f1Critical = lockIn(createEar({ freezeMu: 0 }), K, 1, two, f1);
out.b_lockin = { dpCritical, dpLinear, f1Critical, dpRelativeToF1dB: 20 * Math.log10(dpCritical / f1Critical), dpCriticalOverLinear: dpCritical / Math.max(1e-12, dpLinear) };
console.log(`(b) lock-in at 2f1-f2 = ${(2 * f1 - f2).toFixed(0)} Hz: critical ear ${dpCritical.toExponential(2)} vs linear ear ${dpLinear.toExponential(2)} (x${(dpCritical / Math.max(1e-12, dpLinear)).toFixed(0)}); phantom tone is ${(20 * Math.log10(dpCritical / f1Critical)).toFixed(1)} dB re f1`);
const both = steady(createEar({ freezeMu: 0 }), K, 0.6, (t) => A * (Math.sin(2 * Math.PI * f1 * t) + Math.sin(2 * Math.PI * f2 * t)));
const only1 = steady(createEar({ freezeMu: 0 }), K, 0.6, (t) => A * Math.sin(2 * Math.PI * f1 * t));
const only2 = steady(createEar({ freezeMu: 0 }), K, 0.6, (t) => A * Math.sin(2 * Math.PI * f2 * t));
// the same two tones into a linear (strongly damped, no cubic) ear, as a control
const linBoth = steady(createEar({ freezeMu: -0.08, kappa: 0 }), K, 0.6, (t) => A * (Math.sin(2 * Math.PI * f1 * t) + Math.sin(2 * Math.PI * f2 * t)));
const linSum = steady(createEar({ freezeMu: -0.08, kappa: 0 }), K, 0.6, (t) => A * Math.sin(2 * Math.PI * f1 * t)) + steady(createEar({ freezeMu: -0.08, kappa: 0 }), K, 0.6, (t) => A * Math.sin(2 * Math.PI * f2 * t));
out.b = { f1, f2, dp: 2 * f1 - f2, unitWithBoth: both, unitWithF1: only1, unitWithF2: only2, ratioBothToSum: both / (only1 + only2), linearRatioBothToSum: linBoth / linSum };
console.log(`(b) unit at ${cf.toFixed(0)} Hz hearing ${f1.toFixed(0)} + ${f2.toFixed(0)} Hz: ${(both / (only1 + only2)).toFixed(2)}x the sum of each alone (linear control ${(linBoth / linSum).toFixed(2)}x)`);

// (c) self-tuning: silence -> hum; loud tone -> fatigue; recovery time
const ear = createEar();
const muAt = () => ear.mu[K];
run(ear, 8, () => 0);
const humAmp = ear.env[K], muSilence = muAt();
run(ear, 6, (t) => 0.2 * Math.sin(2 * Math.PI * cf * t));
const muLoud = muAt();
let tRec = null;
for (let s = 0; s < 40; s += 0.25) { run(ear, 0.25, () => 0); if (tRec === null && muAt() > 0) tRec = s + 0.25; }
out.c = { humAmplitude: humAmp, delta: DELTA, muInSilence: muSilence, muAfterLoud: muLoud, secondsToHumAgain: tRec };
console.log(`(c) hum amplitude ${humAmp.toFixed(4)} (set point ${DELTA}), mu in silence ${muSilence.toFixed(3)}, after 6 s loud ${muLoud.toFixed(3)}, hums again after ${tRec} s of silence`);

fs.writeFileSync(path.join(ROOT, 'lab', 'results', '06-hopf-ear.json'), JSON.stringify(out, null, 2));
