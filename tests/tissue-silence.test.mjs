// The tissue's silence (lab E09): with a wandering set point it has slow up and down states (a 1/f-like spectrum), stays
// structured (not noise, not periodic) and near critical; under sound it behaves as it did without the wander.
import test from 'node:test';
import assert from 'node:assert/strict';
import { silentActivity, measure } from '../lab/experiments/09-silent-tissue.mjs';
import { mulberry32 } from '../being/mind.mjs';

test('silence: homeostasis alone has no slow waves; a wandering set point gives a 1/f-like spectrum', () => {
  const plain = measure(silentActivity({ seconds: 70, warm: 12, seed: 99 }));
  const wandering = measure(silentActivity({ seconds: 70, warm: 12, seed: 99, tissueOpts: { wander: 0.7 } }));
  assert.ok(plain.spectralSlope > -0.4, `homeostasis alone is flat at slow scales (${plain.spectralSlope})`);
  assert.ok(wandering.spectralSlope < -0.5 && wandering.spectralSlope > -1.6, `wandering is 1/f-like (${wandering.spectralSlope})`);
  assert.ok(wandering.lzRatio < 0.5, `structured, not noise (LZ ${wandering.lzRatio} of its own shuffle)`);
  assert.ok(wandering.lz > 3 * wandering.lzPeriodic, 'not a metronome');
  assert.ok(wandering.mr > 0.85 && wandering.mr < 1.02, `near critical (m ${wandering.mr})`);
  assert.ok(wandering.count > 50, 'it has avalanches');
  assert.ok(wandering.mean > 15 && wandering.mean < 50, `the rate stays near its target (${wandering.mean} cells a step)`);
});

test('under sound the wander stays out of the way', () => {
  const noise = (seed) => { const r = mulberry32(seed); return () => (r() - 0.5) * 0.6; };
  const a = measure(silentActivity({ seconds: 40, warm: 15, seed: 3, input: noise(1) }));
  const b = measure(silentActivity({ seconds: 40, warm: 15, seed: 3, input: noise(1), tissueOpts: { wander: 0.7 } }));
  assert.ok(Math.abs(b.mean - a.mean) / a.mean < 0.1, `rate under sound: ${a.mean} vs ${b.mean}`);
  assert.ok(Math.abs(b.cv - a.cv) < 0.15, `variability under sound: ${a.cv} vs ${b.cv}`);
});

test('a wander of 0 is the old tissue, step for step', () => {
  const a = silentActivity({ seconds: 5, warm: 1, seed: 11 }), b = silentActivity({ seconds: 5, warm: 1, seed: 11, tissueOpts: { wander: 0 } });
  assert.deepEqual(a, b);
});
