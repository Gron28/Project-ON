// The being's organs, as regression tests of the behaviour the literature predicts (see lab/NOTEBOOK.md, E06).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEar, EAR_CF, SR, DELTA } from '../being/ear.mjs';
import { createTissue } from '../being/tissue.mjs';
import { createMind, traitsFor } from '../being/mind.mjs';
import { createPhysics } from '../being/physics.mjs';

const run = (ear, sec, gen, t0 = 0) => { for (let n = 0; n < sec * SR; n++) ear.sample(gen(t0 + n / SR)); };
const K = 12, CF = EAR_CF[K];   // the 440 Hz unit

test('ear: in silence every unit settles at its own hum (spontaneous emission)', () => {
  const ear = createEar();
  run(ear, 16, () => 0);                                    // the lowest units (55 Hz) overshoot first and need ~15 s to settle
  for (let k = 0; k < EAR_CF.length; k++) assert.ok(Math.abs(ear.env[k] - DELTA) < DELTA * 0.5, `unit ${k} hums at ${ear.env[k]}`);
  assert.ok(ear.mu[K] > -0.01 && ear.mu[K] < 0.02, `parked at the edge of oscillation: mu ${ear.mu[K]}`);
});

test('ear: compressive at its characteristic frequency, linear away from it (Eguiluz 2000)', () => {
  const resp = (f, L) => { const e = createEar({ freezeMu: 0 }); run(e, 0.4, (t) => L * Math.sin(2 * Math.PI * f * t)); return e.env[K]; };
  const slopeAt = Math.log10(resp(CF, 0.1) / resp(CF, 0.01));          // dB per dB over one decade of input
  const slopeOff = Math.log10(resp(CF * 2, 0.1) / resp(CF * 2, 0.01));
  assert.ok(slopeAt > 0.25 && slopeAt < 0.45, `at CF ~1/3: ${slopeAt}`);
  assert.ok(slopeOff > 0.8, `off CF ~1: ${slopeOff}`);
});

test('ear: hears the distortion product 2f1-f2 that is not in the sound', () => {
  const f1 = CF * 1.25, f2 = CF * 1.5, f = 2 * f1 - f2;
  const lock = (ear) => { const g = (t) => 0.03 * (Math.sin(2 * Math.PI * f1 * t + 0.3) + Math.sin(2 * Math.PI * f2 * t + 1.1)); run(ear, 0.3, g);
    let re = 0, im = 0; const n0 = 0.3 * SR; for (let n = 0; n < 0.3 * SR; n++) { const t = (n0 + n) / SR; ear.sample(g(t)); const c = Math.cos(2 * Math.PI * f * t), s = Math.sin(2 * Math.PI * f * t); re += ear.zr[K] * c + ear.zi[K] * s; im += ear.zi[K] * c - ear.zr[K] * s; } return Math.hypot(re, im); };
  const critical = lock(createEar({ freezeMu: 0 })), linear = lock(createEar({ freezeMu: -0.08, kappa: 0 }));
  assert.ok(critical > 1000 * linear, `phantom tone ${critical} vs linear ${linear}`);
});

test('ear: loud sound tires it, silence lets it recover and hum again', () => {
  const ear = createEar();
  run(ear, 3, (t) => 0.2 * Math.sin(2 * Math.PI * CF * t));
  assert.ok(ear.mu[K] < -0.05, `fatigued: ${ear.mu[K]}`);
  let back = null;
  for (let s = 0; s < 20 && back === null; s += 0.5) { run(ear, 0.5, () => 0); if (ear.mu[K] > 0) back = s; }
  assert.ok(back !== null && back < 15, `hums again after ${back} s`);
});

test('ear: onsets are reported for hits, and never for its own hum in silence', () => {
  const ear = createEar();
  run(ear, 4, () => 0);
  let max = 0; for (let i = 0; i < 100; i++) { run(ear, 0.01, () => 0); max = Math.max(max, ear.frame().onset); }
  assert.equal(max, 0);
  let hits = 0;
  for (let i = 0; i < 300; i++) { run(ear, 0.01, (t) => { const ph = (i * 0.01 + t) % 0.5; return 0.5 * Math.exp(-ph * 30) * Math.sin(2 * Math.PI * 60 * ph); }); if (ear.frame().onset > 0.3) hits++; }
  assert.ok(hits >= 5, `hits detected: ${hits}`);
});

test('tissue: homeostasis drives it towards criticality in silence and input-driven under loud drive', () => {
  let s = 1; const rng = () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; };
  const quiet = createTissue({ rng });
  for (let i = 0; i < 4000; i++) quiet.step(null);
  const loud = createTissue({ rng });
  const drive = new Float64Array(28).fill(0.02);
  for (let i = 0; i < 4000; i++) loud.step(drive);
  assert.ok(quiet.sigma > 0.9, `silence: sigma ${quiet.sigma}`);
  assert.ok(loud.sigma < 0.6, `loud: sigma ${loud.sigma}`);
  const r = quiet.render();
  assert.equal(r.tex.length, 128 * 64 * 4);
});

// ---- the mind, driven by synthetic ear frames (no audio needed) -------------------------------------------------
const frame = (level, onset) => ({ amp: new Float32Array(28).fill(level > 0 ? 0.05 : DELTA), mu: new Float32Array(28), onset, rough: 0, sub: 0, level, hum: 0 });
function drive(mind, sec, { bpm = 120, hit = 1, level = 0.3, tension = 0, intensity = 0.6, extraHitAt = -1, music = {} } = {}) {
  const fps = 60, evs = [];
  for (let f = 0; f < sec * fps; f++) {
    const t = f / fps, ph = (t * bpm / 60) % 1;
    let o = bpm && ph < 1 / (fps * 60 / bpm) * 1.01 ? hit : 0;
    if (extraHitAt >= 0 && Math.abs(t - extraHitAt) < 0.5 / fps) o = 4;
    for (const e of mind.step(1 / fps, frame(level, o), o, { tension, intensity, ...music })) evs.push({ ...e, t });
  }
  return evs;
}

test('mind: locks to a steady 120 bpm pulse within seconds', () => {
  const mind = createMind(traitsFor(7));
  drive(mind, 12);
  assert.ok(mind.lock > 0.4, `lock ${mind.lock}`);
  assert.ok(Math.abs(mind.pulseHz * 60 - 120) < 6, `feels ${mind.pulseHz * 60} bpm`);
});

test('mind: startles at the first hits, habituates, and startles again at a much bigger hit', () => {
  const mind = createMind(traitsFor(7));
  drive(mind, 3, { bpm: 0, level: 0 });
  const evs = drive(mind, 16, { extraHitAt: 14 });
  const st = evs.filter((e) => e.type === 'startle');
  assert.ok(st.length >= 1 && st[0].t < 2, 'startles at the start');
  assert.ok(st.filter((e) => e.t > 6 && e.t < 13.9).length === 0, `habituated: ${st.map((e) => e.t.toFixed(1))}`);
  assert.ok(st.some((e) => e.t >= 13.9), 'a much bigger hit startles again');
});

test('mind: anticipation rises during a build-up, not at a song\'s opening rise', () => {
  const mind = createMind(traitsFor(7));
  drive(mind, 14);
  const before = mind.daAnticipation;
  drive(mind, 4, { tension: 0.9 });
  assert.ok(mind.daAnticipation > before + 0.2, `${before} -> ${mind.daAnticipation}`);
  const fresh = createMind(traitsFor(7));
  drive(fresh, 4, { tension: 0.9 });
  assert.ok(fresh.daAnticipation < 0.05, `opening: ${fresh.daAnticipation}`);
});

// loud, busy music is not necessarily exciting: the music's own perceived arousal sets the level (contagion)
test('mind: a calm song stays calm even at full loudness, an energetic one excites', () => {
  const calm = createMind(traitsFor(7)), hot = createMind(traitsFor(7));
  drive(calm, 20, { level: 0.6, intensity: 1, music: { musicA: 0.12, musicV: 0.2 } });
  drive(hot, 20, { level: 0.6, intensity: 1, music: { musicA: 0.85, musicV: 0.2 } });
  assert.ok(calm.arousal < 0.4, `calm song: arousal ${calm.arousal}`);
  assert.ok(hot.arousal > 0.6, `energetic song: arousal ${hot.arousal}`);
  const sad = createMind(traitsFor(7)); drive(sad, 20, { music: { musicA: 0.3, musicV: -0.7 } });
  assert.ok(sad.valence < 0, `sad song: valence ${sad.valence}`);
});

test('mind: survives broken input (negative, zero and NaN steps)', () => {
  const mind = createMind(traitsFor(3));
  for (const dt of [-0.02, 0, NaN, 0.016]) mind.step(dt, frame(0.3, NaN), NaN, { tension: NaN, intensity: NaN });
  for (const v of [mind.arousal, mind.valence, mind.energy, mind.mood]) assert.ok(Number.isFinite(v));
});

test('mind: remembers its life across sessions', () => {
  const a = createMind(traitsFor(11));
  drive(a, 8);
  a.life.listenSeconds = 3600;
  const saved = JSON.parse(JSON.stringify(a.serialize()));
  const b = createMind(traitsFor(11));
  assert.ok(b.restore(saved));
  assert.equal(b.life.listenSeconds, 3600);
  assert.deepEqual(b.serialize().P, saved.P);
});

test('mind: different seeds are different beings', () => {
  const t1 = traitsFor(1), t2 = traitsFor(2);
  assert.notEqual(t1.f0, t2.f0);
  assert.notEqual(t1.hue, t2.hue);
});

// one bad number from outside must be forgotten, not integrated for ever (it used to leave groove, bored and the
// anticipation NaN for the rest of the session after a single NaN intensity, and the tempo NaN after an infinite tracker bpm)
test('mind: a single bad input does not poison its state for good', () => {
  const keys = ['arousal', 'valence', 'mood', 'energy', 'bored', 'confused', 'lock', 'groove', 'sync', 'beatError', 'surprise', 'dF', 'IC', 'entropy', 'daPhasic', 'daAnticipation', 'daTonic', 'pulseHz', 'pulsePhase', 'habituation'];
  const cases = {
    'NaN intensity': { tension: 0, intensity: NaN },
    'NaN beat phase': { intensity: 0.5, rhythm: 1, beat: { phase: NaN, bpm: 120, confidence: 1 } },
    'infinite tracker bpm': { intensity: 0.5, rhythm: 1, beat: { phase: 0.3, bpm: Infinity, confidence: 1 } },
    'absurd tracker bpm': { intensity: 0.5, rhythm: 1, beat: { phase: 0.3, bpm: 9000, confidence: 1 } },
    'infinite progress': { intensity: 0.5, progress: Infinity },
  };
  for (const [name, senses] of Object.entries(cases)) {
    const mind = createMind(traitsFor(5));
    const hit = (f) => (f % 30 === 0 ? 1 : 0);
    for (let f = 0; f < 300; f++) mind.step(1 / 60, frame(0.3, hit(f)), hit(f), senses);
    for (let f = 0; f < 900; f++) mind.step(1 / 60, frame(0.3, hit(f)), hit(f), { intensity: 0.5, tension: 0 });
    for (const k of keys) assert.ok(Number.isFinite(mind[k]), `${name}: ${k} is ${mind[k]}`);
    assert.ok(mind.pulseHz > 0.2 && mind.pulseHz < 6, `${name}: pulse ${mind.pulseHz} Hz`);
  }
  const m = createMind(traitsFor(5));                          // bad ear frames
  const bad = frame(NaN, Infinity); bad.rough = NaN; bad.sub = NaN;
  for (let f = 0; f < 60; f++) m.step(1 / 60, bad, Infinity, {});
  for (let f = 0; f < 600; f++) m.step(1 / 60, frame(0.3, hit0(f)), hit0(f), { intensity: 0.5 });
  for (const k of keys) assert.ok(Number.isFinite(m[k]), `bad ear frame: ${k} is ${m[k]}`);
});
const hit0 = (f) => (f % 30 === 0 ? 1 : 0);

test('mind: in silence the felt pulse never drives a lock (no phantom beat) and the tempo returns home', () => {
  const mind = createMind(traitsFor(9));
  drive(mind, 12);                                              // 120 bpm, locked
  assert.ok(mind.lock > 0.4);
  drive(mind, 60, { bpm: 0, level: 0, intensity: 0 });          // then nothing at all
  assert.ok(mind.lock < 0.12, `lock in silence ${mind.lock}`);
  assert.ok(mind.groove < 0.01, `groove in silence ${mind.groove}`);
  assert.ok(Math.abs(mind.pulseHz - mind.traits.f0) < 0.45, `tempo drifts home: ${mind.pulseHz} vs ${mind.traits.f0}`);
});

test('tissue: render() reports tonotopic readout [low, mid, high] and spatial wave coherence', () => {
  let s = 5; const rng = () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; };
  const t = createTissue({ rng });
  const driveLow = new Float64Array(28); for (let k = 0; k < 9; k++) driveLow[k] = 0.04;
  for (let i = 0; i < 60; i++) t.step(driveLow);
  const r = t.render();
  assert.equal(r.readout.length, 3);
  assert.ok(r.readout[0] > r.readout[2], `low band readout (${r.readout[0]}) > high band (${r.readout[2]})`);
  assert.ok(r.coherence >= 0 && r.coherence <= 1, `coherence in [0,1]: ${r.coherence}`);
});

test('mind: harmonic surprise spikes on a sudden key / pitch-class change and 8-trait plasticity persists', () => {
  const mind = createMind(traitsFor(13));
  const frPitch = (unit, onset) => {
    const f = frame(0.35, onset);
    f.amp.fill(DELTA); f.amp[unit] = 0.18; f.amp[unit + 12] = 0.12;
    return f;
  };
  for (let i = 0; i < 600; i++) mind.step(1 / 60, frPitch(0, i % 30 === 0 ? 1 : 0), i % 30 === 0 ? 1 : 0, { intensity: 0.5 });
  const steadyHarm = mind.harmonicSurprise;
  for (let i = 0; i < 15; i++) mind.step(1 / 60, frPitch(6, i === 0 ? 1 : 0), i === 0 ? 1 : 0, { intensity: 0.5 });   // tritone shift
  assert.ok(mind.harmonicSurprise > steadyHarm + 0.15, `harmonic surprise rose from ${steadyHarm} to ${mind.harmonicSurprise}`);
  assert.ok(mind.harmonicEntropy > 0, `harmonic entropy ${mind.harmonicEntropy}`);
  const snap = mind.serialize();
  for (const k of ['f0', 'sStar', 'aHome', 'vHome', 'gDA', 'looseness', 'hue', 'restless']) assert.ok(Number.isFinite(snap.traits[k]), `trait ${k} serialized`);
});

test('physics: viscoelastic 3D spring-damper, internal fluid slosh, and proprioceptive feedback to mind', () => {
  const phys = createPhysics();
  phys.impulse(0.8, -0.6, 0.4, 1.2, -0.9);
  for (let i = 0; i < 10; i++) phys.step(1 / 60, { fx: 0.5, fy: -0.2, arousal: 0.7, groove: 0.6 });
  assert.ok(phys.strain > 0.01, `strain ${phys.strain}`);
  assert.ok(phys.jolt > 0.01, `jolt ${phys.jolt}`);
  assert.ok(Math.hypot(...phys.slosh) > 0.001, 'internal fluid slosh dipole excited');
  assert.ok(Math.hypot(...phys.modes) > 0.001, 'Rayleigh-Lamb l=2 quadrupole surface modes excited');
  assert.ok(Math.abs(phys.squash) > 0.0005, 'incompressible Poisson squash-and-stretch active');
  const mind = createMind(traitsFor(7));
  mind.step(1 / 60, frame(0.3, 0), 0, { proprio: phys, tissue: { coherence: 0.8, sigma: 1.0 } });
  assert.ok(Number.isFinite(mind.arousal) && Number.isFinite(mind.groove));
  for (let i = 0; i < 600; i++) phys.step(1 / 60, {});
  assert.ok(phys.strain < 0.01, `settles back to rest: strain ${phys.strain}`);
  assert.ok(Math.hypot(...phys.modes) < 0.01, 'quadrupole modes settle back to rest');
});

