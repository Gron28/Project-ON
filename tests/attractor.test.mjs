// tests/attractor.test.mjs - the attractor filament maps stay exactly what they were (they are seeded per song)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { attractorDensity, ATTRACTOR_KINDS } from '../being/morph.mjs';

const digest = (a) => createHash('sha1').update(Buffer.from(a.density.buffer)).update(Buffer.from(a.tex.buffer)).digest('hex').slice(0, 16);

// computed with the code before the allocation-free rewrite (64 px, 20000 points, seed 5 + kind)
const BEFORE = ['0b6884eec42f5950', '8dbc615c727feb44', '8dc8a788e520b4d8', 'eebfdd42a01a1596', '0ede4833e59aa5db', '4ab7174a9c4d2e76'];

test('the same spec draws the same attractor twice', () => {
  for (let kind = 0; kind < ATTRACTOR_KINDS; kind++) {
    const a = attractorDensity({ kind, seed: 321 }, 48, 8000), b = attractorDensity({ kind, seed: 321 }, 48, 8000);
    assert.equal(digest(a), digest(b), `kind ${kind}`);
    assert.deepEqual(a.params, b.params);
  }
});

test('every kind draws bit for bit what it drew before the rewrite', () => {
  for (let kind = 0; kind < ATTRACTOR_KINDS; kind++) assert.equal(digest(attractorDensity({ kind, seed: 5 + kind }, 64, 20000)), BEFORE[kind], `kind ${kind}`);
});

test('a map smaller than its blur still comes out finite', () => {
  for (let kind = 0; kind < ATTRACTOR_KINDS; kind++) {
    const a = attractorDensity({ kind, seed: 9 }, 3, 2000);
    assert.ok(a.density.every(Number.isFinite), `kind ${kind}`);
  }
});
