// being/flourish.mjs - its rarer flourishes: glints and stars, the watery rings, the serpent. Pure module (no DOM).
//
//   glints   sunlight catching it: small glints (a dopamine peak, the drop, love) and, rarely, a great star with long rays
//            and a halo (chills, a great drop, one of the Sun's stations, a solar flare). Rarity is the point: a small glint at most
//            every 4 s and five a minute, a star at most every 45 s; glistening (facets catching light) decays in seconds.
//   rings    two watery rings like Saturn's, precessing at their own rates so they cross and merge; their radius breathes,
//            sometimes sinking through the shell into the inner light
//   serpent  a chain of 12 points along a figure of eight round the nucleus (a 3D lemniscate looping in front of and behind
//            it), one loop per eight felt beats, surging on each beat, slithering as it goes; head thick, tail thin

const TAU = Math.PI * 2;
const c01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** glints and stars; positions come from a projector (the page knows where the body is on screen) */
export function createGlints(rand = Math.random) {
  const slots = Array.from({ length: 6 }, () => ({ x: 0, y: 0, size: 0.05, i: 0, peak: 0, age: 1e9, life: 1, rot: 0, spin: 0 }));
  let lastSmall = -1e9, lastStar = -1e9, recent = [], glisten = 0, glistenTo = 0;
  const done = (s) => (s.age < 0 ? 0 : s.age / s.life);   // how finished a slot is (1 or more: free)
  const score = (s) => done(s) - (s.size > 0.2 && done(s) < 1 ? 10 : 0);   // a shining star is never cut short by a glint
  const free = () => slots.reduce((a, s) => (score(s) > score(a) ? s : a), slots[0]);
  const st = {
    slots,
    get glisten() { return glisten; },
    /**
     * ask for a flourish; it may be refused (too soon). kind: 'glint' | 'star' | 'glisten'
     * @param {number} now seconds; @param {() => [number, number]} where a point on the body in window coordinates
     * @param {boolean} force skip the rarity limits (the showcase)
     * @returns {boolean} granted
     */
    ask(kind, now, where, strength = 1, force = false) {
      if (kind === 'glisten') { glistenTo = Math.max(glistenTo, c01(strength)); return true; }
      if (kind === 'star') {
        if (now - lastStar < 45 && !force) return st.ask('glint', now, where, strength);   // too soon for a star: a glint at most
        lastStar = now; lastSmall = now;
        const s = free(), [x, y] = where();
        Object.assign(s, { x, y, size: 0.28 + 0.12 * c01(strength), peak: 1.1 + 0.6 * c01(strength), age: 0, life: 2.6, rot: rand() * TAU, spin: (rand() - 0.5) * 0.15 });
        glistenTo = Math.max(glistenTo, 1);
        return true;
      }
      recent = recent.filter((t) => now - t < 60);
      if (!force && (now - lastSmall < 4 || recent.length >= 5)) return false;
      lastSmall = now; recent.push(now);
      const n = strength > 0.8 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const s = free(), [x, y] = where();
        Object.assign(s, { x, y, size: 0.04 + 0.05 * rand() * c01(strength + 0.3), peak: 0.6 + 0.6 * c01(strength), age: -0.12 * k, life: 0.7 + 0.5 * rand(), rot: rand() * TAU, spin: (rand() - 0.5) * 0.4 });
      }
      return true;
    },
    step(dt) {
      dt = Math.min(0.1, Math.max(0, dt || 0));
      for (const s of slots) {
        s.age += dt; s.rot += s.spin * dt;
        const u = s.age / s.life;
        // a quick flash in, a slow fade out
        s.i = s.age < 0 || u >= 1 ? 0 : s.peak * (u < 0.06 ? u / 0.06 : Math.pow(1 - (u - 0.06) / 0.94, 2.2));
      }
      glisten += (glistenTo - glisten) * (1 - Math.exp(-dt / 0.25));
      glistenTo *= Math.exp(-dt / 2.2);
      return st;
    },
  };
  return st;
}

/** the two rings: axes precessing (unit vectors) and radii breathing, relative to the shell radius */
export function ringGeometry(t, shellR) {
  const out = [];
  for (let i = 0; i < 2; i++) {
    const tilt = 0.35 + 0.25 * i + 0.12 * Math.sin(t * 0.05 + i), az = t * (0.07 + 0.05 * i) + i * 2.1;
    const ax = [Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az)];
    const R = shellR * (1.65 + 0.35 * Math.sin(t * 0.09 + 1.7 * i) - 0.7 * Math.max(0, Math.sin(t * 0.031 + 2.4 * i)) ** 4);   // now and then it sinks into the body
    out.push([...ax, R]);
  }
  return out;
}

// ---- serpents: episodes in absorbed stretches, each on its own orbit and rhythm ----
// Orbit families, as directions round the nucleus (each point is then set at the orbit's radius, so no path ever passes
// through the body): the infinity (a 3D lemniscate looping round the front and back), Lissajous figures, a trefoil
// knot, a (2,3) torus knot, a four-petalled rose, a tilted ring and a spiral. Every episode picks a family, an
// orientation, a precession, a wander (slow procedural deviation) and a rhythm, so no two are alike.
export const SEG = 16;   // points per snake
export const ORBITS = ['infinity', 'lissajous', 'trefoil', 'torusknot', 'rose', 'ring', 'spiral'];
function orbitDir(kind, a, k) {   // a: angle (radians); k: the family's own shape parameter
  let x, y, z;
  switch (kind) {
    case 'lissajous': x = Math.sin(3 * a + k); y = Math.sin(2 * a); z = Math.cos(a); break;
    case 'trefoil': x = Math.sin(a) + 2 * Math.sin(2 * a); y = Math.cos(a) - 2 * Math.cos(2 * a); z = -Math.sin(3 * a) * 1.5; break;
    case 'torusknot': { const r = 2 + Math.cos(3 * a); x = r * Math.cos(2 * a); y = Math.sin(3 * a) * 1.3; z = r * Math.sin(2 * a); break; }
    case 'rose': { const r = Math.cos(2 * a); x = r * Math.cos(a); y = r * Math.sin(a); z = 0.55 * Math.cos(a * 2 + k) + 0.25; break; }
    case 'ring': x = Math.cos(a); y = 0.35 * Math.sin(2 * a + k); z = Math.sin(a); break;
    case 'spiral': { const lat = 0.9 * Math.sin(a * 0.5 + k); x = Math.cos(3 * a) * Math.cos(lat); y = Math.sin(lat); z = Math.sin(3 * a) * Math.cos(lat); break; }
    default: x = 1.8 * Math.sin(a); y = 0.55 * Math.sin(2 * a); z = 1.4 * Math.cos(a);   // the infinity
  }
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}
const rotate = (v, q) => {   // v by a rotation given as [ax, ay, az, angle]
  const [ux, uy, uz, ang] = q, c = Math.cos(ang), s = Math.sin(ang), d = ux * v[0] + uy * v[1] + uz * v[2];
  return [v[0] * c + (uy * v[2] - uz * v[1]) * s + ux * d * (1 - c), v[1] * c + (uz * v[0] - ux * v[2]) * s + uy * d * (1 - c), v[2] * c + (ux * v[1] - uy * v[0]) * s + uz * d * (1 - c)];
};
const randAxis = (r) => { const z = r() * 2 - 1, t = r() * TAU, q = Math.sqrt(1 - z * z); return [q * Math.cos(t), q * Math.sin(t), z]; };

/**
 * One snake's SEG points (x, y, z, radius) on its orbit. Exported for tests and the lab.
 * @param {object} o { kind, k, orient: [axis, angle], precess: [axis, rad/s], wander, R (orbit radius), size }
 * @param {number} phase loops travelled; @param {number} t seconds; @param {number} amount 0..1; @param {number} reach >= 1 (arriving/leaving)
 */
export function snakePoints(o, phase, t, amount, reach = 1) {
  const pts = [];
  const prec = [...o.precess[0], o.precess[1] * t], orient = [...o.orient[0], o.orient[1]];
  for (let i = 0; i < SEG; i++) {
    const a = TAU * (phase - i * 0.026 * (o.length || 1));   // a long body, so it reads as a serpent and not a lump
    let d = orbitDir(o.kind, a, o.k);
    // wander: a slow deviation of the path, different in every episode
    const wv = o.wander;
    d = [d[0] + wv * Math.sin(a * 2 + t * 0.37 + o.k), d[1] + wv * Math.sin(a * 3 - t * 0.29 + 2 * o.k), d[2] + wv * Math.cos(a * 2 + t * 0.31)];
    d = rotate(rotate(d, orient), prec);
    const l = Math.hypot(...d) || 1;
    const r = o.R * reach * (1 + 0.12 * Math.sin(a * 3 + t * 0.6 + o.k));   // the orbit breathes in and out
    const taper = i === 0 ? 1.15 : i === 1 ? 1 : 1 - (i / (SEG - 1)) * 0.82;
    pts.push([(d[0] / l) * r, (d[1] / l) * r, (d[2] / l) * r, o.size * taper * c01(amount)]);
  }
  return pts;
}
/**
 * The serpent as an attractor: it is not drawn. Its orbit points are pulled in close to the body, so the liquid is drawn out
 * after it like ferrofluid after a magnet: a stream of the body's own mass, the head furthest out, the tail still merged.
 * The body melts this chain into itself (a wide smooth union), so what is seen is a wave of its own material.
 */
export function pullPoints(pts, shellR, amount, t = 0) {
  const a = c01(amount), n = pts.length;
  // it swims: an S-wave runs from head to tail, across its path and along the skin
  pts = pts.map((p, i) => {
    const q = pts[Math.min(n - 1, i + 1)], o = pts[Math.max(0, i - 1)], tg = [o[0] - q[0], o[1] - q[1], o[2] - q[2]], l = Math.hypot(...p.slice(0, 3)) || 1;
    const rn = [p[0] / l, p[1] / l, p[2] / l], side = [rn[1] * tg[2] - rn[2] * tg[1], rn[2] * tg[0] - rn[0] * tg[2], rn[0] * tg[1] - rn[1] * tg[0]], sl = Math.hypot(...side) || 1;
    const w = Math.sin(i * 0.85 - t * 5.5) * shellR * 0.09 * Math.min(1, i / 3);
    return [p[0] + (side[0] / sl) * w, p[1] + (side[1] / sl) * w, p[2] + (side[2] / sl) * w, p[3]];
  });
  return pts.map(([x, y, z, rad], i) => {
    const l = Math.hypot(x, y, z) || 1, f = 1 - i / (n - 1);
    const r = shellR * (1 + a * (0.08 + 0.42 * Math.pow(f, 1.2)));   // the liquid drawn out after it: head ~1.5x the shell radius, tail still in the body
    return [(x / l) * r, (y / l) * r, (z / l) * r, shellR * (0.045 + 0.1 * f) * Math.min(1, a * 1.5) * (rad > 0 ? 1 : 0)];   // its own thickness: a full body tapering to the tail (the orbit's taper would make it a hair)
  });
}
/**
 * The serpent's journey (attractor mode): it rises out of the nucleus, breaks through the skin, travels an arc outside the body
 * (from one side over to another: left to right, top to bottom, a different route each time), and dives back into the
 * nucleus. Its body is a chain of liquid lobes (the page joins them with a smooth union, not capsules), swelling with a
 * squeezing wave that runs down it, the tail thinning to droplets. xh: how far its head has travelled (0 nucleus .. 1 back
 * in), o: { e1 entry direction, ax sweep axis, theta arc, Ro orbit radius in shell radii, len body length, wob wander }.
 */
export function journeyPoints(o, xh, t, amount, R) {
  const sm = (a, b, x) => { const u = c01((x - a) / (b - a)); return u * u * (3 - 2 * u); };
  const pts = [];
  for (let i = 0; i < SEG; i++) {
    const f = i / (SEG - 1), x = Math.max(0, Math.min(1, xh - f * o.len));
    const rr = R * (0.25 + (o.Ro - 0.25) * sm(0, 0.2, x) * sm(1, 0.8, x));   // out of the nucleus, round outside, back in
    let d = rotate(o.e1, [...o.ax, o.theta * x]);
    const w = Math.sin(x * Math.PI * 2 + t * 0.5) * o.wob;   // its route wanders off the plane a little
    d = [d[0] + o.ax[0] * w, d[1] + o.ax[1] * w, d[2] + o.ax[2] * w]; const l = Math.hypot(...d) || 1;
    const ripple = 1 + 0.06 * Math.sin(f * 7 - t * 9);   // a faint ripple running down it, no more
    const rad = R * (0.03 + 0.085 * Math.pow(1 - f, 0.8)) * ripple * c01(amount * 1.5);   // one smooth body, tapering to the tail
    pts.push([(d[0] / l) * rr, (d[1] / l) * rr, (d[2] / l) * rr, rad]);
  }
  return pts;
}
/** the original single serpent on the infinity (kept for the lab and tests) */
export function serpentPoints(phase, t, shellR, amount) {
  return snakePoints({ kind: 'infinity', k: 0, orient: [[1, 0, 0], 0.42], precess: [[0, 1, 0], 0.05], wander: 0, R: shellR * 1.75, size: shellR * 0.14 }, phase, t, amount);
}

/**
 * Serpent episodes. They come with absorption: when the being has been locked into a repetitive groove for a while
 * (lock x groove x regularity x little change, integrated over ~15 s), and briefly at drops. An episode lasts a phrase
 * (8 or 16 bars), arrives from outside, speeds up through the phrase, surges on each beat, and leaves; then a rest.
 */
export function createSerpents(rand = Math.random) {
  const MAX = 3;
  const snakes = Array.from({ length: MAX }, () => ({ on: false, a: 0, phase: 0, o: null, dir: 1, ratio: 8 }));
  let absorb = 0, episode = null, rest = 6 + 12 * rand(), sinceDrop = 1e9;
  // one journey's route: out of the nucleus at e1, an arc of theta about ax at Ro shell radii, back in
  const route = (strength = 0.6) => { const e1 = randAxis(rand); let a = randAxis(rand); a = [a[1] * e1[2] - a[2] * e1[1], a[2] * e1[0] - a[0] * e1[2], a[0] * e1[1] - a[1] * e1[0]]; const al = Math.hypot(...a) || 1;
    return { e1, ax: a.map((v) => v / al), theta: Math.PI * (0.6 + 1.0 * rand()), Ro: 1.45 + 0.6 * rand() * (0.6 + 0.4 * strength), len: 0.3 + 0.12 * rand(), wob: (rand() - 0.5) * 0.5 }; };
  const begin = (shellR, strength, bars, pulseHz, why, over = {}) => {
    const kind = over.kind ?? (strength > 0.85 && rand() < 0.3 ? 'infinity' : ORBITS[Math.floor(rand() * ORBITS.length)]);
    // one is the norm; two need deep absorption and luck, three near-total absorption and more luck
    const roll = rand(), n = over.n ?? (strength > 0.92 && roll < 0.06 ? 3 : strength > 0.8 && roll < 0.2 ? 2 : 1);
    const twin = over.twin ?? (n >= 2 && rand() < 0.45);   // two on the same path, half a loop apart, intertwining
    const ratio = [4, 8, 8, 16][Math.floor(rand() * 4)];   // beats per loop
    const base = { kind, k: rand() * TAU, orient: [randAxis(rand), rand() * TAU], precess: [randAxis(rand), (rand() - 0.5) * 0.25], wander: 0.08 + 0.25 * rand(), R: shellR * (1.6 + 0.35 * rand()), size: shellR * (0.1 + 0.05 * rand()), length: 0.8 + 0.6 * rand() };
    const J = route(strength);
    for (let s = 0; s < MAX; s++) {
      const sn = snakes[s];
      if (s >= n) { sn.on = false; continue; }
      sn.j = s === 0 || twin ? { ...J, wob: twin && s ? -J.wob : J.wob } : route(strength); sn.lag = twin && s ? 0.12 : 0;   // a twin pair shares a route, interlaced
      sn.pt = twin && s ? 0 : -rand() * 1.5; sn.P = 3 + 2 * rand(); sn.twin = twin && s > 0;
      const o = s === 0 || twin ? { ...base, k: base.k + (twin && s ? 0.6 : 0) } : { ...base, kind: ORBITS[Math.floor(rand() * ORBITS.length)], orient: [randAxis(rand), rand() * TAU], R: base.R * (0.9 + 0.3 * rand()), size: base.size * 0.8 };
      Object.assign(sn, { on: true, o, phase: twin ? s / n : rand(), dir: !twin && s && rand() < 0.5 ? -1 : 1, ratio: s && !twin ? ratio * (rand() < 0.5 ? 2 : 1) : ratio });
    }
    const beats = bars * 4;
    episode = { t: 0, len: beats / Math.max(0.6, pulseHz), why, n, kind };
  };
  const st = {
    snakes, get absorb() { return absorb; }, get episode() { return episode; },
    /** summon an episode now (the showcase): { kind, n, twin, bars } */
    show(shellR, pulseHz, over = {}) { begin(shellR, 0.9, over.bars || 8, pulseHz, 'shown', over); },
    /**
     * @param {number} dt; @param {number} t seconds
     * @param {{ lock, groove, regularity, change, pulseHz, beat (0..1 pulse), drop (0..1), mercury (0..1), awake, shellR, force,
     *   bars?, perBar? }} c  bars: the felt bar position (cumulative, 0 on a downbeat); given, the journeys lock to it
     */
    step(dt, t, c) {
      dt = Math.min(0.1, Math.max(0, dt || 0));
      const tr = c01(c.lock * c.groove * (0.5 + 0.5 * c.regularity) * (1 - 0.6 * c.change) * 1.6 + 0.4 * c.mercury) * c.awake;
      absorb += (tr - absorb) * (1 - Math.exp(-dt / 15));
      sinceDrop += dt;
      if (c.drop > 0.95 && sinceDrop > 20) { sinceDrop = 0; if (!episode && rand() < 0.6) begin(c.shellR, 0.7, 2, c.pulseHz * 2, 'the drop'); }
      if (!episode) {
        rest -= dt;
        // a single serpent needs only a pulse it feels; absorption calls it sooner (and is what can bring a second or third)
        const pulse = c01((c.lock - 0.25) / 0.45) * c.awake;
        const chance = c.force ? 1 : rest <= 0 && pulse > 0.3 ? dt / (absorb > 0.4 ? 3 : 8) : 0;
        if (rand() < chance) begin(c.shellR, c.force ? 0.9 : absorb, rand() < 0.5 ? 8 : 16, c.pulseHz, c.force ? 'shown' : absorb > 0.4 ? 'absorb' : 'pulse');
      }
      if (episode) {
        episode.t += dt;
        const u = episode.t / episode.len, fadeIn = Math.min(1, u / 0.08), fadeOut = Math.min(1, (1 - u) / 0.12);
        const amt = Math.max(0, Math.min(fadeIn, fadeOut)) * c.awake;
        const reach = 1 + 0.9 * (1 - Math.min(fadeIn, fadeOut)) ** 2;   // it comes in from outside, and leaves the same way
        const accel = 0.7 + 0.8 * u;   // the flow quickens through the phrase
        for (const sn of snakes) if (sn.on) {
          sn.phase += sn.dir * dt * (Math.max(0.6, c.pulseHz) / sn.ratio) * accel * (1 + 1.2 * c.beat);
          sn.a = amt; sn.reach = reach;
          if (sn.j) {   // the journey, quick: out of the nucleus, round the outside, back in, in 3-5 s; then another pass on a new route
            let v = (1 + 0.6 * c.beat) * (0.8 + 0.4 * c01(c.pulseHz / 2.5)) / sn.P;   // its own pace, in passes per second
            // a pass is a phase oscillator (Kuramoto): with a felt bar it is pulled to take a whole number of bars and to
            // dive back into the nucleus on the one; a twin is also pulled onto its leader
            if (sn.pt >= 0 && Number.isFinite(c.bars) && c.pulseHz > 0) {
              const K = 1.2 * c01((c.lock - 0.3) / 0.4), barSec = (c.perBar || 4) / c.pulseHz;
              if (!sn.nb) sn.nb = [1, 2, 4].reduce((a, b) => (Math.abs(b * barSec - sn.P) < Math.abs(a * barSec - sn.P) ? b : a));
              const th = sn.pt / sn.P, target = c.bars / sn.nb + 1 / (1 + sn.j.len);   // the head is back in at th = 1 / (1 + len)
              v += (K / TAU) * Math.sin(TAU * (target - th));
              sn.P += (sn.nb * barSec - sn.P) * (1 - Math.exp(-dt * 0.5 * K));
            }
            if (sn.twin && snakes[0].on && snakes[0].j) v += (1.5 / TAU) * Math.sin(TAU * (snakes[0].pt / snakes[0].P - sn.pt / sn.P));
            sn.pt += dt * v * sn.P;
            if (sn.pt > sn.P) {
              sn.pt -= sn.P; sn.nb = 0;
              if (!sn.twin) { sn.P = Number.isFinite(c.bars) ? sn.P : 3 + 2 * rand(); sn.j = route(0.6); }
              if (sn === snakes[0]) for (const tw of snakes) if (tw.on && tw.twin) tw.j = { ...sn.j, wob: -sn.j.wob };   // twins follow their leader's new route
            }
            sn.x = Math.max(0, sn.pt / sn.P) * (1 + sn.j.len) - sn.lag;
          }
        }
        if (u >= 1) { episode = null; for (const sn of snakes) { sn.on = false; sn.a = 0; } rest = c.force ? 0 : (12 + 18 * rand()) * (1.2 - 0.5 * absorb); }
      }
      return st;
    },
    /** SEG points per snake (three snakes), their amounts and bounding spheres, for the shader */
    /** pullR: the shell radius, to get its pull on the body (pullPoints) instead of the orbit itself */
    points(t, pullR = 0) {
      return snakes.map((sn) => {
        if (!sn.on || sn.a < 0.01) return { pts: null, a: 0 };
        const pts = pullR > 0 && sn.j ? journeyPoints(sn.j, sn.x || 0, t, Math.max(sn.a, 0.6), pullR) : snakePoints(sn.o, sn.phase, t, sn.a, sn.reach || 1);
        let cx = 0, cy = 0, cz = 0; for (const p of pts) { cx += p[0] / SEG; cy += p[1] / SEG; cz += p[2] / SEG; }
        let r = 0; for (const p of pts) r = Math.max(r, Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz) + p[3]);
        return { pts, a: sn.a, bound: [cx, cy, cz, r] };
      });
    },
  };
  return st;
}
