// lab/prototypes/nervous-system/sim.mjs - ON's nervous system, run from its real modules and wired the way the being page wires
// them (being/worker.mjs for the ear and tissue cadence, being/index.html for the mind, timing, body, pressure and restraint).
// Everything runs on this thread on a simulated clock, so it can be paused, stepped and slowed down.
//
//   ear      being/ear.mjs: sample() at 48 kHz, frame() every 10 ms        (worker.mjs EAR_EVERY)
//   tissue   being/tissue.mjs: step(drive) every 4 ms, render() every 33 ms (worker.mjs TISSUE_EVERY, TEX_EVERY, same drive)
//   analyzer being/analysis.mjs: drum events, beat tracker, build-up tension (the page's `an`; no latency model here)
//   mind     being/mind.mjs: step(dt, earFrame, onsetPeak, senses) once per frame, senses as in the page's loop
//   timing   being/timing.mjs: advance / observe / predict on the mind's grid (the page's beOnTime and handleEvents)
//   body     being/physics.mjs, being/pressure.mjs, being/restraint.mjs, driven as in the page
// Not here: the ML models (no musicA/musicV, so contagion stays 0 and the mind's bottom-up arousal stands in), memory of songs,
// the latency model (delay and horizon are 0), and the page's own visual layers.

import { createEar, SR, NE, DELTA, EAR_CF } from '../../../being/ear.mjs';
import { createTissue } from '../../../being/tissue.mjs';
import { createMind, traitsFor } from '../../../being/mind.mjs';
import { createTiming } from '../../../being/timing.mjs';
import { createPhysics } from '../../../being/physics.mjs';
import { createPressure } from '../../../being/pressure.mjs';
import { createMaxim } from '../../../being/restraint.mjs';
import { createAnalyzer } from '../../../being/analysis.mjs';
import { createInputGain } from '../../../being/input-gain.mjs';

const c01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const EAR_EVERY = SR / 100, TISSUE_EVERY = SR * 4 / 1000, TEX_EVERY = SR / 30;

/** wires that can be cut (each is a connection the page makes between two modules) */
export const LESIONS = {
  earTissue: 'ear drives the tissue',
  startle: 'startle reaches tissue and body',
  onsets: 'ear onsets reach the mind',
  rough: 'roughness reaches the mind',
  tissueMind: 'tissue coherence reaches the mind',
  feedback: 'timing feedback reaches the tissue',
  predicted: 'being on time rewards the mind',
  tracker: 'beat tracker pulls the pulse',
  tension: 'build-up tension reaches the mind',
  proprio: 'body strain reaches the mind',
  anticipation: 'anticipation charges pressure',
};

export function createSim(opt = {}) {
  const P = {   // constructor options the modules really accept; changing one re-creates that module
    seed: opt.seed || 1, rhythm: 0.6,
    ear: { tauMu: 2.5, gain: 1, kappa: 1 },
    tissue: { target: 0.0035, wander: 0.7, plastic: 0.05 },
    physics: { kBody: 28, cBody: 5.2, kSlosh: 16, cSlosh: 2.8 },
    pressure: { rate: 0.03, leak: 40 },
  };
  const cut = Object.fromEntries(Object.keys(LESIONS).map((k) => [k, false]));
  let ear, tissue, mind, timing, phys, pressure, maxim, an, trim;
  let earFrame, onsetPeak, tissueStats, tex, toEar, toTissue, toTex, time;
  const drive = new Float64Array(NE);
  const S = {};                    // per-frame derived state for the view
  const events = [];               // recent events { t, type, amount }
  const hits = [];                 // recent heard drum hits { t, type, slot, expected }
  const preds = [];                // recent predicted hits { t, type, slot }
  const asyn = [];                 // recent asynchronies (ms) heard kick - nearest predicted kick
  const V = { kick: 0, snare: 0, hat: 0 };
  const GH = { ta: new Float64Array(64), cum: new Float64Array(64), n: 0 };
  let evN = 0, showPrev = null, quiet = 0, awake = 0, M = 0.15, chill = 0, dropNow = false, flinch = 0;

  function makeEar() { ear = createEar({ ...P.ear }); }
  function makeTissue() { tissue = createTissue({ earUnits: NE, ...P.tissue }); }
  function makePhysics() { phys = createPhysics({ ...P.physics }); }
  function makePressure() { pressure = createPressure({ ...P.pressure }); }
  function reset(seed = P.seed) {
    P.seed = seed >>> 0 || 1;
    makeEar(); makeTissue(); makePhysics(); makePressure();
    mind = createMind(traitsFor(P.seed), { earCF: EAR_CF });
    timing = createTiming(); maxim = createMaxim(); an = createAnalyzer({ sampleRate: SR }); trim = createInputGain();
    earFrame = null; onsetPeak = 0; tissueStats = { act: 0, sigma: 1, branching: 1, coherence: 0, readout: [0, 0, 0] }; tex = null;
    toEar = 0; toTissue = 0; toTex = 0; time = 0; GH.n = 0; showPrev = null; quiet = 0; awake = 0; M = 0.15; chill = 0; flinch = 0;
    events.length = hits.length = preds.length = asyn.length = 0; evN = 0;
  }
  reset();

  const note = (type, amount = 1) => { events.push({ id: evN++, t: time, type, amount }); if (events.length > 64) events.shift(); };
  function gridAt(t) {   // the page's gridAt: grid position (cumulative slots) of the heard grid at audio time t
    const n = Math.min(GH.n, 64); if (!n || !Number.isFinite(t)) return NaN;
    const last = (GH.n - 1) % 64;
    if (t >= GH.ta[last]) return GH.cum[last] + (t - GH.ta[last]) * 4 * mind.pulseHz;
    for (let j = 1; j < n; j++) {
      const a = (GH.n - 1 - j) % 64, b = (GH.n - j) % 64;
      if (GH.ta[a] <= t) { const u = (t - GH.ta[a]) / Math.max(1e-6, GH.ta[b] - GH.ta[a]); return GH.cum[a] + u * (GH.cum[b] - GH.cum[a]); }
    }
    return NaN;
  }

  /** feed audio (48 kHz mono) through the ear and tissue at their own cadence, and the analyzer */
  function hear(x) {
    trim.step(x, SR); trim.apply(x);
    an.push(x);
    for (let n = 0; n < x.length; n++) {
      ear.sample(x[n]);
      if (++toEar >= EAR_EVERY) { toEar = 0; earFrame = ear.frame(); if (earFrame.onset > onsetPeak) onsetPeak = earFrame.onset; }
      if (++toTissue >= TISSUE_EVERY) {
        toTissue = 0;
        for (let k = 0; k < NE; k++) drive[k] = cut.earTissue ? 0 : 0.012 * Math.max(0, Math.log1p(ear.env[k] / DELTA) - 0.8);
        tissue.step(drive);
      }
      if (++toTex >= TEX_EVERY) { toTex = 0; const r = tissue.render(); tex = r.tex; tissueStats = { act: r.act, sigma: r.sigma, branching: r.branching, readout: r.readout, coherence: r.coherence }; }
    }
  }

  /** one frame of the inner life after `dt` seconds of audio were heard */
  function think(dt) {
    time += dt;
    an.analyseUpTo(an.total);
    const evs = an.drain();
    let e = earFrame;
    if (e && cut.rough) e = { ...e, rough: 0 };
    const senses = {
      tension: cut.tension ? 0 : an.state.structure.tension, intensity: an.state.intensityAbs ?? an.state.intensity,
      rhythm: cut.tracker ? 0 : P.rhythm, beat: an.state.beat,
      predicted: cut.predicted ? undefined : timing.predicted * timing.readiness,
      tissue: cut.tissueMind ? undefined : tissueStats, proprio: cut.proprio ? undefined : phys,
    };
    for (const ev of mind.step(dt, e, cut.onsets ? 0 : onsetPeak, senses)) {
      if (ev.type === 'startle') {
        note('startle', ev.amount);
        if (!cut.startle) { tissue.kick(ev.amount); V.kick = Math.max(V.kick, ev.amount); flinch = Math.max(flinch, ev.amount); }
      } else if (ev.type === 'chill') { chill = 1; note('chills'); }
      else note(ev.type === 'reform' ? 'bored: new form' : ev.type === 'recoil' ? 'disappointed' : ev.type);
    }
    onsetPeak = 0;
    // the page's beOnTime with no latency: the heard grid now, predictions as the shown grid passes them
    const ta = an.total / SR, cum = (mind.pulseCountRaw + mind.pulsePhaseRaw) * 4;
    const k = GH.n % 64; GH.ta[k] = ta; GH.cum[k] = cum; GH.n++;
    timing.advance(cum);
    const shown = cum + timing.bias, gate = c01((mind.lock - 0.2) / 0.4) * timing.readiness;
    S.gate = gate; S.slot = shown;
    if (showPrev !== null && shown > showPrev && shown - showPrev < 3 && gate > 0.05) {
      for (const h of timing.predict(showPrev, shown, [])) { preds.push({ t: ta, type: h.type, slot: h.slot, strength: h.strength }); if (preds.length > 128) preds.shift(); }
    }
    showPrev = shown;
    let hadDrop = false;
    for (const ev of evs) {
      if (ev.type === 'drop') { hadDrop = true; note('drop (analyzer)'); }
      else if (ev.type === 'build') note('build-up (analyzer)', ev.strength);
      if (ev.type !== 'kick' && ev.type !== 'snare' && ev.type !== 'hat') continue;
      const slotF = gridAt(ev.time), ex = timing.observe(ev.type, ev.strength || 0.6, slotF, 250 / Math.max(0.3, mind.pulseHz)) * gate;
      const s = Math.max(0.2, Math.min(1, ev.strength || 0.6));
      if (ex < 0.5) V[ev.type] = Math.max(V[ev.type], s * (1 - ex));
      if (!cut.feedback && gate > 0.15 && awake > 0.3) {
        if (ex > 0.5) tissue.pattern(ev.type === 'kick' ? 0 : ev.type === 'snare' ? 1 : 2, Math.min(1, 0.4 + 0.6 * s)); else tissue.noise(Math.min(1, 0.4 + 0.6 * s));
      }
      hits.push({ t: ev.time, type: ev.type, slot: Number.isFinite(slotF) ? ((Math.round(slotF + timing.bias) % 16) + 16) % 16 : -1, expected: ex });
      if (hits.length > 128) hits.shift();
      if (ev.type === 'kick') {   // asynchrony: this kick against the nearest kick it predicted (within half a felt beat)
        let best = null; const half = 0.5 / Math.max(0.3, mind.pulseHz);
        for (const p of preds) if (p.type === 'kick' && Math.abs(p.t - ev.time) < half && (!best || Math.abs(p.t - ev.time) < Math.abs(best.t - ev.time))) best = p;
        if (best) { asyn.push(1000 * (ev.time - best.t)); if (asyn.length > 32) asyn.shift(); }
      }
    }
    // body: awake/asleep as the page's silence gate (~2 s), the physics drive of the page's frame, pressure and restraint
    const lvl = earFrame ? earFrame.level : 0;
    quiet = lvl > 0.006 ? 0 : quiet + dt;
    awake += ((quiet < 2 ? 1 : 0) - awake) * (1 - Math.exp(-dt / (quiet < 2 ? 0.25 : 1.5)));
    phys.step(dt, { fz: (V.kick - V.snare * 0.5) * 3.5, tx: V.snare * 1.2, ty: V.hat, tz: (mind.pulsePhase - 0.5) * 0.5 * mind.lock,
      sub: earFrame ? earFrame.sub : 0, hit: V.kick + 0.6 * V.snare, pulsePhase: mind.pulsePhase, arousal: mind.arousal, groove: mind.groove });
    for (const pe of pressure.step(dt, { arousal: mind.arousal, aHome: mind.traits.aHome, anticipation: cut.anticipation ? 0 : mind.daAnticipation,
      groove: mind.groove, energy: mind.energy, drop: hadDrop || dropNow, loud: awake })) note(pe.type === 'burst' ? 'burst into beads' : pe.type === 'gather' ? 'gathers back' : 'jet', pe.amount ?? 1);
    dropNow = false;
    const want = maxim.want(dt, { drop: hadDrop ? 1 : 0, chill, arousal: mind.arousal, groove: mind.groove, sleep: 1 - awake, beads: pressure.state === 'swarm' });
    M += (want - M) * (1 - Math.exp(-dt / (want > M ? 0.3 : 2.5)));
    V.kick *= Math.exp(-dt / 0.11); V.snare *= Math.exp(-dt / 0.14); V.hat *= Math.exp(-dt / 0.06);
    chill *= Math.exp(-dt / 2.5); flinch *= Math.exp(-dt / 0.25);
    S.awake = awake; S.M = M; S.V = V; S.flinch = flinch;
  }

  return {
    P, cut, S, events, hits, preds, asyn,
    get ear() { return ear; }, get tissue() { return tissue; }, get mind() { return mind; }, get timing() { return timing; },
    get phys() { return phys; }, get pressure() { return pressure; }, get maxim() { return maxim; }, get an() { return an; },
    get evN() { return evN; }, get earFrame() { return earFrame; }, get tissueStats() { return tissueStats; }, get tex() { return tex; }, get time() { return time; },
    hear, think, reset, makeEar, makeTissue, makePhysics, makePressure,
    poke() { phys.impulse((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, 0, 1.5, 0); },
  };
}
