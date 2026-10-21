// Experiment 03 - is the primal auditory circuit near criticality?
//
// Critical networks (branching ratio sigma ~ 1, avalanche sizes power-law distributed with exponent ~ -1.5;
// Beggs & Plenz 2003) have the widest dynamic range (Kinouchi & Copelli 2006). A sensing being should want that.
// Here: drive the ear with steady Poisson input at several levels, record spikes of the non-ear auditory
// layers (hops 1-4 from experiment 01), bin them at the mean inter-event interval, and measure
//   sigma   = mean over bins of (spikes in next bin / spikes in this bin), for bins with spikes
//   avalanches = runs of non-empty bins bounded by empty ones; size distribution and a log-log slope estimate
//   dynamic range = 10 log10(S90 / S10) over input levels, using the population response (Kinouchi & Copelli)
// for the published synapse scale (wScale 1) and scaled-up versions (stronger coupling pushes towards criticality).
//
//   node lab/experiments/03-criticality.mjs   ->  lab/results/03-criticality.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBrain, FlyBrain } from '../../brain/lif.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brain.json'), 'utf8'));
const buf = fs.readFileSync(path.join(ROOT, 'data', 'brain.bin'));
const B = parseBrain(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), meta);
const layers = JSON.parse(fs.readFileSync(path.join(ROOT, 'lab', 'results', '01-layers.json'), 'utf8'));
const ear = Uint32Array.from(layers[0]);
const inCore = new Uint8Array(B.N);
for (let h = 1; h < layers.length; h++) for (const i of layers[h]) inCore[i] = 1;
const nCore = layers.slice(1).reduce((s, L) => s + L.length, 0);
const DT = 0.5, EAR_GAIN = 3;

function measure(wScale, earHz, ms = 6000) {
  const fly = new FlyBrain(B, { dt: DT, seed: 11, wScale });
  for (const i of ear) for (let e = B.rowPtr[i]; e < B.rowPtr[i + 1]; e++) fly.wmv[e] *= EAR_GAIN;
  fly.setDrive(ear, new Float32Array(ear.length).fill(earHz));
  fly.run(500);
  fly.takeSpikes();
  const counts = [];
  const steps = Math.round(ms / DT);
  let c = 0;
  for (let s = 0; s < steps; s++) {
    fly.tick();
    const sp = fly.takeSpikes();
    for (let k = 0; k < sp.length; k++) if (inCore[sp[k]]) c++;
    counts.push(c); c = 0;
  }
  const total = counts.reduce((a, b) => a + b, 0);
  const rate = total / nCore / (ms / 1000);
  // bin width = mean inter-event interval of the pooled core activity (at least one step)
  const iei = total > 0 ? ms / total : ms;
  const binSteps = Math.max(1, Math.round(iei / DT));
  const bins = [];
  for (let i = 0; i + binSteps <= counts.length; i += binSteps) { let s = 0; for (let j = 0; j < binSteps; j++) s += counts[i + j]; bins.push(s); }
  let sr = 0, sn = 0;
  for (let i = 0; i + 1 < bins.length; i++) if (bins[i] > 0) { sr += bins[i + 1] / bins[i]; sn++; }
  const sizes = []; let cur = 0;
  for (const b of bins) { if (b > 0) cur += b; else if (cur > 0) { sizes.push(cur); cur = 0; } }
  // log-log slope of the avalanche size distribution over logarithmic bins (rough; only meaningful with many avalanches)
  let slope = null;
  if (sizes.length > 50) {
    const max = Math.max(...sizes), edges = []; for (let e = 1; e <= max * 2; e *= 1.6) edges.push(e);
    const pts = [];
    for (let k = 0; k + 1 < edges.length; k++) { const n = sizes.filter((x) => x >= edges[k] && x < edges[k + 1]).length; if (n > 2) pts.push([Math.log(Math.sqrt(edges[k] * edges[k + 1])), Math.log(n / (edges[k + 1] - edges[k]) / sizes.length)]); }
    if (pts.length >= 4) { const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length, my = pts.reduce((a, p) => a + p[1], 0) / pts.length; let num = 0, den = 0; for (const [x, y] of pts) { num += (x - mx) * (y - my); den += (x - mx) ** 2; } slope = +(num / den).toFixed(2); }
  }
  return { wScale, earHz, coreRateHz: +rate.toFixed(3), binMs: binSteps * DT, sigma: sn ? +(sr / sn).toFixed(3) : null, avalanches: sizes.length, meanSize: sizes.length ? +(sizes.reduce((a, b) => a + b, 0) / sizes.length).toFixed(1) : 0, maxSize: sizes.length ? Math.max(...sizes) : 0, sizeSlope: slope };
}

const out = { nCore, earGain: EAR_GAIN, runs: [], dynamicRange: [] };
const t0 = Date.now();
for (const wScale of [1, 1.5, 2, 3]) {
  const resp = [];
  for (const hz of [2, 5, 10, 20, 40, 80, 160]) {
    const r = measure(wScale, hz, hz <= 5 ? 8000 : 4000);
    out.runs.push(r); resp.push([hz, r.coreRateHz]);
    console.log(`w x${wScale} ear ${String(hz).padStart(3)} Hz | core ${r.coreRateHz} Hz | sigma ${r.sigma} | avalanches ${r.avalanches} mean ${r.meanSize} max ${r.maxSize} slope ${r.sizeSlope}`);
    if (r.coreRateHz > 40) break; // runaway
  }
  // dynamic range (Kinouchi & Copelli): input range that maps to 10%..90% of the response range
  const F = resp.map((x) => x[1]), f0 = Math.min(...F), f1 = Math.max(...F);
  const at = (q) => { const y = f0 + q * (f1 - f0); for (let i = 0; i + 1 < resp.length; i++) { const [x0, a] = resp[i], [x1, b] = resp[i + 1]; if ((a - y) * (b - y) <= 0 && a !== b) return Math.exp(Math.log(x0) + (Math.log(x1) - Math.log(x0)) * (y - a) / (b - a)); } return null; };
  const s10 = at(0.1), s90 = at(0.9);
  const dr = s10 && s90 ? +(10 * Math.log10(s90 / s10)).toFixed(1) : null;
  out.dynamicRange.push({ wScale, dB: dr, response: resp });
  console.log(`   dynamic range x${wScale}: ${dr} dB`);
}
fs.writeFileSync(path.join(ROOT, 'lab', 'results', '03-criticality.json'), JSON.stringify(out, null, 2));
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
