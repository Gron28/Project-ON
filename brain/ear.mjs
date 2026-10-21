// ear.mjs - from sound to Johnston's organ spike rates.
//
// The fly hears with its antenna: the arista swings in the air's particle velocity and ~480 Johnston's
// organ neurons (JONs) per side sense the vibration. Subgroups (Kamikouchi 2009, Yorozu 2009, Matsuo 2014,
// Baker 2022) are coarsely frequency tuned:
//   JO-A  vibration, higher frequencies (best ~400 Hz, responds 100 Hz .. ~1 kHz)
//   JO-B  vibration, low frequencies (< ~100-350 Hz)                     } the two "sound" groups
//   JO-D  vibration, 100-200 Hz
//   JO-C, JO-E  slow deflection: gravity and wind (static pressure / slow envelope)
//   JO-F  grooming-related deflection
// Music is far richer than courtship song, so the audio worklet (audio/ear-worklet.js) splits the
// signal into bands that correspond to those tuning ranges and follows each band's envelope at
// 2 kHz. This module turns those envelopes into a Poisson rate per JON: each neuron of a group is
// given one of the group's bands and its own threshold and gain, so a chord spreads across the
// population instead of hitting every neuron the same way. Rates adapt to the recent loudness
// (JONs adapt within seconds) so a quiet verse is still heard.
//
// Band layout produced by the worklet (ENV_BANDS), values are rectified, low-passed amplitudes:
//   0 sub      20-100 Hz    (wind: JO-C / JO-E, driven by the slow envelope and its changes)
//   1 b-lo    100-160 Hz    JO-B / JO-D
//   2 b-mid   160-250 Hz    JO-B / JO-D
//   3 b-hi    250-350 Hz    JO-B
//   4 a-lo    350-500 Hz    JO-A
//   5 a-mid   500-750 Hz    JO-A
//   6 a-hi    750-1200 Hz   JO-A
//   7 air    1200-8000 Hz   JO-A (transients, consonants, cymbals: the antenna is broadband at onset)
//   8 onset   broadband transient flux (JO-F, and a burst on every JON: the arista jolts)

export const ENV_BANDS = 9;        // per antenna
export const ENV_COLS = 2 * ENV_BANDS; // one row: left antenna bands, then right antenna bands
export const ENV_RATE = 2000; // envelope samples per second coming from the worklet

const GROUP_BANDS = {
  'JO-A': [4, 5, 6, 7],
  'JO-B': [1, 2, 3],
  'JO-D': [1, 2],
  'JO-C': [0],
  'JO-E': [0],
  'JO-F': [8],
};
export const EAR_GROUPS = Object.keys(GROUP_BANDS);

/**
 * @param {Record<string, Uint32Array>} groups  neuron index lists from brain.json
 * @param {Int8Array|null} side  per-neuron side (-1 left, +1 right): a JON listens with its own antenna
 * @param {{maxHz?:number, spont?:number, seed?:number}} opts
 */
export function createEar(groups, side = null, { maxHz = 220, spont = 2, seed = 99 } = {}) {
  let s = seed | 0;
  const rnd = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const ids = [], band = [], thr = [], gain = [], groupOf = [], ant = [];
  EAR_GROUPS.forEach((g, gi) => {
    const list = groups[g] || [];
    const bands = GROUP_BANDS[g];
    for (let k = 0; k < list.length; k++) {
      ids.push(list[k]);
      band.push(bands[k % bands.length]);
      ant.push(side && side[list[k]] > 0 ? 1 : side && side[list[k]] < 0 ? 0 : k & 1); // unknown side: alternate
      thr.push(0.15 + 0.7 * rnd());           // fraction of the adapted level at which the neuron starts firing
      gain.push(0.6 + 0.8 * rnd());
      groupOf.push(gi);
    }
  });
  const n = ids.length;
  const rates = new Float32Array(n);
  const idArr = Uint32Array.from(ids);
  const bandArr = Uint8Array.from(band), thrArr = Float32Array.from(thr), gainArr = Float32Array.from(gain), antArr = Uint8Array.from(ant);
  const level = new Float32Array(ENV_COLS).fill(0.02); // adapted level per band and antenna (slow AGC, ~3 s)
  const fast = new Float32Array(ENV_COLS);             // 4 ms smoothed envelope (JON membrane)
  const bandRate = new Float32Array(ENV_COLS);         // per-band drive 0..1 after adaptation, for display
  const onsetHold = [0, 0];
  const agcK = 1 - Math.exp(-1 / (ENV_RATE * 3));        // 3 s
  const fastK = 1 - Math.exp(-1 / (ENV_RATE * 0.004));   // 4 ms
  const sat = (x) => x / (1 + x);

  return {
    ids: idArr, rates, n, band: bandArr, antenna: antArr, groupOf: Uint8Array.from(groupOf), bandRate, level,
    /** feed one envelope row (ENV_COLS floats: left antenna bands, right antenna bands). Read `rates` afterwards. */
    push(env, off = 0) {
      for (let b = 0; b < ENV_COLS; b++) {
        const x = env[off + b];
        fast[b] += fastK * (x - fast[b]);
        // adapt towards the running level, but never adapt a band fully away: the floor keeps quiet music audible
        level[b] += agcK * (Math.max(x, 1e-4) - level[b]);
      }
      for (let a = 0; a < 2; a++) {
        // onset: a transient jolts the whole antenna for ~5 ms
        const o = a * ENV_BANDS + 8;
        if (fast[o] > 1.5 * level[o] && fast[o] > 0.01) onsetHold[a] = ENV_RATE * 0.005;
        else if (onsetHold[a] > 0) onsetHold[a]--;
      }
      for (let b = 0; b < ENV_COLS; b++) {
        // mostly relative to the adapted level (a quiet verse is still heard), a little absolute (silence is silence)
        const rel = fast[b] / (0.7 * level[b] + 0.3 * 0.01);
        bandRate[b] = sat(rel * 0.8);
      }
      for (let k = 0; k < n; k++) {
        const a = antArr[k];
        const d = bandRate[a * ENV_BANDS + bandArr[k]];
        const x = (d - thrArr[k] * 0.4) * gainArr[k] * 2 + (onsetHold[a] > 0 ? 0.6 : 0);
        rates[k] = spont + (x > 0 ? maxHz * sat(x) : 0);
      }
    },
  };
}
