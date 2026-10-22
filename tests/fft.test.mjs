// tests/fft.test.mjs - the shared FFT against the direct transform
import test from 'node:test';
import assert from 'node:assert/strict';
import { fft, realFFT, fftTables } from '../being/fft.mjs';

function rand(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 * 2 - 1; }; }

/** the direct O(n^2) transform, angles reduced exactly so the reference itself stays precise */
function dft(xr, xi) {
  const n = xr.length, re = new Float64Array(n), im = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let sr = 0, si = 0;
    for (let t = 0; t < n; t++) {
      const a = (-2 * Math.PI * ((k * t) % n)) / n, c = Math.cos(a), s = Math.sin(a);
      sr += xr[t] * c - xi[t] * s; si += xr[t] * s + xi[t] * c;
    }
    re[k] = sr; im[k] = si;
  }
  return { re, im };
}

function maxErr(aRe, aIm, bRe, bIm, bins) {
  let err = 0, peak = 0;
  for (let k = 0; k < bins; k++) {
    err = Math.max(err, Math.abs(aRe[k] - bRe[k]), Math.abs(aIm[k] - bIm[k]));
    peak = Math.max(peak, Math.hypot(bRe[k], bIm[k]));
  }
  return err / peak;
}

test('a complex spectrum matches the direct transform', () => {
  for (const n of [2, 8, 64, 512, 1024]) {
    const r = rand(n), xr = Float64Array.from({ length: n }, r), xi = Float64Array.from({ length: n }, r);
    const ref = dft(xr, xi), re = xr.slice(), im = xi.slice();
    fft(re, im);
    assert.ok(maxErr(re, im, ref.re, ref.im, n) <= 1e-9, `n=${n}`);
  }
});

test('a real spectrum matches the direct transform', () => {
  for (const n of [4, 16, 512, 1024, 4096]) {
    const r = rand(7 * n), x = Float64Array.from({ length: n }, (_, i) => r() + 0.8 * Math.sin(0.37 * i));
    const ref = dft(x, new Float64Array(n)), re = new Float64Array(n / 2 + 1), im = new Float64Array(n / 2 + 1);
    realFFT(n)(x, re, im);
    assert.ok(maxErr(re, im, ref.re, ref.im, n / 2 + 1) <= 1e-9, `n=${n}`);
    assert.equal(im[0], 0); assert.equal(im[n / 2], 0);
  }
});

test('a real transform reads float32 input and leaves it alone', () => {
  const n = 512, x = Float32Array.from({ length: n }, rand(3)), copy = x.slice();
  const re = new Float64Array(n / 2 + 1), im = new Float64Array(n / 2 + 1);
  realFFT(n)(x, re, im);
  const ref = dft(Float64Array.from(x), new Float64Array(n));
  assert.ok(maxErr(re, im, ref.re, ref.im, n / 2 + 1) <= 1e-9);
  assert.deepEqual(x, copy);
});

test('a sine lands in its own bin', () => {
  const n = 1024, x = Float64Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * 37 * i) / n));
  const re = new Float64Array(n / 2 + 1), im = new Float64Array(n / 2 + 1);
  realFFT(n)(x, re, im);
  assert.ok(Math.abs(re[37] - n / 2) < 1e-9);
  for (let k = 0; k <= n / 2; k++) if (k !== 37) assert.ok(Math.hypot(re[k], im[k]) < 1e-9);
});

test('tables are built once per size and only for powers of two', () => {
  assert.equal(fftTables(256), fftTables(256));
  assert.throws(() => fftTables(300));
});
