// vggish-mel.mjs - the input of YAMNet / VGGish models, as Essentia's TensorflowInputVGGish computes it (plain JS, no deps):
//   16 kHz mono · frames of 400 samples every 160 (25 ms / 10 ms) · symmetric Hann, zero-padded to 512 (zeroPhase off)
//   · |FFT| (magnitude) · 64 mel bands 125-7500 Hz on the HTK mel scale, triangles drawn on the mel axis ('warping'),
//   each peaking at 1 ('unit_max'), summing magnitudes ('magnitude') · log(x + 0.01) · patches of 96 frames, input [n, 96, 64]
export const SR = 16000, FRAME = 400, HOP = 160, NFFT = 512, BANDS = 64, PATCH = 96;

const HANN = Float32Array.from({ length: FRAME }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1)));
const hz2mel = (f) => 2595 * Math.log10(1 + f / 700);

/** the 64 triangles, as [startBin, weights[]] */
function melFilters() {
  const lo = hz2mel(125), hi = hz2mel(7500), edges = Array.from({ length: BANDS + 2 }, (_, i) => lo + ((hi - lo) * i) / (BANDS + 1));
  const out = [];
  for (let b = 0; b < BANDS; b++) {
    const [m0, m1, m2] = [edges[b], edges[b + 1], edges[b + 2]], w = [];
    let start = -1;
    for (let k = 0; k <= NFFT / 2; k++) {
      const m = hz2mel((k * SR) / NFFT);
      const v = m <= m0 || m >= m2 ? 0 : m <= m1 ? (m - m0) / (m1 - m0) : (m2 - m) / (m2 - m1);
      if (v > 0) { if (start < 0) start = k; w[k - start] = v; }
    }
    out.push([Math.max(0, start), Float32Array.from(w)]);
  }
  return out;
}

function fft(re, im) {   // in place, radix 2
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a), h = len >> 1;
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < h; k++) { const p = i + k, q = p + h, vr = re[q] * cr - im[q] * ci, vi = re[q] * ci + im[q] * cr; re[q] = re[p] - vr; im[q] = im[p] - vi; re[p] += vr; im[p] += vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
}

export class VGGishMel {
  constructor() { this.F = melFilters(); this.re = new Float32Array(NFFT); this.im = new Float32Array(NFFT); this.mag = new Float32Array(NFFT / 2 + 1); }
  /** one log-mel frame of x[off .. off+400) into out[o .. o+64) */
  frame(x, off, out, o) {
    const { re, im, mag } = this;
    for (let i = 0; i < NFFT; i++) { re[i] = i < FRAME ? (x[off + i] || 0) * HANN[i] : 0; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k <= NFFT / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
    for (let b = 0; b < BANDS; b++) { const [s, w] = this.F[b]; let acc = 0; for (let j = 0; j < w.length; j++) acc += mag[s + j] * w[j]; out[o + b] = Math.log(acc + 0.01); }
  }
  /** the last n patches of the span x[0 .. len), newest last, into out ([n, 96, 64]); returns how many were written */
  patches(x, len, n, out) {
    const frames = Math.floor((len - FRAME) / HOP) + 1, have = Math.min(n, Math.floor(frames / PATCH));
    for (let p = 0; p < have; p++) {
      const first = frames - (have - p) * PATCH;
      for (let f = 0; f < PATCH; f++) this.frame(x, (first + f) * HOP, out, (p * PATCH + f) * BANDS);
    }
    return have;
  }
}
