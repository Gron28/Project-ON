// lab/organism/evolve.mjs - evolves organism genomes under survival pressure. Node script (worker threads).
//   .runtime/node-v24.21.0-win-x64/node.exe lab/organism/evolve.mjs [--pop 24] [--gens 30] [--workers 6] [--measure-only]
// Each generation lives through the standard mixed life (environment.mjs LIFE, ~3 min: grooves at several tempi, tone,
// build/drop, polyrhythm, silence, white noise and scattered drums) in a segment order shuffled per generation, every
// genome developed from its own seed. Fitness = mean viability over the life (0 once dead), x0.25 when balance fails
// (interneurons silent < 1 Hz or above 25 Hz on average, or > 40 Hz for more than 2% of the time). Elitism 4,
// tournament of 3, uniform crossover, gaussian mutation.
// Writes lab/results/organism-evolve.json (history) and lab/results/organism-best.json (best genome and its measures).

import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomGenome, mutate, crossover, lcg, mix, decode, toArray, GENES } from './genome.mjs';
import { createOrganism } from './organism.mjs';
import { earFrames, live, fitnessOf, LIFE } from './environment.mjs';
import { measure } from './measure.mjs';

const __file = fileURLToPath(import.meta.url), ROOT = path.resolve(path.dirname(__file), '../..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };

function scheduleFor(gen) {
  const r = lcg(mix(gen, 31)), rest = LIFE.slice(1);
  for (let i = rest.length - 1; i > 0; i--) { const j = r.int(i + 1); [rest[i], rest[j]] = [rest[j], rest[i]]; }
  return [LIFE[0], ...rest];
}

if (!isMainThread) {
  let cache = { gen: -1, F: null };
  parentPort.on('message', ({ gen, id, genome, seed }) => {
    if (cache.gen !== gen) cache = { gen, F: earFrames(scheduleFor(gen), gen + 1) };
    const t0 = performance.now(), org = createOrganism({ genome: Float64Array.from(genome), seed });
    const L = live(org, cache.F), f = fitnessOf(L);
    parentPort.postMessage({ id, ...f, viability: L.viability, died: L.died, interHz: L.interHz, runaway: L.runaway, ms: performance.now() - t0, simS: cache.F.n * 0.004 });
  });
} else {
  const POP = +arg('pop', 24), GENS = +arg('gens', 30), NW = +arg('workers', 6);
  const outDir = path.join(ROOT, 'lab', 'results'), bestFile = path.join(outDir, 'organism-best.json');
  const describe = (g) => { const d = decode(g); return Object.fromEntries(GENES.map(([n]) => [n, +(+d[n]).toFixed(4)])); };
  if (process.argv.includes('--measure-only')) {
    const best = JSON.parse(fs.readFileSync(bestFile, 'utf8'));
    best.measures = measure(Float64Array.from(best.genome), best.seed, { log: console.log });
    fs.writeFileSync(bestFile, JSON.stringify(best, null, 1));
    console.log(JSON.stringify(best.measures, null, 1));
  } else {
    const workers = Array.from({ length: NW }, () => new Worker(__file));
    const pending = new Map(); let nextId = 0, wi = 0;
    workers.forEach((w) => w.on('message', (m) => { const p = pending.get(m.id); pending.delete(m.id); p(m); }));
    const evalOne = (gen, genome, seed) => new Promise((res) => { const id = nextId++; pending.set(id, res); workers[wi++ % NW].postMessage({ gen, id, genome: Array.from(genome), seed }); });

    const r = lcg(20261021);
    let pop = Array.from({ length: POP }, (_, i) => ({ genome: randomGenome(1000 + i), seed: 1 + i }));
    const history = []; let bestEver = null, simS = 0, cpuMs = 0; const t0 = Date.now();
    for (let gen = 0; gen < GENS; gen++) {
      const res = await Promise.all(pop.map((p) => evalOne(gen, p.genome, p.seed)));
      pop.forEach((p, i) => Object.assign(p, res[i]));
      res.forEach((x) => { simS += x.simS; cpuMs += x.ms; });
      pop.sort((a, b) => b.fitness - a.fitness);
      const fits = pop.map((p) => p.fitness), mean = fits.reduce((s, x) => s + x, 0) / POP;
      const alive = pop.filter((p) => p.died < 0).length, ok = pop.filter((p) => p.ok).length;
      history.push({ gen, best: +fits[0].toFixed(4), mean: +mean.toFixed(4), alive, balanced: ok, bestInterHz: +pop[0].interHz.toFixed(2), bestGenome: toArray(pop[0].genome), bestSeed: pop[0].seed });
      if (!bestEver || pop[0].fitness > bestEver.fitness) bestEver = { ...pop[0], genome: Float64Array.from(pop[0].genome), gen };
      console.log(`gen ${String(gen).padStart(2)}  best ${fits[0].toFixed(3)}  mean ${mean.toFixed(3)}  alive ${alive}/${POP}  balanced ${ok}/${POP}  best inter ${pop[0].interHz.toFixed(1)} Hz  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
      const tour = () => { let b = pop[r.int(POP)]; for (let k = 0; k < 2; k++) { const c = pop[r.int(POP)]; if (c.fitness > b.fitness) b = c; } return b; };
      const next = pop.slice(0, 4).map((p) => ({ genome: p.genome, seed: p.seed }));
      while (next.length < POP) {
        const a = tour(), b = tour();
        let g = r() < 0.5 ? crossover(a.genome, b.genome, r) : Float64Array.from(a.genome);
        g = mutate(g, r, 0.15, 0.08);
        next.push({ genome: g, seed: 1 + r.int(1e6) });
      }
      pop = next;
    }
    workers.forEach((w) => w.terminate());
    fs.mkdirSync(outDir, { recursive: true });
    const cost = { msPerSimSecond: +(cpuMs / simS).toFixed(3), note: 'wall ms per simulated second per organism in a worker: network, body and milieu (ear frames precomputed once per generation)' };
    fs.writeFileSync(path.join(outDir, 'organism-evolve.json'), JSON.stringify({ pop: POP, gens: GENS, life: LIFE, cost, history }, null, 1));
    console.log('measuring the best genome...');
    const best = { genome: toArray(bestEver.genome), seed: bestEver.seed, gen: bestEver.gen, fitness: bestEver.fitness, viability: bestEver.viability, genes: describe(bestEver.genome), cost };
    best.measures = measure(bestEver.genome, bestEver.seed, { log: console.log });
    fs.writeFileSync(bestFile, JSON.stringify(best, null, 1));
    console.log(JSON.stringify(best.measures, null, 1));
  }
}
