// lab/organism/milieu.mjs - the organism's essential variables (Ashby 1952: the homeostat; Damasio 1999; Keramati &
// Gutkin 2014: homeostatic reinforcement). Pure module (no DOM).
//
// Three variables, each 0..1, each with a bound beyond which the organism dies:
//   energy       basal income, minus the cost of every spike (Laughlin & Sejnowski 2003), of keeping synapses, of moving
//                and of repair. Income rises when sensory input arrives already cancelled by timed inhibition (the
//                network predicted it): structure nourishes, noise only costs. Death below 0.02.
//   integrity    damaged by runaway firing (excitotoxicity), by body strain beyond what the tissue bears, and by energy
//                starvation; repaired slowly, faster when the network is quiet, at an energy price. Death below 0.05.
//   stimulation  a need: it rises on its own (tau ~2 min) and is fed 70% by sensory novelty (adapting hair cells, onsets)
//                and 30% by trophic use (the share of synapses whose presynaptic cell is active): silence and a silent
//                network both starve it. Unused synapses also atrophy (network.mjs), so starvation has a structural cost.
// Viability = half the worst margin plus half the mean margin. Valence is its rate of change (Joffily & Coricelli 2013),
// a readout for the view; arousal is read from the network's modulator. Neither drives anything.

const c01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

export const MILIEU = {
  income: 0.004, predIncome: 0.006, costSpike: 0.0011, costSyn: 0.00012, costMotor: 0.004, costChrom: 0.001,
  repairRate: 1 / 120, repairCost: 0.5, riotHz: 25, riotDamage: 0.02, strainBear: 0.06, strainDamage: 2,
  needRise: 120, needFeed: 10, restHz: 2,
};

export function createMilieu(G, P = MILIEU) {
  const s = { energy: 0.8, integrity: 0.9, need: 0.3, viability: 0, valence: 0, alive: true, income: 0, cost: 0, predShare: 0, predFrac: 0, damage: 0, repair: 0 };
  let vSlow = null, vPrev = null, dVs = 0, credE = 0, normE = 0, sinE = 0;
  const eff = G.effic;
  function margins() { return [s.energy, s.integrity, 1 - s.need]; }
  function viab() { const m = margins(); return 0.5 * Math.min(...m) + 0.5 * (m[0] + m[1] + m[2]) / 3; }
  s.viability = viab();

  /** inp: { dt, rateHz (all cells), interHz (interneurons), credit, creditNorm, sensoryIn (per step), motor, chrom, synMass (sum w / N), strain, stim } */
  function update(inp) {
    const dt = inp.dt; if (!s.alive) return s;
    const k = 1 - Math.exp(-dt / 1); credE += k * (inp.credit - credE); normE += k * (inp.creditNorm - normE); sinE += k * (inp.sensoryIn - sinE);
    s.predFrac = normE > 1e-6 ? credE / normE : 0;             // signed: > 0 when inhibition arrives with the input more than by chance
    const drive = c01(sinE / 2);                                   // how much sensory input there was to predict
    const incomePred = P.predIncome * Math.max(0, s.predFrac) * drive;
    const income = P.income * eff + incomePred;
    const rest = c01(1 - inp.interHz / P.restHz);
    const repair = P.repairRate * (1 - s.integrity) * (1 + 3 * rest) * c01(s.energy / 0.2);
    const cost = (P.costSpike * inp.rateHz + P.costSyn * inp.synMass + P.costMotor * inp.motor + P.costChrom * inp.chrom) / eff + P.repairCost * repair;
    const riot = Math.max(0, inp.interHz / P.riotHz - 1), strain = Math.max(0, inp.strain - P.strainBear);
    const damage = P.riotDamage * riot * riot + P.strainDamage * strain * strain + (s.energy < 0.1 ? 0.01 * (0.1 - s.energy) / 0.1 : 0);
    s.energy = c01(s.energy + dt * (income - cost));
    s.integrity = c01(s.integrity + dt * (repair - damage));
    s.need = c01(s.need + dt * ((1 - s.need) / P.needRise - s.need * inp.stim / P.needFeed));
    s.income = income; s.cost = cost; s.predShare = income > 0 ? incomePred / income : 0; s.damage = damage; s.repair = repair;
    const V = viab(); s.viability = V;
    vSlow = vSlow === null ? V : vSlow + (dt / 2) * (V - vSlow);
    const dV = vPrev === null ? 0 : (vSlow - vPrev) / dt; vPrev = vSlow;
    dVs += (dt / 3) * (dV - dVs);                               // the rate of change, smoothed over ~3 s
    s.valence = Math.max(-1, Math.min(1, 150 * dVs));
    if (s.energy < 0.02 || s.integrity < 0.05) s.alive = false;
    return s;
  }
  return { s, update, margins, serialize: () => ({ ...s, vSlow, vPrev, credE, normE, sinE }), restore: (o) => { Object.assign(s, o); vSlow = o.vSlow; vPrev = o.vPrev; credE = o.credE; normE = o.normE; sinE = o.sinE; } };
}
