// lab/organism/organism.mjs - one organism: genome -> development -> a living nervous system in a body. Pure module.
//
// Inputs come only from real sensors: being/ear.mjs (28 unit amplitudes, onset, roughness, sub-bass) and being/physics.mjs
// proprioception (local surface deformation from the l=2 modes, displacement and slosh at each receptor, plus jolt). No
// analyzer, no ML, no beat tracker. Receptor transduction is physiology (adapting hair cells, a saturating rate), not
// wiring. Interoceptive cells feel the milieu's variables as an input current; modulatory cells feel the reward
// prediction error of impacts (milieu.mjs). Outputs: motor cells add forces and torques to the physical body and stiffen
// it (brace.mjs: only strong hits strike, kicks and snares, never hats; an impact met by a brace already stiff costs
// little; only its unbraced share reaches the body as a hit; holding stiffness costs energy superlinearly and fatigues the
// muscle, so the stiffness it presents is its commanded stiffness x (1 - fatigue));
// chromatophores expand with their cell's firing and set the skin's colour.
// Sound comes from around the body: with stereo frames (worlds.mjs) each hair cell and onset receptor hears a mix of
// the two channels set by a cardioid on its lateral position x (the x axis is the stereo field's left-right): left
// gain (1 - x) / 2, right (1 + x) / 2. So a receptor facing left hears the left channel only, one on the median plane
// hears both at half weight, and a hearing field on one side loses the other half of the field. Gains sum to 1, so mono
// frames (both channels equal) drive every receptor exactly as before. Each hair cell adapts on its own mix.
// An impact comes from a side too: the direction of the sounds that struck (frame.pan, worlds.mjs); the brace it meets is
// the motor cells' stiffness weighted by the same cardioid on their lateral position (brace.mjs: integrated against the
// impact's brief force over its window, so the milieu learns its outcome when the window has passed).
// Wiring economy (milieu.mjs costWire): every spike of a network cell is charged by its axon arbor's length (network.mjs).
//
//   const o = createOrganism({ genome, seed });  o.step(dt, audioChunk);  o.tick(earFrame)  (precomputed frames)
// Cost: see lab/organism/evolve.mjs and tests/organism.test.mjs (measured, network and ear reported apart).

import { createEar, SR, NE, DELTA, EAR_CF } from '../../being/ear.mjs';
import { createPhysics } from '../../being/physics.mjs';
import { develop, T, KMAX } from './develop.mjs';
import { createNetwork, DT } from './network.mjs';
import { createMilieu } from './milieu.mjs';
import { decode } from './genome.mjs';
import { BRACE, EMD, protection, createImpactDetector, createImpact, createLowBand, fatigueStep } from './brace.mjs';
import { earFrames, frameAt } from './environment.mjs';

export const FRAME = SR * DT;      // 192 audio samples per network step
const MOTOR_F = 0.5;               // force of one fully contracted motor cell (the groove's own push peaks near 2-3)
const c01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
// Gestation (developmental homeostatic plasticity; Turrigiano & Nelson 2004): before birth the new network hears
// structure-free sound (the drums at random times, as through the womb: the same sounds as music, no rhythm) with only its
// homeostatic laws on (synaptic scaling, inhibitory STDP, intrinsic plasticity; no Hebbian learning, no pruning, sprouting or atrophy) and the
// milieu supplied from outside. So it is born near its own set point, and what a life changes afterwards is learning, not
// the network settling. The milieu, body and effectors start fresh at birth; synapses' birth weights are their weights then.
export const GESTATION = { dur: 30, world: [{ mode: 'scatter', dur: 30 }], seed: 1 };
let GFRAMES = null;
const gestationFrames = () => (GFRAMES ||= earFrames(GESTATION.world, GESTATION.seed));
// real l=2 harmonics in physics.mjs's mode order: xy, yz, 2z^2-x^2-y^2, xz, x^2-y^2
const Y2 = (u) => [u[0] * u[1], u[1] * u[2], 0.5 * (2 * u[2] * u[2] - u[0] * u[0] - u[1] * u[1]), u[0] * u[2], 0.5 * (u[0] * u[0] - u[1] * u[1])];

export function createOrganism({ genome, seed = 1, dev = null, laws = null, gestation = GESTATION.dur } = {}) {
  dev = dev || develop(genome, seed);
  const G = dev.G || decode(genome), N = dev.N;
  const net = createNetwork(dev, { seed, laws });
  let milieu = createMilieu(G);
  let ear = createEar(), phys = createPhysics();
  const by = (t) => { const l = []; for (let i = 0; i < N; i++) if (dev.type[i] === t) l.push(i); return Int32Array.from(l); };
  const C = { ear: by(T.EAR), onset: by(T.ONSET), rough: by(T.ROUGH), sub: by(T.SUB), proprio: by(T.PROPRIO), inter: by(T.INTER), intero: by(T.INTERO), mod: by(T.MOD), motor: by(T.MOTOR), chrom: by(T.CHROM) };
  const unit = (i) => dev.extra[4 * i] | 0, u3 = (i) => { const p = dev.pos, l = Math.hypot(p[3 * i], p[3 * i + 1], p[3 * i + 2]) || 1; return [p[3 * i] / l, p[3 * i + 1] / l, p[3 * i + 2] / l]; };
  const propY = Array.from(C.proprio, (i) => Y2(u3(i))), propU = Array.from(C.proprio, u3);
  const slow = new Float32Array(NE).fill(DELTA);
  // stereo hearing: each hair cell's and onset receptor's cardioid gains on the two channels, and each hair cell's own
  // adaptation (on its own mix)
  const latX = (i) => u3(i)[0], gainR = (list) => Float32Array.from(list, (i) => 0.5 * (1 + latX(i)));
  const earGR = gainR(C.ear), onGR = gainR(C.onset), motorGR = gainR(C.motor), motorGS = motorGR.reduce((x, y) => x + y, 0), slowC = new Float32Array(C.ear.length).fill(DELTA);
  const act = new Float32Array(N);                  // effector state: motor twitch summation, chromatophore expansion
  // muscle: commanded stiffness (raw), fatigue, and the stiffness it presents (stiff = raw x (1 - fatigue); brace.mjs)
  const stiff = new Float32Array(N), raw = new Float32Array(N), fat = new Float32Array(N), impactOf = createImpactDetector(), K_RISE = 1 - Math.exp(-DT / BRACE.tauRise);
  let lowBand = createLowBand(EAR_CF);
  const ring = new Float32Array((EMD + 1) * C.motor.length); let rk = 0;   // motor activation over the electromechanical delay
  let pending = [], done = null;                                             // impacts within their window; the one resolved this tick
  const DEC_M = Math.exp(-DT / BRACE.tauAct), DEC_C = Math.exp(-DT / 0.3), ADAPT = DT / 0.4;
  const out = { force: [0, 0, 0], torque: [0, 0, 0], motor: 0, chrom: 0, stim: 0, interHz: 0, rateHz: 0, brace: 0, impact: 0, side: 0, wireHz: 0, stiff2: 0, fatigue: 0 };
  let sinceImpact = 1, inSamples = 0, time = 0, interE = 0, rateE = 0, netE = 0, wireE = 0, synMass = 0, trophic = 1;
  let impactOf2 = impactOf;
  const rec = { motorSpikes: [], onsets: [], impacts: [] };   // optional recording for analysis (times in s)
  let recording = false;

  function senses(f) {
    // hair cells: a phasic part that adapts (tau 0.4 s) and a tonic part; the ear's own hum keeps a spontaneous rate
    let stim = 0;
    if (f.ampL) {
      // stereo: each cell hears its cardioid mix of the channels and adapts on it
      C.ear.forEach((i, q) => {
        const k = unit(i), g = earGR[q], amp = (1 - g) * f.ampL[k] + g * f.ampR[k]; slowC[q] += ADAPT * (amp - slowC[q]);
        const ph = Math.max(0, Math.log((amp + 1e-4) / (slowC[q] + DELTA))), to = Math.max(0, Math.log(amp / 0.05));
        net.ext[i] = 2 + 70 * Math.tanh(ph) + 20 * Math.tanh(to); stim += Math.tanh(ph);
      });
      C.onset.forEach((i, q) => { const g = onGR[q]; net.ext[i] = 2 + 120 * Math.tanh(((1 - g) * f.onsetL + g * f.onsetR) / 5); });
    } else {
      for (let k = 0; k < NE; k++) slow[k] += ADAPT * (f.amp[k] - slow[k]);
      for (const i of C.ear) {
        const k = unit(i), amp = f.amp[k], ph = Math.max(0, Math.log((amp + 1e-4) / (slow[k] + DELTA))), to = Math.max(0, Math.log(amp / 0.05));
        net.ext[i] = 2 + 70 * Math.tanh(ph) + 20 * Math.tanh(to); stim += Math.tanh(ph);
      }
      for (const i of C.onset) net.ext[i] = 2 + 120 * Math.tanh(f.onset / 5);
    }
    stim /= C.ear.length;
    const on = Math.tanh(f.onset / 5);
    for (const i of C.rough) net.ext[i] = 1 + 60 * Math.tanh(4 * f.rough);
    for (const i of C.sub) net.ext[i] = 1 + 80 * Math.tanh(5 * f.sub);
    const m = phys.modes, j = Math.tanh(3 * phys.jolt);
    C.proprio.forEach((i, q) => {
      const y = propY[q], u = propU[q];
      const d = m[0] * y[0] + m[1] * y[1] + m[2] * y[2] + m[3] * y[3] + m[4] * y[4] + 2 * (phys.pos[0] * u[0] + phys.pos[1] * u[1] + phys.pos[2] * u[2]) + phys.slosh[0] * u[0] + phys.slosh[1] * u[1] + phys.slosh[2] * u[2];
      net.ext[i] = 1 + 80 * Math.tanh(4 * Math.max(0, dev.extra[4 * i] * d)) + 30 * j;
    });
    // interoception: each cell feels one variable, as a deficit or as sufficiency
    const lv = milieu.margins();
    for (const i of C.intero) { const l = lv[dev.extra[4 * i] | 0], drive = dev.extra[4 * i + 1] ? 1 - l : l; net.ext[i] = 0.4 + 0.9 * drive; }
    const fe = (G.modFeel ?? 0) * milieu.s.rpe; for (const i of C.mod) net.ext[i] = fe;
    out.stim = c01(stim * 2 + 0.5 * on);            // sensory novelty (adapting hair cells and onsets)
  }

  /** one network step (4 ms) from an ear frame */
  function tick(f) {
    senses(f);
    const E = milieu.s.energy; net.S.energyFactor = 1.15 * E / (E + 0.15); net.S.quiet = sinceImpact >= 0.2 ? 1 : 0;
    const S = net.step();
    // effectors
    let fx = 0, fy = 0, fz = 0, tx = 0, ty = 0, tz = 0, mot = 0, chr = 0, B = 0, BR = 0, S2 = 0, FT = 0;
    const nm = C.motor.length, r0 = rk * nm; rk = (rk + 1) % (EMD + 1); const r1 = rk * nm;
    for (let q = 0; q < nm; q++) {
      const i = C.motor[q];
      let a = act[i] * DEC_M + (net.spk[i] ? BRACE.twitch : 0); if (a > 1) a = 1; act[i] = a; mot += a;
      ring[r0 + q] = a;                                            // stiffness follows the activation of EMD steps ago (brace.mjs)
      const rw = raw[i] + K_RISE * (ring[r1 + q] - raw[i]); raw[i] = rw; const ft = fat[i] = fatigueStep(fat[i], rw);
      stiff[i] = rw * (1 - ft); B += stiff[i]; BR += motorGR[q] * stiff[i]; S2 += rw * rw; FT += ft;
      if (a < 1e-4) continue;
      const v = dev.vec, p = dev.pos, f0 = MOTOR_F * a * (-0.7 * v[6 * i] + 0.7 * v[6 * i + 3]), f1 = MOTOR_F * a * (-0.7 * v[6 * i + 1] + 0.7 * v[6 * i + 4]), f2 = MOTOR_F * a * (-0.7 * v[6 * i + 2] + 0.7 * v[6 * i + 5]);
      fx += f0; fy += f1; fz += f2;
      tx += p[3 * i + 1] * f2 - p[3 * i + 2] * f1; ty += p[3 * i + 2] * f0 - p[3 * i] * f2; tz += p[3 * i] * f1 - p[3 * i + 1] * f0;
    }
    for (const i of C.chrom) { let a = act[i] * DEC_C + (net.spk[i] ? 0.15 : 0); if (a > 1) a = 1; act[i] = a; chr += a; }
    out.force[0] = fx; out.force[1] = fy; out.force[2] = fz; out.torque[0] = tx; out.torque[1] = ty; out.torque[2] = tz;
    out.motor = mot / Math.max(1, nm); out.chrom = chr / Math.max(1, C.chrom.length); out.brace = B / Math.max(1, nm); out.stiff2 = S2 / Math.max(1, nm); out.fatigue = FT / Math.max(1, nm);
    // the stiffness facing a side (-1 left .. 1 right): motor cells weighted by the cardioid on their lateral position
    const gs = motorGS, braceR = nm ? BR / gs : 0, braceL = nm ? (B - BR) / (nm - gs) : 0;
    const braceAt = (side) => {
      if (side === 0) return out.brace;
      const kl = 0.5 * (1 - side) * (nm - gs), kr = 0.5 * (1 + side) * gs; return (kl * braceL + kr * braceR) / (kl + kr || 1);
    };
    // impact: a sensory event strikes the body from a side; its brief force meets the stiffness on that side over the
    // impact window (brace.mjs), and the milieu learns its outcome when the window has passed
    const a = impactOf2(f.onset, lowBand(f.amp)); let impact = null;
    sinceImpact += DT;
    if (a > 0) {
      const side = f.pan ? Math.max(-1, Math.min(1, f.pan)) : 0;
      sinceImpact = 0; pending.push(createImpact(a, net.anticipation(5, 15, side), side, time)); out.side = side;
    }
    done = null;
    for (const im of pending) if (im.feed(braceAt(im.side))) done = im;
    if (done) {
      pending = pending.filter((im) => !im.done);
      impact = { a: done.a, p: done.p, A: done.A };
      if (recording) rec.impacts.push({ t: done.t, a: done.a, p: done.p, A: done.A, side: done.side });
    }
    out.impact = a;
    // only a strike reaches the body as a hit (hats are heard, not felt), and only its unbraced share
    phys.step(DT, { fx, fy, fz, tx, ty, tz, sub: f.sub, hit: a > 0 ? f.onset * (1 - protection(out.brace)) : 0 });
    // rates for the milieu
    let ni = 0; for (const i of C.inter) ni += net.spk[i];
    const kk = 1 - Math.exp(-DT / 0.25);
    let nr = 0; for (let t = 0; t <= T.PROPRIO; t++) nr += S.spikesByType[t];
    interE += kk * (ni / (C.inter.length * DT) - interE); rateE += kk * (S.spikes / (N * DT) - rateE); netE += kk * ((S.spikes - nr) / (N * DT) - netE);
    // wiring: spikes of network cells times their arbor length (receptors' axons run on the sense organ's supply)
    let wl = 0; if (S.spikes > nr) { const spk = net.spk, arb = net.arbor, rc = net.recep; for (let i = 0; i < N; i++) if (spk[i] && !rc[i]) wl += arb[i]; }
    wireE += kk * (wl / (N * DT) - wireE);
    out.interHz = interE; out.rateHz = rateE; out.wireHz = wireE;
    // once a second: synaptic mass (maintenance cost) and trophic use (share of synapses whose presynaptic cell fires >= 2 Hz)
    if ((Math.round(time / DT) % 250) === 0) {
      let s = 0, use = 0, m = 0;
      for (let p = 0; p < N; p++) { const u = Math.min(1, net.rbar[p] / 2); for (let q = p * KMAX, e = q + net.nOut[p]; q < e; q++) { s += net.w[q]; use += u; m++; } }
      synMass = s / N; trophic = m ? use / m : 0;
    }
    milieu.update({ dt: DT, rateHz: netE, wireHz: wireE, interHz: interE, motor: out.motor, stiff2: out.stiff2, chrom: out.chrom, synMass, strain: phys.strain, stim: 0.7 * out.stim + 0.3 * trophic, impact });
    if (recording) { for (const i of C.motor) if (net.spk[i]) rec.motorSpikes.push(time); if (f.onset > 1) rec.onsets.push(time); }
    time += DT;
  }

  // ---- gestation (see GESTATION) ----
  if (gestation > 0) {
    const g0 = decode(dev.genome), keep = { etaS: G.etaS, etaI: G.etaI, etaIP: G.etaIP, etaH: G.etaH, pruneThr: G.pruneThr }, law = { ...net.LAW };
    G.etaS = g0.etaS; G.etaI = g0.etaI; G.etaIP = g0.etaIP; G.etaH = 0; G.pruneThr = 0; net.LAW.atrophy = false; net.LAW.sprout = false;
    const F = gestationFrames(), view = { amp: null, onset: 0, rough: 0, sub: 0 }, n = Math.min(F.n, Math.round(gestation / DT));
    for (let f = 0; f < n; f++) { tick(frameAt(F, f, view)); milieu.s.energy = 0.8; milieu.s.integrity = 0.9; milieu.s.alive = true; }
    Object.assign(G, keep); Object.assign(net.LAW, law); net.birth();
    milieu = createMilieu(G); phys = createPhysics(); impactOf2 = createImpactDetector(); lowBand = createLowBand(EAR_CF); act.fill(0); stiff.fill(0); raw.fill(0); fat.fill(0); slow.fill(DELTA); slowC.fill(DELTA); ring.fill(0); pending = []; done = null;
    sinceImpact = 1; time = 0; interE = 0; rateE = 0; netE = 0; wireE = 0;
  }
  let last = null;
  /** advance by an audio chunk (48 kHz mono), or by dt seconds of silence when no chunk is given */
  function step(dt, chunk) {
    const n = chunk ? chunk.length : Math.round(dt * SR);
    for (let k = 0; k < n; k++) {
      ear.sample(chunk ? chunk[k] : 0);
      if (++inSamples === FRAME) { inSamples = 0; last = ear.frame(); tick(last); }
    }
    return state();
  }
  function state() {
    const m = milieu.s;
    return { t: time, alive: m.alive, energy: m.energy, integrity: m.integrity, need: m.need, viability: m.viability, valence: m.valence, arousal: net.S.mod, rateHz: out.rateHz, interHz: out.interHz,
      predFrac: m.predFrac, fatigue: out.fatigue, predShare: m.predShare, strain: phys.strain, motor: out.motor, chrom: out.chrom, gE: net.S.gEmean, gI: net.S.gImean,
      brace: out.brace, protection: protection(out.brace), impact: out.impact, rpe: m.rpe, events: m.events, anticIncome: m.anticIncome, impactLoss: m.impactLoss,
      wireHz: out.wireHz, impactDone: done ? done.a : 0, impactP: done ? done.p : 0, impactAt: done ? done.t : 0, impactSide: done ? done.side : 0 };
  }
  /** the skin: per chromatophore expansion and pigment, plus a summary (brightness, mean hue, patchiness) */
  function skin() {
    let b = 0, hs = 0, hc = 0, v = 0; const ex = new Float32Array(C.chrom.length);
    C.chrom.forEach((i, k) => { const a = act[i], h = dev.extra[4 * i]; ex[k] = a; b += a; hs += a * Math.sin(2 * Math.PI * h); hc += a * Math.cos(2 * Math.PI * h); });
    b /= Math.max(1, C.chrom.length); for (const a of ex) v += (a - b) ** 2;
    return { expansion: ex, cells: C.chrom, brightness: b, hue: ((Math.atan2(hs, hc) / (2 * Math.PI)) + 1) % 1, pattern: Math.sqrt(v / Math.max(1, ex.length)) };
  }
  function serialize() { return { genome: Array.from(dev.genome), seed: dev.seed, t: time, net: net.serialize(), milieu: milieu.serialize(), act: Array.from(act), stiff: Array.from(stiff), slow: Array.from(slow), slowC: Array.from(slowC), ring: Array.from(ring), rk, wireE, raw: Array.from(raw), fat: Array.from(fat) }; }
  function restore(o) { net.restore(o.net); milieu.restore(o.milieu); act.set(o.act); if (o.stiff) stiff.set(o.stiff); slow.set(o.slow); if (o.slowC) slowC.set(o.slowC); if (o.ring) { ring.set(o.ring); rk = o.rk; } wireE = o.wireE ?? 0; if (o.raw) { raw.set(o.raw); fat.set(o.fat); } else raw.set(stiff); time = o.t; }

  return {
    dev, G, net, C, act, stiff, out, rec, step, tick, state, skin, serialize, restore,
    get milieu() { return milieu; }, get phys() { return phys; }, get ear() { return ear; }, get time() { return time; }, get lastFrame() { return last; },
    /** the new laws' readouts in one place: brace, last impact, reward prediction error, anticipation (running), the
     *  resonators' rates and phases, and the genome's hearing field */
    readouts() {
      const m = milieu.s, r = net.resonators();
      return { brace: out.brace, protection: protection(out.brace), impact: out.impact, lastImpact: m.lastImpact, rpe: m.rpe, anticipation: m.predFrac, events: m.events, anticIncome: m.anticIncome, impactLoss: m.impactLoss,
        resonators: { cells: r.cells, hz: r.hz, phase: r.phase, sensory: Uint8Array.from(r.cells, (i) => (net.fanS[i] > 0.05 ? 1 : 0)) }, earSpread: G.earSpread };
    },
    record(on = true) { recording = on; if (on) { rec.motorSpikes.length = 0; rec.onsets.length = 0; rec.impacts.length = 0; } },
    poke(s = 1) { phys.impulse(s * (Math.random() - 0.5) * 2, s * (Math.random() - 0.5) * 2, s * (Math.random() - 0.5) * 2); },
  };
}

/** restore an organism from serialize() output */
export function restoreOrganism(o) { const org = createOrganism({ genome: Float64Array.from(o.genome), seed: o.seed, gestation: 0 }); org.restore(o); return org; }
