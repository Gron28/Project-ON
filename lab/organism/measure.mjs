// lab/organism/measure.mjs - the measures reported for an organism, without dressing up. Pure module (Node or page).
//   1. lives the standard mixed life (environment.mjs LIFE), recording E/I conductances and interneuron spike times
//   2. structure after that life: modularity Q, sensor -> motor depth, reciprocity vs degree-matched random, pruned share
//   3. clones of the experienced organism each hear 60 s of: groove at 120 bpm, white noise, scattered drums (same sounds,
//      no structure), and 180 s of silence: energy change, prediction credit, stimulation need
//   4. phase locking of motor spikes to the 120 bpm beat (vector strength at 0.5 s), last 30 s of the groove, for the
//      experienced organism and for a newborn with plasticity frozen; scattered drums as the chance control
//   5. cost: ms of CPU per simulated second for the organism (ear frames precomputed) and for the ear alone

import { createOrganism, restoreOrganism } from './organism.mjs';
import { develop } from './develop.mjs';
import { earFrames, live, LIFE } from './environment.mjs';
import { summarize, vectorStrength, cvISI } from './analysis.mjs';
import { createEar, SR } from '../../being/ear.mjs';

const VE = 4.3, VI = -0.33;

export function measure(genome, seed, { life = LIFE, log = () => {} } = {}) {
  const out = {};
  // ---- 1. a life ----------------------------------------------------------------------------------------------------------
  const F = earFrames(life, 1), org = createOrganism({ genome, seed });
  const spikes = Array.from({ length: org.dev.N }, () => []), inter = org.C.inter;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, k = 0, cE = 0, cI = 0;
  const t0 = performance.now();
  const L = live(org, F, { each: (o, f, s) => {
    const t = s.t; for (const i of inter) if (o.net.spk[i]) spikes[i].push(t);
    const x = s.gE, y = s.gI; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; k++; cE += x * (VE - 0.5); cI += y * (0.5 - VI);
  } });
  out.costMsPerSimS = (performance.now() - t0) / (F.n * 0.004);
  const cov = sxy / k - (sx / k) * (sy / k), corr = cov / Math.sqrt(Math.max(1e-12, (sxx / k - (sx / k) ** 2) * (syy / k - (sy / k) ** 2)));
  out.life = { viability: L.viability, died: L.died, interHz: L.interHz, rateHz: L.rateHz, runaway: L.runaway, maxInter1s: L.maxInter1s,
    segs: L.segs.map((s) => ({ mode: s.mode + (s.bpm ? ' ' + s.bpm : ''), inter: +s.inter.toFixed(2), dE: +(s.E1 - s.E0).toFixed(3), dI: +(s.I1 - s.I0).toFixed(3), need: +s.need1.toFixed(3), pred: +s.pred.toFixed(3) })) };
  out.balance = { gEgIcorr: corr, inhToExcCurrent: cI / cE, cvISI: cvISI(spikes) };
  log('life done');
  // ---- 2. structure -------------------------------------------------------------------------------------------------------
  const S = summarize(org); delete S.member; out.structure = S;
  // ---- 3, 4. clones of the experienced organism ----------------------------------------------------------------------------
  const snap = org.serialize();
  const run = (sched, recFrom) => {
    const o = restoreOrganism(snap), Fx = earFrames(sched, 7); let rec = null;
    const r = live(o, Fx, { each: (oo, f) => { if (f === Math.round(recFrom / 0.004)) { oo.record(true); rec = oo.rec; } } });
    const s = o.state(); return { o, r, s, rec };
  };
  const E0 = snap.milieu.energy;
  const groove = run([{ mode: 'groove', dur: 60, bpm: 120 }], 30), noise = run([{ mode: 'noise', dur: 60 }], 30), scatter = run([{ mode: 'scatter', dur: 60 }], 30);
  const silence = run([{ mode: 'silence', dur: 180 }], 999);
  const seg = (x) => ({ dE: +(x.s.energy - E0).toFixed(4), pred: +x.r.segs[0].pred.toFixed(4), inter: +x.r.interHz.toFixed(2), dI: +(x.s.integrity - snap.milieu.integrity).toFixed(4), need: +x.s.need.toFixed(3) });
  out.energy = { start: E0, groove: seg(groove), noise: seg(noise), scatter: seg(scatter), silence180: { ...seg(silence), needStart: snap.milieu.need } };
  log('clones done');
  const vs = (rec, from) => { const t = rec.motorSpikes.filter((x) => x >= from); return vectorStrength(t, 0.5); };
  // the beat's own phase: where the kicks fall on the 0.5 s grid
  const onsetPhase = groove.rec ? vectorStrength(groove.rec.onsets.filter((x) => x >= 30), 0.5) : null;
  const dev = develop(genome, seed); dev.G = { ...dev.G, etaH: 0, etaI: 0, etaS: 0, pruneThr: 0 };
  const frozen = createOrganism({ dev, seed }); const Fg = earFrames([{ mode: 'groove', dur: 60, bpm: 120 }], 7);
  live(frozen, Fg, { each: (o, f) => { if (f === 30 * 250) o.record(true); } });
  out.phaseLock = { experienced: vs(groove.rec, 30), newbornFrozen: vs(frozen.rec, 30), scatterControl: vs(scatter.rec, 30), beatOnsets: onsetPhase };
  // ---- 5. the ear's own cost -----------------------------------------------------------------------------------------------
  const ear = createEar(), x = new Float32Array(SR); for (let i = 0; i < SR; i++) x[i] = 0.3 * Math.sin(i * 0.05) * ((i % 24000) < 3000 ? 1 : 0.1);
  const te = performance.now(); for (let r = 0; r < 3; r++) for (let i = 0; i < SR; i++) ear.sample(x[i]); out.earMsPerSimS = (performance.now() - te) / 3;
  return out;
}
