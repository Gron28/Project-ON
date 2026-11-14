import test from 'node:test';
import assert from 'node:assert/strict';
import { growBolt, segLight, createLightning } from '../being/lightning.mjs';

const rng = (a) => () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

test('the leader reaches its goal through its waypoints in one connected trunk', () => {
  const from = [0.36, 0, 0], to = [-0.36, 0, 0], via = [[0, 0.7, 0]];
  const { segs, tEnd } = growBolt(from, to, rng(3), { via });
  const trunk = segs.filter((s) => s.depth === 0);
  assert.deepEqual(trunk[0].a, from); assert.deepEqual(trunk[trunk.length - 1].b, to);
  for (let i = 1; i < trunk.length; i++) assert.deepEqual(trunk[i].a, trunk[i - 1].b, 'trunk is continuous');
  assert.ok(trunk.some((s) => Math.hypot(s.b[0], s.b[1] - 0.7, s.b[2]) < 1e-9), 'passes the waypoint');
  assert.ok(segs.some((s) => s.depth > 0), 'it branches'); assert.ok(tEnd > 0.02 && tEnd < 0.3, 'leader time ' + tEnd);
});

test('the same random source strikes the same path', () => {
  const a = growBolt([0, 0, 0], [1, 0, 0], rng(9)), b = growBolt([0, 0, 0], [1, 0, 0], rng(9));
  assert.deepEqual(a, b);
});

test('return stroke lights the trunk brightest, then it fades out and is gone', () => {
  const L = createLightning(); L.strike([0, 0, 0], [1, 0, 0], { rnd: rng(1), energy: 1 });
  const out = new Float32Array(9 * 400); let peak = 0, peakTrunk = 0, peakBranch = 0;
  for (let i = 0; i < 200; i++) { peak = Math.max(peak, L.step(0.005)); const n = L.write(out, 400);
    for (let j = 0; j < n; j++) { const b = out[j * 9 + 7]; if (out[j * 9 + 8] === 0) peakTrunk = Math.max(peakTrunk, b); else peakBranch = Math.max(peakBranch, b); } }
  assert.ok(peak > 0.8 && peakTrunk > peakBranch);
  for (let i = 0; i < 300; i++) L.step(0.01);
  assert.equal(L.count, 0); assert.equal(L.write(out, 400), 0);
  const B = { tEnd: 0.05, strokes: [0.05] }; assert.equal(segLight(B, { t: 0.01, depth: 0, w: 1 }, 0.005), 0, 'not before the leader arrives');
});
