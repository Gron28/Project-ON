// Experiment 01 - the anatomy of hearing in the fly connectome, as reusable building-block statistics.
//
// Question: if we keep only the parts of a real brain that sense vibration and the first relays after
// them, what does that circuit look like in numbers? Those numbers (layer sizes, fan-in/fan-out,
// excitation/inhibition mix, weight distribution, reciprocity, recurrence, how fast it spreads) are
// what we would reuse to grow an alien circuit that is not the fly's.
//
//   node lab/experiments/01-auditory-anatomy.mjs   ->  lab/results/01-auditory-anatomy.json + printed summary
//
// Data: FlyWire FAFB v783 compiled into data/brain.bin by tools/compile-connectome.mjs (CC BY-NC 4.0).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBrain } from '../../brain/lif.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brain.json'), 'utf8'));
const buf = fs.readFileSync(path.join(ROOT, 'data', 'brain.bin'));
const B = parseBrain(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), meta);
const { N, rowPtr, col, w, sign, nt, cls } = B;
const T = meta.types;
const NT = meta.nt, SUP = meta.superClass;

// ---- reverse adjacency (incoming) -------------------------------------------------------------
const inDeg = new Uint32Array(N + 1);
for (let e = 0; e < col.length; e++) inDeg[col[e] + 1]++;
for (let i = 0; i < N; i++) inDeg[i + 1] += inDeg[i];
const inPtr = inDeg.slice();
const inSrc = new Uint32Array(col.length), inW = new Int16Array(col.length);
{ const fill = inPtr.slice(0, N); for (let i = 0; i < N; i++) for (let e = rowPtr[i]; e < rowPtr[i + 1]; e++) { const p = col[e], k = fill[p]++; inSrc[k] = i; inW[k] = w[e]; } }
const outSyn = (i) => { let s = 0; for (let e = rowPtr[i]; e < rowPtr[i + 1]; e++) s += Math.abs(w[e]); return s; };
const inSyn = (i) => { let s = 0; for (let k = inPtr[i]; k < inPtr[i + 1]; k++) s += Math.abs(inW[k]); return s; };

// ---- 1. layers by synaptic distance from the ear --------------------------------------------------
// A neuron belongs to layer k if its strongest path from the sound-sensing JONs (JO-A, JO-B, JO-D) is k hops,
// counting only connections with >= MIN_SYN synapses and requiring that >= MIN_FRAC of its input synapses come from
// the layers before it (so a neuron that merely receives one stray synapse from the ear is not "auditory").
const MIN_SYN = 5, MIN_FRAC = 0.05, MAX_HOP = 4;
const sound = [...B.groups['JO-A'], ...B.groups['JO-B'], ...B.groups['JO-D']];
const wind = [...B.groups['JO-C'], ...B.groups['JO-E']];
const layer = new Int8Array(N).fill(-1);
for (const i of sound) layer[i] = 0;
const layers = [sound];
for (let h = 1; h <= MAX_HOP; h++) {
  const cand = new Map(); // neuron -> synapses from earlier layers
  for (const i of layers[h - 1]) for (let e = rowPtr[i]; e < rowPtr[i + 1]; e++) {
    const p = col[e], s = Math.abs(w[e]);
    if (layer[p] >= 0 || s < MIN_SYN) continue;
    cand.set(p, (cand.get(p) || 0) + s);
  }
  const next = [];
  for (const [p] of cand) {
    // input from ALL earlier auditory layers, as a share of the neuron's total input
    let fromAud = 0;
    for (let k = inPtr[p]; k < inPtr[p + 1]; k++) if (layer[inSrc[k]] >= 0) fromAud += Math.abs(inW[k]);
    const tot = inSyn(p);
    if (tot > 0 && fromAud / tot >= MIN_FRAC) next.push(p);
  }
  for (const p of next) layer[p] = h;
  layers.push(next);
}

const pct = (a, q) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const countBy = (arr, f) => { const m = {}; for (const x of arr) { const k = f(x); m[k] = (m[k] || 0) + 1; } return Object.entries(m).sort((a, b) => b[1] - a[1]); };
const typeName = (i) => T[i] || '(untyped)';
const family = (i) => { const t = typeName(i); const m = t.match(/^[A-Za-z]+[-_]?[A-Za-z]*/); return m ? m[0] : t; };

const layerStats = layers.map((L, h) => {
  const outs = L.map(outSyn), ins = L.map(inSyn), fanOut = L.map((i) => rowPtr[i + 1] - rowPtr[i]), fanIn = L.map((i) => inPtr[i + 1] - inPtr[i]);
  return {
    hop: h, neurons: L.length,
    inhibitoryShare: +(L.filter((i) => sign[i] < 0).length / Math.max(1, L.length)).toFixed(3),
    transmitters: countBy(L, (i) => NT[nt[i]]).slice(0, 6),
    superClass: countBy(L, (i) => SUP[cls[i]]).slice(0, 6),
    topFamilies: countBy(L, family).slice(0, 12),
    fanOutMedian: pct(fanOut, 0.5), fanInMedian: pct(fanIn, 0.5),
    outSynapsesMedian: pct(outs, 0.5), inSynapsesMedian: pct(ins, 0.5),
  };
});

// ---- 2. the auditory core: all neurons within 2 hops, as a subgraph --------------------------------
const core = new Uint8Array(N);
for (let h = 0; h <= 2; h++) for (const i of layers[h]) core[i] = 1;
const coreIds = []; for (let i = 0; i < N; i++) if (core[i]) coreIds.push(i);
const edges = []; // within the core
for (const i of coreIds) for (let e = rowPtr[i]; e < rowPtr[i + 1]; e++) if (core[col[e]]) edges.push([i, col[e], w[e]]);
const weights = edges.map((x) => Math.abs(x[2]));
const logs = weights.map(Math.log);
const mu = mean(logs), sd = Math.sqrt(mean(logs.map((x) => (x - mu) ** 2)));
// reciprocity: share of edges whose reverse also exists
const edgeSet = new Set(edges.map(([a, b]) => a * 200000 + b));
const recip = edges.filter(([a, b]) => edgeSet.has(b * 200000 + a)).length / Math.max(1, edges.length);
// density and the reciprocity expected at random for this density
const n = coreIds.length, density = edges.length / (n * (n - 1));
// feedforward vs backward: share of synapses going to an earlier or same layer (recurrence)
let fw = 0, same = 0, back = 0;
for (const [a, b, ww] of edges) { const s = Math.abs(ww); if (layer[b] > layer[a]) fw += s; else if (layer[b] === layer[a]) same += s; else back += s; }
const tot = fw + same + back;
// triangle motifs among the core (sampled): fraction of connected pairs (a->b) with a common target c (a->c and b->c): "convergence"
const outsets = new Map(coreIds.map((i) => [i, new Set()]));
for (const [a, b] of edges) outsets.get(a).add(b);
let pairs = 0, conv = 0;
for (const [a, b] of edges.slice(0, 20000)) { pairs++; const A = outsets.get(a), Bs = outsets.get(b); let c = 0; for (const x of Bs) if (A.has(x)) { c = 1; break; } conv += c; }
// excitatory -> inhibitory -> excitatory loops (feedback inhibition) through the core
let eie = 0;
for (const [a, b] of edges.slice(0, 50000)) if (sign[a] > 0 && sign[b] < 0) { for (const x of outsets.get(b)) if (outsets.get(x) && outsets.get(x).has(b)) { eie++; break; } }
// left/right: how much crosses the midline at each stage
let ipsi = 0, contra = 0;
for (const [a, b, ww] of edges) { if (!B.side[a] || !B.side[b]) continue; if (B.side[a] === B.side[b]) ipsi += Math.abs(ww); else contra += Math.abs(ww); }

const coreStats = {
  neurons: n, connections: edges.length, density: +density.toExponential(3),
  weightSynapses: { median: pct(weights, 0.5), p90: pct(weights, 0.9), p99: pct(weights, 0.99), max: Math.max(...weights), logMean: +mu.toFixed(3), logSd: +sd.toFixed(3) },
  reciprocity: +recip.toFixed(4), reciprocityIfRandom: +density.toExponential(3),
  synapseFlow: { forward: +(fw / tot).toFixed(3), withinLayer: +(same / tot).toFixed(3), backward: +(back / tot).toFixed(3) },
  convergenceShare: +(conv / Math.max(1, pairs)).toFixed(3),
  midline: { ipsilateral: +(ipsi / (ipsi + contra)).toFixed(3), contralateral: +(contra / (ipsi + contra)).toFixed(3) },
  feedbackInhibitionLoopsInSample: eie,
};

// ---- 3. wind/gravity vs sound: do they share relays? ------------------------------------------------
const targetsOf = (ids) => { const s = new Set(); for (const i of ids) for (let e = rowPtr[i]; e < rowPtr[i + 1]; e++) if (Math.abs(w[e]) >= MIN_SYN) s.add(col[e]); return s; };
const tS = targetsOf(sound), tW = targetsOf(wind);
let shared = 0; for (const x of tS) if (tW.has(x)) shared++;
const sharing = { soundTargets: tS.size, windTargets: tW.size, shared, jaccard: +(shared / (tS.size + tW.size - shared)).toFixed(3) };

// ---- 4. where does hearing go: the share of all brain neurons within k hops (ignoring the 5% rule) ----
const reach = [];
{ const seen = new Uint8Array(N); let frontier = sound.slice(); for (const i of frontier) seen[i] = 1; let total = frontier.length;
  for (let h = 1; h <= 6; h++) { const nx = []; for (const i of frontier) for (let e = rowPtr[i]; e < rowPtr[i + 1]; e++) { const p = col[e]; if (!seen[p] && Math.abs(w[e]) >= MIN_SYN) { seen[p] = 1; nx.push(p); } } total += nx.length; reach.push({ hop: h, newNeurons: nx.length, cumulativeShare: +(total / N).toFixed(3) }); frontier = nx; } }

// ---- 5. the "giant" hubs of hearing: neurons with the most auditory input -----------------------------
const hub = [];
for (let h = 1; h <= 2; h++) for (const p of layers[h]) { let a = 0; for (let k = inPtr[p]; k < inPtr[p + 1]; k++) if (layer[inSrc[k]] >= 0 && layer[inSrc[k]] < layer[p]) a += Math.abs(inW[k]); hub.push([a, p]); }
hub.sort((x, y) => y[0] - x[0]);
const hubs = hub.slice(0, 20).map(([a, p]) => ({ type: typeName(p), hop: layer[p], auditorySynapsesIn: a, nt: NT[nt[p]], class: SUP[cls[p]], fanOut: rowPtr[p + 1] - rowPtr[p] }));

const result = { question: 'anatomy of the fly auditory circuit as building-block statistics', params: { MIN_SYN, MIN_FRAC, MAX_HOP }, layers: layerStats, core: coreStats, soundVsWind: sharing, reach, hubs };
fs.mkdirSync(path.join(ROOT, 'lab', 'results'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'lab', 'results', '01-auditory-anatomy.json'), JSON.stringify(result, null, 2));
// the layer membership itself, for later experiments
fs.writeFileSync(path.join(ROOT, 'lab', 'results', '01-layers.json'), JSON.stringify(layers.map((L) => Array.from(L))));

// ---- summary ----------------------------------------------------------------------------------
console.log('LAYERS (hop from the sound-sensing JONs)');
for (const L of layerStats) console.log(`  hop ${L.hop}: ${L.neurons} neurons | inhibitory ${(L.inhibitoryShare * 100).toFixed(0)}% | fan-in ${L.fanInMedian} fan-out ${L.fanOutMedian} | in-syn ${L.inSynapsesMedian} out-syn ${L.outSynapsesMedian} | ${L.transmitters.map(([k, v]) => `${k}:${v}`).join(' ')}\n         families: ${L.topFamilies.map(([k, v]) => `${k}:${v}`).join(' ')}`);
console.log('CORE (hops 0-2)', JSON.stringify(coreStats));
console.log('SOUND vs WIND relays', JSON.stringify(sharing));
console.log('REACH', reach.map((r) => `${r.hop}:${(r.cumulativeShare * 100).toFixed(1)}%`).join(' '));
console.log('HUBS', hubs.slice(0, 12).map((h) => `${h.type}(hop${h.hop},${h.nt},in ${h.auditorySynapsesIn},out ${h.fanOut})`).join(' | '));
