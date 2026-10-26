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

test('without the refresh rate (Linux X11 reports 0), jitter and catch-up frames are not taken for a fast display', () => {
  const Q = createGovernor(), c = start();
  let s = 1; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 6000; i++) {   // 100 s at 60 Hz: +-1.5 ms of jitter, and about once a second a late frame and its catch-up
    const fts = i % 60 === 59 ? [25, 8.4] : [16.7 + (rnd() - .5) * 3];
    for (const ft of fts) { c.now += ft; c.t += ft / 1000; governorStep(Q, ft, 1.2, c.now, c.t); }
  }
  assert.equal(Q.cap, 0); assert.equal(Q.k, 1); assert.equal(Q.bake, 2);
  assert.ok(Q.iv > 14, `learned interval ${Q.iv.toFixed(1)} ms`);
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

// the rich rungs: a GPU time that grows with the body's pixel count (base + body x k^2), measured each frame
function runGpu(Q, ms, ft, base, body, clock, log = []) {
  for (let el = 0; el < ms; el += ft) { Q.gpu = base + body * Math.max(1, Q.k) ** 2; clock.now += ft; clock.t += ft / 1000; const r = governorStep(Q, ft, 1, clock.now, clock.t); if (r) log.push([r, Q.k, Q.bake]); }
  return log;
}

test('with GPU room on 60 Hz it bakes every frame, then supersamples as far as half the interval allows', () => {
  const Q = createGovernor(), c = start();
  const log = runGpu(Q, 120000, 16.7, 1, 1.8, c);
  assert.deepEqual(log[0], ['step', 1, 1], 'the skin first');
  assert.equal(Q.k, 1.75, 'stops before 2x, which is predicted to pass half the interval');
  assert.ok(1 + 1.8 * Q.k ** 2 < 16.7 * LADDER.richBudget);
});

test('without a measured GPU time it never goes above the designed picture', () => {
  const Q = createGovernor(), c = start(); Q.gpu = NaN;
  run(Q, 120000, 16.7, 1, c);
  assert.equal(Q.k, 1); assert.equal(Q.bake, 2);
});

test('a heavier GPU gives the rich rungs back a step at a time; late frames give them all back at once', () => {
  const Q = createGovernor(), c = start();
  runGpu(Q, 120000, 16.7, 1, 1.8, c);
  assert.ok(Q.k > 1.5);
  runGpu(Q, 10000, 16.7, 1, 4.5, c);   // something else now costs the GPU more: still on time, but near the interval
  assert.ok(Q.k <= 1.5 && 1 + 4.5 * Q.k ** 2 < 16.7 * LADDER.heavy, `stepped down to ${Q.k}`);
  runGpu(Q, 120000, 16.7, 1, 1.8, c);
  assert.ok(Q.k > 1);
  run(Q, 2000, 33.4, 1, c);
  assert.equal(Q.k, 1); assert.equal(Q.bake, 2);
});

test('a lowered slider (light) or sharp: no rich rungs', () => {
  const Q = createGovernor(), c = start(); Q.res = .8;
  runGpu(Q, 60000, 16.7, 1, 1, c);
  assert.ok(Q.k <= .8); assert.equal(Q.bake, 2);
  Q.auto = false; Q.res = 1; Q.k = 1.5; Q.bake = 1; governorStep(Q, 16.7, 1, c.now, c.t);
  assert.equal(Q.k, 1); assert.equal(Q.bake, 2);
});

test('a costly material arriving while supersampled gives the rich rungs back on the next frame, before frames run late', () => {
  const Q = createGovernor(), c = start();
  runGpu(Q, 120000, 16.7, 1, 1.8, c);
  assert.ok(Q.k > 1.5);
  const log = runGpu(Q, 20, 16.7, 1, 8.4, c);   // a gem: the body costs ~5x
  assert.deepEqual(log[0], ['res', 1, 2]);
});
