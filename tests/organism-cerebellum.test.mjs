// tests/organism-cerebellum.test.mjs - the cerebellar timing law (gene cbGain; organism.mjs cerebellum(), network.mjs
// teach()): a signed brace-timing error after each strike retimes the motor cells' excitatory inputs. Older genomes
// (cbGain 0) live exactly as before; with the law the hand-set clock genome's brace settles on the beat instead of
// overshooting, and stays there when the tempo jumps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GENES, NG_CB, padGenome, randomGenome } from '../lab/organism/genome.mjs';
import { createOrganism, restoreOrganism } from '../lab/organism/organism.mjs';
import { live } from '../lab/organism/environment.mjs';
import { TRAIN, TEST } from '../lab/organism/worlds.mjs';
import { framesFor } from '../lab/organism/bench.mjs';

const geneIndex = (n) => GENES.findIndex(([g]) => g === n);
const setGenes = (g, o) => { const c = Float64Array.from(padGenome(g)); for (const [k, v] of Object.entries(o)) { const [, lo, hi] = GENES[geneIndex(k)]; c[geneIndex(k)] = (v - lo) / (hi - lo); } return c; };
// the best genome evolved before the clock genes (gen 46)
const PREV = Float64Array.from([0.818489, 0.907456, 0.104389, 0.595135, 0.067395, 0.645461, 0.689654, 0.572828, 0.04631, 0.984167, 0.946187, 0.778441, 0.411671, 0.604899, 0.397679, 0.480631, 0.077685, 0.711148, 0.112411, 0.044797, 0.832048, 0.2053, 0.254401, 0.197931, 0.418266, 0.020426, 0.886047, 0.919102, 0, 0, 0.645427, 0.020114, 0.009667, 0.0544, 0.023057, 0.416566, 0.411765, 0.097266, 0.021943]);
const HAND = { nClock: 12, clockKappa: 8, tropM: 0.8, etaH: 0.008, modGain: 0.8 };
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
/** per beat after `from` s: when the mean brace peaks within [b - P/2, b + P/2) (ms, negative: before the beat) */
function bracePeaks(org, F, from = 4) {
  const br = new Float32Array(F.n); live(org, F, { each: (o, f, s) => { br[f] = s.brace; } });
  const out = [];
  for (const b of F.world.beats) {
    if (b.t < from) continue;
    const f0 = Math.ceil((b.t - b.period / 2) / 0.004), f1 = Math.min(F.n, Math.ceil((b.t + b.period / 2) / 0.004)); let fm = f0;
    for (let f = f0; f < f1; f++) if (br[f] > br[fm]) fm = f;
    out.push({ t: b.t, ms: 1000 * ((fm + 1) * 0.004 - b.t) });
  }
  return out;
}

test('a genome evolved before the cerebellar law lives exactly as with cbGain = 0', () => {
  const g = setGenes(randomGenome(4), { nClock: 4 }), short = g.slice(0, NG_CB), zero = setGenes(g, { cbGain: 0 });
  const F = framesFor(TRAIN.find((w) => w.name === 'groove-96'), 'groove', { seed: 1, dur: 6 });
  const run = (genome) => { const o = createOrganism({ genome, seed: 5, gestation: 2 }); live(o, F); return o.serialize(); };
  const a = run(short), b = run(zero);
  assert.deepEqual(a.net.w, b.net.w); assert.equal(a.milieu.energy, b.milieu.energy);
});

test('the cerebellar law: the hand-set clock genome\'s brace settles on the beat and stays there after a tempo jump; without it the brace overshoots', () => {
  // 8 passes of a steady 96 bpm groove (plasticity on throughout), then one more pass (the test pass) and, from a copy
  // of that adult, the held-out 116 -> 92 bpm jump. Measured (seed 860084): with cbGain 0.01, passes 142 -58 -39 9 -29
  // 13 -15 19 ms, test pass ~+33, jump ~+7 before and ~-16 after; without the law 156 -47 -81 -98 -121 -109 163 -168:
  // the three-factor rule moves the brace with no brake and it swings between far early and far late
  const seed = 860084, spec = TRAIN.find((w) => w.name === 'groove-96'), jump = TEST.find((w) => w.name === 'jump-116-92');
  const life = (cb) => {
    const org = createOrganism({ genome: setGenes(PREV, { ...HAND, cbGain: cb }), seed }), passes = [];
    for (let p = 0; p < 8; p++) passes.push(med(bracePeaks(org, framesFor(spec, 'groove', { seed: 1 + p })).map((x) => x.ms)));
    return { org, passes };
  };
  const on = life(0.01), off = life(0);
  const snap = on.org.serialize(), testMs = med(bracePeaks(on.org, framesFor(spec, 'groove', { seed: 99 })).map((x) => x.ms));
  const J = bracePeaks(restoreOrganism(snap), framesFor(jump, 'groove', { seed: 99 }));
  const before = med(J.filter((x) => x.t < 12).map((x) => x.ms)), after = med(J.filter((x) => x.t > 16).map((x) => x.ms));
  const ro = on.org.readouts().cerebellum;
  console.log(`  with the law: passes ${on.passes.map((x) => x.toFixed(0)).join(' ')}, test ${testMs.toFixed(0)} ms, jump ${before.toFixed(0)} -> ${after.toFixed(0)} ms (${ro.taught} strikes taught)`);
  console.log(`  without: passes ${off.passes.map((x) => x.toFixed(0)).join(' ')}`);
  for (const x of [...on.passes.slice(-3), testMs]) assert.ok(Math.abs(x) <= 40, `settled within +-40 ms of the beat (${x.toFixed(0)})`);
  assert.ok(Math.abs(before) <= 40 && Math.abs(after) <= 40, 'and stays near it across the tempo jump');
  assert.ok(ro.on && ro.taught > 300);
  assert.ok(off.passes.slice(-4).some((x) => Math.abs(x) > 80), 'without the law the brace overshoots and swings');
});
