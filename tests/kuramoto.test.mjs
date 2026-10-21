// The motor population (kuramoto.mjs) and what is built on it: the mind's lock and cross rhythm, the tissue's closed loop
// (predictable feedback wears paths, lab E11), and the serpents' journeys locked to the bar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPopulation } from '../being/kuramoto.mjs';
import { createMind, traitsFor, mulberry32 } from '../being/mind.mjs';
import { createTissue } from '../being/tissue.mjs';
import { createSerpents } from '../being/flourish.mjs';

const TAU = Math.PI * 2;
function forced(p, sec, gain, { hz = 2.02, fC = 2 } = {}) {
  const d = { phase: 0, hz, gain, w: null }; let r = 0, n = 0;
  for (let f = 0; f < sec * 60; f++) { p.step(1 / 60, { fC, spread: 0.025, K: 0.75, drives: gain > 0 ? [d] : [] }); if (f > sec * 30) { r += p.order().r; n++; } }
  return r / n;
}

test('kuramoto: a forced population locks, drifts apart without its drive, and holds on longer than it caught hold', () => {
  const p = createPopulation({ seed: 3 });
  forced(p, 10, 0);
  assert.ok(forced(p, 10, 0) < 0.35, 'incoherent without a drive');
  assert.ok(forced(p, 8, 3) > 0.9, 'locked under a strong drive');
  let t = 0; while (t < 20 && p.order().r > 0.35) { forced(p, 1 / 6, 0); t += 1 / 6; }
  assert.ok(t > 0.5 && t < 8, `afterglow ${t.toFixed(1)} s`);
  // hysteresis: the same middling drive holds more of a population that was locked than it gathers from scratch
  const up = createPopulation({ seed: 3 }), down = createPopulation({ seed: 3 });
  forced(up, 10, 0); forced(down, 8, 3);
  let ru = 0, rd = 0; for (const g of [0.4, 0.5, 0.6]) { ru += forced(up, 6, g); rd += forced(down, 6, g); }
  assert.ok(rd >= ru - 0.05, `down ${rd.toFixed(2)} vs up ${ru.toFixed(2)}`);
});

test('mind: a fast pulse (above its own octave) is held at half time, steadily', () => {
  const m = createMind(traitsFor(7));   // f0 ~1.6 Hz: a 3 Hz pulse folds to 1.5 Hz
  play(m, 12, [[3, 1]]);
  assert.ok(m.lock > 0.7, `lock ${m.lock}`);
  assert.ok(Math.abs(m.pulseHz - 1.5) < 0.1, `pulse ${m.pulseHz}`);
});

const frame = (level, onset) => ({ amp: new Float32Array(28).fill(0.05), mu: new Float32Array(28), onset, rough: 0, sub: 0, level, hum: 0 });
function play(m, sec, pulses, t0 = 0) {
  let t = t0;
  for (let f = 0; f < sec * 60; f++) { t += 1 / 60; let o = 0; for (const [hz, a] of pulses) if ((t * hz) % 1 < (hz / 60) * 1.01) o = Math.max(o, a);
    m.step(1 / 60, frame(pulses.length ? 0.3 : 0, o), o, { intensity: pulses.length ? 0.6 : 0 }); }
  return t;
}

test('mind: a steady pulse claims the whole body; a cross pulse claims part of it; silence lets go within seconds', () => {
  const m = createMind(traitsFor(7));
  let t = play(m, 8, [[2, 1]]);
  assert.ok(m.lock > 0.8 && m.crossPulse < 0.1, `steady: lock ${m.lock}, cross ${m.crossPulse}`);
  assert.ok(Math.max(...m.regions.cross) < 0.1, 'no region holds a cross pulse in a steady one');
  let held = 0, lockSum = 0, n = 0;
  for (let k = 0; k < 10; k++) { t = play(m, 1, [[2, 1], [3, 0.9]], t); if (k >= 3) { held += Math.max(...m.regions.cross); lockSum += m.lock; n++; } }
  assert.ok(m.crossPulse > 0.3, `cross pulse felt: ${m.crossPulse}`);
  assert.ok(held / n > 0.3, `part of the body holds it: ${(held / n).toFixed(2)}`);
  assert.ok(lockSum / n > 0.4, `the rest keeps the main pulse: ${(lockSum / n).toFixed(2)}`);
  t = play(m, 4, [[2, 1]], t);
  play(m, 5, [], t);
  assert.ok(m.lock < 0.2, `lets go in silence: ${m.lock}`);
});

test('tissue: predictable feedback wears its stamp\'s paths more than noise does (lab E11); plasticity off changes nothing', () => {
  const train = (cond) => {
    const t = createTissue({ rng: mulberry32(7), plastic: 0.05 }), drive = new Float64Array(28);
    for (let s = 0; s < 7500; s++) {   // 30 s
      for (let k = 0; k < 28; k++) drive[k] = 0.0015 * (1 + Math.sin(s * 0.004 * (0.7 + 0.13 * k) + k)) * (s % 125 < 20 ? 2 : 1);
      if (s % 125 === 0) { if (cond === 'pattern') t.pattern(0, 1); else t.noise(1); }
      t.step(drive);
    }
    let w = 0; for (const i of t.stamps[0]) for (let e = 0; e < 10; e++) w += t.weights[i * 10 + e];
    return w / (t.stamps[0].length * 10);
  };
  const p = train('pattern'), n = train('noise');
  assert.ok(p > n + 0.05, `stamp weights: pattern ${p.toFixed(3)} vs noise ${n.toFixed(3)}`);
  const a = createTissue({ rng: mulberry32(3) }), b = createTissue({ rng: mulberry32(3), plastic: 0 });
  const d = new Float64Array(28).fill(0.003);
  for (let s = 0; s < 500; s++) assert.equal(a.step(d), b.step(d));
});

test('serpents: with a felt bar their journeys take whole bars and come back into the nucleus on the one', () => {
  const S = createSerpents(mulberry32(4)); S.show(0.36, 2, { kind: 'ring', n: 1, bars: 16 });
  const sn = S.snakes[0], hz = 2, offs = [];
  let t = 0, prev = null;
  for (let f = 0; f < 60 * 30; f++) {
    t += 1 / 60; const bars = (t * hz) / 4;
    S.step(1 / 60, t, { lock: 0.9, groove: 0.8, regularity: 0.9, change: 0.1, pulseHz: hz, beat: 0, drop: 0, mercury: 0, awake: 1, shellR: 0.36, bars, perBar: 4 });
    if (!S.episode) break;
    const x = sn.x;   // the head is back in the nucleus when x crosses 1
    if (prev !== null && prev < 1 && x >= 1 && t > 12) { const o = bars - Math.round(bars); offs.push(Math.abs(o)); }
    prev = x;
  }
  assert.ok(offs.length >= 2, `passes seen: ${offs.length}`);
  for (const o of offs) assert.ok(o < 0.08, `dives in ${o.toFixed(3)} bars off the one`);
});
