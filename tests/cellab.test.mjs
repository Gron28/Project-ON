// the CelLab automata's choices (being/cellab/rules.mjs, director.mjs): pure, deterministic
import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES_2D, RULES_3D, MOOD_RULES, MOODS, moodOf, moodScores, surfaceRuleFor, insideRuleFor, shareFor, validCellab, CREDIT } from '../being/cellab/rules.mjs';
import { createCellabDirector } from '../being/cellab/director.mjs';
import { PALETTES, paletteRGBA, isGradient, gradientRGBA } from '../being/cellab/palettes.mjs';

test('every rule is reachable from some mood, and every rule has a palette', () => {
  const s = new Set(Object.values(MOOD_RULES.surface).flat()), i = new Set(Object.values(MOOD_RULES.inside).flat());
  assert.deepEqual([...s].sort(), RULES_2D.map((r) => r.id).sort());
  assert.deepEqual([...i].sort(), RULES_3D.map((r) => r.id).sort());
  for (const r of [...RULES_2D, ...RULES_3D]) assert.ok(r.palette in PALETTES || isGradient(r.palette), r.id);
  assert.equal(paletteRGBA('default').length, 1024); assert.equal(gradientRGBA('on-ice').length, 1024);
  assert.match(CREDIT, /Rucker/); assert.match(CREDIT, /Walker/);
});

test('the mood mapping: calm, flowing, rough and wild music', () => {
  assert.equal(moodOf(0.1, { roughness: 0.2, density: 0.2, tonality: 0.6 }), 'calm');
  assert.equal(moodOf(0.5, { roughness: 0.15, noisiness: 0.1, tonality: 0.85, regularity: 0.6 }), 'flowing');
  assert.equal(moodOf(0.55, { roughness: 0.85, noisiness: 0.8, tonality: 0.2 }), 'rough');
  assert.equal(moodOf(0.95, { density: 0.9, change: 0.8, roughness: 0.4, tonality: 0.4 }), 'wild');
  const s = moodScores(0.5, null); for (const m of MOODS) assert.ok(Number.isFinite(s[m]));
});

test('a song and section always pick the same rule, sections walk the mood list', () => {
  assert.equal(surfaceRuleFor('flowing', 1234, 3), surfaceRuleFor('flowing', 1234, 3));
  const seen = new Set([0, 1, 2].map((k) => surfaceRuleFor('flowing', 99, k)));
  assert.equal(seen.size, 3);
  assert.equal(insideRuleFor('rough'), 'brain3d');
  for (const c of [null, { regularity: 1, intricacy: 1, density: 1, tonality: 0 }, { regularity: 0, tonality: 1 }]) { const v = shareFor(c); assert.ok(v >= 0.3 && v <= 0.8); }
});

test('memory: a remembered automaton validates, junk does not', () => {
  assert.deepEqual(validCellab({ rule: 'pond', rule3d: 'rug3d', mood: 'calm', share: 0.6 }), { rule: 'pond', rule3d: 'rug3d', mood: 'calm', share: 0.6 });
  assert.equal(validCellab({ rule: 'nope', rule3d: 'rug3d', mood: 'calm' }), null);
  assert.equal(validCellab(null), null);
});

test('director: restores a song, holds its mood, switches at sections, freezes in sleep, seeds on beats', () => {
  const D = createCellabDirector({ seed: 7 });
  D.song({ rule: 'venus', rule3d: 'life3d', mood: 'wild', share: 0.5 }, 42, null);
  assert.equal(D.surfaceRule, 'venus'); assert.equal(D.insideRule, 'life3d');
  assert.deepEqual(D.remember(), { rule: 'venus', rule3d: 'life3d', mood: 'wild', share: 0.5 });
  // a calm stretch while it shows: the mood changes after the hold, the rule waits for the section
  const calm = { roughness: 0.1, density: 0.1, tonality: 0.6 };
  for (let i = 0; i < 100; i++) D.feel(0.1, 0.05, calm, true);
  assert.equal(D.st.mood, 'calm'); assert.equal(D.surfaceRule, 'venus');
  D.section(); assert.ok(MOOD_RULES.surface.calm.includes(D.surfaceRule)); assert.equal(D.insideRule, 'rug3d');
  assert.equal(D.rate('surface', 0.8, 1), 0); assert.ok(D.rate('surface', 0.8, 0) > 0);
  const bmu = [0, 1, 0], seeds = D.beatSeeds('surface', 0.5, bmu);
  assert.ok(seeds.length >= 1 && seeds[0].y > 0.9);
  for (const s of seeds) assert.ok(Math.abs(Math.hypot(s.x, s.y, s.z) - 1) < 1e-9 && s.r > 0);
  for (const s of D.beatSeeds('inside', 1)) assert.ok(Math.hypot(s.x, s.y, s.z) <= 0.75 + 1e-9);
  const v = D.st.v2; D.force('surface', 'life'); assert.equal(D.surfaceRule, 'life'); assert.ok(D.st.v2 > v);
  D.force('surface', 'bogus'); assert.notEqual(D.surfaceRule, 'bogus');
});

test('director: a new song gets a fresh choice and a share from its character', () => {
  const D = createCellabDirector({ seed: 3 });
  D.song(undefined, 5, { regularity: 0.9, intricacy: 0.8, density: 0.7, tonality: 0.2 });
  assert.equal(D.st.known, false); assert.ok(D.st.share > 0.6);
  let leads = 0; for (let i = 0; i < 400; i++) leads += D.surfacing() ? 1 : 0;
  assert.ok(Math.abs(leads / 400 - D.st.share) < 0.1);
});

test('materials: every one leans to a real rule and palette, every surface rule is some material\'s, the home leans nowhere', async () => {
  const { MAT_LEAN, leadMaterial } = await import('../being/cellab/rules.mjs');
  const { N } = await import('../being/materials.mjs');
  assert.equal(MAT_LEAN.length, N);
  assert.equal(MAT_LEAN[0], null);
  for (let i = 1; i < N; i++) {
    const l = MAT_LEAN[i]; assert.ok(l, `material ${i}`);
    assert.ok(RULES_2D.some((r) => r.id === l.rule) && RULES_3D.some((r) => r.id === l.rule3d), `material ${i}`);
    assert.ok(l.palette === null || l.palette in PALETTES || isGradient(l.palette), `material ${i}`);
    for (const m of MOODS) assert.ok(Number.isFinite(l.mood[m]), `material ${i} ${m}`);
  }
  assert.deepEqual(new Set(MAT_LEAN.filter(Boolean).map((l) => l.rule)), new Set(RULES_2D.map((r) => r.id)));
  // liquid metal (no lean) is skipped for the strongest material that leans
  assert.equal(leadMaterial({ ids: [0, 6, 7, 0], w: [0.6, 0.3, 0.1, 0] }).id, 6);
  assert.equal(leadMaterial({ ids: [0, 0, 0, 0], w: [1, 0, 0, 0] }), null);
});

test('materials choose what grows: fire grows fire, water water; a dominant one overrides the mood; palettes follow', async () => {
  const { surfaceRuleFor, insideRuleFor, paletteFor } = await import('../being/cellab/rules.mjs');
  const fire = { ids: [6, 0, 0, 0], w: [0.7, 0.3, 0, 0] }, water = { ids: [7, 0, 0, 0], w: [0.4, 0.6, 0, 0] };
  assert.ok(moodScores(0.5, null, fire).rough > moodScores(0.5, null, null).rough);
  assert.ok(moodScores(0.5, null, water).flowing > moodScores(0.5, null, null).flowing);
  assert.equal(surfaceRuleFor('rough', 1, 0, fire), 'brain');
  assert.equal(surfaceRuleFor('calm', 1, 0, fire), 'brain');           // dominant (w 0.7): its own automaton whatever the mood
  assert.equal(surfaceRuleFor('calm', 1, 0, water), 'pond');           // present (0.4), and calm's list holds pond: the walk starts there
  assert.notEqual(surfaceRuleFor('calm', 1, 1, water), 'pond');        // ... and sections still walk on
  assert.equal(surfaceRuleFor('flowing', 1, 0, water), surfaceRuleFor('flowing', 1, 0, null));   // not in the list, not dominant: the song's own walk
  assert.equal(insideRuleFor('calm', fire), 'brain3d'); assert.equal(insideRuleFor('calm', null), 'rug3d');
  assert.equal(paletteFor('surface', 'brain', fire), 'on-ember'); assert.equal(paletteFor('surface', 'brain', null), RULES_2D.find((r) => r.id === 'brain').palette);
  assert.equal(paletteFor('surface', 'hodge', fire), RULES_2D.find((r) => r.id === 'hodge').palette);   // not its rule: the rule's own
  // the sky reaches the automata through the stones: each stone leans as its element and metal do
  const { MAT_LEAN } = await import('../being/cellab/rules.mjs');
  assert.equal(MAT_LEAN[17].rule, 'brain'); assert.equal(MAT_LEAN[20].rule, 'pond'); assert.equal(MAT_LEAN[18].rule, 'rug'); assert.equal(MAT_LEAN[19].rule, 'perfume');
});

test('director: predicted hits seed one ordered place, surprises scatter; a new leading material re-chooses out of sight', () => {
  const D = createCellabDirector({ seed: 11 });
  D.song(undefined, 9, null);
  const bmu = [1, 0, 0];
  for (let i = 0; i < 20; i++) {
    const [p] = D.hitSeeds('surface', 'kick', 1, true, bmu); assert.ok(p.x > 0.99, 'predicted lands at the song map');
    const ps = D.hitSeeds('inside', 'kick', 1, true); assert.ok(Math.hypot(ps[0].x, ps[0].y, ps[0].z) <= 0.2 + 1e-9, 'predicted lands near the nucleus');
    const qs = D.hitSeeds('inside', 'snare', 1, false); assert.ok(Math.hypot(qs[0].x, qs[0].y, qs[0].z) >= 0.35 - 1e-9);
  }
  const far = D.hitSeeds('surface', 'snare', 1, false, bmu); assert.equal(far.length, 2);
  assert.ok(D.hitSeeds('surface', 'hat', 1, true, bmu)[0].r < D.hitSeeds('surface', 'kick', 1, true, bmu)[0].r);
  assert.equal(D.beatSeeds('surface', 1, bmu, false).length, 1, 'no raindrops while drums feed it');
  D.feel(0.1, 0.5, null, false, { ids: [6, 0, 0, 0], w: [0.8, 0.2, 0, 0] });
  assert.equal(D.surfaceRule, 'brain'); assert.equal(D.insideRule, 'brain3d'); assert.equal(D.palette('surface'), 'on-ember');
  const v = D.st.v2; D.renew('surface'); assert.equal(D.st.v2, v + 1);
});

test('director: a new leading material while the automaton shows is applied once it hides', () => {
  const D = createCellabDirector({ seed: 4 });
  D.song(undefined, 3, null);
  D.feel(0.1, 0.5, null, false, { ids: [6, 0, 0, 0], w: [0.8, 0.2, 0, 0] }); assert.equal(D.surfaceRule, 'brain');
  D.feel(0.1, 0.5, null, true, { ids: [7, 0, 0, 0], w: [0.8, 0.2, 0, 0] }); assert.equal(D.surfaceRule, 'brain', 'not while it shows');
  D.feel(0.1, 0.5, null, false, { ids: [7, 0, 0, 0], w: [0.8, 0.2, 0, 0] }); assert.equal(D.surfaceRule, 'pond');
});
