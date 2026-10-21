import test from 'node:test';
import assert from 'node:assert/strict';
import { createSketcher, keepSketch, sketchFrames, unpackFrame, loveUpdate, decodeUnit, babbleStep, favouriteUnit, NB, FPS, PRE, POST, FRAME } from '../being/voice.mjs';
import { featureOf, NU, DIM, MW } from '../being/memory.mjs';

const ear = (k0, lvl = 0.3) => ({ amp: Float32Array.from({ length: 28 }, (_, k) => (Math.abs(k - k0) < 3 ? lvl : 0.01)), level: 0.05, onset: 0.4, rough: 0.1, sub: 0.02 });

test('a loved moment keeps 4 s before and 2 s after, in order', () => {
  const sk = createSketcher();
  let got = [];
  for (let i = 0; i < FPS * 10; i++) {
    got.push(...sk.push(ear(i < FPS * 7 ? 5 : 20)));   // a timbre change at 7 s
    if (i === FPS * 7) assert.ok(sk.capture('chill', 0.9, { bpm: 120 }));
  }
  assert.equal(got.length, 1);
  const s = got[0]; assert.equal(s.reason, 'chill'); assert.equal(s.bpm, 120);
  const f = sketchFrames(s); assert.equal(f.length, FPS * (PRE + POST) * FRAME);
  const early = unpackFrame(f, 0), late = unpackFrame(f, (FPS * (PRE + POST) - 1) * FRAME);
  assert.ok(early.bands[5] > early.bands[20], 'before the moment: the old timbre');
  assert.ok(late.bands[20] > late.bands[5], 'after: the new one');
});

test('only the best few moments of a song are kept, and garbage is ignored', () => {
  let list = [];
  for (let i = 0; i < 7; i++) list = keepSketch(list, { v: 1, reason: 'x', score: i / 10, at: i, fps: 50, frames: 'AA==' });
  list = keepSketch(list, { bad: true });
  assert.equal(list.length, 4);
  assert.deepEqual(list.map((s) => s.score), [0.6, 0.5, 0.4, 0.3]);
  assert.equal(sketchFrames({ v: 1, frames: 'AA==', score: 1, fps: 50 }).length, 1);
});

test('a map unit decodes back to the bands that made it', () => {
  const w = new Float32Array(NU * DIM), f = featureOf(ear(9, 0.5));
  w.set(f, 7 * DIM);
  const d = decodeUnit(w, 7);
  let peak = 0; for (let k = 1; k < NB; k++) if (d.bands[k] > d.bands[peak]) peak = k;
  assert.ok(Math.abs(peak - 9) <= 2, `peak band ${peak}`);
  // the decoded log level matches packFrame's scale: log1p(amp / .015) / 4
  assert.ok(Math.abs(d.bands[9] - Math.log1p(0.5 / 0.015) / 4) < 0.05, `level ${d.bands[9]}`);
});

test('babbling wanders toward what it loved', () => {
  const love = new Float32Array(NU), hits = new Float32Array(NU);
  for (let i = 0; i < 400; i++) loveUpdate(love, 5 * MW + 30, 1);
  assert.equal(favouriteUnit(love, hits), 5 * MW + 30);
  let u = 5 * MW + 20, near = 0;
  let a = 1; const rnd = () => ((a = (Math.imul(a, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 400; i++) { u = babbleStep(u, love, hits, rnd); if (Math.abs((u % MW) - 30) <= 3) near++; }
  assert.ok(near > 120, `steps near the loved patch: ${near}`);
  assert.equal(loveUpdate(null, 3, 1), null);
});
