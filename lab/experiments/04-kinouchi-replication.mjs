// Experiment 04 - replicate Kinouchi & Copelli 2006 (Nature Physics 2:348, "Optimal dynamical range of excitable
// networks at criticality") before building on it.
//
// Model (from the paper): N excitable units, each with n states: 0 resting, 1 excited, 2..n-1 refractory (deterministic
// cycle 1 -> 2 -> ... -> n-1 -> 0). A resting unit becomes excited in a 1 ms step from external Poisson input with
// probability eta = 1 - exp(-r * dt), or from each excited neighbour j with probability p_ij. Network: random graph
// with mean degree K, p_ij uniform on [0, pmax], branching ratio sigma = K * pmax / 2.
// Response F = mean fraction of excited units per step. Dynamic range Delta = 10 log10(r_0.9 / r_0.1).
// Paper: Delta peaks at sigma = 1 (~26 dB vs ~17 dB uncoupled), F ~ r^(1/2) at criticality.
//
//   node lab/experiments/04-kinouchi-replication.mjs   ->  lab/results/04-kinouchi.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const N = 100000, K = 10, NSTATES = 5, DT = 1; // ms
const STEPS = 3000, TRANSIENT = 500;

function rng(seed) { let a = seed | 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// undirected Erdos-Renyi graph with mean degree K, stored as CSR, symmetric p_ij
function buildGraph(sigma, seed) {
  const R = rng(seed), M = (N * K) / 2;
  const a = new Uint32Array(M), b = new Uint32Array(M), p = new Float32Array(M);
  const pmax = (2 * sigma) / K;
  for (let e = 0; e < M; e++) { let x = (R() * N) | 0, y = (R() * N) | 0; while (y === x) y = (R() * N) | 0; a[e] = x; b[e] = y; p[e] = R() * pmax; }
  const deg = new Uint32Array(N + 1);
  for (let e = 0; e < M; e++) { deg[a[e] + 1]++; deg[b[e] + 1]++; }
  for (let i = 0; i < N; i++) deg[i + 1] += deg[i];
  const fill = deg.slice(0, N), col = new Uint32Array(2 * M), pr = new Float32Array(2 * M);
  for (let e = 0; e < M; e++) { let k = fill[a[e]]++; col[k] = b[e]; pr[k] = p[e]; k = fill[b[e]]++; col[k] = a[e]; pr[k] = p[e]; }
  return { ptr: deg, col, pr };
}

function response(G, rate, seed) {
  const R = rng(seed);
  const state = new Uint8Array(N);
  let excited = new Uint32Array(N), nEx = 0, next = new Uint32Array(N);
  const eta = 1 - Math.exp(-rate * DT / 1000);
  const refr = []; // queue of units by refractory stage is implicit in state
  let sum = 0, count = 0;
  // seed a few excited units
  for (let k = 0; k < 10; k++) { const i = (R() * N) | 0; state[i] = 1; excited[nEx++] = i; }
  const mark = new Uint8Array(N);
  for (let s = 0; s < STEPS; s++) {
    let nNext = 0;
    // propagation from excited units to resting neighbours
    for (let k = 0; k < nEx; k++) {
      const i = excited[k];
      for (let e = G.ptr[i]; e < G.ptr[i + 1]; e++) { const j = G.col[e]; if (state[j] === 0 && !mark[j] && R() < G.pr[e]) { mark[j] = 1; next[nNext++] = j; } }
    }
    // external input: expected eta*N resting units excited; sample directly per unit when eta is large, else by count
    if (eta > 0) {
      if (eta > 0.02) { for (let j = 0; j < N; j++) if (state[j] === 0 && !mark[j] && R() < eta) { mark[j] = 1; next[nNext++] = j; } }
      else { let m = 0; const target = eta * N; // Poisson-ish: Bernoulli count via geometric skipping
        let j = Math.floor(Math.log(1 - R()) / Math.log(1 - eta));
        while (j < N) { if (state[j] === 0 && !mark[j]) { mark[j] = 1; next[nNext++] = j; } j += 1 + Math.floor(Math.log(1 - R()) / Math.log(1 - eta)); m++; }
        void target; void m; }
    }
    // advance the cycle: excited -> 2, refractory -> +1, last -> 0
    for (let j = 0; j < N; j++) { const st = state[j]; if (st > 0) state[j] = st + 1 >= NSTATES ? 0 : st + 1; }
    for (let k = 0; k < nNext; k++) { const j = next[k]; state[j] = 1; mark[j] = 0; }
    const tmp = excited; excited = next; next = tmp; nEx = nNext;
    if (s >= TRANSIENT) { sum += nEx / N; count++; }
  }
  return sum / count;
}

const RATES = [0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30, 100, 300, 1000, 3000, 10000]; // spikes/s per unit
const SIGMAS = [0, 0.5, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5];
const out = { model: { N, K, n: NSTATES, dtMs: DT, steps: STEPS }, curves: [] };
const t0 = Date.now();
for (const sigma of SIGMAS) {
  const G = buildGraph(sigma, 1 + Math.round(sigma * 100));
  const F = RATES.map((r, k) => response(G, r, 1000 + k));
  // Delta = 10 log10(r90/r10), F_x = F0 + x (Fmax - F0); F0 = response with no input (self-sustained activity above sigma_c)
  const F0 = response(G, 0, 999), Fmax = 1 / NSTATES; // maximum: every unit fires once per cycle
  const at = (x) => { const y = F0 + x * (Fmax - F0); for (let i = 0; i + 1 < RATES.length; i++) { const a = F[i], b = F[i + 1]; if ((a - y) * (b - y) <= 0 && a !== b) return Math.exp(Math.log(RATES[i]) + (Math.log(RATES[i + 1]) - Math.log(RATES[i])) * (y - a) / (b - a)); } return null; };
  const r10 = at(0.1), r90 = at(0.9);
  const delta = r10 && r90 ? 10 * Math.log10(r90 / r10) : null;
  // Stevens exponent: slope of log(F - F0) vs log r over the low-input decade where F is between 1% and 30% of Fmax
  const pts = RATES.map((r, i) => [Math.log(r), Math.log(Math.max(1e-9, F[i] - F0))]).filter((_, i) => F[i] - F0 > 0.002 * Fmax && F[i] - F0 < 0.3 * Fmax);
  let slope = null;
  if (pts.length >= 3) { const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length, my = pts.reduce((s, p) => s + p[1], 0) / pts.length; let nu = 0, de = 0; for (const [x, y] of pts) { nu += (x - mx) * (y - my); de += (x - mx) ** 2; } slope = nu / de; }
  out.curves.push({ sigma, F0: +F0.toExponential(3), deltaDb: delta && +delta.toFixed(1), stevensExponent: slope && +slope.toFixed(2), F: F.map((x) => +x.toExponential(3)) });
  console.log(`sigma ${sigma.toFixed(2)} | F0 ${F0.toExponential(2)} | dynamic range ${delta ? delta.toFixed(1) : '-'} dB | low-input exponent ${slope ? slope.toFixed(2) : '-'}`);
}
out.rates = RATES;
fs.writeFileSync(path.join(ROOT, 'lab', 'results', '04-kinouchi.json'), JSON.stringify(out, null, 2));
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
