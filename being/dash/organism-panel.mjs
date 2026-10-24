// being/dash/organism-panel.mjs - the dashboard's Organism panel: watch the lab organism (lab/organism/) that ON runs
// beside the being, hearing what ON hears, and (second switch, experimental, when the build offers it) let its muscles
// and skin move ON (dash-app 'organism' { drive, strength }), with a meter of what reaches ON (snap.orgDrive). The three views (Anatomy, Live, Diagram: a left-to-right flow whose
// blocks are named by their measured roles, lab/prototypes/organism/roles.mjs), the body and the radial profile are the
// lab page's own (lab/prototypes/organism/), fed a remote organism built from the snapshots (organism-proxy.mjs). Renders
// only while the switch is on, the panel is open and on screen, and the window is visible.

import { createRemoteOrganism } from './organism-proxy.mjs';

const CSS = `
  .org-top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 6px; }
  .org-top label.sw2 { display: inline-flex; gap: 6px; align-items: center; color: var(--ink); cursor: pointer; }
  .org-grid { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 12px; }
  @media (max-width: 1100px) { .org-grid { grid-template-columns: minmax(0, 1fr); } }
  .org-view { position: relative; height: 520px; border-radius: 8px; overflow: hidden; background: #06080b; border: 1px solid var(--ring); }
  .org-view > canvas { display: block; }
  .org-view .labels { position: absolute; inset: 0; z-index: 1; }
  .org-view .labels .area { font-size: 10.5px; pointer-events: none; white-space: nowrap; background: #06080bd9; border: 1px solid #222a33; border-radius: 4px; padding: 1px 5px; }
  .org-view .labels .gl { font-size: 10px; line-height: 1.35; pointer-events: none; white-space: nowrap; text-align: center; color: var(--ink2); background: #06080bc0; border-radius: 4px; padding: 2px 5px; }
  .org-view .labels .gl b { font-weight: 600; } .org-view .labels .gl .n, .org-view .labels .gl .ln { color: var(--muted); }
  .org-view.tall { height: 620px; } .org-grid.diag { grid-template-columns: minmax(0, 1fr); }
  .org-view .labels .gl.flow { text-align: left; white-space: normal; background: none; padding: 0; line-height: 1.25; }
  .org-view .labels .gl.flow .t { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .org-view .labels .gl.flow .t b { font-size: 11.5px; } .org-view .labels .gl.flow .n { font-size: 9.5px; }
  .org-view .labels .gl.flow .ln { font-size: 10px; color: var(--ink2); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .org-view .labels .gl.stage { text-align: left; white-space: normal; background: none; padding: 0; }
  .org-view .labels .gl.stage b { font-size: 11px; color: var(--ink); text-transform: uppercase; letter-spacing: .06em; } .org-view .labels .gl.stage .ln { font-size: 10px; }
  .org-view .labels .gl.pct { font-size: 9.5px; padding: 0 3px; color: var(--ink); background: #06080bd0; }
  .org-what { color: var(--ink2); font-size: 11.5px; line-height: 1.45; margin: 0 0 8px; padding: 7px 10px; border-left: 2px solid var(--axis); background: #ffffff06; border-radius: 0 6px 6px 0; }
  .org-what b { color: var(--ink); font-weight: 600; }
  .org-drive { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin: -2px 0 8px; }
  .org-drive label.sw2 { display: inline-flex; gap: 6px; align-items: center; color: var(--ink); cursor: pointer; }
  .org-lead { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: -2px 0 8px; } .org-lead label { color: var(--ink); white-space: nowrap; }
  .org-lead input[type=range] { width: 220px; } .org-lead .ends { color: var(--muted); font-size: 10.5px; }
  .org-meter { display: grid; grid-template-columns: minmax(0, 1fr) 150px 200px; gap: 12px; align-items: start; margin: 0 0 10px; padding: 8px 10px; border: 1px solid var(--ring); border-radius: 8px; background: #ffffff04; }
  @media (max-width: 900px) { .org-meter { grid-template-columns: minmax(0, 1fr); } }
  .org-meter h3 { margin: 0 0 4px; font-size: 11px; font-weight: 600; color: var(--muted); } .org-meter canvas { display: block; width: 100%; background: #090c10; border-radius: 4px; }
  .org-meter .mk { color: var(--ink2); font-size: 10.5px; margin-top: 3px; } .org-meter .mk i { display: inline-block; width: 10px; height: 2px; vertical-align: middle; margin: 0 4px 0 8px; } .org-meter .mk i:first-child { margin-left: 0; }
  .org-meter .sw { width: 100%; height: 34px; border-radius: 6px; border: 1px solid var(--ring); } .org-meter .nums { font-size: 11px; color: var(--ink2); line-height: 1.5; margin-top: 4px; } .org-meter .nums b { color: var(--ink); font-weight: 600; }
  .org-meter .live { font-weight: 600; } .org-meter .live.ok { color: var(--c3); } .org-meter .live.no { color: var(--c2); }
  .org-bar { position: absolute; z-index: 3; top: 8px; left: 8px; right: 8px; display: flex; gap: 8px; align-items: center; pointer-events: none; }
  .org-bar > * { pointer-events: auto; } .org-bar select { width: auto; max-width: 190px; }
  .org-bar .sub2 { margin-left: auto; background: #06080bc0; border-radius: 4px; padding: 1px 6px; pointer-events: none; }
  .org-legend { color: var(--muted); font-size: 10.5px; margin-top: 6px; display: flex; flex-wrap: wrap; gap: 3px 14px; }
  .org-legend .k { white-space: nowrap; } .org-legend .k i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
  .org-legend .k b { font-weight: 600; }
  .org-view.diag .org-body { display: none; }
  .org-body { position: absolute; z-index: 2; left: 8px; bottom: 6px; width: 160px; height: 160px; border: 1px solid var(--ring); border-radius: 8px; background: #080b0fcc; }
  .org-body > canvas { display: block; }
  .org-body .cap { position: absolute; left: 7px; top: 5px; color: var(--muted); font-size: 10px; }
  .org-side h3 { margin: 10px 0 4px; font-size: 11px; font-weight: 600; color: var(--muted); } .org-side h3:first-child { margin-top: 0; }
  .org-side .trace { margin: 0 0 6px; } .org-side .trace canvas { height: 46px; background: #090c10; border-radius: 4px; }
  .org-side .thead { display: flex; flex-wrap: wrap; gap: 2px 8px; align-items: center; margin-bottom: 2px; color: var(--ink2); font-size: 10.5px; }
  .org-side .thead b { color: var(--ink); font-weight: 600; } .org-side .key i { display: inline-block; width: 10px; height: 2px; vertical-align: middle; margin-right: 4px; }
  .org-side #radA, .org-side #radB { background: #090c10; border-radius: 4px; } .org-side p.k { color: var(--muted); margin: 4px 0; }
  .org-tip { position: fixed; z-index: 9; background: #000d; border: 1px solid var(--axis); border-radius: 6px; padding: 5px 8px; white-space: pre; font-size: 11px; color: #fff; pointer-events: none; }
  .org-wait { color: var(--muted); padding: 30px; text-align: center; }
`;

export function install(ORG, { h, panel, fmt }) {
  const remote = createRemoteOrganism(), org = remote.org;
  let leadRow, leadIn, leadOut, meter, mPulse, mReg, mSwatch, mNums, mState, trace = [], lastDrive = 0, strength = 0.6;
  let body, sw, note, info, grid, waitEl, viewHost, bodyHost, legend, side, kvEl, braceC, braceTxt, clock, seg, colorSel, whatEl, driveRow, driveSw, VT = null;
  let watch = false, drive = false, canDrive = false, supported = true, view = null, bodyView = null, radial = null, traces = null, libs = null, onScreen = true, raf = 0, lastT = 0, lastKv = 0, lastAreas = 0, mode = 'anatomy', frames = 0, pendingStatic = false, lastSnap = 0;

  function build() {
    if (body) return;
    const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
    body = panel('organism', 'Organism', true);
    sw = h('input', { type: 'checkbox', 'aria-label': 'Run the organism', on: { change: () => setWatch(sw.checked) } });
    note = h('span', { class: 'sub2' });
    driveSw = h('input', { type: 'checkbox', 'aria-label': 'Let it move ON (experimental)', on: { change: () => setDrive(driveSw.checked) } });
    driveRow = h('div', { class: 'org-drive', hidden: true }, h('label', { class: 'sw2' }, driveSw, 'Let it move ON (experimental)'),
      h('span', { class: 'sub2' }, 'Its muscles move ON’s body and its skin colours ON’s metal and light. It braces ~120 ms after the beat, so its motion lags the music for now.'));
    leadIn = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: strength, 'aria-label': 'How much it leads', on: { input: () => { leadOut.textContent = pct(+leadIn.value); }, change: () => setStrength(+leadIn.value) } });
    leadOut = h('output', { class: 'num' }, pct(strength));
    leadRow = h('div', { class: 'org-lead', hidden: true }, h('label', {}, 'How much it leads'), h('span', { class: 'ends' }, 'a nudge'), leadIn, h('span', { class: 'ends' }, 'takes over'), leadOut);
    mPulse = h('canvas'); mPulse.style.height = '84px'; mReg = h('canvas'); mReg.style.height = '84px'; mSwatch = h('div', { class: 'sw' }); mNums = h('div', { class: 'nums' }); mState = h('span', { class: 'live' });
    meter = h('div', { class: 'org-meter', hidden: true },
      h('div', {}, h('h3', {}, 'What reaches ON · ', mState), mPulse, h('div', { class: 'mk' }, h('i', { style: 'background:var(--c1)' }), 'its motor pulse', h('i', { style: 'background:var(--c2)' }), 'its brace', h('i', { style: 'background:var(--muted)' }), 'ON’s beat')),
      h('div', {}, h('h3', {}, 'Its 8 regions'), mReg),
      h('div', {}, h('h3', {}, 'Its colour'), mSwatch, mNums));
    whatEl = h('p', { class: 'org-what' });
    info = h('span', { class: 'sub2', style: 'margin-left:auto' });
    waitEl = h('div', { class: 'org-wait' }, 'Switch it on to watch.');
    seg = h('div', { class: 'seg' }, ...['anatomy', 'live', 'diagram'].map((v, k) => h('button', { data: { v }, title: `key ${k + 1} over the view`, on: { click: () => setMode(v) } }, v[0].toUpperCase() + v.slice(1))));
    colorSel = h('select', { 'aria-label': 'colour by', on: { change: () => { if (view) view.setColorBy(colorSel.value); explain(); } } },
      ...[['community', 'colour: area'], ['type', 'colour: kind of cell'], ['depth', 'colour: depth from the senses'], ['ei', 'colour: excitatory / inhibitory']].map(([value, t]) => h('option', { value }, t)));
    clock = h('span', { class: 'sub2 num' });
    legend = h('div', { class: 'org-legend' });
    bodyHost = h('div', { class: 'org-body' }, h('span', { class: 'cap' }, 'body · chromatophores'));
    viewHost = h('div', { class: 'org-view', tabIndex: 0 }, h('div', { class: 'org-bar' }, seg, colorSel, clock), bodyHost);
    viewHost.addEventListener('keydown', (e) => { const v = { 1: 'anatomy', 2: 'live', 3: 'diagram' }[e.key]; if (v) setMode(v); });
    kvEl = h('div', { class: 'kv' }); braceC = h('canvas'); braceC.style.height = '96px'; braceTxt = h('div', { class: 'sub2', style: 'margin-top:3px' });
    side = h('div', { class: 'org-side' }, h('h3', {}, 'Vital signs'), kvEl, h('div', { id: 'orgTraces', style: 'margin-top:8px' }),
      h('h3', {}, 'Bracing against the beat'), braceC, braceTxt, h('div', { id: 'orgRadial', style: 'margin-top:10px' }));
    grid = h('div', { class: 'org-grid' }, h('div', {}, whatEl, viewHost, legend), side); grid.hidden = true;
    body.append(h('div', { class: 'org-top' }, h('label', { class: 'sw2' }, sw, 'Run the organism'), note, info), driveRow, leadRow, meter, waitEl, grid);
    new IntersectionObserver((es) => { onScreen = es.some((e) => e.isIntersecting); wake(); }).observe(body);
    document.addEventListener('visibilitychange', wake);
    body.closest('.panel').querySelector('h2').addEventListener('click', () => setTimeout(wake));
    setMode('anatomy');
    window.dash.app('organism').then((r) => { take(r); status(); wake(); }).catch(() => { supported = false; status(); });
  }
  /** the main process's answer: { watch, drive?, strength? } (older builds have no drive: its switch stays hidden) */
  function take(r) {
    supported = !!r && typeof r === 'object';
    watch = supported && !!r.watch; canDrive = supported && 'drive' in r; drive = canDrive && !!r.drive;
    if (supported && Number.isFinite(r.strength)) strength = r.strength;
    sw.checked = watch; driveSw.checked = drive; driveRow.hidden = !canDrive;
    leadRow.hidden = meter.hidden = !(drive && supported && Number.isFinite(r.strength)); leadIn.value = strength; leadOut.textContent = pct(strength);
    if (!drive) trace = [];
  }
  async function setStrength(v) {
    try { take(await window.dash.app('organism', { strength: v })); } catch { leadIn.value = strength; leadOut.textContent = pct(strength); }
  }
  /** the page's drive state (snap.orgDrive: { k, s, pulse, reg[8], chrom, colour, arousal, metalW, lightW, msgsPerSec, ageMs, trace: [[pulse, brace, beat], ...] }) */
  function feedDrive(d, frozen) {
    if (!body || meter.hidden || frozen) return;
    const now = performance.now();
    if (!d) { if (now - lastDrive > 1500) { mState.textContent = 'nothing from the page yet'; mState.className = 'live no'; } return; }
    lastDrive = now;
    for (const p of Array.isArray(d.trace) ? d.trace : []) trace.push(p);
    if (trace.length > 360) trace.splice(0, trace.length - 360);
    const fresh = d.ageMs != null && d.ageMs < 500 && d.msgsPerSec > 0;
    mState.textContent = fresh ? `live · ${fmt(d.msgsPerSec, 0)} msgs/s · ${fmt(d.ageMs, 0)} ms old · leading ${pct(d.k * d.s)}` : d.ageMs == null ? 'waiting for the organism…' : `stale · last ${fmt(d.ageMs / 1000, 1)} s ago`;
    mState.className = 'live ' + (fresh && d.k > 0.5 ? 'ok' : 'no');
    drawPulse(); drawRegions(d.reg || []);
    mSwatch.style.background = d.colour || '#000';
    const c = d.chrom || [];
    mNums.innerHTML = `fade in <b>${fmt(d.k, 2)}</b> · strength <b>${fmt(d.s, 2)}</b><br>skin ${fmt(c[0], 2)} · hue ${fmt(c[1], 2)} · patchy ${fmt(c[2], 2)}<br>arousal <b>${fmt(d.arousal, 2)}</b> · metal ${pct(d.metalW || 0)} · light ${pct(d.lightW || 0)}`;
  }
  function canvas2d(c, hh) {
    const dpr = devicePixelRatio || 1, w = c.clientWidth || 280;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(hh * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(hh * dpr); }
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, hh); return [g, w];
  }
  /** the last ~6 s: its motor pulse as ON receives it (normalized), its brace, and ON's own beat curve */
  function drawPulse() {
    const hh = 84, [g, w] = canvas2d(mPulse, hh), cs = getComputedStyle(document.documentElement), n = trace.length, N = 360;
    const line = (i, col, lw) => { g.strokeStyle = col; g.lineWidth = lw; g.beginPath(); for (let j = 0; j < n; j++) { const x = w - (n - 1 - j) * (w / N), y = hh - 3 - (hh - 6) * Math.min(1, Math.max(0, trace[j][i] || 0)); if (j) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke(); };
    g.strokeStyle = cs.getPropertyValue('--grid').trim(); g.lineWidth = 1; g.beginPath(); g.moveTo(0, hh / 2 + 0.5); g.lineTo(w, hh / 2 + 0.5); g.stroke();
    line(2, cs.getPropertyValue('--muted').trim(), 1); line(1, cs.getPropertyValue('--c2').trim(), 1.2); line(0, cs.getPropertyValue('--c1').trim(), 1.8);
  }
  /** each body region's share of its motor cells' activity (REGION_DIRS order), as ON bulges it */
  function drawRegions(reg) {
    const hh = 84, [g, w] = canvas2d(mReg, hh), cs = getComputedStyle(document.documentElement), bw = w / 8;
    g.fillStyle = cs.getPropertyValue('--grid').trim(); for (let i = 0; i < 8; i++) g.fillRect(i * bw + 2, 2, bw - 4, hh - 4);
    g.fillStyle = cs.getPropertyValue('--c3').trim(); for (let i = 0; i < 8; i++) { const v = Math.min(1, Math.max(0, reg[i] || 0)); g.fillRect(i * bw + 2, hh - 2 - (hh - 4) * v, bw - 4, (hh - 4) * v); }
  }
  const pct = (v) => `${Math.round(v * 100)}%`;
  async function setWatch(on) {
    try { take(await window.dash.app('organism', { watch: !!on })); } catch { supported = false; watch = false; }
    status(); wake();
  }
  async function setDrive(on) {
    try { take(await window.dash.app('organism', { drive: !!on })); } catch { driveSw.checked = drive; }
    status(); wake();
  }
  function setMode(v) {
    mode = v; for (const b of seg.children) b.classList.toggle('on', b.dataset.v === v);
    viewHost.classList.toggle('tall', v === 'diagram'); viewHost.classList.toggle('diag', v === 'diagram'); grid.classList.toggle('diag', v === 'diagram'); explain();
    if (view) view.setMode(v);
  }
  function explain() {
    if (!VT || !whatEl) return;   // the words come with the views (loaded when it is first shown)
    whatEl.innerHTML = `<b>What you’re seeing.</b> ${VT.VIEW_WHAT[mode]}`; legend.innerHTML = VT.viewKey(mode, colorSel.value);
  }
  function status() {
    if (!body) return;
    const r = remote.ready && watch;
    grid.hidden = !r; waitEl.hidden = r;
    note.textContent = drive ? 'It hears what ON hears, and its muscles and skin move ON.' : 'It hears what ON hears. Watch only: it doesn’t move ON.';
    waitEl.textContent = !supported ? 'This build of ON cannot run the organism.' : !watch ? 'Switch it on to watch.' : pendingStatic ? 'Waiting for the organism’s anatomy…' : 'Starting the organism…';
    info.textContent = remote.ready ? `${remote.label || 'organism'} · ${org.dev.N} cells` : '';
  }

  /** the snapshot's organism part (or nothing): keep the proxy current; the frame loop draws */
  function feed(o, frozen) {
    if (!o) { if (body && watch && performance.now() - lastSnap > 3000) status(); return; }
    if (frozen) { if (o.static) remote.apply({ static: o.static }); return; }   // Freeze holds the picture; a new anatomy is still kept
    lastSnap = performance.now();
    const was = remote.ready, r = remote.apply(o);
    if (!body) return;
    pendingStatic = !remote.ready || (o.staticVersion != null && o.staticVersion !== remote.version);
    if (r === 'static' && view) adopt();
    if (was !== remote.ready || r === 'static') status();
    wake();
  }

  const visible = () => watch && remote.ready && onScreen && document.visibilityState === 'visible' && grid.offsetParent !== null;
  function wake() { if (!raf && body && visible()) { lastT = performance.now(); raf = requestAnimationFrame(frame); } }

  async function ensureView() {
    if (view || libs === 'loading') return !!view;
    libs = 'loading';
    try {
      const [V, B, R, TR, AN] = await Promise.all([import('../../lab/prototypes/organism/view.mjs'), import('../../lab/prototypes/organism/body.mjs'),
        import('../../lab/prototypes/organism/radial.mjs'), import('../../lab/prototypes/nervous-system/traces.mjs'), import('../../lab/organism/analysis.mjs')]);
      libs = { V, AN }; VT = V; explain();
      const tip = h('div', { class: 'org-tip', hidden: true }); document.body.append(tip);
      view = V.createView(viewHost, tip); bodyView = B.createBody(bodyHost); radial = R.createRadial(side.querySelector('#orgRadial'));
      view.setThreshold(0.55); view.setColorBy(colorSel.value);
      const S = () => org.state(), col = { a: '#3987e5', b: '#d95926', c: '#199e70', d: '#c98500', e: '#c58cff' };
      traces = TR.createTraces(side.querySelector('#orgTraces'), [
        { title: 'Essential variables', min: 0, max: 1, grid: [0.5], series: [{ name: 'energy', color: col.d, get: () => S().energy }, { name: 'integrity', color: col.c, get: () => S().integrity }, { name: 'need', color: col.b, get: () => S().need }, { name: 'viability', color: '#e8e6e0', get: () => S().viability }] },
        { title: 'Feeling', min: -1, max: 1, grid: [0], series: [{ name: 'valence', color: col.a, get: () => S().valence }, { name: 'arousal', color: col.e, get: () => S().arousal }] },
        { title: 'Firing (Hz)', min: 0, max: 30, grid: [5, 25], series: [{ name: 'interneurons', color: col.c, get: () => S().interHz }, { name: 'all cells', color: '#8d939c', get: () => S().rateHz }] },
        { title: 'Bracing', min: 0, max: 1, grid: [0.5], series: [{ name: 'brace', color: col.b, get: () => S().brace }, { name: 'protection', color: col.c, get: () => S().protection }, { name: 'impact', color: '#e8e6e0', get: () => Math.min(1, S().impact ?? NaN) }] },
      ]);
      adopt(); view.setMode(mode);
    } catch (e) { console.error('organism view', e); libs = null; waitEl.hidden = false; waitEl.textContent = 'The organism view could not load: ' + e.message; }
    return !!view;
  }
  /** a new anatomy: hand it to the views, find its areas again */
  function adopt() {
    if (!view || !remote.ready) return;
    view.setOrganism(org); bodyView.setOrganism(org); traces.clear(); findAreas();
  }
  function findAreas() {
    const AN = libs.AN, L = AN.louvain(AN.graphOf(org)), D = AN.depth(org);
    view.setPartition(L.member, D.d);
    let prof = null; try { prof = AN.radialProfile(org); } catch {}
    radial.set(org, D.d, L.member, prof, (c) => '#' + libs.V.communityColor(c).getHexString());
    lastAreas = performance.now();
  }

  function frame(now) {
    raf = 0;
    if (!visible()) return;
    const dt = Math.min(0.1, Math.max(0, (now - lastT) / 1000)); lastT = now;
    if (!view) { ensureView().then((ok) => ok && wake()); return; }
    try {
      remote.tick(dt); view.observe(org.takeEvents());
      traces.sample(org.time); traces.draw(org.time);
      view.frame(dt); bodyView.frame(dt);
      if (now - lastAreas > 30000) findAreas();
      if (now - lastKv > 400) { lastKv = now; readouts(); }
    } catch (e) { console.error('organism frame', e); }
    frames++; raf = requestAnimationFrame(frame);
  }

  function readouts() {
    const s = org.state(), row = (k, v, d = 2, t) => h('div', {}, h('b', { class: 'num' }, t ?? fmt(v, d)), h('small', {}, k));
    kvEl.replaceChildren(row('energy', s.energy), row('integrity', s.integrity), row('need', s.need), row('viability', s.viability), row('valence', s.valence), row('arousal', s.arousal),
      row('brace', s.brace), row('protection', s.protection), row('surprise (RPE)', s.rpe), row('firing Hz', s.rateHz, 1), row('alive', 0, 0, s.alive === false ? 'no' : 'yes'));
    clock.textContent = `${fmt(org.time, 1)} s`;
    drawBrace();
  }
  /** each recent impact: where it fell in ON's beat (x) and how far ahead the body had braced (y) */
  function drawBrace() {
    const tm = remote.timing, imp = (tm && Array.isArray(tm.impacts) ? tm.impacts : []).map((i) => ({ t: i.t, ph: i.beatPhase ?? i.phase, lead: i.leadMs ?? i.braceMs ?? (i.offsetMs != null ? -i.offsetMs : null) })).filter((i) => Number.isFinite(i.lead));
    const dpr = devicePixelRatio || 1, w = braceC.clientWidth || 280, hh = 96;
    if (braceC.width !== Math.round(w * dpr) || braceC.height !== Math.round(hh * dpr)) { braceC.width = Math.round(w * dpr); braceC.height = Math.round(hh * dpr); }
    const g = braceC.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, hh);
    const cs = getComputedStyle(document.documentElement), grid = cs.getPropertyValue('--grid').trim(), muted = cs.getPropertyValue('--muted').trim(), c1 = cs.getPropertyValue('--c1').trim(), c2 = cs.getPropertyValue('--c2').trim();
    const maxL = Math.max(100, ...imp.map((i) => Math.abs(i.lead))), L = 30, B = 14, y0 = (hh - B) / 2, Y = (v) => y0 - (v / maxL) * (y0 - 4), X = (p) => L + ((((p ?? 0) % 1) + 1) % 1) * (w - L - 4);
    g.strokeStyle = grid; g.lineWidth = 1; g.beginPath(); g.moveTo(L, Math.round(y0) + 0.5); g.lineTo(w, Math.round(y0) + 0.5); for (const p of [0, 0.25, 0.5, 0.75]) { g.moveTo(Math.round(X(p)) + 0.5, 2); g.lineTo(Math.round(X(p)) + 0.5, hh - B); } g.stroke();
    g.fillStyle = muted; g.font = '10px "Segoe UI"'; g.textBaseline = 'middle'; g.fillText('ahead', 0, 8); g.fillText('late', 0, hh - B - 8);
    g.textBaseline = 'alphabetic'; g.fillText('on the beat', L, hh - 2); g.textAlign = 'center'; g.fillText('half', X(0.5), hh - 2); g.textAlign = 'left';
    const tNow = org.time;
    for (const i of imp) { const age = Number.isFinite(i.t) ? Math.max(0, tNow - i.t) : 0; g.globalAlpha = Math.max(0.2, 1 - age / 20); g.fillStyle = i.lead >= 0 ? c1 : c2; g.beginPath(); g.arc(X(i.ph), Y(i.lead), 3, 0, 7); g.fill(); }
    g.globalAlpha = 1;
    if (!imp.length) { braceTxt.textContent = tm ? 'No hits yet.' : 'No timing from the organism yet.'; return; }
    const ahead = imp.filter((i) => i.lead > 0).length, med = imp.map((i) => i.lead).sort((a, b) => a - b)[imp.length >> 1];
    const near = imp.filter((i) => Number.isFinite(i.ph) && Math.min(i.ph % 1, 1 - (i.ph % 1)) < 0.1).length;
    braceTxt.textContent = `Braced ahead of ${ahead} of ${imp.length} recent hits · median ${fmt(Math.abs(med), 0)} ms ${med >= 0 ? 'ahead' : 'late'} · ${near} on the beat`;
  }

  ORG.build = build; ORG.feed = feed; ORG.feedDrive = feedDrive;
  if (ORG.early) { remote.apply(ORG.early); ORG.early = null; }   // an anatomy that arrived before this module loaded
  ORG.debug = { remote, get view() { return view; }, get frames() { return frames; }, setMode };
}
