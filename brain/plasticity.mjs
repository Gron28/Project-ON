// plasticity.mjs - how the brain forms a taste.
//
// Dopamine is the fly's teaching signal. PAM neurons signal reward, PPL1 neurons punishment
// (Aso et al. 2014 eLife, "Mushroom body output neurons encode valence"), and dopamine released
// onto a synapse whose presynaptic neuron was just active depresses it (Hige et al. 2015 Neuron:
// active-then-dopamine -> depression). The classic site is Kenyon cell -> MBON, but sound barely
// reaches the Kenyon cells in this wiring, so the same three-factor rule is applied to every synapse
// onto the neurons that decide what the fly does: the MBONs (valence) and the descending neurons
// (behaviour). Any presynaptic neuron whose activity preceded dopamine gets its synapses onto those
// targets depressed; synapses onto avoid-type MBONs by reward, onto approach-type MBONs and onto
// descending neurons by punishment. Weights recover towards the connectome over ~10 minutes, so
// nothing is permanent and the connectome itself is never edited.
//
// The dopamine signals come from the simulated PAM / PPL1 populations themselves (the brain's own
// evaluation of what it hears and sees) plus whatever the listener injects with love / not-this.

export function createPlasticity(brain, fly, { eta = 0.004, tauElig = 1500, tauRecover = 600000, floor = 0.15 } = {}) {
  const { rowPtr, col, groups, N } = brain;
  // target class per neuron: 1 avoid-MBON, 2 approach-MBON, 3 descending
  const target = new Uint8Array(N);
  for (const i of groups['MBON-avoid'] || []) target[i] = 1;
  for (const i of groups['MBON-approach'] || []) target[i] = 2;
  for (const i of groups['DN'] || []) target[i] = 3;
  // plastic edges: all connections onto those targets
  const edges = [], pre = [];
  for (let i = 0; i < N; i++) for (let e = rowPtr[i]; e < rowPtr[i + 1]; e++) if (target[col[e]]) { edges.push(e); pre.push(i); }
  const E = edges.length;
  const edgeArr = Uint32Array.from(edges), preArr = Uint32Array.from(pre);
  const base = new Float32Array(E);
  for (let k = 0; k < E; k++) base[k] = fly.wmv[edgeArr[k]];
  const tclass = new Uint8Array(E);
  for (let k = 0; k < E; k++) tclass[k] = target[col[edgeArr[k]]];
  const elig = new Float32Array(N); // presynaptic eligibility (low-passed spikes)
  const lastCount = new Uint32Array(N);
  let reward = 0, punish = 0; // smoothed dopamine (Hz above baseline)
  const stats = { edges: E, meanAvoid: 1, meanApproach: 1, meanDN: 1, reward: 0, punish: 0 };

  return {
    stats, elig,
    /** Call every `dtMs` of brain time (10 ms is fine). `phasicReward` / `phasicPunish` are dopamine rates (Hz) above what is
     *  usual for this brain lately, plus anything injected: only surprising dopamine teaches (Bennett 2021, prediction error). */
    update(dtMs, phasicReward = 0, phasicPunish = 0) {
      const dE = Math.exp(-dtMs / tauElig);
      const sc = fly.spikeCount;
      for (let k = 0; k < E; k++) { const i = preArr[k]; elig[i] = elig[i] * dE + (sc[i] - lastCount[i]); lastCount[i] = sc[i]; }
      for (let k = 0; k < E; k++) lastCount[preArr[k]] = sc[preArr[k]];
      const kDA = 1 - Math.exp(-dtMs / 200);
      reward += kDA * (phasicReward - reward); punish += kDA * (phasicPunish - punish);
      stats.reward = reward; stats.punish = punish;
      const r = Math.max(0, reward) * 0.02, p = Math.max(0, punish) * 0.01;
      const rec = dtMs / tauRecover;
      const w = fly.wmv;
      let sA = 0, nA = 0, sP = 0, nP = 0, sD = 0, nD = 0;
      for (let k = 0; k < E; k++) {
        const e = edgeArr[k], b = base[k];
        let x = w[e];
        const da = tclass[k] === 1 ? r : tclass[k] === 2 ? p : p * 0.5;
        if (da > 0) { const el = elig[preArr[k]]; if (el > 0) x -= eta * da * Math.min(1, el / 20) * x; }
        x += (b - x) * rec; // recovery
        // never below floor * base (same sign), never above base
        const lo = b * floor;
        if (b > 0) { if (x < lo) x = lo; if (x > b) x = b; } else { if (x > lo) x = lo; if (x < b) x = b; }
        w[e] = x;
        const f = b !== 0 ? x / b : 1;
        if (tclass[k] === 1) { sA += f; nA++; } else if (tclass[k] === 2) { sP += f; nP++; } else { sD += f; nD++; }
      }
      stats.meanAvoid = nA ? sA / nA : 1; stats.meanApproach = nP ? sP / nP : 1; stats.meanDN = nD ? sD / nD : 1;
    },
  };
}
