// being/dash/organism-proxy.mjs - a remote organism for the dashboard: it presents the interface the lab's views read
// (lab/prototypes/organism/view.mjs, groups.mjs, radial.mjs, body.mjs; lab/organism/analysis.mjs) from the snapshots ON
// sends (snap.organism, ~8 a second), so those views run unchanged. Watch only: lesion and poke do nothing.
//
// Contract (snap.organism):
//   static   (when it changed, else staticVersion): { version, N, pos(3N), type(N), isI(N), edges: { pre, post, w },
//            genomeLabel, earSpread, nOsc, extra?(4N), osc?(2N), seed? }
//   live     { t, rf(N) Hz, spikes (cell indices that spiked since the last snapshot), dead(N)|null,
//            resonators: { cells, hz, phase }|null, state: {...}, stats?, phys: { pos, slosh, modes, strain, omega? }, chrom? }
//   timing?  { impacts: [{ t, leadMs | braceMs | offsetMs, beatPhase, protection? }] }
// Between snapshots the rates are interpolated and each snapshot's spikes are released spread over the next interval,
// so the Live view stays continuous at the display's frame rate (one snapshot interval behind).

import { T } from '../../lab/organism/develop.mjs';

const f32 = (a, n) => (a instanceof Float32Array && (n == null || a.length === n) ? a : Float32Array.from(a || { length: n || 0 }));

export function createRemoteOrganism() {
  let dev = null, net = null, C = null, version = null, act = null, edgeCache = null;
  let prevRf = null, curRf = null, arrive = 0, interval = 0.125, tPrev = 0, tCur = 0, state = {}, stats = { born: 0, pruned: 0, sprouted: 0 };
  let res = null, phys = { pos: [0, 0, 0], slosh: [0, 0, 0], modes: [0, 0, 0, 0, 0], strain: 0, omega: [0, 0, 0] };
  let queue = { cells: new Int32Array(0), at: new Float32Array(0), next: 0 }, chromTarget = null, timing = null;
  const now = () => performance.now() / 1000;

  function setStatic(s) {
    const N = s.N | 0, type = Uint8Array.from(s.type), isI = Uint8Array.from(s.isI);
    const extra = s.extra && s.extra.length === 4 * N ? f32(s.extra) : new Float32Array(4 * N);
    let osc = s.osc && s.osc.length === 2 * N ? f32(s.osc) : new Float32Array(2 * N);
    dev = { N, pos: f32(s.pos, 3 * N), type, isI, extra, osc, seed: s.seed ?? 0, G: { earSpread: s.earSpread, nOsc: s.nOsc },
      label: s.genomeLabel || '', axons: [], syn: { pre: [], post: [], t: [] }, born: new Float32Array(N), birthPos: f32(s.pos, 3 * N) };
    const by = (t) => { const l = []; for (let i = 0; i < N; i++) if (type[i] === t) l.push(i); return Int32Array.from(l); };
    C = { ear: by(T.EAR), onset: by(T.ONSET), rough: by(T.ROUGH), sub: by(T.SUB), proprio: by(T.PROPRIO), inter: by(T.INTER), intero: by(T.INTERO), mod: by(T.MOD), motor: by(T.MOTOR), chrom: by(T.CHROM) };
    const e = s.edges || {}, pre = Int32Array.from(e.pre || []), post = Int32Array.from(e.post || []), w = f32(e.w || []);
    edgeCache = { pre, post, w, m: Math.min(pre.length, post.length, w.length) };
    const rf = new Float32Array(N), rbar = new Float32Array(N), dead = new Uint8Array(N);
    let OSC = Int32Array.from({ length: N }, (_, i) => i).filter((i) => osc[2 * i] > 0);
    net = { N, rf, rbar, dead, stats, OSC, edges: () => edgeCache, lesion() {}, resonators };
    prevRf = new Float32Array(N); curRf = new Float32Array(N); act = new Float32Array(N);
    queue = { cells: new Int32Array(0), at: new Float32Array(0), next: 0 };
    version = s.version; res = null;
  }
  function resonators() {
    if (res && res.cells && res.cells.length) return { cells: Int32Array.from(res.cells), hz: f32(res.hz), phase: f32(res.phase) };
    const cells = net.OSC; return { cells, hz: Float32Array.from(cells, (i) => dev.osc[2 * i]), phase: new Float32Array(cells.length) };
  }

  /** take one snap.organism; returns 'static' when the anatomy changed, 'live' for an ordinary update, null when unusable */
  function apply(o) {
    if (!o) return null;
    let changed = false;
    if (o.static && o.static.N > 0 && o.static.version !== version) { setStatic(o.static); changed = true; }
    if (!dev || (o.staticVersion != null && o.staticVersion !== version && !o.static)) return changed ? 'static' : null;
    const L = o.live; if (!L) return changed ? 'static' : null;
    const N = dev.N, t = now();
    // rates: the display eases from where it is now to the new snapshot over the next interval
    if (L.rf && L.rf.length === N) {
      if (arrive) interval = Math.min(0.5, Math.max(0.05, 0.8 * interval + 0.2 * (t - arrive)));
      prevRf.set(changed || !arrive ? L.rf : net.rf); curRf.set(L.rf); tPrev = changed || !arrive ? +L.t || 0 : org.time; tCur = +L.t || tPrev; arrive = t;
    }
    if (L.dead && L.dead.length === N) net.dead.set(L.dead);
    // spikes: released one by one at random moments over the next interval
    const sp = L.spikes || [], n = sp.length, left = queue.cells.length - queue.next, cells = new Int32Array(left + n), at = new Float32Array(left + n);
    cells.set(queue.cells.subarray(queue.next)); at.fill(t, 0, left);            // late ones from the previous snapshot go now
    const pairs = Array.from({ length: n }, (_, k) => [sp[k], t + interval * Math.random()]).sort((a, b) => a[1] - b[1]);
    pairs.forEach(([c, a], k) => { cells[left + k] = c; at[left + k] = a; });
    queue = { cells, at, next: 0 };
    if (L.state) { state = { ...L.state }; if (state.need == null && state.stimNeed != null) state.need = state.stimNeed; }
    if (L.stats) Object.assign(stats, L.stats);
    res = L.resonators || null;
    if (L.phys) phys = { pos: L.phys.pos || [0, 0, 0], slosh: L.phys.slosh || [0, 0, 0], modes: L.phys.modes || [0, 0, 0, 0, 0], strain: L.phys.strain ?? 0, omega: L.phys.omega || [0, 0, 0] };
    if (state.strain == null) state.strain = phys.strain;
    chromTarget = L.chrom && L.chrom.length === C.chrom.length ? L.chrom : null;
    if (o.timing) timing = o.timing;
    return changed ? 'static' : 'live';
  }

  /** advance the display: interpolate rates, decay the slow rate, ease the chromatophores (call once per frame) */
  function tick(dt) {
    if (!dev || !arrive) return;
    const u = Math.min(1, (now() - arrive) / interval), rf = net.rf, rb = net.rbar, k = 1 - Math.exp(-dt / 5);
    for (let i = 0; i < dev.N; i++) { rf[i] = prevRf[i] + u * (curRf[i] - prevRf[i]); rb[i] += k * (rf[i] - rb[i]); }
    // chromatophore expansion: the reported value when there is one, else spikes summed as organism.mjs does (tau 0.3 s)
    const dec = Math.exp(-dt / 0.3);
    C.chrom.forEach((i, q) => { act[i] = chromTarget ? act[i] + (1 - Math.exp(-dt / 0.12)) * (chromTarget[q] - act[i]) : act[i] * dec; });
  }

  /** spikes due by now, per cell, into out (Float32Array N); returns their total. Used by view.mjs in place of rate jumps. */
  function takeSpikes(out) {
    out.fill(0); if (!dev) return 0;
    const t = now(), q = queue; let tot = 0;
    while (q.next < q.cells.length && q.at[q.next] <= t) {
      const c = q.cells[q.next++]; if (c >= 0 && c < dev.N) { out[c]++; tot++; if (!chromTarget && dev.type[c] === T.CHROM) act[c] = Math.min(1, act[c] + 0.15); }
    }
    return tot;
  }

  const org = {
    get dev() { return dev; }, get net() { return net; }, get C() { return C; }, get act() { return act; }, get phys() { return phys; },
    get time() { return arrive ? tPrev + Math.min(1, (now() - arrive) / interval) * (tCur - tPrev) : 0; },
    rec: { motorSpikes: [], onsets: [], impacts: [] },
    state: () => state, takeSpikes, poke() {}, record() {},
  };
  return { org, apply, tick, get ready() { return !!dev && !!arrive; }, get version() { return version; }, get timing() { return timing; }, get label() { return dev ? dev.label : ''; } };
}
