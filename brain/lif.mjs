// lif.mjs - a whole fly brain as leaky integrate-and-fire neurons on the real FlyWire wiring.
//
// Model (Shiu et al. 2024, Nature 634:210): for every neuron
//     tau_m dv/dt = (v_rest - v) + g           g is the summed synaptic input, in mV
//     tau_s dg/dt = -g
// A presynaptic spike adds  w_syn * sign(pre) * synapse_count  to g of every postsynaptic neuron after a
// fixed delay. Reaching v_th fires a spike, resets v to v_reset and freezes the neuron for t_ref.
// GABA and glutamate neurons are inhibitory; everything else is excitatory.
//
// Integration is exact for this linear system over one step, so dt only sets the resolution of spike
// times and delays. Only neurons that are doing something (synaptic input above a tiny threshold,
// membrane away from rest, or refractory) are stepped: the brain is mostly silent, so this is what
// makes 139k neurons affordable in plain JavaScript.
//
// Nothing here touches the DOM; it runs in a Worker and in Node (tests, benchmarks).

export const MODEL = { tau_m: 20, v_rest: -52, v_reset: -52, v_th: -45, t_ref: 2.2, tau_s: 5, delay: 1.8, w_syn: 0.275 };

export function parseBrain(buffer, meta) {
  const view = (sec, Ctor) => new Ctor(buffer, meta.sections[sec].offset, meta.sections[sec].length);
  const b = {
    N: meta.N, E: meta.E, meta,
    pos: view('pos', Float32Array), sign: view('sign', Int8Array), nt: view('nt', Uint8Array), cls: view('cls', Uint8Array), side: view('side', Int8Array),
    rowPtr: view('rowPtr', Uint32Array), col: view('col', Uint32Array), w: view('w', Int16Array),
    groups: {},
  };
  const g = view('groups', Uint32Array);
  for (const [name, [off, n]] of Object.entries(meta.groups)) b.groups[name] = g.subarray(off, off + n);
  return b;
}

export class FlyBrain {
  /**
   * @param {ReturnType<typeof parseBrain>} brain
   * @param {{dt?:number, seed?:number, wScale?:number}} opts  dt in ms (0.5 default), wScale multiplies w_syn (1 = paper)
   */
  constructor(brain, { dt = 0.5, seed = 12345, wScale = 1 } = {}) {
    const N = brain.N;
    this.brain = brain;
    this.N = N;
    this.dt = dt;
    this.step = 0;
    this.time = 0; // ms of brain time
    const M = this.M = { ...MODEL };
    // exact one-step propagators
    this.eS = Math.exp(-dt / M.tau_s);
    this.eM = Math.exp(-dt / M.tau_m);
    this.gK = (M.tau_s / (M.tau_s - M.tau_m)) * (this.eS - this.eM); // v gets gK * g over one step
    this.refSteps = Math.ceil(M.t_ref / dt);
    this.delaySteps = Math.max(1, Math.round(M.delay / dt));

    // synaptic weights in mV, one per connection (plasticity edits these)
    const E = brain.E;
    this.wmv = new Float32Array(E);
    const ws = M.w_syn * wScale;
    for (let e = 0; e < E; e++) this.wmv[e] = brain.w[e] * ws;

    this.v = new Float32Array(N).fill(M.v_rest);
    this.g = new Float32Array(N);
    this.refUntil = new Int32Array(N).fill(-1); // step index until which the neuron is refractory
    this.active = new Uint32Array(N);           // list of neurons to step
    this.isActive = new Uint8Array(N);
    this.nActive = 0;
    this.ring = Array.from({ length: this.delaySteps + 1 }, () => ({ ids: new Uint32Array(4096), n: 0 }));
    this.spikeCount = new Uint32Array(N);       // total spikes per neuron (readouts take differences)
    this.frameSpikes = new Uint32Array(1 << 16); // spikes since the last takeSpikes(): neuron ids
    this.nFrameSpikes = 0;
    this.droppedFrameSpikes = 0;
    this.totalSpikes = 0;
    this.rate = new Float32Array(N);              // per-neuron rate estimate (Hz), tau 100 ms
    this.rateDecay = Math.exp(-dt / 100);
    this.rateKick = 1000 / 100;                     // one spike adds 1/tau (per ms) * 1000 -> Hz
    this.eps = 0.02; // mV: below this the neuron is considered at rest

    // external drive: Poisson rate in Hz per neuron (sparse: only the neurons listed in driveIds)
    this.driveIds = new Uint32Array(0);
    this.driveRate = new Float32Array(0);
    // external current: added to g each step for the listed neurons (mV, decays like a synapse)
    this.rng = mulberry32(seed);
    this.rngState = seed | 0;
  }

  /** Set which neurons receive external Poisson spikes. rates in Hz, same length. The arrays are kept by reference. */
  setDrive(ids, rates) { this.driveIds = ids; this.driveRate = rates; }

  _activate(i) { if (!this.isActive[i]) { this.isActive[i] = 1; this.active[this.nActive++] = i; } }

  /** Force neuron i to spike now (sensory input, stimulation). */
  spike(i) {
    const s = this.step;
    this.v[i] = this.M.v_reset;
    this.refUntil[i] = s + this.refSteps;
    this.spikeCount[i]++;
    this.totalSpikes++;
    this.rate[i] += this.rateKick;
    const slot = this.ring[(s + this.delaySteps) % this.ring.length];
    if (slot.n === slot.ids.length) { const bigger = new Uint32Array(slot.ids.length * 2); bigger.set(slot.ids); slot.ids = bigger; }
    slot.ids[slot.n++] = i;
    if (this.nFrameSpikes < this.frameSpikes.length) this.frameSpikes[this.nFrameSpikes++] = i; else this.droppedFrameSpikes++;
    this._activate(i);
  }

  /** Advance one step of dt ms. */
  tick() {
    const { v, g, refUntil, isActive, active, M, brain, wmv, rate } = this;
    const { rowPtr, col } = brain;
    const s = this.step;
    const eS = this.eS, eM = this.eM, gK = this.gK, vr = M.v_rest, vth = M.v_th, eps = this.eps, rd = this.rateDecay;

    // 1. deliver the spikes whose delay ends now
    const slot = this.ring[s % this.ring.length];
    for (let k = 0; k < slot.n; k++) {
      const pre = slot.ids[k];
      const a = rowPtr[pre], b = rowPtr[pre + 1];
      for (let e = a; e < b; e++) {
        const post = col[e];
        g[post] += wmv[e];
        if (!isActive[post]) { isActive[post] = 1; active[this.nActive++] = post; }
      }
    }
    slot.n = 0;

    // 2. external Poisson drive (sensory neurons spike directly)
    // mulberry32 inlined: compare the raw 32-bit draw against rate * dt scaled to 2^32
    const dIds = this.driveIds, dRate = this.driveRate, pScale = (this.dt / 1000) * 4294967296;
    let a = this.rngState | 0;
    for (let k = 0; k < dIds.length; k++) {
      const r = dRate[k];
      if (r <= 0) continue;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      if (((t ^ (t >>> 14)) >>> 0) < r * pScale) { const i = dIds[k]; if (refUntil[i] <= s) this.spike(i); }
    }
    this.rngState = a;

    // 3. step the active neurons; compact the list as neurons settle
    let n = this.nActive, j = 0;
    for (let k = 0; k < n; k++) {
      const i = active[k];
      const gi = g[i];
      if (refUntil[i] > s) {
        g[i] = gi * eS; // input keeps decaying while the membrane is clamped
        active[j++] = i; continue;
      }
      const vi = vr + (v[i] - vr) * eM + gK * gi;
      const gn = gi * eS;
      g[i] = gn;
      if (vi >= vth) { v[i] = vi; this.spike(i); active[j++] = i; continue; }
      v[i] = vi;
      if (gn > eps || gn < -eps || vi - vr > eps || vr - vi > eps) active[j++] = i;
      else { v[i] = vr; g[i] = 0; isActive[i] = 0; }
    }
    this.nActive = j;
    // rate estimates only need decaying for neurons that have one
    this.step = s + 1;
    this.time = this.step * this.dt;
    if ((this.step & 15) === 0) { const d = rd ** 16; for (let i = 0; i < this.N; i++) rate[i] *= d; }
  }

  /** Run for `ms` of brain time. */
  run(ms) { const n = Math.round(ms / this.dt); for (let k = 0; k < n; k++) this.tick(); }

  /** Mean rate (Hz) over a group of neuron indices, from the 100 ms rate estimate. */
  groupRate(ids) { let s = 0; const r = this.rate; for (let k = 0; k < ids.length; k++) s += r[ids[k]]; return ids.length ? s / ids.length : 0; }

  /** Neuron ids that spiked since the last call (copy), then clear. */
  takeSpikes() { const out = this.frameSpikes.slice(0, this.nFrameSpikes); this.nFrameSpikes = 0; this.droppedFrameSpikes = 0; return out; }
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
