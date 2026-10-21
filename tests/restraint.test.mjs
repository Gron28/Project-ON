// Restraint: the maximalism level M opens only at peaks and cannot be held by steady excitement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMaxim } from '../being/restraint.mjs';

const run = (mx, sec, s, dt = 1 / 60) => { const out = []; for (let t = 0; t < sec; t += dt) out.push(mx.want(dt, typeof s === 'function' ? s(t) : s)); return out; };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

test('restraint: a steady loud, grooving song does not stay maximal (24/7 maximalism)', () => {
  const mx = createMaxim();
  const M = run(mx, 180, { arousal: 0.97, groove: 0.8 });
  assert.ok(mean(M.slice(60 * 20)) < 0.25, `mean M after the first 20 s ${mean(M.slice(60 * 20))}`);
  assert.ok(Math.max(...M.slice(60 * 12)) < 0.3, 'never maximal after the first seconds');
});

test('restraint: a rise out of calm into a climax opens it, then it closes again', () => {
  const mx = createMaxim();
  run(mx, 60, { arousal: 0.4, groove: 0.3 });
  const M = run(mx, 40, { arousal: 0.97, groove: 0.8 });
  assert.ok(Math.max(...M) > 0.6, `opens at the climax: ${Math.max(...M)}`);
  assert.ok(M[M.length - 1] < 0.3, `closes while the excitement is held: ${M[M.length - 1]}`);
});

test('restraint: a slow build that stays above its level tires the opening (it cannot be held)', () => {
  const mx = createMaxim({ tauSlow: 200 });
  run(mx, 30, { arousal: 0.3, groove: 0.3 });
  const M = run(mx, 40, { arousal: 0.98, groove: 0.9 });
  assert.ok(Math.max(...M.slice(0, 600)) > 0.5, 'opens first');
  assert.ok(mean(M.slice(60 * 20)) < 0.3, `then tires: ${mean(M.slice(60 * 20))}`);
});

test('restraint: drops and chills always open it, silence and beads close it', () => {
  const mx = createMaxim();
  assert.ok(mx.want(1 / 60, { arousal: 0.3, groove: 0.1, drop: 1 }) > 0.95);
  assert.ok(Math.abs(mx.want(1 / 60, { arousal: 0.3, groove: 0.1, chill: 1 }) - (0.15 + 0.85 * 0.9)) < 1e-9);
  assert.ok(mx.want(1 / 60, { arousal: 0.3, drop: 1, sleep: 1 }) < 1e-9);
  assert.equal(mx.want(1 / 60, { arousal: 0.3, drop: 1, beads: true }), 0.05);
});

test('restraint: resting level is the base, and bad numbers cannot break it', () => {
  const mx = createMaxim();
  assert.equal(mx.want(1 / 60, { arousal: 0.2, groove: 0 }), 0.15);
  for (const dt of [NaN, -1, 0, Infinity]) assert.ok(Number.isFinite(mx.want(dt, { arousal: NaN, groove: Infinity, drop: NaN, chill: NaN, sleep: NaN })));
  assert.ok(Number.isFinite(run(mx, 5, { arousal: 0.5, groove: 0.5 }).pop()));
});
