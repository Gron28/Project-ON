import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEar, ENV_BANDS, ENV_COLS } from '../brain/ear.mjs';
import { createEye, EYE_W, EYE_H } from '../brain/eye.mjs';
import { createPlasticity } from '../brain/plasticity.mjs';
import { FlyBrain } from '../brain/lif.mjs';

const groups = { 'JO-A': Uint32Array.from([0, 1, 2, 3]), 'JO-B': Uint32Array.from([4, 5, 6]), 'JO-C': Uint32Array.from([7]), 'JO-D': Uint32Array.from([8]), 'JO-E': Uint32Array.from([9]), 'JO-F': Uint32Array.from([10]) };

test('ear: silence gives spontaneous rate only, sound raises the tuned group', () => {
  const ear = createEar(groups, null, { spont: 2 });
  const env = new Float32Array(ENV_COLS);
  for (let i = 0; i < 1000; i++) ear.push(env, 0);
  assert.ok(ear.rates.every((r) => Math.abs(r - 2) < 1e-6));
  env[4] = 0.1; env[ENV_BANDS + 4] = 0.1; // 350-500 Hz on both antennae
  for (let i = 0; i < 100; i++) ear.push(env, 0);
  const a = ear.rates[0]; // JO-A neuron 0 listens to band 4
  assert.ok(a > 20, `JO-A on its band fires: ${a}`);
  assert.ok(ear.rates[4] < 5, 'JO-B stays near spontaneous');
});

test('ear adapts: a sustained sound gets quieter over seconds but not silent', () => {
  const ear = createEar(groups);
  const env = new Float32Array(ENV_COLS).fill(0.1);
  for (let i = 0; i < 100; i++) ear.push(env, 0);
  const early = ear.rates[0];
  for (let i = 0; i < 8000; i++) ear.push(env, 0);
  const late = ear.rates[0];
  assert.ok(late < early, `adapted ${early} -> ${late}`);
  assert.ok(late > 10);
});

test('ear: each antenna hears its own channel', () => {
  const side = Int8Array.from([-1, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1]);
  const ear = createEar(groups, side);
  const env = new Float32Array(ENV_COLS);
  env[4] = 0.1; // left antenna only, 350-500 Hz
  for (let i = 0; i < 200; i++) ear.push(env, 0);
  assert.ok(ear.rates[0] > 20, `left JO-A hears: ${ear.rates[0]}`);
  assert.ok(ear.rates[1] < 5, `right JO-A does not: ${ear.rates[1]}`);
});

test('eye: receptors are laid out retinotopically and respond to change more than to steady light', () => {
  const n = 200, pos = new Float32Array(n * 3), side = new Int8Array(n), ids = new Uint32Array(n);
  for (let i = 0; i < n; i++) { ids[i] = i; side[i] = i < 100 ? -1 : 1; pos[i * 3] = (i % 10) * 10 + (i < 100 ? 0 : 500); pos[i * 3 + 1] = Math.floor((i % 100) / 10) * 10; pos[i * 3 + 2] = 0.1 * i; }
  const eye = createEye(pos, side, ids);
  assert.ok(eye.u.subarray(0, 100).every((u) => u <= 0.5) && eye.u.subarray(100).every((u) => u >= 0.5), 'left eye on the left half');
  const img = new Uint8Array(EYE_W * EYE_H);
  for (let k = 0; k < 20; k++) eye.see(img);
  img.fill(255);
  eye.see(img);
  const onset = eye.rates.reduce((a, b) => a + b, 0) / n;
  for (let k = 0; k < 60; k++) eye.see(img);
  const steady = eye.rates.reduce((a, b) => a + b, 0) / n;
  assert.ok(onset > steady * 2, `onset ${onset} vs steady ${steady}`);
  assert.ok(steady > 0);
});

test('plasticity: dopamine after presynaptic activity depresses synapses onto the targets, then they recover', () => {
  // 0 -> 1 (avoid MBON), 2 -> 3 (descending); PAM = neuron 4, PPL1 = neuron 5
  const N = 6;
  const brain = { N, E: 2, rowPtr: Uint32Array.from([0, 1, 1, 2, 2, 2, 2]), col: Uint32Array.from([1, 3]), w: Int16Array.from([20, 20]), sign: Int8Array.from([1, 1, 1, 1, 1, 1]),
    groups: { 'MBON-avoid': Uint32Array.from([1]), 'MBON-approach': new Uint32Array(0), DN: Uint32Array.from([3]), PAM: Uint32Array.from([4]), PPL1: Uint32Array.from([5]) } };
  const fly = new FlyBrain(brain, { dt: 0.5 });
  const pl = createPlasticity(brain, fly, { tauRecover: 2000 });
  assert.equal(pl.stats.edges, 2);
  const w0 = fly.wmv[0], w1 = fly.wmv[1];
  // neuron 0 active, then reward dopamine: its synapse onto the avoid-MBON weakens; DN synapse unchanged (no punishment, 2 not active)
  // one second of neuron 0 firing at 200 Hz while reward dopamine runs 40 Hz above its usual level
  for (let k = 0; k < 200; k++) { fly.spike(0); fly.run(5); pl.update(5, 40, 0); }
  assert.ok(fly.wmv[0] < w0 * 0.9, `depressed ${w0} -> ${fly.wmv[0]}`);
  assert.ok(Math.abs(fly.wmv[1] - w1) < 1e-6, 'untouched synapse unchanged');
  // recovery without dopamine
  for (let k = 0; k < 600; k++) { fly.run(10); pl.update(10, 0, 0); }
  assert.ok(fly.wmv[0] > w0 * 0.8, `recovered to ${fly.wmv[0]}`);
});
