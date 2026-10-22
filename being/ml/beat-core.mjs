// beat-core.mjs - the rhythm organ's ear: Beat This! (small, Foscarin, Schlueter & Widmer, ISMIR 2024; MIT) on the
// latest seconds of sound, every second. Independent of Worker / Node / DOM, like brain-core.mjs.
//
//   48 kHz mono -> streaming resampler -> 22.05 kHz ring (16 s) -> every 1.5 s: log-mel of the last 10 s
//   (STFT 1024, hop 441 = 50 fps, periodic Hann, |X| / sqrt(1024), the model's own 513 x 128 filterbank, log1p(1000 x))
//   -> small0 -> beat and downbeat logits per frame -> tempo by autocorrelation of the beat curve (periodicity is the
//   confidence: chaotic passages read as no pulse), peaks -> beats per bar, last beat and downbeat times.
//
// The model looks both ways in time, so its newest ~0.3 s is unsure: beats are taken up to that edge and the page
// extrapolates the phase from them. Times are in seconds of audio pushed so far (the page keeps the same clock).

import { Resampler } from './mel.mjs';
import { realFFT } from '../fft.mjs';

export const SR = 22050, NFFT = 1024, HOP = 441, FPS = 50, BINS = 128;
export const EVERY_S = 1.5, WINDOW_S = 10, RING_S = 16, EDGE_S = 0.3, SILENCE_RMS = 0.003;
const MODEL = 'beat-this-small0', FILTERBANK = 'beat-this-mel';

const HANN = Float32Array.from({ length: NFFT }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / NFFT));   // periodic
const sig = (x) => 1 / (1 + Math.exp(-x));

/** the filterbank (bins x bands, row-major) as per-band lists of its non-zero weights, in bin order */
function sparseBands(fb) {
  const nb = NFFT / 2 + 1, start = new Int32Array(BINS + 1), idx = [], w = [];
  for (let b = 0; b < BINS; b++) {
    start[b] = idx.length;
    for (let k = 0; k < nb; k++) { const v = fb[k * BINS + b]; if (v) { idx.push(k); w.push(v); } }
  }
  start[BINS] = idx.length;
  return { fb, start, idx: Int32Array.from(idx), w: Float32Array.from(w) };
}

/** local maxima above 0 logit within +-3 frames (the reference 'minimal' peak picking, kernel 7) */
export function peaks(logits, until = logits.length) {
  const out = [];
  for (let i = 0; i < until; i++) {
    if (logits[i] <= 0) continue;
    let m = true; for (let k = -3; k <= 3 && m; k++) if (k && i + k >= 0 && i + k < logits.length && logits[i + k] > logits[i]) m = false;
    if (m && (!out.length || i - out[out.length - 1] > 1)) out.push(i);
  }
  return out;
}

/**
 * From beat and downbeat frames: tempo (median inter-beat interval), beats per bar (median downbeat spacing in beats),
 * how regular the beats are, and the last beat / downbeat frame. Pure; frames at FPS.
 */
export function rhythmOf(beatF, downF) {
  if (beatF.length < 3) return null;
  const ibi = beatF.slice(1).map((f, i) => f - beatF[i]).sort((a, b) => a - b), med = ibi[ibi.length >> 1];
  if (!(med > 0)) return null;
  const dev = ibi.reduce((s, x) => s + Math.abs(x - med), 0) / ibi.length / med;   // 0 = metronomic
  let perBar = 0;
  if (downF.length >= 2) {
    const sp = downF.slice(1).map((f, i) => Math.round((f - downF[i]) / med)).filter((n) => n >= 2 && n <= 9).sort((a, b) => a - b);
    if (sp.length) perBar = sp[sp.length >> 1];
  }
  return { period: med / FPS, bpm: (60 * FPS) / med, regularity: Math.max(0, 1 - 2 * dev), perBar, lastBeat: beatF[beatF.length - 1], lastDown: downF.length ? downF[downF.length - 1] : -1 };
}

/**
 * Tempo from the beat curve (probabilities, FPS): normalised autocorrelation over 50-200 bpm, weighted toward ~110 bpm
 * (a log-normal prior one octave wide, as in perceived-tempo models), refined by a parabola. Returns { period s, bpm,
 * periodicity 0..1 } or null.
 */
export function tempoOf(a, n = a.length) {
  let m = 0; for (let i = 0; i < n; i++) m += a[i] / n;
  let v = 0; for (let i = 0; i < n; i++) v += (a[i] - m) ** 2;
  if (v < 1e-6) return null;
  const lo = Math.floor((60 * FPS) / 200), hi = Math.ceil((60 * FPS) / 50), r = new Float32Array(hi + 2);
  for (let L = lo - 1; L <= hi + 1; L++) { let s = 0; for (let i = 0; i + L < n; i++) s += (a[i] - m) * (a[i + L] - m); r[L] = (s / v) * (n / (n - L)); }
  let best = -1, bs = -1e9;
  for (let L = lo; L <= hi; L++) {
    if (!(r[L] >= r[L - 1] && r[L] >= r[L + 1])) continue;
    const w = r[L] * Math.exp(-0.5 * (Math.log2((60 * FPS) / L / 110)) ** 2);
    if (w > bs) { bs = w; best = L; }
  }
  if (best < 0 || r[best] <= 0) return null;
  const d = r[best - 1] - 2 * r[best] + r[best + 1], off = d < 0 ? (0.5 * (r[best - 1] - r[best + 1])) / d : 0, L = best + Math.max(-0.5, Math.min(0.5, off));
  return { period: L / FPS, bpm: (60 * FPS) / L, periodicity: Math.max(0, Math.min(1, r[best])) };
}

export class BeatCore {
  /** @param {{ort:any, loadModel:(name:string, kind:'onnx'|'bin')=>Promise<ArrayBuffer|Uint8Array>, inputRate?:number}} o */
  constructor({ ort, loadModel, inputRate = 48000 }) {
    this.ort = ort; this.loadModel = loadModel;
    this.resampler = new Resampler(inputRate, SR);
    this.ring = new Float32Array(RING_S * SR); this.end = 0; this.since = 0;
    this.inputRate = inputRate; this.pushed = 0;   // input samples ever pushed (the clock)
    this._rs = new Float32Array(8192);
    this.fft = realFFT(NFFT); this.xw = new Float32Array(NFFT); this.re = new Float64Array(NFFT / 2 + 1); this.im = new Float64Array(NFFT / 2 + 1); this.mag = new Float32Array(NFFT / 2 + 1);
    this.ready = false;
  }

  async init() {
    const fb = await this.loadModel(FILTERBANK, 'bin');
    const u8 = fb instanceof Uint8Array ? fb : new Uint8Array(fb);
    this.fb = new Float32Array(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
    if (this.fb.length !== (NFFT / 2 + 1) * BINS) throw new Error(`filterbank: ${this.fb.length} values`);
    const m = await this.loadModel(MODEL, 'onnx');
    this.session = await this.ort.InferenceSession.create(m instanceof Uint8Array ? m : new Uint8Array(m), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    this.ready = true;
  }

  /** 48 kHz mono in; a result about once a second (or null) */
  async push(samples) {
    this.pushed += samples.length;
    const cap = Math.ceil(samples.length / this.resampler.step) + 4;
    if (this._rs.length < cap) this._rs = new Float32Array(cap);
    const n = this.resampler.process(samples, this._rs), R = this.ring.length;
    for (let i = 0; i < n; i++) this.ring[(this.end + i) % R] = this._rs[i];
    this.end += n; this.since += n;
    if (this.since < EVERY_S * SR || this.end < 4 * SR) return null;
    this.since = 0;
    return this.analyse();
  }

  /** log-mel frames of the latest `sec` seconds (frames fully inside the span), row-major [frames, 128] */
  mel(sec) {
    const R = this.ring.length, len = Math.min(this.end, Math.round(sec * SR), R), start = this.end - len;
    const frames = Math.floor((len - NFFT) / HOP) + 1, out = new Float32Array(frames * BINS), { xw, re, im, mag } = this, sq = Math.sqrt(NFFT);
    if (!this.bands || this.bands.fb !== this.fb) this.bands = sparseBands(this.fb);
    const { start: bs, idx, w } = this.bands;
    let e = 0;
    for (let f = 0; f < frames; f++) {
      for (let i = 0; i < NFFT; i++) { const x = this.ring[(start + f * HOP + i) % R]; xw[i] = x * HANN[i]; if (i < HOP) e += x * x; }
      this.fft(xw, re, im);
      for (let k = 0; k <= NFFT / 2; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / sq;
      for (let b = 0; b < BINS; b++) { let s = 0; for (let j = bs[b]; j < bs[b + 1]; j++) s += mag[idx[j]] * w[j]; out[f * BINS + b] = Math.log1p(1000 * s); }
    }
    return { data: out, frames, rms: Math.sqrt(e / Math.max(1, frames * HOP)), endTime: this.pushed / this.inputRate, spanS: (frames - 1) * HOP / SR + NFFT / SR };
  }

  async analyse() {
    const t0 = performance.now();
    const m = this.mel(WINDOW_S);
    if (m.rms < SILENCE_RMS) return { silent: true, rms: m.rms };
    const { ort } = this;
    const o = await this.session.run({ [this.session.inputNames[0]]: new ort.Tensor('float32', m.data, [1, m.frames, BINS]) });
    const bl = o[this.session.outputNames[0]].data, dl = o[this.session.outputNames[1]].data;
    const edge = m.frames - Math.round(EDGE_S * FPS);
    const bF = peaks(bl, edge), dF = peaks(dl, edge), r = rhythmOf(bF, dF);
    const prob = new Float32Array(edge); for (let i = 0; i < edge; i++) prob[i] = sig(bl[i]);
    const tp = tempoOf(prob);
    // frame f ends (in audio time) at endTime - (frames - 1 - f) / FPS, near enough (the frame centre is NFFT/2 earlier)
    const tOf = (f) => m.endTime - (m.frames - 1 - f) / FPS - NFFT / 2 / SR;
    const keep = Math.min(m.frames, 6 * FPS), beat = new Float32Array(keep), down = new Float32Array(keep);
    for (let i = 0; i < keep; i++) { beat[i] = sig(bl[m.frames - keep + i]); down[i] = sig(dl[m.frames - keep + i]); }
    const strength = bF.length ? bF.reduce((s, f) => s + sig(bl[f]), 0) / bF.length : 0;
    return {
      type: 'beat', endTime: m.endTime, ms: performance.now() - t0, beat, down,
      beats: bF.map(tOf), downbeats: dF.map(tOf),
      bpm: tp ? tp.bpm : 0, period: tp ? tp.period : 0, perBar: r && tp ? Math.round(r.perBar * r.period / tp.period) || r.perBar : 0,
      lastBeat: r ? tOf(r.lastBeat) : -1, lastDown: r && r.lastDown >= 0 ? tOf(r.lastDown) : -1,
      periodicity: tp ? tp.periodicity : 0,
      // confidence: the beat curve is periodic, and the model is sure of its beats
      confidence: tp && r ? Math.min(1, tp.periodicity * 1.6) * Math.min(1, strength * 1.3) : 0,
    };
  }

  async dispose() { try { await this.session?.release?.(); } catch {} this.session = null; this.ready = false; }
}
