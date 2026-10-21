// mel.mjs - input features for the Essentia EffNet-Discogs model family, in plain JS (no DOM, no deps).
//
// Port of the front end used by Essentia's TensorflowPredictEffnetDiscogs, which internally runs
// FrameCutter -> TensorflowInputMusiCNN (read from MTG/essentia master):
//   * audio: 16 kHz mono
//   * FrameCutter: frameSize 512, hopSize 256, startFromZero = false (frame k is centred on sample k*256;
//     here we only emit frames that lie completely inside the buffer, see melPatches)
//   * Windowing: Hann, symmetric (denominator N-1), NOT normalised (zeroPhase only rotates the frame,
//     magnitudes are unchanged)
//   * Spectrum: |FFT|, size 512 -> 257 bins, no scaling
//   * MelBands: 96 bands, 0..8000 Hz, warping "slaneyMel", weighting "linear", normalize "unit_tri",
//     type "power" (MelBands default: the MusiCNN wrapper never sets it, so the filters weigh |X|^2),
//     triangle weights computed on the linear-Hz axis and divided by the theoretical triangle area
//     (f[i+2]-f[i])/2 (librosa "slaney" style)
//   * x = log10(1 + 10000 * x)           (UnaryOperator shift 1 / scale 10000, then log10)
//   * patches of 128 frames x 96 bands, model input [n,128,96]
//
// Also here: a streaming polyphase-style windowed-sinc resampler (48 kHz -> 16 kHz).

export const SR = 16000;
export const FRAME = 512;
export const HOP = 256;
export const BANDS = 96;
export const PATCH = 128;
export const BINS = FRAME / 2 + 1;

// ---------------------------------------------------------------------------------------------
// Slaney mel (Auditory Toolbox), identical to essentiamath.h hz2melSlaney / mel2hzSlaney.
const MIN_LOG_HZ = 1000;
const LIN_SLOPE = 3 / 200;
const MIN_LOG_MEL = MIN_LOG_HZ * LIN_SLOPE;
const LOG_STEP = Math.log(6.4) / 27;
export const hz2mel = (hz) => (hz < MIN_LOG_HZ ? hz * LIN_SLOPE : MIN_LOG_MEL + Math.log(hz / MIN_LOG_HZ) / LOG_STEP);
export const mel2hz = (mel) => (mel < MIN_LOG_MEL ? mel / LIN_SLOPE : MIN_LOG_HZ * Math.exp((mel - MIN_LOG_MEL) * LOG_STEP));

/** Sparse mel filter bank, same arithmetic as Essentia's TriangularBands::createFilters. */
export function buildMelFilters() {
  const nyq = SR / 2;
  const edges = new Float64Array(BANDS + 2);
  const lo = hz2mel(0), hi = hz2mel(nyq);
  const inc = (hi - lo) / (BANDS + 1);
  for (let i = 0; i < BANDS + 2; i++) edges[i] = mel2hz(lo + inc * i);
  const df = nyq / (BINS - 1);
  const start = new Int32Array(BANDS);
  const weights = [];
  for (let i = 0; i < BANDS; i++) {
    const f0 = edges[i], f1 = edges[i + 1], f2 = edges[i + 2];
    const step1 = f1 - f0, step2 = f2 - f1;
    const jb = Math.ceil(f0 / df);
    const je = Math.min(Math.floor(f2 / df), BINS - 1);
    const w = new Float64Array(je - jb + 1);
    const area = (step1 + step2) / 2; // unit_tri
    for (let j = jb; j <= je; j++) {
      const bf = j * df;
      const c = bf < f1 ? (bf - f0) / step1 : (f2 - bf) / step2;
      w[j - jb] = c / area;
    }
    start[i] = jb;
    weights.push(w);
  }
  return { start, weights, edges };
}

// ---------------------------------------------------------------------------------------------
// Radix-2 complex FFT of fixed size, in place, float64.
class FFT {
  constructor(n) {
    this.n = n;
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = -Math.sin((2 * Math.PI * i) / n);
    }
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      this.rev[i] = r;
    }
  }
  transform(re, im) {
    const n = this.n, rev = this.rev;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, tstep = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += tstep) {
          const a = i + j, b = a + half;
          const wr = this.cos[k], wi = this.sin[k];
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
        }
      }
    }
  }
}

/** Frames -> log-mel. One instance owns its scratch buffers; create once and reuse. */
export class MelExtractor {
  constructor() {
    this.fft = new FFT(FRAME);
    this.win = new Float64Array(FRAME);
    for (let i = 0; i < FRAME; i++) this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1));
    this.re = new Float64Array(FRAME);
    this.im = new Float64Array(FRAME);
    this.pow = new Float64Array(BINS);
    this.bank = buildMelFilters();
  }

  /** One frame: x[off .. off+512) -> out[outOff .. outOff+96) (log10(1 + 1e4 * mel power)). */
  frame(x, off, out, outOff) {
    const { re, im, win, pow } = this;
    for (let i = 0; i < FRAME; i++) { re[i] = x[off + i] * win[i]; im[i] = 0; }
    this.fft.transform(re, im);
    for (let k = 0; k < BINS; k++) pow[k] = re[k] * re[k] + im[k] * im[k];
    const { start, weights } = this.bank;
    for (let b = 0; b < BANDS; b++) {
      const w = weights[b], s = start[b];
      let e = 0;
      for (let j = 0; j < w.length; j++) e += pow[s + j] * w[j];
      out[outOff + b] = Math.log10(1 + 10000 * e);
    }
  }

  /**
   * Fills `out` ([nPatches, patchLen, 96], row-major) from x[off .. off+len) at 16 kHz.
   * Only frames fully inside the span are used (frame f covers x[off + f*256 .. +512)).
   * Patches start every `patchHop` frames, like Essentia (lastPatchMode "discard").
   * patchLen: 128 frames for EffNet-Discogs (default), 187 for MusiCNN (same front end).
   * Returns the number of patches written (<= maxPatches).
   */
  patches(x, off, len, patchHop, maxPatches, out, patchLen = PATCH) {
    const nFrames = len >= FRAME ? Math.floor((len - FRAME) / HOP) + 1 : 0;
    if (nFrames < patchLen) return 0;
    const nPatches = Math.min(maxPatches, Math.floor((nFrames - patchLen) / patchHop) + 1);
    // patches overlap, so compute each frame once into a scratch then copy
    const needed = (nPatches - 1) * patchHop + patchLen;
    if (!this._mel || this._mel.length < needed * BANDS) this._mel = new Float32Array(needed * BANDS);
    for (let f = 0; f < needed; f++) this.frame(x, off + f * HOP, this._mel, f * BANDS);
    for (let p = 0; p < nPatches; p++) {
      out.set(this._mel.subarray(p * patchHop * BANDS, (p * patchHop + patchLen) * BANDS), p * patchLen * BANDS);
    }
    return nPatches;
  }
}

// ---------------------------------------------------------------------------------------------
// Streaming windowed-sinc resampler (Kaiser, 257 taps at the input rate, cutoff 7.7 kHz for 16 kHz out).
// For the integer 48k -> 16k case every output lands exactly on an input sample (phase 0), i.e. an
// ordinary linear-phase FIR + decimate-by-3; other ratios use a 512-phase table (nearest phase).

function bessel0(x) {
  let s = 1, t = 1;
  for (let k = 1; k < 50; k++) { t *= (x / (2 * k)) * (x / (2 * k)); s += t; if (t < 1e-12 * s) break; }
  return s;
}

export class Resampler {
  constructor(inRate = 48000, outRate = SR, { half = 128, beta = 9, phases = 512 } = {}) {
    this.step = inRate / outRate;
    this.H = half;
    this.phases = phases;
    const cutoff = Math.min(0.5 * outRate * 0.9625, 0.5 * inRate * 0.95); // 7.7 kHz for 16 kHz out
    const fc = cutoff / inRate; // cycles per input sample
    const taps = 2 * half + 1;
    this.table = new Float32Array((phases + 1) * taps);
    const i0 = bessel0(beta);
    for (let p = 0; p <= phases; p++) {
      const frac = p / phases;
      let sum = 0;
      for (let k = -half; k <= half; k++) {
        const tau = k - frac; // tap k sits at input offset k, output point is at +frac
        const r = tau / (half + 1);
        const w = Math.abs(r) >= 1 ? 0 : bessel0(beta * Math.sqrt(1 - r * r)) / i0;
        const a = 2 * Math.PI * fc * tau;
        const s = Math.abs(a) < 1e-12 ? 1 : Math.sin(a) / a;
        const v = 2 * fc * s * w;
        this.table[p * taps + k + half] = v;
        sum += v;
      }
      for (let k = 0; k < taps; k++) this.table[p * taps + k] /= sum; // unity DC gain
    }
    this.taps = taps;
    this.carry = new Float32Array(half); // `half` leading zeros: signal starts at time 0
    this.carryLen = half;
    this.base = -half; // absolute input index of carry[0]
    this.t = 0; // absolute input position of the next output
    this._scratch = new Float32Array(0);
  }

  reset() {
    this.carry.fill(0); this.carryLen = this.H; this.base = -this.H; this.t = 0;
  }

  /** Resamples `x`, writes into `out` (Float32Array, large enough: ceil(len/step)+2), returns count. */
  process(x, out) {
    const H = this.H, taps = this.taps;
    const total = this.carryLen + x.length;
    if (this._scratch.length < total) this._scratch = new Float32Array(total + 4096);
    const buf = this._scratch;
    buf.set(this.carry.subarray(0, this.carryLen), 0);
    buf.set(x, this.carryLen);
    const end = this.base + total; // exclusive absolute end
    let n = 0, t = this.t;
    while (Math.floor(t) + H < end) {
      const it = Math.floor(t);
      const ph = Math.round((t - it) * this.phases);
      const tb = ph * taps;
      const bi = it - H - this.base; // buf index of tap -H
      let acc = 0;
      for (let k = 0; k < taps; k++) acc += buf[bi + k] * this.table[tb + k];
      out[n++] = acc;
      t += this.step;
    }
    this.t = t;
    // keep everything from floor(t) - H onwards
    const keepFrom = Math.max(0, Math.floor(t) - H - this.base);
    const keep = total - keepFrom;
    if (this.carry.length < keep) this.carry = new Float32Array(keep + 1024);
    this.carry.set(buf.subarray(keepFrom, total), 0);
    this.carryLen = keep;
    this.base += keepFrom;
    return n;
  }
}
