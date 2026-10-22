// lab/organism/milieu.mjs - the organism's essential variables (Ashby 1952: the homeostat; Damasio 1999; Keramati &
// Gutkin 2014: homeostatic reinforcement). Pure module (no DOM).
//
// Three variables, each 0..1, each with a bound beyond which the organism dies:
//   energy       basal income, minus the cost of every spike of the nervous system (Laughlin & Sejnowski 2003; receptor
//                cells' firing is not charged: sensory transduction runs on the sense organ's own supply, as the cochlea's on
//                the stria vascularis, so loud sound is not a drain the network cannot control), of keeping synapses, of moving
//                and of repair. At each impact (a sensory event, brace.mjs) income is paid for inhibition that was
//                already waiting for it 20-60 ms before (network.mjs anticipation: predicted in advance, chance-corrected,
//                so a reaction earns nothing; paid on its running mean over the last ~4 impacts, so chance
//                fluctuations average down; a reactive network whose inhibition decays before each beat is not
//                fined, it simply earns nothing), and the unbraced share of the impact costs energy. Death below 0.02.
//   integrity    damaged by unbraced impacts (brace.mjs), runaway firing (excitotoxicity), by body strain beyond what the tissue bears, and by energy
//                starvation; repaired slowly, faster when the network is quiet, at an energy price. Death below 0.05.
//   stimulation  a need: it rises on its own (tau ~2 min) and is fed 70% by sensory novelty (adapting hair cells, onsets)
//                and 30% by trophic use (the share of synapses whose presynaptic cell is active): silence and a silent
//                network both starve it. Unused synapses also atrophy (network.mjs), so starvation has a structural cost.
// Reward prediction error: each impact's outcome (anticipation income minus the impact's cost) against the running
// mean outcome of impacts (Schultz et al. 1997); a phasic signal (tau 0.25 s) that the modulatory cells feel.
// Viability = half the worst margin plus half the mean margin. Valence is its rate of change (Joffily & Coricelli 2013),
// a readout for the view; arousal is read from the network's modulator. Neither drives anything.

import { impactCost } from './brace.mjs';
const c01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

export const MILIEU = {
  income: 0.004, anticIncome: 0.004, costSpike: 0.0011, costSyn: 0.00012, costMotor: 0.004, costChrom: 0.001,
  repairRate: 1 / 120, repairCost: 0.5, riotHz: 25, riotDamage: 0.02, strainBear: 0.06, strainDamage: 2,
  needRise: 120, needFeed: 10, restHz: 2,
};

export function createMilieu(G, P = MILIEU) {
  const s = { energy: 0.8, integrity: 0.9, need: 0.3, viability: 0, valence: 0, alive: true, income: 0, cost: 0, predShare: 0, predFrac: 0, damage: 0, repair: 0,
    rpe: 0, events: 0, anticIncome: 0, impactLoss: 0, lastImpact: null };
  let vSlow = null, vPrev = null, dVs = 0, antic = 0, outBase = 0, outDev = 1e-3, incE = 0, allE = 0;
  const eff = G.effic;
  function margins() { return [s.energy, s.integrity, 1 - s.need]; }
  function viab() { const m = margins(); return 0.5 * Math.min(...m) + 0.5 * (m[0] + m[1] + m[2]) / 3; }
  s.viability = viab();

  /** inp: { dt, rateHz (spikes of non-receptor cells per cell of the body, Hz), interHz (interneurons), motor, chrom, synMass (sum w / N), strain, stim,
   *  impact: null or { a (0..1), p (protection 0..1), A (anticipation) } } */
  function update(inp) {
    const dt = inp.dt; if (!s.alive) return s;
    s.rpe *= Math.exp(-dt / 0.25);
    let lumpE = 0, lumpI = 0, gain = 0;
    if (inp.impact) {
      const { a, p, A } = inp.impact, c = impactCost(a, p);
      antic += 0.25 * (Math.max(-1, Math.min(1, A)) - antic);       // over the last ~4 impacts: one lucky event pays little
      gain = P.anticIncome * a * c01(antic); lumpE = gain - c.dE / eff; lumpI = -c.dI;
      const outcome = gain - c.dE - c.dI;                          // in energy-equivalent units
      const d = outcome - outBase; s.rpe = Math.max(-1, Math.min(1, d / (3 * outDev)));
      outBase += 0.1 * d; outDev += 0.05 * (Math.abs(d) - outDev); if (outDev < 1e-5) outDev = 1e-5;
      s.predFrac += 0.1 * (A - s.predFrac); s.events++; s.anticIncome += gain; s.impactLoss += c.dE + c.dI;
      s.lastImpact = { a, p, A, gain, cost: c.dE + c.dI };
    }
    const k = 1 - Math.exp(-dt / 10); incE += k * (gain / dt - incE); allE += k * (P.income * eff + gain / dt - allE);
    const income = P.income * eff;
    const rest = c01(1 - inp.interHz / P.restHz);
    const repair = P.repairRate * (1 - s.integrity) * (1 + 3 * rest) * c01(s.energy / 0.2);
    const cost = (P.costSpike * inp.rateHz + P.costSyn * inp.synMass + P.costMotor * inp.motor + P.costChrom * inp.chrom) / eff + P.repairCost * repair;
    const riot = Math.max(0, inp.interHz / P.riotHz - 1), strain = Math.max(0, inp.strain - P.strainBear);
    const damage = P.riotDamage * riot * riot + P.strainDamage * strain * strain + (s.energy < 0.1 ? 0.01 * (0.1 - s.energy) / 0.1 : 0);
    s.energy = c01(s.energy + dt * (income - cost) + lumpE);
    s.integrity = c01(s.integrity + dt * (repair - damage) + lumpI);
    s.need = c01(s.need + dt * ((1 - s.need) / P.needRise - s.need * inp.stim / P.needFeed));
    s.income = income + gain / dt; s.cost = cost; s.predShare = allE > 0 ? incE / allE : 0; s.damage = damage; s.repair = repair;
    const V = viab(); s.viability = V;
    vSlow = vSlow === null ? V : vSlow + (dt / 2) * (V - vSlow);
    const dV = vPrev === null ? 0 : (vSlow - vPrev) / dt; vPrev = vSlow;
    dVs += (dt / 3) * (dV - dVs);                               // the rate of change, smoothed over ~3 s
    s.valence = Math.max(-1, Math.min(1, 150 * dVs));
    if (s.energy < 0.02 || s.integrity < 0.05) s.alive = false;
    return s;
  }
  return { s, update, margins, serialize: () => ({ ...s, vSlow, vPrev, antic, outBase, outDev, incE, allE }), restore: (o) => { Object.assign(s, o); vSlow = o.vSlow; vPrev = o.vPrev; antic = o.antic ?? 0; outBase = o.outBase; outDev = o.outDev; incE = o.incE; allE = o.allE; } };
}
