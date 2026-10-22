// lab/prototypes/organism/groups.mjs - the organism's functional groups for the Diagram view: ear receptors by band, the
// other senses, the areas found by community detection (interneurons only), the interoceptive and modulatory cells of the
// nucleus, and the effectors. flowLayout() places them as a left-to-right flow in five stages (senses, listeners,
// integrators, feeling core, muscles and skin; roles.mjs says which stage an area is in), each group a card: its block of
// cells on the left, its text to the right. Reads the organism, never drives it.

import { T, MILIEU_VARS } from '../../organism/develop.mjs';

const BANDS = [[0, 6], [7, 13], [14, 20], [21, 27]];
const hz = (u) => 55 * 2 ** (u / 4), fmtHz = (f) => (f >= 1000 ? (f / 1000).toFixed(1) + 'k' : Math.round(f) + '');
export const SENSE_KEYS = ['ear0', 'ear1', 'ear2', 'ear3', 'onset', 'rough', 'sub', 'proprio'];

/** groups: [{ key, name, kind: 'sense' | 'area' | 'core' | 'effector', cells: Int32Array, col (hex), link }] and of[i] */
export function buildGroups(org, member, depthArr, areaColor, typeCol) {
  const d = org.dev, N = d.N, of = new Int16Array(N).fill(-1), groups = [];
  const add = (key, name, kind, cells, col, link) => { if (!cells.length) return; const g = { key, name, kind, cells: Int32Array.from(cells), col, link, id: groups.length }; for (const i of cells) of[i] = g.id; groups.push(g); };
  const ofType = (t) => { const l = []; for (let i = 0; i < N; i++) if (d.type[i] === t) l.push(i); return l; };
  const ear = ofType(T.EAR), shade = [0xc98a2e, 0xe8a83d, 0xf4c45a, 0xffe08a];
  BANDS.forEach(([a, b], k) => add('ear' + k, `ear ${fmtHz(hz(a))}–${fmtHz(hz(b))} Hz`, 'sense', ear.filter((i) => d.extra[4 * i] >= a && d.extra[4 * i] <= b), shade[k], 'feeds stimulation'));
  add('onset', 'onset', 'sense', ofType(T.ONSET), typeCol[T.ONSET], 'feeds stimulation');
  add('rough', 'roughness', 'sense', ofType(T.ROUGH), typeCol[T.ROUGH], 'feeds stimulation');
  add('sub', 'sub-bass touch', 'sense', ofType(T.SUB), typeCol[T.SUB], 'feeds stimulation');
  add('proprio', 'proprioception', 'sense', ofType(T.PROPRIO), typeCol[T.PROPRIO], 'feels strain');
  // areas: interneurons by community; areas under 8 interneurons fold into one 'scattered' group
  const inter = ofType(T.INTER), byC = new Map();
  for (const i of inter) { const c = member ? member[i] : 0; if (!byC.has(c)) byC.set(c, []); byC.get(c).push(i); }
  const big = [...byC].filter(([, l]) => l.length >= 8).sort((a, b) => b[1].length - a[1].length).slice(0, 10), rest = [];
  const bigSet = new Set(big.map(([c]) => c));
  for (const [c, l] of byC) if (!bigSet.has(c)) rest.push(...l);
  for (const [c, l] of big) add('area' + c, `area ${c + 1}`, 'area', l, areaColor(c), 'spends energy');
  if (rest.length) add('scattered', 'scattered interneurons', 'area', rest, 0x6a717b, 'spends energy');
  const intero = ofType(T.INTERO), feels = [0, 0, 0]; for (const i of intero) feels[d.extra[4 * i] | 0]++;
  add('intero', 'interoceptors', 'core', intero, typeCol[T.INTERO], 'feels ' + MILIEU_VARS.filter((_, v) => feels[v]).join(', '));
  add('mod', 'modulatory', 'core', ofType(T.MOD), typeCol[T.MOD], 'feels impact outcome');
  add('motor', 'motor', 'effector', ofType(T.MOTOR), typeCol[T.MOTOR], 'braces: guards integrity');
  add('chrom', 'chromatophores', 'effector', ofType(T.CHROM), typeCol[T.CHROM], 'costs energy');
  // mean depth (hops from the senses) and anatomical centroid of each group
  for (const g of groups) {
    let h = 0, hn = 0, x = 0, y = 0, z = 0;
    for (const i of g.cells) { x += d.pos[3 * i]; y += d.pos[3 * i + 1]; z += d.pos[3 * i + 2]; if (depthArr && depthArr[i] >= 0) { h += depthArr[i]; hn++; } }
    const n = g.cells.length; g.c = [x / n, y / n, z / n]; g.hops = hn ? h / hn : NaN;
  }
  layout(groups);
  return { groups, of };
}

/** schematic positions: g.p (block centre) and g.rb (block radius) */
function layout(groups) {
  const ring = (list, R, y, phase) => {
    // keep each group's anatomical azimuth order, then space them evenly so blocks never overlap
    const s = list.map((g) => [Math.atan2(g.c[2], g.c[0]), g]).sort((a, b) => a[0] - b[0]);
    s.forEach(([, g], k) => { const a = phase + (2 * Math.PI * k) / s.length; g.p = [R * Math.cos(a), y, R * Math.sin(a)]; });
  };
  for (const g of groups) g.rb = 0.03 + 0.021 * Math.cbrt(g.cells.length);
  ring(groups.filter((g) => g.kind === 'sense'), 1.12, 0.62, 0);
  const areas = groups.filter((g) => g.kind === 'area'), hs = areas.map((g) => g.hops).filter(Number.isFinite);
  const h0 = hs.length ? Math.min(...hs) : 1, h1 = hs.length ? Math.max(...hs) : 2;
  ring(areas, 0.72, 0, Math.PI / areas.length);
  for (const g of areas) {   // deeper (more hops from the senses): lower and nearer the axis
    const u = Number.isFinite(g.hops) && h1 > h0 ? (g.hops - h0) / (h1 - h0) : 0.5, k = 1.05 - 0.25 * u;
    g.p = [g.p[0] * k, 0.26 - 0.4 * u, g.p[2] * k];
  }
  const core = groups.filter((g) => g.kind === 'core');
  core.forEach((g, k) => { g.p = [core.length > 1 ? (k ? 0.13 : -0.13) : 0, -0.12, 0]; });
  ring(groups.filter((g) => g.kind === 'effector'), 0.42, -0.5, Math.PI / 2);
}

/** the flow: stage s in column s (x), groups stacked in it (y), ordered so links cross little (senses keep their order;
 *  the rest by the mean height of what feeds them). Sets g.p, g.rb, g.stage; returns the frame (world units). */
export const FLOW = { col: 1.5, card: 1.22, rbMax: 0.11 };
/** aspect: the view's width / height, so the rows use the height there is */
export function flowLayout(G, links, stageOf, aspect = 1.8) {
  const cols = [[], [], [], [], []];
  for (const g of G.groups) { g.stage = stageOf(g.id); cols[g.stage].push(g); }
  // an empty stage takes no column
  const colX = []; let used = 0; for (let s = 0; s < 5; s++) { colX[s] = used * FLOW.col; if (cols[s].length) used++; }
  const maxN = Math.max(1, ...cols.map((c) => c.length)), W = (used - 1) * FLOW.col + FLOW.card + 0.2, row = Math.max(0.28, Math.min(0.6, (W / aspect - 0.6) / maxN));
  const y = new Map(), place = (c, s) => { c.forEach((g, k) => { g.p = [colX[s], ((c.length - 1) / 2 - k) * row, 0]; y.set(g.id, g.p[1]); }); };
  place(cols[0], 0);
  for (let s = 1; s < 5; s++) {
    const bary = (g) => { let a = 0, w = 0; for (const l of links) if (l.b === g.id && y.has(l.a)) { a += l.w * y.get(l.a); w += l.w; } return w ? a / w : 0; };
    const b = new Map(cols[s].map((g) => [g.id, bary(g)])); cols[s].sort((p, q) => b.get(q.id) - b.get(p.id));
    place(cols[s], s);
  }
  for (const g of G.groups) g.rb = Math.min(FLOW.rbMax, 0.4 * row, 0.03 + 0.019 * Math.cbrt(g.cells.length));
  const top = ((maxN - 1) / 2) * row + 0.5 * row;
  return { row, top, aspect, colX, cols: cols.map((c) => c.length), x0: -FLOW.rbMax - 0.05, x1: (used - 1) * FLOW.col + FLOW.card, y0: -top, y1: top + 0.5 };
}

/** cell positions inside their block: a Fibonacci ball, cells ordered by anatomical radius (deep cells inside) */
export function diagramPositions(org, G) {
  const d = org.dev, out = new Float32Array(3 * d.N), ga = Math.PI * (3 - Math.sqrt(5));
  for (const g of G.groups) {
    const n = g.cells.length, cells = [...g.cells].sort((a, b) => rad(d, a) - rad(d, b));
    cells.forEach((i, k) => {
      const r = (g.rb - 0.02) * Math.cbrt((k + 0.5) / n), y = 1 - (2 * (k + 0.5)) / n, s = Math.sqrt(Math.max(0, 1 - y * y)), a = k * ga;
      out[3 * i] = g.p[0] + r * s * Math.cos(a); out[3 * i + 1] = g.p[1] + r * y; out[3 * i + 2] = g.p[2] + r * s * Math.sin(a);
    });
  }
  for (let i = 0; i < d.N; i++) if (G.of[i] < 0) { out[3 * i] = d.pos[3 * i]; out[3 * i + 1] = d.pos[3 * i + 1]; out[3 * i + 2] = d.pos[3 * i + 2]; }
  return out;
}
const rad = (d, i) => Math.hypot(d.pos[3 * i], d.pos[3 * i + 1], d.pos[3 * i + 2]);

/** summed weights between groups (directed, within-group excluded): [{ a, b, w, edges: Int32Array of edge indices }] */
export function groupLinks(G, e) {
  const m = new Map();
  for (let k = 0; k < e.m; k++) {
    const a = G.of[e.pre[k]], b = G.of[e.post[k]]; if (a < 0 || b < 0 || a === b) continue;
    const key = a * 256 + b; let o = m.get(key); if (!o) m.set(key, (o = { a, b, w: 0, list: [] })); o.w += e.w[k]; o.list.push(k);
  }
  return [...m.values()].map((o) => ({ a: o.a, b: o.b, w: o.w, pre: Int32Array.from(o.list, (k) => e.pre[k]), wk: Float32Array.from(o.list, (k) => e.w[k]) })).sort((x, y) => y.w - x.w);
}
