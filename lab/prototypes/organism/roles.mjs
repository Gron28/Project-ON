// lab/prototypes/organism/roles.mjs - what each group of cells does, measured rather than assumed. Over a rolling window
// (~20 s, exponential) it keeps, per cell: its mean rate, its spikes around each impact (the rising edges of the ear's
// onset, 'hits'; a peri-event histogram from -300 to +300 ms) and its phase in the being's beat (vector strength). Per
// group it then reads: what feeds it (the summed weight x presynaptic rate of every link into it, by kind of sender), where
// it sends (the same flow out, by kind of receiver), and when it fires relative to hits and beats. From those it gives a
// short plain role ('Low-sound listener', 'Beat-keeper', ...) and a one-line explanation. Keeping the measures per cell
// means they survive the areas being found again. Timing needs exact spike times (observe({ exact: true })); without
// them only the input and output mixes are used. Pure (no DOM, no three.js); the Diagram view (view.mjs) uses it.
//
//   const R = createRoles(); R.reset(N); R.setGroups(G, links);
//   R.observe({ cells, times, impacts: [{ t, lead? }], beats: [{ t, ph }], exact });   R.update(org.time, rf);
//   R.describe() -> per group { title, sub, line, stage, stageWhy, timing, input: [[label, share]], output: [[label, share]] }

const BIN = 0.02, W = 0.3, NB = Math.round((2 * W) / BIN), TAU = 20, RING = 1 << 15;
const BANDS = ['low sounds', 'low-mid sounds', 'mid-high sounds', 'high sounds'];
const SENSE_KEYS = new Set(['ear0', 'ear1', 'ear2', 'ear3', 'onset', 'rough', 'sub', 'proprio']);
const FEEL_KEYS = new Set(['intero', 'mod']);

/** the kind of sender or receiver a group is, for the input and output mixes */
export const catOf = (g) => (g.kind === 'area' ? 'area' : g.key);
const NAME = { ear0: 'low sounds', ear1: 'low-mid sounds', ear2: 'mid-high sounds', ear3: 'high sounds', onset: 'sound onsets', rough: 'roughness', sub: 'sub-bass', proprio: 'its body bending', intero: 'its needs', mod: 'the feeling core', motor: 'the muscles', chrom: 'the skin' };
const SHORT = { ear0: 'low ear', ear1: 'low-mid ear', ear2: 'mid-high ear', ear3: 'high ear', onset: 'onsets', rough: 'roughness', sub: 'sub-bass', proprio: 'body sense', intero: 'needs', mod: 'feeling core', motor: 'muscles', chrom: 'skin' };
const nameOf = (g) => (g.kind === 'area' ? g.name : SHORT[g.key] || g.name);
const pct = (x) => Math.round(100 * x) + '%';

export function createRoles() {
  let N = 0, slow = null, psth = null, vsC = null, vsS = null, vsN = null, nImp = 0, tLast = NaN, primed = false;
  let G = null, links = [], inL = [], outL = [], stage = [];
  const rc = new Int32Array(RING), rt = new Float64Array(RING); let head = 0, count = 0, tLatest = -Infinity;
  let pending = [], lastImp = -Infinity, leads = [], beatT = NaN, beatPh = 0, period = 0, exact = false;

  function reset(n) {
    N = n; slow = new Float32Array(N); psth = new Float32Array(N * NB); vsC = new Float32Array(N); vsS = new Float32Array(N); vsN = new Float32Array(N);
    nImp = 0; tLast = NaN; primed = false; head = 0; count = 0; tLatest = -Infinity; pending = []; lastImp = -Infinity; leads = []; beatT = NaN; period = 0;
  }
  /** the groups (groups.mjs) and the links between them (groupLinks); also each area's stage, from its wiring */
  function setGroups(g, l) {
    G = g; links = l; inL = G.groups.map(() => []); outL = G.groups.map(() => []);
    for (const k of links) { inL[k.b].push(k); outL[k.a].push(k); }
    stage = G.groups.map((g2, id) => stageOf(g2, id));
  }
  // senses 0, listeners 1 (areas fed mostly by the senses, by weight), integrators 2, feeling core 3, muscles and skin 4
  function stageOf(g, id) {
    if (g.kind === 'sense') return 0;
    if (g.kind === 'core') return 3;
    if (g.kind === 'effector') return 4;
    // by what actually feeds it (weight x rate over the window) once that is known, else by weight alone
    let s = 0, all = 0;
    for (const k of inL[id]) { let f = 0; if (primed) for (let q = 0; q < k.pre.length; q++) f += k.wk[q] * slow[k.pre[q]]; else f = k.w; all += f; if (G.groups[k.a].kind === 'sense') s += f; }
    return all > 0 && s / all >= (primed ? 0.45 : 0.35) ? 1 : 2;
  }

  /** new spikes (cells, times in organism seconds), impacts, beat-phase samples */
  function observe(ev) {
    if (!ev || !N) return;
    if (ev.exact != null) exact = !!ev.exact;
    for (const b of ev.beats || []) {
      if (!Number.isFinite(b.t) || !Number.isFinite(b.ph)) continue;
      const dt = b.t - beatT;
      if (dt > 0.02 && dt < 1) { const d = (((b.ph - beatPh) % 1) + 1) % 1, p = d > 0.01 ? dt / d : 0; if (p > 0.25 && p < 2) period = period ? 0.85 * period + 0.15 * p : p; }
      else if (!(dt > 0)) period = 0;
      beatT = b.t; beatPh = b.ph;
    }
    const cells = ev.cells || [], times = ev.times || [], n = Math.min(cells.length, times.length);
    for (let k = 0; k < n; k++) {
      const c = cells[k], t = times[k]; if (c < 0 || c >= N || !Number.isFinite(t)) continue;
      if (t < tLatest - 2) { count = 0; pending = []; lastImp = -Infinity; }   // time ran backwards: a replay or a new run
      rc[head] = c; rt[head] = t; head = (head + 1) & (RING - 1); if (count < RING) count++;
      if (t > tLatest || count === 1) tLatest = t;
      if (period > 0 && Number.isFinite(beatT) && Math.abs(t - beatT) < 2) {
        const a = 2 * Math.PI * (beatPh + (t - beatT) / period); vsC[c] += Math.cos(a); vsS[c] += Math.sin(a); vsN[c] += 1;
      }
    }
    const imps = (ev.impacts || []).filter((im) => Number.isFinite(im.t));
    if (imps.length && Math.max(...imps.map((im) => im.t)) < lastImp - 5) lastImp = -Infinity;   // a new run
    for (const im of imps) {
      if (im.t <= lastImp + 1e-4) continue;
      lastImp = im.t; pending.push(im);
    }
    // an impact is counted once the spikes after it have arrived
    while (pending.length && tLatest >= pending[0].t + W + 0.02) {
      const im = pending.shift(); nImp += 1;
      if (Number.isFinite(im.lead)) { leads.push(im.lead); if (leads.length > 40) leads.shift(); }
      for (let q = 0; q < count; q++) {
        const j = (head - 1 - q + RING) & (RING - 1), d = rt[j] - im.t + W;
        if (d >= 0 && d < 2 * W) psth[rc[j] * NB + Math.floor(d / BIN)] += 1;
      }
    }
    if (pending.length > 64) pending.splice(0, pending.length - 64);
  }

  /** the slow rates and the window's decay, by the organism's own clock */
  function update(t, rf) {
    if (!N || !rf) return;
    if (!primed) { slow.set(rf.subarray ? rf.subarray(0, N) : rf); primed = true; tLast = t; return; }
    const dt = t - tLast; tLast = t;
    if (!(dt > 0) || dt > 5) return;
    const k = Math.exp(-dt / TAU), u = 1 - k;
    for (let i = 0; i < N; i++) { slow[i] += u * (rf[i] - slow[i]); vsC[i] *= k; vsS[i] *= k; vsN[i] *= k; }
    for (let q = 0; q < psth.length; q++) psth[q] *= k;
    nImp *= k;
  }

  /** when a group fires relative to hits and to the beat */
  function timingOf(g) {
    const out = { rate: 0, hits: null, beat: null };
    let base = 0; for (const i of g.cells) base += slow[i];
    out.rate = base / g.cells.length;
    if (!exact) return out;   // spikes dated only to their snapshot (~125 ms) would put every group at the same false latency
    if (nImp >= 4 && base > 0.05) {
      const h = new Float32Array(NB); for (const i of g.cells) for (let b = 0; b < NB; b++) h[b] += psth[i * NB + b];
      const e = base * nImp * BIN;   // expected count per bin at the mean rate
      let best = -1, bz = 0, br = 0;
      for (let b = 1; b < NB - 1; b++) { const s = h[b - 1] + h[b] + h[b + 1], z = (s - 3 * e) / Math.sqrt(3 * e + 1), r = s / (3 * e); if (z > bz) { bz = z; br = r; best = b; } }
      if (best >= 0 && bz > 3 && br > 1.25) {   // the peak's latency: the centroid of its three bins above the mean rate
        let m = 0, wsum = 0; for (let j = -1; j <= 1; j++) { const x = Math.max(0, h[best + j] - e); m += x * (-W + (best + j + 0.5) * BIN); wsum += x; }
        out.hits = { ms: Math.round((1000 * m) / (wsum || 1)), gain: br, z: bz };
      }
    }
    if (period > 0) {
      let C = 0, S = 0, n = 0; for (const i of g.cells) { C += vsC[i]; S += vsS[i]; n += vsN[i]; }
      const R = n > 0 ? Math.hypot(C, S) / n : 0;
      if (n > 30 && R > 0.12 && n * R * R > 12) { let ph = Math.atan2(S, C) / (2 * Math.PI); if (ph > 0.5) ph -= 1; if (ph <= -0.5) ph += 1; out.beat = { vs: R, ms: Math.round(1000 * ph * period), period }; }
    }
    return out;
  }
  function mix(list, side) {
    const m = new Map(); let all = 0;
    for (const k of list) {
      let f = 0; for (let q = 0; q < k.pre.length; q++) f += k.wk[q] * slow[k.pre[q]];
      if (!(f > 0)) continue;
      const g = G.groups[side === 'in' ? k.a : k.b], key = g.kind === 'area' ? 'area:' + g.id : g.key;
      m.set(key, (m.get(key) || 0) + f); all += f;
    }
    return { all, parts: [...m].map(([key, f]) => [key, all > 0 ? f / all : 0]).sort((a, b) => b[1] - a[1]) };
  }
  const labelOf = (key) => (key.startsWith('area:') ? G.groups[+key.slice(5)].name : SHORT[key] || key);
  const when = (ms, what) => (Math.abs(ms) < 15 ? `fires on the ${what}` : `fires ~${Math.abs(ms)} ms ${ms < 0 ? 'before' : 'after'} the ${what}`);
  const list = (parts, n = 2, min = 0.12) => parts.filter(([, s], k) => k === 0 || s >= min).slice(0, n);

  /** each group's role now */
  function describe() {
    if (!G) return [];
    return G.groups.map((g, id) => {
      const tm = timingOf(g), inp = mix(inL[id], 'in'), out = mix(outL[id], 'out'), n = g.cells.length;
      const share = (pred) => inp.parts.reduce((s, [k, v]) => s + (pred(k) ? v : 0), 0), outShare = (key) => out.parts.reduce((s, [k, v]) => s + (k === key ? v : 0), 0);
      const sense = share((k) => SENSE_KEYS.has(k)), feel = share((k) => FEEL_KEYS.has(k));
      // in words, the ear's bands count as one 'sound' input unless one band dominates
      const earAll = inp.parts.filter(([k]) => k.startsWith('ear')), earTot = earAll.reduce((a, [, v]) => a + v, 0);
      const merged = earAll.length && earAll[0][1] < 0.6 * earTot ? [...inp.parts.filter(([k]) => !k.startsWith('ear')), ['sound', earTot]].sort((a, b) => b[1] - a[1]) : inp.parts;
      const from = list(merged).map(([k, s]) => `${k === 'sound' ? 'sound (all ears)' : labelOf(k)} ${pct(s)}`).join(', '), to = list(out.parts, 2, 0.15).map(([k]) => labelOf(k)).join(', ');
      const flow = (from ? 'from ' + from : 'no input yet') + (to ? ' → ' + to : '');
      const hz = tm.rate < 10 ? tm.rate.toFixed(1) : Math.round(tm.rate) + '';
      let title, line, timing = '';
      // latency is read against the hits (the same clock as the spikes); the beat phase comes from the being's shown pulse,
      // which is drawn ahead by the display latency, so against the beat only the locking is used, not its offset
      if (tm.hits) timing = when(tm.hits.ms, 'hits'); else if (tm.beat) timing = 'keeps the beat';
      const leadsHits = tm.hits && tm.hits.ms <= -20;
      if (g.kind === 'sense') {
        title = g.key.startsWith('ear') ? `Ear · ${BANDS[+g.key[3]].replace(' sounds', '')} notes` : { onset: 'Hit sense', rough: 'Roughness sense', sub: 'Bass touch', proprio: 'Body sense' }[g.key];
        const does = g.key.startsWith('ear') ? `hears ${g.name.replace('ear ', '')}` : { onset: 'fires when a sound starts', rough: 'feels harsh, rough sound', sub: 'feels sub-bass on the skin', proprio: 'feels its body being bent' }[g.key];
        line = `${does}${to ? ' → ' + to : ''}`;
      } else if (g.key === 'intero') {
        title = 'Need sensors'; line = `${g.link.replace('feels', 'feel')} inside it${to ? ' → ' + to : ''}`;
      } else if (g.key === 'mod') {
        title = 'Feeling core'; line = `broadcasts surprise (a hit went better or worse than expected) to every synapse, steering learning${from ? ' · from ' + from : ''}`;
      } else if (g.key === 'motor') {
        title = 'Muscles';
        const L = leads.filter((x) => Math.abs(x) < 240).sort((a, b) => a - b), med = L.length >= 3 ? L[L.length >> 1] : NaN;   // a peak at the window's edge is no peak
        line = `brace the body for hits${Number.isFinite(med) ? `; bracing peaks ~${Math.abs(Math.round(med))} ms ${med >= 0 ? 'before' : 'after'} the hit` : ''}${from ? ' · from ' + from : ''}`;
      } else if (g.key === 'chrom') {
        title = 'Skin'; line = `colours the body${from ? ' · from ' + from : ''}`;
      } else {
        // an area: what it measurably does
        const motorOut = outShare('motor') + outShare('chrom');
        const top = inp.parts.find(([k]) => SENSE_KEYS.has(k)), ears = inp.parts.filter(([k]) => k.startsWith('ear')), earSum = ears.reduce((s, [, v]) => s + v, 0);
        if (tm.rate < 0.3) { title = 'Quiet area'; timing = ''; }
        else if (leadsHits && (motorOut >= 0.2 || tm.beat)) title = 'Beat-keeper';
        else if (leadsHits) title = 'Predictor';
        else if (sense >= 0.45 && top) {
          if (earSum >= Math.max(0, ...inp.parts.filter(([k]) => SENSE_KEYS.has(k) && !k.startsWith('ear')).map(([, v]) => v))) { const [bk, bv] = ears[0]; title = bv >= 0.6 * earSum ? `${BANDS[+bk[3]][0].toUpperCase()}${BANDS[+bk[3]].slice(1, -1)} listener` : 'Sound listener'; }
          else title = { onset: 'Hit detector', rough: 'Roughness listener', sub: 'Bass-feel listener', proprio: 'Body-sense area' }[top[0]] || 'Sound listener';
        } else if (feel >= 0.4) title = 'Need-driven area';
        else if (outShare('motor') >= 0.5) title = 'Motor driver';
        else if (outShare('chrom') >= 0.5) title = 'Skin painter';
        else if (outShare('mod') >= 0.4) title = 'Reporter to the core';
        else title = 'Integrator';
        line = flow;
      }
      if (timing && g.kind === 'area') line = `${timing} · ${line}`;
      else if (timing && g.kind !== 'sense') line = `${line} · ${timing}`;
      const sub = `${g.kind === 'area' ? g.name + ' · ' : ''}${n} cells · ${hz} Hz`;
      return { title, sub, line, stage: stage[id], timing: tm, input: inp.parts.map(([k, s]) => [labelOf(k), s]), output: out.parts.map(([k, s]) => [labelOf(k), s]), inFlow: inp };
    });
  }
  /** each link's live share of its receiver's input (0..1), for the arrows' labels */
  function linkShares() {
    if (!G) return new Map();
    const tot = new Float64Array(G.groups.length), f = links.map((k) => { let s = 0; for (let q = 0; q < k.pre.length; q++) s += k.wk[q] * slow[k.pre[q]]; tot[k.b] += s; return s; });
    return new Map(links.map((k, q) => [k, tot[k.b] > 0 ? f[q] / tot[k.b] : 0]));
  }

  return { reset, setGroups, observe, update, describe, linkShares, stageOf: (id) => stage[id], get impacts() { return nImp; }, get exact() { return exact; }, get period() { return period; } };
}

export const STAGES = [
  { title: 'Senses', cap: 'turn sound and the body’s motion into spikes' },
  { title: 'Listeners', cap: 'areas fed mostly by the senses' },
  { title: 'Integrators', cap: 'areas that combine other areas; some fire ahead of the beat' },
  { title: 'Feeling core', cap: 'feels its needs and how hits went; its signal steers learning' },
  { title: 'Muscles & skin', cap: 'brace the body against hits, colour its skin' },
];
