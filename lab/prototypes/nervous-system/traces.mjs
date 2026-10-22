// lab/prototypes/nervous-system/traces.mjs - live traces of the last ~20 s of simulated time, one small chart per measure
// (one y scale each), at most four series per chart, a legend per chart, events as ticks, a crosshair readout on hover.

const WIN = 20, CAP = 1200;

export function createTraces(host, charts) {
  const rows = charts.map((c) => {
    const box = document.createElement('div'); box.className = 'trace';
    const head = document.createElement('div'); head.className = 'thead';
    head.innerHTML = `<b>${c.title}</b>` + c.series.map((s) => `<span class="key"><i style="background:${s.color}"></i>${s.name}</span>`).join('');
    const cv = document.createElement('canvas'); box.append(head, cv); host.appendChild(box);
    return { c, cv, t: new Float64Array(CAP), v: c.series.map(() => new Float32Array(CAP)), n: 0, head };
  });
  const ticks = [];   // { t, label, color }
  let hoverX = null, last = -1;
  for (const r of rows) {
    r.cv.addEventListener('pointermove', (e) => { hoverX = e.offsetX / r.cv.clientWidth; });
    r.cv.addEventListener('pointerleave', () => { hoverX = null; });
  }

  function sample(t) {
    if (t - last < 1 / 30 && t >= last) return;
    last = t;
    for (const r of rows) { const i = r.n % CAP; r.t[i] = t; r.c.series.forEach((s, k) => { r.v[k][i] = s.get(); }); r.n++; }
  }
  function tick(t, label, color) { ticks.push({ t, label, color }); if (ticks.length > 64) ticks.shift(); }
  function clear() { for (const r of rows) r.n = 0; ticks.length = 0; last = -1; }

  function draw(now) {
    const dpr = Math.min(2, devicePixelRatio);
    for (const r of rows) {
      const w = r.cv.clientWidth, h = r.cv.clientHeight;
      if (r.cv.width !== w * dpr || r.cv.height !== h * dpr) { r.cv.width = w * dpr; r.cv.height = h * dpr; }
      const g = r.cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
      const { min, max } = r.c, X = (t) => w * (1 - (now - t) / WIN), Y = (v) => h - 3 - (h - 6) * (Math.min(max, Math.max(min, v)) - min) / (max - min);
      g.strokeStyle = '#ffffff14'; g.lineWidth = 1; g.beginPath();
      for (const gv of r.c.grid || []) { g.moveTo(0, Y(gv) + 0.5); g.lineTo(w, Y(gv) + 0.5); }
      g.stroke();
      g.fillStyle = '#8d939c'; g.font = '10px system-ui'; g.textBaseline = 'top';
      g.fillText(String(max), 2, 1); g.textBaseline = 'bottom'; g.fillText(String(min), 2, h - 1);
      for (const tk of ticks) if (now - tk.t < WIN && (!r.c.ticks || r.c.ticks.includes(tk.label))) {
        g.strokeStyle = tk.color; g.globalAlpha = 0.5; g.beginPath(); g.moveTo(X(tk.t) + 0.5, 0); g.lineTo(X(tk.t) + 0.5, h); g.stroke(); g.globalAlpha = 1;
      }
      const n = Math.min(r.n, CAP);
      r.c.series.forEach((s, k) => {
        g.strokeStyle = s.color; g.lineWidth = 2; g.lineJoin = 'round'; g.beginPath(); let on = false;
        for (let j = n; j > 0; j--) {
          const i = (r.n - j) % CAP, t = r.t[i]; if (now - t > WIN || t > now) continue;
          const v = r.v[k][i]; if (!Number.isFinite(v)) { on = false; continue; }
          if (on) g.lineTo(X(t), Y(v)); else { g.moveTo(X(t), Y(v)); on = true; }
        }
        g.stroke();
      });
      if (hoverX !== null && n) {   // crosshair: the values at that moment
        const tq = now - WIN * (1 - hoverX); let best = -1, bd = 1e9;
        for (let j = 1; j <= n; j++) { const i = (r.n - j) % CAP, d = Math.abs(r.t[i] - tq); if (d < bd) { bd = d; best = i; } }
        g.strokeStyle = '#ffffff55'; g.lineWidth = 1; g.beginPath(); g.moveTo(hoverX * w + 0.5, 0); g.lineTo(hoverX * w + 0.5, h); g.stroke();
        if (best >= 0) {
          const txt = r.c.series.map((s, k) => `${s.name} ${fmt(r.v[k][best])}`).join('  ') + `  (${(now - r.t[best]).toFixed(1)} s ago)`;
          g.font = '10px system-ui'; g.textBaseline = 'top'; const tw = g.measureText(txt).width;
          g.fillStyle = '#0b0e12e0'; g.fillRect(Math.min(w - tw - 6, Math.max(0, hoverX * w + 6)), 12, tw + 6, 14);
          g.fillStyle = '#e8e6e0'; g.fillText(txt, Math.min(w - tw - 3, Math.max(3, hoverX * w + 9)), 14);
        }
      }
    }
  }
  const fmt = (v) => (!Number.isFinite(v) ? '-' : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));
  return { sample, draw, tick, clear };
}
