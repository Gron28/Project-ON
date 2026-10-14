// being/tissue.mjs - the being's nervous tissue: an excitable sheet wrapped around its body. Pure module.
//
// Kinouchi & Copelli 2006 (replicated in lab E04): cells are resting / excited / refractory (5 states), each coupled to
// 8 neighbours plus 2 long-range partners. Coupling strength follows rate homeostasis (Zierenberg, Wilting & Priesemann
// 2018): it rises when the tissue is quiet and falls when it is busy. The branching ratio therefore settles at
// m ~ 1 - h/r*: input-driven under loud music, drifting to criticality (avalanches, "dreaming") in silence.
// The ear drives it tonotopically: low frequencies at the bottom of the body (texture row 63), high at the top (row 0).
//
// Texture (RGBA8, wraps in x): R = recent activity trace (0.3 baseline raises the metal), G = cells firing now,
// B = slow memory of where it has been active.

export const TW = 128, TH = 64;

export function createTissue({ earUnits = 28, rng = Math.random, seed = 99, target = 0.0035 } = {}) {
  const NT = TW * TH, NSTATE = 5, LR = 2, NB = 8 + LR;
  const nb = new Int32Array(NT * NB), wnb = new Float32Array(NT * NB);
  {
    let s = seed; const r = () => { s = (Math.imul(s, 1103515245) + 12345) | 0; return (s >>> 0) / 4294967296; };
    for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
      const i = y * TW + x; let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const yy = Math.min(TH - 1, Math.max(0, y + dy)), xx = (x + dx + TW) % TW;
        nb[i * NB + n] = yy * TW + xx; wnb[i * NB + n] = r(); n++;
      }
      for (let k = 0; k < LR; k++) { nb[i * NB + n] = (r() * NT) | 0; wnb[i * NB + n] = r(); n++; }
    }
  }
  const st = new Uint8Array(NT), mark = new Uint8Array(NT);
  // the cells that are not at rest are kept in lists by state (exc: 1, ref1: 2, ref2: 3, ref3: 4), so a step touches only those
  // (about a hundred) instead of aging all 8192 cells
  let exc = new Int32Array(NT), nx = new Int32Array(NT), nExc = 0;
  let ref1 = new Int32Array(NT), ref2 = new Int32Array(NT), ref3 = new Int32Array(NT), spare = new Int32Array(NT), n1 = 0, n2 = 0, n3 = 0;   // states 2, 3, 4
  const trace = new Float32Array(NT), flash = new Float32Array(NT), memory = new Float32Array(NT);
  let G = 0.16;                    // coupling scale: sigma ~ G * NB * 0.5
  let actEMA = target, prevExc = 0, brSum = 0, brN = 0, branching = 1, kickBurst = 0;
  const rowUnit = Int32Array.from({ length: TH }, (_, y) => Math.min(earUnits - 1, ((1 - (y + 0.5) / TH) * earUnits) | 0));

  /** one 4 ms step. drive[k] = excitation probability per cell and step for the rows of ear unit k */
  function step(drive) {
    let nNext = 0;
    for (let a = 0; a < nExc; a++) {
      const i = exc[a];
      for (let e = 0; e < NB; e++) {
        const j = nb[i * NB + e];
        if (st[j] === 0 && !mark[j] && rng() < G * wnb[i * NB + e]) { mark[j] = 1; nx[nNext++] = j; }
      }
    }
    for (let y = 0; y < TH; y++) {
      const eta = (drive ? drive[rowUnit[y]] : 0) + 0.00003 + kickBurst * (y > TH * 0.55 ? 0.05 : 0.01);
      if (eta <= 0) continue;
      const m = eta * TW; let cnt = Math.floor(m); if (rng() < m - cnt) cnt++;
      for (let c = 0; c < cnt; c++) { const j = y * TW + ((rng() * TW) | 0); if (st[j] === 0 && !mark[j]) { mark[j] = 1; nx[nNext++] = j; } }
    }
    kickBurst *= 0.6;
    // age every non-resting cell one state: 4 -> 0, 3 -> 4, 2 -> 3, 1 -> 2 (the lists hold exactly the cells in states 4, 3, 2, 1)
    for (let a = 0; a < n3; a++) st[ref3[a]] = 0;
    for (let a = 0; a < n2; a++) st[ref2[a]] = 4;
    for (let a = 0; a < n1; a++) st[ref1[a]] = 3;
    for (let a = 0; a < nExc; a++) st[exc[a]] = 2;
    { const old3 = ref3; ref3 = ref2; n3 = n2; ref2 = ref1; n2 = n1; ref1 = spare; spare = old3; n1 = 0; }
    for (let a = 0; a < nExc; a++) ref1[a] = exc[a];
    n1 = nExc;
    for (let a = 0; a < nNext; a++) { const j = nx[a]; st[j] = 1; mark[j] = 0; flash[j] = 1; }
    const t = exc; exc = nx; nx = t; nExc = nNext;
    const act = nExc / NT;
    actEMA += 0.004 * (act - actEMA);
    G *= Math.exp(0.0025 * (target - act) / target);                      // rate homeostasis, tau ~ 4 s
    if (G < 0.05) G = 0.05; if (G > 0.25) G = 0.25;
    if (prevExc > 0) { brSum += nExc / prevExc; brN++; }
    prevExc = nExc;
    for (let a = 0; a < nExc; a++) { const j = exc[a]; trace[j] += 0.25; memory[j] += 0.01; }
  }
  const tex = new Uint8Array(NT * 4);
  /** decay the traces one display frame (~33 ms) and return the texture plus statistics */
  function render() {
    for (let j = 0; j < NT; j++) {
      trace[j] *= 0.9; flash[j] *= 0.55; memory[j] *= 0.995;
      tex[j * 4] = Math.min(1, 0.3 + trace[j] * 0.7) * 255; tex[j * 4 + 1] = Math.min(1, flash[j]) * 255;
      tex[j * 4 + 2] = Math.min(1, memory[j] * 4) * 255; tex[j * 4 + 3] = 255;
    }
    if (brN > 0) { branching += 0.2 * (brSum / brN - branching); brSum = 0; brN = 0; }
    return { tex, act: actEMA, sigma: G * NB * 0.5, branching };
  }
  return { step, render, kick: (a) => { kickBurst = Math.max(kickBurst, a); }, get sigma() { return G * NB * 0.5; }, get activity() { return actEMA; } };
}
