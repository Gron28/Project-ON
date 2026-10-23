// tests/organism.test.mjs - the lab organism (lab/organism/): development is lawful and deterministic, the network finds
// a balanced regime by its own rules, the milieu responds to the world as its laws say, and it is cheap enough to run.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomGenome, GENES, NG, NG_LEGACY, NG_TROPHIC, mutate, crossover, lcg, decode } from '../lab/organism/genome.mjs';
import { develop, fingerprint, isReceptor, T } from '../lab/organism/develop.mjs';
import { frozenDev } from '../lab/organism/bench.mjs';
import { createOrganism, restoreOrganism } from '../lab/organism/organism.mjs';
import { earFrames, live } from '../lab/organism/environment.mjs';
import { louvain, graphOf, reciprocity, vectorStrength, cvISI, omissionBump, hubProfile } from '../lab/organism/analysis.mjs';
import { createMilieu } from '../lab/organism/milieu.mjs';
import { NE, EAR_CF } from '../being/ear.mjs';
import { createMuscle, impactCost, createImpact, createImpactDetector, createLowBand, BRACE } from '../lab/organism/brace.mjs';
import { oneShots } from '../lab/prototypes/nervous-system/stimuli.mjs';
import { TRAIN, TEST, makeWorld, framesOf } from '../lab/organism/worlds.mjs';
import { MILIEU } from '../lab/organism/milieu.mjs';
import { DT } from '../lab/organism/network.mjs';

const geneIndex = (name) => GENES.findIndex(([n]) => n === name);

test('genome: bounded genes, mutation and crossover stay in range, decoding is within each range', () => {
  const r = lcg(5); let g = randomGenome(1);
  for (let i = 0; i < 50; i++) g = mutate(crossover(g, randomGenome(i + 2), r), r, 0.5, 0.3);
  assert.equal(g.length, NG);
  for (const x of g) assert.ok(x >= 0 && x <= 1);
  const d = decode(g);
  GENES.forEach(([n, lo, hi]) => assert.ok(d[n] >= lo - 1e-9 && d[n] <= hi + 1e-9, n));
});

test('development is deterministic per seed and differs across seeds and genomes', () => {
  const g = randomGenome(3);
  assert.equal(fingerprint(develop(g, 1)), fingerprint(develop(g, 1)));
  assert.notEqual(fingerprint(develop(g, 1)), fingerprint(develop(g, 2)));
  assert.notEqual(fingerprint(develop(g, 1)), fingerprint(develop(randomGenome(4), 1)));
  const d = develop(g, 1);
  assert.ok(d.N >= 300 && d.N <= 650, `N ${d.N}`);
  const per = d.syn.pre.length / d.N; assert.ok(per >= 5 && per <= 40, `synapses per cell ${per}`);
  for (let k = 0; k < d.syn.post.length; k++) assert.ok(!isReceptor(d.type[d.syn.post[k]]), 'receptors receive no synapses');
  // Dale's law holds by construction: one sign per presynaptic cell (isI is per cell, never per synapse)
  assert.equal(d.isI.length, d.N);
});

test('no hand-placed connection: every synapse lies on its own axon, and the graph follows the genes', () => {
  const g = randomGenome(6), d = develop(g, 1), rho = d.G.capture;
  const byCell = new Map(); for (const a of d.axons) { if (!byCell.has(a.cell)) byCell.set(a.cell, []); byCell.get(a.cell).push(a.pts); }
  for (let k = 0; k < d.syn.pre.length; k++) {
    const pre = d.syn.pre[k], post = d.syn.post[k], P = d.pos; let best = Infinity;
    for (const pts of byCell.get(pre) || []) for (let i = 0; i < pts.length; i += 3) best = Math.min(best, Math.hypot(pts[i] - P[3 * post], pts[i + 1] - P[3 * post + 1], pts[i + 2] - P[3 * post + 2]));
    assert.ok(best <= 2 * rho + 1e-6, `synapse ${pre}->${post} is ${best.toFixed(3)} from its axon (capture ${rho.toFixed(3)})`);
  }
  // a morphogen gene (P's reach), a guidance gene (P tropism) and the synapse probability each change the wiring
  for (const name of ['lamP', 'tropPi', 'synDensity']) {
    const g2 = Float64Array.from(g); g2[geneIndex(name)] = (g2[geneIndex(name)] + 0.5) % 1;
    assert.notEqual(fingerprint(develop(g2, 1)), fingerprint(d), name);
  }
  // fewer synapses when the synapse probability gene is at its floor than at its ceiling
  const lo = Float64Array.from(g), hi = Float64Array.from(g); lo[geneIndex('synDensity')] = 0; hi[geneIndex('synDensity')] = 1;
  assert.ok(develop(lo, 1).syn.pre.length < develop(hi, 1).syn.pre.length);
});

// 60 s of mixed stimuli, shared by the balance tests
const MIX = [{ mode: 'silence', dur: 8 }, { mode: 'groove', dur: 16, bpm: 120 }, { mode: 'noise', dur: 8 }, { mode: 'tone', dur: 6 }, { mode: 'scatter', dur: 10 }, { mode: 'poly', dur: 12, bpm: 110 }];
const F = earFrames(MIX, 1);

test('the network settles into a balanced, irregular regime by its own rules (3 seeds, 60 s of mixed stimuli)', () => {
  for (const seed of [1, 2, 3]) {
    const org = createOrganism({ genome: randomGenome(seed), seed });
    const spikes = Array.from({ length: org.dev.N }, () => []);
    const L = live(org, F, { each: (o, f, s) => { if (f > 2500) for (const i of o.C.inter) if (o.net.spk[i]) spikes[i].push(s.t); } });
    const cv = cvISI(spikes);
    console.log(`  seed ${seed}: interneurons ${L.interHz.toFixed(2)} Hz (max 1 s ${L.maxInter1s.toFixed(1)}), all cells ${L.rateHz.toFixed(2)} Hz, CV(ISI) ${cv.toFixed(2)}, alive ${L.died < 0}`);
    assert.ok(L.interHz > 0.5 && L.interHz < 25, `seed ${seed}: mean interneuron rate ${L.interHz}`);
    assert.ok(L.maxInter1s < 60, `seed ${seed}: runaway ${L.maxInter1s} Hz`);
    assert.ok(L.runaway < 0.02, `seed ${seed}: time above 40 Hz ${L.runaway}`);
    assert.ok(cv > 0.5 && cv < 3, `seed ${seed}: CV(ISI) ${cv}`);
  }
});

test('milieu: silence for minutes raises the stimulation need; white noise and the groove move energy as reported', () => {
  const org = createOrganism({ genome: randomGenome(2), seed: 2 });
  live(org, F);                                                      // an experienced organism
  const snap = org.serialize();
  const clone = (sched) => { const o = restoreOrganism(snap); live(o, earFrames(sched, 7)); return o.state(); };
  const quiet = clone([{ mode: 'silence', dur: 120 }]), fed = clone([{ mode: 'groove', dur: 120, bpm: 120 }]);
  console.log(`  need ${snap.milieu.need.toFixed(3)} -> ${quiet.need.toFixed(3)} after 2 min of silence, ${fed.need.toFixed(3)} after 2 min of groove`);
  assert.ok(quiet.need > snap.milieu.need, 'silence raises the need');
  assert.ok(quiet.need > fed.need + 0.05, 'silence starves more than music feeds');
  const groove = clone([{ mode: 'groove', dur: 60, bpm: 120 }]), noise = clone([{ mode: 'noise', dur: 60 }]), scatter = clone([{ mode: 'scatter', dur: 60 }]);
  console.log(`  energy ${snap.milieu.energy.toFixed(3)} -> groove ${groove.energy.toFixed(3)}, white noise ${noise.energy.toFixed(3)}, scattered drums ${scatter.energy.toFixed(3)}`);
  console.log(`  need after 60 s: groove ${groove.need.toFixed(3)}, white noise ${noise.need.toFixed(3)}, scattered ${scatter.need.toFixed(3)}`);
  // what the laws guarantee: white noise feeds no novelty after the hair cells adapt, so it starves more than the groove
  assert.ok(noise.need > groove.need, 'white noise starves more than the groove');
  for (const s of [groove, noise, scatter]) assert.ok(Number.isFinite(s.energy) && s.energy >= 0 && s.energy <= 1);
});

test('starvation quiets the network: firing needs energy, so rest emerges when energy is low', () => {
  const org = createOrganism({ genome: randomGenome(2), seed: 2 });
  live(org, F, { to: 2500 });
  const b = restoreOrganism(org.serialize()); b.milieu.s.energy = 0.05;
  const Fg = earFrames([{ mode: 'groove', dur: 10, bpm: 120 }], 3), fed = restoreOrganism(org.serialize());
  const Lf = live(fed, Fg), Ls = live(b, Fg);
  console.log(`  groove, fed ${Lf.interHz.toFixed(2)} Hz vs starved ${Ls.interHz.toFixed(2)} Hz`);
  assert.ok(Ls.interHz < 0.7 * Lf.interHz);
});

test('analysis: Louvain finds planted communities, reciprocity null and vector strength behave', () => {
  // two dense cliques joined by one edge
  const pre = [], post = [], w = [];
  for (let c = 0; c < 2; c++) for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) if (i !== j) { pre.push(c * 10 + i); post.push(c * 10 + j); w.push(1); }
  pre.push(0); post.push(10); w.push(1);
  const L = louvain({ n: 20, pre, post, w, m: pre.length });
  assert.equal(L.count, 2); assert.ok(L.Q > 0.45);
  const R = reciprocity({ n: 20, pre: Int32Array.from(pre), post: Int32Array.from(post), w, m: pre.length });
  assert.ok(R.r > 0.9);
  assert.ok(vectorStrength([0, 0.5, 1, 1.5, 2], 0.5).vs > 0.99);
  assert.ok(vectorStrength(Array.from({ length: 400 }, (_, i) => i * 0.0371), 0.5).vs < 0.2);
  const g = graphOf(createOrganism({ genome: randomGenome(1), seed: 1 }));
  assert.ok(g.m > 1000);
});

test('serialize and restore continue the same life', () => {
  const org = createOrganism({ genome: randomGenome(4), seed: 4 }); live(org, F, { to: 1500 });
  const snap = JSON.parse(JSON.stringify(org.serialize())), copy = restoreOrganism(snap);
  assert.equal(copy.net.edges().m, org.net.edges().m);
  assert.equal(copy.state().energy, org.state().energy);
  const a = live(org, F, { from: 1500, to: 3000 }), b = live(copy, F, { from: 1500, to: 3000 });
  assert.ok(Math.abs(a.interHz - b.interHz) < 0.5 * Math.max(1, a.interHz), `${a.interHz} vs ${b.interHz}`);   // ear and body re-settle
});

test('cost: the organism (network, body, milieu) runs well under real time', () => {
  const org = createOrganism({ genome: randomGenome(1), seed: 1 }); live(org, F, { to: 1000 });   // warm up the JIT
  const t0 = process.cpuUsage(); live(org, F, { from: 1000, to: F.n });
  const u = process.cpuUsage(t0), ms = (u.user + u.system) / 1000 / ((F.n - 1000) * 0.004);
  console.log(`  ${ms.toFixed(2)} ms of CPU per simulated second (${(ms / 10).toFixed(2)}% of one core); the ear (being/ear.mjs) is extra`);
  assert.ok(ms < 20, `${ms} ms per simulated second`);
});

// ---- the hearing field, the laws of timing, and their controls -------------------------------------------------------------
const setGenes = (g, o) => { const c = Float64Array.from(g); for (const [k, v] of Object.entries(o)) { const [, lo, hi] = GENES[geneIndex(k)]; c[geneIndex(k)] = (v - lo) / (hi - lo); } return c; };

test('the ear spread gene moves hair cells from one placode to the whole skin; tonotopy stays a Q-gradient read-out', () => {
  const g = randomGenome(11), ang = (d) => {
    const P = d.G.dP; let s = 0, n = 0;
    for (let i = 0; i < d.N; i++) if (d.type[i] === T.EAR) { const p = [d.pos[3 * i], d.pos[3 * i + 1], d.pos[3 * i + 2]], l = Math.hypot(...p); s += Math.acos(Math.max(-1, Math.min(1, (p[0] * P[0] + p[1] * P[1] + p[2] * P[2]) / l))); n++; }
    return s / n;
  };
  const one = develop(setGenes(g, { earSpread: 0 }), 1), all = develop(setGenes(g, { earSpread: 1 }), 1);
  console.log(`  mean angle of hair cells from the P source: placode ${ang(one).toFixed(2)} rad, whole skin ${ang(all).toFixed(2)} rad`);
  assert.ok(ang(one) < 0.35 && ang(all) > 1.2);
  // frequency follows the local Q level in both: unit order is Q order
  for (const d of [one, all]) {
    const { dQ, lamQ } = d.morph, q = (i) => Math.exp(-Math.hypot(d.pos[3 * i] - dQ[0], d.pos[3 * i + 1] - dQ[1], d.pos[3 * i + 2] - dQ[2]) / lamQ);
    const cells = []; for (let i = 0; i < d.N; i++) if (d.type[i] === T.EAR) cells.push([d.extra[4 * i], q(i)]);
    cells.sort((a, b) => a[0] - b[0]); for (let k = 1; k < cells.length; k++) assert.ok(cells[k][1] >= cells[k - 1][1] - 1e-9, 'tonotopy by Q');
  }
});

test('a 28-gene genome (evolved before the new genes) decodes to finite values and develops the same organism as before', () => {
  const g = randomGenome(3).slice(0, NG_LEGACY), d = decode(g);
  for (const [n] of GENES) assert.ok(Number.isFinite(d[n]), n);
  assert.equal(d.nOsc, 0); assert.equal(d.earSpread, 0); assert.equal(d.modFeel, 0); assert.ok(Math.abs(d.tauElig - 1) < 1e-9);
  assert.equal(fingerprint(develop(g, 1)), 3736667095);   // the fingerprint of this genome and seed under commit 481fd30
});

test('under a brief impact, a brace in time protects and costs less; a reaction to the impact protects ~nothing', () => {
  // four motor spikes 12 ms apart, starting at offset d from an impact at 0.6 s whose force rises and decays within
  // ~60 ms (brace.mjs: stiffness after the 32 ms electromechanical delay, integrated against the force over the window);
  // energy-equivalent cost of the contraction (milieu costMotor x activation, whole trial) plus the impact's unbraced share
  const trial = (d) => {
    const m = createMuscle(), t0 = 0.6 + d, spikes = [0, 3, 6, 9].map((k) => Math.round((t0 + k * DT) / DT)), s0 = Math.round(0.6 / DT), im = createImpact(1, 0, 0, 0.6); let hold = 0;
    for (let s = 0; s < Math.round(1.2 / DT); s++) { m.step(spikes.includes(s)); hold += MILIEU.costMotor * m.act * DT; if (s >= s0 && !im.done) im.feed(m.stiff); }
    const c = impactCost(1, im.p); return { p: im.p, cost: hold + c.dE + c.dI };
  };
  const timed = trial(-0.08), react = trial(0.012), late = trial(0.04), early = trial(-0.3), none = { cost: impactCost(1, 0).dE + impactCost(1, 0).dI };
  console.log(`  protection timed ${timed.p.toFixed(2)}, reaction 12 ms after ${react.p.toFixed(2)}, 40 ms after ${late.p.toFixed(2)}, 300 ms early ${early.p.toFixed(2)}; cost x1e3 timed ${(1e3 * timed.cost).toFixed(3)}, reaction ${(1e3 * react.cost).toFixed(3)}, late ${(1e3 * late.cost).toFixed(3)}, early ${(1e3 * early.cost).toFixed(3)}, no brace ${(1e3 * none.cost).toFixed(3)}`);
  assert.ok(timed.p > 0.9 && react.p < 0.2 && late.p < 0.02 && early.p < 0.5);
  assert.ok(timed.p > react.p + 0.7, 'a late brace protects less than a timed one');
  assert.ok(react.cost > 1.5 * timed.cost && early.cost > 1.5 * timed.cost && late.cost > none.cost);
  // the protection is read over the window, not at one instant: stiffness while the force peaks counts most
  const pulse = (k0) => { const im = createImpact(1, 0, 0, 0); for (let k = 0; !im.done; k++) im.feed(k >= k0 && k < k0 + 4 ? 1 : 0); return im.p; };
  assert.ok(pulse(2) > 2 * pulse(14), 'stiffness at the force peak counts most');
});

test('co-contraction: staying stiff costs more than brief timed braces for the same protection, fatigues, and drains a body', () => {
  // impacts every 0.5 s for 30 s; one muscle (brace.mjs) either braces with two spikes 80 ms before each impact or is
  // driven at a constant rate; cost: milieu costMotor x activation + costStiff x commanded stiffness squared (energy / s)
  const PER = 0.5, DUR = 30, perS = Math.round(PER / DT), pre = Math.round(0.08 / DT);
  const trial = (spikeAt) => {
    const m = createMuscle(), n = Math.round(DUR / DT), ps = []; let hold = 0, im = null, fat = 0, nf = 0;
    for (let s = 0; s < n; s++) {
      m.step(spikeAt(s)); hold += (MILIEU.costMotor * m.act + MILIEU.costStiff * m.raw * m.raw) * DT;
      if (s * DT >= 2 && s % perS === 0) im = createImpact(1, 0, 0, s * DT);
      if (im && !im.done && im.feed(m.stiff)) ps.push(im.p);
      if (s * DT > 10) { fat += m.fat; nf++; }
    }
    const tail = ps.slice(10); return { p: tail.reduce((a, b) => a + b, 0) / tail.length, hold: hold / DUR, fat: fat / nf };
  };
  const timed = trial((s) => { const j = (s + pre) % perS; return j === 0 || j === 3; });
  const constant = [8, 12, 20, 30, 50].map((every) => ({ every, ...trial((s) => s % every === 0) }));
  const f = (o) => `p ${o.p.toFixed(3)}, fatigue ${o.fat.toFixed(2)}, tension cost x1e3 ${(1e3 * o.hold).toFixed(2)}/s`;
  console.log(`  timed brace: ${f(timed)}; constant: ${constant.map((c) => `every ${4 * c.every} ms ${f(c)}`).join('; ')}; basal income x1e3 ${(1e3 * MILIEU.income).toFixed(1)}/s`);
  const match = constant.filter((c) => c.p >= timed.p - 0.05);
  assert.ok(match.length >= 1, 'some constant drive reaches the timed protection');
  for (const c of match) assert.ok(c.hold > 2 * timed.hold, `constant every ${4 * c.every} ms costs ${c.hold} vs timed ${timed.hold}`);
  const stiffest = constant[0];
  assert.ok(stiffest.fat > 0.5 && timed.fat < 0.15, 'sustained tension fatigues the muscle, brief braces barely');
  const timed4 = trial((s) => { const j = (s + pre) % perS; return j < 12 && j % 3 === 0; });   // a fuller brace: four spikes
  console.log(`  four-spike timed brace: ${f(timed4)}`);
  assert.ok(stiffest.p < timed4.p && stiffest.hold > 5 * timed4.hold, 'a fatigued muscle held stiff protects less than a fuller timed brace, at many times its cost');
  assert.ok(stiffest.hold > 2 * MILIEU.income, 'staying stiff costs more than twice the basal income');
  // in the milieu: the same body, held stiff (commanded 0.8) or bracing briefly (mean squared 0.05), for 60 s
  const G = decode(randomGenome(1)), held = createMilieu(G), brief = createMilieu(G);
  for (let k = 0; k < 60 / DT; k++) { const inp = { dt: DT, rateHz: 3, wireHz: 3, interHz: 3, motor: 0.2, chrom: 0, synMass: 1, strain: 0, stim: 0.5, impact: null }; held.update({ ...inp, stiff2: 0.64 }); brief.update({ ...inp, stiff2: 0.05 }); }
  console.log(`  viability after 60 s: held stiff ${held.s.viability.toFixed(3)} (energy ${held.s.energy.toFixed(3)}), brief braces ${brief.s.viability.toFixed(3)} (energy ${brief.s.energy.toFixed(3)})`);
  assert.ok(held.s.energy < brief.s.energy - 0.5 && held.s.viability < brief.s.viability - 0.15, 'a body held stiff loses viability');
});

test('only strong hits strike: loud hi-hats are heard but never strike; kicks and snares do, >= 250 ms apart', () => {
  const sh = oneShots(), org = createOrganism({ genome: randomGenome(2), seed: 2, gestation: 0 });
  const play = (buf, amp, every, dur) => { let strikes = 0, inter = 0; const chunk = new Float32Array(192); let n = 0; for (let c = 0; c < dur / DT; c++) { for (let i = 0; i < 192; i++, n++) { const k = n % every; chunk[i] = k < buf.length ? amp * buf[k] : 0; } const s = org.step(0, chunk); strikes += s.impact > 0 ? 1 : 0; inter += s.interHz; } return { strikes, inter: inter / (dur / DT) }; };
  const hats = play(sh.hat, 2.4, 6000, 10), kicks = play(sh.kick, 0.8, 24000, 10), snares = play(sh.snare, 0.7, 24000, 10);
  console.log(`  strikes in 10 s: 80 loud hats ${hats.strikes} (interneurons ${hats.inter.toFixed(1)} Hz), 20 kicks ${kicks.strikes}, 20 snares ${snares.strikes}`);
  assert.equal(hats.strikes, 0, 'hats never strike');
  assert.ok(hats.inter > 0.5, 'but they are heard');
  assert.ok(kicks.strikes >= 18 && snares.strikes >= 18, 'kicks and snares strike');
  // in the scored worlds, strikes come at natural intervals
  const iv = [];
  for (const spec of [TRAIN[1], TRAIN[2], TEST[2], TEST[6]]) {
    const Fw = framesOf(makeWorld(spec, 'groove', { dur: 12 })), det = createImpactDetector(), lb = createLowBand(EAR_CF); let last = -1;
    for (let f = 0; f < Fw.n; f++) if (det(Fw.onset[f], lb(Fw.amp.subarray(f * NE, (f + 1) * NE))) > 0) { if (last >= 0) iv.push((f - last) * DT); last = f; }
  }
  iv.sort((a, b) => a - b);
  console.log(`  strike intervals in dense grooves (sync, build): min ${iv[0].toFixed(3)} s, 5th percentile ${iv[Math.floor(0.05 * iv.length)].toFixed(3)} s, median ${iv[iv.length >> 1].toFixed(3)} s (${iv.length})`);
  assert.ok(iv[0] >= BRACE.refr - 1e-9 && iv[Math.floor(0.05 * iv.length)] >= 0.25);
});

test('sound comes from around the body: a receptor hears the channel it faces, mono input drives every receptor as before', () => {
  const g = setGenes(randomGenome(4), { earSpread: 1 }), org = createOrganism({ genome: g, seed: 4, gestation: 0 });
  const lat = (i) => org.dev.pos[3 * i] / Math.hypot(org.dev.pos[3 * i], org.dev.pos[3 * i + 1], org.dev.pos[3 * i + 2]);
  const left = Array.from(org.C.ear).filter((i) => lat(i) < -0.6), right = Array.from(org.C.ear).filter((i) => lat(i) > 0.6);
  assert.ok(left.length >= 3 && right.length >= 3, `${left.length} left-facing, ${right.length} right-facing hair cells`);
  const loud = new Float32Array(NE).fill(0.6), quiet = new Float32Array(NE).fill(0.015);
  const frame = (ampL, ampR, onsetL, onsetR) => ({ amp: ampL, ampL, ampR, onset: Math.max(onsetL, onsetR), onsetL, onsetR, rough: 0, sub: 0, pan: 0 });
  for (let k = 0; k < 50; k++) org.tick(frame(quiet, quiet, 0, 0));
  org.tick(frame(loud, quiet, 6, 0));                                 // a sound from the left only
  const mean = (l) => l.reduce((s, i) => s + org.net.ext[i], 0) / l.length;
  const onL = Array.from(org.C.onset).filter((i) => lat(i) < 0), onR = Array.from(org.C.onset).filter((i) => lat(i) > 0);
  console.log(`  a sound from the left: left-facing hair cells driven at ${mean(left).toFixed(1)} Hz, right-facing ${mean(right).toFixed(1)} Hz`);
  assert.ok(mean(left) > mean(right) + 20, 'the left-facing cells hear it, the right-facing ones barely');
  if (onL.length && onR.length) assert.ok(mean(onL) > mean(onR), 'onset receptors too');
  // mono: both channels equal -> the cardioid gains sum to one, every receptor gets the mono drive
  const a = createOrganism({ genome: g, seed: 4, gestation: 0 }), b = createOrganism({ genome: g, seed: 4, gestation: 0 });
  const amp = Float32Array.from({ length: NE }, (_, k) => 0.02 + 0.3 * Math.abs(Math.sin(k)));
  a.tick({ amp, onset: 3, rough: 0, sub: 0 }); b.tick({ amp, ampL: amp, ampR: amp, onset: 3, onsetL: 3, onsetR: 3, rough: 0, sub: 0, pan: 0 });
  for (const i of [...a.C.ear, ...a.C.onset]) assert.ok(Math.abs(a.net.ext[i] - b.net.ext[i]) < 1e-3, 'mono and centred stereo drive the same');
});

test('wiring economy: a spike costs by its axon arbor, so longer wiring costs more energy at the same firing', () => {
  // the law in the milieu: the same spikes, twice the arbor length
  const G = decode(randomGenome(1)), m1 = createMilieu(G), m2 = createMilieu(G);
  for (let k = 0; k < 2500; k++) { const inp = { dt: DT, rateHz: 3, interHz: 3, motor: 0, chrom: 0, synMass: 1, strain: 0, stim: 0.5, impact: null }; m1.update({ ...inp, wireHz: 3 }); m2.update({ ...inp, wireHz: 6 }); }
  console.log(`  energy after 10 s: arbor x1 ${m1.s.energy.toFixed(4)}, arbor x2 ${m2.s.energy.toFixed(4)} (costWire ${MILIEU.costWire})`);
  assert.ok(m1.s.energy - m2.s.energy > 0.9 * MILIEU.costWire * 3 * 10, 'longer wires cost more');
  // and the arbor follows development: the axon length gene lengthens every cell's arbor (network.mjs: path to its
  // farthest synapse on each branch)
  const arbor = (len) => { const o = createOrganism({ genome: setGenes(randomGenome(3), { axonLen: len }), seed: 3, gestation: 0 }); let s = 0, n = 0; for (const i of o.C.inter) { s += o.net.arbor[i]; n++; } return s / n; };
  const short = arbor(0.4), long = arbor(1.2);
  console.log(`  mean interneuron arbor: axonLen 0.4 -> ${short.toFixed(2)}, 1.2 -> ${long.toFixed(2)}`);
  assert.ok(long > 1.8 * short);
});

test('hub profile: hearing integration sits on the side of a one-sided ear, nearer the nucleus with a whole-skin ear', () => {
  const g = randomGenome(8), one = createOrganism({ genome: setGenes(g, { earSpread: 0 }), seed: 8, gestation: 0 }), all = createOrganism({ genome: setGenes(g, { earSpread: 1 }), seed: 8, gestation: 0 });
  const h1 = hubProfile(one), h2 = hubProfile(all);
  console.log(`  hair cells' centroid ${h1.earOffset.toFixed(2)} vs ${h2.earOffset.toFixed(2)}; hearing integration centroid ${h1.hearOffset.toFixed(2)} vs ${h2.hearOffset.toFixed(2)}; all senses ${h1.offset.toFixed(2)} vs ${h2.offset.toFixed(2)}`);
  assert.ok(h1.earOffset > 0.8 && h2.earOffset < 0.3);
  assert.ok(h1.hearOffset > h2.hearOffset, 'a one-sided ear pulls hearing integration to its side');
  for (const k of ['offset', 'rInt', 'rInter', 'corrRadInt', 'arbor', 'wireOffset']) assert.ok(Number.isFinite(h1[k]), k);
});

// a genome whose development gives resonators sensory input (random genome 3, development seed 3) with its lead gene set
const RES = setGenes(randomGenome(3), { tropM: 0, cbGain: 0 });   // the resonator law alone: no motor trophic field, no cerebellar law

test('omission response: after entraining to a steady pulse, sensory-driven resonators fire at the time of a missing beat', () => {
  const F = earFrames([{ mode: 'rhythm', pattern: 'pulse', bpm: 96, omit: 0.3, dur: 140 }], 3);
  // the resonator law in isolation: the milieu is held as in gestation (this random genome cannot afford its own tension
  // over 140 s under the co-contraction law, and a starved network falls quiet, which is metabolism, not timing)
  const run = (g) => {
    const org = createOrganism({ genome: g, seed: 3 }), net = org.net, qs = Array.from(net.OSC).filter((i) => net.fanS[i] > 0.05), c = new Float32Array(F.n);
    live(org, F, { each: (o, f) => { for (const i of qs) c[f] += net.spk[i]; const m = o.milieu.s; m.energy = 0.8; m.integrity = 0.9; m.alive = true; } });
    return { b: omissionBump(c, F.beats, { cells: qs.length, from: 15 }), hz: qs.map((i) => net.omega[i] / (2 * Math.PI)).sort((a, b) => a - b), n: qs.length };
  };
  const learned = run(setGenes(RES, { oscLead: 0.2 })), frozen = run(setGenes(RES, { oscLead: 0.2, oscK: 0, oscEta: 0 }));
  const med = learned.hz[learned.hz.length >> 1];
  console.log(`  ${learned.n} sensory resonators, median rate ${med.toFixed(2)} Hz (beat 1.60 Hz); bump at omitted beats ${learned.b.bump.toFixed(2)} Hz (z ${learned.b.z.toFixed(1)}, n ${learned.b.n}) vs frozen oscillators ${frozen.b.bump.toFixed(2)} Hz (z ${frozen.b.z.toFixed(1)})`);
  assert.ok(Math.abs(med - 1.6) < 0.2, 'resonators learned the beat');
  assert.ok(learned.b.z > 2.5 && frozen.b.z < 1.5 && learned.b.bump > frozen.b.bump + 1);
});

test('anticipation credit pays only for inhibition in place before an impact: a clock on the beat earns, the same clock on shuffled drums and a reaction do not', () => {
  // the law, tested with a controlled predictor: inhibitory interneurons that synapse onto cells receiving the senses are
  // driven (input current) either 50-15 ms before every beat of the nominal grid (a clock), or 4-40 ms after every impact
  // (a reaction); the drums are a steady rock pattern or the same hits with shuffled intervals
  // (on the network as development leaves it, before gestation: a gestated network can already anticipate a steady
  // groove on its own, which would blur the controlled baseline)
  const g = setGenes(RES, { nOsc: 0, nClock: 0 });
  const run = (shuffle, mode) => {
    const F = earFrames([{ mode: 'rhythm', pattern: 'rock', bpm: 100, shuffle, dur: 40 }], 5), org = createOrganism({ genome: g, seed: 3, gestation: 0 }), net = org.net;
    const e = net.edges(), targets = new Set(); for (let i = 0; i < org.dev.N; i++) if (net.fanS[i] > 0.05) targets.add(i);
    const oracle = [...new Set(Array.from(e.pre).filter((p, k) => org.dev.type[p] === T.INTER && org.dev.isI[p] && targets.has(e.post[k])))].slice(0, 40);
    const due = new Uint8Array(F.n + 20);
    if (mode === 'clock') for (const bt of F.beats) for (let f = Math.round((bt.t - 0.05) / DT); f < Math.round((bt.t - 0.015) / DT); f++) if (f >= 0) due[f] = 1;
    const A = [];
    const L = live(org, F, { each: (o, f, st) => {
      if (mode === 'react' && st.impact > 0) for (let k = 1; k <= 9; k++) due[f + k] = 1;
      for (const i of oracle) net.ext[i] = due[f + 1] ? 3 : 0;
      if (f * DT > 8 && st.impactDone > 0) A.push(o.milieu.s.lastImpact.A);
    } });
    const m = A.reduce((x, y) => x + y, 0) / A.length, se = Math.sqrt(A.reduce((x, y) => x + (y - m) ** 2, 0) / (A.length - 1) / A.length);
    return { m, se, income: L.segs[0].anticIncome / L.segs[0].events, n: oracle.length };
  };
  const clock = run(false, 'clock'), clockShuffled = run(true, 'clock'), react = run(false, 'react'), none = run(false, 'none');
  const f = (x) => `${x.m.toFixed(3)} +- ${x.se.toFixed(3)} (income/impact x1e3 ${(1e3 * x.income).toFixed(3)})`;
  console.log(`  ${clock.n} driven inhibitory cells. anticipation: clock ${f(clock)}; clock on shuffled drums ${f(clockShuffled)}; reaction ${f(react)}; no drive ${f(none)}`);
  assert.ok(clock.m - clockShuffled.m > 3 * Math.hypot(clock.se, clockShuffled.se), 'structure-specific');
  assert.ok(clock.m - react.m > 3 * Math.hypot(clock.se, react.se), 'a reaction is not anticipation');
  assert.ok(Math.abs(react.m - none.m) < 3 * Math.hypot(react.se, none.se) + 0.05, 'a reaction earns what no drive earns');
  assert.ok(clock.income > 2 * clockShuffled.income && clock.income > 2 * react.income);
});

test('emergent anticipation in a genome with resonators (measured, reported, not asserted: it depends on how development wires them)', () => {
  const g = setGenes(RES, { oscLead: 0.18 }), out = [];
  for (const shuffle of [false, true]) {
    const F = earFrames([{ mode: 'rhythm', pattern: 'rock', bpm: 100, shuffle, dur: 40 }], 5), org = createOrganism({ genome: g, seed: 3 }), A = [];
    live(org, F, { each: (o, f, st) => { if (f * DT > 15 && st.impactDone > 0) A.push(o.milieu.s.lastImpact.A); } });
    out.push(A.reduce((x, y) => x + y, 0) / A.length);
  }
  console.log(`  random genome 3 with resonators (lead 0.18 s): anticipation at impacts steady ${out[0].toFixed(3)}, shuffled ${out[1].toFixed(3)}`);
  for (const x of out) assert.ok(Number.isFinite(x));
});

test('a 38-gene genome (evolved before the motor trophic field) develops exactly as with tropM = 0', () => {
  for (const k of [1, 2]) {
    const g = randomGenome(k), short = g.slice(0, NG_TROPHIC), zero = setGenes(g, { tropM: 0, nClock: 0 });
    assert.equal(fingerprint(develop(short, k)), fingerprint(develop(zero, k)));
  }
});

test('the motor trophic field (tropM) draws resonator axons to the motor cells', () => {
  // per genome (with resonators) and development seed: synapses from resonators onto motor cells, and the share of motor
  // cells reachable from a resonator within two synapses
  const wiring = (d) => {
    const out = Array.from({ length: d.N }, () => []); for (let k = 0; k < d.syn.pre.length; k++) out[d.syn.pre[k]].push(d.syn.post[k]);
    const isM = (i) => d.type[i] === T.MOTOR, reach = new Set(); let direct = 0, nM = 0;
    for (let i = 0; i < d.N; i++) { nM += isM(i); if (!(d.osc[2 * i] > 0)) continue; for (const j of out[i]) { if (isM(j)) { direct++; reach.add(j); } for (const k of out[j]) if (isM(k)) reach.add(k); } }
    return { direct, share: reach.size / nM };
  };
  const sum = (t) => { const a = { direct: 0, share: 0 }; for (const k of [1, 2, 3, 4]) { const w = wiring(develop(setGenes(randomGenome(k), { nOsc: 32, tropM: t }), k)); a.direct += w.direct / 4; a.share += w.share / 4; } return a; };
  const off = sum(0), on = sum(1.5);
  console.log(`  resonator -> motor synapses ${off.direct.toFixed(1)} -> ${on.direct.toFixed(1)}; motors within 2 synapses of a resonator ${(100 * off.share).toFixed(0)}% -> ${(100 * on.share).toFixed(0)}%`);
  assert.ok(on.direct > 2 * off.direct, 'more resonator -> motor synapses');
  assert.ok(on.share > off.share + 0.15, 'more motors within two synapses');
});

test('hearing is not a metabolic drain: with the network silenced, loud white noise costs what silence costs', () => {
  // receptor firing is powered by the sense organ (milieu.mjs); under the earlier law the ear's own spikes alone made a
  // groove cost more than the organism's basal income. (White noise: no onsets, so no impacts; impacts cost by brace.mjs)
  const g = randomGenome(2), energyAfter = (sched) => {
    const org = createOrganism({ genome: g, seed: 2, gestation: 0 });
    org.net.lesion(Array.from({ length: org.dev.N }, (_, i) => i).filter((i) => !isReceptor(org.dev.type[i])));
    live(org, earFrames(sched, 4)); return org.state().energy;
  };
  const loud = energyAfter([{ mode: 'noise', dur: 20 }]), quiet = energyAfter([{ mode: 'silence', dur: 20 }]);
  console.log(`  energy after 20 s, network silenced: white noise ${loud.toFixed(4)}, silence ${quiet.toFixed(4)}`);
  assert.ok(Math.abs(loud - quiet) < 0.002, `${loud} vs ${quiet}`);
});

test('a life on a steady groove does not wear the organism down: rate and viability hold against the newborn', () => {
  // the newborn (gestated, plasticity frozen) and the same organism with its laws on each live 120 s of the groove; their
  // last 60 s are compared. And the committed best genome ends its life as viable as it was born. Under the earlier laws
  // the bench's adults fell to a fifth of the newborn's rate and lost a third of its viability (commit fd8f73b)
  const Fg = earFrames([{ mode: 'rhythm', pattern: 'rock', bpm: 120, dur: 120 }], 9), n60 = 60 / DT;
  const best = JSON.parse(fs.readFileSync(new URL('../lab/results/organism-best.json', import.meta.url), 'utf8'));
  for (const [name, g, k] of [['random 2', randomGenome(2), 2], ['random 5', randomGenome(5), 5], ['best', Float64Array.from(best.genome), best.seed]]) {
    const nb = createOrganism({ dev: frozenDev(g, k), seed: k }), ad = createOrganism({ genome: g, seed: k }), v0 = ad.state().viability;
    live(nb, Fg, { to: n60 }); live(ad, Fg, { to: n60 });
    const N = live(nb, Fg, { from: n60 }), A = live(ad, Fg, { from: n60 });
    console.log(`  ${name}: interneurons newborn ${N.interHz.toFixed(2)} Hz, adult ${A.interHz.toFixed(2)} Hz (set point ${ad.G.rTarget.toFixed(2)}); viability at birth ${v0.toFixed(3)}, newborn ${N.viability.toFixed(3)}, adult ${A.viability.toFixed(3)} (end ${ad.state().viability.toFixed(3)})`);
    assert.ok(A.died < 0, 'alive');
    assert.ok(A.interHz > 0.75 * Math.min(N.interHz, ad.G.rTarget), 'the rate holds near the newborn or the set point');
    // an unevolved genome may pay for its learning (a Hebbian transient after birth costs energy); the evolved one may not
    assert.ok(A.viability > N.viability - (name === 'best' ? 0.03 : 0.08), 'viability holds against the newborn');
    if (name === 'best') assert.ok(ad.state().viability > v0 - 0.05, 'the best genome ends its life as viable as it was born');
  }
});
void T;

// ---- watched inside ON (lab/organism/watch.mjs, run by being/worker.mjs) -----------------------------------------------------
test('watch: the ear tap leaves frame() unchanged; the snapshot carries what the dashboard draws', async () => {
  const { createEar } = await import('../being/ear.mjs');
  const { createWatch, transferables } = await import('../lab/organism/watch.mjs');
  const a = createEar(), b = createEar(), w = createWatch({ genome: null, seed: 2 });
  const x = (n) => 0.4 * Math.exp(-((n % 24000) / 48000) * 30) * Math.sin(n * 0.01);   // a hit every 0.5 s
  for (let n = 0; n < 48000 * 3; n++) {
    a.sample(x(n)); b.sample(x(n));
    if (n % 192 === 191) w.tick(b.tap());
    if (n === 48000 * 2.5) w.snapshot();   // someone looks: spikes are collected from here
    if (n % 480 === 479) { const fa = a.frame(), fb = b.frame(); assert.equal(fa.onset, fb.onset); assert.equal(fa.rough, fb.rough); }
  }
  const s = w.snapshot(true), N = w.org.dev.N;
  assert.equal(s.status, 'live'); assert.equal(s.static.N, N); assert.equal(s.static.pos.length, 3 * N); assert.equal(s.static.extra.length, 4 * N);
  assert.ok(s.static.edges.pre.length > 0 && s.static.edges.pre.length === s.static.edges.w.length);
  assert.equal(s.live.rf.length, N); assert.ok(s.live.spikes.length > 0); assert.equal(s.live.chrom.length, w.org.C.chrom.length);
  assert.ok(Number.isFinite(s.live.state.energy) && Number.isFinite(s.live.state.stimNeed));
  assert.ok(s.timing.impacts.length > 0 && s.timing.impacts.every((i) => Number.isFinite(i.leadMs)));
  assert.equal(w.snapshot(false).static, undefined);   // unchanged graph: only its version
  assert.ok(transferables(s).length >= 8);
  console.log(`  develop ${w.developMs.toFixed(0)} ms, ${w.org.dev.N} cells, ${s.timing.impacts.length} impacts, lead ${s.timing.impacts.map((i) => i.leadMs).join(' ')} ms`);
});

test('watch: drive() is compact, bounded and finite, and reports the largest impact since the last call', async () => {
  const { createEar } = await import('../being/ear.mjs');
  const { createWatch } = await import('../lab/organism/watch.mjs');
  const ear = createEar(), w = createWatch({ genome: null, seed: 3 });
  const x = (n) => 0.4 * Math.exp(-((n % 24000) / 48000) * 30) * Math.sin(n * 0.01);   // a hit every 0.5 s
  const fin = (v, a, b) => Number.isFinite(v) && v >= a && v <= b;
  let impacts = 0, drives = 0;
  for (let n = 0; n < 48000 * 3; n++) {
    ear.sample(x(n));
    if (n % 192 === 191) w.tick(ear.tap());
    if (n % 960 === 959) {   // every 20 ms, as the worker posts it
      const d = w.drive(); drives++;
      assert.equal(d.reg.length, 8); assert.ok(d.reg.every((r) => fin(r, 0, 1)));
      assert.ok(fin(d.pulse, 0, 1) && fin(d.motor, 0, 1) && fin(d.brace, 0, 1) && fin(d.impact, 0, Infinity));
      assert.ok(fin(d.chrom[0], 0, 1) && fin(d.chrom[1], 0, 1) && fin(d.chrom[2], 0, 1));
      assert.equal(d.body.pos.length, 3); assert.equal(d.body.modes.length, 5); assert.equal(d.body.omega.length, 3);
      assert.ok([...d.body.pos, ...d.body.modes, ...d.body.omega, d.body.squash, d.body.strain].every(Number.isFinite));
      assert.ok(d.feel.every(Number.isFinite));
      if (d.impact > 0) impacts++;
      assert.ok(JSON.stringify({ ...d, reg: Array.from(d.reg) }).length < 1200);   // small enough for ~60 posts a second
    }
  }
  assert.ok(impacts >= 4 && impacts <= 8, `impacts seen ${impacts} of 6 hits`);   // each hit reported once, not lost between calls
  assert.equal(w.drive().impact, 0);
});
