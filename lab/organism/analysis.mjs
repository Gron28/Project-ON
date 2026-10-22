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
