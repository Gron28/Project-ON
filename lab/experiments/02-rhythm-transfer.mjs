// Experiment 02 - which rhythms does the primal auditory circuit follow?
//
// Drive the sound-sensing Johnston's organ neurons with a sinusoidally amplitude-modulated rate (a tone that
// swells and fades f times per second), simulate the whole brain with the Shiu et al. 2024 LIF model, and
// measure, per auditory layer, how strongly spikes lock to the modulation:
//   vector strength VS = |sum exp(i 2 pi f t_spike)| / n_spikes   (1 = every spike at the same phase, 0 = no locking)
//   gain = modulation depth of the layer's population rate at f, relative to the input's depth
// The same for click trains at musical tempos (a 10 ms burst per beat).
// The modulation transfer function (MTF) this produces is the circuit's innate rhythmic tuning: what it "feels" before
// any learning. Vertebrate brainstem/midbrain neurons are tuned to roughly 2-100 Hz amplitude modulation; this asks
// the same of the fly.
//
//   node lab/experiments/02-rhythm-transfer.mjs [earGain=3]   ->  lab/results/02-rhythm-transfer-g<gain>.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBrain, FlyBrain } from '../../brain/lif.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brain.json'), 'utf8'));
const buf = fs.readFileSync(path.join(ROOT, 'data', 'brain.bin'));
const B = parseBrain(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), meta);
const layers = JSON.parse(fs.readFileSync(path.join(ROOT, 'lab', 'results', '01-layers.json'), 'utf8'));
const earGain = +(process.argv[2] || 3);
const DT = 0.5, SETTLE_MS = 600, MEASURE_MS = 4000;

const layerOf = new Int8Array(B.N).fill(-1);
layers.forEach((L, h) => { for (const i of L) layerOf[i] = h; });
const ear = Uint32Array.from(layers[0]);
const NL = layers.length;

function makeFly() {
  const fly = new FlyBrain(B, { dt: DT, seed: 7 });
  if (earGain !== 1) for (const i of ear) for (let e = B.rowPtr[i]; e < B.rowPtr[i + 1]; e++) fly.wmv[e] *= earGain;
  return fly;
}

/** rateAt(tMs) -> Hz for every ear neuron; returns per-layer VS and modulation gain at frequency f */
function run(rateAt, f, label) {
  const fly = makeFly();
  const rates = new Float32Array(ear.length);
  fly.setDrive(ear, rates);
  const binMs = 5, nBins = MEASURE_MS / binMs;
  const hist = Array.from({ length: NL }, () => new Float32Array(nBins));
  const vsRe = new Float64Array(NL), vsIm = new Float64Array(NL), cnt = new Float64Array(NL);
  const inHist = new Float32Array(nBins);
  const steps = Math.round((SETTLE_MS + MEASURE_MS) / DT);
  for (let s = 0; s < steps; s++) {
    const t = s * DT;
    const r = rateAt(t);
    rates.fill(r);
    fly.tick();
    const sp = fly.takeSpikes();
    if (t < SETTLE_MS) continue;
    const tm = t - SETTLE_MS, b = Math.min(nBins - 1, (tm / binMs) | 0);
    inHist[b] += r * DT / binMs;
    const ph = 2 * Math.PI * f * (t / 1000), c = Math.cos(ph), sn = Math.sin(ph);
    for (let k = 0; k < sp.length; k++) {
      const h = layerOf[sp[k]]; if (h < 0) continue;
      hist[h][b]++; vsRe[h] += c; vsIm[h] += sn; cnt[h]++;
    }
  }
  // modulation depth at f of a binned signal: 2|DFT(f)| / mean
  const depth = (x) => {
    let re = 0, im = 0, m = 0;
    for (let i = 0; i < x.length; i++) { const ph = 2 * Math.PI * f * (i * binMs / 1000); re += x[i] * Math.cos(ph); im += x[i] * Math.sin(ph); m += x[i]; }
    return m > 0 ? (2 * Math.hypot(re, im)) / m : 0;
  };
  const inDepth = depth(inHist);
  const out = { label, f, layers: [] };
  for (let h = 0; h < NL; h++) {
    const n = cnt[h], seconds = MEASURE_MS / 1000, rate = n / Math.max(1, layers[h].length) / seconds;
    out.layers.push({ hop: h, hz: +rate.toFixed(2), vs: n > 20 ? +(Math.hypot(vsRe[h], vsIm[h]) / n).toFixed(3) : null, gain: n > 20 ? +(depth(hist[h]) / Math.max(1e-6, inDepth)).toFixed(3) : null });
  }
  return out;
}

const BASE = 40, DEPTH = 35; // Hz: JON rate swings between 5 and 75 Hz
const am = (f) => (t) => BASE + DEPTH * Math.sin(2 * Math.PI * f * t / 1000);
const clicks = (bpm) => { const period = 60000 / bpm; return (t) => ((t % period) < 10 ? 180 : 4); };

const results = { earGain, model: 'Shiu 2024 LIF, whole FlyWire v783 brain', am: [], clicks: [] };
const t0 = Date.now();
for (const f of [0.5, 1, 2, 4, 8, 16, 32, 64]) {
  const r = run(am(f), f, `AM ${f} Hz`); results.am.push(r);
  console.log(`AM ${String(f).padStart(4)} Hz | ` + r.layers.map((L) => `hop${L.hop} ${L.hz.toFixed(1)}Hz VS ${L.vs ?? '-'} G ${L.gain ?? '-'}`).join(' | '));
}
for (const bpm of [60, 90, 120, 150, 180, 240]) {
  const r = run(clicks(bpm), bpm / 60, `clicks ${bpm} bpm`); results.clicks.push(r);
  console.log(`${String(bpm).padStart(3)} bpm  | ` + r.layers.map((L) => `hop${L.hop} ${L.hz.toFixed(1)}Hz VS ${L.vs ?? '-'} G ${L.gain ?? '-'}`).join(' | '));
}
fs.writeFileSync(path.join(ROOT, 'lab', 'results', `02-rhythm-transfer-g${earGain}.json`), JSON.stringify(results, null, 2));
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
