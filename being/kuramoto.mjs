// being/kuramoto.mjs - the being's motor pulse as a population of coupled phase oscillators. Pure module.
//
// Kuramoto 1975; forced population: Childs & Strogatz 2008 (Ott-Antonsen form); nonlocal coupling with a phase lag
// (Kuramoto & Battogtokh 2002; Abrams & Strogatz 2004); notebook section 2.5.
//
// The body is divided into eight regions, one per corner of a cube (directions from the nucleus, no up or down). Each
// region holds a few oscillators whose natural frequencies are spread around the region's own centre (a Lorentzian, so
// the critical coupling is known: Kc = 2 * spread). Regions are coupled nonlocally: strongly to themselves, less to the
// regions further round the body. The coupling stays below Kc, so without music the population drifts apart (its
// afterglow fades) and is held together only by the music's pulse. Lockedness is then a measured order parameter, not
// a formula: it snaps in when the forcing pulls the population over threshold and lets go later than it caught hold
// (hysteresis), and an ambiguous rhythm leaves it partly locked.
//
// Drives: each is a pulse the being feels (phase, Hz) with a gain and a weight per region. A second, cross pulse that is
// not an octave of the first can claim part of the body, which then locks to it on its own while the rest keeps the main
// pulse: a body in two rhythms at once.

const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

/** the eight region directions: the corners of a cube, unit length */
export const REGION_DIRS = Array.from({ length: 8 }, (_, g) => [(g & 1 ? 1 : -1), (g & 2 ? 1 : -1), (g & 4 ? 1 : -1)].map((v) => v / Math.sqrt(3)));
export const NREG = 8;

export function createPopulation({ per = 6, seed = 1, kernelA = 0.8, lag = 0.2 } = {}) {
  const N = NREG * per;
  let s = seed >>> 0 || 1;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s + 0.5) / 4294967296; };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd())) * Math.cos(TAU * rnd());
  // Lorentzian quantiles (clipped): the spread of natural frequencies inside a region
  const q = new Float64Array(N), th = new Float64Array(N);
  for (let g = 0; g < NREG; g++) for (let k = 0; k < per; k++) q[g * per + k] = clamp(Math.tan(Math.PI * ((k + 0.5) / per - 0.5)), -3, 3);
  for (let i = 0; i < N; i++) th[i] = TAU * rnd();
  // each region is slightly detuned from the others, so a weakly held body ripples and a strongly held one moves as one
  const detune = Float64Array.from({ length: NREG }, () => 0.012 * gauss());
  // nonlocal kernel by the angle between regions (rows sum to 1)
  const W = new Float64Array(NREG * NREG);
  for (let a = 0; a < NREG; a++) {
    let sum = 0;
    for (let b = 0; b < NREG; b++) { const d = REGION_DIRS[a][0] * REGION_DIRS[b][0] + REGION_DIRS[a][1] * REGION_DIRS[b][1] + REGION_DIRS[a][2] * REGION_DIRS[b][2]; W[a * NREG + b] = 1 + kernelA * d; sum += W[a * NREG + b]; }
    for (let b = 0; b < NREG; b++) W[a * NREG + b] /= sum;
  }
  const fReg = new Float64Array(NREG).fill(2);          // each region's centre frequency (Hz), drifting toward what it locks to
  const R = new Float64Array(NREG), Psi = new Float64Array(NREG), Rx = new Float64Array(NREG), Ry = new Float64Array(NREG);

  function meanField() {
    for (let g = 0; g < NREG; g++) {
      let x = 0, y = 0;
      for (let k = 0; k < per; k++) { const t = th[g * per + k]; x += Math.cos(t); y += Math.sin(t); }
      Rx[g] = x / per; Ry[g] = y / per; R[g] = Math.hypot(Rx[g], Ry[g]); Psi[g] = Math.atan2(Ry[g], Rx[g]);
    }
  }
  meanField();

  const pop = {
    N, per, R, Psi, fReg,
    /**
     * @param {number} dt seconds
     * @param {object} o { fC: centre Hz, spread: relative width of the natural frequencies, K: coupling as a share of
     *   the critical coupling, noise: phase diffusion (rad^2/s), drives: [{ phase (rad), hz, gain (rad/s), w: per-region weight }] }
     */
    step(dt, o) {
      if (!(dt > 0)) return pop;
      const fC = Number.isFinite(o.fC) ? o.fC : 2, spread = o.spread ?? 0.03, drives = o.drives || [];
      const Kc = 2 * spread * TAU * fC, K = (o.K ?? 0.7) * Kc, D = o.noise ?? 0.02;
      const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n, sq = Math.sqrt(2 * D * h);
      // region centres: pulled toward the pulse each region holds (by how well it holds it), and home to fC
      for (let g = 0; g < NREG; g++) {
        let num = 0.15 * fC, den = 0.15;
        for (const d of drives) { const c = d.gain * (d.w ? d.w[g] : 1) * (0.3 + 0.7 * R[g]); if (c > 0 && Number.isFinite(d.hz)) { num += c * d.hz; den += c; } }
        fReg[g] += (1 - Math.exp(-dt * 0.8)) * (num / den - fReg[g]);
        if (!Number.isFinite(fReg[g])) fReg[g] = fC;
      }
      for (let s2 = 0; s2 < n; s2++) {
        meanField();
        for (let d = 0; d < drives.length; d++) { const dr = drives[d]; if (dr.hz > 0) dr.phase += TAU * dr.hz * h; }
        for (let g = 0; g < NREG; g++) {
          // the field this region feels from all regions, through the kernel, with a phase lag
          let fx = 0, fy = 0;
          for (let b = 0; b < NREG; b++) { const w = W[g * NREG + b]; fx += w * Rx[b]; fy += w * Ry[b]; }
          const fr = Math.hypot(fx, fy), fp = Math.atan2(fy, fx) - lag;
          const w0 = TAU * fReg[g] * (1 + detune[g]);
          for (let k = 0; k < per; k++) {
            const i = g * per + k, t = th[i];
            let v = w0 * (1 + spread * q[i]) + K * fr * Math.sin(fp - t);
            for (const dr of drives) { const w = dr.w ? dr.w[g] : 1; if (dr.gain > 0 && w > 0) v += dr.gain * w * Math.sin(dr.phase - t); }
            th[i] = t + v * h + sq * gauss();
          }
        }
      }
      for (let i = 0; i < N; i++) { if (!Number.isFinite(th[i])) th[i] = TAU * rnd(); th[i] -= TAU * Math.floor(th[i] / TAU); }
      meanField();
      return pop;
    },
    /** order parameter over the regions weighted by w (default all): { r, psi } */
    order(w = null) {
      let x = 0, y = 0, sw = 0;
      for (let g = 0; g < NREG; g++) { const k = w ? w[g] : 1; x += k * Rx[g]; y += k * Ry[g]; sw += k; }
      return sw > 0 ? { r: Math.hypot(x, y) / sw, psi: Math.atan2(y, x) } : { r: 0, psi: 0 };
    },
    /** how well region g is locked to a given phase: cos of its mean phase against it, times its coherence */
    against(g, phase) { return R[g] * Math.cos(Psi[g] - phase); },
    /** a known tempo comes back: every region starts there */
    setCentre(hz) { if (Number.isFinite(hz) && hz > 0) fReg.fill(hz); },
  };
  return pop;
}
