// lab/organism/watch.mjs - the lab organism living inside ON, for the dashboard to watch. Pure module (being/worker.mjs).
//
// It hears the being's own ear (being/ear.mjs tap(): one 4 ms frame per network step, the cadence the lab uses) and owns
// its own body (being/physics.mjs inside organism.mjs). Nothing it does reaches the being unless the experimental
// drive switch is on (drive() below); otherwise it is only watched.
//
//   const w = createWatch({ genome, seed, label });  w.tick(ear.tap());  w.snapshot(full)  (what the dashboard draws)
// snapshot(): { status, cost: { developMs, msPerSec }, staticVersion, static? (sent when full or when the graph changed),
//   live: { t, rf, spikes, spikeAge, beatPhase, dead, resonators, state, stats, phys, chrom }, timing: { impacts: [{ t, a, p, leadMs, beatPhase }] } }
// leadMs: how far ahead of the impact its brace peaked (> 0 braced before the hit); beatPhase: the being's shown beat
// phase then. static.version is new for every organism (a module-wide count) and bumps when pruning or sprouting changed it.
// drive(): the compact state that lets the organism move ON when settings.organism.drive is on (being/worker.mjs posts it
// as 'org-drive' after each audio block, at most ~60/s; being/index.html ORGD maps it): { t, reg[8] (its motor cells'
// activation grouped by the nearest of kuramoto's REGION_DIRS, over their running peak, 0..1; a region with no motor cell
// gets the others' mean), motor (mean activation), pulse (motor over its running peak, 0..1), brace, impact (largest
// since the last call), chrom [brightness, hue, contrast], body { pos[3], squash, modes[5], omega[3], strain } (its own physics.mjs body), feel [arousal, valence, energy] }.

import { createOrganism } from './organism.mjs';
import { randomGenome } from './genome.mjs';
import { protection } from './brace.mjs';
import { REGION_DIRS, NREG } from '../../being/kuramoto.mjs';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
let organisms = 0;
const SPIKE_CAP = 2000, RING = 128, HALF = 62, IMPACTS = 16;    // brace ring 512 ms; brace peak searched within +-248 ms

/** a genome from a file is an array of 20..64 numbers in 0..1 */
export function validGenome(g) { return Array.isArray(g) && g.length >= 20 && g.length <= 64 && g.every((x) => typeof x === 'number' && x >= 0 && x <= 1); }

export function createWatch({ genome = null, seed = 1, label = '' } = {}) {
  const own = validGenome(genome);
  seed = Number.isInteger(seed) && seed > 0 ? seed : 1;
  const t0 = now();
  const org = createOrganism({ genome: own ? Float64Array.from(genome) : randomGenome(seed), seed });
  const developMs = now() - t0, net = org.net, N = org.dev.N;
  const genomeLabel = own ? label || 'genome' : `seed ${seed} (no evolved genome)`;
  const spikes = new Uint16Array(SPIKE_CAP), spikeAt = new Int32Array(SPIKE_CAP), brace = new Float32Array(RING), pending = [], impacts = [];
  let nSpk = 0, step = 0, pulledAt = -1e9, version = 1000 * ++organisms, sent = -1, structure = -1, costMs = 0, costN = 0, msPerSec = 0;
  const w = { org, developMs, onPhase: 0 };
  // drive: each motor cell's region, by its normal (its position when it has none)
  const motors = org.C.motor, regOf = new Uint8Array(motors.length), regN = new Float32Array(NREG), PEAK_TAU = 5;
  motors.forEach((i, k) => {
    const v = org.dev.vec, p = org.dev.pos; let x = v[6 * i], y = v[6 * i + 1], z = v[6 * i + 2];
    if (!(x * x + y * y + z * z > 1e-9)) { x = p[3 * i]; y = p[3 * i + 1]; z = p[3 * i + 2]; }
    let best = -Infinity; for (let g = 0; g < NREG; g++) { const d = x * REGION_DIRS[g][0] + y * REGION_DIRS[g][1] + z * REGION_DIRS[g][2]; if (d > best) { best = d; regOf[k] = g; } }
    regN[regOf[k]]++;
  });
  const regSum = new Float32Array(NREG); let regPeak = 1e-3, motPeak = 1e-3, impMax = 0, drivenAt = -1;

  w.tick = (f) => {
    const a = now();
    org.tick(f);
    const o = org.out;
    brace[step % RING] = o.brace;
    if (o.impact > impMax) impMax = o.impact;
    if (o.impact > 0) pending.push({ step, t: org.time, a: o.impact, p: protection(o.brace), onPhase: w.onPhase });
    // an impact's brace peak, once the window after it has passed: its offset from the impact (ms, negative: braced ahead)
    while (pending.length && step - pending[0].step >= HALF) {
      const q = pending.shift(); let best = -1, at = 0;
      for (let s = q.step - HALF; s <= q.step + HALF; s++) { if (s < 0) continue; const b = brace[s % RING]; if (b > best) { best = b; at = s; } }
      impacts.push({ t: +q.t.toFixed(3), a: +q.a.toFixed(3), p: +q.p.toFixed(3), leadMs: (q.step - at) * 4, beatPhase: +q.onPhase.toFixed(3) });
      if (impacts.length > IMPACTS) impacts.shift();
    }
    if (step - pulledAt < 250) for (let i = 0; i < N && nSpk < SPIKE_CAP; i++) if (net.spk[i]) { spikeAt[nSpk] = step; spikes[nSpk++] = i; }   // only while someone looks; a cell that fires twice is listed twice
    // the graph's version: pruning and sprouting run every 5 s, so it is checked as often
    if (step % 1250 === 0) { const s = net.stats.pruned + net.stats.sprouted; if (s !== structure) { if (structure >= 0) version++; structure = s; } }
    step++;
    costMs += now() - a;
    if (++costN === 250) { msPerSec = costMs; costMs = 0; costN = 0; }   // CPU ms per second of audio
  };

  w.snapshot = (full = false) => {
    pulledAt = step;
    const out = { status: 'live', cost: { developMs: +developMs.toFixed(1), msPerSec: +msPerSec.toFixed(2) }, staticVersion: version };
    if (full || sent !== version) {
      const e = net.edges();
      out.static = { version, N, pos: Float32Array.from(org.dev.pos), type: Uint8Array.from(org.dev.type), isI: Uint8Array.from(org.dev.isI),
        edges: { pre: e.pre, post: e.post, w: e.w }, genomeLabel, earSpread: org.G.earSpread, nOsc: net.OSC.length,
        extra: Float32Array.from(org.dev.extra), osc: Float32Array.from(org.dev.osc), seed };
      sent = version;
    }
    let anyDead = false; for (let i = 0; i < N; i++) if (net.dead[i]) { anyDead = true; break; }
    const st = org.state(), ph = org.phys, r = net.OSC.length ? net.resonators() : null;
    out.live = {
      t: org.time, rf: Float32Array.from(net.rf), spikes: spikes.slice(0, nSpk),
      spikeAge: Uint16Array.from(spikeAt.subarray(0, nSpk), (s) => Math.min(65535, step - s - 1)), beatPhase: w.onPhase,   // each spike's age in 4 ms steps; the being's shown beat phase now dead: anyDead ? Uint8Array.from(net.dead) : null,
      resonators: r ? { cells: Int32Array.from(r.cells), hz: r.hz, phase: r.phase } : null,
      state: { ...st, stimNeed: st.need },
      stats: { ...net.stats, synapses: e2m(net, N) },
      phys: { pos: Array.from(ph.pos), slosh: Array.from(ph.slosh), modes: Array.from(ph.modes), strain: ph.strain, omega: Array.from(ph.omega) },
      chrom: Float32Array.from(org.C.chrom, (i) => org.act[i]),   // chromatophore expansion, in cell order
    };
    nSpk = 0;
    out.timing = { impacts: impacts.slice() };
    return out;
  };
  w.drive = () => {
    const t = org.time, gone = drivenAt < 0 ? 0 : Math.max(0, t - drivenAt), dec = Math.exp(-gone / PEAK_TAU); drivenAt = t;
    const act = org.act, o = org.out, reg = new Float32Array(NREG);
    regSum.fill(0); for (let k = 0; k < motors.length; k++) regSum[regOf[k]] += act[motors[k]];
    let top = 0; for (let g = 0; g < NREG; g++) { const m = regN[g] ? regSum[g] / regN[g] : 0; reg[g] = m; if (m > top) top = m; }
    regPeak = Math.max(regPeak * dec, top, 1e-3); motPeak = Math.max(motPeak * dec, o.motor, 1e-3);
    let mean = 0, full = 0;
    for (let g = 0; g < NREG; g++) if (regN[g]) { reg[g] = Math.min(1, reg[g] / regPeak); mean += reg[g]; full++; }
    for (let g = 0; g < NREG; g++) if (!regN[g]) reg[g] = full ? mean / full : 0;   // a region with no motor cell shows nothing of its own
    // the skin: mean expansion, the expansion-weighted mean pigment hue (on the circle), and how patchy it is
    const C = org.C.chrom, ex = org.dev.extra; let b = 0, hs = 0, hc = 0, v = 0;
    for (let k = 0; k < C.length; k++) { const a = act[C[k]], h = 2 * Math.PI * ex[4 * C[k]]; b += a; hs += a * Math.sin(h); hc += a * Math.cos(h); }
    b /= Math.max(1, C.length); for (let k = 0; k < C.length; k++) v += (act[C[k]] - b) ** 2;
    const ph = org.phys, m = org.milieu.s, imp = impMax; impMax = 0;
    return { t, reg, motor: o.motor, pulse: Math.min(1, o.motor / motPeak), brace: o.brace, impact: imp,
      chrom: [b, ((Math.atan2(hs, hc) / (2 * Math.PI)) + 1) % 1, Math.sqrt(v / Math.max(1, C.length))],
      body: { pos: Array.from(ph.pos), squash: ph.squash, modes: Array.from(ph.modes), omega: Array.from(ph.omega), strain: ph.strain },
      feel: [org.net.S.mod, m.valence, m.energy] };
  };
  return w;
}

const e2m = (net, N) => { let m = 0; for (let p = 0; p < N; p++) m += net.nOut[p]; return m; };

/** the typed arrays of a snapshot, for a transfer list */
export function transferables(s) {
  const l = [], add = (a) => { if (a && ArrayBuffer.isView(a)) l.push(a.buffer); };
  if (s.static) { add(s.static.pos); add(s.static.type); add(s.static.isI); add(s.static.edges.pre); add(s.static.edges.post); add(s.static.edges.w); add(s.static.extra); add(s.static.osc); }
  if (s.live) { add(s.live.rf); add(s.live.chrom); add(s.live.spikes); add(s.live.spikeAge); add(s.live.dead); if (s.live.resonators) { add(s.live.resonators.cells); add(s.live.resonators.hz); add(s.live.resonators.phase); } }
  return l;
}
