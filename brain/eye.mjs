// eye.mjs - from the picture on screen to photoreceptor spike rates.
//
// The fly watches its own visuals. FlyWire contains the photoreceptor axons (R1-6, R7, R8: ~11k) whose
// terminals in the lamina / medulla keep the retina's map: neighbours in the eye are neighbours in
// the brain. So each photoreceptor's position, projected onto the plane that best fits its eye,
// gives it a place in the visual field. The renderer sends a small luminance image (EYE_W x EYE_H)
// of the frame every ~16 ms; every photoreceptor samples it at its own place (left eye sees the
// left half, right eye the right half) and fires a Poisson rate that grows with brightness and,
// much more, with change (photoreceptors are high-pass: steady light adapts away in ~100 ms).

export const EYE_W = 48, EYE_H = 27;

/** @param {Float32Array} pos  N*3 positions (um) @param {Int8Array} side @param {Uint32Array} ids photoreceptor indices */
export function createEye(pos, side, ids, { maxHz = 120, seed = 5 } = {}) {
  const n = ids.length;
  const u = new Float32Array(n), v = new Float32Array(n), eye = new Int8Array(n);
  // fit a plane per eye (PCA of the positions), the two main axes become the image axes
  for (const s of [-1, 1]) {
    const members = [];
    for (let k = 0; k < n; k++) if ((side[ids[k]] || 1) === s) members.push(k);
    if (!members.length) continue;
    const m = [0, 0, 0];
    for (const k of members) { const i = ids[k] * 3; m[0] += pos[i]; m[1] += pos[i + 1]; m[2] += pos[i + 2]; }
    m[0] /= members.length; m[1] /= members.length; m[2] /= members.length;
    const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const k of members) {
      const i = ids[k] * 3, d = [pos[i] - m[0], pos[i + 1] - m[1], pos[i + 2] - m[2]];
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a][b] += d[a] * d[b];
    }
    const e1 = powerIter(C, [1, 0.3, 0.2]);
    const e2 = powerIter(deflate(C, e1), [0.2, 1, 0.3]);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const k of members) {
      const i = ids[k] * 3, d = [pos[i] - m[0], pos[i + 1] - m[1], pos[i + 2] - m[2]];
      u[k] = d[0] * e1[0] + d[1] * e1[1] + d[2] * e1[2];
      v[k] = d[0] * e2[0] + d[1] * e2[1] + d[2] * e2[2];
      if (u[k] < minU) minU = u[k]; if (u[k] > maxU) maxU = u[k]; if (v[k] < minV) minV = v[k]; if (v[k] > maxV) maxV = v[k];
    }
    // normalise to the eye's half of the screen (left eye -> left half); flip so that dorsal is up is unknowable here, keep as is
    for (const k of members) {
      const uu = (u[k] - minU) / (maxU - minU + 1e-6), vv = (v[k] - minV) / (maxV - minV + 1e-6);
      u[k] = s < 0 ? uu * 0.5 : 0.5 + uu * 0.5;
      v[k] = vv;
      eye[k] = s;
    }
  }
  const px = new Uint16Array(n); // pixel index into the EYE_W x EYE_H image
  for (let k = 0; k < n; k++) px[k] = Math.min(EYE_H - 1, (v[k] * EYE_H) | 0) * EYE_W + Math.min(EYE_W - 1, (u[k] * EYE_W) | 0);
  const adapted = new Float32Array(n); // slow adaptation state per receptor
  const rates = new Float32Array(n);
  let s = seed | 0;
  const gain = new Float32Array(n);
  for (let k = 0; k < n; k++) { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; gain[k] = 0.7 + 0.6 * (((t ^ (t >>> 14)) >>> 0) / 4294967296); }
  const adaptK = 1 - Math.exp(-16 / 150); // per frame (~16 ms), 150 ms adaptation
  return {
    ids, rates, u, v, eye, px, n,
    /** @param {Uint8Array} img  EYE_W*EYE_H luminance 0..255 */
    see(img) {
      for (let k = 0; k < n; k++) {
        const L = img[px[k]] / 255;
        const d = L - adapted[k];
        adapted[k] += adaptK * d;
        const x = 0.15 * L + 1.2 * Math.abs(d) * 4;
        rates[k] = maxHz * gain[k] * (x / (1 + x));
      }
    },
  };
}

function powerIter(C, v) {
  for (let it = 0; it < 50; it++) {
    const w = [0, 0, 0];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) w[a] += C[a][b] * v[b];
    const l = Math.hypot(w[0], w[1], w[2]) || 1;
    v = [w[0] / l, w[1] / l, w[2] / l];
  }
  return v;
}
function deflate(C, e) {
  let l = 0;
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) l += e[a] * C[a][b] * e[b];
  return C.map((row, a) => row.map((x, b) => x - l * e[a] * e[b]));
}
