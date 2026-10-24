// lab/prototypes/organism/radial.mjs - the radial depth profile: where each kind of cell sits between the nucleus (0) and
// the skin (1), and integration depth (synaptic hops from the senses) against radius for the interneurons, so one can see
// whether integration moves toward the centre. Canvas 2D, a hover readout on both charts. Reads the organism only.

import { T } from '../../organism/develop.mjs';

const ROWS = [
  ['ear', (d, i) => d.type[i] === T.EAR, '#f0b048'], ['onset · rough', (d, i) => d.type[i] === T.ONSET || d.type[i] === T.ROUGH, '#ffe070'],
  ['sub · proprio', (d, i) => d.type[i] === T.SUB || d.type[i] === T.PROPRIO, '#8fd16a'],
  ['inter E', (d, i) => d.type[i] === T.INTER && !d.isI[i] && !(d.osc && d.osc[2 * i] > 0), '#c9ced6'], ['inter I', (d, i) => d.type[i] === T.INTER && d.isI[i], '#5a7dff'],
  ['resonators', (d, i) => d.type[i] === T.INTER && d.osc && d.osc[2 * i] > 0 && !d.isI[i], '#e0d050'],
  ['intero', (d, i) => d.type[i] === T.INTERO, '#ff8fb1'], ['modulatory', (d, i) => d.type[i] === T.MOD, '#c58cff'],
  ['motor', (d, i) => d.type[i] === T.MOTOR, '#ff7a3d'], ['chromatoph.', (d, i) => d.type[i] === T.CHROM, '#3fd0c9'],
];

export function createRadial(host) {
  host.innerHTML = `<div class="thead"><b>Where each kind sits</b><span>nucleus 0 → skin 1</span></div><canvas id="radA" style="height:152px"></canvas>
    <div class="thead" style="margin-top:8px"><b>Integration depth vs radius</b><span>interneurons</span></div><canvas id="radB" style="height:130px"></canvas><p class="k" id="radNote"></p>`;
  const A = host.querySelector('#radA'), B = host.querySelector('#radB'), note = host.querySelector('#radNote');
  let data = null, hover = null;
  const fit = (cv) => { const dpr = Math.min(2, devicePixelRatio), w = cv.clientWidth, h = cv.clientHeight; if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; } const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h); return [g, w, h]; };
  const L = 74, R = 8;

  /** org, depth array (hops, -1 unreachable), community member array, optional radialProfile() result, colour per community */
  function set(org, dep, member, prof, areaCol) {
    const d = org.dev, N = d.N, rad = new Float32Array(N);
    for (let i = 0; i < N; i++) rad[i] = Math.hypot(d.pos[3 * i], d.pos[3 * i + 1], d.pos[3 * i + 2]);
    const rows = ROWS.map(([name, f, col]) => { const cells = []; for (let i = 0; i < N; i++) if (!org.net.dead[i] && f(d, i)) cells.push(i); const s = cells.map((i) => rad[i]).sort((a, b) => a - b); return { name, col, cells, med: s.length ? s[s.length >> 1] : NaN }; }).filter((r) => r.cells.length);
    const pts = []; for (let i = 0; i < N; i++) if (d.type[i] === T.INTER && !org.net.dead[i] && dep[i] >= 0) pts.push(i);
    // mean hops per radial bin (from analysis.radialProfile when present, else computed here)
    let bins = prof && prof.rows ? prof.rows.map((r) => ({ r: (r.r[0] + r.r[1]) / 2, h: r.hops, n: r.n })) : null;
    if (!bins) { bins = []; for (let b = 0; b < 6; b++) { const lo = b / 6, hi = (b + 1) / 6, l = pts.filter((i) => rad[i] >= lo && rad[i] < hi); bins.push({ r: (lo + hi) / 2, h: l.length ? l.reduce((s, i) => s + dep[i], 0) / l.length : NaN, n: l.length }); } }
    let corr = prof ? prof.corrHops : NaN;
    if (!Number.isFinite(corr) && pts.length > 2) { const x = pts.map((i) => rad[i]), y = pts.map((i) => dep[i]), mx = x.reduce((a, b) => a + b) / x.length, my = y.reduce((a, b) => a + b) / y.length; let sxy = 0, sxx = 0, syy = 0; x.forEach((v, k) => { sxy += (v - mx) * (y[k] - my); sxx += (v - mx) ** 2; syy += (y[k] - my) ** 2; }); corr = sxy / Math.sqrt(sxx * syy + 1e-12); }
    data = { d, rad, dep, rows, pts, bins, corr, conv: prof ? prof.corrConv : NaN, member, areaCol, jit: Float32Array.from({ length: N }, (_, i) => ((i * 2654435761) >>> 0) / 4294967296 - 0.5) };
    const c = corr, cv = data.conv;
    note.textContent = Number.isFinite(c)
      ? `r(radius, hops) = ${c.toFixed(2)}: ${c < -0.1 ? 'cells nearer the nucleus are more hops from the senses: integration moves inward' : c > 0.1 ? 'cells nearer the skin are more hops from the senses: integration moves outward' : 'no radial trend in integration depth'}${Number.isFinite(cv) ? ` · r(radius, convergence of senses) = ${cv.toFixed(2)}` : ''}.`
      : 'Not enough reachable interneurons to measure.';
    draw();
  }
  function draw() {
    if (!data) return;
    // A: one row per kind, every cell a dot at its radius, the median as a tick
    {
      const [g, w, h] = fit(A), rh = (h - 14) / ROWS.length, X = (r) => L + (w - L - R) * Math.min(1, r);
      g.strokeStyle = '#ffffff12'; g.lineWidth = 1; g.beginPath(); for (const r of [0, 0.25, 0.5, 0.75, 1]) { g.moveTo(X(r) + 0.5, 0); g.lineTo(X(r) + 0.5, h - 12); } g.stroke();
      g.font = '10px system-ui'; g.textBaseline = 'middle';
      data.rows.forEach((row, k) => {
        const y = 4 + rh * (k + 0.5);
        g.fillStyle = hover && hover.row === k ? '#e8e6e0' : '#a3a9b2'; g.fillText(row.name, 2, y);
        g.fillStyle = row.col; g.globalAlpha = 0.55;
        for (const i of row.cells) { g.beginPath(); g.arc(X(data.rad[i]), y + data.jit[i] * (rh - 4), 1.6, 0, 7); g.fill(); }
        g.globalAlpha = 1; if (Number.isFinite(row.med)) { g.fillStyle = '#e8e6e0'; g.fillRect(X(row.med) - 1, y - rh / 2 + 1, 2, rh - 2); }
      });
      g.fillStyle = '#6c737d'; g.textBaseline = 'bottom'; g.textAlign = 'center';
      for (const r of [0, 0.5, 1]) g.fillText(r === 0 ? 'nucleus' : r === 1 ? 'skin' : '0.5', X(r) + (r === 0 ? 16 : r === 1 ? -8 : 0), h); g.textAlign = 'left';
      if (hover && hover.cv === A && hover.row >= 0 && data.rows[hover.row]) { const row = data.rows[hover.row]; g.fillStyle = '#e8e6e0'; g.textBaseline = 'top'; g.fillText(`${row.cells.length} cells · median radius ${row.med.toFixed(2)}`, L, 0); }
    }
    // B: hops vs radius, dots coloured by area, the mean per radial bin as a line
    {
      const [g, w, h] = fit(B), hm = Math.max(3, ...data.pts.map((i) => data.dep[i])), X = (r) => L + (w - L - R) * Math.min(1, r), Y = (v) => h - 14 - (h - 22) * (v / hm);
      g.strokeStyle = '#ffffff12'; g.lineWidth = 1; g.beginPath(); for (let v = 0; v <= hm; v++) { g.moveTo(L, Y(v) + 0.5); g.lineTo(w - R, Y(v) + 0.5); } g.stroke();
      g.font = '10px system-ui'; g.fillStyle = '#6c737d'; g.textBaseline = 'middle'; for (let v = 0; v <= hm; v++) g.fillText(v + (v === hm ? ' hops' : ''), L - 30, Y(v));
      g.textBaseline = 'bottom'; g.textAlign = 'center'; for (const r of [0, 0.5, 1]) g.fillText(r === 0 ? 'nucleus' : r === 1 ? 'skin' : '0.5', X(r) + (r === 0 ? 16 : r === 1 ? -8 : 0), h); g.textAlign = 'left';
      g.globalAlpha = 0.6;
      for (const i of data.pts) { g.fillStyle = data.member ? data.areaCol(data.member[i]) : '#c9ced6'; g.beginPath(); g.arc(X(data.rad[i]), Y(data.dep[i] + 0.55 * data.jit[i]), 1.7, 0, 7); g.fill(); }
      g.globalAlpha = 1; g.strokeStyle = '#e8e6e0'; g.lineWidth = 2; g.lineJoin = 'round'; g.beginPath(); let on = false;
      for (const b of data.bins) { if (!Number.isFinite(b.h) || b.n < 3) { on = false; continue; } if (on) g.lineTo(X(b.r), Y(b.h)); else { g.moveTo(X(b.r), Y(b.h)); on = true; } }
      g.stroke();
      if (hover && hover.cv === B) { const r = hover.r, b = data.bins.reduce((a, c) => (Math.abs(c.r - r) < Math.abs(a.r - r) ? c : a)); g.strokeStyle = '#ffffff55'; g.lineWidth = 1; g.beginPath(); g.moveTo(X(r) + 0.5, 0); g.lineTo(X(r) + 0.5, h - 12); g.stroke(); g.fillStyle = '#e8e6e0'; g.textBaseline = 'top'; g.fillText(`radius ${b.r.toFixed(2)}: mean ${Number.isFinite(b.h) ? b.h.toFixed(2) : '-'} hops (${b.n} cells)`, L, 0); }
    }
  }
  for (const cv of [A, B]) {
    cv.addEventListener('pointermove', (e) => { const w = cv.clientWidth, rh = (cv.clientHeight - 14) / ROWS.length; hover = { cv, r: Math.max(0, Math.min(1, (e.offsetX - L) / (w - L - R))), row: cv === A ? Math.floor((e.offsetY - 4) / rh) : -1 }; draw(); });
    cv.addEventListener('pointerleave', () => { hover = null; draw(); });
  }
  return { set, draw };
}
