// Experiment 10 (E11 in the notebook) - do two beings with the same seed diverge when they listen to different music?
//
// Notebook section 6, "Individuality": two beings, same songs -> genome decodable; beings diverge over weeks. Here the
// seed is the same and the diets differ. The mind's slow integrators (mind.mjs: f0 follows the tempo it grooves to, sStar the
// syncopation it enjoys) have time constants of 11 and 20 minutes, so half an hour of listening already shows how far each
// trait can move, and which ones cannot move at all.
//
//   node lab/experiments/10-individuality.mjs <slow|fast> [minutes=30] [seed=42]   ->  lab/results/10-individuality-<diet>.json
// run both diets, then compare:  node lab/experiments/10-individuality.mjs compare

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'), OUT = (d) => path.join(ROOT, 'lab', 'results', `10-individuality-${d}.json`);
const diet = process.argv[2];

if (diet === 'compare') {
  const a = JSON.parse(fs.readFileSync(OUT('slow'), 'utf8')), b = JSON.parse(fs.readFileSync(OUT('fast'), 'utf8')), rel = (x, y) => ((y - x) / ((x + y) / 2 || 1)) * 100;
  const rows = {};
  for (const k of Object.keys(a.final.traits)) rows[k] = { slow: a.final.traits[k], fast: b.final.traits[k], start: a.start.traits[k], moved: Math.abs(a.final.traits[k] - a.start.traits[k]) + Math.abs(b.final.traits[k] - b.start.traits[k]) > 1e-9, 'diff %': +rel(a.final.traits[k], b.final.traits[k]).toFixed(1) };
  console.table(rows);
  console.log('the traits that move:', Object.keys(rows).filter((k) => rows[k].moved).join(', ') || 'none', '| fixed for life:', Object.keys(rows).filter((k) => !rows[k].moved).join(', '));
  console.log('mood', a.final.mood.toFixed(2), 'vs', b.final.mood.toFixed(2), '| life', JSON.stringify(a.final.life), 'vs', JSON.stringify(b.final.life));
  process.exit(0);
}
if (!['slow', 'fast'].includes(diet)) { console.error('usage: 10-individuality.mjs <slow|fast|compare> [minutes] [seed]'); process.exit(1); }

const MIN = +process.argv[3] || 30, SEED = +process.argv[4] || 42;
const msgs = [];
globalThis.self = { postMessage: (m) => { if (m.type === 'ear') msgs.push(m); } };
await import('../../being/worker.mjs');
const { createMind, traitsFor } = await import('../../being/mind.mjs');
const CF = Float64Array.from({ length: 28 }, (_, k) => 55 * 2 ** (k / 4));
const mind = createMind(traitsFor(SEED), { earCF: CF });
const snap = () => { const s = mind.serialize(); return { traits: s.traits, mood: s.mood, energy: s.energy, life: s.life }; };
const start = snap();

// the diets: slow = a sparse 92 bpm kick under a chord (little syncopation); fast = 168 bpm with an extra off-beat kick, snare-like noise on 2 and 4 and
// running off-beat hats (a lot of syncopation)
let seedN = 1; const rnd = () => { seedN = (Math.imul(seedN, 1664525) + 1013904223) | 0; return ((seedN >>> 0) / 4294967296) * 2 - 1; };
const kick = (tt, bpm, off = 0) => { const ph = (tt + off) % (60 / bpm); return 0.6 * Math.exp(-ph * 30) * Math.sin(2 * Math.PI * 55 * ph); };
const hat = (tt, bpm, sh) => { const ph = (tt + sh * 60 / bpm) % (60 / bpm / (sh ? 1 : 1)); return 0.08 * Math.exp(-ph * 120) * rnd(); };
const snare = (tt, bpm) => { const ph = (tt + 60 / bpm) % (120 / bpm); return 0.3 * Math.exp(-ph * 40) * rnd(); };
const chord = (tt) => 0.05 * (Math.sin(2 * Math.PI * 220 * tt) + Math.sin(2 * Math.PI * 277 * tt) + Math.sin(2 * Math.PI * 330 * tt));
const gen = diet === 'slow'
  ? (tt) => kick(tt, 92) + chord(tt)
  : (tt) => kick(tt, 168) + kick(tt, 168, 0.75 * 60 / 168) * 0.7 + snare(tt, 168) + hat(tt, 168, 0.5) + chord(tt);

const SR = 48000, FPS = 60, n = SR / FPS;
let t = 0, last = null; const series = [], t0 = Date.now();
for (let f = 0; f < MIN * 60 * FPS; f++) {
  const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = gen(t + i / SR); t += n / SR;
  msgs.length = 0; self.onmessage({ data: { type: 'pcm', mono: x } });
  let peak = 0; for (const m of msgs) { if (m.onset > peak) peak = m.onset; last = m; }
  mind.step(1 / FPS, last, peak, { tension: 0.3, intensity: 0.6 });
  if (f % (5 * 60 * FPS) === 5 * 60 * FPS - 1) { series.push({ min: Math.round(t / 60), ...snap() }); console.log(diet, 'min', Math.round(t / 60), 'f0', series.at(-1).traits.f0.toFixed(3), 'sStar', series.at(-1).traits.sStar.toFixed(3), 'mood', series.at(-1).mood.toFixed(2), `(${((Date.now() - t0) / 1000).toFixed(0)} s)`); }
}
fs.mkdirSync(path.join(ROOT, 'lab', 'results'), { recursive: true });
fs.writeFileSync(OUT(diet), JSON.stringify({ diet, minutes: MIN, seed: SEED, start, final: snap(), series }, null, 1));
console.log('done', diet);
