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

// `wander` (0 = off, the default): the rate set point itself wanders on seconds to a minute (three Ornstein-Uhlenbeck
// processes, tau 2 / 9 / 40 s, summed to unit variance; the set point is multiplied by exp(wander * w)). Homeostasis alone
// flattens everything slower than its own time constant (~4 s), so silent activity fizzed without any slow waves; a
// wandering set point is what gives it up and down states with a 1/f-like spectrum (lab E09). It has its own random
// stream, so the main one (and everything `wander = 0` computes) is untouched.
//
// `plastic` (0 = off, the default): Hebbian plasticity on the coupling weights. A link from a cell that fired to one that
// fires next is strengthened, a link to one that stays at rest is weakened, so the sheet wears paths into itself where
// activity keeps flowing the same way. `pattern()` and `noise()` are the feedback of a closed loop, as in cultured
// cortical networks that learned to play a game when hits were answered with a predictable stimulus and misses with
// random noise (Kagan et al. 2022, free-energy principle): `pattern(k)` excites a fixed stamp of cells in band k
// (0 low, 1 mid, 2 high), the same every time; `noise()` excites as many cells at random. The page sends a pattern when
// it predicted a heard drum hit and noise when a hit took it by surprise.
export function createTissue({ earUnits = 28, rng = Math.random, seed = 99, target = 0.0035, wander = 0, plastic = 0 } = {}) {
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
  const WT = [2, 9, 40], wx = new Float64Array(3);
  let ws = (seed ^ 0x5bd1e995) | 0, wSpare = null;
  const wr = () => { ws = (Math.imul(ws, 1664525) + 1013904223) | 0; return ((ws >>> 0) + 0.5) / 4294967296; };
  const wgauss = () => { if (wSpare !== null) { const g = wSpare; wSpare = null; return g; } const r = Math.sqrt(-2 * Math.log(wr())), a = 2 * Math.PI * wr(); wSpare = r * Math.sin(a); return r * Math.cos(a); };
  let setPoint = target, stillness = 1;   // the target rate now (equals `target` unless it wanders); 1 in silence, 0 under sound
  const rowUnit = Int32Array.from({ length: TH }, (_, y) => Math.min(earUnits - 1, ((1 - (y + 0.5) / TH) * earUnits) | 0));
  // the three stamps (low rows: kick, middle: snare, top: hat), fixed by the seed; a pending stimulus for the next step
  const STAMP = 40, stamps = [];
  {
    let s = (seed ^ 0x3c6ef372) | 0; const r = () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; };
    for (const [y0, y1] of [[46, 64], [22, 40], [0, 18]]) stamps.push(Int32Array.from({ length: STAMP }, () => (y0 + ((r() * (y1 - y0)) | 0)) * TW + ((r() * TW) | 0)));
  }
  let pendStamp = -1, pendAmt = 0, pendNoise = 0;
  const w0 = plastic ? Float32Array.from(wnb) : null;   // the weights it was born with
  const excite = (j, list, n) => { if (st[j] === 0 && !mark[j]) { mark[j] = 1; list[n++] = j; } return n; };

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
    if (pendStamp >= 0) { const sp = stamps[pendStamp]; for (let c = 0; c < STAMP; c++) if (pendAmt >= 1 || rng() < pendAmt) nNext = excite(sp[c], nx, nNext); pendStamp = -1; }
    if (pendNoise > 0) { for (let c = 0; c < pendNoise; c++) nNext = excite((rng() * NT) | 0, nx, nNext); pendNoise = 0; }
    if (plastic) {
      // spike-timing dependent: a link whose target fires right after its source grows, one whose target fired right
      // before shrinks (Bi & Poo 1998); every use also drifts it back toward where it was born, so only paths that keep
      // being used the same way stay worn
      for (let a = 0; a < nExc; a++) {
        const i = exc[a];
        for (let e = 0; e < NB; e++) {
          const k = i * NB + e, j = nb[k];
          if (mark[j]) wnb[k] += plastic * (1 - wnb[k]);
          else if (st[j] === 2) wnb[k] -= plastic * wnb[k];
          wnb[k] += plastic * 0.05 * (w0[k] - wnb[k]);
        }
      }
    }
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
    if (wander) {
      // it wanders only in silence (the ear drives no cell), over ~2 s in and out, so music is never pushed around by it
      let d = 0; if (drive) for (let k = 0; k < drive.length; k++) d += drive[k];
      stillness += ((d < 2e-3 ? 1 : 0) - stillness) * 0.002;
      let w = 0; for (let i = 0; i < 3; i++) { wx[i] += -wx[i] * 0.004 / WT[i] + Math.sqrt(2 * 0.004 / WT[i]) * wgauss(); w += wx[i]; }
      setPoint = target * Math.exp(wander * stillness * w / Math.sqrt(3));
    }
    G *= Math.exp(0.0025 * (setPoint - act) / setPoint);                  // rate homeostasis, tau ~ 4 s
    if (G < 0.05) G = 0.05; if (G > 0.25) G = 0.25;
    if (prevExc > 0) { brSum += nExc / prevExc; brN++; }
    prevExc = nExc;
    for (let a = 0; a < nExc; a++) { const j = exc[a]; trace[j] += 0.25; memory[j] += 0.01; }
    return nExc;   // the cells that fired this step (lab: avalanche and complexity measures)
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
  return {
    step, render, kick: (a) => { kickBurst = Math.max(kickBurst, a); }, get sigma() { return G * NB * 0.5; }, get activity() { return actEMA; },
    /** predictable feedback: stamp k (0 low, 1 mid, 2 high) at strength 0..1, on the next step */
    pattern(k, amount = 1) { if (k >= 0 && k < 3) { pendStamp = k | 0; pendAmt = Math.max(0, Math.min(1, +amount || 0)); } },
    /** unpredictable feedback: as many cells as a full stamp times amount, anywhere, on the next step */
    noise(amount = 1) { pendNoise = Math.min(STAMP * 2, Math.round(STAMP * Math.max(0, +amount || 0))); },
    weights: wnb, neighbours: nb, stamps,   // lab
  };
}
