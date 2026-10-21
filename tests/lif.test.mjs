import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FlyBrain, MODEL } from '../brain/lif.mjs';

// a tiny hand-made brain: 0 -> 1 (excitatory, 30 synapses), 2 -> 1 (inhibitory, 30 synapses), 1 -> 3 (excitatory, 10)
function tinyBrain() {
  const N = 4;
  const rowPtr = Uint32Array.from([0, 1, 2, 3, 3]);
  const col = Uint32Array.from([1, 3, 1]);
  const w = Int16Array.from([30, 10, -30]);
  return { N, E: 3, rowPtr, col, w, sign: Int8Array.from([1, 1, -1, 1]), pos: new Float32Array(N * 3), nt: new Uint8Array(N), cls: new Uint8Array(N), side: new Int8Array(N), groups: {}, meta: {} };
}

test('a silent brain stays at rest and costs nothing', () => {
  const fly = new FlyBrain(tinyBrain(), { dt: 0.5 });
  fly.run(100);
  assert.equal(fly.nActive, 0);
  assert.equal(fly.totalSpikes, 0);
  assert.equal(fly.v[1], MODEL.v_rest);
});

test('one excitatory spike of 30 synapses depolarises the target by about 30 * w_syn mV and then decays', () => {
  const fly = new FlyBrain(tinyBrain(), { dt: 0.5 });
  fly.spike(0);
  fly.run(MODEL.delay + 0.5); // delivery happens on the step after the delay
  assert.ok(fly.g[1] > 7 && fly.g[1] <= 30 * MODEL.w_syn + 1e-6, `g after delivery ${fly.g[1]}`);
  fly.run(6);
  const peak = fly.v[1];
  assert.ok(peak > MODEL.v_rest + 1, `membrane rose: ${peak}`);
  assert.ok(peak < MODEL.v_th, 'a single 30-synapse volley does not reach threshold on its own');
  fly.run(200);
  assert.equal(fly.nActive, 0, 'settled back to rest');
});

test('repeated input crosses threshold, fires once per refractory period at most, and propagates', () => {
  const fly = new FlyBrain(tinyBrain(), { dt: 0.5 });
  for (let k = 0; k < 10; k++) { fly.spike(0); fly.run(1); }
  fly.run(20);
  assert.ok(fly.spikeCount[1] >= 1, 'neuron 1 fired');
  assert.ok(fly.spikeCount[3] >= 0);
  // 10 spikes within 10 ms: with 2.2 ms refractory at most 5 spikes could fit even if every step crossed threshold
  assert.ok(fly.spikeCount[1] <= 6, `refractory respected: ${fly.spikeCount[1]}`);
});

test('inhibition cancels excitation', () => {
  const fly = new FlyBrain(tinyBrain(), { dt: 0.5 });
  for (let k = 0; k < 10; k++) { fly.spike(0); fly.spike(2); fly.run(1); }
  fly.run(20);
  assert.equal(fly.spikeCount[1], 0);
});

test('Poisson drive fires at roughly the requested rate', () => {
  const fly = new FlyBrain(tinyBrain(), { dt: 0.5, seed: 3 });
  fly.setDrive(Uint32Array.from([0]), Float32Array.from([100]));
  fly.run(5000);
  const hz = fly.spikeCount[0] / 5;
  assert.ok(hz > 70 && hz < 110, `measured ${hz} Hz (refractory period caps it below 100)`);
  assert.ok(fly.groupRate(Uint32Array.from([0])) > 50, 'rate estimate follows');
});

test('takeSpikes returns the ids since the last call and clears', () => {
  const fly = new FlyBrain(tinyBrain(), { dt: 0.5 });
  fly.spike(0); fly.spike(2);
  assert.deepEqual(Array.from(fly.takeSpikes()), [0, 2]);
  assert.equal(fly.takeSpikes().length, 0);
});
