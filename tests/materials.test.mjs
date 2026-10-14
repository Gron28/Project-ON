// What it is made of (being/materials.mjs) and its flourishes (being/flourish.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMaterials, affinities, materialLight, MATERIALS, N, ELEMENT_ID, PLANET_ID } from '../being/materials.mjs';
import { createGlints, ringGeometry, serpentPoints, createSerpents, snakePoints, ORBITS } from '../being/flourish.mjs';

const rng = (seed = 7) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const run = (m, ch, x = {}, seconds = 20) => { const M = createMaterials(rng()); for (let i = 0; i < seconds * 60; i++) M.step(1 / 60, affinities(m, ch, x)); return M; };

test('seventeen materials: the original six, the four elements, the seven planets', () => {
  assert.equal(N, 17); assert.equal(MATERIALS.length, 17);
  assert.deepEqual(Object.values(ELEMENT_ID), [6, 7, 8, 9]);
  assert.deepEqual(Object.values(PLANET_ID), [10, 11, 12, 13, 14, 15, 16]);
});

test('temperaments: each kind of music is led by its material', () => {
  const lead = (m, ch, x) => MATERIALS[run(m, ch, x).lead];
  assert.equal(lead({ arousal: .9, valence: -.4, energy: .8, daPhasic: .3 }, { roughness: .9, noisiness: .7, loudness: .9, density: .9 }), 'fire');
  // intensity alone is not fire: an energetic, loud but smooth and tonal moment must not burn
  assert.notEqual(lead({ arousal: .75, valence: .3, energy: .8, daPhasic: .5 }, { roughness: .15, noisiness: .15, loudness: .9, density: .7, tonality: .8, harmony: .7 }), 'fire');
  assert.equal(lead({ arousal: .4, groove: .8, pulseHz: 1.2 }, { bassWeight: .95, regularity: .9, density: .5, brightness: .15 }), 'earth');
  assert.equal(lead({ arousal: .08, valence: -.5, pulseHz: .8 }, { brightness: .2, tonality: .7, density: .1, regularity: .2 }), 'water');
  assert.equal(lead({ arousal: .8, valence: .8, daPhasic: .8 }, { brightness: .85, harmony: .8, loudness: .85 }, { chill: .8 }), 'sun · gold');
  assert.equal(lead({ arousal: .6, valence: .3, pulseHz: 3.2 }, { intricacy: .95, change: .9, density: .8, tempo: .9 }), 'mercury · quicksilver');
});

test('mixing: several coexist, weights sum to one, at most four are shown, a forced one is alone', () => {
  const M = run({ arousal: .15, valence: .4, pulseHz: 1.1 }, { brightness: .3, tonality: .8, harmony: .7, density: .3, vocal: .7 });
  const { ids, w } = M.uniforms();
  assert.equal(ids.length, 4);
  const sum = w.reduce((a, b) => a + b, 0); assert.ok(sum > .8 && sum < 1.05, w.join());   // easing in; the shader normalizes
  assert.ok(M.present >= 2, 'a calm ballad is more than one thing');
  const F = createMaterials(rng());
  for (let i = 0; i < 180; i++) F.step(1 / 60, new Array(N).fill(.3), { force: 9 });
  assert.equal(F.lead, 9); assert.ok(F.shown[9] > .9);
});

test('habituation: a material that leads long enough tires, and something else gets a turn', () => {
  const M = createMaterials(rng(3)), aff = new Array(N).fill(0); aff[6] = .9; aff[7] = .7;
  const leads = new Set();
  for (let i = 0; i < 6 * 60 * 60; i++) { M.step(1 / 60, aff); if (i % 600 === 0) leads.add(M.lead); }
  assert.ok(leads.has(6) && leads.size >= 2, [...leads].map((i) => MATERIALS[i]).join());
});

test('material light: the original six keep the being\'s light; the elements and planets cast their own', () => {
  const s = new Float32Array(N); s[0] = 1; assert.equal(materialLight(s), null);
  s[0] = 0; s[6] = 1; const l = materialLight(s); assert.ok(l.rgb[0] > l.rgb[2] && l.w > .5);
});

test('glints are rare: one small glint per 4 s, five a minute, one star per 45 s', () => {
  const g = createGlints(rng()), where = () => [0, 0];
  assert.equal(g.ask('glint', 0, where), true);
  assert.equal(g.ask('glint', 2, where), false);
  let granted = 1; for (let t = 4; t < 60; t += 4.01) if (g.ask('glint', t, where)) granted++;
  assert.ok(granted <= 5, String(granted));
  assert.equal(g.ask('star', 100, where), true);
  const before = g.slots.filter((s) => s.size > .2).length; g.ask('star', 120, where);
  assert.equal(g.slots.filter((s) => s.size > .2).length, before, 'a second star 20 s later is only a glint');
  for (let i = 0; i < 300; i++) g.step(1 / 60);
  assert.ok(g.slots.every((s) => s.i === 0), 'they fade');
});

test('the rings stay round the body (sinking into it at times); the serpent loops round the nucleus without passing through it', () => {
  for (let t = 0; t < 600; t += 7) for (const [x, y, z, R] of ringGeometry(t, .36)) { assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 1e-9); assert.ok(R > .5 * .36 && R < .75, String(R)); }   // it may sink into the body, never into the core
  for (let ph = 0; ph < 2; ph += .05) {
    const pts = serpentPoints(ph, ph * 10, .36, 1);
    assert.equal(pts.length, 16);
    for (const [x, y, z, r] of pts) assert.ok(Math.hypot(x, y, z) - r > .36, 'outside the shell');
    assert.ok(pts[0][3] > pts[15][3] * 3, 'head thicker than tail');
  }
});

test('a serpent comes regularly with a felt pulse, more when absorbed; several are rare; none without a pulse; orbits stay clear', () => {
  const r = rng(11), run = (c, seconds) => { const S = createSerpents(r); let t = 0, on = 0, episodes = 0, multi = 0, was = false;
    for (let i = 0; i < seconds * 60; i++) { t += 1 / 60; S.step(1 / 60, t, { pulseHz: 2, beat: 0, drop: 0, mercury: 0, awake: 1, shellR: .36, ...c }); const e = !!S.episode; if (e) on++; if (e && !was) { episodes++; if (S.episode.n > 1) multi++; } was = e; }
    return { share: on / (seconds * 60), episodes, multi }; };
  const absorb = run({ lock: .85, groove: .8, regularity: .9, change: .1 }, 1200);
  assert.ok(absorb.episodes >= 15 && absorb.share > .35 && absorb.share < .85, JSON.stringify(absorb));   // regular, still with rests
  assert.ok(absorb.multi / absorb.episodes < .3, `several at once is rare: ${JSON.stringify(absorb)}`);
  const pulse = run({ lock: .6, groove: .2, regularity: .5, change: .4 }, 1200);
  assert.ok(pulse.episodes >= 8 && pulse.multi === 0, `a felt pulse alone brings single serpents: ${JSON.stringify(pulse)}`);
  assert.equal(run({ lock: .15, groove: .3, regularity: .3, change: .7 }, 600).episodes, 0);
  for (const kind of ORBITS) for (let ph = 0; ph < 1; ph += .02) for (const [x, y, z, rad] of snakePoints({ kind, k: 1, orient: [[0, 1, 0], 1], precess: [[1, 0, 0], .1], wander: .33, R: .36 * 1.6, size: .054 }, ph, ph * 30, 1))
    assert.ok(Math.hypot(x, y, z) - rad > .36, kind);
  const S = createSerpents(r); S.show(.36, 2, { kind: 'infinity', n: 2, twin: true }); S.step(.5, 1, { lock: 0, groove: 0, regularity: 0, change: 0, pulseHz: 2, beat: 0, drop: 0, mercury: 0, awake: 1, shellR: .36 });
  const pts = S.points(1).filter((p) => p.pts); assert.equal(pts.length, 2);
  assert.ok(Math.hypot(pts[0].pts[0][0] - pts[1].pts[0][0], pts[0].pts[0][1] - pts[1].pts[0][1], pts[0].pts[0][2] - pts[1].pts[0][2]) > .2, 'a twin pair is half a loop apart');
});
