// being/input-gain.mjs - the input trim (pure). A captured stream arrives at whatever level the app and its mixer leave it
// (Spotify through per-app loopback came in near -40 dBFS here), while the blobs' features sit on absolute scales. This
// is the engineer's hand on the input gain, not a compressor: it follows the loudest the stream has been lately (instant
// up, ~60 s down) and lifts the whole stream so that peak sits at a normal level. It moves at most 6 dB a second, never
// below 1, never above `max`, and holds still in silence, so the dynamics inside a song are kept as they are.
export function createInputGain({ target = 0.25, max = 32, release = 60, slew = 6, silent = 1e-4 } = {}) {
  let peak = 0, gain = 1;
  return {
    get gain() { return gain; },
    get peak() { return peak; },
    // x: mono float samples of one chunk (any length); returns the gain applied to this chunk
    step(x, sr = 48000) {
      const n = x.length; if (!n) return gain;
      let sq = 0; for (let i = 0; i < n; i++) sq += x[i] * x[i];
      const rms = Math.sqrt(sq / n), dt = n / sr;
      if (rms > silent) {   // silence teaches nothing: the trim waits for the music to come back
        peak = rms > peak ? rms : peak * Math.exp(-dt / release);
        const want = Math.min(max, Math.max(1, target / Math.max(peak, 1e-6)));
        const db = 20 * Math.log10(want / gain), step = slew * dt;
        gain *= Math.pow(10, Math.max(-step, Math.min(step, db)) / 20);
      }
      return gain;
    },
    apply(x) { if (gain !== 1) for (let i = 0; i < x.length; i++) x[i] *= gain; return gain; },
  };
}
