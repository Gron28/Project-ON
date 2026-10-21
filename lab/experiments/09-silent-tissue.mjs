// Experiment 09 - what does the tissue do in silence? (notebook section 6: "Autonomy" and "Criticality")
//
// Expected if alive: in silence the sheet shows spontaneous activity that is neither a metronome nor white noise:
//   - branching ratio near 1,
//   - avalanches (excursions of the activity above its median) with a heavy-tailed size distribution (exponent ~ -1.5),
//   - a 1/f-like power spectrum (slope between 0 and -2),
//   - Lempel-Ziv complexity above a periodic signal and below a shuffled copy of itself (structure in time).
// The ear hums in digital silence (spontaneous emission), and drives the sheet exactly as being/worker.mjs does.
//
//   node lab/experiments/09-silent-tissue.mjs [seconds=60] [seed=99]   ->  lab/results/09-silent-tissue.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEar, SR, NE, DELTA } from '../../being/ear.mjs';
import { createTissue } from '../../being/tissue.mjs';
import { mulberry32 } from '../../being/mind.mjs';

const SECONDS = +process.argv[2] || 60, SEED = +process.argv[3] || 99, WARM = 30;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** the activity of the tissue, one number per 4 ms step, driven by the ear hearing nothing (or the given samples) */
export function silentActivity({ seconds = SECONDS, warm = WARM, seed = SEED, input = null, tissueOpts = {} } = {}) {
  const ear = createEar(), rng = mulberry32(seed), tissue = createTissue({ earUnits: NE, rng, seed, ...tissueOpts });
  const drive = new Float64Array(NE), EVERY = SR * 4 / 1000, out = [];
  const total = Math.round((seconds + warm) * SR);
  for (let n = 0, k = 0; n < total; n++) {
    ear.sample(input ? input(n) : 0);
    if (++k >= EVERY) {
      k = 0;
      for (let u = 0; u < NE; u++) drive[u] = 0.012 * Math.max(0, Math.log1p(ear.env[u] / DELTA) - 0.8);
      const c = tissue.step(drive);
      if (n >= warm * SR) out.push(c);
    }
  }
  return out;
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const median = (a) => { const b = Float64Array.from(a).sort(); return b[b.length >> 1]; };

/** branching ratio: mean of next/this over steps with activity (the naive estimator; biased under constant drive, so also report the regression) */
export function branching(a) {
  let sr = 0, sn = 0; for (let i = 0; i + 1 < a.length; i++) if (a[i] > 0) { sr += a[i + 1] / a[i]; sn++; }
  // multistep regression estimator (Wilting & Priesemann 2018): slope of r_k = m^k * c, from lags 1..K of the linear regression
  const mu = mean(a), K = 40, r = [];
  for (let k = 1; k <= K; k++) {
    let cov = 0, v = 0; for (let i = 0; i + k < a.length; i++) { cov += (a[i] - mu) * (a[i + k] - mu); v += (a[i] - mu) ** 2; }
    r.push(cov / v);
  }
  // fit log r_k = k log m + log c over lags with r_k > 0
  const pts = r.map((y, i) => [i + 1, y]).filter(([, y]) => y > 1e-4).map(([k, y]) => [k, Math.log(y)]);
  let mr = null; if (pts.length > 3) { const mx = mean(pts.map((p) => p[0])), my = mean(pts.map((p) => p[1])); let nu = 0, de = 0; for (const [x, y] of pts) { nu += (x - mx) * (y - my); de += (x - mx) ** 2; } mr = Math.exp(nu / de); }
  return { naive: sn ? sr / sn : null, mr, autocorr1: r[0] };
}

/** avalanches in a continuous signal: excursions above the median (Poil et al. 2012); size = area above it, duration in steps */
export function avalanches(a) {
  const th = median(a), sizes = [], durs = []; let s = 0, d = 0;
  for (const x of a) { if (x > th) { s += x - th; d++; } else if (d) { sizes.push(s); durs.push(d); s = 0; d = 0; } }
  const slope = (v) => {   // log-log slope of the log-binned histogram (rough; needs many events)
    if (v.length < 100) return null;
    const max = Math.max(...v), pts = []; for (let e = Math.min(...v); e <= max; e *= 1.5) { const c = v.filter((x) => x >= e && x < e * 1.5).length; if (c >= 3) pts.push([Math.log(e * 1.22), Math.log(c / (e * 0.5))]); }
    if (pts.length < 4) return null;
    const mx = mean(pts.map((p) => p[0])), my = mean(pts.map((p) => p[1])); let nu = 0, de = 0; for (const [x, y] of pts) { nu += (x - mx) * (y - my); de += (x - mx) ** 2; }
    return nu / de;
  };
  return { count: sizes.length, sizeSlope: slope(sizes), durationSlope: slope(durs), meanDur: durs.length ? mean(durs) : 0 };
}

/** power-spectrum slope beta (P ~ f^-beta -> reported as the log-log slope, negative) over 0.02-5 Hz, from 100 ms bins */
export function spectralSlope(a, step = 0.004) {
  const bin = Math.round(0.1 / step), x = []; for (let i = 0; i + bin <= a.length; i += bin) { let s = 0; for (let j = 0; j < bin; j++) s += a[i + j]; x.push(s); }
  const n = 1 << Math.floor(Math.log2(x.length)), mu = mean(x.slice(0, n)), xs = x.slice(0, n).map((v) => v - mu), P = [];
  for (let k = 1; k < n / 2; k++) { const f = k / (n * 0.1); if (f < 0.02 || f > 5) continue; let re = 0, im = 0; for (let t = 0; t < n; t++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * t / n); re += w * xs[t] * Math.cos(2 * Math.PI * k * t / n); im -= w * xs[t] * Math.sin(2 * Math.PI * k * t / n); } P.push([Math.log(f), Math.log((re * re + im * im) / n + 1e-12)]); }
  // average in log-spaced groups so the many high frequencies do not dominate the fit
  const g = new Map(); for (const [lf, lp] of P) { const key = Math.round(lf * 3); (g.get(key) || g.set(key, []).get(key)).push([lf, lp]); }
  const pts = [...g.values()].map((v) => [mean(v.map((p) => p[0])), mean(v.map((p) => p[1]))]);
  if (pts.length < 4) return null;
  const mx = mean(pts.map((p) => p[0])), my = mean(pts.map((p) => p[1])); let nu = 0, de = 0; for (const [xx, y] of pts) { nu += (xx - mx) * (y - my); de += (xx - mx) ** 2; }
  return nu / de;
}

/** Lempel-Ziv 76 complexity (Kaspar & Schuster 1987) of a binary sequence, normalised by n / log2 n (about 1 for a random one) */
export function lz(bits) {
  const n = bits.length; let c = 1, l = 1, i = 0, k = 1, kmax = 1;
  while (true) {
    if (bits[i + k - 1] === bits[l + k - 1]) { k++; if (l + k > n) { c++; break; } }
    else { if (k > kmax) kmax = k; i++; if (i === l) { c++; l += kmax; if (l + 1 > n) break; i = 0; k = 1; kmax = 1; } else k = 1; }
  }
  return c / (n / Math.log2(n));
}
const binarise = (a) => { const m = median(a); return a.map((x) => (x > m ? 1 : 0)); };
export function shuffled(a, seed = 5) { const r = mulberry32(seed), b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; [b[i], b[j]] = [b[j], b[i]]; } return b; }

export function measure(a) {
  const bits = binarise(a).slice(0, 40000), period = Math.max(2, Math.round(1 / 0.004 / 2)), square = bits.map((_, i) => ((i / period) | 0) % 2);
  const L = lz(bits), Lsh = lz(binarise(shuffled(a)).slice(0, 40000)), Lper = lz(square);
  return { steps: a.length, mean: mean(a), cv: Math.sqrt(mean(a.map((x) => (x - mean(a)) ** 2))) / (mean(a) || 1), ...branching(a), ...avalanches(a), spectralSlope: spectralSlope(a),
    lz: L, lzShuffled: Lsh, lzPeriodic: Lper, lzRatio: L / Lsh };
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('09-silent-tissue.mjs')) {
  // the sheet with homeostasis alone, and as the being runs it (worker.mjs: a wandering set point)
  const t0 = Date.now(), res = { seconds: SECONDS, seed: SEED, homeostasisOnly: measure(silentActivity()), being: measure(silentActivity({ tissueOpts: { wander: 0.7 } })), ms: Date.now() - t0 };
  fs.mkdirSync(path.join(ROOT, 'lab', 'results'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'lab', 'results', '09-silent-tissue.json'), JSON.stringify(res, null, 1));
  console.log(res);
}
