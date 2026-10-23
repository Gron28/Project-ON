// lab/prototypes/cellab/mind.mjs - a small stand-in for ON's mind, so the automata are driven by felt states, not by raw
// sound shapes (CLAUDE.md: the body reads the mind's states; only reflexes are direct).
//
// From mono 48 kHz audio, in 10 ms frames: onsets (positive log-energy flux in three bands against an adaptive
// threshold), arousal (loudness and onset rate, quick to rise, slow to fall), roughness (high-band share and timing
// irregularity), and a felt pulse (a phase oscillator whose period is the most common inter-onset interval folded to
// 80-180 bpm, nudged toward onsets that land near its beat; lock = the share of onsets it predicted). Events: 'beat' when
// the pulse comes round while locked, 'startle' for a much louder onset than usual (the one reflex). The mood is a
// quadrant of arousal and roughness with hysteresis: calm, flowing, rough, wild.

const SR = 48000, HOP = 480;

export function createMind() {
  const st = {
    arousal: 0, rough: 0, lock: 0, bpm: 120, phase: 0, mood: 'calm', level: -90, onsetRate: 0, pulse: 0,
  };
  let buf = new Float32Array(HOP), bn = 0, lp = 0, prevX = 0;
  let prevL = [-10, -10, -10], odfMean = 0.01, odfVar = 0.0001, lastOnset = -1, t = 0, bigMean = 0.05;
  const onsets = [];           // times (s)
  let period = 0.5, candMood = 'calm', candSince = 0, moodSince = 0;
  const events = [];

  function frame() {
    let e = 0, el = 0, eh = 0;
    for (let i = 0; i < HOP; i++) {
      const x = buf[i];
      lp += 0.0194 * (x - lp);
      const d = x - prevX; prevX = x;
      e += x * x; el += lp * lp; eh += d * d;
    }
    e /= HOP; el /= HOP; eh /= HOP;
    const L = [10 * Math.log10(el + 1e-10), 10 * Math.log10(e + 1e-10), 10 * Math.log10(eh + 1e-10)];
    let odf = 0;
    for (let b = 0; b < 3; b++) { odf += Math.max(0, L[b] - prevL[b]) * (b === 0 ? 1.2 : b === 1 ? 0.6 : 0.8); prevL[b] = L[b]; }
    const dtf = HOP / SR; t += dtf;
    st.level = L[1];
    const loud = L[1] > -62;
    // adaptive threshold
    const thr = odfMean + 2.2 * Math.sqrt(odfVar) + 1.5;
    if (loud && odf > thr && t - lastOnset > 0.09) {
      lastOnset = t; onsets.push(t);
      const strength = odf / (thr + 1e-6);
      if (odf > 4.5 * bigMean && odf > 18) events.push({ type: 'startle', strength: Math.min(2, odf / (4.5 * bigMean)) });
      bigMean += 0.08 * (odf - bigMean);
      onBeatEvidence(t, strength);
    }
    odfMean += 0.02 * (odf - odfMean); odfVar += 0.02 * ((odf - odfMean) ** 2 - odfVar);
    while (onsets.length && onsets[0] < t - 8) onsets.shift();
    // arousal: loudness above a quiet floor plus how busy the onsets are
    const rate = onsets.filter((x) => x > t - 3).length / 3;
    st.onsetRate = rate;
    const target = loud ? Math.min(1, Math.max(0, (L[1] + 50) / 38) * 0.55 + Math.min(1, rate / 6) * 0.45) : 0;
    const k = target > st.arousal ? dtf / 1.2 : dtf / 4;
    st.arousal += (target - st.arousal) * Math.min(1, k);
    // roughness: bright noisy share and timing irregularity
    const hf = Math.min(1, Math.max(0, (L[2] - L[1] + 12) / 14));
    const ioi = []; for (let i = 1; i < onsets.length; i++) ioi.push(onsets[i] - onsets[i - 1]);
    let cv = 0;
    if (ioi.length > 3) { const m = ioi.reduce((a, b) => a + b, 0) / ioi.length; cv = Math.sqrt(ioi.reduce((a, b) => a + (b - m) ** 2, 0) / ioi.length) / m; }
    const rTarget = loud ? Math.min(1, 0.55 * hf + 0.45 * Math.min(1, cv / 0.9) + (rate > 9 ? 0.2 : 0)) : st.rough * 0.5;
    st.rough += (rTarget - st.rough) * Math.min(1, dtf / 2);
    // the pulse
    if (onsets.length > 4) period += (tempoFrom(ioi) - period) * Math.min(1, dtf / 1.5);
    st.phase += dtf / period;
    if (st.phase >= 1) {
      st.phase -= 1;
      if (st.lock > 0.3 && loud) events.push({ type: 'beat', strength: st.lock });
    }
    if (t - lastOnset > 2) st.lock *= Math.exp(-dtf / 1.5);
    st.bpm = 60 / period;
    st.pulse = Math.exp(-st.phase * 6) * st.lock;
    // mood, held for 3 s before it changes
    const a = st.arousal, r = st.rough;
    const m = a < 0.25 ? 'calm' : r > 0.55 ? (a > 0.7 ? 'wild' : 'rough') : a > 0.72 ? 'wild' : 'flowing';
    if (m !== candMood) { candMood = m; candSince = t; }
    if (m !== st.mood && t - candSince > 3 && t - moodSince > 6) { st.mood = m; moodSince = t; events.push({ type: 'mood', mood: m }); }
  }
  function onBeatEvidence(time, strength) {
    // where in the pulse did it land?
    let err = st.phase; if (err > 0.5) err -= 1;
    const hit = Math.abs(err) < 0.16;
    st.lock += ((hit ? 1 : 0) - st.lock) * 0.12;
    if (hit) st.phase -= err * 0.35;
    else if (st.lock < 0.25) st.phase = 0;    // not locked: an onset restarts the pulse
    if (st.lock < 0.3 && strength > 1.4) events.push({ type: 'hit', strength: Math.min(1, strength / 3) });
  }
  function tempoFrom(ioi) {
    const hist = new Float32Array(60);   // 0.33..0.75 s in 7 ms bins
    for (let i = 0; i < ioi.length; i++) for (let j = i; j < Math.min(ioi.length, i + 4); j++) {
      let d = 0; for (let k = i; k <= j; k++) d += ioi[k];
      while (d < 0.333) d *= 2; while (d > 0.75) d /= 2;
      const b = Math.round((d - 0.333) / 0.007);
      for (let w = -2; w <= 2; w++) if (b + w >= 0 && b + w < 60) hist[b + w] += 1 / (1 + Math.abs(w));
    }
    let best = 0; for (let b = 1; b < 60; b++) if (hist[b] > hist[best]) best = b;
    return hist[best] > 0 ? 0.333 + best * 0.007 : period;
  }

  return {
    st,
    feed(x) {
      for (let i = 0; i < x.length; i++) { buf[bn++] = x[i]; if (bn === HOP) { frame(); bn = 0; } }
    },
    take() { const e = events.splice(0); return e; },
  };
}
