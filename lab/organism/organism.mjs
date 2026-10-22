// lab/organism/organism.mjs - one organism: genome -> development -> a living nervous system in a body. Pure module.
//
// Inputs come only from real sensors: being/ear.mjs (28 unit amplitudes, onset, roughness, sub-bass) and being/physics.mjs
// proprioception (local surface deformation from the l=2 modes, displacement and slosh at each receptor, plus jolt). No
// analyzer, no ML, no beat tracker. Receptor transduction is physiology (adapting hair cells, a saturating rate), not
// wiring. Interoceptive cells feel the milieu's variables as an input current. Outputs: motor cells add forces and
// torques to the physical body; chromatophores expand with their cell's firing and set the skin's colour.
//
//   const o = createOrganism({ genome, seed });  o.step(dt, audioChunk);  o.tick(earFrame)  (precomputed frames)
// Cost: see lab/organism/evolve.mjs and tests/organism.test.mjs (measured, network and ear reported apart).

import { createEar, SR, NE, DELTA } from '../../being/ear.mjs';
import { createPhysics } from '../../being/physics.mjs';
import { develop, T, KMAX } from './develop.mjs';
import { createNetwork, DT } from './network.mjs';
import { createMilieu } from './milieu.mjs';
import { decode } from './genome.mjs';

export const FRAME = SR * DT;      // 192 audio samples per network step
const MOTOR_F = 0.5;               // force of one fully contracted motor cell (the groove's own push peaks near 2-3)
const c01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
// real l=2 harmonics in physics.mjs's mode order: xy, yz, 2z^2-x^2-y^2, xz, x^2-y^2
const Y2 = (u) => [u[0] * u[1], u[1] * u[2], 0.5 * (2 * u[2] * u[2] - u[0] * u[0] - u[1] * u[1]), u[0] * u[2], 0.5 * (u[0] * u[0] - u[1] * u[1])];

export function createOrganism({ genome, seed = 1, dev = null } = {}) {
  dev = dev || develop(genome, seed);
  const G = dev.G || decode(genome), N = dev.N;
  const net = createNetwork(dev, { seed });
  const milieu = createMilieu(G);
  let ear = createEar(), phys = createPhysics();
  const by = (t) => { const l = []; for (let i = 0; i < N; i++) if (dev.type[i] === t) l.push(i); return Int32Array.from(l); };
  const C = { ear: by(T.EAR), onset: by(T.ONSET), rough: by(T.ROUGH), sub: by(T.SUB), proprio: by(T.PROPRIO), inter: by(T.INTER), intero: by(T.INTERO), mod: by(T.MOD), motor: by(T.MOTOR), chrom: by(T.CHROM) };
  const unit = (i) => dev.extra[4 * i] | 0, u3 = (i) => { const p = dev.pos, l = Math.hypot(p[3 * i], p[3 * i + 1], p[3 * i + 2]) || 1; return [p[3 * i] / l, p[3 * i + 1] / l, p[3 * i + 2] / l]; };
  const propY = Array.from(C.proprio, (i) => Y2(u3(i))), propU = Array.from(C.proprio, u3);
  const slow = new Float32Array(NE).fill(DELTA);
  const act = new Float32Array(N);                  // effector state: motor twitch summation, chromatophore expansion
  const DEC_M = Math.exp(-DT / 0.08), DEC_C = Math.exp(-DT / 0.3), ADAPT = DT / 0.4;
  const out = { force: [0, 0, 0], torque: [0, 0, 0], motor: 0, chrom: 0, stim: 0, interHz: 0, rateHz: 0 };
  let inSamples = 0, time = 0, interE = 0, rateE = 0, synMass = 0, trophic = 1;
  const rec = { motorSpikes: [], onsets: [] };      // optional recording for analysis (times in s)
  let recording = false;

  function senses(f) {
    // hair cells: a phasic part that adapts (tau 0.4 s) and a tonic part; the ear's own hum keeps a spontaneous rate
    let stim = 0;
    for (let k = 0; k < NE; k++) slow[k] += ADAPT * (f.amp[k] - slow[k]);
    for (const i of C.ear) {
      const k = unit(i), amp = f.amp[k], ph = Math.max(0, Math.log((amp + 1e-4) / (slow[k] + DELTA))), to = Math.max(0, Math.log(amp / 0.05));
      net.ext[i] = 2 + 70 * Math.tanh(ph) + 20 * Math.tanh(to); stim += Math.tanh(ph);
    }
    stim /= C.ear.length;
    const on = Math.tanh(f.onset / 5);
    for (const i of C.onset) net.ext[i] = 2 + 120 * on;
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
    out.stim = c01(stim * 2 + 0.5 * on);            // sensory novelty (adapting hair cells and onsets)
  }

  /** one network step (4 ms) from an ear frame */
  function tick(f) {
    senses(f);
    const E = milieu.s.energy; net.S.energyFactor = 1.15 * E / (E + 0.15);
    const S = net.step();
    // effectors
    let fx = 0, fy = 0, fz = 0, tx = 0, ty = 0, tz = 0, mot = 0, chr = 0;
    for (const i of C.motor) {
      let a = act[i] * DEC_M + (net.spk[i] ? 0.25 : 0); if (a > 1) a = 1; act[i] = a; mot += a;
      if (a < 1e-4) continue;
      const v = dev.vec, p = dev.pos, f0 = MOTOR_F * a * (-0.7 * v[6 * i] + 0.7 * v[6 * i + 3]), f1 = MOTOR_F * a * (-0.7 * v[6 * i + 1] + 0.7 * v[6 * i + 4]), f2 = MOTOR_F * a * (-0.7 * v[6 * i + 2] + 0.7 * v[6 * i + 5]);
      fx += f0; fy += f1; fz += f2;
      tx += p[3 * i + 1] * f2 - p[3 * i + 2] * f1; ty += p[3 * i + 2] * f0 - p[3 * i] * f2; tz += p[3 * i] * f1 - p[3 * i + 1] * f0;
    }
    for (const i of C.chrom) { let a = act[i] * DEC_C + (net.spk[i] ? 0.15 : 0); if (a > 1) a = 1; act[i] = a; chr += a; }
    out.force[0] = fx; out.force[1] = fy; out.force[2] = fz; out.torque[0] = tx; out.torque[1] = ty; out.torque[2] = tz;
    out.motor = mot / Math.max(1, C.motor.length); out.chrom = chr / Math.max(1, C.chrom.length);
    phys.step(DT, { fx, fy, fz, tx, ty, tz, sub: f.sub, hit: f.onset });
    // rates for the milieu
    let ni = 0; for (const i of C.inter) ni += net.spk[i];
    const kk = 1 - Math.exp(-DT / 0.25);
    interE += kk * (ni / (C.inter.length * DT) - interE); rateE += kk * (S.spikes / (N * DT) - rateE);
    out.interHz = interE; out.rateHz = rateE;
    // once a second: synaptic mass (maintenance cost) and trophic use (share of synapses whose presynaptic cell fires >= 2 Hz)
    if ((Math.round(time / DT) % 250) === 0) {
      let s = 0, use = 0, m = 0;
      for (let p = 0; p < N; p++) { const u = Math.min(1, net.rbar[p] / 2); for (let q = p * KMAX, e = q + net.nOut[p]; q < e; q++) { s += net.w[q]; use += u; m++; } }
      synMass = s / N; trophic = m ? use / m : 0;
    }
    milieu.update({ dt: DT, rateHz: rateE, interHz: interE, credit: S.credit, creditNorm: S.creditNorm, sensoryIn: S.sensoryIn, motor: out.motor, chrom: out.chrom, synMass, strain: phys.strain, stim: 0.7 * out.stim + 0.3 * trophic });
    if (recording) { for (const i of C.motor) if (net.spk[i]) rec.motorSpikes.push(time); if (f.onset > 1) rec.onsets.push(time); }
    time += DT;
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
      predFrac: m.predFrac, predShare: m.predShare, strain: phys.strain, motor: out.motor, chrom: out.chrom, gE: net.S.gEmean, gI: net.S.gImean };
  }
  /** the skin: per chromatophore expansion and pigment, plus a summary (brightness, mean hue, patchiness) */
  function skin() {
    let b = 0, hs = 0, hc = 0, v = 0; const ex = new Float32Array(C.chrom.length);
    C.chrom.forEach((i, k) => { const a = act[i], h = dev.extra[4 * i]; ex[k] = a; b += a; hs += a * Math.sin(2 * Math.PI * h); hc += a * Math.cos(2 * Math.PI * h); });
    b /= Math.max(1, C.chrom.length); for (const a of ex) v += (a - b) ** 2;
    return { expansion: ex, cells: C.chrom, brightness: b, hue: ((Math.atan2(hs, hc) / (2 * Math.PI)) + 1) % 1, pattern: Math.sqrt(v / Math.max(1, ex.length)) };
  }
  function serialize() { return { genome: Array.from(dev.genome), seed: dev.seed, t: time, net: net.serialize(), milieu: milieu.serialize(), act: Array.from(act), slow: Array.from(slow) }; }
  function restore(o) { net.restore(o.net); milieu.restore(o.milieu); act.set(o.act); slow.set(o.slow); time = o.t; }

  return {
    dev, G, net, milieu, C, act, out, rec, step, tick, state, skin, serialize, restore,
    get phys() { return phys; }, get ear() { return ear; }, get time() { return time; }, get lastFrame() { return last; },
    record(on = true) { recording = on; if (on) { rec.motorSpikes.length = 0; rec.onsets.length = 0; } },
    poke(s = 1) { phys.impulse(s * (Math.random() - 0.5) * 2, s * (Math.random() - 0.5) * 2, s * (Math.random() - 0.5) * 2); },
  };
}

/** restore an organism from serialize() output */
export function restoreOrganism(o) { const org = createOrganism({ genome: Float64Array.from(o.genome), seed: o.seed }); org.restore(o); return org; }
