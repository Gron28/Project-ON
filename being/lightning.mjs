// being/lightning.mjs - lightning, simulated. Pure module (no DOM).
//
// A bolt grows as a stepped leader: from where it starts it advances in short jagged steps, each step's direction the pull
// toward its goal plus a random kick and a little of the last step's heading, and now and then it forks into a branch that
// wanders off weaker and dies out (the branching of the dielectric breakdown model, Niemeyer, Pietronero & Wiesmann 1984).
// In nature a step takes ~50 us; here a few ms, so the eye sees the leader reach. When it touches its goal the return
// stroke lights the whole channel at once, the trunk brightest, the branches dimmer; then the channel fades and, as real
// lightning does, it may restrike down the same trunk (dart leaders) a few times within a few hundred ms (Uman, The
// Lightning Discharge, 1987). An arc may pass through waypoints (`via`), so it can leap round the body instead of through it.
//
// strike() takes its own random source, so a figure in the music that returns can strike the same path again.

const LEADER_STEP_S = 0.0045, STROKE_TAU = 0.085, AFTER_TAU = 0.3;

/** One bolt's channel: segments { a, b, depth, t } (t: when the leader reaches the segment's start, s), and tEnd. */
export function growBolt(from, to, rnd = Math.random, o = {}) {
  const goals = [...(o.via || []), to], segs = [];
  const span = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) + (o.via ? o.via.length * 0.2 : 0);
  const step = o.step || span / 11, jag = o.jag ?? 0.85, branch = o.branch ?? 0.3, maxSteps = o.maxSteps || 60, maxSegs = o.maxSegs || 160;
  function walk(p, goalList, depth, t0, steps, w) {
    let [x, y, z] = p, t = t0, hx = 0, hy = 0, hz = 0, g = 0;
    for (let n = 0; n < steps && segs.length < maxSegs; n++) {
      const goal = goalList[g];
      let gx = goal[0] - x, gy = goal[1] - y, gz = goal[2] - z; const gl = Math.hypot(gx, gy, gz) || 1e-9;
      if (depth === 0 && gl < step * 1.1) {   // reached a waypoint (or the goal: the leader has touched)
        segs.push({ a: [x, y, z], b: [goal[0], goal[1], goal[2]], depth, t, w }); x = goal[0]; y = goal[1]; z = goal[2]; t += LEADER_STEP_S;
        if (++g >= goalList.length) return t;
        continue;
      }
      gx /= gl; gy /= gl; gz /= gl;
      const pull = depth ? 0.45 : 1;
      let dx = gx * pull + (rnd() * 2 - 1) * jag + hx * 0.4, dy = gy * pull + (rnd() * 2 - 1) * jag + hy * 0.4, dz = gz * pull + (rnd() * 2 - 1) * jag + hz * 0.4;
      const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
      const len = step * (0.55 + 0.9 * rnd()) * (depth ? 0.75 : 1);
      const nx = x + dx * len, ny = y + dy * len, nz = z + dz * len;
      segs.push({ a: [x, y, z], b: [nx, ny, nz], depth, t, w });
      x = nx; y = ny; z = nz; hx = dx; hy = dy; hz = dz; t += LEADER_STEP_S * (0.6 + 0.8 * rnd());
      if (depth < 2 && rnd() < branch * (depth ? 0.45 : 1)) {   // a fork: off to one side, a few steps, weaker
        const r = step * (3 + 4 * rnd());
        const side = [x + (dx + (rnd() * 2 - 1) * 1.3) * r, y + (dy + (rnd() * 2 - 1) * 1.3) * r, z + (dz + (rnd() * 2 - 1) * 1.3) * r];
        walk([x, y, z], [side], depth + 1, t, 2 + Math.floor(rnd() * (depth ? 3 : 6)), w * 0.6);
      }
    }
    return t;
  }
  const tEnd = walk(from, goals, 0, 0, maxSteps, 1);
  return { segs, tEnd };
}

/** Brightness of one segment of a bolt `age` s after it started (0..~1.2). */
export function segLight(bolt, s, age) {
  if (age < s.t) return 0;
  let b = 0.2 * s.w + 0.22 * s.w * Math.exp(-(age - s.t) / 0.012);   // the leader: faint, its tip a little brighter as it advances (no lone bright dot)
  if (age < bolt.tEnd) return b;
  b = 0;
  for (let k = 0; k < bolt.strokes.length; k++) {
    const ts = bolt.strokes[k]; if (age < ts) break;
    const e = Math.exp(-(age - ts) / STROKE_TAU);
    b = Math.max(b, k === 0 ? e * (s.depth === 0 ? 1.15 : 0.5 * s.w) : s.depth === 0 ? 0.85 * e : 0);   // restrikes run down the trunk only
  }
  if (s.depth === 0) b = Math.max(b, 0.16 * Math.exp(-(age - bolt.tEnd) / AFTER_TAU));   // the channel's afterglow
  return b;
}

export function createLightning({ max = 4 } = {}) {
  const bolts = [];
  let flash = 0;
  return {
    /** a strike from `from` to `to` ([x, y, z]); o: { rnd, energy 0..1, via: waypoints, width, flash: how much it lights the body (1) } */
    strike(from, to, o = {}) {
      const rnd = o.rnd || Math.random, energy = Math.max(0, Math.min(1, o.energy ?? 0.7));
      const g = growBolt(from, to, rnd, o), strokes = [g.tEnd];
      const n = Math.floor(rnd() * (1 + 3 * energy));   // 0..3 restrikes, more when the music is wilder
      for (let k = 0; k < n; k++) strokes.push(strokes[strokes.length - 1] + 0.045 + 0.08 * rnd());
      if (bolts.length >= max) bolts.shift();
      bolts.push({ ...g, strokes, age: 0, energy, width: o.width || 0.004, lit: o.flash ?? 1, end: strokes[strokes.length - 1] + 0.6 });
    },
    /** advance; returns the light the bolts cast now (0.. for the body's glow) */
    step(dt) {
      dt = Math.max(0, Math.min(0.1, dt || 0)); flash = 0;
      for (let i = bolts.length - 1; i >= 0; i--) {
        const B = bolts[i]; B.age += dt;
        if (B.age > B.end) { bolts.splice(i, 1); continue; }
        for (const ts of B.strokes) if (B.age >= ts) flash = Math.max(flash, B.lit * B.energy * Math.exp(-(B.age - ts) / STROKE_TAU));
      }
      return flash;
    },
    /** the lit segments into out (9 floats each: a xyz, b xyz, width, brightness, depth), from segment `from` on; returns the count so far */
    write(out, cap, from = 0) {
      let n = from;
      for (const B of bolts) for (const s of B.segs) {
        if (n >= cap) return n;
        const b = segLight(B, s, B.age) * (0.55 + 0.45 * B.energy); if (b < 0.01) continue;
        const o = n * 9;
        out[o] = s.a[0]; out[o + 1] = s.a[1]; out[o + 2] = s.a[2]; out[o + 3] = s.b[0]; out[o + 4] = s.b[1]; out[o + 5] = s.b[2];
        out[o + 6] = B.width * (s.depth === 0 ? 1 : 0.6); out[o + 7] = b; out[o + 8] = s.depth; n++;
      }
      return n;
    },
    get flash() { return flash; }, get count() { return bolts.length; },
  };
}
