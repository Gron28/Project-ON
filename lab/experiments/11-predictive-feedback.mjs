// Experiment 11 (E12 in the notebook) - does predictable feedback wear paths into the tissue? (Kagan et al. 2022, "DishBrain")
//
// Three sheets with Hebbian plasticity hear the same music-like drive. On each beat one gets the same stamp of cells
// (predictable feedback: what the page sends when it predicted a drum hit), one gets as many cells at random (noise:
// a hit that surprised it), one gets nothing. Then each is probed with the stamp alone, many times, in quiet.
//
// Expected if the loop shapes the tissue: after predictable feedback the stamp's links are stronger and its evoked response
// larger than after noise or nothing; noise leaves no such structure. Measured (plastic 0.05, 120 s): stamp links 0.66 vs
// 0.53 / 0.53, evoked +30% (33 vs 27 / 25 cells); trial-to-trial reproducibility did not measurably change.
//
//   node lab/experiments/11-predictive-feedback.mjs [trainSeconds=120] [plastic=0.05]  ->  lab/results/11-predictive-feedback.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTissue, TW, TH } from '../../being/tissue.mjs';
import { mulberry32 } from '../../being/mind.mjs';

const TRAIN = +process.argv[2] || 120, PLASTIC = process.argv[3] !== undefined ? +process.argv[3] : 0.05;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const NT = TW * TH, STEP = 0.004, BEAT = 0.5;

function run(cond, seed = 7) {
  const rng = mulberry32(seed), t = createTissue({ rng, seed: 99, plastic: PLASTIC });
  const drive = new Float64Array(28);
  // training: a music-like drive (bands swell and fall) with a stimulus on every beat
  const steps = Math.round(TRAIN / STEP), perBeat = Math.round(BEAT / STEP);
  for (let s = 0; s < steps; s++) {
    for (let k = 0; k < 28; k++) drive[k] = 0.0015 * (1 + Math.sin(s * STEP * (0.7 + 0.13 * k) + k)) * (s % perBeat < 20 ? 2 : 1);
    if (s % perBeat === 0) { if (cond === 'pattern') t.pattern(0, 1); else if (cond === 'noise') t.noise(1); }
    t.step(drive);
  }
  // probe: the stamp on each beat while the music goes on. Evoked: firings among the stamp's neighbours in the 12 ms after
  // it, minus the same window half a beat later (no stamp). Reproducibility: correlation of those neighbourhood maps.
  const near = new Set(); for (const i of t.stamps[0]) for (let e = 0; e < 10; e++) near.add(t.neighbours[i * 10 + e]);
  for (const i of t.stamps[0]) near.delete(i);
  const idx = [...near], maps = []; let ev = 0, base = 0, s0 = steps;
  for (let trial = 0; trial < 40; trial++) {
    const m = new Float32Array(idx.length);
    for (let s = 0; s < perBeat; s++, s0++) {
      for (let k = 0; k < 28; k++) drive[k] = 0.0015 * (1 + Math.sin(s0 * STEP * (0.7 + 0.13 * k) + k)) * (s < 20 ? 2 : 1);
      if (s === 0) t.pattern(0, 1);
      t.step(drive); const tex = t.render().tex;
      const fired = (j) => tex[j * 4 + 1] > 130;
      if (s >= 1 && s <= 3) idx.forEach((j, q) => { if (fired(j)) { m[q]++; ev++; } });
      if (s >= 63 && s <= 65) for (const j of idx) if (fired(j)) base++;
    }
    maps.push(m);
  }
  const corr = (a, b) => { const n = a.length; let ma = 0, mb = 0; for (let j = 0; j < n; j++) { ma += a[j]; mb += b[j]; } ma /= n; mb /= n;
    let sab = 0, saa = 0, sbb = 0; for (let j = 0; j < n; j++) { const x = a[j] - ma, y = b[j] - mb; sab += x * y; saa += x * x; sbb += y * y; } return sab / Math.sqrt(saa * sbb + 1e-12); };
  let cs = 0, cn = 0; for (let i = 0; i < maps.length; i++) for (let j = i + 1; j < maps.length; j++) { cs += corr(maps[i], maps[j]); cn++; }
  let w = 0, ws = 0; for (let k = 0; k < t.weights.length; k++) w += t.weights[k];
  for (const i of t.stamps[0]) for (let e = 0; e < 10; e++) ws += t.weights[i * 10 + e];
  return { cond, evoked: +((ev - base) / 40).toFixed(2), reproducibility: +(cs / cn).toFixed(3), stampWeight: +(ws / (t.stamps[0].length * 10)).toFixed(3), meanWeight: +(w / t.weights.length).toFixed(3), sigma: +t.sigma.toFixed(3) };
}

const out = { train: TRAIN, plastic: PLASTIC, results: ['pattern', 'noise', 'none'].map((c) => run(c)) };
console.table(out.results);
fs.mkdirSync(path.join(ROOT, 'lab', 'results'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'lab', 'results', '11-predictive-feedback.json'), JSON.stringify(out, null, 2));
