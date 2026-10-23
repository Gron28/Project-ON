// lab/organism/genome.mjs - the organism's genome: a short vector of real genes in [0, 1], each decoded into a bounded
// developmental or physiological constant. Pure module (no DOM).
//
// The genes set LAWS, never connections: where two signalling centres sit on the body and how far their morphogens reach,
// how many interneurons are born and how deep they migrate, which way axons are drawn (radial and morphogen tropism),
// how readily a passing axon makes a synapse, the E/I fate bias, plasticity rates, the neuromodulator's gain, effector
// counts, the homeostatic set point and a narrow metabolic efficiency; how far hearing spreads over the skin; how many
// interneurons become resonators and how they entrain; the eligibility span and the modulator's feel for outcomes; how
// strongly axons follow the trophic factor the motor cells release; how many clock receptors read ON's beat phase and how
// sharply each is tuned; how fast the cerebellar law corrects the brace's timing.
// Development (develop.mjs) turns them into a body.

/** seedable LCG (the repo's constants: Numerical Recipes, as in being/ear.mjs) */
export function lcg(seed) {
  let s = (seed >>> 0) || 1;
  const r = () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; };
  r.gauss = () => { const u = Math.max(1e-12, r()), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  r.int = (n) => Math.floor(r() * n);
  r.state = () => s;
  return r;
}
/** a stable integer hash for mixing seeds (xorshift-multiply) */
export function mix(a, b = 0) { let h = (a ^ Math.imul(b + 0x9e3779b9, 0x85ebca6b)) >>> 0; h = Math.imul(h ^ (h >>> 16), 0x7feb352d); h = Math.imul(h ^ (h >>> 15), 0x846ca68b); return (h ^ (h >>> 16)) >>> 0; }

// [name, lo, hi, integer?] - the bounded range of each gene
export const GENES = [
  ['pCos', -1, 1], ['pPhi', 0, 2 * Math.PI], ['lamP', 0.25, 1.2],       // morphogen P: source direction on the surface, reach
  ['qCos', -1, 1], ['qPhi', 0, 2 * Math.PI], ['lamQ', 0.25, 1.2],       // morphogen Q: source direction, reach
  ['nInter', 260, 440, true],                                            // interneurons born
  ['migDepth', 0.2, 0.6],                                                // radius the first-born migrate down to (inside-out)
  ['fracI', 0.12, 0.3], ['qFateI', -1, 1],                               // inhibitory fate share, and its bias by Q
  ['axonLen', 0.3, 1.2], ['capture', 0.08, 0.2], ['synDensity', 0.15, 0.8],   // axon reach, dendritic capture radius, synapse probability
  ['tropRs', -1, 1],                                                     // sensory axons: + grow inward, - outward
  ['tropRi', -1, 1], ['tropPi', -1, 1], ['tropRb', -1, 1],               // other axons: inward, toward P, and birth-order change of inward
  ['gI', 1, 4],                                                          // initial inhibitory / excitatory weight ratio
  ['etaH', 0, 0.02], ['etaI', 0, 0.02], ['etaS', 0, 0.2], ['pruneThr', 0.02, 0.25],   // plasticity: three-factor Hebb, iSTDP, scaling, pruning
  ['modGain', 0, 1.5],                                                   // neuromodulator: excitability and plasticity gain
  ['nMotor', 12, 28, true], ['nChrom', 16, 36, true],                    // effectors
  ['rTarget', 2, 8],                                                     // homeostatic set-point rate (Hz)
  ['tauAdapt', 0.08, 0.4],                                               // spike-frequency adaptation time constant (s)
  ['effic', 0.9, 1.1],                                                   // metabolic efficiency (narrow: no free lunch)
  // appended (older genomes keep their first 28 genes' meaning)
  ['earSpread', 0, 1],                                                   // hearing field: one placode at P (0) .. the whole skin (1)
  ['nOsc', 0, 48, true],                                                 // interneurons that become resonators (intrinsic oscillation)
  ['oscHz', 0.9, 3.2], ['oscSpread', 0, 0.6],                            // resonators' natural rate and its log spread across cells
  ['oscK', 0, 10], ['oscEta', 0, 6],                                     // resonators: phase pull and frequency learning by input
  ['oscLead', 0, 0.2], ['oscRad', -1, 1],                                // firing lead before the expected input (s); fate bias deep (+) / shallow (-)
  ['tauElig', 0.3, 2],                                                   // eligibility trace of the three-factor rule (s)
  ['modFeel', 0, 3],                                                     // modulatory cells' drive by the impact outcome (reward prediction error)
  ['tropM', 0, 1.5],                                                     // axon tropism up the motor cells' trophic field (develop.mjs)
  ['nClock', 0, 16, true], ['clockKappa', 2, 20],                        // clock receptors reading ON's beat phase (clock.mjs) and their tuning sharpness
  ['cbGain', 0, 0.03],                                                   // cerebellar timing-error law: rate of the signed brace-timing teaching (organism.mjs)
];
export const NG = GENES.length;
export const NG_LEGACY = 28;                     // genomes evolved before the hearing-field and resonator genes
export const NG_TROPHIC = 38;                    // genomes evolved before the effector-derived trophic field
export const NG_CLOCK = 39;                      // genomes evolved before the clock sense
export const NG_CB = 41;                         // genomes evolved before the cerebellar timing-error law
/** values (0..1) for the appended genes that reproduce the 28-gene organism: one ear placode (the original strip
 *  layout, see develop.mjs), no resonators, a 1 s eligibility trace, a modulator blind to impact outcomes; and (for 28-
 *  and 38-gene genomes) axons blind to the motor cells' trophic field; and (every genome evolved before the clock genes) no clock
 *  receptors; and (every genome evolved before it) no cerebellar timing-error law */
export const LEGACY_PAD = { earSpread: 0, nOsc: 0, oscHz: 0.5, oscSpread: 0, oscK: 0, oscEta: 0, oscLead: 0, oscRad: 0.5, tauElig: (1 - 0.3) / 1.7, modFeel: 0, tropM: 0, nClock: 0, clockKappa: 1 / 3, cbGain: 0 };
/** a full-length genome: a shorter (legacy) one is padded with LEGACY_PAD */
export function padGenome(g) { return g.length >= NG ? g : Float64Array.from({ length: NG }, (_, i) => (i < g.length ? g[i] : LEGACY_PAD[GENES[i][0]])); }

export function randomGenome(seed) { const r = lcg(mix(seed, 101)); return Float64Array.from({ length: NG }, () => r()); }
/** the middle of every range */
export function defaultGenome() { return new Float64Array(NG).fill(0.5); }

export function decode(g0) {
  const o = {}, g = padGenome(g0);
  o.legacy = g0.length <= NG_LEGACY;             // develop.mjs keeps the original ear placode and random sequence
  GENES.forEach(([name, lo, hi, int], i) => { const u = Math.min(1, Math.max(0, g[i])); const v = lo + (hi - lo) * u; o[name] = int ? Math.round(v) : v; });
  const dir = (c, phi) => { const s = Math.sqrt(Math.max(0, 1 - c * c)); return [s * Math.cos(phi), s * Math.sin(phi), c]; };
  o.dP = dir(o.pCos, o.pPhi); o.dQ = dir(o.qCos, o.qPhi);
  o.etaIP = 0.01;                                // intrinsic plasticity rate (network.mjs): a law, not a gene; 0 when frozen
  return o;
}

/** gaussian mutation on each gene with probability `rate`, reflected into [0, 1] */
export function mutate(g, r, rate = 0.2, sigma = 0.08) {
  const c = Float64Array.from(g);
  for (let i = 0; i < NG; i++) if (r() < rate) { let v = c[i] + sigma * r.gauss(); v = v < 0 ? -v : v > 1 ? 2 - v : v; c[i] = Math.min(1, Math.max(0, v)); }
  return c;
}
/** uniform crossover, gene by gene */
export function crossover(a, b, r) { return Float64Array.from(a, (x, i) => (r() < 0.5 ? x : b[i])); }
export const toArray = (g) => Array.from(g, (x) => +x.toFixed(6));
