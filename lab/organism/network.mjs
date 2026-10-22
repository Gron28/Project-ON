// lab/organism/network.mjs - the developed nervous system, run at 250 Hz. Pure module (no DOM).
//
// Model: stochastic (escape-noise) conductance neurons, event-driven. Why spiking rather than rates:
//   - the energy law is per spike (Laughlin & Sejnowski 2003), so cost is counted where it is paid;
//   - inhibitory plasticity (Vogels et al. 2011) and the eligibility trace of the three-factor rule are defined on spike
//     traces;
//   - escape noise (Gerstner & Kistler 2002) makes firing irregular without an added noise source, and event-driven
//     delivery costs only what fires (about 2-4 ms of CPU per simulated second here).
// Membrane: v relaxes to (gE VE + gI VI + ext) / (1 + gE + gI) with tau_m / (1 + gE + gI) (exact exponential step, stable
// at any conductance). Hazard rho0 exp((v - theta - a + shift) / Delta) times the energy factor (firing needs ATP: a cell
// cannot fire when the milieu's energy is gone, so a starved organism falls quiet). Spike: v resets, adaptation a grows
// and decays with the genome's tau (spike-frequency adaptation). Synapses carry axonal delays (1-16 steps).
//
// Plasticity (rules, not targets; rates from the genome):
//   three-factor Hebb   E synapses keep an STDP eligibility trace (pre-before-post +, post-before-pre -, tau 1 s); the
//                       weight moves by etaH * (0.1 + modGain * M3) * e, where M3 is the local neuromodulator's deviation
//                       from its own slow mean (Izhikevich 2007; Fremaux & Gerstner 2016)
//   inhibitory STDP     I synapses: dw = etaI (x_post - alpha) at a pre spike, etaI x_pre at a post spike; alpha sets the
//                       target rate (Vogels et al. 2011): inhibition grows where excitation outruns it
//   synaptic scaling    each second, a cell's excitatory inputs are scaled by its rate's distance from the set point
//                       (Turrigiano et al. 1998), multiplicatively
//   atrophy             synapses whose presynaptic cell is silent waste away over ~10 min (trophic support needs activity)
//   pruning / sprouting every 5 s synapses below pruneThr x their birth weight are removed; active cells sprout a new
//                       synapse onto an active neighbour of one of their targets
// Prediction credit (read by the milieu, not used by any rule): exteroceptive excitation (ear, onset, roughness, sub-bass;
// not proprioception, which the organism causes itself) arriving at a cell, times the inhibition already above that
// cell's own 1 s mean at that moment, before this step's spikes. Its covariance is ~0 when input and inhibition are
// independent and positive when inhibition arrives on time with the input (predictive cancellation).

import { T, isReceptor, KMAX } from './develop.mjs';

export const DT = 0.004, HZ = 250;
const D = 20, SLOW = 25;                          // delay ring; the slow plasticity cadence (steps)
const TAU_M = 0.02, VE = 4.3, VI = -0.33, THETA = 1, DELTA = 0.25, RHO0 = 20, REFR = 2;
const DEC_E = Math.exp(-DT / 0.005), DEC_I = Math.exp(-DT / 0.01), DEC_X = Math.exp(-DT / 0.02);
const W_MAX_E = 1.5, W_MAX_I = 4, A_PLUS = 1, A_MINUS = 1.05, TAU_ELIG = 1, W_E0 = 0.3;

// exp on [-40, 8] from a table with linear interpolation (relative error < 4e-5); Math.exp was a third of the step
const EXP_LO = -40, EXP_RES = 64, EXP_T = Float64Array.from({ length: 48 * EXP_RES + 2 }, (_, i) => Math.exp(EXP_LO + i / EXP_RES));
export function fexp(u) { if (u <= EXP_LO) return 0; if (u >= 8) return EXP_T[48 * EXP_RES]; const x = (u - EXP_LO) * EXP_RES, i = x | 0; return EXP_T[i] + (x - i) * (EXP_T[i + 1] - EXP_T[i]); }
// probability of at least one event in a step at rate lam
const hazardP = (lam) => (lam < 0.02 ? lam * (1 - 0.5 * lam) : 1 - fexp(-lam));

export function createNetwork(dev, opt = {}) {
  const G = dev.G, N = dev.N, type = dev.type, isI = dev.isI;
  const RS = new Int32Array([((opt.seed ?? dev.seed) * 2654435761 >>> 0) || 1]);   // in a typed array: a closure let would box
  const rnd = () => { const q = (Math.imul(RS[0], 1664525) + 1013904223) | 0; RS[0] = q; return (q >>> 0) / 4294967296; };
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, rnd()))) * Math.cos(2 * Math.PI * rnd());
  const recep = Uint8Array.from(type, (t) => (isReceptor(t) ? 1 : 0));

  // ---- synapses: KMAX slots per presynaptic cell ---------------------------------------------------------------------------
  const tgt = new Int32Array(N * KMAX), w = new Float32Array(N * KMAX), w0 = new Float32Array(N * KMAX), elig = new Float32Array(N * KMAX);
  const delay = new Uint8Array(N * KMAX), nOut = new Uint16Array(N);
  const stats = { born: 0, pruned: 0, sprouted: 0 };
  function addSyn(pre, post, wt, dl) {
    const s = pre * KMAX + nOut[pre]++; tgt[s] = post; w[s] = wt; w0[s] = wt; elig[s] = 0; delay[s] = dl; return s;
  }
  for (let k = 0; k < dev.syn.pre.length; k++) {
    const pre = dev.syn.pre[k], wt = (isI[pre] ? G.gI * W_E0 : W_E0) * Math.exp(0.4 * gauss());
    addSyn(pre, dev.syn.post[k], wt, dev.syn.delay[k]); stats.born++;
  }
  // incoming index (rebuilt after structural change)
  let inStart = new Int32Array(N + 1), inList = new Int32Array(0);
  function rebuildIn() {
    inStart.fill(0);
    for (let p = 0; p < N; p++) for (let s = p * KMAX, e = s + nOut[p]; s < e; s++) inStart[tgt[s] + 1]++;
    for (let i = 0; i < N; i++) inStart[i + 1] += inStart[i];
    inList = new Int32Array(inStart[N]); const fill = inStart.slice(0, N);
    for (let p = 0; p < N; p++) for (let s = p * KMAX, e = s + nOut[p]; s < e; s++) inList[fill[tgt[s]]++] = s;
  }
  rebuildIn();
  // neighbours within reach of a dendrite (for sprouting)
  const nb = []; {
    const P = dev.pos;
    for (let i = 0; i < N; i++) { const l = []; if (!recep[i]) for (let j = 0; j < N; j++) if (j !== i && !recep[j]) { const d = Math.hypot(P[3 * i] - P[3 * j], P[3 * i + 1] - P[3 * j + 1], P[3 * i + 2] - P[3 * j + 2]); if (d < 0.2) l.push(j); } nb.push(Int32Array.from(l)); }
  }
  // volume transmission: each modulatory cell's release reaches every cell, falling off with distance
  const mods = [], P = dev.pos; for (let i = 0; i < N; i++) if (type[i] === T.MOD) mods.push(i);
  const K = new Float32Array(N * mods.length);
  for (let i = 0; i < N; i++) { let s = 0; mods.forEach((m, k) => { const d = Math.hypot(P[3 * i] - P[3 * m], P[3 * i + 1] - P[3 * m + 1], P[3 * i + 2] - P[3 * m + 2]); K[i * mods.length + k] = Math.exp(-d / 0.5); s += K[i * mods.length + k]; }); for (let k = 0; k < mods.length; k++) K[i * mods.length + k] /= s || 1; }

  // ---- neuron state ----------------------------------------------------------------------------------------------------------
  const v = new Float32Array(N), a = new Float32Array(N), refr = new Uint8Array(N), spk = new Uint8Array(N);
  const gE = new Float32Array(N), gI = new Float32Array(N), gIbar = new Float32Array(N);
  const ringE = new Float32Array(D * N), ringI = new Float32Array(D * N), ringS = new Float32Array(D * N);
  const x = new Float32Array(N), y = new Float32Array(N);           // pre / post STDP traces (tau 20 ms)
  const rbar = new Float32Array(N).fill(G.rTarget), rf = new Float32Array(N);   // slow (5 s) and fast (100 ms) rate, Hz
  const ext = new Float32Array(N);                                   // receptors: rate (Hz); others: input current
  const modc = new Float32Array(N), modBar = new Float32Array(N);    // modulator concentration (0..1) and its slow mean
  const dead = new Uint8Array(N);                                    // lesioned cells
  const DEC_A = Math.exp(-DT / G.tauAdapt), DEC_RB = Math.exp(-DT / 5), DEC_RF = Math.exp(-DT / 0.1);
  const alphaI = 2 * G.rTarget * 0.02;
  let slot = 0, n = 0;
  const S = { energyFactor: 1, credit: 0, creditNorm: 0, sensoryIn: 0, spikes: 0, spikesByType: new Float32Array(10), gEmean: 0, gImean: 0, mod: 0 };

  function step() {
    const eF = S.energyFactor, base = slot * N, mg = G.modGain * 0.3 / DELTA, kv = DT / TAU_M;
    let credit = 0, cnorm = 0, sIn = 0, nsp = 0, gEs = 0, gIs = 0, nEc = 0, modSum = 0;
    S.spikesByType.fill(0);
    for (let i = 0; i < N; i++) {
      const sArr = ringS[base + i];
      let ge = gE[i] * DEC_E + ringE[base + i], gi = gI[i] * DEC_I + ringI[base + i];
      ringE[base + i] = 0; ringI[base + i] = 0; ringS[base + i] = 0;
      // predictive cancellation: sensory excitation arriving now, met by inhibition already above its own recent level
      // (chance-corrected: the covariance of input with inhibition above its own 1 s mean, ~0 when they are independent,
      // normalised by the input times that mean; computed before this step's spikes, so a reflex cannot count)
      if (sArr > 0) { sIn += sArr; credit += sArr * (gi - gIbar[i]); cnorm += sArr * (gIbar[i] + 0.05); }
      gIbar[i] += 0.004 * (gi - gIbar[i]);
      gE[i] = ge; gI[i] = gi;
      x[i] *= DEC_X; y[i] *= DEC_X; a[i] *= DEC_A; spk[i] = 0;
      if (dead[i]) { rbar[i] *= DEC_RB; rf[i] *= DEC_RF; continue; }
      let hz;
      if (recep[i]) hz = ext[i];
      else {
        const gt = 1 + ge + gi, vinf = (ge * VE + gi * VI + ext[i]) / gt;
        const q = kv * gt, decay = 1 / (1 + q * (1 + q * (0.5 + q * (1 / 6 + q / 24))));   // ~exp(-q): Taylor in the denominator, stable
        const vv = vinf + (v[i] - vinf) * decay; v[i] = vv;
        const u = (vv - THETA - a[i]) / DELTA + mg * modc[i];
        hz = u < -7 ? 0 : RHO0 * fexp(u > 6 ? 6 : u);                                 // below u = -7: < 0.02 Hz, skipped
        if (!isI[i]) { gEs += ge; gIs += gi; nEc++; }
      }
      let fired = 0;
      if (refr[i]) refr[i]--;
      else if (hz > 0 && rnd() < hazardP(DT * hz * eF)) {
        fired = 1; spk[i] = 1; refr[i] = REFR; v[i] = 0; a[i] += 0.15; x[i] += 1; y[i] += 1; nsp++; S.spikesByType[type[i]]++;
      }
      rbar[i] = rbar[i] * DEC_RB + fired * (1 - DEC_RB) * HZ;
      rf[i] = rf[i] * DEC_RF + fired * (1 - DEC_RF) * HZ;
    }
    // deliver spikes and pre-side plasticity
    for (let j = 0; j < N; j++) {
      if (!spk[j]) continue;
      const inh = isI[j], sens = type[j] <= T.SUB;     // exteroceptive: ear, onset, roughness, sub-bass (not reafferent proprioception)
      for (let s = j * KMAX, e = s + nOut[j]; s < e; s++) {
        const t = tgt[s], at = ((slot + delay[s]) % D) * N + t;
        if (inh) { ringI[at] += w[s]; let nw = w[s] + G.etaI * (y[t] - alphaI); w[s] = nw < 0 ? 0 : nw > W_MAX_I ? W_MAX_I : nw; }
        else { ringE[at] += w[s]; if (sens) ringS[at] += w[s]; elig[s] -= A_MINUS * y[t]; }
      }
    }
    // post-side plasticity
    for (let i = 0; i < N; i++) {
      if (!spk[i] || recep[i]) continue;
      for (let k = inStart[i], e = inStart[i + 1]; k < e; k++) {
        const s = inList[k], pre = (s / KMAX) | 0;
        if (isI[pre]) { const nw = w[s] + G.etaI * x[pre]; w[s] = nw > W_MAX_I ? W_MAX_I : nw; }
        else elig[s] += A_PLUS * x[pre];
      }
    }
    slot = (slot + 1) % D; n++;
    // every 100 ms: modulator field, three-factor update, atrophy (eligibility lasts ~1 s, so this loses nothing)
    if (n % SLOW === 0) {
      const M = mods.length;
      for (let i = 0; i < N; i++) {
        let c = 0; for (let k = 0; k < M; k++) c += K[i * M + k] * rf[mods[k]];
        const m = c / (c + 5); modc[i] = m; modBar[i] += 0.005 * (m - modBar[i]); modSum += m;
      }
      S.mod = modSum / N;
      const decE = Math.exp(-SLOW * DT / TAU_ELIG), atro = SLOW * DT / 600, hk = G.etaH * SLOW * DT / 0.04;   // etaH is per 40 ms
      for (let p = 0; p < N; p++) {
        const use = Math.min(1, rbar[p] / 1), lose = atro * (1 - use), inh = isI[p];
        for (let s = p * KMAX, e = s + nOut[p]; s < e; s++) {
          let nw = w[s];
          if (!inh) {
            const t = tgt[s], m3 = Math.max(-1, Math.min(1, 4 * (modc[t] - modBar[t])));
            nw += hk * (0.1 + G.modGain * m3) * elig[s]; elig[s] *= decE;
            nw = nw < 0 ? 0 : nw > W_MAX_E ? W_MAX_E : nw;
          }
          w[s] = nw - nw * lose;
        }
      }
    }
    if (n % HZ === 0) scale();
    if (n % (5 * HZ) === 0) restructure();
    S.credit = credit; S.creditNorm = cnorm; S.sensoryIn = sIn; S.spikes = nsp; S.gEmean = nEc ? gEs / nEc : 0; S.gImean = nEc ? gIs / nEc : 0;
    return S;
  }

  function scale() {
    for (let i = 0; i < N; i++) {
      if (recep[i] || dead[i]) continue;
      const f = Math.max(0.8, Math.min(1.25, 1 + G.etaS * (G.rTarget - rbar[i]) / G.rTarget));
      for (let k = inStart[i], e = inStart[i + 1]; k < e; k++) { const s = inList[k]; if (!isI[(s / KMAX) | 0]) w[s] = Math.min(W_MAX_E, w[s] * f); }
    }
  }
  function removeSyn(p, s) { const last = p * KMAX + nOut[p] - 1; tgt[s] = tgt[last]; w[s] = w[last]; w0[s] = w0[last]; elig[s] = elig[last]; delay[s] = delay[last]; nOut[p]--; }
  function restructure() {
    for (let p = 0; p < N; p++) for (let s = p * KMAX + nOut[p] - 1; s >= p * KMAX; s--) if (w[s] < G.pruneThr * w0[s]) { removeSyn(p, s); stats.pruned++; }
    for (let p = 0; p < N; p++) {
      if (dead[p] || !nOut[p] || nOut[p] >= KMAX || rnd() > 0.1 * Math.min(2, rbar[p] / G.rTarget)) continue;
      const via = tgt[p * KMAX + ((rnd() * nOut[p]) | 0)], l = nb[via]; if (!l.length) continue;
      const k = l[(rnd() * l.length) | 0]; if (k === p || dead[k] || rbar[k] < 0.5 * G.rTarget) continue;
      let dup = false; for (let s = p * KMAX, e = s + nOut[p]; s < e; s++) if (tgt[s] === k) { dup = true; break; }
      if (dup) continue;
      let d = 1; for (let s = p * KMAX, e = s + nOut[p]; s < e; s++) if (tgt[s] === via) { d = delay[s]; break; }
      addSyn(p, k, 0.5 * (isI[p] ? G.gI * W_E0 : W_E0), d); stats.sprouted++;
    }
    rebuildIn();
  }

  /** every live synapse as parallel arrays (for analysis and the view) */
  function edges() {
    let m = 0; for (let p = 0; p < N; p++) m += nOut[p];
    const pre = new Int32Array(m), post = new Int32Array(m), wt = new Float32Array(m), sl = new Int32Array(m); let k = 0;
    for (let p = 0; p < N; p++) for (let s = p * KMAX, e = s + nOut[p]; s < e; s++) { pre[k] = p; post[k] = tgt[s]; wt[k] = w[s]; sl[k++] = s; }
    return { pre, post, w: wt, slot: sl, m };
  }
  function lesion(cellsToKill) { for (const i of cellsToKill) { dead[i] = 1; nOut[i] = 0; } for (let p = 0; p < N; p++) for (let s = p * KMAX + nOut[p] - 1; s >= p * KMAX; s--) if (dead[tgt[s]]) removeSyn(p, s); rebuildIn(); }

  function serialize() {
    const e = edges(), rs = RS[0];
    return { n, slot, pre: Array.from(e.pre), post: Array.from(e.post), w: Array.from(e.w, (q) => +q.toFixed(5)), w0: Array.from(e.slot, (s) => +w0[s].toFixed(5)), delay: Array.from(e.slot, (s) => delay[s]),
      v: Array.from(v), a: Array.from(a), rbar: Array.from(rbar), modBar: Array.from(modBar), dead: Array.from(dead), stats: { ...stats }, rs };
  }
  function restore(o) {
    nOut.fill(0);
    for (let k = 0; k < o.pre.length; k++) { const s = addSyn(o.pre[k], o.post[k], o.w[k], o.delay[k]); w0[s] = o.w0[k]; }
    v.set(o.v); a.set(o.a); rbar.set(o.rbar); modBar.set(o.modBar); dead.set(o.dead); Object.assign(stats, o.stats); n = o.n; slot = o.slot; RS[0] = o.rs;
    rebuildIn();
  }

  return { N, step, ext, spk, rf, rbar, v, gE, gI, modc, dead, w, w0, tgt, nOut, delay, S, stats, edges, lesion, serialize, restore, recep, isI, type, get t() { return n * DT; } };
}
