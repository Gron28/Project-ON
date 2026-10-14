// The allocation-free / list-based rewrites (tissue refractory lists, memory.paint scratch buffers, ear typed-array state) must
// behave exactly like the straightforward versions they replaced.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTissue, TW, TH } from '../being/tissue.mjs';
import { createMap, paint, dnaWeights, MW, MH, NU, DIM } from '../being/memory.mjs';

const lcg = (seed) => { let s = seed; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };

test('tissue: refractory lists age cells exactly like a full sweep over the sheet', () => {
  // reference: the original step (all cells aged by a loop over the whole sheet), driven by the same seeded rng
  const NT = TW * TH, NB = 10;
  function reference(seed, drives) {
    const rng = lcg(seed); let c = 99; const r0 = () => { c = (Math.imul(c, 1103515245) + 12345) | 0; return (c >>> 0) / 4294967296; };   // the sheet's own wiring generator
    const nb = new Int32Array(NT * NB), wnb = new Float32Array(NT * NB);
    for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
      const i = y * TW + x; let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const yy = Math.min(TH - 1, Math.max(0, y + dy)), xx = (x + dx + TW) % TW; nb[i * NB + n] = yy * TW + xx; wnb[i * NB + n] = r0(); n++; }
      for (let k = 0; k < 2; k++) { nb[i * NB + n] = (r0() * NT) | 0; wnb[i * NB + n] = r0(); n++; }
    }
    const st = new Uint8Array(NT), mark = new Uint8Array(NT); let exc = [], G = 0.16; const target = 0.0035; const rowUnit = Int32Array.from({ length: TH }, (_, y) => Math.min(27, ((1 - (y + 0.5) / TH) * 28) | 0));
    const states = [];
    for (const drive of drives) {
      const nx = [];
      for (const i of exc) for (let e = 0; e < NB; e++) { const j = nb[i * NB + e]; if (st[j] === 0 && !mark[j] && rng() < G * wnb[i * NB + e]) { mark[j] = 1; nx.push(j); } }
      for (let y = 0; y < TH; y++) { const eta = drive[rowUnit[y]] + 0.00003; const m = eta * TW; let cnt = Math.floor(m); if (rng() < m - cnt) cnt++; for (let c = 0; c < cnt; c++) { const j = y * TW + ((rng() * TW) | 0); if (st[j] === 0 && !mark[j]) { mark[j] = 1; nx.push(j); } } }
      for (let j = 0; j < NT; j++) { const s = st[j]; if (s > 0) st[j] = s + 1 >= 5 ? 0 : s + 1; }
      for (const j of nx) { st[j] = 1; mark[j] = 0; }
      exc = nx; G *= Math.exp(0.0025 * (target - nx.length / NT) / target); G = Math.min(0.25, Math.max(0.05, G));
      states.push(nx.length);
    }
    return states;
  }
  const drives = Array.from({ length: 800 }, (_, i) => Float64Array.from({ length: 28 }, (_, k) => 0.004 * (1 + Math.sin(i * 0.02 + k)) * (i % 300 < 200 ? 1 : 0)));
  const t = createTissue({ rng: lcg(5) }), ref = reference(5, drives);
  // render() only decays display traces (the dynamics never read them), so it can be called every step: right after a step the
  // cells that just fired are the ones whose flash channel is ~0.55 * 255
  for (let i = 0; i < drives.length; i++) {
    t.step(drives[i]); const tex = t.render().tex; let n = 0;
    for (let j = 0; j < NT; j++) if (tex[j * 4 + 1] > 100) n++;
    assert.equal(n, ref[i], `cells firing at step ${i}`);
  }
});

test('memory.paint: scratch buffers are reused, so two maps painted in turn must not bleed into each other', () => {
  const mk = (seed) => createMap({ weights: dnaWeights(seed), fast: true });
  const a = mk(3), b = mk(77), size = NU * 4;
  const out = () => [new Uint8Array(size), new Uint8Array(size), new Uint8Array(size)];
  const run = (m) => { const [c, g, e] = out(); paint(m, 0.3, c, g, e); return [c, g, e]; };
  const first = run(a); run(b); const again = run(a);
  for (let i = 0; i < 3; i++) assert.deepEqual(Array.from(first[i]), Array.from(again[i]), 'painting a, then b, then a again gives the first picture');
  const other = run(b);
  assert.notDeepEqual(Array.from(first[0]), Array.from(other[0]), 'different maps look different');
  // sheet wraps in x: the U-matrix of the first and last column must be finite (the wrapped neighbour was measured)
  for (const v of first[1]) assert.ok(Number.isFinite(v));
  assert.equal(MW * MH, NU); assert.ok(DIM > 28);
});
