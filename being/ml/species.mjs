// Species: maps a music embedding + character descriptors to a stable, unique "creature" description.
// Dependency-free ES module (Electron renderer and Node).

export const CHARACTER_KEYS = [
  'loudness', 'dynamics', 'noisiness', 'roughness', 'tonality', 'harmony', 'regularity',
  'density', 'intricacy', 'brightness', 'bassWeight', 'vocal', 'change', 'tempo',
];
export const FORM_KEYS = [
  'lobes', 'tendrils', 'satellites', 'spikiness', 'viscosity', 'twist', 'asymmetry', 'grain',
];
// form params that get more extreme when the music is "unknown" (experimental)
const WIDE = new Set(['spikiness', 'twist', 'asymmetry', 'grain']);

const NC = CHARACTER_KEYS.length;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const sigmoid = (x) => 1 / (1 + Math.exp(-x));

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rng) {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}
function fnv(ints) {
  let h = 0x811c9dc5;
  for (const v of ints) {
    h ^= (v + 0x9e3779b9) | 0;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 13;
  }
  return h >>> 0;
}
function characterArray(character) {
  const out = new Float64Array(NC).fill(0.5);
  if (!character) return out;
  if (Array.isArray(character) || ArrayBuffer.isView(character)) {
    for (let i = 0; i < NC && i < character.length; i++) if (Number.isFinite(character[i])) out[i] = character[i];
  } else {
    for (let i = 0; i < NC; i++) { const v = character[CHARACTER_KEYS[i]]; if (Number.isFinite(v)) out[i] = v; }
  }
  return out;
}
const rmsDiff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; } return Math.sqrt(s / a.length); };

export function createSpecies({ dim, seed = 1337, k = 8, freezeAfter = 2000 } = {}) {
  if (!(dim > 0)) throw new Error('createSpecies: dim required');

  // ---- fixed random structure (deterministic from `seed`) ----
  const rng = mulberry32(seed);
  const P = new Float32Array(dim * k);          // projection, layout [i*k + j]
  for (let i = 0; i < P.length; i++) P[i] = gauss(rng) / Math.sqrt(dim);
  const C = new Float32Array(NC * k);           // character projection, [m*k + j]
  for (let i = 0; i < C.length; i++) C[i] = gauss(rng) / Math.sqrt(NC);
  const unitRow = () => { const r = new Float64Array(k); let n = 0; for (let j = 0; j < k; j++) { r[j] = gauss(rng); n += r[j] * r[j]; } n = Math.sqrt(n) || 1; for (let j = 0; j < k; j++) r[j] /= n; return r; };
  const formW = FORM_KEYS.map(unitRow);
  const formB = FORM_KEYS.map(() => (rng() - 0.5) * 0.5);
  const hueW = unitRow(), satW = unitRow(), litW = unitRow();

  const W_CHAR = 0.6;       // modest weight of the character descriptors
  const VEC_GAIN = 0.7;     // tanh(VEC_GAIN * raw)
  const STEP = 0.4;         // coarse seed grid
  const HYST = 0.08;        // seed-cell hysteresis (in vec units)
  const RES_SIZE = 48;
  const SETTLE = 8;         // seconds of stability before a species counts as 'seen'
  const TAU_SLOW = 4, TAU_FAST = 1;
  const JUMP_ON = 0.7, JUMP_OFF = 0.15; // raw-space rms thresholds for the fast (song change) mode

  // ---- persistent state ----
  let n = 0, sumSq = 0;
  let mean = new Float64Array(dim), m2 = new Float64Array(dim);
  const fresh = () => ({
    smRaw: null, smUnknown: 0, smNovelty: 0, cells: null,
    clock: 0, sinceInsert: 0, sinceJump: 0, fast: false, reservoir: [],
  });
  let S = fresh();
  let current = null;

  function standardizedProject(emb, character, out) {
    const msq = n > 0 ? sumSq / (n * dim) : 1;
    const floor = Math.max(0.1 * Math.sqrt(msq), 1e-6);
    const denom = Math.max(n - 1, 1);
    out.fill(0);
    for (let i = 0; i < dim; i++) {
      const sd = Math.max(Math.sqrt(m2[i] / denom), floor);
      const z = ((Number.isFinite(emb[i]) ? emb[i] : mean[i]) - mean[i]) / sd;
      const base = i * k;
      for (let j = 0; j < k; j++) out[j] += P[base + j] * z;
    }
    const cv = characterArray(character);
    for (let m = 0; m < NC; m++) {
      const c = (cv[m] - 0.5) * 2 * W_CHAR;
      const base = m * k;
      for (let j = 0; j < k; j++) out[j] += C[base + j] * c;
    }
  }

  function compose() {
    const vec = new Float32Array(k);
    for (let j = 0; j < k; j++) vec[j] = Math.tanh(VEC_GAIN * S.smRaw[j]);
    const dot = (w) => { let s = 0; for (let j = 0; j < k; j++) s += w[j] * vec[j]; return s; };
    const u = S.smUnknown;
    const form = {};
    FORM_KEYS.forEach((key, i) => {
      const gain = 2.4 * (WIDE.has(key) ? 1 + 0.9 * u : 1);
      form[key] = sigmoid(gain * dot(formW[i]) + formB[i] * (WIDE.has(key) ? 1 + u : 1));
    });
    const hue = (((0.5 + 0.6 * dot(hueW)) % 1) + 1) % 1;
    const palette = [hue, 0.35 + 0.5 * sigmoid(2 * dot(satW)), 0.38 + 0.3 * sigmoid(2 * dot(litW))];
    let seedInt = 0;
    if (S.cells) seedInt = fnv(S.cells);
    return { vec, seed: seedInt, palette, form, novelty: S.smNovelty, unknown: u };
  }

  function updateCells(vec) {
    const nd = Math.min(4, k);
    if (!S.cells) { S.cells = []; for (let i = 0; i < nd; i++) S.cells.push(Math.floor(vec[i] / STEP)); return; }
    for (let i = 0; i < nd; i++) {
      const c = S.cells[i];
      if (vec[i] < c * STEP - HYST || vec[i] > (c + 1) * STEP + HYST) S.cells[i] = Math.floor(vec[i] / STEP);
    }
  }

  function minDistance(vec) {
    let best = Infinity;
    for (const r of S.reservoir) { const d = rmsDiff(vec, r.v); if (d < best) best = d; }
    return best;
  }

  const raw = new Float64Array(k);

  return {
    update(embedding, character, unknown = 0, dt = 1.5) {
      if (!embedding || embedding.length !== dim) throw new Error(`species.update: expected embedding of length ${dim}`);
      dt = clamp(Number.isFinite(dt) ? dt : 1.5, 1e-3, 10);
      unknown = clamp(Number.isFinite(unknown) ? unknown : 0, 0, 1);

      if (n < freezeAfter) {   // Welford, frozen afterwards so looks do not drift over months
        n++;
        let sq = 0;
        for (let i = 0; i < dim; i++) {
          const x = Number.isFinite(embedding[i]) ? embedding[i] : mean[i];
          const d = x - mean[i];
          mean[i] += d / n;
          m2[i] += d * (x - mean[i]);
          sq += x * x;
        }
        sumSq += sq;
      }
      standardizedProject(embedding, character, raw);

      // temporal smoothing: ~4 s, ~1 s on a big change
      let moving = false;
      if (!S.smRaw) {
        S.smRaw = Float64Array.from(raw);
        S.smUnknown = unknown;
      } else {
        const d = rmsDiff(raw, S.smRaw);
        // latch fast mode on a big change until the smoothed value has caught up
        if (d > JUMP_ON) S.fast = true; else if (d < JUMP_OFF) S.fast = false;
        moving = S.fast;
        const tau = S.fast ? TAU_FAST : TAU_SLOW;
        const a = 1 - Math.exp(-dt / tau);
        for (let j = 0; j < k; j++) S.smRaw[j] += a * (raw[j] - S.smRaw[j]);
        S.smUnknown += (1 - Math.exp(-dt / 2)) * (unknown - S.smUnknown);
      }
      S.clock += dt;
      S.sinceInsert += dt;
      S.sinceJump = moving ? 0 : S.sinceJump + dt;

      const vec = new Float32Array(k);
      for (let j = 0; j < k; j++) vec[j] = Math.tanh(VEC_GAIN * S.smRaw[j]);
      updateCells(vec);

      // novelty: distance to recently seen species (before inserting the current one)
      const dmin = minDistance(vec);
      const rawNov = Number.isFinite(dmin) ? 1 - Math.exp(-((dmin / 0.25) ** 2)) : 1;
      const first = S.reservoir.length === 0 && S.clock <= dt + 1e-9;
      S.smNovelty = first ? rawNov : S.smNovelty + (1 - Math.exp(-dt / 2)) * (rawNov - S.smNovelty);

      // remember settled species only (not the middle of a transition, nor the first seconds of a song,
      // so novelty stays high while a new song is still unfamiliar)
      if (S.sinceJump >= SETTLE) {
        let near = null, nd = Infinity;
        for (const r of S.reservoir) { const d = rmsDiff(vec, r.v); if (d < nd) { nd = d; near = r; } }
        if (near && nd < 0.12) {
          S.cells = near.cells.slice();                 // recall: a known species keeps the seed it had
          near.t = S.clock;
          for (let j = 0; j < k; j++) near.v[j] += 0.1 * (vec[j] - near.v[j]);
        } else if (S.sinceInsert >= 1.5) {
          S.sinceInsert = 0;
          if (S.reservoir.length >= RES_SIZE) {
            let oi = 0; for (let i = 1; i < S.reservoir.length; i++) if (S.reservoir[i].t < S.reservoir[oi].t) oi = i;
            S.reservoir.splice(oi, 1);
          }
          S.reservoir.push({ v: Float64Array.from(vec), t: S.clock, cells: S.cells.slice() });
        }
      }
      current = compose();
      return current;
    },
    get current() { return current; },
    // Clears temporal state (smoothing, seed cell, novelty reservoir). Keeps the frozen/learning
    // standardization stats unless resetStats is true.
    reset(resetStats = false) {
      S = fresh(); current = null;
      if (resetStats) { n = 0; sumSq = 0; mean = new Float64Array(dim); m2 = new Float64Array(dim); }
    },
    serialize() {
      return {
        v: 1, dim, k, seed, n, sumSq,
        mean: Array.from(mean), m2: Array.from(m2),
        smRaw: S.smRaw ? Array.from(S.smRaw) : null,
        smUnknown: S.smUnknown, smNovelty: S.smNovelty, cells: S.cells ? S.cells.slice() : null,
        clock: S.clock, sinceInsert: S.sinceInsert, sinceJump: S.sinceJump, fast: S.fast,
        reservoir: S.reservoir.map((r) => ({ v: Array.from(r.v), t: r.t, cells: r.cells })),
      };
    },
    deserialize(o) {
      if (!o || o.v !== 1 || o.dim !== dim || o.k !== k || o.seed !== seed) return false;
      if (!Array.isArray(o.mean) || o.mean.length !== dim || o.m2.length !== dim) return false;
      n = o.n | 0; sumSq = +o.sumSq || 0;
      mean = Float64Array.from(o.mean); m2 = Float64Array.from(o.m2);
      S = fresh();
      S.smRaw = o.smRaw && o.smRaw.length === k ? Float64Array.from(o.smRaw) : null;
      S.smUnknown = +o.smUnknown || 0; S.smNovelty = +o.smNovelty || 0;
      S.cells = Array.isArray(o.cells) ? o.cells.slice() : null;
      S.clock = +o.clock || 0; S.sinceInsert = +o.sinceInsert || 0; S.sinceJump = +o.sinceJump || 0; S.fast = !!o.fast;
      S.reservoir = (o.reservoir || []).map((r) => ({ v: Float64Array.from(r.v), t: r.t, cells: r.cells.slice() }));
      current = S.smRaw ? compose() : null;
      return true;
    },
  };
}
