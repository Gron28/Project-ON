// tests/organism-bench.test.mjs - the organism's bench and evolution harness (lab/organism/worlds.mjs, bench.mjs,
// evolve.mjs): worlds are deterministic and their controls exact, the timing metrics read what they claim, the bench
// returns finite numbers for the committed best genome, and the MAP-Elites archive inserts and replaces correctly.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TRAIN, TEST, VARIANTS, makeWorld, framesOf, onsetCount } from '../lab/organism/worlds.mjs';
import { beatLock, benchSeed, fitGenome } from '../lab/organism/bench.mjs';
import { createArchive, archiveFrom, descriptorAxis } from '../lab/organism/evolve.mjs';
import { NG } from '../lab/organism/genome.mjs';

test('worlds: deterministic by seed, train and held-out tempi do not overlap', () => {
  for (const spec of [...TRAIN, ...TEST]) for (const v of VARIANTS) {
    const a = makeWorld(spec, v, { seed: 3 }), b = makeWorld(spec, v, { seed: 3 });
    assert.deepEqual(a.events, b.events, `${spec.name} ${v}`);
    assert.deepEqual(a.beats, b.beats);
    assert.deepEqual(a.omitted, b.omitted);
  }
  const s3 = makeWorld(TRAIN[0], 'shuffled', { seed: 3 }), s4 = makeWorld(TRAIN[0], 'shuffled', { seed: 4 });
  assert.notDeepEqual(s3.events.map((e) => e.t), s4.events.map((e) => e.t), 'another seed shuffles differently');
  const F1 = framesOf(makeWorld(TEST[1], 'shuffled', { dur: 3 })), F2 = framesOf(makeWorld(TEST[1], 'shuffled', { dur: 3 }));
  assert.equal(F1.n, 750); assert.deepEqual(F1.onset, F2.onset); assert.deepEqual(F1.amp, F2.amp);
  const tempi = (set) => new Set(set.flatMap((w) => w.segments.flatMap((s) => [s.bpm, s.bpm2]).filter(Boolean)));
  const tr = tempi(TRAIN); for (const b of tempi(TEST)) assert.ok(!tr.has(b), `held-out tempo ${b} is also a train tempo`);
});

test('worlds: the shuffled control keeps every onset, the omission variant removes whole beats at known times', () => {
  for (const spec of [...TRAIN, ...TEST]) {
    const g = makeWorld(spec), s = makeWorld(spec, 'shuffled'), o = makeWorld(spec, 'omission');
    assert.equal(onsetCount(s), onsetCount(g), `${spec.name}: onset groups`);
    assert.equal(s.events.length, g.events.length, `${spec.name}: events`);
    assert.deepEqual(s.events.map((e) => e.type).sort(), g.events.map((e) => e.type).sort(), `${spec.name}: the same sounds`);
    assert.ok(s.events.some((e, i) => Math.abs(e.t - g.events[i].t) > 0.01), `${spec.name}: the shuffle moved onsets`);
    assert.ok(o.omitted.length >= 2, `${spec.name}: ${o.omitted.length} omissions`);
    for (const t of o.omitted) {
      assert.ok(g.beats.some((b) => Math.abs(b.t - t) < 1e-9), 'an omission is a beat of the groove');
      assert.ok(g.events.some((e) => Math.abs(e.t - t) < 0.001), 'something played there in the groove');
      assert.ok(!o.events.some((e) => Math.abs(e.t - t) < 0.001), 'nothing plays there in the omission variant');
    }
    assert.ok(o.omitted.every((t, i) => i === 0 || t - o.omitted[i - 1] > 1.5 * g.beats[0].period * 0.9), 'never two in a row');
  }
});

test('beatLock: spikes 20 ms before every beat read as vs 1 and -20 ms; uniform spikes as vs ~0', () => {
  const beats = Array.from({ length: 40 }, (_, i) => ({ t: 1 + 0.5 * i, period: 0.5 }));
  const early = beatLock(beats.map((b) => b.t - 0.02), beats, { from: 0 });
  assert.ok(early.vs > 0.999); assert.ok(Math.abs(early.errMs + 20) < 1e-6, `${early.errMs}`); assert.ok(early.iqrMs < 1e-6);
  const flat = beatLock(Array.from({ length: 4000 }, (_, i) => 0.75 + i * 0.005), beats, { from: 0 });
  assert.ok(flat.vs < 0.02, `${flat.vs}`);
});

test('bench: the committed best genome gives finite metrics in both conditions', () => {
  const best = JSON.parse(fs.readFileSync(new URL('../lab/results/organism-best.json', import.meta.url), 'utf8'));
  assert.ok(fitGenome(best.genome).length <= NG);
  const r = benchSeed(best.genome, 11, { set: [TEST[0], TEST[3]], dur: 10, lifeDur: 4 });
  for (const c of ['newborn', 'adult']) {
    const s = r[c + 'Summary'];
    for (const k of ['vs', 'vsShuffled', 'credit', 'vsReflex', 'beyondReflex', 'errMs', 'iqrMs', 'braceErrMs', 'braceLock', 'protect', 'protectShuffled', 'viability', 'interHz', 'msPerSimS']) assert.ok(Number.isFinite(s[k]), `${c} ${k} = ${s[k]}`);
    assert.ok(s.vs >= 0 && s.vs <= 1 && s.viability > 0 && s.viability <= 1);
    assert.ok(r[c].every((w) => w.omission && w.omission.nOmit > 0), `${c}: omissions measured`);
    console.log(`  ${c}: vs ${s.vs.toFixed(3)}, shuffled ${s.vsShuffled.toFixed(3)}, reflex ${s.vsReflex.toFixed(3)}, err ${s.errMs.toFixed(1)} ms, omission ${s.omissionHz.toFixed(3)} Hz, ${s.msPerSimS.toFixed(1)} ms per simulated s`);
  }
  assert.ok(r.life && Number.isFinite(r.life.viability));
});

test('MAP-Elites archive: new cells, replacement only by a fitter genome, rejection of undefined descriptors, round trip', () => {
  const A = createArchive([descriptorAxis('interHz'), descriptorAxis('gene:etaH')]);
  const g = (x) => new Float64Array(NG).fill(x);
  assert.equal(A.insert({ genome: g(0.1), fitness: 0.2, desc: [2, 0.1] }).status, 'new');
  assert.equal(A.insert({ genome: g(0.2), fitness: 0.1, desc: [2.05, 0.11] }).status, 'rejected', 'a weaker genome in the same cell');
  assert.equal(A.insert({ genome: g(0.3), fitness: 0.3, desc: [2.05, 0.11] }).status, 'replaced');
  assert.equal(A.insert({ genome: g(0.4), fitness: 0.05, desc: [12, 0.9] }).status, 'new', 'another cell');
  assert.equal(A.insert({ genome: g(0.5), fitness: 1, desc: [NaN, 0.5] }).status, 'rejected');
  assert.equal(A.size, 2); assert.equal(A.best().genome[0], 0.3);
  assert.equal(A.keyOf([0.1, -1]), '0,0', 'out of range clamps to the edge bins');
  assert.equal(A.keyOf([1000, 2]), '7,7');
  assert.notEqual(A.keyOf([1.5, 0.5]), A.keyOf([3, 0.5]), 'interHz bins are logarithmic');
  const B = archiveFrom(JSON.parse(JSON.stringify(A.toJSON())));
  assert.equal(B.size, 2); assert.equal(B.best().fitness, 0.3); assert.ok(B.best().genome instanceof Float64Array);
  assert.throws(() => descriptorAxis('gene:noSuchGene'));
});
