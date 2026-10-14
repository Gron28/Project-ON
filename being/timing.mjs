// being/timing.mjs - how the being learns to be on time. Pure module (no DOM), so node --test can run it.
//
// The body cannot react to a drum hit before it has heard it, and by the time a hit is heard, analysed and drawn it is
// already tens of milliseconds late. Living listeners solve this by predicting: people tap slightly BEFORE the beat
// (negative mean asynchrony, Repp 2005), using a learned model of when the next event will come plus an error correction
// from each miss (ADAM, van der Steen & Keller 2013; phase correction, Repp & Su 2013). Predicted input is also
// attenuated, so it is not felt twice (sensory attenuation / predictive coding; Blakemore 1998, Friston 2005).
//
// The being does the same on its own pulse grid (16 slots = 4 felt beats, the grid of mind.mjs):
//   grid      per drum type, p(hit in slot) and the usual strength of that hit, learned from the analyzer's drum events
//   bias      a phase correction (in slots) that centres the events on the grid: the systematic timing error it learns away
//   error     its recent timing error (ms) and how much of what it heard it had predicted: what improves with listening
//   predict   the hits it expects between two grid positions, which the body can draw ahead of time (at the moment the
//             listener will hear them, see the page's latency model)
//   explain   how much a heard hit was expected (so the body does not react to it twice)
// A song's grid and tempo are kept with the song; on a return the stored grid is re-aligned to the bar by evidence
// (which of the four beat rotations best predicts the first hits), because the being's own bar count starts anywhere.

export const TYPES = ['kick', 'snare', 'hat'];
const NS = 16;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const clamp01 = (x) => clamp(x, 0, 1);
const mod = (x, m) => ((x % m) + m) % m;

export function createTiming({ prior = null } = {}) {
  const G = {}, Sz = {}, hitNow = {};
  for (const t of TYPES) { G[t] = new Float64Array(NS).fill(0.12); Sz[t] = new Float64Array(NS).fill(0.6); hitNow[t] = new Uint8Array(NS); }
  if (prior) mixIn(prior, 0.5);
  let bias = 0;              // slots added to the being's grid so heard events land on slot centres
  let errMs = 80;            // mean absolute timing error of expected hits (ms)
  let predicted = 0;         // share of heard hits that it had expected
  let evidence = 0;          // hits heard on this grid (saturates)
  let lastFinal = null;      // last finalized slot (cumulative index)
  let pending = null, rotScore = [0, 0, 0, 0], pendingHits = 0;

  function mixIn(o, w) {
    for (const t of TYPES) {
      const g = o && o.G && o.G[t];
      if (!Array.isArray(g) || g.length !== NS) continue;
      for (let k = 0; k < NS; k++) if (Number.isFinite(g[k])) G[t][k] = (1 - w) * G[t][k] + w * clamp01(g[k]);
      const s = o.Sz && o.Sz[t];
      if (Array.isArray(s) && s.length === NS) for (let k = 0; k < NS; k++) if (Number.isFinite(s[k])) Sz[t][k] = (1 - w) * Sz[t][k] + w * clamp01(s[k]);
    }
  }

  const api = {
    get bias() { return bias; }, get errorMs() { return errMs; }, get predicted() { return predicted; }, get evidence() { return evidence; },
    grid: G,
    /** how ready it is to act on its predictions (0..1): enough evidence on this grid */
    get readiness() { return clamp01(evidence / 24); },

    /**
     * a drum hit was heard
     * @param type kick | snare | hat; strength 0..1
     * @param slotF the event's position on the being's grid (cumulative slots, before the bias)
     * @param slotMs duration of one slot (ms), to express timing errors in time
     * @returns how expected it was (0..1): the share the body should not react to again
     */
    observe(type, strength, slotF, slotMs) {
      if (!G[type] || !Number.isFinite(slotF)) return 0;
      const c = slotF + bias, k = Math.round(c), off = c - k, slot = mod(k, NS);
      const p = G[type][slot], expected = clamp01((p - 0.45) / 0.35);
      // a stored grid waiting to be aligned: score the four beat rotations by how well each would have predicted this hit
      if (pending) {
        for (let r = 0; r < 4; r++) { const g = pending.G[type]; if (g) rotScore[r] += (g[mod(slot - 4 * r, NS)] || 0) - 0.3; }
        if (++pendingHits >= 10) {
          let best = 0; for (let r = 1; r < 4; r++) if (rotScore[r] > rotScore[best]) best = r;
          const rot = { G: {}, Sz: {} };
          for (const t of TYPES) {
            const g = pending.G[t], s = pending.Sz && pending.Sz[t];
            if (Array.isArray(g)) rot.G[t] = Array.from({ length: NS }, (_, i) => g[mod(i - 4 * best, NS)]);
            if (Array.isArray(s)) rot.Sz[t] = Array.from({ length: NS }, (_, i) => s[mod(i - 4 * best, NS)]);
          }
          mixIn(rot, 0.7); evidence = Math.max(evidence, 16); pending = null;
        }
      }
      // timing: only hits it was sure of teach it about its own timing (a stray hit says nothing about the grid)
      if (expected > 0.5 && Math.abs(off) < 0.45) {
        bias -= 0.06 * off;
        errMs += 0.06 * (Math.abs(off) * slotMs - errMs);
      }
      bias = clamp(bias, -2, 2);
      predicted += 0.05 * ((expected > 0.5 ? 1 : 0) - predicted);
      if (!hitNow[type][slot]) { hitNow[type][slot] = 1; G[type][slot] += 0.1 * (1 - G[type][slot]); }
      Sz[type][slot] += 0.15 * (clamp01(strength) - Sz[type][slot]);
      evidence = Math.min(64, evidence + 1);
      return expected;
    },

    /**
     * the heard grid has moved on to `slotF` (cumulative, before bias): slots that ended without a hit learn "no hit here"
     */
    advance(slotF) {
      if (!Number.isFinite(slotF)) return;
      const done = Math.floor(slotF + bias - 0.5);   // a slot is over once the grid is half a slot past its centre
      if (lastFinal === null || done < lastFinal || done - lastFinal > NS) { lastFinal = done; for (const t of TYPES) hitNow[t].fill(0); return; }
      while (lastFinal < done) {
        lastFinal++;
        const slot = mod(lastFinal, NS);
        for (const t of TYPES) { if (!hitNow[t][slot]) G[t][slot] += 0.1 * (0 - G[t][slot]); hitNow[t][slot] = 0; }
      }
    },

    /** hits expected with grid positions in (from, to] (cumulative slots of the SHOWN grid, bias included) */
    predict(from, to, out = []) {
      out.length = 0;
      if (!(to > from) || to - from > 3) return out;
      for (let k = Math.floor(from) + 1; k <= to; k++) {
        const slot = mod(k, NS);
        for (const t of TYPES) {
          const p = G[t][slot];
          if (p > 0.55) out.push({ type: t, slot, strength: Sz[t][slot] * clamp01((p - 0.45) / 0.35) });
        }
      }
      return out;
    },

    /** what a song keeps of its groove */
    serialize() {
      const o = { v: 1, G: {}, Sz: {} };
      for (const t of TYPES) { o.G[t] = Array.from(G[t], (x) => +x.toFixed(3)); o.Sz[t] = Array.from(Sz[t], (x) => +x.toFixed(3)); }
      return o;
    },
    /** a known song's groove: aligned to the bar by the first hits, then mostly trusted */
    recall(o) {
      if (!o || o.v !== 1 || !o.G) return false;
      pending = o; rotScore = [0, 0, 0, 0]; pendingHits = 0;
      return true;
    },
    /** a new song: forget the grid (keep the timing it learned), optionally starting from a prior */
    reset(prior2 = null) {
      for (const t of TYPES) { G[t].fill(0.12); Sz[t].fill(0.6); hitNow[t].fill(0); }
      if (prior2) mixIn(prior2, 0.5);
      evidence = 0; predicted = 0; pending = null; lastFinal = null;
    },
    /** what the being keeps across songs: its timing correction and accuracy */
    serializeSelf() { return { v: 1, bias, errMs }; },
    restoreSelf(o) { if (o && o.v === 1) { if (Number.isFinite(o.bias)) bias = clamp(o.bias, -2, 2); if (Number.isFinite(o.errMs)) errMs = clamp(o.errMs, 0, 200); } },
  };
  return api;
}

/** a running average of grids across songs: the being's sense of how music usually grooves */
export function blendGrids(general, song, w = 0.1) {
  const out = { v: 1, G: {}, Sz: {} };
  for (const t of TYPES) {
    const a = general && general.G && general.G[t], b = song && song.G && song.G[t];
    out.G[t] = Array.from({ length: NS }, (_, k) => (Array.isArray(a) ? (1 - w) * a[k] : 0.12 * (1 - w)) + (Array.isArray(b) ? w * b[k] : 0.12 * w));
    const sa = general && general.Sz && general.Sz[t], sb = song && song.Sz && song.Sz[t];
    out.Sz[t] = Array.from({ length: NS }, (_, k) => (Array.isArray(sa) ? (1 - w) * sa[k] : 0.6 * (1 - w)) + (Array.isArray(sb) ? w * sb[k] : 0.6 * w));
  }
  return out;
}
