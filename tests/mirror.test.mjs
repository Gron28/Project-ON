import test from 'node:test';
import assert from 'node:assert/strict';
import { createMirror, createRange, createSpring, effortFor } from '../being/mirror.mjs';
import { createClock, tempoAgree } from '../being/clock.mjs';

const frame = (i, o = {}) => ({ level: .1, centroid: .3, bass: .3, lead: .2, rough: .1, intensity: .5, beat: { count: Math.floor(i / 50), phase: (i % 50) / 50, hz: 2, trust: o.trust ?? .9 }, char: {}, feel: {}, gate: o.gate ?? 1, bounce: o.bounce ?? 1, metric: 1 });

test('range reads a channel against its own song', () => {
  const r = createRange(5, .05);
  for (let i = 0; i < 500; i++) r.step(i % 100 < 50 ? .2 : .4, .01);
  assert.ok(r.rel(.4) > .8 && r.rel(.2) < .2);
});

test('spring peaks soon after a kick and settles', () => {
  const s = createSpring(4, .45); s.kick(1); let pk = 0, at = 0;
  for (let t = 0; t < 2; t += .01) { const y = s.step(.01); if (y > pk) { pk = y; at = t; } }
  assert.ok(pk > .6 && pk < 1.2, 'peak ' + pk); assert.ok(at < .06, 'peak at ' + at); assert.ok(Math.abs(s.y) < .01);
});

test('a heard kick grows the body; a predicted one is only topped up by its hearing', () => {
  const m = createMirror(7); m.newSong(1);
  for (let i = 0; i < 40; i++) m.step(.01, frame(i, { trust: 0 }));
  const before = m.out.size; m.hit('kick', 1, false); let pk = -1;
  for (let i = 40; i < 60; i++) { m.step(.01, frame(i, { trust: 0 })); pk = Math.max(pk, m.out.size); }
  assert.ok(pk - before > .03, 'kick visible: ' + (pk - before));
  const n = createMirror(7); n.newSong(1);
  for (let i = 0; i < 100; i++) n.step(.01, frame(i, { trust: 0 }));
  n.hit('kick', .8, true); n.step(.01, frame(100, { trust: 0 })); const v1 = n.out.size;
  n.hit('kick', .8, false); n.step(.01, frame(101, { trust: 0 }));
  assert.ok(n.out.size <= v1 + .01, 'no double hit');
});

test('nothing moves when the gate is closed (asleep, beads, calm)', () => {
  const m = createMirror(3);
  for (let i = 0; i < 300; i++) { if (i % 25 === 0) m.hit('snare', 1); m.step(.01, frame(i, { gate: 0 })); assert.ok(Math.abs(m.out.size) < 1e-12 && Math.abs(m.out.squash) < 1e-12); }
});

test('the beat surges flow on the beat and keeps its mean pace', () => {
  const m = createMirror(3); let sum = 0, n = 0, early = 0, late = 0;
  for (let i = 0; i < 1000; i++) { m.step(.01, frame(i)); if (i > 200) { sum += m.out.surge; n++; const ph = (i % 50) / 50; if (ph < .1) early += m.out.surge / 5; if (ph > .8) late += m.out.surge / 10; } }
  assert.ok(Math.abs(sum / n - 1) < .08, 'mean ' + sum / n); assert.ok(early > 2 * late);
  for (let i = 0; i < 300; i++) m.step(.01, frame(i, { trust: 0 }));
  assert.ok(Math.abs(m.out.surge - 1) < .02);
});

test('a song keeps its body map and style', () => {
  const m = createMirror(11); m.newSong(42); const st = m.songState();
  const k = createMirror(11); k.newSong(99); k.recall(JSON.parse(JSON.stringify(st)));
  assert.deepEqual(k.map, st.map);
  const a = createMirror(11); a.newSong(42); assert.deepEqual(a.map, st.map, 'deterministic per being and song');
});

test('effort follows the music', () => {
  const heavy = effortFor({ bassWeight: .9, loudness: .8, density: .8, regularity: .9 }, { arousal: .8 });
  const soft = effortFor({ bassWeight: .1, loudness: .2, density: .1, regularity: .2 }, { arousal: .2 });
  assert.ok(heavy.strong > soft.strong && heavy.sudden > soft.sudden && heavy.direct > soft.direct && soft.free > heavy.free);
});

test('clock: the organ leads, a disagreeing analyzer lowers confidence, no drums no trust', () => {
  assert.ok(tempoAgree(120, 120) > .99 && tempoAgree(124, 82.7, { octave: 0 }) < .01 && tempoAgree(120, 60) > .5);
  const c = createClock(); let b;
  for (let i = 0; i < 300; i++) b = c.step(.01, { an: { bpm: 82.7, phase: .3, confidence: 1 }, organ: { fresh: true, confidence: .9, period: 60 / 124, lastBeat: 10, t: 10.5 + i * .01 }, lock: .9, sinceDrum: .2 });
  assert.equal(b.source, 'organ'); assert.ok(Math.abs(b.bpm - 124) < .01);
  const agreed = createClock(); let a;
  for (let i = 0; i < 300; i++) a = agreed.step(.01, { an: { bpm: 124, phase: .3, confidence: 1 }, organ: { fresh: true, confidence: .9, period: 60 / 124, lastBeat: 10, t: 10.5 }, lock: .9, sinceDrum: .2 });
  assert.ok(a.confidence > b.confidence); assert.ok(agreed.trust > .5);
  for (let i = 0; i < 800; i++) agreed.step(.01, { an: { bpm: 124, phase: .3, confidence: 1 }, organ: null, lock: .9, sinceDrum: 10 });
  assert.ok(agreed.trust < .2, 'no drums: ' + agreed.trust);
});

test('moods shape the style, and nothing when the model is off', () => {
  const ch = { density: .5, regularity: .5 };
  const plain = effortFor(ch, {}), none = effortFor(ch, { mood: null });
  assert.deepEqual(plain, none);
  const angry = effortFor(ch, { mood: { aggressive: .9, relaxed: .1 } }), calm = effortFor(ch, { mood: { aggressive: .1, relaxed: .9 } });
  assert.ok(angry.sudden > calm.sudden && angry.strong > calm.strong && calm.free > angry.free);
});

test('a song keeps its signature move; it plays at a peak, and gathering draws the body in', () => {
  const m = createMirror(5); m.newSong(77); const st = m.songState();
  const k = createMirror(5); k.newSong(1); k.recall(st); assert.deepEqual(k.sig, st.sig);
  for (let i = 0; i < 100; i++) m.step(.01, frame(i, { trust: 0 }));
  const s0 = m.out.size; m.signature(1); let moved = 0;
  for (let i = 100; i < 200; i++) { m.step(.01, frame(i, { trust: 0 })); moved = Math.max(moved, Math.abs(m.out.size - s0) + Math.abs(m.out.squash) + Math.abs(m.out.twist)); }
  assert.ok(moved > .03, 'signature visible ' + moved);
  const g = createMirror(5); for (let i = 0; i < 300; i++) g.step(.01, { ...frame(i, { trust: 0 }), anticip: 1 });
  assert.ok(g.out.anticip > .9 && g.out.size < -.03 && g.out.surge < .6);
});

test('hold: inside a section it has played before, boredom never moves an instrument', () => {
  const run = (hold) => { const m = createMirror(4); m.newSong(5); const m0 = m.map;
    for (let i = 0; i < 20000; i++) m.step(.01, { ...frame(i), feel: { bored: 1 }, hold }); return [m0, m.map]; };
  const [a0, a1] = run(true); assert.deepEqual(a1, a0);
  const [b0, b1] = run(false); assert.notDeepEqual(b1, b0, 'without hold a bored mirror remaps');
});

test('poise: absent or 0 is the mirror as before, step for step', () => {
  const run = (o) => { const m = createMirror(5); m.newSong(9); const xs = [];
    for (let i = 0; i < 400; i++) { if (i % 37 === 0) m.hit('kick', .9); if (i % 53 === 0) m.hit('snare', .7, true); m.step(.01, { ...frame(i), ...o }); xs.push(m.out.size, m.out.squash, m.out.dip, m.out.surge); }
    return xs; };
  assert.deepEqual(run({ poise: 0 }), run({}));
});

test('poise: a song it knows startles it less and it gathers deeper before the beat', () => {
  const peakAfterKick = (poise) => { const m = createMirror(7); m.newSong(1);
    for (let i = 0; i < 4000; i++) m.step(.01, { ...frame(i, { trust: 0 }), poise });   // poise eases in over ~8 s
    const before = m.out.size; m.hit('kick', 1, false); let pk = -1;
    for (let i = 400; i < 420; i++) { m.step(.01, { ...frame(i, { trust: 0 }), poise }); pk = Math.max(pk, m.out.size); }
    return pk - before; };
  const p0 = peakAfterKick(0), p1 = peakAfterKick(1);
  assert.ok(p1 < .7 * p0, `unforeseen kick: ${p1} vs ${p0}`);
  const windAt = (poise) => { const m = createMirror(3); for (let i = 0; i < 4000; i++) m.step(.01, { ...frame(i), poise }); for (let i = 4000; i < 4045; i++) m.step(.01, { ...frame(i), poise }); return m.out.wind; };
  assert.ok(windAt(1) < 1.4 * windAt(0), `wind-up deeper: ${windAt(1)} vs ${windAt(0)}`);
});
