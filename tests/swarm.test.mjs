import test from 'node:test';
import assert from 'node:assert/strict';
import { createPressure } from '../being/pressure.mjs';
import { organismFor, validOrganism, anchorsAt, MAX_SPECIES } from '../lab/prototypes/organism.mjs';

const run = (p, seconds, s, dt = 0.05) => { const ev = []; for (let t = 0; t < seconds; t += dt) for (const e of p.step(dt, s)) ev.push({ ...e, t }); return ev; };
const CALM = { arousal: 0.4, aHome: 0.4, anticipation: 0, groove: 0.2, energy: 0.8, loud: 0.5 };
const WILD = { arousal: 0.95, aHome: 0.35, anticipation: 0.5, groove: 0.8, energy: 0.6, loud: 0.9 };

test('calm music never bursts the body', () => {
  const p = createPressure();
  const ev = run(p, 600, CALM);
  assert.equal(ev.filter((e) => e.type === 'burst').length, 0);
  assert.ok(p.pressure < 0.5, `pressure ${p.pressure}`);
});

test('sustained excitement sheds jets first, then bursts, then gathers back', () => {
  const p = createPressure();
  const ev = run(p, 240, WILD);
  const firstJet = ev.find((e) => e.type === 'jet'), burst = ev.find((e) => e.type === 'burst'), gather = ev.find((e) => e.type === 'gather');
  assert.ok(firstJet && burst && gather, JSON.stringify(ev.map((e) => e.type)));
  assert.ok(firstJet.t < burst.t, 'jets foreshadow the burst');
  assert.ok(burst.t > 20, `not instant: ${burst.t}`);
  assert.ok(gather.t - burst.t >= 20 && gather.t - burst.t <= 91, `swarm lived ${gather.t - burst.t}`);
});

test('after a burst the skin is stronger for minutes (rare bursts)', () => {
  const p = createPressure();
  const ev = run(p, 600, WILD);
  const bursts = ev.filter((e) => e.type === 'burst');
  assert.ok(bursts.length >= 1 && bursts.length <= 3, `bursts in 10 min of wild music: ${bursts.length}`);
  for (let i = 1; i < bursts.length; i++) assert.ok(bursts[i].t - bursts[i - 1].t > 120, 'refractory');
});

test('a drop bursts a pressured body, not a calm one', () => {
  const calm = createPressure();
  run(calm, 30, CALM);
  assert.equal(calm.step(0.05, { ...CALM, drop: true }).length, 0);
  const tense = createPressure();
  let saw = false;
  for (let t = 0; t < 200 && !saw; t += 0.05) { const s = { ...WILD, drop: tense.pressure > 0.62 }; saw = tense.step(0.05, s).some((e) => e.type === 'burst') && tense.pressure < 1; }
  assert.ok(saw, 'a drop at high pressure bursts before the limit');
});

test('pressure survives garbage', () => {
  const p = createPressure();
  for (let i = 0; i < 100; i++) p.step(NaN, { arousal: NaN, energy: Infinity, loud: -3 });
  assert.ok(Number.isFinite(p.pressure));
  p.restore({ v: 1, charge: 'x', tension: NaN });
  assert.ok(Number.isFinite(p.pressure));
});

test('every song grows a valid organism, different per song, same for the same song', () => {
  const a = organismFor({ intricacy: 0.9, harmony: 0.8 }, 11, 3, 0.5), b = organismFor({ intricacy: 0.9, harmony: 0.8 }, 11, 3, 0.5);
  assert.deepEqual(a, b);
  assert.ok(validOrganism(a));
  assert.ok(a.S >= 4 && a.S <= MAX_SPECIES);
  assert.equal(a.species[0].role, 'core'); assert.equal(a.species[1].role, 'membrane');
  assert.ok(Math.abs(a.species.reduce((s, x) => s + x.share, 0) - 1) < 1e-3);
  const c = organismFor({ intricacy: 0.1, roughness: 0.9, change: 0.9 }, 12, 3, 0.5);
  assert.notDeepEqual(a.M, c.M);
  assert.ok(validOrganism(organismFor(null, 1, 1)));
  assert.equal(validOrganism({ v: 2, S: 3, M: [[1]] }), null);
  // organelles have their own centres inside the cell; the rest are centred
  const anc = anchorsAt(a, 3.7);
  a.species.forEach((s, i) => { const d = Math.hypot(...anc[i]); if (s.anchor) assert.ok(d > 0.1 * a.R && d < a.R, `${s.role} anchor ${d}`); else assert.equal(d, 0); });
});
