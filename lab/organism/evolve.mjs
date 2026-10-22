// lab/organism/evolve.mjs - evolves organism genomes for attunement under survival pressure: MAP-Elites over two behaviour
// descriptors, rated on several development seeds and several train worlds. Node script (worker threads).
//   .runtime/node-v24.21.0-win-x64/node.exe lab/organism/evolve.mjs [--minutes 20] [--workers 7] [--seeds 2] [--dur 12]
//       [--desc motorDepth,interHz] [--resume] [--measure-only] [--no-baseline]
//       [--bench-dur 24] [--out lab/results] [--prev lab/results/organism-best.json]
//
// Rating (rateGenome, one development seed at a time, `--seeds` seeds per genome): the organism lives the train worlds
// (worlds.mjs TRAIN, groove variant, `--dur` s each) once as experience, then hears each of them again as groove and as
// the shuffled control, plasticity on throughout, motor spikes recorded (bench.mjs metrics). Per world
//   attunement = braceLock exp(-|braceErrMs| / 80) + max(0, protectCredit) + 0.5 max(0, credit) + 0.25 max(0, beyondReflex)
// (brace: when the body's stiffness peaks relative to the beat and how consistently; protectCredit: protection at beat
// impacts in the groove minus in the shuffled control; credit: motor vector strength groove minus shuffled;
// beyondReflex: motor vector strength above what a pure reflex would give). Fitness = mean attunement x min(1, viability / 0.75). Balance and life are hard
// constraints: a seed that dies, or whose interneurons average below 1 Hz or above 25 Hz, or exceed 40 Hz for more than
// 2% of the time, sets the genome's fitness to 0.02 x viability.
// Search: MAP-Elites (Mouret & Clune 2015) over two descriptors (default: an ear-spread gene if the genome has one, else
// sensor -> motor depth after the life; and the mean interneuron rate), 8 x 8 cells; steady state, each offspring a
// mutated (sometimes crossed) copy of a uniformly chosen elite. The archive keeps diverse stepping stones instead of one
// population converging. Checkpoint after every batch (lab/results/organism-evolve-checkpoint.json; --resume continues it).
// After the budget: the 5 best elites are re-rated on fresh seeds, the winner is benched on the HELD-OUT worlds
// (worlds.mjs TEST, bench.mjs: newborn vs adult vs shuffled), as is the previous best for comparison; measure.mjs runs on
// it. Writes lab/results/organism-evolve.json (history, archive, held-out bench) and lab/results/organism-best.json.

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomGenome, mutate, crossover, lcg, mix, decode, toArray, GENES, padGenome } from './genome.mjs';
import { createOrganism } from './organism.mjs';
import { live } from './environment.mjs';
import { depth, louvain, graphOf } from './analysis.mjs';
import { measure } from './measure.mjs';
import { TRAIN } from './worlds.mjs';
import { framesFor, runRecord, scoreWorld, benchParallel, headline, table, devSeeds, fitGenome } from './bench.mjs';

const __file = fileURLToPath(import.meta.url), ROOT = path.resolve(path.dirname(__file), '../..');

// ---- descriptors and the MAP-Elites archive ---------------------------------------------------------------------------------

/** descriptor axes: a metric from the rating, or 'gene:<name>' (the gene's raw value in [0, 1]) */
export function descriptorAxis(name, bins = 8) {
  if (name.startsWith('gene:')) { const gi = GENES.findIndex(([n]) => n === name.slice(5)); if (gi < 0) throw new Error('no gene ' + name); return { name, gene: gi, lo: 0, hi: 1, bins }; }
  const R = { interHz: { lo: 1, hi: 16, log: true }, motorDepth: { lo: 1, hi: 3.4 }, modularity: { lo: 0.2, hi: 0.8 }, vs: { lo: 0, hi: 0.6 }, motorReached: { lo: 0, hi: 1 } }[name];
  if (!R) throw new Error('unknown descriptor ' + name);
  return { name, ...R, bins };
}
/** default descriptors: the hearing-field gene and the resonator count when the genome has them, else sensor -> motor
 *  depth and interneuron rate */
export function defaultDescriptors() { const has = (n) => GENES.some(([g]) => g === n); return has('earSpread') && has('nOsc') ? ['gene:earSpread', 'gene:nOsc'] : ['motorDepth', 'interHz']; }

export function createArchive(axes) {
  const cells = new Map();
  const binOf = (ax, v) => {
    if (!Number.isFinite(v)) return -1;
    const u = ax.log ? Math.log(Math.max(v, 1e-9) / ax.lo) / Math.log(ax.hi / ax.lo) : (v - ax.lo) / (ax.hi - ax.lo);
    return Math.max(0, Math.min(ax.bins - 1, Math.floor(u * ax.bins)));
  };
  const A = {
    axes, cells,
    keyOf(desc) { const b = axes.map((ax, i) => binOf(ax, desc[i])); return b.some((x) => x < 0) ? null : b.join(','); },
    /** insert an entry { genome, fitness, desc: [..] }: 'new' (empty cell), 'replaced' (fitter), or 'rejected' */
    insert(e) {
      const key = A.keyOf(e.desc); if (key === null || !Number.isFinite(e.fitness)) return { status: 'rejected', key };
      const cur = cells.get(key);
      if (!cur) { cells.set(key, e); return { status: 'new', key }; }
      if (e.fitness > cur.fitness) { cells.set(key, e); return { status: 'replaced', key }; }
      return { status: 'rejected', key };
    },
    sample(r) { const v = [...cells.values()]; return v[r.int(v.length)]; },
    best() { let b = null; for (const e of cells.values()) if (!b || e.fitness > b.fitness) b = e; return b; },
    top(k) { return [...cells.values()].sort((a, b) => b.fitness - a.fitness).slice(0, k); },
    get size() { return cells.size; },
    qd() { let s = 0; for (const e of cells.values()) s += Math.max(0, e.fitness); return s; },
    toJSON() { return { axes, cells: [...cells.entries()].map(([k, e]) => ({ key: k, ...e, genome: toArray(e.genome) })) }; },
  };
  return A;
}
export function archiveFrom(json) { const A = createArchive(json.axes); for (const c of json.cells) { const { key, ...e } = c; A.cells.set(key, { ...e, genome: Float64Array.from(e.genome) }); } return A; }

// ---- rating -----------------------------------------------------------------------------------------------------------------

export const RATE = { dur: 12, seeds: 2, vGate: 0.75 };
/** per world: a brace that peaks on the beat, consistently (brace lock x closeness of its peak to the beat), plus the
 *  protection the groove's predictability buys over the shuffled control, plus motor timing beyond reflex and vs shuffled.
 *  Without brace readouts (older organisms) only the motor terms count. */
export function attunementOf(w) {
  const pos = (x) => (Number.isFinite(x) ? Math.max(0, x) : 0), fin = (x) => (Number.isFinite(x) ? x : 0);
  const brace = Number.isFinite(w.braceErrMs) ? fin(w.braceLock) * Math.exp(-Math.abs(w.braceErrMs) / 80) : 0;
  return brace + pos(w.protectCredit) + 0.5 * pos(w.credit) + 0.25 * pos(w.beyondReflex);
}

/** one development seed: a life through the train worlds, then each world again as groove and shuffled */
export function rateSeed(genome, seed, { dur = RATE.dur, worlds = TRAIN, structure = false } = {}) {
  const org = createOrganism({ genome: Float64Array.from(genome), seed }), t0 = performance.now();
  let vSum = 0, n = 0, alive = true, hz = 0, run = 0;
  const acc = (r, simS) => { vSum += r.viability * simS; hz += r.interHz * simS; run = Math.max(run, r.runaway); n += simS; alive = alive && (r.died < 0); };
  for (const w of worlds) { const F = framesFor(w, 'groove', { seed: 7, dur }); acc(live(org, F), F.n * 0.004); }
  const rows = [];
  for (const w of worlds) {
    const g = runRecord(org, framesFor(w, 'groove', { seed: 1, dur })), s = runRecord(org, framesFor(w, 'shuffled', { seed: 1, dur }));
    acc(g, dur); acc(s, dur); rows.push(scoreWorld({ groove: g, shuffled: s }));
  }
  const D = depth(org), interHz = hz / n, viability = vSum / n;
  const ok = alive && interHz >= 1 && interHz <= 25 && run < 0.02;
  const m = (k) => { const v = rows.map((r) => r[k]).filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; };
  const att = rows.reduce((a, r) => a + attunementOf(r), 0) / rows.length;
  const out = { seed, ok, alive, viability, interHz, runaway: run, att, vs: m('vs'), credit: m('credit'), beyondReflex: m('beyondReflex'), errMs: m('errMs'), braceErrMs: m('braceErrMs'), braceLock: m('braceLock'), protect: m('protect'), protectCredit: m('protectCredit'), resonVs: m('resonVs'), motorDepth: D.motorDepth, motorReached: D.motorReached, ms: performance.now() - t0, simS: n };
  if (structure) out.modularity = louvain(graphOf(org)).Q;
  return out;
}
/** a genome over several development seeds: fitness, its parts and the descriptors */
export function rateGenome(genome, seeds, opt = {}) {
  const per = seeds.map((s) => rateSeed(genome, s, opt)), mean = (k) => per.reduce((a, p) => a + (Number.isFinite(p[k]) ? p[k] : 0), 0) / per.length;
  const ok = per.every((p) => p.ok), viability = mean('viability'), att = mean('att');
  const fitness = ok ? att * Math.min(1, viability / RATE.vGate) : 0.02 * viability;
  const o = { fitness, ok, alive: per.every((p) => p.alive), viability, att, interHz: mean('interHz'), runaway: Math.max(...per.map((p) => p.runaway)), vs: mean('vs'), credit: mean('credit'), beyondReflex: mean('beyondReflex'), errMs: mean('errMs'), braceErrMs: mean('braceErrMs'), braceLock: mean('braceLock'), protect: mean('protect'), protectCredit: mean('protectCredit'), resonVs: mean('resonVs'), motorDepth: mean('motorDepth'), motorReached: mean('motorReached'), ms: per.reduce((a, p) => a + p.ms, 0), simS: per.reduce((a, p) => a + p.simS, 0), seeds };
  if (per[0].modularity !== undefined) o.modularity = mean('modularity');
  return o;
}

// ---- worker ---------------------------------------------------------------------------------------------------------------------
if (!isMainThread && workerData?.role === 'evolve') {
  parentPort.on('message', ({ id, genome, seeds, opt }) => parentPort.postMessage({ id, ...rateGenome(genome, seeds, opt) }));
}

// ---- main -------------------------------------------------------------------------------------------------------------------------
const isCli = isMainThread && process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isCli) {
  const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; }, has = (k) => args.includes('--' + k);
  const outDir = path.resolve(arg('out', path.join(ROOT, 'lab', 'results'))), prevFile = path.resolve(arg('prev', path.join(ROOT, 'lab', 'results', 'organism-best.json'))), bestFile = path.join(outDir, 'organism-best.json'), evoFile = path.join(outDir, 'organism-evolve.json'), ckFile = path.join(outDir, 'organism-evolve-checkpoint.json');
  const describe = (g) => { const d = decode(g); return Object.fromEntries(GENES.map(([n]) => [n, +(+d[n]).toFixed(4)])); };
  if (has('measure-only')) {
    const best = JSON.parse(fs.readFileSync(bestFile, 'utf8'));
    best.measures = measure(Float64Array.from(best.genome), best.seed, { log: console.log });
    fs.writeFileSync(bestFile, JSON.stringify(best, null, 1));
    console.log(JSON.stringify(best.measures, null, 1));
  } else {
    const MIN = +arg('minutes', 20), NW = +arg('workers', Math.max(1, Math.min(7, os.cpus().length - 1))), NS = +arg('seeds', RATE.seeds), dur = +arg('dur', RATE.dur);
    const descNames = arg('desc', null)?.split(',') || defaultDescriptors(), axes = descNames.map((d) => descriptorAxis(d));
    const opt = { dur, structure: descNames.includes('modularity') }, BATCH = 2 * NW, BASE = 20261022;
    let A = createArchive(axes), history = [], evals = 0, spentMs = 0, simS = 0, cpuMs = 0;
    if (has('resume') && fs.existsSync(ckFile)) {
      const ck = JSON.parse(fs.readFileSync(ckFile, 'utf8'));
      A = archiveFrom(ck.archive); history = ck.history; evals = ck.evals; spentMs = ck.spentMs; simS = ck.simS; cpuMs = ck.cpuMs;
      console.log(`resumed: ${evals} evaluations, ${A.size} cells, ${(spentMs / 60000).toFixed(1)} min spent`);
    }
    const prevBest = fs.existsSync(prevFile) ? JSON.parse(fs.readFileSync(prevFile, 'utf8')) : null;   // seeds the first batch, and the held-out baseline
    const workers = Array.from({ length: NW }, () => new Worker(__file, { workerData: { role: 'evolve' } }));
    const pending = new Map(); let nextId = 0, wi = 0;
    workers.forEach((w) => w.on('message', (m) => { const p = pending.get(m.id); pending.delete(m.id); p(m); }));
    const rate = (genome, seeds) => new Promise((res) => { const id = nextId++; pending.set(id, res); workers[wi++ % NW].postMessage({ id, genome: Array.from(genome), seeds, opt }); });
    const descOf = (genome, r) => axes.map((ax) => (ax.gene !== undefined ? genome[ax.gene] : Number.isFinite(r[ax.name]) ? r[ax.name] : ax.hi));   // no motor path: deepest bin
    const seedsFor = (k) => Array.from({ length: NS }, (_, j) => (mix(BASE + k, j + 1) % 1000003) + 1);
    /** the k-th offspring: deterministic in k (resumable) */
    function offspring(k) {
      if (k < BATCH || A.size === 0) return k === 0 && prevBest ? padGenome(fitGenome(prevBest.genome)) : randomGenome(1000 + k);
      const r = lcg(mix(BASE, k)), a = A.sample(r);
      let g = r() < 0.3 && A.size > 1 ? crossover(a.genome, A.sample(r).genome, r) : Float64Array.from(a.genome);
      return mutate(g, r, 0.2, 0.08);
    }
    const t0 = Date.now() - spentMs, deadline = t0 + MIN * 60000;
    let batchStats = { n: 0, alive: 0, ok: 0, ins: 0, rep: 0 };
    const logBatch = () => {
      const b = A.best(), mean = A.size ? [...A.cells.values()].reduce((s, e) => s + e.fitness, 0) / A.size : 0;
      history.push({ gen: history.length, evals, best: +(b?.fitness ?? 0).toFixed(4), mean: +mean.toFixed(4), alive: batchStats.alive, balanced: batchStats.ok, batch: batchStats.n, newCells: batchStats.ins, replaced: batchStats.rep, filled: A.size, qd: +A.qd().toFixed(4),
        bestInterHz: +(b?.interHz ?? 0).toFixed(2), bestVs: +(b?.vs ?? 0).toFixed(4), bestCredit: +(b?.credit ?? 0).toFixed(4), bestBeyondReflex: +(b?.beyondReflex ?? 0).toFixed(4), bestBraceErrMs: +(+(b?.braceErrMs ?? NaN)).toFixed(1), bestBraceLock: +(+(b?.braceLock ?? NaN)).toFixed(4), bestProtectCredit: +(+(b?.protectCredit ?? NaN)).toFixed(4), bestGenome: b ? toArray(b.genome) : null, bestSeed: b?.seeds?.[0] ?? 0 });
      console.log(`batch ${String(history.length - 1).padStart(3)}  evals ${evals}  cells ${A.size}  new ${batchStats.ins} better ${batchStats.rep}  best ${(b?.fitness ?? 0).toFixed(4)} (brace ${(+(b?.braceErrMs ?? NaN)).toFixed(0)} ms lock ${(+(b?.braceLock ?? NaN)).toFixed(2)} p-credit ${(+(b?.protectCredit ?? NaN)).toFixed(3)} vs ${(b?.vs ?? 0).toFixed(3)} credit ${(b?.credit ?? 0).toFixed(3)})  alive ${batchStats.alive}/${batchStats.n}  balanced ${batchStats.ok}/${batchStats.n}  (${((Date.now() - t0) / 60000).toFixed(1)} min)`);
      batchStats = { n: 0, alive: 0, ok: 0, ins: 0, rep: 0 };
      fs.writeFileSync(ckFile, JSON.stringify({ archive: A.toJSON(), history, evals, spentMs: Date.now() - t0, simS, cpuMs, opt, descNames }));
    };
    // steady state: keep every worker busy until the deadline
    await new Promise((done) => {
      let inFlight = 0;
      const launch = () => {
        while (inFlight < NW + 1 && Date.now() < deadline) {
          const k = evals + inFlight, g = offspring(k), seeds = seedsFor(k); inFlight++;
          rate(g, seeds).then((r) => {
            inFlight--; evals++; simS += r.simS; cpuMs += r.ms;
            const e = { genome: g, ...r, desc: descOf(g, r), born: k };
            const st = A.insert(e).status;
            batchStats.n++; batchStats.alive += r.alive ? 1 : 0; batchStats.ok += r.ok ? 1 : 0; batchStats.ins += st === 'new' ? 1 : 0; batchStats.rep += st === 'replaced' ? 1 : 0;
            if (batchStats.n >= BATCH) logBatch();
            if (Date.now() < deadline) launch(); else if (inFlight === 0) done();
          });
        }
        if (inFlight === 0) done();
      };
      launch();
    });
    if (batchStats.n) logBatch();
    // re-rate the 5 best elites on fresh seeds; the winner is the one that holds up
    console.log('re-rating the top elites on fresh development seeds...');
    const fresh = Array.from({ length: 4 }, (_, j) => (mix(BASE ^ 0xfeed, j + 1) % 1000003) + 1);
    const top = A.top(5), rer = await Promise.all(top.map((e) => rate(e.genome, fresh)));
    top.forEach((e, i) => { e.rerated = { fitness: rer[i].fitness, ok: rer[i].ok, vs: rer[i].vs, credit: rer[i].credit, beyondReflex: rer[i].beyondReflex, braceErrMs: rer[i].braceErrMs, braceLock: rer[i].braceLock, protectCredit: rer[i].protectCredit, viability: rer[i].viability }; console.log(`  elite ${e.desc.map((x) => (+x).toFixed(2)).join(',')}: ${e.fitness.toFixed(4)} -> ${rer[i].fitness.toFixed(4)}`); });
    const win = top.slice().sort((a, b) => b.rerated.fitness - a.rerated.fitness)[0];
    workers.forEach((w) => w.terminate());
    // held-out bench: the winner and the previous best
    console.log('held-out bench of the evolved best...');
    const heldOut = await benchParallel(win.genome, { seeds: devSeeds(3), set: 'test', dur: +arg('bench-dur', 24) });
    console.log(table(heldOut, 'EVOLVED BEST on the held-out worlds'));
    let baseline = null;
    if (prevBest && !has('no-baseline')) { console.log('held-out bench of the previous best...'); baseline = await benchParallel(fitGenome(prevBest.genome), { seeds: devSeeds(3), set: 'test', dur: +arg('bench-dur', 24) }); console.log(table(baseline, 'PREVIOUS BEST on the held-out worlds')); }
    const cost = { msPerSimSecond: +(cpuMs / simS).toFixed(3), note: 'wall ms per simulated second per organism in a worker: network, body, milieu and bench recording (ear frames precomputed once per worker)' };
    const archiveSummary = { axes, filled: A.size, of: axes.reduce((s, a) => s * a.bins, 1), qd: A.qd(), cells: [...A.cells.entries()].map(([key, e]) => ({ key, desc: e.desc.map((x) => +(+x).toFixed(4)), fitness: +e.fitness.toFixed(4), ok: e.ok, viability: +e.viability.toFixed(4), vs: +(+e.vs).toFixed(4), credit: +(+e.credit).toFixed(4), beyondReflex: +(+e.beyondReflex).toFixed(4), braceErrMs: +(+e.braceErrMs).toFixed(1), braceLock: +(+e.braceLock).toFixed(4), protectCredit: +(+e.protectCredit).toFixed(4), resonVs: +(+e.resonVs).toFixed(4), errMs: +(+e.errMs).toFixed(1), interHz: +e.interHz.toFixed(2), motorDepth: +(+e.motorDepth).toFixed(3), born: e.born, genome: toArray(e.genome) })) };
    fs.mkdirSync(outDir, { recursive: true });
    const trainWorlds = TRAIN.map((w) => w.name);
    fs.writeFileSync(evoFile, JSON.stringify({ algorithm: 'map-elites', pop: BATCH, gens: history.length, evals, minutes: MIN, workers: NW, seedsPerGenome: NS, life: { trainWorlds, dur, protocol: 'live each train world (groove) once, then hear each again as groove and shuffled' }, fitness: 'mean over seeds and worlds of braceLock exp(-|braceErrMs|/80) + max(0, protectCredit) + 0.5 max(0, credit) + 0.25 max(0, beyondReflex), x min(1, viability/0.75); 0.02 x viability when any seed dies or balance fails', cost, history, archive: archiveSummary, winner: { desc: win.desc, fitness: win.fitness, rerated: win.rerated }, heldOut: { headline: headline(heldOut), bench: heldOut }, baseline: baseline ? { headline: headline(baseline), bench: baseline } : null }, null, 1));
    console.log('measuring the best genome...');
    const best = { genome: toArray(win.genome), seed: win.seeds[0], gen: history.length - 1, born: win.born, fitness: win.rerated.fitness, viability: win.rerated.viability, genes: describe(win.genome), cost, rating: { fitness: win.fitness, vs: win.vs, credit: win.credit, beyondReflex: win.beyondReflex, errMs: win.errMs, braceErrMs: win.braceErrMs, braceLock: win.braceLock, protectCredit: win.protectCredit, interHz: win.interHz, motorDepth: win.motorDepth, desc: win.desc }, heldOut: headline(heldOut) };
    best.measures = measure(win.genome, best.seed, { log: console.log });
    fs.writeFileSync(bestFile, JSON.stringify(best, null, 1));
    console.log('wrote', path.relative(ROOT, evoFile), 'and', path.relative(ROOT, bestFile));
  }
}
