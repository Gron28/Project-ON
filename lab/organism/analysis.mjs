// lab/organism/analysis.mjs - measures of what emerged in an organism's wiring and behaviour. Pure module (no DOM).
//   louvain()        communities on the undirected weight graph (Blondel et al. 2008) and modularity Q
//   depth()          shortest-path layer (synaptic hops) from the sensory cells; sensor -> motor depth
//   reciprocity()    share of edges whose reverse exists, against degree-matched random graphs (edge swaps)
//   vectorStrength() phase locking of event times to a period (Goldberg & Brown 1969)
//   cvISI()          irregularity of firing

import { T, isReceptor } from './develop.mjs';

/** live edges of an organism: { n, pre, post, w, m } */
export function graphOf(org) { const e = org.net.edges(); return { n: org.dev.N, pre: e.pre, post: e.post, w: e.w, m: e.m }; }

export function louvain(g, minW = 0) {
  const n = g.n;
  // undirected adjacency with merged weights
  let adj = Array.from({ length: n }, () => new Map());
  for (let k = 0; k < g.m; k++) {
    const a = g.pre[k], b = g.post[k], w = g.w[k]; if (w <= minW || a === b) continue;
    adj[a].set(b, (adj[a].get(b) || 0) + w); adj[b].set(a, (adj[b].get(a) || 0) + w);
  }
  const base = adj;
  let member = Int32Array.from({ length: n }, (_, i) => i);   // original node -> community
  for (let level = 0; level < 10; level++) {
    const nn = adj.length, comm = Int32Array.from({ length: nn }, (_, i) => i);
    const kdeg = Float64Array.from(adj, (m) => { let s = 0; for (const w of m.values()) s += w; return s; });
    const self = Float64Array.from(adj, (m, i) => m.get(i) || 0);
    let m2 = 0; for (const k of kdeg) m2 += k; if (m2 === 0) break;
    const tot = Float64Array.from(kdeg);
    let moved = true, any = false, sweeps = 0;
    while (moved && sweeps++ < 20) {
      moved = false;
      for (let i = 0; i < nn; i++) {
        const ci = comm[i], ki = kdeg[i], links = new Map();
        for (const [j, w] of adj[i]) if (j !== i) links.set(comm[j], (links.get(comm[j]) || 0) + w);
        tot[ci] -= ki;
        let best = ci, bestGain = (links.get(ci) || 0) - tot[ci] * ki / m2;
        for (const [c, w] of links) { const gain = w - tot[c] * ki / m2; if (gain > bestGain + 1e-12) { bestGain = gain; best = c; } }
        tot[best] += ki;
        if (best !== ci) { comm[i] = best; moved = true; any = true; }
      }
    }
    if (!any) break;
    const ids = new Map(); for (let i = 0; i < nn; i++) if (!ids.has(comm[i])) ids.set(comm[i], ids.size);
    member = member.map((c) => ids.get(comm[c]));
    const next = Array.from({ length: ids.size }, () => new Map());
    for (let i = 0; i < nn; i++) { const a = ids.get(comm[i]); for (const [j, w] of adj[i]) { const b = ids.get(comm[j]); next[a].set(b, (next[a].get(b) || 0) + w); } void self; }
    adj = next;
  }
  // renumber by size (largest first) and score on the original graph
  const size = new Map(); for (const c of member) size.set(c, (size.get(c) || 0) + 1);
  const order = [...size.keys()].sort((a, b) => size.get(b) - size.get(a)), rank = new Map(order.map((c, i) => [c, i]));
  member = member.map((c) => rank.get(c));
  return { member, count: order.length, Q: modularity(base, member) };
}
function modularity(adj, member) {
  let m2 = 0; const tot = new Map(), inn = new Map();
  adj.forEach((m, i) => { for (const [j, w] of m) { m2 += w; const c = member[i]; tot.set(c, (tot.get(c) || 0) + w); if (member[j] === c) inn.set(c, (inn.get(c) || 0) + w); } });
  if (!m2) return 0;
  let Q = 0; for (const [c, t] of tot) Q += (inn.get(c) || 0) / m2 - (t / m2) ** 2;
  return Q;
}

/** synaptic hops from any sensory cell, over edges with weight > minW; -1 when unreachable */
export function depth(org, minW = 0.02) {
  const g = graphOf(org), n = g.n, d = new Int16Array(n).fill(-1), out = Array.from({ length: n }, () => []);
  for (let k = 0; k < g.m; k++) if (g.w[k] > minW) out[g.pre[k]].push(g.post[k]);
  let q = []; for (let i = 0; i < n; i++) if (isReceptor(org.dev.type[i]) && !org.net.dead[i]) { d[i] = 0; q.push(i); }
  for (let h = 1; q.length; h++) { const nq = []; for (const i of q) for (const j of out[i]) if (d[j] < 0) { d[j] = h; nq.push(j); } q = nq; }
  const motors = [...org.C.motor], reached = motors.filter((i) => d[i] >= 0);
  const hist = []; for (const x of d) if (x >= 0) hist[x] = (hist[x] || 0) + 1;
  return { d, hist: Array.from(hist, (x) => x || 0), motorDepth: reached.length ? reached.reduce((s, i) => s + d[i], 0) / reached.length : NaN, motorReached: reached.length / Math.max(1, motors.length) };
}

/** reciprocity and the same measure on degree-matched random graphs (directed edge swaps keep every in- and out-degree) */
export function reciprocity(g, seed = 1, reps = 3) {
  const recip = (pre, post) => { const s = new Set(); for (let k = 0; k < pre.length; k++) s.add(pre[k] * g.n + post[k]); let r = 0; for (let k = 0; k < pre.length; k++) if (s.has(post[k] * g.n + pre[k])) r++; return pre.length ? r / pre.length : 0; };
  const r0 = recip(g.pre, g.post);
  let s = seed >>> 0 || 1; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; };
  let rr = 0;
  for (let rep = 0; rep < reps; rep++) {
    const pre = Int32Array.from(g.pre), post = Int32Array.from(g.post), set = new Set(); for (let k = 0; k < pre.length; k++) set.add(pre[k] * g.n + post[k]);
    for (let t = 0; t < 10 * pre.length; t++) {
      const a = (rnd() * pre.length) | 0, b = (rnd() * pre.length) | 0; if (a === b) continue;
      const a2 = post[b], b2 = post[a];
      if (pre[a] === a2 || pre[b] === b2 || set.has(pre[a] * g.n + a2) || set.has(pre[b] * g.n + b2)) continue;
      set.delete(pre[a] * g.n + post[a]); set.delete(pre[b] * g.n + post[b]); post[a] = a2; post[b] = b2; set.add(pre[a] * g.n + a2); set.add(pre[b] * g.n + b2);
    }
    rr += recip(pre, post);
  }
  return { r: r0, random: rr / reps, ratio: rr > 0 ? r0 / (rr / reps) : NaN };
}

export function vectorStrength(times, period) {
  let c = 0, s = 0; for (const t of times) { const ph = 2 * Math.PI * t / period; c += Math.cos(ph); s += Math.sin(ph); }
  const n = times.length; return n ? { vs: Math.hypot(c, s) / n, phase: Math.atan2(s, c) / (2 * Math.PI), n } : { vs: NaN, phase: NaN, n: 0 };
}

/** per-cell ISI coefficient of variation, averaged over cells with >= 5 spikes; spikeTimes: array of arrays */
export function cvISI(spikeTimes) {
  let sum = 0, k = 0;
  for (const ts of spikeTimes) {
    if (ts.length < 6) continue; let m = 0, m2 = 0; const n = ts.length - 1;
    for (let i = 1; i < ts.length; i++) { const d = ts[i] - ts[i - 1]; m += d; m2 += d * d; }
    m /= n; const v = m2 / n - m * m; sum += Math.sqrt(Math.max(0, v)) / m; k++;
  }
  return k ? sum / k : NaN;
}

/** the summary reported for an organism */
export function summarize(org) {
  const g = graphOf(org), L = louvain(g), D = depth(org), R = reciprocity(g);
  const st = org.net.stats, formed = st.born + st.sprouted;
  return { N: org.dev.N, synapses: g.m, perCell: g.m / org.dev.N, communities: L.count, Q: L.Q, motorDepth: D.motorDepth, motorReached: D.motorReached, depthHist: D.hist,
    reciprocity: R.r, reciprocityRandom: R.random, reciprocityRatio: R.ratio, pruned: st.pruned / formed, sprouted: st.sprouted, inhibitoryShare: org.dev.isI.reduce((s, x) => s + x, 0) / org.dev.N, member: L.member };
}
export { T };

// ---- timing to the beat ---------------------------------------------------------------------------------------------------
// beats: [{ t, omitted, period }] (environment.mjs earFrames). A trace is sampled every dt seconds from time t0.

/** per beat (not omitted, inside [from, to)), when the trace peaks within half a period around it: the error in ms
 *  (negative = ahead of the beat). Returns { n, median, sd, mean, errs } */
export function beatAlignment(trace, beats, { dt = 0.004, t0 = 0, from = -Infinity, to = Infinity } = {}) {
  const errs = [];
  for (const b of beats) {
    if (b.omitted || b.t < from || b.t >= to) continue;
    const T = b.period || 0.5, i0 = Math.max(0, Math.ceil((b.t - T / 2 - t0) / dt)), i1 = Math.min(trace.length, Math.floor((b.t + T / 2 - t0) / dt));
    if (i1 - i0 < 3) continue;
    let best = -Infinity, bi = -1, mean = 0; for (let i = i0; i < i1; i++) { mean += trace[i]; if (trace[i] > best) { best = trace[i]; bi = i; } }
    mean /= i1 - i0; if (!(best > mean * 1.05 + 1e-6)) continue;      // a flat trace has no peak to place
    errs.push(1000 * (t0 + bi * dt - b.t));
  }
  if (!errs.length) return { n: 0, median: NaN, sd: NaN, mean: NaN, errs };
  const s = [...errs].sort((a, b) => a - b), m = errs.reduce((x, y) => x + y, 0) / errs.length;
  return { n: errs.length, median: s[s.length >> 1], sd: Math.sqrt(errs.reduce((x, y) => x + (y - m) ** 2, 0) / errs.length), mean: m, errs };
}
/** phase locking of event times to the beat grid (each time's phase within its own beat interval, so tempo ramps and
 *  swing are handled): vector strength, mean phase and the mean phase as ms ahead (-) / behind (+) the beat */
export function beatLocking(times, beats, { from = -Infinity, to = Infinity } = {}) {
  const g = beats.filter((b) => b.t >= from - 2 && b.t < to + 2);
  let c = 0, s = 0, n = 0, Tsum = 0, k = 0;
  for (const t of times) {
    if (t < from || t >= to) continue;
    while (k + 1 < g.length && g[k + 1].t <= t) k++;
    if (k + 1 >= g.length || g[k].t > t) continue;
    const T = g[k + 1].t - g[k].t; if (T <= 0 || T > 2) continue;
    const ph = 2 * Math.PI * (t - g[k].t) / T; c += Math.cos(ph); s += Math.sin(ph); n++; Tsum += T;
  }
  if (!n) return { vs: NaN, phase: NaN, ms: NaN, n: 0 };
  const phase = Math.atan2(s, c) / (2 * Math.PI);
  return { vs: Math.hypot(c, s) / n, phase, ms: 1000 * phase * (Tsum / n), n };
}
/** activity after omitted beats, as a function of latency since the last beat that sounded (bins of 20 ms, 0..1.6 s),
 *  from per-frame population counts. Units: spikes per cell per second. Use omissionContrast() to compare two tempi. */
export function omissionResponse(counts, beats, { dt = 0.004, t0 = 0, cells = 1, from = -Infinity, to = Infinity, bin = 0.02, span = 1.6 } = {}) {
  const nb = Math.round(span / bin), lat = new Float64Array(nb), nn = new Float64Array(nb); let n = 0, T = 0;
  for (let k = 1; k < beats.length; k++) {
    const b = beats[k], p = beats[k - 1];
    if (!b.omitted || p.omitted || b.t < from || b.t >= to || p.seg !== b.seg) continue;
    const nx = beats.slice(k + 1).find((x) => !x.omitted), end = nx ? nx.t : b.t + b.period;   // up to the next sound
    for (let j = 0; j < nb; j++) {
      const a0 = p.t + j * bin; if (a0 + bin > end) break;
      const i0 = Math.round((a0 - t0) / dt), i1 = Math.round((a0 + bin - t0) / dt); if (i0 < 0 || i1 > counts.length) continue;
      let c = 0; for (let i = i0; i < i1; i++) c += counts[i]; lat[j] += c / (bin * cells); nn[j]++;
    }
    n++; T += b.t - p.t;
  }
  // the segment's mean rate, so profiles from louder and quieter worlds can be compared
  const i0 = Math.max(0, Math.round((Math.max(from, t0) - t0) / dt)), i1 = Math.min(counts.length, Math.round((Math.min(to, t0 + counts.length * dt) - t0) / dt));
  let c = 0; for (let i = i0; i < i1; i++) c += counts[i]; const mean = i1 > i0 ? c / ((i1 - i0) * dt * cells) : NaN;
  return { n, period: n ? T / n : NaN, bin, mean, lat: Array.from(lat, (x, j) => (nn[j] ? x / nn[j] : NaN)) };
}
/** the omission response: at each omitted beat (expected at T after the last sound), the population rate in
 *  [T - 200, T + 100] ms above the chord between its flanks [T - 350, T - 200] and [T + 100, T + 250] ms. The response to
 *  the last sound decays convexly, so it lies below the chord (bias <= 0: conservative); only activity that marks the
 *  expected time stands above it. Mean, SE and z over omissions (spikes per cell per second). Needs T >= ~0.5 s. */
export function omissionBump(counts, beats, { dt = 0.004, t0 = 0, cells = 1, from = -Infinity, to = Infinity } = {}) {
  const rate = (a, b) => { const i0 = Math.round((a - t0) / dt), i1 = Math.round((b - t0) / dt); if (i0 < 0 || i1 > counts.length || i1 <= i0) return NaN; let s = 0; for (let i = i0; i < i1; i++) s += counts[i]; return s / ((i1 - i0) * dt * cells); };
  const d = [];
  for (let k = 1; k < beats.length; k++) {
    const b = beats[k], p = beats[k - 1]; if (!b.omitted || p.omitted || b.t < from || b.t >= to || p.seg !== b.seg) continue;
    const x = rate(b.t - 0.2, b.t + 0.1) - 0.5 * (rate(b.t - 0.35, b.t - 0.2) + rate(b.t + 0.1, b.t + 0.25));
    if (Number.isFinite(x)) d.push(x);
  }
  const n = d.length, m = d.reduce((s, x) => s + x, 0) / Math.max(1, n), se = n > 1 ? Math.sqrt(d.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1) / n) : NaN;
  return { n, bump: m, se, z: m / (se || Infinity) };
}

// ---- radial organisation --------------------------------------------------------------------------------------------------
const MODALITY = (t) => (t === T.EAR ? 0 : t === T.ONSET ? 1 : t === T.ROUGH ? 2 : t === T.SUB ? 3 : t === T.PROPRIO ? 4 : t === T.INTERO ? 5 : -1);
/** where kinds of cells sit between the nucleus (r = 0) and the skin (r = 1), and whether integration moves inward:
 *  per radial bin, the cell kinds, the mean synaptic hops from the senses and the mean convergence (how many of the six
 *  modalities - ear, onset, roughness, sub-bass, proprioception, interoception - reach the cell within 2 synapses).
 *  corr: Pearson correlations over interneurons of radius with hops and with convergence (negative: deeper = more
 *  integrative). intero: false leaves interoception out (interoceptors sit near the nucleus by their morphogen, so
 *  counting them favours deep cells by construction). */
export function radialProfile(org, { bins = [0, 0.3, 0.45, 0.6, 0.75, 0.9, 1.01], minW = 0.02, intero = true } = {}) {
  const NM = intero ? 6 : 5, MOD = (t) => { const m = MODALITY(t); return !intero && m === 5 ? -1 : m; };
  const d = org.dev, N = d.N, g = graphOf(org), D = depth(org, minW).d;
  const inc = Array.from({ length: N }, () => []);
  for (let k = 0; k < g.m; k++) if (g.w[k] > minW) inc[g.post[k]].push(g.pre[k]);
  const conv = new Float32Array(N), rad = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    rad[i] = Math.hypot(d.pos[3 * i], d.pos[3 * i + 1], d.pos[3 * i + 2]);
    let mask = 0; for (const p of inc[i]) { const m = MOD(d.type[p]); if (m >= 0) mask |= 1 << m; for (const q of inc[p]) { const m2 = MOD(d.type[q]); if (m2 >= 0) mask |= 1 << m2; } }
    let c = 0; for (let b = 0; b < NM; b++) c += (mask >> b) & 1; conv[i] = c / NM;
  }
  const rows = [];
  for (let b = 0; b + 1 < bins.length; b++) {
    const lo = bins[b], hi = bins[b + 1], kinds = {}; let n = 0, h = 0, hn = 0, cv = 0, osc = 0;
    for (let i = 0; i < N; i++) {
      if (rad[i] < lo || rad[i] >= hi) continue; n++; const nm = TYPE_KEY[d.type[i]]; kinds[nm] = (kinds[nm] || 0) + 1;
      if (d.osc && d.osc[2 * i] > 0) osc++;
      if (!isReceptor(d.type[i])) { cv += conv[i]; if (D[i] >= 0) { h += D[i]; hn++; } }
    }
    const nn = n - Object.entries(kinds).filter(([k]) => RECEPTOR_KEYS.has(k)).reduce((s, [, v]) => s + v, 0);
    rows.push({ r: [lo, Math.min(1, hi)], n, kinds, resonators: osc, hops: hn ? h / hn : NaN, convergence: nn ? cv / nn : NaN });
  }
  const pear = (x, y) => { const n = x.length; if (n < 3) return NaN; const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n; let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; } return sxy / Math.sqrt(sxx * syy + 1e-12); };
  const ii = [], ih = []; for (let i = 0; i < N; i++) if (d.type[i] === T.INTER) { ii.push(i); if (D[i] >= 0) ih.push(i); }
  return { rows, corrHops: pear(ih.map((i) => rad[i]), ih.map((i) => D[i])), corrConv: pear(ii.map((i) => rad[i]), ii.map((i) => conv[i])), rad, conv };
}
/** where integration sits. Each interneuron's integration is the share of all receptor cells (hair cells, onset,
 *  roughness, sub-bass, proprioceptors) that reach it within 2 synapses (weight > minW). Returns
 *    offset      distance from the nucleus of the integration-weighted centroid of interneurons (0: the hub is centred;
 *                ~0.5+: it sits on one side); hearOffset: the same with integration counted over hearing receptors only
 *                (hair cells, onset, roughness); wireOffset: the synapses' weight-weighted centroid (at their targets)
 *    rInt        integration-weighted mean radius, against rInter (the plain mean radius of interneurons)
 *    corrRadInt  Pearson correlation of radius with integration over interneurons (negative: deeper cells integrate more)
 *    earOffset   distance from the nucleus of the hair cells' centroid (a one-sided ear: ~0.9; the whole skin: ~0)
 *    areas       Louvain communities with >= 10 non-receptor cells: size, centroid offset, mean radius, mean integration;
 *                the most integrative one is the hub area (areaOffset, areaRadius)
 *    arbor       mean axon arbor length of network cells (network.mjs), rows: mean integration per radial bin */
export function hubProfile(org, { minW = 0.02, bins = [0, 0.3, 0.45, 0.6, 0.75, 0.9, 1.01] } = {}) {
  const d = org.dev, N = d.N, g = graphOf(org), inc = Array.from({ length: N }, () => []);
  for (let k = 0; k < g.m; k++) if (g.w[k] > minW) inc[g.post[k]].push(g.pre[k]);
  let nRec = 0; for (let i = 0; i < N; i++) if (isReceptor(d.type[i])) nRec++;
  const P = d.pos, rad = (i) => Math.hypot(P[3 * i], P[3 * i + 1], P[3 * i + 2]);
  const hear = (t) => t === T.EAR || t === T.ONSET || t === T.ROUGH;
  let nHear = 0; for (let i = 0; i < N; i++) if (hear(d.type[i])) nHear++;
  const integ = new Float32Array(N), integH = new Float32Array(N), seen = new Int32Array(N).fill(-1);
  for (let i = 0; i < N; i++) {
    if (isReceptor(d.type[i]) || d.type[i] === T.MOTOR || d.type[i] === T.CHROM) continue;
    let c = 0, h = 0; const mark = (q) => { if (isReceptor(d.type[q]) && seen[q] !== i) { seen[q] = i; c++; if (hear(d.type[q])) h++; } };
    for (const p of inc[i]) { mark(p); for (const q of inc[p]) mark(q); }
    integ[i] = c / Math.max(1, nRec); integH[i] = h / Math.max(1, nHear);
  }
  const inter = []; for (let i = 0; i < N; i++) if (d.type[i] === T.INTER) inter.push(i);
  let sw = 0, cx = 0, cy = 0, cz = 0, rw = 0, rm = 0, hw = 0, hx = 0, hy = 0, hz = 0;
  for (const i of inter) { const w = integ[i], v = integH[i]; sw += w; cx += w * P[3 * i]; cy += w * P[3 * i + 1]; cz += w * P[3 * i + 2]; rw += w * rad(i); rm += rad(i); hw += v; hx += v * P[3 * i]; hy += v * P[3 * i + 1]; hz += v * P[3 * i + 2]; }
  // the wiring's centre of mass: synapses at their postsynaptic cell, by weight
  let ww = 0, wx = 0, wy = 0, wz = 0; for (let k = 0; k < g.m; k++) { const j = g.post[k], w = g.w[k]; ww += w; wx += w * P[3 * j]; wy += w * P[3 * j + 1]; wz += w * P[3 * j + 2]; }
  let ex = 0, ey = 0, ez = 0, ne = 0; for (let i = 0; i < N; i++) if (d.type[i] === T.EAR) { ex += P[3 * i]; ey += P[3 * i + 1]; ez += P[3 * i + 2]; ne++; }
  const pear = (x, y) => { const n = x.length; if (n < 3) return NaN; const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n; let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; } return sxy / Math.sqrt(sxx * syy + 1e-12); };
  const rows = [];
  for (let b = 0; b + 1 < bins.length; b++) { let s = 0, n = 0; for (const i of inter) { const r = rad(i); if (r >= bins[b] && r < bins[b + 1]) { s += integ[i]; n++; } } rows.push({ r: [bins[b], Math.min(1, bins[b + 1])], n, integration: n ? s / n : NaN }); }
  // areas
  const L = louvain(g, minW), byC = new Map();
  for (let i = 0; i < N; i++) { if (isReceptor(d.type[i])) continue; const c = L.member[i]; if (!byC.has(c)) byC.set(c, []); byC.get(c).push(i); }
  const areas = [...byC.values()].filter((l) => l.length >= 10).map((l) => {
    let x = 0, y = 0, z = 0, r = 0, s = 0; for (const i of l) { x += P[3 * i]; y += P[3 * i + 1]; z += P[3 * i + 2]; r += rad(i); s += integ[i]; }
    const n = l.length; return { n, offset: Math.hypot(x / n, y / n, z / n), radius: r / n, integration: s / n };
  }).sort((a, b) => b.integration - a.integration);
  let arb = 0, na = 0; if (org.net.arbor) for (let i = 0; i < N; i++) if (!isReceptor(d.type[i]) && d.type[i] !== T.MOTOR && d.type[i] !== T.CHROM) { arb += org.net.arbor[i]; na++; }
  return { offset: sw > 0 ? Math.hypot(cx, cy, cz) / sw : NaN, hearOffset: hw > 0 ? Math.hypot(hx, hy, hz) / hw : NaN, wireOffset: ww > 0 ? Math.hypot(wx, wy, wz) / ww : NaN, rInt: sw > 0 ? rw / sw : NaN, rInter: rm / Math.max(1, inter.length), corrRadInt: pear(inter.map(rad), inter.map((i) => integ[i])),
    nReach: inter.reduce((s, i) => s + integ[i], 0) / Math.max(1, inter.length), earOffset: ne ? Math.hypot(ex, ey, ez) / ne : NaN,
    areas, areaOffset: areas.length ? areas[0].offset : NaN, areaRadius: areas.length ? areas[0].radius : NaN, arbor: na ? arb / na : NaN, rows };
}
const TYPE_KEY = ['ear', 'onset', 'rough', 'sub', 'proprio', 'inter', 'intero', 'mod', 'motor', 'chrom'];
const RECEPTOR_KEYS = new Set(['ear', 'onset', 'rough', 'sub', 'proprio']);
