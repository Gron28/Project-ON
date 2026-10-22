// lab/organism/bench.mjs - the headline bench for a genome: does its motor output keep time with a beat, and is that
// timing learned structure or reflex? Module (Node or page) plus a Node CLI:
//   .runtime/node-v24.21.0-win-x64/node.exe lab/organism/bench.mjs [genome.json] [--seeds 3] [--set test|train] [--dur 24]
//       [--workers 3] [--out lab/results/organism-bench.json] [--json]
// genome.json: any file with a `genome` array (default lab/results/organism-best.json).
//
// Two conditions per development seed:
//   newborn  gestated (organism.mjs GESTATION), then plasticity frozen (every eta* rate, intrinsic plasticity included,
//            and pruning set to 0 in the developed genes); each world hears a copy of the same newborn
//   adult    lives the train worlds (worlds.mjs TRAIN, groove variant) with its own laws on, then a clone of that adult
//            hears each bench world (plasticity still on: it keeps living)
// Each bench world is heard in three variants (worlds.mjs): groove, shuffled (same onsets, shuffled intervals; beats
// travel with their onset), omission (whole beats removed at known times). Metrics, from motor spikes against the beat:
//   vs          vector strength of motor spikes to the beat, each spike phased within the window [b - P/2, b + P/2) of
//               its beat b (P: that beat's period) - the classic measure on a steady grid, defined on any beat list
//   errMs       per beat, the circular mean phase of the motor spikes in its window, in ms (negative: early, before the
//               beat); median and IQR pooled over beats after the first `warm` seconds
//   credit      vs(groove) - vs(shuffled). The beat-carrying onset is reflexively locked in both, but in the groove its
//               neighbours (hats, snares) also fall on fixed phases, so even a frozen reflex earns some credit: compare
//               against the newborn, or use beyondReflex
//   beyondReflex vs(groove) - vsReflex, where vsReflex is the vector strength a pure reflex would give the groove: per
//               onset class (kick, snare, woodblock, hat) the motor rate it evokes 0-400 ms later, estimated in the shuffled
//               run (nothing predictable there), summed over the groove's own onsets. Only timing beyond reflex survives
//   omission    interneuron rate 30-150 ms after an omitted beat, minus the same window in the shuffled world at the same
//               delay since the last onset with nothing heard in it (a gap that nothing predicted); Hz and a z score.
//               Any numeric state() readout the organism adds (feature-detected, plus predFrac) gets the same contrast
//   viability   mean viability over the run; alive; interneuron rate; runaway share; cost (wall ms per simulated second)
// Reported per world and condition, then averaged over worlds, then mean +- sd over development seeds.

import { isMainThread, parentPort, workerData, Worker } from 'node:worker_threads';
import { createOrganism, restoreOrganism } from './organism.mjs';
import { develop } from './develop.mjs';
import { live } from './environment.mjs';
import { depth } from './analysis.mjs';
import { mix, NG } from './genome.mjs';
import { TRAIN, TEST, VARIANTS, makeWorld, framesOf, DT_FRAME } from './worlds.mjs';

export const BENCH = { warm: 4, dur: 24, seeds: 3, post: [0.03, 0.15] };
// readouts the current organism's state() has; anything else numeric is a new law's readout and is probed at omissions
const KNOWN = new Set(['t', 'alive', 'energy', 'integrity', 'need', 'viability', 'valence', 'arousal', 'rateHz', 'interHz', 'predShare', 'strain', 'motor', 'chrom', 'gE', 'gI', 'brace', 'protection', 'impact', 'events']);

/** a stored genome as a Float64Array, at most NG genes, non-finite genes at mid-range. A shorter (legacy) genome stays
 *  short: genome.mjs decode() pads it so it develops exactly as it did when it was evolved */
export const fitGenome = (g) => Float64Array.from(Array.from(g).slice(0, NG), (x) => (Number.isFinite(+x) ? +x : 0.5));
export const devSeeds = (k) => Array.from({ length: k }, (_, i) => mix(i + 1, 0xbe9c) % 1000003 + 1);

/** development with plasticity frozen: every eta* rate (genes, present or future, and the intrinsic plasticity law) and
 *  pruning set to 0; gestation still runs with the genome's own homeostatic rates (organism.mjs) */
export function frozenDev(genome, seed) {
  const dev = develop(genome, seed), G = { ...dev.G };
  for (const k of Object.keys(G)) if (/^eta/i.test(k) && typeof G[k] === 'number') G[k] = 0;
  if ('pruneThr' in G) G.pruneThr = 0;
  dev.G = G; return dev;
}

const FCACHE = new Map();
/** ear frames of a world, cached per process */
export function framesFor(spec, variant, { seed = 1, dur = BENCH.dur, set = '' } = {}) {
  const key = `${spec.name}|${variant}|${seed}|${dur}`;
  if (!FCACHE.has(key)) FCACHE.set(key, framesOf(makeWorld(spec, variant, { seed, dur, set })));
  return FCACHE.get(key);
}

/** live an organism through a world's frames, recording motor spike times, interneuron spikes per frame and new readouts */
export function runRecord(org, F) {
  const motor = [], inter = new Uint16Array(F.n), sig = {}, C = org.C, brace = new Float32Array(F.n), impacts = [], reson = [];
  const osc = org.net.resonators ? Int32Array.from(org.net.resonators().cells || []) : new Int32Array(0);
  const s0 = org.state();
  for (const [k, v] of Object.entries(s0)) if (typeof v === 'number' && (!KNOWN.has(k))) sig[k] = new Float32Array(F.n);
  const keys = Object.keys(sig);
  const t0 = performance.now();
  const L = live(org, F, { each: (o, f, s) => {
    const t = (f + 1) * DT_FRAME, spk = o.net.spk;
    for (let q = 0; q < C.motor.length; q++) if (spk[C.motor[q]]) motor.push(t);
    let c = 0; for (let q = 0; q < C.inter.length; q++) c += spk[C.inter[q]]; inter[f] = c;
    for (const k of keys) { const v = s[k]; sig[k][f] = Number.isFinite(v) ? v : 0; }
    for (let q = 0; q < osc.length; q++) if (spk[osc[q]]) reson.push(t);
    if (Number.isFinite(s.brace)) brace[f] = s.brace;
    if (s.impact > 0) impacts.push({ t, a: s.impact, p: s.protection });
  } });
  const ms = performance.now() - t0;
  return { world: F.world, motor, inter, brace, impacts, reson, nOsc: osc.length, nInter: C.inter.length, sig, viability: L.viability, alive: L.died < 0, died: L.died, interHz: L.interHz, runaway: L.runaway, maxInter1s: L.maxInter1s, msPerSimS: ms / (F.n * DT_FRAME) };
}

// ---- metrics -------------------------------------------------------------------------------------------------------------------

const lowerBound = (a, x) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; } return lo; };
const quant = (a, q) => { if (!a.length) return NaN; const s = Float64Array.from(a).sort(), x = q * (s.length - 1), i = Math.floor(x); return i + 1 < s.length ? s[i] + (x - i) * (s[i + 1] - s[i]) : s[i]; };
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const sd = (a) => { const m = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)) : 0; };

/** motor spikes against a beat list: pooled vector strength, mean phase, per-beat alignment errors (ms) */
export function beatLock(spikes, beats, { from = BENCH.warm } = {}) {
  let c = 0, s = 0, n = 0; const errs = [];
  for (const b of beats) {
    if (b.t < from) continue;
    const P = b.period, i0 = lowerBound(spikes, b.t - P / 2), i1 = lowerBound(spikes, b.t + P / 2);
    let bc = 0, bs = 0;
    for (let i = i0; i < i1; i++) { const ph = 2 * Math.PI * (spikes[i] - b.t) / P; bc += Math.cos(ph); bs += Math.sin(ph); }
    if (i1 > i0) errs.push(1000 * P * Math.atan2(bs, bc) / (2 * Math.PI));
    c += bc; s += bs; n += i1 - i0;
  }
  return { vs: n ? Math.hypot(c, s) / n : NaN, phase: n ? Math.atan2(s, c) / (2 * Math.PI) : NaN, n, errs, errMs: quant(errs, 0.5), iqrMs: quant(errs, 0.75) - quant(errs, 0.25) };
}

/** onset group times of a world */
const onsetTimes = (w) => { const t = []; for (const e of w.events) if (!t.length || e.t - t[t.length - 1] >= 0.001) t.push(e.t); return t; };

/** omission response: rate after omitted beats vs gaps of the same age since the last onset in the shuffled world */
export function omissionResponse(recO, recS, { post = BENCH.post } = {}) {
  const om = recO.world.omitted; if (!om.length) return null;
  const rateIn = (rec, a, b) => { const f0 = Math.max(0, Math.round(a / DT_FRAME)), f1 = Math.min(rec.inter.length, Math.round(b / DT_FRAME)); let c = 0; for (let f = f0; f < f1; f++) c += rec.inter[f]; return f1 > f0 ? c / (rec.nInter * (f1 - f0) * DT_FRAME) : NaN; };
  const sigIn = (arr, a, b) => { const f0 = Math.max(0, Math.round(a / DT_FRAME)), f1 = Math.min(arr.length, Math.round(b / DT_FRAME)); let c = 0; for (let f = f0; f < f1; f++) c += arr[f]; return f1 > f0 ? c / (f1 - f0) : NaN; };
  const tO = onsetTimes(recO.world), tS = onsetTimes(recS.world), segsS = recS.world.segs;
  const keys = Object.keys(recO.sig).filter((k) => recS.sig[k]);
  const A = [], B = [], sA = Object.fromEntries(keys.map((k) => [k, []])), sB = Object.fromEntries(keys.map((k) => [k, []]));
  for (const o of om) {
    const j = lowerBound(tO, o) - 1; if (j < 0) continue;
    const d = o - tO[j];
    A.push(rateIn(recO, o + post[0], o + post[1])); for (const k of keys) sA[k].push(sigIn(recO.sig[k], o + post[0], o + post[1]));
    // control gaps: an onset in a rhythmic segment of the shuffled world, nothing for d + post[1] after it
    for (let i = 0; i + 1 < tS.length; i++) {
      const q = tS[i] + d; if (tS[i + 1] < q + post[1] || tS[i] < BENCH.warm) continue;
      if (!segsS.some((s) => s.rhythmic && tS[i] >= s.t0 && q + post[1] < s.t1)) continue;
      B.push(rateIn(recS, q + post[0], q + post[1])); for (const k of keys) sB[k].push(sigIn(recS.sig[k], q + post[0], q + post[1]));
    }
  }
  if (!A.length) return null;
  const size = mean(A) - mean(B), se = B.length > 1 ? Math.sqrt(sd(B) ** 2 / Math.max(1, B.length) + sd(A) ** 2 / A.length) : NaN;
  const signals = Object.fromEntries(keys.map((k) => [k, { omit: mean(sA[k]), gap: mean(sB[k]), diff: mean(sA[k]) - mean(sB[k]) }]));
  return { hz: size, z: se > 0 ? size / se : NaN, omitHz: mean(A), gapHz: mean(B), nOmit: A.length, nGap: B.length, signals };
}

/** onset groups with a class (the loudest kind of sound in the group: kick > snare > block > hat) */
const CLASS = { kick: 0, snare: 1, block: 2, hat: 3 };
function classedOnsets(w) {
  const g = [];
  for (const e of w.events) { const c = CLASS[e.type] ?? 3, last = g[g.length - 1]; if (last && e.t - last.t < 0.001) last.c = Math.min(last.c, c); else g.push({ t: e.t, c }); }
  return g;
}
/** the reflex model: per onset class, the motor rate it evokes 0-400 ms later (above the run's mean rate), estimated in the
 *  shuffled world where nothing is predictable; then the vector strength that reflex alone would give the groove's onsets */
export function reflexVS(recS, recG, { from = BENCH.warm, span = 0.4 } = {}) {
  const nb = Math.round(span / DT_FRAME), K = Array.from({ length: 4 }, () => new Float64Array(nb)), cnt = new Float64Array(4);
  const sp = recS.motor, dur = recS.world.dur, t0 = from;
  const base = sp.filter((t) => t >= t0).length / Math.max(1e-9, dur - t0);
  for (const o of classedOnsets(recS.world)) {
    if (o.t < t0 || o.t + span > dur) continue; cnt[o.c]++;
    for (let i = lowerBound(sp, o.t), e = lowerBound(sp, o.t + span); i < e; i++) K[o.c][Math.min(nb - 1, Math.floor((sp[i] - o.t) / DT_FRAME))]++;
  }
  for (let c = 0; c < 4; c++) for (let b = 0; b < nb; b++) K[c][b] = cnt[c] ? K[c][b] / (cnt[c] * DT_FRAME) - base : 0;
  // predicted rate on the groove's 4 ms grid
  const n = Math.floor(recG.world.dur / DT_FRAME), r = new Float64Array(n).fill(base);
  for (const o of classedOnsets(recG.world)) { const f0 = Math.round(o.t / DT_FRAME); for (let b = 0; b < nb && f0 + b < n; b++) r[f0 + b] += K[o.c][b]; }
  let c = 0, s = 0, m = 0;
  for (const bt of recG.world.beats) {
    if (bt.t < from) continue;
    const f0 = Math.max(0, Math.ceil((bt.t - bt.period / 2) / DT_FRAME)), f1 = Math.min(n, Math.ceil((bt.t + bt.period / 2) / DT_FRAME));
    for (let f = f0; f < f1; f++) { const x = Math.max(0, r[f]), ph = 2 * Math.PI * (f * DT_FRAME + DT_FRAME / 2 - bt.t) / bt.period; c += x * Math.cos(ph); s += x * Math.sin(ph); m += x; }
  }
  return m > 0 ? Math.hypot(c, s) / m : NaN;
}

/** the body's brace (mean motor stiffness, brace.mjs) against the beat: per beat, when the brace peaks in its window
 *  (ms; negative: before the beat), the consistency of that peak (vector strength of the peak phases), and the protection
 *  it gave at impacts that carried a beat (within 30 ms of one) */
export function braceTiming(rec, beats, { from = BENCH.warm } = {}) {
  const tr = rec.brace; if (!tr) return null;
  const errs = []; let c = 0, s = 0, mod = 0, nb = 0;
  for (const b of beats) {
    if (b.t < from) continue;
    const f0 = Math.max(0, Math.ceil((b.t - b.period / 2) / DT_FRAME) - 1), f1 = Math.min(tr.length, Math.ceil((b.t + b.period / 2) / DT_FRAME) - 1);
    if (f1 - f0 < 3) continue;
    let fm = f0, lo = Infinity; for (let f = f0; f < f1; f++) { if (tr[f] > tr[fm]) fm = f; if (tr[f] < lo) lo = tr[f]; }
    if (!(tr[fm] > 0)) continue;
    const dt = (fm + 1) * DT_FRAME - b.t; errs.push(1000 * dt); c += Math.cos(2 * Math.PI * dt / b.period); s += Math.sin(2 * Math.PI * dt / b.period); mod += (tr[fm] - lo) / tr[fm]; nb++;
  }
  const bt = beats.map((b) => b.t), near = (t) => { const i = lowerBound(bt, t - 0.03); return i < bt.length && Math.abs(bt[i] - t) <= 0.03; };
  const pb = rec.impacts.filter((x) => x.t >= from && near(x.t)).map((x) => x.p), pa = rec.impacts.filter((x) => x.t >= from).map((x) => x.p);
  return { braceErrMs: quant(errs, 0.5), braceIqrMs: quant(errs, 0.75) - quant(errs, 0.25), braceLock: nb ? Math.hypot(c, s) / nb : NaN, braceMod: nb ? mod / nb : NaN, errs,
    protectBeat: pb.length ? mean(pb) : NaN, protectAll: pa.length ? mean(pa) : NaN, impacts: pa.length };
}

/** the metrics of one world for one condition, from its three variant runs */
export function scoreWorld(runs, opt = {}) {
  const g = runs.groove, s = runs.shuffled, o = runs.omission;
  const lg = beatLock(g.motor, g.world.beats, opt), ls = s ? beatLock(s.motor, s.world.beats, opt) : null;
  const vsReflex = s ? reflexVS(s, g, opt) : NaN;
  const bg = braceTiming(g, g.world.beats, opt), bs = s ? braceTiming(s, s.world.beats, opt) : null;
  const resonVs = g.nOsc ? beatLock(g.reson, g.world.beats, opt).vs : NaN;
  const all = Object.values(runs);
  return {
    braceErrMs: bg?.braceErrMs ?? NaN, braceIqrMs: bg?.braceIqrMs ?? NaN, braceLock: bg?.braceLock ?? NaN, braceLockShuffled: bs?.braceLock ?? NaN, braceMod: bg?.braceMod ?? NaN, braceErrs: bg?.errs ?? [],
    protect: bg?.protectBeat ?? NaN, protectShuffled: bs?.protectBeat ?? NaN, protectCredit: (bg?.protectBeat ?? NaN) - (bs?.protectBeat ?? NaN), resonVs, nOsc: g.nOsc || 0,
    world: g.world.name, vs: lg.vs, vsShuffled: ls ? ls.vs : NaN, credit: ls ? lg.vs - ls.vs : NaN, vsReflex, beyondReflex: lg.vs - vsReflex, phase: lg.phase, motorSpikes: lg.n,
    errMs: lg.errMs, iqrMs: lg.iqrMs, errs: lg.errs, omission: o && s ? omissionResponse(o, s) : null,
    viability: mean(all.map((r) => r.viability)), alive: all.every((r) => r.alive), interHz: mean(all.map((r) => r.interHz)),
    runaway: Math.max(...all.map((r) => r.runaway)), msPerSimS: mean(all.map((r) => r.msPerSimS)),
  };
}

/** one condition averaged over its worlds (errors pooled over beats) */
export function summarizeCondition(rows) {
  const errs = rows.flatMap((r) => r.errs), berrs = rows.flatMap((r) => r.braceErrs || []), om = rows.map((r) => r.omission).filter(Boolean);
  const sigKeys = [...new Set(om.flatMap((x) => Object.keys(x.signals)))];
  return {
    vs: mean(rows.map((r) => r.vs)), vsShuffled: mean(rows.map((r) => r.vsShuffled)), credit: mean(rows.map((r) => r.credit)),
    braceErrMs: quant(berrs, 0.5), braceIqrMs: quant(berrs, 0.75) - quant(berrs, 0.25), braceLock: mean(rows.map((r) => r.braceLock).filter(Number.isFinite)), braceLockShuffled: mean(rows.map((r) => r.braceLockShuffled).filter(Number.isFinite)),
    protect: mean(rows.map((r) => r.protect).filter(Number.isFinite)), protectShuffled: mean(rows.map((r) => r.protectShuffled).filter(Number.isFinite)), protectCredit: mean(rows.map((r) => r.protectCredit).filter(Number.isFinite)), resonVs: mean(rows.map((r) => r.resonVs).filter(Number.isFinite)),
    vsReflex: mean(rows.map((r) => r.vsReflex).filter(Number.isFinite)), beyondReflex: mean(rows.map((r) => r.beyondReflex).filter(Number.isFinite)),
    errMs: quant(errs, 0.5), iqrMs: quant(errs, 0.75) - quant(errs, 0.25), beats: errs.length,
    omissionHz: om.length ? mean(om.map((x) => x.hz)) : NaN, omissionZ: om.length ? mean(om.map((x) => x.z).filter(Number.isFinite)) : NaN,
    omissionSignals: Object.fromEntries(sigKeys.map((k) => [k, mean(om.map((x) => x.signals[k]?.diff).filter(Number.isFinite))])),
    viability: mean(rows.map((r) => r.viability)), alive: rows.every((r) => r.alive), interHz: mean(rows.map((r) => r.interHz)),
    runaway: Math.max(...rows.map((r) => r.runaway)), msPerSimS: mean(rows.map((r) => r.msPerSimS)),
  };
}

/** both conditions for one development seed */
export function benchSeed(genome, seed, { set = 'test', dur = BENCH.dur, variants = VARIANTS, worldSeed = 1, lifeDur = BENCH.dur, conditions = ['newborn', 'adult'] } = {}) {
  genome = fitGenome(genome);
  const specs = set === 'train' ? TRAIN : set === 'test' ? TEST : set;
  const out = { seed };
  const runAll = (make) => specs.map((spec) => {
    const runs = {}; for (const v of variants) runs[v] = runRecord(make(), framesFor(spec, v, { seed: worldSeed, dur }));
    return scoreWorld(runs);
  });
  if (conditions.includes('newborn')) {
    // one gestation (organism.mjs), then every world hears a copy of the same newborn
    const fd = frozenDev(genome, seed), nb = createOrganism({ dev: fd, seed }).serialize();
    out.newborn = runAll(() => { const o = createOrganism({ dev: fd, seed, gestation: 0 }); o.restore(nb); return o; });
  }
  if (conditions.includes('adult')) {
    const org = createOrganism({ genome, seed }); let lifeOk = true, lifeV = 0, lifeHz = 0;
    for (const spec of TRAIN) { const L = live(org, framesFor(spec, 'groove', { seed: worldSeed + 1000, dur: lifeDur })); lifeOk = lifeOk && L.died < 0; lifeV += L.viability / TRAIN.length; lifeHz += L.interHz / TRAIN.length; }
    const snap = org.serialize(), D = depth(org);
    out.life = { alive: lifeOk, viability: lifeV, interHz: lifeHz, simS: TRAIN.length * lifeDur, motorDepth: D.motorDepth, motorReached: D.motorReached };
    out.adult = runAll(() => restoreOrganism(snap));
  }
  for (const c of conditions) if (out[c]) out[c + 'Summary'] = summarizeCondition(out[c]);
  return out;
}

const HEAD = ['vs', 'vsShuffled', 'credit', 'vsReflex', 'beyondReflex', 'errMs', 'iqrMs', 'braceErrMs', 'braceIqrMs', 'braceLock', 'braceLockShuffled', 'protect', 'protectShuffled', 'protectCredit', 'resonVs', 'omissionHz', 'omissionZ', 'viability', 'interHz', 'msPerSimS'];
/** mean +- sd over development seeds, per condition, plus per-world means */
export function aggregate(perSeed) {
  const out = { seeds: perSeed.map((p) => p.seed) };
  for (const c of ['newborn', 'adult']) {
    const S = perSeed.map((p) => p[c + 'Summary']).filter(Boolean); if (!S.length) continue;
    const h = {}; for (const k of HEAD) { const v = S.map((x) => x[k]).filter(Number.isFinite); h[k] = { mean: mean(v), sd: sd(v) }; }
    h.alive = S.filter((x) => x.alive).length / S.length;
    const sigKeys = [...new Set(S.flatMap((x) => Object.keys(x.omissionSignals || {})))];
    if (sigKeys.length) h.omissionSignals = Object.fromEntries(sigKeys.map((k) => { const v = S.map((x) => x.omissionSignals[k]).filter(Number.isFinite); return [k, { mean: mean(v), sd: sd(v) }]; }));
    const worlds = perSeed[0][c].map((r) => r.world);
    h.worlds = worlds.map((w) => {
      const rows = perSeed.map((p) => p[c].find((r) => r.world === w)).filter(Boolean), m = (k) => mean(rows.map((r) => r[k]).filter(Number.isFinite));
      return { world: w, vs: m('vs'), vsShuffled: m('vsShuffled'), credit: m('credit'), vsReflex: m('vsReflex'), beyondReflex: m('beyondReflex'), errMs: m('errMs'), iqrMs: m('iqrMs'), braceErrMs: m('braceErrMs'), braceLock: m('braceLock'), protect: m('protect'), protectCredit: m('protectCredit'), resonVs: m('resonVs'), omissionHz: mean(rows.map((r) => r.omission?.hz).filter(Number.isFinite)), viability: m('viability') };
    });
    out[c] = h;
  }
  // what a life added, seed by seed (adult minus its own frozen newborn, same worlds)
  const both = perSeed.filter((p) => p.adultSummary && p.newbornSummary);
  if (both.length) out.learned = Object.fromEntries(['vs', 'credit', 'beyondReflex', 'errMs', 'braceErrMs', 'braceLock', 'protect', 'protectCredit'].map((k) => { const v = both.map((p) => p.adultSummary[k] - p.newbornSummary[k]).filter(Number.isFinite); return [k, { mean: mean(v), sd: sd(v) }]; }));
  const lifes = perSeed.map((p) => p.life).filter(Boolean);
  if (lifes.length) out.life = { alive: lifes.filter((l) => l.alive).length / lifes.length, viability: mean(lifes.map((l) => l.viability)), interHz: mean(lifes.map((l) => l.interHz)), motorDepth: mean(lifes.map((l) => l.motorDepth).filter(Number.isFinite)) };
  return out;
}

/** a whole bench, in this thread */
export function benchGenome(genome, { seeds = devSeeds(BENCH.seeds), ...opt } = {}) { return aggregate(seeds.map((s) => benchSeed(genome, s, opt))); }

/** the headline numbers in a compact form */
export function headline(agg) {
  const o = {};
  for (const c of ['newborn', 'adult']) if (agg[c]) o[c] = Object.fromEntries(HEAD.map((k) => [k, +(+agg[c][k].mean).toFixed(4)]));
  if (agg.learned) o.learned = Object.fromEntries(Object.entries(agg.learned).map(([k, v]) => [k, +(+v.mean).toFixed(4)]));
  return o;
}

/** a readable table */
export function table(agg, title = '') {
  const f = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : '  -  ');
  const pm = (v, d = 3) => (v ? `${f(v.mean, d)} +- ${f(v.sd, d)}` : '-');
  const L = [];
  if (title) L.push(title);
  L.push(`development seeds: ${agg.seeds.join(', ')}`);
  if (agg.life) L.push(`life (train worlds, groove): alive ${(100 * agg.life.alive).toFixed(0)}%, viability ${f(agg.life.viability)}, interneurons ${f(agg.life.interHz, 2)} Hz, sensor->motor depth ${f(agg.life.motorDepth, 2)}`);
  for (const c of ['newborn', 'adult']) {
    const h = agg[c]; if (!h) continue;
    L.push('', `${c === 'newborn' ? 'NEWBORN (plasticity frozen)' : 'ADULT (after a life)'}   alive ${(100 * h.alive).toFixed(0)}% of seeds`);
    L.push(`  vector strength  groove ${pm(h.vs)}   shuffled ${pm(h.vsShuffled)}   credit (groove - shuffled) ${pm(h.credit)}`);
    L.push(`  reflex model     vs a reflex alone would give ${pm(h.vsReflex)}   beyond reflex (vs - that) ${pm(h.beyondReflex)}`);
    L.push(`  brace            peak ${pm(h.braceErrMs, 1)} ms   IQR ${pm(h.braceIqrMs, 1)} ms   lock ${pm(h.braceLock)} (shuffled ${pm(h.braceLockShuffled)})`);
    L.push(`  protection       at beat impacts ${pm(h.protect)}   shuffled ${pm(h.protectShuffled)}   credit ${pm(h.protectCredit)}   resonators vs ${pm(h.resonVs)}`);
    L.push(`  alignment        median ${pm(h.errMs, 1)} ms   IQR ${pm(h.iqrMs, 1)} ms   (negative: early)`);
    L.push(`  omission         ${pm(h.omissionHz, 3)} Hz   z ${pm(h.omissionZ, 2)}${h.omissionSignals ? '   readouts ' + Object.entries(h.omissionSignals).map(([k, v]) => `${k} ${pm(v, 4)}`).join(', ') : ''}`);
    L.push(`  viability ${pm(h.viability)}   interneurons ${pm(h.interHz, 2)} Hz   cost ${pm(h.msPerSimS, 1)} ms per simulated s`);
    L.push('  world            vs     shuffled  credit   reflex  beyond   err ms   IQR ms   brace ms  protect  p-credit  reson  omission Hz');
    for (const w of h.worlds) L.push(`  ${w.world.padEnd(15)} ${f(w.vs)}   ${f(w.vsShuffled)}   ${f(w.credit).padStart(6)}   ${f(w.vsReflex)}   ${f(w.beyondReflex).padStart(6)}   ${f(w.errMs, 1).padStart(6)}   ${f(w.iqrMs, 1).padStart(6)}   ${f(w.braceErrMs, 1).padStart(6)}   ${f(w.protect)}   ${f(w.protectCredit).padStart(6)}   ${f(w.resonVs)}  ${f(w.omissionHz)}`);
  }
  if (agg.learned) L.push('', 'LEARNED (adult minus its own frozen newborn, per seed): ' + Object.entries(agg.learned).map(([k, v]) => `${k} ${pm(v, /Ms$/.test(k) ? 1 : 3)}`).join('   '));
  return L.join('\n');
}

/** run a bench with one worker thread per development seed (Node) */
export async function benchParallel(genome, { seeds = devSeeds(BENCH.seeds), workers = seeds.length, ...opt } = {}) {
  const file = new URL(import.meta.url), pool = Array.from({ length: Math.min(workers, seeds.length) }, () => new Worker(file, { workerData: { role: 'bench' } }));
  let next = 0; const res = new Array(seeds.length);
  await Promise.all(pool.map((w) => new Promise((done, fail) => {
    const go = () => { if (next >= seeds.length) { w.terminate(); done(); return; } const i = next++; w.once('message', (m) => { res[i] = m; go(); }); w.postMessage({ genome: Array.from(genome), seed: seeds[i], opt }); };
    w.on('error', fail); go();
  })));
  return aggregate(res);
}

if (!isMainThread && workerData?.role === 'bench') {
  parentPort.on('message', ({ genome, seed, opt }) => parentPort.postMessage(benchSeed(genome, seed, opt)));
}

// ---- CLI -------------------------------------------------------------------------------------------------------------------------
const isCli = isMainThread && typeof process !== 'undefined' && process.argv[1] && (await import('node:url')).pathToFileURL(process.argv[1]).href === import.meta.url;
if (isCli) {
  const fs = await import('node:fs'), path = await import('node:path');
  const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..');
  const file = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--'))) || path.join(root, 'lab/results/organism-best.json');
  const src = JSON.parse(fs.readFileSync(file, 'utf8')), genome = src.genome || src;
  const seeds = devSeeds(+arg('seeds', BENCH.seeds)), set = arg('set', 'test'), dur = +arg('dur', BENCH.dur);
  const t0 = Date.now();
  const agg = await benchParallel(genome, { seeds, workers: +arg('workers', seeds.length), set, dur });
  const result = { genome: Array.from(genome), source: path.relative(root, path.resolve(file)).replace(/\\/g, '/'), set, dur, worlds: (set === 'train' ? TRAIN : TEST).map((w) => w.name), wallS: (Date.now() - t0) / 1000, headline: headline(agg), bench: agg };
  const out = arg('out', path.join(root, 'lab/results/organism-bench.json'));
  if (out !== 'none') fs.writeFileSync(out, JSON.stringify(result, null, 1));
  if (args.includes('--json')) console.log(JSON.stringify(result, null, 1));
  console.log(table(agg, `bench of ${result.source} on the ${set === 'train' ? 'train' : 'held-out'} worlds (${dur} s each, ${result.wallS.toFixed(0)} s wall)`));
}
