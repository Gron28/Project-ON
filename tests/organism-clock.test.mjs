// tests/organism-clock.test.mjs - the organism's clock sense (lab/organism/clock.mjs, develop.mjs T.CLOCK): ON's own beat
// prediction (mind.mjs felt pulse, timing.mjs grid, the analyzer's beat and drums) as a sense; older genomes develop as
// before; the receptors code the phase; and what a life does with it (three-factor learning from clock cells to the
// motor paths) is measured against the same organism frozen at birth.
import test from 'node:test';
import assert from 'node:assert/strict';
import { develop, fingerprint, T } from '../lab/organism/develop.mjs';
import { GENES, NG_CLOCK, randomGenome, padGenome } from '../lab/organism/genome.mjs';
import { createOrganism } from '../lab/organism/organism.mjs';
import { clockOver } from '../lab/organism/clock.mjs';
import { live } from '../lab/organism/environment.mjs';
import { TRAIN, TEST } from '../lab/organism/worlds.mjs';
import { framesFor, frozenDev } from '../lab/organism/bench.mjs';

const geneIndex = (n) => GENES.findIndex(([g]) => g === n);
const setGenes = (g, o) => { const c = Float64Array.from(padGenome(g)); for (const [k, v] of Object.entries(o)) { const [, lo, hi] = GENES[geneIndex(k)]; c[geneIndex(k)] = (v - lo) / (hi - lo); } return c; };
const circ = (ph) => { let c = 0, s = 0; for (const p of ph) { c += Math.cos(2 * Math.PI * p); s += Math.sin(2 * Math.PI * p); } return { mean: Math.atan2(s, c) / (2 * Math.PI), R: Math.hypot(c, s) / ph.length }; };
// the best genome evolved before the clock genes (feat/organism-lab, gen 46): 39 genes
const PREV = Float64Array.from([0.818489, 0.907456, 0.104389, 0.595135, 0.067395, 0.645461, 0.689654, 0.572828, 0.04631, 0.984167, 0.946187, 0.778441, 0.411671, 0.604899, 0.397679, 0.480631, 0.077685, 0.711148, 0.112411, 0.044797, 0.832048, 0.2053, 0.254401, 0.197931, 0.418266, 0.020426, 0.886047, 0.919102, 0, 0, 0.645427, 0.020114, 0.009667, 0.0544, 0.023057, 0.416566, 0.411765, 0.097266, 0.021943]);

test('a genome evolved before the clock genes develops exactly as with nClock = 0; with clock cells it grows the same network plus their axons', () => {
  for (const k of [1, 2]) {
    const g = randomGenome(k), short = g.slice(0, NG_CLOCK), zero = setGenes(g, { nClock: 0 });
    assert.equal(fingerprint(develop(short, k)), fingerprint(develop(zero, k)));
    const a = develop(zero, k), b = develop(setGenes(g, { nClock: 8 }), k);
    assert.equal(b.N, a.N + 8);
    for (let i = a.N; i < b.N; i++) assert.equal(b.type[i], T.CLOCK);
    const edges = (d) => new Set(Array.from(d.syn.pre, (p, q) => `${p}>${d.syn.post[q]}`));
    const ea = edges(a), eb = edges(b);
    for (const e of ea) assert.ok(eb.has(e), 'every original synapse is still there');
    for (let q = 0; q < b.syn.pre.length; q++) if (!ea.has(`${b.syn.pre[q]}>${b.syn.post[q]}`)) assert.equal(b.type[b.syn.pre[q]], T.CLOCK, 'only clock axons are new');
    for (let q = 0; q < b.syn.post.length; q++) assert.notEqual(b.type[b.syn.post[q]], T.CLOCK, 'clock cells receive no synapses');
  }
});

test('the clock: ON\'s felt pulse, timing grid and analyzer put the beat at one phase on a groove, at none on its shuffled control', () => {
  const spec = TEST.find((w) => w.name === 'groove-100'), at = (F, c) => F.world.beats.filter((b) => b.t >= 4).map((b) => c.phase[Math.min(F.n - 1, Math.round(b.t / 0.004))]);
  const G = framesFor(spec, 'groove', { seed: 1 }), S = framesFor(spec, 'shuffled', { seed: 1 }), cg = clockOver(G), cs = clockOver(S);
  const g = circ(at(G, cg)), s = circ(at(S, cs)), lock = cg.lock.slice(1000).reduce((x, y) => x + y, 0) / (G.n - 1000);
  console.log(`  groove-100: phase at the beats ${g.mean.toFixed(3)} (R ${g.R.toFixed(2)}), mean lock ${lock.toFixed(2)}; shuffled R ${s.R.toFixed(2)}`);
  assert.ok(g.R > 0.9 && lock > 0.8, 'the beat lands at one phase');
  assert.ok(Math.abs(g.mean) < 0.08, 'and that phase is the beat (0)');
  assert.ok(s.R < 0.4, 'shuffled intervals: no phase predicts the beat-carrying onsets');
});

test('clock receptors fire at their own phase of the beat (a population time code)', () => {
  const org = createOrganism({ genome: setGenes(PREV, { nClock: 8, clockKappa: 8 }), seed: 3, gestation: 0 }), F = framesFor(TEST.find((w) => w.name === 'groove-100'), 'groove', { seed: 1 });
  const ph = Array.from(org.C.clock, () => []);
  live(org, F, { each: (o, f) => { if (f < 1000) return; o.C.clock.forEach((i, q) => { if (o.net.spk[i]) ph[q].push(F.clockPhase[f]); }); } });
  org.C.clock.forEach((i, q) => {
    const c = circ(ph[q]); let e = c.mean - org.dev.extra[4 * i]; e -= Math.round(e);
    assert.ok(Math.abs(e) < 0.05 && c.R > 0.7, `cell ${q}: preferred ${org.dev.extra[4 * i].toFixed(3)}, fires at ${c.mean.toFixed(3)} (R ${c.R.toFixed(2)})`);
  });
});

test('learning with the clock: on a steady groove a life moves the brace from after the beat to before it; without clock cells it stays late', () => {
  // the previous best genome with 12 clock cells, axons drawn to the motor cells and a faster three-factor rule: a
  // newborn frozen at birth vs the same organism after 5 passes of a steady 96 bpm groove, each measured on one more pass:
  // the median brace peak per beat (ms, negative: before the beat). Measured: newborn ~+170 ms, adult ~-145 ms (it
  // overshoots: nothing in the rule stops the shift at the beat), without clock cells ~+175 ms
  const g = setGenes(PREV, { nClock: 12, clockKappa: 8, tropM: 0.8, etaH: 0.008, modGain: 0.8 }), seed = 860084, spec = TRAIN.find((w) => w.name === 'groove-96');
  const peak = (org, F) => {
    const br = new Float32Array(F.n); live(org, F, { each: (o, f, s) => { br[f] = s.brace; } });
    const e = [];
    for (const b of F.world.beats) { if (b.t < 4) continue; const f0 = Math.ceil((b.t - b.period / 2) / 0.004), f1 = Math.min(F.n, Math.ceil((b.t + b.period / 2) / 0.004)); let fm = f0; for (let f = f0; f < f1; f++) if (br[f] > br[fm]) fm = f; e.push(1000 * ((fm + 1) * 0.004 - b.t)); }
    return e.sort((a, b) => a - b)[e.length >> 1];
  };
  const test = framesFor(spec, 'groove', { seed: 99 });
  const newborn = peak(createOrganism({ dev: frozenDev(g, seed), seed }), test);
  const adult = createOrganism({ genome: g, seed });
  for (let p = 0; p < 5; p++) live(adult, framesFor(spec, 'groove', { seed: 1 + p }));
  const grown = peak(adult, test);
  // the same life without clock cells
  const plain = createOrganism({ genome: setGenes(g, { nClock: 0 }), seed });
  for (let p = 0; p < 5; p++) live(plain, framesFor(spec, 'groove', { seed: 1 + p }));
  const noClock = peak(plain, test);
  console.log(`  brace peak vs the beat: frozen newborn ${newborn.toFixed(0)} ms, adult ${grown.toFixed(0)} ms; the same life without clock cells ${noClock.toFixed(0)} ms`);
  assert.ok(newborn > 60 && grown < 0 && grown < newborn - 100, 'a life with the clock moves the brace from after the beat to before it');
  assert.ok(noClock > newborn - 50, 'without clock cells the same life leaves it late');
});
