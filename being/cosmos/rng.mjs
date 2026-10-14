// being/cosmos/rng.mjs - a randomness monitor: how far a stream of random bits strays from chance. Pure module (no DOM).
//
// One 200-bit trial per second, from the ANU quantum random number generator (vacuum fluctuations) when reachable and
// from the operating system's generator otherwise, each trial tagged with its source. The statistic is the network
// variance used in field studies of hardware random number generators, over one- and two-hour windows, showing the
// window further from chance:
//   per trial    z = (ones - 100) / sqrt(50)
//   per window   chi-square = sum z^2 with n degrees of freedom; index = P(chi-square_n >= observed), the upper tail
//                (Wilson-Hilferty normal approximation, accurate to ~1e-3 for n >= 300). A high index (> 0.95) is
//                significantly small variance (blue), a low one (< 0.05) significantly large variance (red).
// Under chance the index is uniform on 0..1 (tests/cosmos.test.mjs), so one in twenty readings lands in each tail.
export const TRIAL_BITS = 200;
export const WINDOWS = [3600, 7200];   // seconds (one trial per second)
export const MIN_TRIALS = 300;

// the colour scale: stops (tail -> colour index) and 14 colours, grey for no reading, red through green to blue
const STOPS = [[0, 1], [0.01, 2], [0.05, 3], [0.08, 4], [0.15, 5], [0.23, 6], [0.30, 7], [0.40, 8], [0.90, 8], [0.9125, 9], [0.93, 10], [0.96, 11], [0.98, 12], [1, 13]];
const DOT = ['#CDCDCD', '#FFA8C0', '#FF1E1E', '#FFB82E', '#FFD517', '#FFFA40', '#F9FA00', '#AEFA00', '#64FA64', '#64FAAB', '#ACF2FF', '#0EEEFF', '#24CBFD', '#5655CA'];
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

/** the colour for an index in 0..1 (grey when there is none), interpolated between the stops */
export function scaleColor(index) {
  if (!Number.isFinite(index)) return rgb(DOT[0]);
  const x = Math.min(1, Math.max(0, index));
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [a, ia] = STOPS[i], [b, ib] = STOPS[i + 1];
    if (x <= b) { const u = b > a ? (x - a) / (b - a) : 0, c0 = rgb(DOT[ia]), c1 = rgb(DOT[ib]); return c0.map((v, k) => v + (c1[k] - v) * u); }
  }
  return rgb(DOT[13]);
}
/** the band an index falls in: 0 none yet, 1 significantly large variance (< 0.05), 2 strongly increased (< 0.10),
 * 3 slightly increased (< 0.40), 4 ordinary, 5 small (> 0.90), 6 significantly small (> 0.95); words in being/lexicon.mjs 'rng.N' */
export function band(index) {
  if (!Number.isFinite(index)) return 0;
  return index > 0.95 ? 6 : index > 0.90 ? 5 : index >= 0.40 ? 4 : index >= 0.10 ? 3 : index >= 0.05 ? 2 : 1;
}

// standard normal upper tail (Abramowitz & Stegun 26.2.17, |error| < 7.5e-8)
function normalUpper(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? p : 1 - p;
}
/** P(chi-square with n degrees of freedom >= x) */
export function chiUpper(x, n) {
  const k = 2 / (9 * n), z = (Math.cbrt(x / n) - (1 - k)) / Math.sqrt(k);
  return normalUpper(z);
}

/** ones in each 200-bit trial of a byte buffer (25 bytes per trial) */
export function trialsFromBytes(bytes) {
  const out = [];
  for (let o = 0; o + 25 <= bytes.length; o += 25) { let s = 0; for (let i = 0; i < 25; i++) { let b = bytes[o + i]; while (b) { s += b & 1; b >>= 1; } } out.push(s); }
  return out;
}

/** a monitor: keeps the last two hours of trials (ones per trial, 0..200; +256 marks a quantum trial) */
export function createMonitor(saved = null) {
  const ok = (x) => Number.isInteger(x) && (x & 255) <= TRIAL_BITS && x >= 0 && x < 512;
  let trials = Array.isArray(saved?.trials) ? saved.trials.filter(ok).slice(-WINDOWS[1]) : [];
  return {
    add(list, source) {
      const q = source === 'quantum' ? 256 : 0;
      for (const s of list) trials.push(s | q);
      if (trials.length > WINDOWS[1]) trials = trials.slice(trials.length - WINDOWS[1]);
    },
    /** { index, window (s), n, chi, z of the last minute, band, rgb, quantumShare } */
    read() {
      const res = WINDOWS.map((w) => {
        const t = trials.slice(-w), n = t.length;
        if (n < MIN_TRIALS) return null;
        let chi = 0; for (const v of t) { const z = ((v & 255) - 100) / Math.sqrt(50); chi += z * z; }
        return { window: w, n, chi: +chi.toFixed(2), index: chiUpper(chi, n) };
      }).filter(Boolean);
      // the window further into either tail
      const best = res.sort((a, b) => Math.abs(b.index - 0.5) - Math.abs(a.index - 0.5))[0] || null;
      const last = trials.slice(-60), zMin = last.length ? last.reduce((a, v) => a + ((v & 255) - 100), 0) / Math.sqrt(50 * last.length) : 0;
      const index = best ? +best.index.toFixed(4) : null, quantum = trials.reduce((a, v) => a + (v >> 8), 0);
      return { index, window: best?.window ?? null, n: trials.length, chi: best?.chi ?? null, zMinute: +zMin.toFixed(3), band: band(index), rgb: scaleColor(index), quantumShare: trials.length ? +(quantum / trials.length).toFixed(3) : 0 };
    },
    save: () => ({ trials }),
  };
}
