// Taste: learns slider preferences per musical context from manual tweaks and like/dislike feedback.
// Dependency-free ES module. Slider values are multipliers (default 1); memory works in log-ratio space.

const NC = 14; // character descriptors, same order as species.mjs CHARACTER_KEYS
const CHAR_KEYS = ['loudness', 'dynamics', 'noisiness', 'roughness', 'tonality', 'harmony', 'regularity',
  'density', 'intricacy', 'brightness', 'bassWeight', 'vocal', 'change', 'tempo'];
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const DAY = 86400000;

function charArray(c) {
  const out = new Array(NC).fill(0.5);
  if (!c) return out;
  if (Array.isArray(c) || ArrayBuffer.isView(c)) { for (let i = 0; i < NC && i < c.length; i++) if (Number.isFinite(c[i])) out[i] = c[i]; }
  else for (let i = 0; i < NC; i++) { const v = c[CHAR_KEYS[i]]; if (Number.isFinite(v)) out[i] = v; }
  return out;
}
const rmsDist = (a, b) => { const m = Math.min(a.length, b.length); if (!m) return 0; let s = 0; for (let i = 0; i < m; i++) { const d = a[i] - b[i]; s += d * d; } return Math.sqrt(s / m); };
const l2 = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; } return Math.sqrt(s); };
const round = (a) => a.map((x) => Math.round(x * 1e5) / 1e5);

export function createTaste({ keys, ranges = {}, dim, now = Date.now, random = Math.random, capacity = 2000 } = {}) {
  // `dim` (embedding dim) is accepted for symmetry; the context is already reduced.
  if (!Array.isArray(keys)) throw new Error('createTaste: keys required');
  const nk = keys.length;
  const lo = keys.map((key) => Math.log(Math.max((ranges[key] || [0.1, 10])[0], 1e-3)));
  const hi = keys.map((key) => Math.log(Math.max((ranges[key] || [0.1, 10])[1], 1e-3)));

  let mem = [];              // {c:[], o:[], w, t, s:+1|-1}
  let ctx = null;
  let explore = null;        // {o, ctx, title}
  const ratings = new Map(); // title -> {up, down, t}
  let version = 0;           // bumps on any memory/explore change
  let lastObs = null;
  let cache = null;          // {version, ctx, result}

  const clampOff = (o) => o.map((x, i) => clamp(x, lo[i], hi[i]));
  const offOf = (values) => keys.map((key, i) => {
    const v = values && values[key];
    return Number.isFinite(v) && v > 0 ? clamp(Math.log(v), lo[i], hi[i]) : 0;
  });
  const toValues = (o) => { const out = {}; keys.forEach((key, i) => { out[key] = Math.exp(clamp(o[i], lo[i], hi[i])); }); return out; };
  const bandwidth = () => { let np = 0; for (const m of mem) if (m.s > 0) np++; return Math.max(0.1, 0.25 / Math.sqrt(1 + np / 200)); };
  const kern = (d, h) => Math.exp(-(d * d) / (2 * h * h));

  function evict() {
    if (mem.length <= capacity) return;
    const t = now();
    const score = (m) => m.w * Math.pow(0.5, (t - m.t) / (30 * DAY));
    mem.sort((a, b) => score(a) - score(b));
    mem = mem.slice(Math.ceil(capacity * 0.05) + (mem.length - capacity));
    lastObs = null;
  }
  function push(item) { mem.push(item); version++; evict(); }

  function rateSong(title, sign) {
    if (!title) return;
    const r = ratings.get(title) || { up: 0, down: 0, t: 0 };
    if (sign > 0) r.up++; else r.down++;
    r.t = now();
    ratings.set(title, r);
    if (ratings.size > 5000) {
      let oldest = null; for (const [k2, v] of ratings) if (!oldest || v.t < ratings.get(oldest).t) oldest = k2;
      ratings.delete(oldest);
    }
  }

  function perturb(base) {
    const m = clamp(Math.ceil(nk / 6), Math.min(3, nk), nk);
    const negs = mem.filter((x) => x.s < 0 && ctx && rmsDist(x.c, ctx) < 3 * bandwidth());
    let best = null, bestScore = -1;
    for (let tr = 0; tr < 8; tr++) {
      const idx = Array.from({ length: nk }, (_, i) => i);
      for (let i = 0; i < m; i++) { const j = i + Math.floor(random() * (nk - i)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
      const mag = 0.25 + 0.15 * random();
      const o = base.slice();
      for (let q = 0; q < m; q++) {
        const i = idx[q];
        const step = mag * (0.7 + 0.6 * random());
        let sgn = random() < 0.5 ? -1 : 1;
        if (base[i] + sgn * step > hi[i] || base[i] + sgn * step < lo[i]) sgn = -sgn;
        o[i] = clamp(base[i] + sgn * step, lo[i], hi[i]);
      }
      let score = l2(o, base);
      for (const ng of negs) score = Math.min(score, l2(o, ng.o));
      if (score > bestScore) { bestScore = score; best = o; }
    }
    return best || base.slice();
  }

  function regress() {
    const h = bandwidth();
    const acc = new Array(nk).fill(0);
    let sumK = 0;
    const negs = [];
    for (const m of mem) {
      const d = rmsDist(ctx, m.c);
      const kk = kern(d, h);
      if (kk < 1e-4) continue;
      if (m.s > 0) { const wk = m.w * kk; sumK += wk; for (let i = 0; i < nk; i++) acc[i] += wk * m.o[i]; }
      else negs.push({ m, kn: m.w * kk });
    }
    const o = acc.map((x) => x / (sumK + 0.2));
    let conf = 1 - Math.exp(-sumK / 1.5);
    let sumN = 0;
    const R = 0.35;
    negs.forEach(({ m, kn }, j) => {
      if (kn < 0.01) return;
      sumN += kn;
      const ds = l2(o, m.o);
      if (ds >= R) return;
      const push2 = (R - ds) * Math.min(1, kn);
      if (ds < 1e-6) { o[j % nk] += push2; return; }
      for (let i = 0; i < nk; i++) o[i] += ((o[i] - m.o[i]) / ds) * push2;
    });
    conf = Math.max(conf, 0.5 * (1 - Math.exp(-sumN / 1.5)));
    return { values: toValues(clampOff(o)), confidence: conf, exploring: false };
  }

  const neutral = () => { const v = {}; for (const key of keys) v[key] = 1; return { values: v, confidence: 0, exploring: false }; };

  return {
    context(embeddingReduced, character) {
      const e = embeddingReduced ? Array.from(embeddingReduced, (x) => (Number.isFinite(x) ? x : 0)) : [];
      ctx = e.concat(charArray(character).map((c) => (c - 0.5) * 1.2));
    },
    // Call once per user gesture (debounced). Repeated calls in the same context within 1.5 s merge.
    observeSliders(values) {
      if (!ctx) return;
      const o = offOf(values), t = now();
      if (lastObs && mem.includes(lastObs) && t - lastObs.t < 1500 && rmsDist(lastObs.c, ctx) < 0.04) {
        lastObs.o = o; lastObs.t = t; lastObs.w = Math.min(3, lastObs.w + 0.5); version++;
        return;
      }
      lastObs = { c: ctx.slice(), o, w: 1, t, s: 1 };
      push(lastObs);
    },
    // sign +1 like / -1 dislike. Also records the per-song rating when title is given
    // (do not call rateSong again for the same press).
    feedback(sign, { title, currentValues } = {}) {
      if (!ctx) return { exploring: false };
      const o = currentValues ? offOf(currentValues) : (explore ? explore.o.slice() : offOf(this.suggest().values));
      const t = now(), h = bandwidth();
      if (title) rateSong(title, sign);
      const same = (m, s) => m.s === s && rmsDist(m.c, ctx) < 0.03 && l2(m.o, o) < 0.1;
      if (sign > 0) {
        for (const m of mem) if (m.s > 0 && rmsDist(m.c, ctx) < 2 * h && kern(rmsDist(m.c, ctx), h) > 0.5 && l2(m.o, o) > 0.15) m.w *= 0.1;
        const dup = mem.find((m) => same(m, 1));
        if (dup) { dup.w += 2; dup.o = o; dup.t = t; version++; }
        else push({ c: ctx.slice(), o, w: 2, t, s: 1 });
        explore = null; version++;
        return { exploring: false };
      }
      const dup = mem.find((m) => same(m, -1));
      if (dup) { dup.w += 1.5; dup.t = t; version++; }
      else push({ c: ctx.slice(), o, w: 1.5, t, s: -1 });
      explore = { o: perturb(o), ctx: ctx.slice(), title };
      version++;
      return { exploring: true };
    },
    suggest() {
      if (!ctx) return neutral();
      if (explore && rmsDist(explore.ctx, ctx) > 0.6) { explore = null; version++; } // song surely changed
      if (cache && cache.version === version && rmsDist(cache.ctx, ctx) < 0.005) {
        return { ...cache.result, values: { ...cache.result.values } };
      }
      let result;
      if (explore) result = { values: toValues(explore.o), confidence: 0.7, exploring: true };
      else if (!mem.length) result = neutral();
      else result = regress();
      cache = { version, ctx: ctx.slice(), result };
      return { ...result, values: { ...result.values } };
    },
    newSong() { if (explore) { explore = null; version++; } },   // call on song change
    rateSong,
    songRating(title) {
      const r = ratings.get(title);
      return r ? { up: r.up, down: r.down, net: r.up - r.down } : { up: 0, down: 0, net: 0 };
    },
    stats() { let p = 0; for (const m of mem) if (m.s > 0) p++; return { memories: mem.length, positives: p, negatives: mem.length - p, songs: ratings.size, exploring: !!explore }; },
    reset() { mem = []; ctx = null; explore = null; ratings.clear(); version++; lastObs = null; },
    serialize() {
      return {
        v: 1, keys: keys.slice(),
        mem: mem.map((m) => ({ c: round(m.c), o: round(m.o), w: m.w, t: m.t, s: m.s })),
        ratings: [...ratings].map(([title, r]) => [title, r]),
      };
    },
    deserialize(obj) {
      if (!obj || obj.v !== 1 || !Array.isArray(obj.keys) || !Array.isArray(obj.mem)) return false;
      const map = keys.map((key) => obj.keys.indexOf(key)); // remap if slider set changed
      mem = obj.mem.map((m) => ({
        c: m.c.slice(), o: map.map((j, i) => (j < 0 ? 0 : clamp(m.o[j] || 0, lo[i], hi[i]))), w: m.w, t: m.t, s: m.s,
      }));
      ratings.clear();
      for (const [title, r] of obj.ratings || []) ratings.set(title, { up: r.up | 0, down: r.down | 0, t: r.t || 0 });
      explore = null; lastObs = null; version++;
      return true;
    },
  };
}
