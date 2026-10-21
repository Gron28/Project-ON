import test from 'node:test';
import assert from 'node:assert/strict';
import { createTiming } from '../being/timing.mjs';

// a bar of 16 slots: kick on 0, 6, 8 (not symmetric under a beat shift), snare on 4 and 12, hats on even slots
const BAR = { kick: [0, 6, 8], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] };
function play(tm, bars, { offset = 0, shift = 0, startBar = 0, slotMs = 125 } = {}) {
  for (let b = startBar; b < startBar + bars; b++) {
    for (let k = 0; k < 16; k++) {
      const pos = b * 16 + k;
      for (const [type, slots] of Object.entries(BAR)) if (slots.includes((k - shift + 16) % 16)) tm.observe(type, 0.8, pos + offset, slotMs);
      tm.advance(pos + offset + 0.6);
    }
  }
}

const sweep = (tm) => { const all = []; for (let x = -0.5; x < 15.5; x += 0.5) all.push(...tm.predict(x, x + 0.5).map((h) => ({ ...h }))); return all; };

test('it learns the groove and predicts it', () => {
  const tm = createTiming();
  play(tm, 12);
  const hits = sweep(tm);
  const kicks = hits.filter((h) => h.type === 'kick').map((h) => h.slot).sort((a, b) => a - b);
  assert.deepEqual(kicks, [0, 6, 8]);
  assert.deepEqual(hits.filter((h) => h.type === 'snare').map((h) => h.slot).sort((a, b) => a - b), [4, 12]);
  assert.ok(tm.predicted > 0.8, `predicted ${tm.predicted}`);
});

test('it learns away a constant timing error, and its error shrinks', () => {
  const tm = createTiming();
  play(tm, 4, { offset: 0.3 });   // its grid is 0.3 slot (37 ms) early against the music
  const early = tm.errorMs;
  play(tm, 40, { offset: 0.3, startBar: 4 });
  assert.ok(Math.abs(tm.bias + 0.3) < 0.05, `bias ${tm.bias}`);
  assert.ok(tm.errorMs < 10 && tm.errorMs < early, `error ${early} -> ${tm.errorMs}`);
});

test('a remembered groove is re-aligned to the bar by the first hits', () => {
  const song = createTiming();
  play(song, 12);
  const stored = song.serialize();
  const tm = createTiming();
  tm.recall(stored);
  play(tm, 1, { shift: 4 });   // this time its bar count starts one beat later
  const kicks = sweep(tm).filter((h) => h.type === 'kick').map((h) => h.slot).sort((a, b) => a - b);
  assert.deepEqual(kicks, [4, 10, 12]);
});

test('timing survives garbage and keeps its own correction across songs', () => {
  const tm = createTiming();
  assert.equal(tm.observe('kick', 1, NaN, 125), 0);
  tm.advance(NaN); tm.recall(null); tm.recall({ v: 1, G: { kick: [1, 2] } });
  play(tm, 30, { offset: 0.2 });
  const self = tm.serializeSelf();
  tm.reset();
  assert.equal(tm.evidence, 0);
  const tm2 = createTiming(); tm2.restoreSelf(self);
  assert.ok(Math.abs(tm2.bias - tm.bias) < 1e-9);
});
