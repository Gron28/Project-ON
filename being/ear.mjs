// being/ear.mjs - the being's ear: a bank of self-tuned critical oscillators. Pure module (worker and tests).
//
// The same module hears in frog hair bundles, fly antennae and mosquito flagella (convergent evolution; Camalet et al.
// 2000; Eguiluz et al. 2000; Goepfert & Robert 2003; Hudspeth 2014). Each unit is a Hopf normal form at its own frequency,
//     dz/dt = w [ (mu + i) z - kappa |z|^2 z + g x(t) ]
// integrated exactly for the linear part and semi-implicitly for the cubic part. A slow calcium-like feedback holds each
// unit at the edge of oscillation (after Camalet eq. 5, bounded): dmu/dt ~ tanh(log(delta^2 / A^2)) / tau. Emergent:
//   - weak sounds are amplified a lot, loud ones barely (compressive, ~1/3 power at mu = 0);
//   - after loud passages mu goes negative: the ear tires, then recovers;
//   - in silence mu creeps above 0 and the unit oscillates by itself: the being hums (spontaneous emission).
// Derived at 1 kHz from its own envelopes: onset strength, roughness (30-150 Hz envelope fluctuation; Arnal 2015, 2019),
// a sub-bass "body ear" envelope (vestibular / tactile; Todd & Cody 2000) and the overall level.

export const SR = 48000;
export const NE = 28;                                                      // 55 Hz .. ~5.9 kHz, 4 per octave
export const EAR_CF = Float64Array.from({ length: NE }, (_, k) => 55 * 2 ** (k / 4));
export const DELTA = 0.015;                                                // the hum amplitude each unit settles at in silence

/** @param {{freezeMu?:number|null, tauMu?:number}} opts  freezeMu: hold every unit at this mu (lab tests) */
export function createEar({ freezeMu = null, tauMu = 2.5, gain = 1, kappa = 1 } = {}) {
  const MU_MIN = -0.08, MU_MAX = 0.04;                                    // MU_MIN keeps Q >= ~6 even when tired
  const W = Float64Array.from(EAR_CF, (f) => 2 * Math.PI * f);
  const dt = 1 / SR;
  const zr = new Float64Array(NE), zi = new Float64Array(NE), mu = new Float64Array(NE).fill(freezeMu ?? -0.05);
  const rotR = new Float64Array(NE), rotI = new Float64Array(NE);
  const env = new Float64Array(NE), blockA2 = new Float64Array(NE);
  // envelope smoothing scaled to each unit's period, so the carrier ripple of low units does not read as roughness
  const ENV_KS = Float64Array.from(EAR_CF, (f) => 1 - Math.exp(-1 / (SR * Math.max(0.003, 2 / f))));
  let blockN = 0;
  const updateRot = () => { for (let k = 0; k < NE; k++) { const a = Math.exp(mu[k] * W[k] * dt), th = W[k] * dt; rotR[k] = a * Math.cos(th); rotI[k] = a * Math.sin(th); } };
  updateRot();
  // scalar state lives in typed arrays: a store to a closure `let` double boxes a new HeapNumber, and sample() runs 48000 times
  // a second (that was ~4 MB/s of garbage in the worker)
  const rs = new Int32Array([1234567]);
  // 1 kHz derived signals
  const DEC = 48; let decN = 0;
  const Z = new Float64Array(9); Z[0] = -10;   // 0 logESlow, 1 onsetAcc, 2 roughAcc, 3 subLP, 4 subEnv, 5 levelEnv; 6-8 tap()'s onset, rough, count
  const envFast = new Float64Array(NE), envSlow = new Float64Array(NE), roughB = new Float64Array(NE); let roughN = 0;
  const RF = 1 - Math.exp(-2 * Math.PI * 150 / 1000), RS = 1 - Math.exp(-2 * Math.PI * 30 / 1000);
  const SUB_K = 1 - Math.exp(-2 * Math.PI * 100 / SR);

  function sample(x) {
    const subLP = Z[3] + SUB_K * (x - Z[3]); Z[3] = subLP;
    const sa = Math.abs(subLP); Z[4] = sa > Z[4] ? sa : Z[4] * 0.9995;
    const ax = Math.abs(x); Z[5] = ax > Z[5] ? ax : Z[5] * 0.9998;
    const sd = (Math.imul(rs[0], 1664525) + 1013904223) | 0; rs[0] = sd;   // the noise floor's LCG, inline
    const nz = 2e-6 * ((sd >>> 0) / 4294967296 - 0.5);
    for (let k = 0; k < NE; k++) {
      const r = zr[k], i = zi[k];
      let nr = r * rotR[k] - i * rotI[k] + W[k] * dt * gain * (x + nz);
      let ni = r * rotI[k] + i * rotR[k];
      const d = 1 / (1 + W[k] * dt * kappa * (nr * nr + ni * ni));
      nr *= d; ni *= d;
      zr[k] = nr; zi[k] = ni;
      const a = Math.sqrt(nr * nr + ni * ni);
      env[k] += ENV_KS[k] * (a - env[k]);
      blockA2[k] += a * a;
    }
    if (++blockN === 64) {                                                // ~1.3 ms: self-tuning of mu
      const bdt = 64 / SR;
      if (freezeMu === null) for (let k = 0; k < NE; k++) {
        const A2 = blockA2[k] / 64;
        mu[k] += (bdt / tauMu) * 0.05 * Math.tanh(0.5 * Math.log((DELTA * DELTA + 1e-12) / (A2 + 1e-12)));
        if (mu[k] < MU_MIN) mu[k] = MU_MIN; else if (mu[k] > MU_MAX) mu[k] = MU_MAX;
      }
      blockA2.fill(0); blockN = 0; updateRot();
    }
    if (++decN === DEC) {
      decN = 0;
      let E = 1e-9;
      for (let k = 0; k < NE; k++) {
        E += env[k] * env[k];
        envFast[k] += RF * (env[k] - envFast[k]); envSlow[k] += RS * (env[k] - envSlow[k]);
        roughB[k] += 0.05 * (Math.abs(envFast[k] - envSlow[k]) - roughB[k]);
        if (envSlow[k] > 2 * DELTA) { Z[2] += roughB[k] / envSlow[k]; roughN++; Z[7] += roughB[k] / envSlow[k]; Z[8]++; }
      }
      const l = Math.log(E);
      const logESlow = Z[0] + 0.012 * (l - Z[0]); Z[0] = logESlow;
      // onsets only count above the ear's own humming, so the being does not startle at itself in silence
      const o = E > NE * (3 * DELTA) * (3 * DELTA) ? Math.max(0, l - logESlow - 0.15) : 0;
      if (o > Z[1]) Z[1] = o;
      if (o > Z[6]) Z[6] = o;
    }
  }
  /** a snapshot of what the ear hears since the last call (onset and roughness are accumulated, then reset) */
  function frame() {
    const amp = Float32Array.from(env), m = Float32Array.from(mu);
    let hum = 0; for (let k = 0; k < NE; k++) if (mu[k] > 0) hum += mu[k] / MU_MAX;
    const rough = roughN ? Z[2] / roughN : 0; Z[2] = 0; roughN = 0;
    const out = { type: 'ear', amp, mu: m, onset: Z[1], rough, sub: Z[4], level: Z[5], hum: hum / NE };
    Z[1] = 0;
    return out;
  }
  /** a second listener's frame (lab/organism, 4 ms): the same signals as frame(), with onset and roughness accumulated
   *  apart, so reading it leaves frame() unchanged; amp is the live envelope (read it before the next sample) */
  const tapF = { amp: env, onset: 0, rough: 0, sub: 0 };
  function tap() { tapF.onset = Z[6]; tapF.rough = Z[8] ? Z[7] / Z[8] : 0; tapF.sub = Z[4]; Z[6] = 0; Z[7] = 0; Z[8] = 0; return tapF; }
  return { sample, frame, tap, env, mu, zr, zi, CF: EAR_CF };
}
