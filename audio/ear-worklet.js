// ear-worklet.js - the antenna. Runs on the audio thread: splits the signal into the bands the fly's
// Johnston's organ is tuned to (see brain/ear.mjs ENV_BANDS) and follows every band's envelope at
// 2 kHz, so pulse timing in the 10-50 ms range (what the fly's ear is built for) survives.
//
// Output: every 24 samples (0.5 ms at 48 kHz) one Float32 row of ENV_BANDS values, batched into
// messages of ENV_BATCH rows: { type:'env', t0 (audio time of the first row), rows: Float32Array }.
// The port the batches go to is given at construction (processorOptions.port) so the brain worker
// gets them without a hop through the main thread.

const ENV_BANDS = 9;      // per channel
const ENV_COLS = 18;      // left bands then right bands: the fly has two antennae
const ENV_BATCH = 32; // rows per message (16 ms)

// biquad band-pass (constant skirt gain, peak gain = Q), RBJ cookbook
function bandpass(sr, f0, q) {
  const w = 2 * Math.PI * f0 / sr, s = Math.sin(w), c = Math.cos(w), a = s / (2 * q);
  const b0 = a, b1 = 0, b2 = -a, a0 = 1 + a, a1 = -2 * c, a2 = 1 - a;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
}
function highpass(sr, f0, q) {
  const w = 2 * Math.PI * f0 / sr, s = Math.sin(w), c = Math.cos(w), a = s / (2 * q);
  const b0 = (1 + c) / 2, b1 = -(1 + c), b2 = (1 + c) / 2, a0 = 1 + a, a1 = -2 * c, a2 = 1 - a;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
}
function lowpass(sr, f0, q) {
  const w = 2 * Math.PI * f0 / sr, s = Math.sin(w), c = Math.cos(w), a = s / (2 * q);
  const b0 = (1 - c) / 2, b1 = 1 - c, b2 = (1 - c) / 2, a0 = 1 + a, a1 = -2 * c, a2 = 1 - a;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
}
function run(f, x) {
  const y = f.b0 * x + f.b1 * f.x1 + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2;
  f.x2 = f.x1; f.x1 = x; f.y2 = f.y1; f.y1 = y;
  return y;
}

class EarProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const sr = sampleRate;
    this.out = options.processorOptions && options.processorOptions.port;
    // band centre / bandwidth -> Q = f0 / bw; two cascaded biquads per band for steeper skirts
    const bands = [[20, 100], [100, 160], [160, 250], [250, 350], [350, 500], [500, 750], [750, 1200], [1200, 8000]];
    const mk = () => bands.map(([lo, hi]) => {
      const f0 = Math.sqrt(lo * hi), q = Math.max(0.5, f0 / (hi - lo));
      return lo <= 20 ? [lowpass(sr, hi, 0.7), lowpass(sr, hi, 0.7)] : [bandpass(sr, f0, q), bandpass(sr, f0, q)];
    });
    this.filters = [mk(), mk()];                 // left antenna, right antenna
    this.env = new Float32Array(ENV_COLS);       // envelope followers (fast attack, ~2 ms release at the band level)
    this.flux = [highpass(sr, 1500, 0.7), highpass(sr, 1500, 0.7)];
    this.fluxEnvFast = [0, 0]; this.fluxEnvSlow = [0, 0];
    this.rel = Math.exp(-1 / (sr * 0.002));
    this.relSlow = Math.exp(-1 / (sr * 0.05));
    this.rows = new Float32Array(ENV_BATCH * ENV_COLS);
    this.row = 0;
    this.sampleInRow = 0;
    this.rowSamples = Math.max(1, Math.round(sr / 2000));
    this.t0 = 0;
    this.level = 0; this.levelK = 1 - Math.exp(-1 / (sr * 0.05));
    this.port.onmessage = (e) => { if (e.data && e.data.port) this.out = e.data.port; };
  }

  process(inputs) {
    const inp = inputs[0];
    if (!inp || !inp.length) return true;
    const L = inp[0], R = inp[1] || inp[0];
    const n = L.length, env = this.env, rel = this.rel;
    for (let i = 0; i < n; i++) {
      for (let ch = 0; ch < 2; ch++) {
        const x = ch ? R[i] : L[i], F = this.filters[ch], o = ch * ENV_BANDS;
        for (let b = 0; b < 8; b++) {
          const f = F[b];
          const y = Math.abs(run(f[1], run(f[0], x)));
          env[o + b] = y > env[o + b] ? y : env[o + b] * rel;
        }
        // broadband transient flux: fast envelope rising above its slow mean
        const h = Math.abs(run(this.flux[ch], x));
        this.fluxEnvFast[ch] = h > this.fluxEnvFast[ch] ? h : this.fluxEnvFast[ch] * rel;
        this.fluxEnvSlow[ch] += (1 - this.relSlow) * (this.fluxEnvFast[ch] - this.fluxEnvSlow[ch]);
        const onset = this.fluxEnvFast[ch] - this.fluxEnvSlow[ch];
        env[o + 8] = onset > env[o + 8] ? onset : env[o + 8] * rel;
      }
      const x = 0.5 * (L[i] + R[i]);
      this.level += this.levelK * (x * x - this.level);
      if (++this.sampleInRow >= this.rowSamples) {
        this.sampleInRow = 0;
        if (this.row === 0) this.t0 = currentTime + i / sampleRate;
        this.rows.set(env, this.row * ENV_COLS);
        if (++this.row === ENV_BATCH) {
          const rows = this.rows.slice();
          const msg = { type: 'env', t0: this.t0, rows, rms: Math.sqrt(this.level) };
          if (this.out) this.out.postMessage(msg, [rows.buffer]); else this.port.postMessage(msg, [rows.buffer]);
          this.row = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('ear', EarProcessor);
