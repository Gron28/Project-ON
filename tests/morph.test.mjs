import test from 'node:test';
import assert from 'node:assert/strict';
import { morphFor, dnaGenome, lerpGenome, mutate, validGenome, cellCentres, cellFabric, attractorDensity, FAMILIES, STAIN_PAIRS, ATTRACTOR_KINDS } from '../being/morph.mjs';

const SONGS = {
  quartet: { loudness: .3, noisiness: .1, roughness: .05, tonality: .9, harmony: .8, regularity: .3, density: .3, intricacy: .6, brightness: .5, bassWeight: .2, vocal: 0 },
  noise: { loudness: .9, noisiness: .95, roughness: .9, tonality: .05, harmony: .1, regularity: .2, density: .9, intricacy: .7, vocal: 0 },
  techno: { loudness: .85, noisiness: .3, roughness: .2, tonality: .3, harmony: .2, regularity: .95, density: .6, intricacy: .4, bassWeight: .8, vocal: .1 },
  ballad: { loudness: .4, noisiness: .15, roughness: .1, tonality: .8, harmony: .6, regularity: .5, density: .3, intricacy: .3, vocal: .9, dynamics: .7 },
};
const top = (g) => FAMILIES.reduce((a, f) => (g.w[f] > g.w[a] ? f : a), FAMILIES[0]);

test('the same song always grows the same genome, and it is valid', () => {
  const a = morphFor(SONGS.quartet, 1234, 7), b = morphFor(SONGS.quartet, 1234, 7);
  assert.deepEqual(a, b);
  assert.ok(validGenome(a));
  assert.ok(Math.abs(FAMILIES.reduce((s, f) => s + a.w[f], 0) - 1) < 1e-9);
});

test('different songs grow different skins', () => {
  const tops = new Set(), keys = new Set();
  for (const [i, c] of Object.values(SONGS).entries()) for (let s = 0; s < 6; s++) {
    const g = morphFor(c, 1000 + i * 97 + s * 7919, 7);
    tops.add(top(g)); keys.add(top(g) + g.sym + Math.round(g.freq * 4) + g.stain.names.join());
  }
  assert.ok(tops.size >= 4, `families used: ${[...tops]}`);
  assert.ok(keys.size >= 15, `distinct looks (family, symmetry, scale, stains; CPPN weights always differ): ${keys.size} of 24`);
  // character matters: tonal music leans to lace, noise to turing / attractor
  let lace = 0, rough = 0;
  for (let s = 0; s < 40; s++) { const q = morphFor(SONGS.quartet, s * 31, 7), n = morphFor(SONGS.noise, s * 31, 7); lace += q.w.lace; rough += n.w.turing + n.w.attractor; }
  assert.ok(lace / 40 > 0.25 && rough / 40 > 0.35, `lace ${lace / 40}, noise ${rough / 40}`);
});

test('the skin matures from the being DNA into the song', () => {
  const a = dnaGenome(7), b = morphFor(SONGS.techno, 55, 7);
  assert.deepEqual(lerpGenome(a, b, 0).cppn.W, a.cppn.W);
  assert.deepEqual(lerpGenome(a, b, 1).cppn.W, b.cppn.W);
  const m = lerpGenome(a, b, 0.5);
  assert.ok(validGenome(m));
  assert.ok(Math.abs(Math.hypot(...m.axis) - 1) < 1e-9);
  const mu = mutate(b, 99), mu2 = mutate(b, 99);
  assert.deepEqual(mu, mu2);
  assert.notDeepEqual(mu.cppn.W, b.cppn.W);
  assert.ok(validGenome(mu));
});

test('broken genomes are refused, unknown characters still work', () => {
  assert.equal(validGenome(null), null);
  assert.equal(validGenome({ v: 1, w: { cppn: 1 }, axis: [0, 1, 0], cppn: { W: [1, 2], act: [] } }), null);
  assert.ok(validGenome(morphFor(null, 3, 3)));
  assert.ok(validGenome(morphFor({ tonality: NaN, density: Infinity }, 3, 3)));
});

test('cell mosaics have the asked number of cells, spread over the sphere', () => {
  for (const n of [2, 8, 64, 256]) {
    const P = cellCentres(n, 0.5, 9);
    assert.equal(P.length, n);
    for (const p of P) assert.ok(Math.abs(Math.hypot(...p) - 1) < 1e-6);
    const c = P.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]);
    assert.ok(Math.hypot(...c) / n < 0.2, `centroid ${Math.hypot(...c) / n} for ${n}`);
  }
});

test('attractors are strange (positive Lyapunov exponent) and fill the frame', () => {
  for (let kind = 0; kind < ATTRACTOR_KINDS; kind++) {
    const a = attractorDensity({ kind, seed: 1000 + kind }, 128, 120000);
    assert.ok(a.params, `kind ${kind} found nothing`);
    assert.ok(a.lyapunov > 0, `kind ${kind} lyapunov ${a.lyapunov}`);
    let lit = 0; for (const v of a.density) if (v > 0.05) lit++;
    assert.ok(lit / a.density.length > 0.03, `kind ${kind} coverage ${lit / a.density.length}`);
  }
});

test('attractors are drawn as thin bright filaments (g), not just a soft density (r)', () => {
  for (const kind of [1, 4, 5]) {
    const n = 192, a = attractorDensity({ kind, seed: 77 + kind }, n, 150000);
    assert.equal(a.tex.length, n * n * 4);
    let fil = 0, vol = 0, strong = 0;
    for (let i = 0; i < n * n; i++) { if (a.tex[i * 4 + 1] > 128) fil++; if (a.tex[i * 4] > 40) vol++; if (a.tex[i * 4 + 1] > 200) strong++; assert.equal(a.tex[i * 4 + 3], 255); }
    assert.ok(fil > 100, `kind ${kind}: ${fil} filament texels`);
    assert.ok(fil < vol, `kind ${kind}: filaments (${fil}) must be thinner than the volume they sit in (${vol})`);
    assert.ok(strong > 30, `kind ${kind}: some strands are crisp (${strong})`);
  }
});

test('cells nest: rim > compartments > cells (each cell is coded compartment + rim + variation)', () => {
  const P = cellCentres(160, 0.5, 9);
  for (const layout of [0, 1]) {
    const code = cellFabric(P, { layout, comps: 7, sectors: 7, axis: [0.3, 0.9, 0.1], seed: 5 });
    assert.equal(code.length, P.length);
    const comps = new Set(code.map(Math.floor)), rims = code.filter((c) => c - Math.floor(c) >= 0.5).length;
    assert.ok(comps.size >= 4 && comps.size <= 16, `layout ${layout}: ${comps.size} compartments`);
    assert.ok(rims > 4 && rims < P.length * 0.7, `layout ${layout}: ${rims} rim cells`);
    for (const c of code) assert.ok(Math.floor(c) >= 0 && Math.floor(c) < 16 && c - Math.floor(c) < 1);
    assert.deepEqual(code, cellFabric(P, { layout, comps: 7, sectors: 7, axis: [0.3, 0.9, 0.1], seed: 5 }));   // deterministic
  }
  // a ring layout is organised by the axis: the pith (compartment 0) is the cap around the pole
  const ring = cellFabric(P, { layout: 1, sectors: 7, axis: [0, 1, 0], seed: 5 });
  P.forEach((p, i) => { if (Math.floor(ring[i]) === 0) assert.ok(Math.abs(p[1]) > 0.9, `pith cell at y=${p[1]}`); });
  // too few cells for compartments: a single one, no rim
  const few = cellFabric(cellCentres(4, 0.5, 1), { comps: 8 });
  assert.equal(new Set(few.map(Math.floor)).size, 1);
});

test('every song is stained with a membrane / nucleus pair, and old genomes get a default stain', () => {
  const pairs = new Set();
  for (let s = 0; s < 60; s++) { const g = morphFor(SONGS[Object.keys(SONGS)[s % 4]], s * 131, 7); pairs.add(g.stain.names.join('/')); assert.notDeepEqual(g.stain.mem, g.stain.nuc); }
  assert.ok(pairs.size >= 5, `stain pairs used: ${pairs.size} of ${STAIN_PAIRS.length}`);
  const old = morphFor(SONGS.ballad, 3, 7); delete old.stain;
  assert.ok(validGenome(old).stain.mem.length === 3);
  const m = lerpGenome(morphFor(SONGS.noise, 1, 7), morphFor(SONGS.quartet, 2, 7), 0.5);
  assert.ok(m.stain.mem.every(Number.isFinite));
});

test('three dyes: membranes, nuclei and organelles, and genomes from before the third dye still stain', () => {
  const g = morphFor(SONGS.ballad, 12, 7);
  assert.equal(g.stain.org.length, 3);
  assert.notDeepEqual(g.stain.org, g.stain.mem); assert.notDeepEqual(g.stain.org, g.stain.nuc);
  assert.ok(g.cells.layout >= 0 && g.cells.comps >= 4 && g.cells.sectors >= 5);
  const old = JSON.parse(JSON.stringify(g)); delete old.stain.org; delete old.cells.layout; delete old.cells.comps;
  const v = validGenome(old);
  assert.ok(v && v.stain.org.length === 3 && v.stain.org.every(Number.isFinite));
  const m = lerpGenome(g, morphFor(SONGS.noise, 1, 7), 0.5);
  assert.ok(m.stain.org.every(Number.isFinite));
});
