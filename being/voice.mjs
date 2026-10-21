// being/voice.mjs - what the being can sing from: its memory of its own senses. Pure module (no DOM, no audio).
//
// It never stores sound. What it keeps is how its ear felt the sound (the 28 hair-cell bands, onset, roughness,
// sub-bass), so whatever it sings is a ghost made from its senses, in its own voice:
//   sketches   a few seconds of its ear around moments it loved (chills, a dopamine peak, the listener's "love"),
//              kept per song; like a songbird's remembered tutor song, replayed later (Dave & Margoliash 2000)
//   love       how much it liked each patch of its song map (hits weighted by reward), so babbling wanders where it
//              was happy (rewarded replay; Ambrose et al. 2016)
//   chroma     the song's pitch classes as its ear folded them, so a later voice can sing in the song's key
//   decode     a map unit (featureOf, memory.mjs) back into band levels: the normalisation is invertible
// See lab/research/voice.md.

import { MW, MH, NU, DIM } from './memory.mjs';

export const NB = 28, FPS = 50, PRE = 4, POST = 2, MAX_SKETCHES = 4;
const FRAME = NB + 4;   // bands, level, onset, roughness, sub-bass (uint8 each)
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const q8 = (x) => Math.round(clamp01(x) * 255);

/** an ear frame (ear.mjs) -> FRAME bytes: bands as log levels against a fixed scale (so loud stays loud), extras 0..1 */
export function packFrame(ear, out, o = 0) {
  for (let k = 0; k < NB; k++) out[o + k] = q8(Math.log1p((ear.amp[k] || 0) / 0.015) / 4);
  out[o + NB] = q8((ear.level || 0) * 8); out[o + NB + 1] = q8((ear.onset || 0) / 1.5); out[o + NB + 2] = q8((ear.rough || 0) * 2.5); out[o + NB + 3] = q8((ear.sub || 0) * 6);
  return out;
}
/** FRAME bytes -> { bands: 0..1 log levels, level, onset, rough, sub } */
export function unpackFrame(buf, o = 0, out = { bands: new Float32Array(NB), level: 0, onset: 0, rough: 0, sub: 0 }) {
  for (let k = 0; k < NB; k++) out.bands[k] = buf[o + k] / 255;
  out.level = buf[o + NB] / 255; out.onset = buf[o + NB + 1] / 255; out.rough = buf[o + NB + 2] / 255; out.sub = buf[o + NB + 3] / 255;
  return out;
}

/**
 * a ring buffer of its ear (FPS frames/s, PRE s); capture() keeps PRE s before and POST s after a moment
 */
export function createSketcher() {
  const len = FPS * (PRE + POST), ring = new Uint8Array(len * FRAME);
  let n = 0;
  const pending = [];   // { reason, score, startN, meta }
  return {
    push(ear) {
      packFrame(ear, ring, (n % len) * FRAME); n++;
      const done = [];
      for (let i = pending.length - 1; i >= 0; i--) if (n - pending[i].startN >= len) done.push(...pending.splice(i, 1));
      return done.map((p) => {
        const frames = new Uint8Array(len * FRAME);
        for (let f = 0; f < len; f++) frames.set(ring.subarray(((p.startN + f) % len) * FRAME, ((p.startN + f) % len + 1) * FRAME), f * FRAME);
        return { v: 1, reason: p.reason, score: p.score, at: p.at, fps: FPS, frames: toB64(frames), ...p.meta };
      });
    },
    /** keep this moment (once POST s have passed, push() returns it) */
    capture(reason, score = 1, meta = {}) {
      if (n < FPS * PRE || pending.some((p) => n - (p.startN + FPS * PRE) < FPS * 3)) return false;   // too early, or one is already being kept
      pending.push({ reason, score, startN: n - FPS * PRE, at: Date.now(), meta }); return true;
    },
    get frames() { return n; },
  };
}
/** keep the best MAX_SKETCHES of a song (higher score wins; a tie keeps the newer) */
export function keepSketch(list, s) {
  const out = (Array.isArray(list) ? list.filter(validSketch) : []).concat(validSketch(s) ? [s] : []);
  out.sort((a, b) => b.score - a.score || b.at - a.at);
  return out.slice(0, MAX_SKETCHES);
}
export function validSketch(s) { return !!(s && s.v === 1 && typeof s.frames === 'string' && Number.isFinite(s.score) && s.fps > 0); }
export function sketchFrames(s) { return validSketch(s) ? fromB64(s.frames) : null; }

/** the love map: how much each patch of the song map was heard while it felt good */
export function loveUpdate(love, bmu, reward, rate = 0.02) {
  if (!(love instanceof Float32Array) || love.length !== NU || bmu < 0 || bmu >= NU || !Number.isFinite(reward)) return love;
  const r = Math.max(0, reward);
  love[bmu] += rate * r;
  if (r > 0) { const x = bmu % MW, y = (bmu / MW) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = (x + dx + MW) % MW, yy = y + dy; if (yy >= 0 && yy < MH) love[yy * MW + xx] += rate * r * 0.4; } }
  return love;
}

/** a map unit's prototype (featureOf, memory.mjs) back to band levels (0..1 log, same scale as packFrame) and extras */
export function decodeUnit(weights, unit, out = { bands: new Float32Array(NB), level: 0, onset: 0, rough: 0, sub: 0 }) {
  const o = unit * DIM;
  let m = 0; for (let k = 0; k < NB; k++) m += weights[o + k]; m /= NB;
  // featureOf: out_k = a_k / (mx + .3), out28 = mean(a) / 4  =>  mx + .3 = 4 out28 / mean(out_k),  a_k = out_k (mx + .3)
  const scale = m > 1e-4 ? (4 * weights[o + 28]) / m : 0;
  for (let k = 0; k < NB; k++) out.bands[k] = clamp01((weights[o + k] * scale) / 4);
  out.level = clamp01(weights[o + 28] * 2); out.onset = weights[o + 29]; out.rough = weights[o + 30]; out.sub = weights[o + 31];
  return out;
}

/** a babbling walk over the map: neighbouring steps, drawn to what it loved and to what the song often was */
export function babbleStep(unit, love, hits, rnd = Math.random) {
  const x = unit % MW, y = (unit / MW) | 0, cand = [];
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    if (!dx && !dy) continue;
    const yy = y + dy; if (yy < 0 || yy >= MH) continue;
    const u = yy * MW + ((x + dx + MW) % MW);
    cand.push([u, 0.05 + (love ? love[u] : 0) * 4 + (hits ? Math.min(1, hits[u] * 50) : 0)]);
  }
  let sum = 0; for (const c of cand) sum += c[1];
  let t = rnd() * sum; for (const [u, w] of cand) { t -= w; if (t <= 0) return u; }
  return cand.length ? cand[cand.length - 1][0] : unit;
}
/** where to start singing: its most-loved unit (else the most-heard) */
export function favouriteUnit(love, hits) {
  let best = 0, bv = -1;
  for (let u = 0; u < NU; u++) { const v = (love ? love[u] : 0) * 4 + (hits ? hits[u] : 0); if (v > bv) { bv = v; best = u; } }
  return best;
}

export function toB64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
export function fromB64(s) { try { const bin = atob(s), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; } catch { return null; } }
export { FRAME };
