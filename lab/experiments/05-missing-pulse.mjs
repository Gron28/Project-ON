// Experiment 05 - does a resonating oscillator bank feel a pulse that is not in the sound?
//
// Neural resonance theory (Large, Almonte & Velasco 2010; Velasco & Large 2011; Large, Herrera & Velasco 2015) claims
// that a gradient-frequency bank of nonlinear oscillators responds at the felt beat even for rhythms whose spectrum has
// ZERO energy at the beat frequency, through mode-locking (resonant monomials of the coupling nonlinearity). A linear
// filterbank, or an FFT, cannot. This is the clearest test of "feeling" vs "detecting".
//
// Canonical model (Large et al. 2010), per oscillator with natural frequency f:
//   dz/dt = f * [ z (alpha + i 2pi + beta1 |z|^2 + eps beta2 |z|^4 / (1 - eps |z|^2)) + c P(eps, x) A(eps, conj z) ]
//   P(eps, x) = x / (1 - sqrt(eps) x),   A(eps, zb) = 1 / (1 - sqrt(eps) zb)
// Banks (log-spaced 0.25-16 Hz, 48 per octave = 289 oscillators, as in Velasco & Large 2011):
//   critical (sensory): alpha 0, beta1 -1, beta2 -0.25, eps 1      (Velasco & Large 2011, network 1)
//   linear baseline:    alpha -1, beta1 0, beta2 0, eps 0 (P = x, A = 1): a plain bank of damped resonators
//   limit-cycle/DLC (motor-like): alpha -0.3, beta1 1, beta2 -1, eps 1, driven 1:1 by the critical bank (sign of alpha: see notes)
// Stimuli: 16-slot bar at 120 bpm (slot = 125 ms, beat = 2 Hz = 4 slots), onsets as 25 ms raised-cosine bumps.
//   isochronous: onsets on every beat (slots 0,4,8,12)
//   missing pulse: slots {0,1,5,7,10,11,13,15}: per beat-phase class counts c0=c2=1, c1=c3=3, so the bar's DFT at the
//                  beat frequency is exactly zero (verified numerically below), and 6 of 8 onsets are off the beat
//   syncopated control: slots {0,3,6,8,11,14}  (has energy at 2 Hz)
// Readout: mean |z| over the last 12 s of 20 s, per oscillator; "pulse salience" = |z| at the 2 Hz oscillator / max |z| in 0.25-16 Hz,
// and the frequency of the strongest response.
//
//   node lab/experiments/05-missing-pulse.mjs   ->  lab/results/05-missing-pulse.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FS = 1000, DUR = 20, MEASURE_FROM = 8; // Hz, s, s
const PER_OCT = 48, FMIN = 0.25, OCT = 6;
const NOSC = PER_OCT * OCT + 1;
const freqs = Float64Array.from({ length: NOSC }, (_, i) => FMIN * 2 ** (i / PER_OCT));
const i2 = freqs.findIndex((f) => Math.abs(f - 2) < 1e-9);
// index offsets for frequency ratios 1/3, 1/2, 2, 3 (log-spaced bank: offset = PER_OCT * log2(ratio))
const RATIO_OFFSETS = [1 / 3, 1 / 2, 2, 3].map((r) => Math.round(PER_OCT * Math.log2(r)));

function stimulus(slots, amp) {
  const n = DUR * FS, x = new Float64Array(n), slot = 0.125, width = 0.025;
  for (let bar = 0; bar * 2 < DUR; bar++) for (const s of slots) {
    const t0 = bar * 2 + s * slot;
    for (let k = 0; k < width * FS; k++) { const i = Math.round(t0 * FS) + k; if (i < n) x[i] += amp * 0.5 * (1 - Math.cos((2 * Math.PI * k) / (width * FS))); }
  }
  return x;
}
// relative spectral energy at a frequency (single-bin DFT over the measured window, normalised by the strongest of 0.25..16 Hz)
function spectrum(x, fq) {
  const a = MEASURE_FROM * FS, b = x.length;
  const amp = (f) => { let re = 0, im = 0; for (let i = a; i < b; i++) { const ph = 2 * Math.PI * f * (i / FS); re += x[i] * Math.cos(ph); im += x[i] * Math.sin(ph); } return Math.hypot(re, im); };
  const A = Array.from(fq, amp); const mx = Math.max(...A);
  return A.map((v) => v / mx);
}

// one oscillator bank driven by x (real, per sample) or by another bank's z (complex, 1:1)
function runBank(P, drive, driveIm = null) {
  const { alpha, beta1, beta2, eps, c } = P, se = Math.sqrt(eps);
  const zr = new Float64Array(NOSC).fill(1e-3), zi = new Float64Array(NOSC);
  const acc = new Float64Array(NOSC); let nAcc = 0;
  const outR = driveIm === null ? null : null;
  const dt = 1 / FS;
  const histR = [], histI = []; // keep the trajectory of every 4th sample for a downstream bank
  // derivative for one oscillator given input (xr, xi)
  const deriv = (f, ar, ai, xr, xi, out) => {
    const r2 = ar * ar + ai * ai;
    let nl = alpha + beta1 * r2;
    if (eps > 0 && beta2 !== 0) nl += (eps * beta2 * r2 * r2) / Math.max(1e-6, 1 - eps * r2);
    // z * (nl + i 2pi)
    let dr = ar * nl - ai * 2 * Math.PI, di = ai * nl + ar * 2 * Math.PI;
    // input term c * P(eps, x) * A(eps, conj z)
    let pr = xr, pi = xi;
    if (eps > 0) { const dr0 = 1 - se * xr, di0 = -se * xi, den = dr0 * dr0 + di0 * di0; pr = (xr * dr0 + xi * di0) / den; pi = (xi * dr0 - xr * di0) / den; }
    let ar_ = 1, ai_ = 0;
    if (eps > 0) { const er = 1 - se * ar, ei = se * ai, den = er * er + ei * ei; ar_ = er / den; ai_ = -ei / den; } // 1 / (1 - se * conj z)
    dr += c * (pr * ar_ - pi * ai_); di += c * (pr * ai_ + pi * ar_);
    out[0] = f * dr; out[1] = f * di;
  };
  const k1 = [0, 0], k2 = [0, 0], k3 = [0, 0], k4 = [0, 0];
  const n = drive.length;
  for (let t = 0; t < n; t++) {
    for (let i = 0; i < NOSC; i++) {
      const f = freqs[i];
      let xr = driveIm === null ? drive[t] : drive[t][i] * P.cAff, xi = driveIm === null ? 0 : driveIm[t][i] * P.cAff;
      if (P.cInt) for (const d of RATIO_OFFSETS) { const j = i + d; if (j >= 0 && j < NOSC) { xr += P.cInt * zr[j]; xi += P.cInt * zi[j]; } }
      const ar = zr[i], ai = zi[i];
      deriv(f, ar, ai, xr, xi, k1);
      deriv(f, ar + 0.5 * dt * k1[0], ai + 0.5 * dt * k1[1], xr, xi, k2);
      deriv(f, ar + 0.5 * dt * k2[0], ai + 0.5 * dt * k2[1], xr, xi, k3);
      deriv(f, ar + dt * k3[0], ai + dt * k3[1], xr, xi, k4);
      let nr = ar + (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]), ni = ai + (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
      if (eps > 0) { const m = Math.hypot(nr, ni), lim = 0.95 / se; if (m > lim) { nr *= lim / m; ni *= lim / m; } } // stay inside the radius of convergence
      zr[i] = nr; zi[i] = ni;
    }
    if (t >= MEASURE_FROM * FS) { for (let i = 0; i < NOSC; i++) acc[i] += Math.hypot(zr[i], zi[i]); nAcc++; }
    histR.push(Float64Array.from(zr)); histI.push(Float64Array.from(zi));
  }
  void outR;
  return { amp: Array.from(acc, (v) => v / nAcc), histR, histI };
}

const BANKS = {
  linear: { alpha: -1, beta1: 0, beta2: 0, eps: 0, c: 1 },
  critical: { alpha: 0, beta1: -1, beta2: -0.25, eps: 1, c: 1 },
};
const MOTOR = { alpha: -0.3, beta1: 1, beta2: -1, eps: 1, c: 1, cAff: 1, cInt: 0.3 };
const AMPS = [0.01, 0.03, 0.1];
const STIMS = { isochronous: [0, 4, 8, 12], missingPulse: [0, 1, 5, 7, 10, 11, 13, 15], syncopated: [0, 3, 6, 8, 11, 14] };

const summarize = (amp) => {
  let best = 0; for (let i = 0; i < NOSC; i++) if (amp[i] > amp[best]) best = i;
  const mx = amp[best];
  // strongest local peaks (top 5)
  const peaks = [];
  for (let i = 1; i + 1 < NOSC; i++) if (amp[i] >= amp[i - 1] && amp[i] >= amp[i + 1]) peaks.push([freqs[i], amp[i] / mx]);
  peaks.sort((a, b) => b[1] - a[1]);
  const q = PER_OCT / 4, nb = (amp[i2 - q] + amp[i2 + q]) / 2;
  // strongest oscillator inside the beat range 0.5-4 Hz (where a felt pulse lives)
  let bb = -1; for (let i = 0; i < NOSC; i++) if (freqs[i] >= 0.5 && freqs[i] <= 4.01 && (bb < 0 || amp[i] > amp[bb])) bb = i;
  const beatBand = { strongestHz: +freqs[bb].toFixed(2), ratioTo2Hz: +(amp[bb] / amp[i2]).toFixed(2) };
  const sat = amp.filter((v) => v > 0.9).length;
  return { contrast2Hz: +(amp[i2] / nb).toFixed(2), beatBand, saturated: sat, pulseSalience: +(amp[i2] / mx).toFixed(3), strongestHz: +freqs[best].toFixed(2), peaks: peaks.slice(0, 5).map(([f, a]) => [+f.toFixed(2), +a.toFixed(2)]) };
};

const out = { setup: { FS, DUR, MEASURE_FROM, NOSC, range: [FMIN, FMIN * 2 ** OCT] }, banks: BANKS, motor: MOTOR, results: {} };
const t0 = Date.now();
for (const A of AMPS) for (const [sname0, slots] of Object.entries(STIMS)) {
  const sname = `${sname0}@${A}`;
  const x = stimulus(slots, A);
  const spec = spectrum(x, [0.5, 1, 1.5, 2, 2.5, 3, 4, 8]);
  const r = { inputSpectrum: Object.fromEntries([0.5, 1, 1.5, 2, 2.5, 3, 4, 8].map((f, i) => [f + ' Hz', +spec[i].toFixed(3)])) };
  let critical = null;
  for (const [bname, P] of Object.entries(BANKS)) {
    const res = runBank(P, x);
    r[bname] = summarize(res.amp);
    if (bname === 'critical') critical = res;
  }
  // motor-like layer driven 1:1 by the critical bank (Velasco & Large 2011 network 2, without the learned ratio connections)
  const m = runBank(MOTOR, critical.histR, critical.histI);
  r.motor = summarize(m.amp);
  out.results[sname] = r;
  console.log(`${sname.padEnd(18)} | input energy at 2 Hz ${r.inputSpectrum['2 Hz']} (0.5 Hz ${r.inputSpectrum['0.5 Hz']}, 1 Hz ${r.inputSpectrum['1 Hz']})`);
  for (const b of ['linear', 'critical', 'motor']) console.log(`   ${b.padEnd(9)} 2Hz contrast ${r[b].contrast2Hz} | beat-band peak ${r[b].beatBand.strongestHz} Hz (x${r[b].beatBand.ratioTo2Hz} of 2 Hz) | salience ${r[b].pulseSalience} | saturated ${r[b].saturated} | strongest ${r[b].strongestHz} Hz | peaks ${r[b].peaks.map(([f, a]) => `${f}:${a}`).join(' ')}`);
}
fs.writeFileSync(path.join(ROOT, 'lab', 'results', '05-missing-pulse.json'), JSON.stringify(out, null, 2));
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
