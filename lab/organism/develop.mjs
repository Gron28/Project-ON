// lab/organism/develop.mjs - grows a nervous system in the body from a genome and a seed. Pure module (no DOM).
//
// The body is a unit sphere with a nucleus at its centre and no up or down. Development applies laws; no cell, layer,
// area or connection is placed by hand:
//   1. Morphogens. Two signalling centres on the surface (P, Q; direction and reach from the genome) and the nucleus (C)
//      release diffusible signals that decay with distance: P(x) = exp(-|x - dP| / lamP), likewise Q and C.
//   2. Sensory fields. Hair cells are induced in a cap of skin centred where P peaks, its size a gene (earSpread: one
//      placode .. the whole skin); each one's frequency is set by the local Q level (tonotopy as a gradient read-out, the
//      cochlea's physics, not wiring). Proprioceptors and sub-bass touch receptors are scattered through the body wall.
//      Effectors sit in the skin: motor cells (contractile, each pushing along its own normal and the P gradient: planar
//      polarity) and chromatophores (their pigment set by the local Q level).
//   3. Neurogenesis and migration. Interneurons are born one by one in the surface germinal zone and migrate inward;
//      the first-born travel deepest, later ones stop shallower (inside-out, as in cortex). Cells then repel softly.
//      Interoceptive and modulatory cells arise where the nucleus signal C is high (modulatory: where C and Q overlap).
//      A share of interneurons (nOsc, biased deep or shallow by oscRad) become resonators: cells with an intrinsic
//      oscillation that entrains to its input (network.mjs).
//   4. Fate. Each interneuron or interoceptive cell becomes inhibitory with probability fracI, biased by the local Q
//      level (qFateI). Dale's law: a cell's sign is fixed. Interoceptors pick the milieu variable whose morphogen
//      (C: energy, P: integrity, Q: stimulation) is strongest where they sit, and code deficit or sufficiency by Q.
//   5. Axon growth. Every cell but the effectors sends out two branches that step through the body, steered by radial
//      and P tropism (genome, with a birth-order term), up the trophic field the motor cells release (tropM; target-
//      derived neurotrophic factor, Levi-Montalcini 1987: M(x) = sum over motor cells of exp(-|x - m|^2 / LAM_M^2), sensed
//      as a relative gradient, grad M / (M + M_FLOOR), at most unit length) plus noise, kept between the nucleus and the
//      skin. Wherever a
//      branch passes within the capture radius of a cell's dendrites it makes a synapse with probability
//      synDensity * exp(-d^2 / capture^2). Delays follow path length. Receptors receive no synapses.
// Everything is recorded with a developmental time (0..1) so it can be replayed as a time-lapse.

import { decode, lcg, mix, padGenome } from './genome.mjs';
import { NE } from '../../being/ear.mjs';

export const T = { EAR: 0, ONSET: 1, ROUGH: 2, SUB: 3, PROPRIO: 4, INTER: 5, INTERO: 6, MOD: 7, MOTOR: 8, CHROM: 9 };
export const TYPE_NAMES = ['ear', 'onset', 'rough', 'sub-bass', 'proprio', 'inter', 'intero', 'modulatory', 'motor', 'chromatophore'];
export const isReceptor = (t) => t <= T.PROPRIO;
export const MILIEU_VARS = ['energy', 'integrity', 'stimulation'];
export const KMAX = 64;                       // axon capacity: at most this many synapses per cell
const LAM_M = 0.45, M_FLOOR = 0.05;           // motor trophic field: reach, and the growth cone's sensing floor
const STEP = 0.04, R_SKIN = 0.97, R_NUC = 0.12, EAR_PER_UNIT = 2, N_ONSET = 4, N_ROUGH = 4, N_SUB = 6, N_PROPRIO = 24;

const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function randUnit(r) { const z = 2 * r() - 1, a = 2 * Math.PI * r(), s = Math.sqrt(1 - z * z); return [s * Math.cos(a), s * Math.sin(a), z]; }

export function develop(genome, seed = 1) {
  const G = decode(genome), r = lcg(mix(seed, 7));
  const dP = G.dP, dQ = G.dQ, lamC = 0.35;
  const P = (x) => Math.exp(-Math.hypot(x[0] - dP[0], x[1] - dP[1], x[2] - dP[2]) / G.lamP);
  const Q = (x) => Math.exp(-Math.hypot(x[0] - dQ[0], x[1] - dQ[1], x[2] - dQ[2]) / G.lamQ);
  const C = (x) => Math.exp(-Math.hypot(x[0], x[1], x[2]) / lamC);
  const gradDir = (f, x) => { const h = 0.01, g = [0, 0, 0]; for (let a = 0; a < 3; a++) { const p = x.slice(), m = x.slice(); p[a] += h; m[a] -= h; g[a] = f(p) - f(m); } return norm(g); };
  // mean Q over the body, for fate biases
  let Qmean = 0; for (let i = 0; i < 400; i++) { const u = randUnit(r), rr = Math.cbrt(r()); Qmean += Q([u[0] * rr, u[1] * rr, u[2] * rr]); } Qmean /= 400;

  const cells = [];   // { type, pos, birthPos, born, isI, ... }
  const add = (c) => { c.id = cells.length; cells.push(c); return c; };
  const surf = (u, rad) => [u[0] * rad, u[1] * rad, u[2] * rad];

  // ---- 2. sensory fields and effectors (the periphery forms first) -----------------------------------------------------
  // the hearing field: hair cells are induced in a cap of the skin centred on the P source; its angular radius is a gene
  // (earSpread: one placode at P .. the whole skin, a hearing skin like a lateral line). Each hair cell's characteristic
  // frequency is set by the local Q level (tonotopy as a gradient read-out, like the cochlea's stiffness gradient): the
  // cells are ranked by Q and the 28 ear units assigned in that order, two cells per unit.
  const earC = dP, capR = 0.3 + (Math.PI - 0.3) * G.earSpread, capCos = Math.cos(capR);
  let e1 = norm(cross(earC, [0.3, 0.5, 0.8])); if (!Number.isFinite(e1[0])) e1 = norm(cross(earC, [1, 0, 0]));
  const e2 = norm(cross(earC, e1));
  const inCap = () => { const c = 1 - r() * (1 - capCos), s = Math.sqrt(Math.max(0, 1 - c * c)), a = 2 * Math.PI * r(), ca = s * Math.cos(a), sa = s * Math.sin(a); return norm([c * earC[0] + ca * e1[0] + sa * e2[0], c * earC[1] + ca * e1[1] + sa * e2[1], c * earC[2] + ca * e1[2] + sa * e2[2]]); };
  if (G.legacy) {
    // a 28-gene genome: the original placode, a strip along the Q gradient at P (same layout and random sequence)
    const gq = gradDir(Q, surf(earC, 0.95));
    let ax = norm(cross(cross(earC, gq), earC)); if (!Number.isFinite(ax[0]) || Math.abs(dot(ax, earC)) > 0.9) ax = norm(cross(earC, [0.3, 0.5, 0.8]));
    const side = norm(cross(earC, ax)), spread = 0.55;
    const onPatch = (s, w) => norm([earC[0] + s * ax[0] + w * side[0], earC[1] + s * ax[1] + w * side[1], earC[2] + s * ax[2] + w * side[2]]);
    for (let k = 0; k < NE; k++) for (let j = 0; j < EAR_PER_UNIT; j++) add({ type: T.EAR, pos: surf(onPatch(spread * (k / (NE - 1) - 0.5), 0.07 * (j - 0.5) + 0.02 * r.gauss()), 0.93), unit: k, born: 0.02 * r() });
    for (let i = 0; i < N_ONSET; i++) add({ type: T.ONSET, pos: surf(onPatch(spread * (r() - 0.5), 0.18 * (r() - 0.5)), 0.9), born: 0.02 * r() });
    for (let i = 0; i < N_ROUGH; i++) add({ type: T.ROUGH, pos: surf(onPatch(spread * (r() - 0.5), 0.18 * (r() - 0.5)), 0.9), born: 0.02 * r() });
  } else {
    const hair = Array.from({ length: NE * EAR_PER_UNIT }, () => surf(inCap(), 0.93)).sort((a, b) => Q(a) - Q(b));
    hair.forEach((p, i) => add({ type: T.EAR, pos: p, unit: Math.floor(i / EAR_PER_UNIT), born: 0.02 * r() }));
    for (let i = 0; i < N_ONSET; i++) add({ type: T.ONSET, pos: surf(inCap(), 0.9), born: 0.02 * r() });
    for (let i = 0; i < N_ROUGH; i++) add({ type: T.ROUGH, pos: surf(inCap(), 0.9), born: 0.02 * r() });
  }
  for (let i = 0; i < N_SUB; i++) add({ type: T.SUB, pos: surf(randUnit(r), 0.9), born: 0.05 * r() });
  for (let i = 0; i < N_PROPRIO; i++) { const p = surf(randUnit(r), 0.9); add({ type: T.PROPRIO, pos: p, polarity: r() < 0.5 ? 1 : -1, born: 0.05 * r() }); }
  for (let i = 0; i < G.nMotor; i++) {
    const u = randUnit(r), p = surf(u, R_SKIN), gp = gradDir(P, p), tan = norm(cross(cross(u, gp), u));
    add({ type: T.MOTOR, pos: p, normal: u, tangent: Number.isFinite(tan[0]) ? tan : [0, 0, 0], born: 0.05 * r() });
  }
  for (let i = 0; i < G.nChrom; i++) { const p = surf(randUnit(r), 0.99); add({ type: T.CHROM, pos: p, hue: Math.min(1, Q(p) / (Qmean * 2.5)), born: 0.05 * r() }); }

  // ---- 3, 4. neurogenesis, inside-out migration, fate ---------------------------------------------------------------------
  const fateI = (x) => r() < Math.min(0.6, Math.max(0.02, G.fracI * (1 + G.qFateI * (Q(x) / Qmean - 1))));
  const R_OUT = 0.85;
  for (let k = 0; k < G.nInter; k++) {
    const u = randUnit(r), rank = k / Math.max(1, G.nInter - 1);
    const rad = G.migDepth + (R_OUT - G.migDepth) * rank + 0.03 * r.gauss();
    const p = surf(u, Math.min(0.9, Math.max(0.15, rad)));
    // resonator fate (intrinsic oscillation: a pacemaker-like current; Llinas 1988): a share nOsc / nInter of
    // interneurons, biased toward deep (oscRad > 0) or shallow (< 0) positions
    const pOsc = Math.max(0, Math.min(0.9, (G.nOsc / G.nInter) * (1 + G.oscRad * (0.55 - Math.hypot(...p)) / 0.3)));
    const osc = pOsc > 0 && r() < pOsc ? { hz: G.oscHz * Math.exp(G.oscSpread * r.gauss()), lead: G.oscLead * (0.5 + r()) } : null;
    add({ type: T.INTER, pos: p, birthPos: surf(u, 0.92), born: 0.1 + 0.45 * rank, rank, isI: fateI(p), osc });
  }
  // cells near the nucleus signal: rejection sampling by the morphogen
  const sampleBy = (f, rMin, rMax) => { for (let t = 0; t < 2000; t++) { const u = randUnit(r), rr = rMin + (rMax - rMin) * Math.cbrt(r()), x = surf(u, rr); if (r() < f(x)) return x; } return surf(randUnit(r), rMin); };
  const cMax = C([0, 0, 0.15]);
  for (let i = 0; i < 18; i++) {
    const p = sampleBy((x) => (C(x) / cMax) ** 2, 0.15, 0.6);
    const sc = [C(p) / cMax, P(p), Q(p)].map((v) => v + 0.25 * r());
    const v = sc.indexOf(Math.max(...sc));
    add({ type: T.INTERO, pos: p, birthPos: surf(norm(p), 0.92), born: 0.3 + 0.3 * r(), rank: 0.5, isI: fateI(p), variable: v, deficit: r() < 0.5 + 0.4 * Math.tanh(3 * G.qFateI * (Q(p) / Qmean - 1)) });
  }
  for (let i = 0; i < 10; i++) {
    const p = sampleBy((x) => (C(x) / cMax) * Math.min(1, Q(x) / Qmean), 0.15, 0.6);
    add({ type: T.MOD, pos: p, birthPos: surf(norm(p), 0.92), born: 0.3 + 0.3 * r(), rank: 0.5, isI: false });
  }
  // soft repulsion among the migrated cells (spacing: a law of packing, not a layout)
  const mob = cells.filter((c) => c.type >= T.INTER && c.type <= T.MOD), d0 = 0.75 * Math.cbrt((4 / 3) * Math.PI * 0.6 / mob.length);
  for (let it = 0; it < 6; it++) for (let a = 0; a < mob.length; a++) for (let b = a + 1; b < mob.length; b++) {
    const pa = mob[a].pos, pb = mob[b].pos, dx = pa[0] - pb[0], dy = pa[1] - pb[1], dz = pa[2] - pb[2], d = Math.hypot(dx, dy, dz);
    if (d < d0 && d > 1e-6) { const f = 0.25 * (d0 - d) / d; pa[0] += f * dx; pa[1] += f * dy; pa[2] += f * dz; pb[0] -= f * dx; pb[1] -= f * dy; pb[2] -= f * dz; }
  }
  for (const c of mob) { const l = Math.hypot(...c.pos); if (l > 0.9) c.pos = c.pos.map((v) => v * 0.9 / l); if (l < 0.15) c.pos = c.pos.map((v) => v * 0.15 / Math.max(l, 1e-6)); }

  // ---- 5. axon growth and synapse formation -------------------------------------------------------------------------------
  const N = cells.length;
  const pos = new Float32Array(3 * N); cells.forEach((c, i) => pos.set(c.pos, 3 * i));
  const GS = 0.16, GN = Math.ceil(2 / GS) + 1, grid = new Map();
  const key = (x, y, z) => (Math.floor((x + 1) / GS) * GN + Math.floor((y + 1) / GS)) * GN + Math.floor((z + 1) / GS);
  cells.forEach((c, i) => { if (isReceptor(c.type)) return; const k = key(...c.pos); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });
  const near = (p, rad, out) => {
    out.length = 0; const cx = Math.floor((p[0] + 1) / GS), cy = Math.floor((p[1] + 1) / GS), cz = Math.floor((p[2] + 1) / GS), s = Math.ceil(rad / GS);
    for (let x = cx - s; x <= cx + s; x++) for (let y = cy - s; y <= cy + s; y++) for (let z = cz - s; z <= cz + s; z++) { const l = grid.get((x * GN + y) * GN + z); if (l) for (const i of l) out.push(i); }
    return out;
  };
  const syn = { pre: [], post: [], delay: [], t: [] }, axons = [];   // axons: { cell, pts: [x,y,z,...], t0, t1 }
  const outN = new Int32Array(N), has = new Set(), cand = [];
  const rho2 = G.capture * G.capture, nSteps = Math.max(2, Math.round(G.axonLen / STEP));
  // the motor cells' trophic field and the pull it exerts on a growth cone: its relative gradient, at most unit length
  const tropM = G.tropM || 0, motorPos = cells.filter((c) => c.type === T.MOTOR).map((c) => c.pos), il2 = 1 / (LAM_M * LAM_M);
  const motorPull = (p) => {
    let m = 0, gx = 0, gy = 0, gz = 0;
    for (const q of motorPos) { const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2], e = Math.exp(-(dx * dx + dy * dy + dz * dz) * il2); m += e; gx += 2 * il2 * e * dx; gy += 2 * il2 * e * dy; gz += 2 * il2 * e * dz; }
    const k = 1 / (m + M_FLOOR), l = Math.hypot(gx, gy, gz) * k, c = l > 1 ? k / l : k;
    return [gx * c, gy * c, gz * c];
  };
  for (const c of cells) {
    if (c.type === T.MOTOR || c.type === T.CHROM) continue;           // effector axons leave the network for the muscles
    const sensory = isReceptor(c.type);
    const radial = sensory ? G.tropRs : G.tropRi + G.tropRb * ((c.rank ?? 0.5) - 0.5) * 2;
    const tropism = (p) => {
      const u = norm(p), gp = gradDir(P, p), t = [-radial * u[0] + G.tropPi * gp[0], -radial * u[1] + G.tropPi * gp[1], -radial * u[2] + G.tropPi * gp[2]];
      if (tropM > 0) { const g = motorPull(p); t[0] += tropM * g[0]; t[1] += tropM * g[1]; t[2] += tropM * g[2]; }
      return t;
    };
    const t0 = Math.max(c.born + 0.08, sensory ? 0.55 : 0.6);
    for (let b = 0; b < 2; b++) {
      let p = c.pos.slice(), d = norm(tropism(p).map((v, a) => v + 0.6 * randUnit(r)[a]));
      const pts = [...p];
      for (let s = 1; s <= nSteps; s++) {
        const tr = tropism(p), n = randUnit(r);
        d = norm([d[0] + 0.5 * tr[0] + 0.35 * n[0], d[1] + 0.5 * tr[1] + 0.35 * n[1], d[2] + 0.5 * tr[2] + 0.35 * n[2]]);
        p = [p[0] + STEP * d[0], p[1] + STEP * d[1], p[2] + STEP * d[2]];
        const l = Math.hypot(...p), u = [p[0] / l, p[1] / l, p[2] / l];
        if (l > R_SKIN) { p = surf(u, R_SKIN); const k = dot(d, u); if (k > 0) d = norm([d[0] - 2 * k * u[0], d[1] - 2 * k * u[1], d[2] - 2 * k * u[2]]); }
        if (l < R_NUC) { p = surf(u, R_NUC); const k = dot(d, u); if (k < 0) d = norm([d[0] - 2 * k * u[0], d[1] - 2 * k * u[1], d[2] - 2 * k * u[2]]); }
        pts.push(...p);
        const ts = t0 + (0.97 - t0) * (b * 0.1 + 0.9 * s / nSteps);
        for (const j of near(p, G.capture, cand)) {
          if (j === c.id || outN[c.id] >= KMAX) continue;
          const dx = pos[3 * j] - p[0], dy = pos[3 * j + 1] - p[1], dz = pos[3 * j + 2] - p[2], d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > rho2 * 4) continue;
          const kk = c.id * N + j; if (has.has(kk)) continue;
          if (r() < G.synDensity * Math.exp(-d2 / rho2)) {
            has.add(kk); outN[c.id]++;
            syn.pre.push(c.id); syn.post.push(j); syn.delay.push(1 + Math.min(15, Math.round(s * STEP * 6))); syn.t.push(ts);
          }
        }
      }
      axons.push({ cell: c.id, pts: Float32Array.from(pts), t0, t1: 0.97 });
    }
  }

  // ---- pack ---------------------------------------------------------------------------------------------------------------
  const type = Uint8Array.from(cells, (c) => c.type), isI = Uint8Array.from(cells, (c) => (c.isI ? 1 : 0));
  const birthPos = new Float32Array(3 * N); cells.forEach((c, i) => birthPos.set(c.birthPos || c.pos, 3 * i));
  const extra = new Float32Array(N * 4);   // per type: ear unit | proprio polarity | intero variable, deficit | chrom hue
  const vec = new Float32Array(N * 6);     // motor normal and tangent
  const osc = new Float32Array(N * 2);     // resonators: natural rate (Hz, 0 = not a resonator), firing lead (s)
  cells.forEach((c, i) => {
    if (c.type === T.EAR) extra[4 * i] = c.unit;
    if (c.type === T.PROPRIO) extra[4 * i] = c.polarity;
    if (c.type === T.INTERO) { extra[4 * i] = c.variable; extra[4 * i + 1] = c.deficit ? 1 : 0; }
    if (c.type === T.CHROM) extra[4 * i] = c.hue;
    if (c.type === T.MOTOR) { vec.set(c.normal, 6 * i); vec.set(c.tangent, 6 * i + 3); }
    if (c.osc) { osc[2 * i] = c.osc.hz; osc[2 * i + 1] = c.osc.lead; }
  });
  return {
    N, genome: Float64Array.from(padGenome(genome)), seed, G, pos, birthPos, type, isI, extra, vec, osc,
    born: Float32Array.from(cells, (c) => c.born),
    syn: { pre: Int32Array.from(syn.pre), post: Int32Array.from(syn.post), delay: Uint8Array.from(syn.delay), t: Float32Array.from(syn.t) },
    axons, morph: { dP, dQ, lamP: G.lamP, lamQ: G.lamQ, lamC },
  };
}

/** a short structural fingerprint (for determinism tests) */
export function fingerprint(d) {
  let h = d.N; const f = (x) => { h = mix(h, x | 0); };
  for (let i = 0; i < d.syn.pre.length; i++) { f(d.syn.pre[i]); f(d.syn.post[i]); f(d.syn.delay[i]); }
  for (let i = 0; i < d.pos.length; i++) f(Math.round(d.pos[i] * 1e4));
  return h >>> 0;
}
