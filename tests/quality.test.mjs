// the governor (being/page/quality.mjs): eases unseen work before resolution, comes back on a 60 Hz display, ignores a busy CPU
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGovernor, governorStep, LADDER } from '../being/page/quality.mjs';

// run frames of interval ft (ms) and page work cpu (ms) for a duration (ms), starting after the warm-up
function run(Q, ms, ft, cpu = 3, clock) {
  const log = [];
  for (let el = 0; el < ms; el += ft) { clock.now += ft; clock.t += ft / 1000; const r = governorStep(Q, ft, cpu, clock.now, clock.t); if (r) log.push([r, Q.k, Q.cap, Q.bake]); }
  return log;
}
const start = () => ({ now: 0, t: LADDER.warmS + 1 });

test('on a 60 Hz display, on-time frames never lower anything', () => {
  const Q = createGovernor(), c = start();
  run(Q, 60000, 16.7, 3, c);
  assert.equal(Q.k, 1); assert.equal(Q.cap, 0); assert.equal(Q.bake, 2);
});

test('sustained lateness on 60 Hz: the skin bakes slower before the resolution drops, then the resolution, not below 0.5', () => {
  const Q = createGovernor(), c = start();
  run(Q, 3000, 16.7, 3, c);   // learn the display
  const log = run(Q, 30000, 33.4, 3, c);
  assert.deepEqual(log[0].slice(0, 4), ['step', 1, 0, 3], 'the first rung is the bake rate, not the resolution (no cap on 60 Hz)');
  assert.equal(log[1][0], 'res');
  assert.ok(Q.k >= .5 && Q.k < 1);
  run(Q, 60000, 33.4, 3, c);
  assert.equal(Q.k, .5);
});

test('on a fast display the first rung is drawing every other refresh', () => {
  const Q = createGovernor(), c = start();
  run(Q, 3000, 8.33, 2, c);
  const log = run(Q, 3000, 20, 2, c);
  assert.equal(log[0][0], 'step'); assert.equal(Q.cap, 1); assert.equal(Q.k, 1);
});

test('after the load passes it climbs back to full resolution on a 60 Hz display (the old governor never did)', () => {
  const Q = createGovernor(), c = start();
  run(Q, 3000, 16.7, 3, c);
  run(Q, 20000, 33.4, 3, c);
  assert.ok(Q.k < 1);
  run(Q, 400000, 16.7, 3, c);
  assert.equal(Q.k, 1); assert.equal(Q.bake, 2); assert.equal(Q.cap, 0);
});

test('long frames while the page itself is busy (CPU) do not blur the picture', () => {
  const Q = createGovernor(), c = start();
  run(Q, 3000, 16.7, 3, c);
  run(Q, 30000, 40, 30, c);
  assert.equal(Q.k, 1); assert.equal(Q.bake, 2);
});

test('start-up and hidden-window gaps are ignored', () => {
  const Q = createGovernor(), c = { now: 0, t: 0 };
  for (let i = 0; i < 200; i++) { c.now += 50; c.t += .02; governorStep(Q, 50, 3, c.now, c.t); }   // first seconds: compiles, loads
  assert.equal(Q.k, 1);
  const c2 = start(); run(Q, 3000, 16.7, 3, c2); run(Q, 20000, 2000, 3, c2);
  assert.equal(Q.k, 1);
});

test('sharp and light: the slider, nothing else', () => {
  const Q = createGovernor(); Q.auto = false; Q.res = .6; Q.cap = 1; Q.bake = 3;
  assert.equal(governorStep(Q, 50, 3, 100, 10), 'res');
  assert.equal(Q.k, .6); assert.equal(Q.cap, 0); assert.equal(Q.bake, 2);
  assert.equal(governorStep(Q, 50, 3, 150, 10), '');
});

test('a climb that does not hold waits longer before the next one', () => {
  const Q = createGovernor(), c = start();
  run(Q, 3000, 16.7, 3, c);
  run(Q, 20000, 33.4, 3, c);   // down a few rungs
  const w0 = Q.wait;
  // alternate: on time long enough to climb, then late right after
  for (let i = 0; i < 3; i++) { run(Q, Q.wait + 500, 16.7, 3, c); run(Q, 2600, 33.4, 3, c); }
  assert.ok(Q.wait > w0, `wait grew (${w0} -> ${Q.wait})`);
});
