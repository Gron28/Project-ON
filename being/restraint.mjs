// being/restraint.mjs - how much room the being gives itself for more than one style at a time ("maximalism" M).
// Pure module (no DOM), so node --test can run it. The page (REST, restApply) holds the layers down to M.
//
// M is low most of the time and opens only at peaks: a drop, chills, or a climax. A climax is arousal and groove at
// their top, but only when arousal is clearly ABOVE what the song has been (a rise out of its own recent level), and
// it cannot be held: sustained excitement tires the opening (like the startle and the ear, it habituates), so a steady
// loud song does not stay maximal for its whole length (a monotone loud track used to hold M near 0.8 for minutes).
// The opening needs ~30 s of lower excitement to recover. Drops and chills are brief events and are not limited.

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const fin = (x, d = 0) => (Number.isFinite(x) ? x : d);

export function createMaxim({ base = 0.15, bead = 0.05, hold = 8, recover = 30, tauSlow = 30 } = {}) {
  let aSlow = null, fat = 0, climax = 0;
  return {
    get fatigue() { return fat; },
    get climax() { return climax; },
    /**
     * @param dt seconds
     * @param s { drop 0..1, chill 0..1, arousal, groove, sleep 0..1 (silence), beads (bool) }
     * @returns the target M (0..1); the page eases towards it (fast open, slow close)
     */
    want(dt, s = {}) {
      dt = Number.isFinite(dt) ? Math.min(0.1, Math.max(0, dt)) : 0;
      const A = clamp01(fin(s.arousal)), G = clamp01(fin(s.groove)), z = clamp01(fin(s.sleep));
      if (aSlow === null) aSlow = A;
      const rise = A - aSlow;                                   // how far above its own recent level
      aSlow += (1 - Math.exp(-dt / tauSlow)) * (A - aSlow);
      const raw = clamp01((A - 0.8) / 0.15) * clamp01(G * 1.6);
      climax = raw * clamp01(rise / 0.1) * (1 - fat);
      fat = Math.min(1, Math.max(0, fat + dt * (raw > 0.5 ? 1 / hold : -1 / recover)));
      const peak = Math.max(clamp01(fin(s.drop)), clamp01(fin(s.chill)) * 0.9, climax);
      return s.beads ? bead : (base + (1 - base) * peak) * (1 - z);
    },
  };
}
