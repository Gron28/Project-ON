// being/fft.mjs - the radix-2 FFT shared by the analysers (pure, no DOM): tables cached per size, an in-place complex
// transform, and a real-input transform (n real samples through one n/2 complex FFT plus a post-twiddle).
// Sign convention: X[k] = sum x[t] e^(-2 pi i k t / n), no scaling.

const tables = new Map();

/** bit-reversal permutation and twiddles (cos, -sin of 2 pi k / n for k < n/2) for a power-of-two size, built once */
export function fftTables(n) {
  let t = tables.get(n);
  if (t) return t;
  if (!(n >= 1 && (n & (n - 1)) === 0)) throw new Error(`fft size ${n} is not a power of two`);
  const bits = Math.round(Math.log2(n)), rev = new Uint32Array(n), cos = new Float64Array(n >> 1), sin = new Float64Array(n >> 1);
  for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) if ((i >> b) & 1) r |= 1 << (bits - 1 - b); rev[i] = r; }
  for (let i = 0; i < n >> 1; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = -Math.sin((2 * Math.PI * i) / n); }
  t = { n, rev, cos, sin };
  tables.set(n, t);
  return t;
}

/** in-place complex FFT of re[0..n), im[0..n) (n a power of two, default re.length) */
export function fft(re, im, n = re.length) {
  const { rev, cos, sin } = fftTables(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const a = i + j, b = a + half, wr = cos[k], wi = sin[k];
        const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}

/**
 * a transform of n real samples (n >= 4, a power of two): rfft(x, re, im) reads x[0..n) and writes bins 0..n/2 into
 * re and im (length >= n/2 + 1). Packs even/odd samples as one n/2 complex signal, so it costs about half a complex FFT.
 * Owns its scratch: one instance per caller.
 */
export function realFFT(n) {
  if (!(n >= 4)) throw new Error(`real fft size ${n} is too small`);
  const h = n >> 1, { cos, sin } = fftTables(n), zr = new Float64Array(h), zi = new Float64Array(h);
  fftTables(h);
  return function rfft(x, re, im) {
    for (let i = 0; i < h; i++) { zr[i] = x[2 * i]; zi[i] = x[2 * i + 1]; }
    fft(zr, zi, h);
    re[0] = zr[0] + zi[0]; im[0] = 0;
    re[h] = zr[0] - zi[0]; im[h] = 0;
    for (let k = 1; k < h; k++) {
      // even part E = (Z[k] + conj Z[h-k]) / 2, odd part O = (Z[k] - conj Z[h-k]) / 2i, X[k] = E + W^k O
      const ar = zr[k], ai = zi[k], br = zr[h - k], bi = zi[h - k];
      const er = 0.5 * (ar + br), ei = 0.5 * (ai - bi), or = 0.5 * (ai + bi), oi = -0.5 * (ar - br), wr = cos[k], wi = sin[k];
      re[k] = er + wr * or - wi * oi;
      im[k] = ei + wr * oi + wi * or;
    }
  };
}
