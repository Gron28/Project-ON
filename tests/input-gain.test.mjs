import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInputGain } from '../being/input-gain.mjs';

const sine = (amp, n = 480, f = 220, sr = 48000, t0 = 0) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin(2 * Math.PI * f * (t0 + i / sr)));
const run = (g, amp, sec) => { let t = 0; for (let k = 0; k < sec * 100; k++) { g.step(sine(amp, 480, 220, 48000, t)); t += 0.01; } };

test('input gain: a quiet stream is lifted to the target, slowly, and a loud one is left alone', () => {
  const g = createInputGain();
  run(g, 0.01, 1);
  assert.ok(g.gain > 1.5 && g.gain < 4, `6 dB/s at most: after 1 s gain ${g.gain.toFixed(2)}`);
  run(g, 0.01, 30);
  // the follower holds the loudest 10 ms chunk, a little above the sine's RMS, so the settled level sits a little under the target
  assert.ok(Math.abs(g.gain * 0.01 / Math.SQRT2 - 0.25) < 0.04, `settles so the peak sits at the target: ${(g.gain * 0.01 / Math.SQRT2).toFixed(3)}`);
  const loud = createInputGain(); run(loud, 0.5, 5);
  assert.equal(loud.gain, 1);
});

test('input gain: dynamics inside a song are kept (a quiet passage after a loud one is not pumped up), silence holds', () => {
  const g = createInputGain();
  run(g, 0.02, 40); const settled = g.gain;
  run(g, 0.005, 8);   // a quiet passage
  assert.ok(g.gain < settled * 1.3, `8 s of a quiet passage lifts the gain by ${(g.gain / settled).toFixed(2)}x only`);
  run(g, 0, 10); const before = g.gain; run(g, 0, 20);
  assert.equal(g.gain, before, 'silence changes nothing');
});

test('input gain: apply scales the chunk in place by the current gain', () => {
  const g = createInputGain(); run(g, 0.01, 20);
  const x = Float32Array.from([0.01, -0.01]); const k = g.apply(x);
  assert.ok(k > 1, `gain ${k}`);
  assert.ok(Math.abs(x[0] - 0.01 * k) < 1e-6 && Math.abs(x[1] + 0.01 * k) < 1e-6, `scaled: ${x[0]} ${x[1]} by ${k}`);
});
