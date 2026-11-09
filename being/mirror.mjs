// being/mirror.mjs - the body follows the sound. Pure module (no DOM).
//
// People judge whether a moving thing "is the music" by what they can see within ~100 ms: louder is bigger, a hit lands
// as a hit, harsh sound looks sharp, and by the metric hierarchy (beat, bar) landing on time (Spence 2011 on
// cross-modal correspondences; Burger et al. 2013 on which body parts follow which metric level; Repp & Su 2013 on
// anticipation). The mind's states are slow (seconds), so they cannot carry this. The mirror is the fast layer under
// them: every channel is read against the song's own running range (as MilkDrop reads each band against its own
// average), and drives damped springs, so an accent overshoots and settles instead of jittering.
//
// Emergence chooses how, never whether:
//   - style: four movement qualities after Laban's effort factors (sudden/sustained, strong/light, direct/indirect,
//     free/bound), set slowly by the song's character and the mind's feeling, shape every spring and amplitude;
//   - mapping: which part of the body each instrument lives in is the being's own (from its seed), varied per song,
//     and re-mapped by boredom only at phrase boundaries; a song keeps its mapping and style (songState / recall).
//
// The page feeds it one frame at a time (step) and the drum hits it hears or predicts (hit); it reads `out`.

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const c01 = (x) => clamp(x, 0, 1);
const fin = (x, d = 0) => (Number.isFinite(x) ? x : d);
const TAU = Math.PI * 2;

function rng(a) { return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** A running range: the low and high edges follow the signal fast outward and slowly back in (~`tau` s), so a quiet
 *  song uses the whole range and a loud passage reads loud against its own song, not against the whole world. */
export function createRange(tau = 8, minSpan = 0.05) {
  let lo = NaN, hi = NaN;
  return {
    step(x, dt) {
      if (!Number.isFinite(x)) return this.rel(x);
      if (!Number.isFinite(lo)) { lo = x; hi = x + minSpan; }
      const kIn = 1 - Math.exp(-dt / tau), kOut = 1 - Math.exp(-dt / 0.15);
      hi += (x - hi) * (x > hi ? kOut : kIn);
      lo += (x - lo) * (x < lo ? kOut : kIn);
      return this.rel(x);
    },
    rel(x) { if (!Number.isFinite(lo) || !Number.isFinite(x)) return 0; const s = Math.max(minSpan, hi - lo); return c01((x - lo) / s); },
    get lo() { return lo; }, get hi() { return hi; },
  };
}

/** A damped spring y'' = -w^2 y - 2 z w y' with impulses on its velocity; peak ~ the impulse's strength. */
export function createSpring(hz = 4, zeta = 0.5) {
  let y = 0, v = 0, w = TAU * hz, z = zeta;
  return {
    tune(h, zz) { w = TAU * clamp(fin(h, 4), 0.3, 12); z = clamp(fin(zz, 0.5), 0.05, 1.5); },
    kick(s) { s = fin(s); y += 0.58 * s; v += 1.17 * s * w; },   // part displacement, part velocity: the peak reaches ~s within 15-50 ms (a pure velocity kick peaked a quarter period late)
    step(dt) {
      let left = clamp(fin(dt), 0, 0.1);
      while (left > 1e-6) { const h = Math.min(left, 0.004); v += (-w * w * y - 2 * z * w * v) * h; y += v * h; left -= h; }
      if (!Number.isFinite(y) || !Number.isFinite(v) || Math.abs(y) > 50) { y = 0; v = 0; }
      return y;
    },
    get y() { return y; }, get v() { return v; },
    reset() { y = 0; v = 0; },
  };
}

// the body's eight regions (being/kuramoto.mjs REGION_DIRS, cube corners) and their neighbours along the cube's edges
const NEIGH = [[1, 2, 4], [0, 3, 5], [0, 3, 6], [1, 2, 7], [0, 5, 6], [1, 4, 7], [2, 4, 7], [3, 5, 6]];
export const VOICES = ['kick', 'snare', 'hat', 'lead'];

/** Laban effort from what the music is (the analyzer's character; and, when the genre / mood model runs, its moods:
 *  feel.mood = { aggressive, relaxed, happy, sad, party, electronic, acoustic, dance }, each 0..1) and how the being
 *  feels; every value 0..1. The moods only shape the style: they never decide whether it moves. */
export function effortFor(ch = {}, feel = {}) {
  const g = (k) => c01(fin(ch[k], 0.4));
  const A = c01(fin(feel.arousal, 0.4)), V = clamp(fin(feel.valence, 0), -1, 1);
  const md = feel.mood || {}, m = (k) => (Number.isFinite(md[k]) ? c01(md[k]) - 0.4 : 0);   // centred: a model that is not running adds nothing
  return {
    sudden: c01(0.15 + 0.45 * g('density') + 0.3 * A + 0.25 * g('noisiness') - 0.25 * c01(fin(feel.flow, 0)) + 0.3 * m('aggressive') + 0.15 * m('electronic') - 0.3 * m('relaxed') - 0.1 * m('acoustic')),   // Time: quick attacks, short decays
    strong: c01(0.1 + 0.6 * g('bassWeight') + 0.3 * g('loudness') - 0.15 * g('brightness') + 0.25 * m('aggressive') + 0.1 * m('party') - 0.1 * m('relaxed')),                                      // Weight: deep down-accents vs light bounce
    direct: c01(0.15 + 0.85 * g('regularity') + 0.25 * m('dance') + 0.1 * m('electronic') - 0.15 * m('acoustic')),                                                                             // Space: axial dip and swell vs orbital, spiralling
    free: c01(0.25 + 0.35 * (1 - g('regularity')) + 0.2 * V + 0.25 * c01(fin(feel.drift, 0)) + 0.25 * m('relaxed') + 0.15 * m('happy') + 0.1 * m('acoustic') - 0.25 * m('aggressive')),          // Flow: overshoot and coast vs bound, damped
  };
}

export function createMirror(seed = 1) {
  const R = { loud: createRange(10, 0.12), bright: createRange(10, 0.06), bass: createRange(8, 0.05), lead: createRange(8, 0.05), rough: createRange(8, 0.05), intensity: createRange(20, 0.15) };
  const sp = { kick: createSpring(4, 0.45), snare: createSpring(5, 0.4), hat: createSpring(9, 0.6), beat: createSpring(3, 0.55), lead: createSpring(3, 0.6), sig: createSpring(1.4, 0.3) };
  const peak = { kick: 0.5, snare: 0.5, hat: 0.5 };   // running strongest hit per drum (song-relative strength)
  const pred = { kick: { t: -9, s: 0 }, snare: { t: -9, s: 0 }, hat: { t: -9, s: 0 } };
  const style = { sudden: 0.5, strong: 0.5, direct: 0.6, free: 0.4 };
  const out = { size: 0, squash: 0, dip: 0, sway: 0, spikes: 0, glow: 0, crisp: 0, shell: 0, surge: 1, swell: 0, wind: 0, twist: 0, anticip: 0, regions: new Float32Array(8), level: 0, act: 0 };
  let time = 0, lastCount = null, beats = 0, moment = 0, swell = 0, swellAvg = 0.5, leadF = 0, songKey = 0, remaps = 0;
  const base = rng((seed >>> 0) ^ 0x9e3779b9);
  // the being's own body map: where each instrument lives (a region and its neighbours), from its seed
  const own = {}; { const used = new Set(); for (const v of VOICES) { let r; do r = Math.floor(base() * 8); while (used.has(r) && used.size < 8); used.add(r); own[v] = r; } }
  let map = { ...own }, rnd = rng(seed >>> 0), anticip = 0;
  // the song's signature move, replayed at its peaks (a drop, recognition): where in the body, which way, and what kind
  let sig = { region: own.kick, dir: 1, kind: 0 };

  function newSong(key) {   // a new song: the being's own map, varied by the song (each song finds its own body)
    songKey = (key >>> 0) || 0; rnd = rng(((seed >>> 0) ^ songKey) >>> 0); map = { ...own }; remaps = 0;
    const n = 1 + Math.floor(rnd() * 2); for (let i = 0; i < n; i++) remap();
    sig = { region: Math.floor(rnd() * 8), dir: rnd() < 0.5 ? -1 : 1, kind: Math.floor(rnd() * 3) }; sp.sig.reset();
    for (const k in peak) peak[k] = 0.5; moment = 1;
  }
  function remap() {   // one instrument moves to a neighbouring region (a slow drift through the body, not a jump)
    const v = VOICES[Math.floor(rnd() * VOICES.length)], nb = NEIGH[map[v]];
    map[v] = nb[Math.floor(rnd() * nb.length)]; remaps++;
  }
  function songState() { return { map: { ...map }, style: { ...style }, remaps, sig: { ...sig } }; }
  function recall(st) {   // a song comes back: its body map and its way of moving
    if (!st || typeof st !== 'object') return false;
    if (st.map) for (const v of VOICES) { const r = st.map[v]; if (Number.isInteger(r) && r >= 0 && r < 8) map[v] = r; }
    if (st.style) for (const k in style) if (Number.isFinite(st.style[k])) style[k] = c01(st.style[k]);
    remaps = Number.isFinite(st.remaps) ? st.remaps : 0;
    if (st.sig && Number.isInteger(st.sig.region) && st.sig.region >= 0 && st.sig.region < 8) sig = { region: st.sig.region, dir: st.sig.dir < 0 ? -1 : 1, kind: [0, 1, 2].includes(st.sig.kind) ? st.sig.kind : 0 };
    return true;
  }

  /** A drum hit: heard (after the fact) or predicted (on time, by timing.mjs). A heard hit that a prediction already
   *  showed only adds what it was stronger than predicted, so the body plays what is really played (accents, fills)
   *  without doubling what it anticipated. */
  function hit(type, s, predicted = false) {
    if (!(type in pred)) return;
    s = c01(fin(s)); if (s <= 0) return;
    if (!predicted) peak[type] = Math.max(peak[type], s);
    const rel = c01(s / Math.max(0.3, peak[type]));
    if (predicted) { pred[type].t = time; pred[type].s = rel; sp[type].kick(rel); return; }
    const p = pred[type];
    if (time - p.t < 0.15) { const extra = rel - p.s; if (extra > 0) sp[type].kick(extra); p.t = -9; }
    else sp[type].kick(rel);
  }

  /**
   * One frame. inp: { level, centroid, bass, lead, rough, intensity (all as the analyzer and ear give them),
   *   beat: { count, phase, hz, trust }, char (analyzer character), feel: { arousal, valence, bored, flow, drift },
   *   gate (awake, not asleep, not beads: 0..1), bounce (0..1: the Calm switch), metric (0..1: share the hand-written dance keeps) }
   */
  function step(dt, inp = {}) {
    dt = clamp(fin(dt), 0, 0.05); time += dt;
    const gate = c01(fin(inp.gate, 1)), bounce = c01(fin(inp.bounce, 1)), metricK = c01(fin(inp.metric, 1));
    const b = inp.beat || {}, trust = c01(fin(b.trust)), hz = clamp(fin(b.hz, 2), 0.5, 4);
    // style: settles over ~6 s (~1 s just after a moment: a section, a new song)
    const want = effortFor(inp.char, inp.feel), kS = 1 - Math.exp(-dt / (moment > 0 ? 1 : 6));
    for (const k in style) style[k] += (want[k] - style[k]) * kS;
    moment = Math.max(0, moment - dt / 2);
    const { sudden, strong, direct, free } = style;
    // springs take the style: sudden music snaps (high, quick), sustained music sways; bound music is damped, free music overshoots
    const zeta = 0.75 - 0.45 * free;
    sp.kick.tune(2.5 + 3.5 * sudden, zeta); sp.snare.tune(3.5 + 4 * sudden, zeta * 0.9); sp.hat.tune(8 + 5 * sudden, 0.7);
    sp.beat.tune(hz * (1.1 + 0.6 * sudden), zeta); sp.lead.tune(1.5 + 2 * sudden, 0.8);
    for (const k in peak) peak[k] = Math.max(0.3, peak[k] - dt * 0.03);
    // continuous channels against the song's own range
    const loud = R.loud.step(Math.log10(1e-4 + Math.max(0, fin(inp.level))), dt);
    const bright = R.bright.step(fin(inp.centroid), dt), bass = R.bass.step(fin(inp.bass), dt), lead = R.lead.step(fin(inp.lead), dt), rough = R.rough.step(fin(inp.rough), dt);
    const inten = R.intensity.step(fin(inp.intensity), dt);
    // loudness swell: quick to rise, slower to fall (sustained music falls slower still), so a chorus looks bigger
    swell += (loud - swell) * (1 - Math.exp(-dt / (loud > swell ? 0.05 : 0.18 + 0.5 * (1 - sudden))));
    swellAvg += (swell - swellAvg) * (1 - Math.exp(-dt / 6));
    leadF += (lead - leadF) * (1 - Math.exp(-dt / 0.06));
    // the metric layer: each beat a pulse, landing on the beat; just before it a wind-up (the body gathers), so the
    // landing reads as anticipated rather than reactive
    // the pulse is struck ~35 ms early, so its spring peaks on the beat rather than after it
    const count = Number.isFinite(b.count) && Number.isFinite(b.phase) ? Math.floor(b.count + b.phase + 0.035 * hz) : null;
    if (count !== null && lastCount !== null && count > lastCount && trust > 0.05) {
      beats++;
      sp.beat.kick(trust * (0.7 + 0.3 * direct));
      if (beats % 16 === 0) {   // a phrase boundary (4 bars of 4): boredom may move an instrument somewhere new
        const bored = c01(fin(inp.feel && inp.feel.bored));
        if (bored > 0.5 && rnd() < 0.35 + 0.5 * (bored - 0.5)) remap();
      }
    }
    if (count !== null) lastCount = lastCount === null || count > lastCount || count < lastCount - 4 ? count : lastCount;
    const ph = c01(fin(b.phase)), wind = -trust * Math.pow(c01((ph - 0.72) / 0.28), 2) * (0.5 + 0.5 * sudden);
    anticip += (c01(fin(inp.anticip)) - anticip) * (1 - Math.exp(-dt / 0.4));   // gathering before a drop it remembers
    const yG = sp.sig.step(dt) * gate, yK = sp.kick.step(dt), yS = sp.snare.step(dt), yH = sp.hat.step(dt), yB = sp.beat.step(dt), yL = sp.lead.step(dt);
    if (leadF > 0.6 && sp.lead.y < 0.05 && sp.lead.v <= 0) sp.lead.kick(0.4 * (leadF - 0.5));   // a sung or played phrase lifts its region
    // flow and rotation surge on the beat and coast between beats (mean 1, so the overall pace is unchanged)
    const a = 0.12 + 0.35 * (1 - sudden), env = Math.exp(-ph / a), m = a * (1 - Math.exp(-1 / a));
    const surgeLocked = 0.45 + 0.55 * env / m;
    const acc = bounce * gate;
    out.size = acc * (yK * (0.045 + 0.05 * strong) + metricK * yB * (0.03 + 0.03 * direct) + metricK * wind * 0.022)
      + gate * (1.1 * (swell - swellAvg) + 0.35 * (swell - 0.5)) * (0.07 + 0.05 * (1 - sudden));   // against its own recent level: a build grows it, a steady song does not just sit bigger
    out.squash = acc * (yS * (0.06 + 0.07 * sudden) - yK * 0.03 * strong);
    out.dip = acc * (-yK * 0.018 * strong - metricK * yB * 0.01 * direct);
    out.sway = acc * metricK * trust * 0.022 * (1 - 0.6 * direct) * Math.sin(Math.PI * (fin(b.count) + ph));
    out.spikes = acc * Math.max(0, yH) * (0.04 + 0.06 * sudden) + gate * rough * 0.03;
    out.crisp = gate * (bright - 0.5) * 0.6;
    out.glow = gate * (0.35 * (swell - 0.4) + bounce * 0.3 * Math.max(0, yK) + 0.15 * Math.max(0, yS));
    out.shell = acc * Math.max(0, yK) * 0.03 * strong;
    out.surge = (1 + (surgeLocked - 1) * trust * gate * bounce * metricK) * (1 - 0.55 * anticip * gate);
    // gathering: it draws in, slows, tightens and brightens; its signature move: a slow, overshooting swell, twist or squash
    out.size += gate * (-0.05 * anticip) + (sig.kind === 0 ? 0.09 : 0.03) * yG;
    out.squash += sig.kind === 2 ? 0.16 * yG : 0;
    out.spikes += gate * 0.03 * anticip; out.glow += gate * 0.35 * anticip;
    out.twist = (sig.kind === 1 ? 1.4 : 0.4) * sig.dir * yG;
    out.anticip = anticip;
    out.swell = swell; out.wind = wind; out.level = inten;
    const reg = out.regions; reg.fill(0);
    const put = (v, y) => { const r = map[v]; reg[r] += y; for (const n of NEIGH[r]) reg[n] += 0.35 * y; };
    reg[sig.region] += 1.6 * Math.max(0, yG); for (const n of NEIGH[sig.region]) reg[n] += 0.5 * Math.max(0, yG);
    put('kick', Math.max(0, yK)); put('snare', Math.max(0, yS)); put('hat', 0.6 * Math.max(0, yH)); put('lead', Math.max(0, yL) + 0.4 * leadF * (1 - sudden));
    for (let g = 0; g < 8; g++) reg[g] *= acc;
    out.act = c01(Math.abs(yK) + Math.abs(yS) + 0.5 * Math.abs(yH) + Math.abs(yB));
    return out;
  }

  /** its signature move (a drop, recognition, chills): strength 0..1 */
  function signature(s = 1) { if (fin(s) > 0 && Math.abs(sp.sig.y) < 0.3) sp.sig.kick(c01(s)); }
  return { step, hit, newSong, songState, recall, signature, out, style, get sig() { return { ...sig }; }, get map() { return { ...map }; }, ranges: R, peak, sectionMoment() { moment = 1; } };
}
