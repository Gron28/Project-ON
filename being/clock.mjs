// being/clock.mjs - which beat to believe, and how much. Pure module (no DOM).
//
// Two trackers hear the same sound: the analyzer's own (being/analysis.mjs, fast, but measured to settle confidently on
// 2/3 or 3/2 of the tempo of drum loops with an off-beat bass, and to drift on real songs while still reporting
// confidence ~1), and the rhythm organ (Beat This!, being/ml/beat*.mjs, a trained network on the last 10 s, every
// 1.5 s). The clock passes the mind one beat sense (the `beat` sense of mind.mjs: bpm, phase, confidence) and gives the
// body a trust in it:
//   - when the organ is fresh and confident its beat leads; the analyzer only adds confidence where it agrees;
//   - a tracker that disagrees with the other loses confidence (a confident wrong tempo is worse than none);
//   - a pulse is only trusted while drums (kicks or snares) keep coming: a choir with no beat gets flow, not a bounce.

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const c01 = (x) => clamp(x, 0, 1);
const fin = (x, d = 0) => (Number.isFinite(x) ? x : d);

/** How close two tempi are to the same beat (1), to an octave of it (`octave`, a level up or down), or to anything else (0). */
export function tempoAgree(a, b, { octave = 0.6 } = {}) {
  if (!(a > 0) || !(b > 0)) return 0;
  const l = Math.log2(a / b), same = Math.exp(-(l * l) / (2 * 0.035 * 0.035));
  const oct = Math.exp(-((Math.abs(l) - 1) ** 2) / (2 * 0.035 * 0.035));
  return Math.max(same, octave * oct);
}

export function createClock() {
  const beat = { bpm: 0, phase: 0, confidence: 0, source: 'none' };
  let trust = 0, perc = 0, agree = 0;
  /**
   * inp: { an: { bpm, phase, confidence } (the analyzer's beat at the analysed time),
   *   organ: { fresh, confidence, period, lastBeat, t } (t: the analysed time on the organ's clock), or null,
   *   lock (mind.lock), sinceDrum (s since the last heard kick or snare) }
   */
  function step(dt, inp = {}) {
    dt = clamp(fin(dt), 0, 0.1);
    const a = inp.an || {}, o = inp.organ;
    const aBpm = fin(a.bpm), aConf = c01(fin(a.confidence)), aPh = fin(a.phase);
    const oOk = !!(o && o.fresh && o.period > 0.2 && o.period < 1.6 && Number.isFinite(o.lastBeat) && o.lastBeat >= 0 && fin(o.confidence) > 0.3);
    if (oOk) {
      const oBpm = 60 / o.period, oConf = c01(o.confidence);
      let ph = (fin(o.t) - o.lastBeat) / o.period; ph -= Math.floor(ph);
      agree = tempoAgree(aBpm, oBpm, { octave: 0 });
      beat.bpm = oBpm; beat.phase = ph; beat.source = 'organ';
      // the analyzer agreeing lifts it; the analyzer confidently disagreeing (a different tempo) lowers it a little
      beat.confidence = c01(oConf * (0.75 + 0.35 * agree) - 0.15 * aConf * (1 - agree));
    } else {
      agree = o && o.fresh && o.period > 0 ? tempoAgree(aBpm, 60 / o.period) : 0.5;
      beat.bpm = aBpm; beat.phase = aPh - Math.floor(aPh); beat.source = aConf > 0 ? 'analyzer' : 'none';
      beat.confidence = c01(aConf * (0.35 + 0.55 * agree));   // alone it is believed only partly
    }
    // percussion: a beat is felt while kicks or snares keep coming (fading 1.5 .. 4.5 s after the last)
    const pT = c01(1 - (fin(inp.sinceDrum, 99) - 1.5) / 3);
    perc += (pT - perc) * (1 - Math.exp(-dt / (pT > perc ? 0.2 : 0.8)));
    const tT = c01((beat.confidence - 0.2) / 0.5) * (0.15 + 0.85 * perc) * c01((fin(inp.lock) - 0.15) / 0.45);
    trust += (tT - trust) * (1 - Math.exp(-dt / (tT > trust ? 0.4 : 1.2)));
    return beat;
  }
  return { step, beat, get trust() { return trust; }, get perc() { return perc; }, get agree() { return agree; } };
}
