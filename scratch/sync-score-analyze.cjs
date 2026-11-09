// scratch/sync-score-analyze.cjs - node scratch/sync-score-analyze.cjs <repo> <dir> name1 name2 ...: reads <dir>/<name>.jsonl (from
// scratch/sync-score.cjs) and <dir>/<name>.wav (+ <name>.truth.json beats/sections for synthetic tracks), writes
// <dir>/results.json and SVG plots: onset -> motion correlation and lag, beat-locked motion depth, tempo ratios, gates,
// per-section levels, motion statistics for comparing songs.
const fs = require('node:fs'), path = require('node:path');
(async () => {
const [REPO, DIR, ...NAMES] = process.argv.slice(2);
const { realFFT } = await import(require('node:url').pathToFileURL(path.join(REPO, 'being/fft.mjs')).href);
const FR = 100, HOP = 480, NF = 2048;

function readWav(p) { const b = fs.readFileSync(p); let o = 12; while (b.toString('ascii', o, o + 4) !== 'data') o += 8 + b.readUInt32LE(o + 4);
  const d = b.subarray(o + 8), a = new Int16Array(d.buffer.slice(d.byteOffset, d.byteOffset + (d.length & ~1))); return Float32Array.from(a, (v) => v / 32768); }
function features(x, t0, dur) {
  const s0 = Math.round(t0 * 48000), n = Math.floor(Math.min(x.length - s0 - NF, dur * 48000) / HOP), rf = realFFT(NF), win = new Float64Array(NF), buf = new Float64Array(NF), re = new Float64Array(NF / 2 + 1), im = new Float64Array(NF / 2 + 1);
  for (let i = 0; i < NF; i++) win[i] = .5 - .5 * Math.cos(2 * Math.PI * i / NF);
  const rms = new Float64Array(n), flux = new Float64Array(n), low = new Float64Array(n), cen = new Float64Array(n); let prev = new Float64Array(NF / 2 + 1);
  const kLow = Math.round(200 / (48000 / NF));
  for (let f = 0; f < n; f++) { const a = s0 + f * HOP; let e = 0;
    for (let i = 0; i < NF; i++) { const v = x[a + i] || 0; buf[i] = v * win[i]; } for (let i = NF / 2 - HOP / 2; i < NF / 2 + HOP / 2; i++) { const v = x[a + i] || 0; e += v * v; }
    rms[f] = 10 * Math.log10(e / HOP + 1e-10); rf(buf, re, im); let fl = 0, lo = 0, num = 0, den = 0; const cur = new Float64Array(NF / 2 + 1);
    for (let k = 1; k <= NF / 2; k++) { const m = Math.log1p(1000 * Math.hypot(re[k], im[k])); cur[k] = m; const d = m - prev[k]; if (d > 0) { fl += d; if (k <= kLow) lo += d; } const mg = Math.hypot(re[k], im[k]); num += k * mg; den += mg; }
    flux[f] = fl; low[f] = lo; cen[f] = den ? num / den * 48000 / NF : 0; prev = cur; }
  return { rms, flux, low, cen, n };
}
const mean = (a) => { let s = 0, n = 0; for (const v of a) if (Number.isFinite(v)) { s += v; n++; } return n ? s / n : NaN; };
const std = (a) => { const m = mean(a); let s = 0, n = 0; for (const v of a) if (Number.isFinite(v)) { s += (v - m) ** 2; n++; } return Math.sqrt(s / Math.max(1, n - 1)); };
const smooth = (a, w) => { const o = new Float64Array(a.length); let s = 0, q = []; for (let i = 0; i < a.length; i++) { s += a[i]; q.push(a[i]); if (q.length > w) s -= q.shift(); o[i] = s / q.length; } return o; };
const center = (a, w) => { const o = new Float64Array(a.length), h = w >> 1; const c = new Float64Array(a.length + 1); for (let i = 0; i < a.length; i++) c[i + 1] = c[i] + a[i]; for (let i = 0; i < a.length; i++) { const l = Math.max(0, i - h), r = Math.min(a.length, i + h + 1); o[i] = (c[r] - c[l]) / (r - l); } return o; };
const hp = (a, w) => { const m = center(a, w); return a.map((v, i) => v - m[i]); };
function xcorr(a, b, maxLag) { // corr of a(t) with b(t+lag): positive lag = b follows a
  let best = { r: -2, lag: 0 }; const out = [];
  for (let L = -maxLag; L <= maxLag; L++) { let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, n = 0;
    for (let i = Math.max(0, -L); i < a.length && i + L < b.length; i++) { const x = a[i], y = b[i + L]; if (!Number.isFinite(x) || !Number.isFinite(y)) continue; sa += x; sb += y; saa += x * x; sbb += y * y; sab += x * y; n++; }
    const r = (sab - sa * sb / n) / Math.sqrt((saa - sa * sa / n) * (sbb - sb * sb / n) + 1e-20); out.push(r); if (r > best.r) best = { r, lag: L }; }
  return { r: best.r, lagMs: best.lag * 1000 / FR, r0: out[maxLag] };
}
// beat tracking (Ellis 2007 dynamic programming) for songs without ground truth
function trackBeats(env) {
  const o = hp(env, 40).map((v) => Math.max(0, v)), sd = std(o); for (let i = 0; i < o.length; i++) o[i] /= sd || 1;
  let bestT = 50, bs = -1; const ac = [];
  for (let L = 25; L <= 150; L++) { let s = 0; for (let i = L; i < o.length; i++) s += o[i] * o[i - L]; s /= (o.length - L); const bpm = 6000 / L; const wgt = Math.exp(-.5 * (Math.log2(bpm / 120) / 1.0) ** 2); ac.push([bpm, s]); if (s * wgt > bs) { bs = s * wgt; bestT = L; } }
  const P = bestT, D = new Float64Array(o.length), from = new Int32Array(o.length).fill(-1);
  for (let i = 0; i < o.length; i++) { let b = 0, bj = -1; for (let j = i - Math.round(2 * P); j <= i - Math.round(P / 2); j++) { if (j < 0) continue; const v = D[j] - 100 * Math.log((i - j) / P) ** 2; if (bj < 0 || v > b) { b = v; bj = j; } } D[i] = o[i] + (bj >= 0 ? Math.max(0, b) : 0); from[i] = bj >= 0 && b > 0 ? bj : -1; }
  let i = 0; for (let k = o.length - Math.round(P); k < o.length; k++) if (D[k] > D[i]) i = k; const beats = []; while (i >= 0) { beats.push(i / FR); i = from[i]; }
  return { bpm: 6000 / P, beats: beats.reverse() };
}
function readLog(p) { const L = fs.readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l)); return { meta: L[0].meta, rows: L.slice(1) }; }
function grid(rows, key, n, t0) { // nearest frame value on the 100 Hz song-time grid
  const o = new Float64Array(n).fill(NaN); let j = 0;
  for (let i = 0; i < n; i++) { const t = i / FR + t0; while (j + 1 < rows.length && rows[j + 1].t <= t) j++; const r = rows[j]; if (Math.abs(r.t - t) < .08) { const v = r[key]; o[i] = v == null ? NaN : v; } }
  return o;
}
function fillNaN(a) { let last = NaN; const o = Float64Array.from(a); for (let i = 0; i < o.length; i++) { if (Number.isFinite(o[i])) last = o[i]; else o[i] = last; } for (let i = 0; i < o.length && !Number.isFinite(o[i]); i++) o[i] = 0; return o; }
function beatSync(sig, beats, bins = 20) { // mean of sig over beat phase (beats: times in s on the grid), modulation depth and phase of the peak
  const acc = new Float64Array(bins), cnt = new Float64Array(bins);
  for (let k = 0; k + 1 < beats.length; k++) { const a = beats[k] * FR, b = beats[k + 1] * FR; for (let i = Math.ceil(a); i < b && i < sig.length; i++) { if (!Number.isFinite(sig[i])) continue; const ph = (i - a) / (b - a), q = Math.min(bins - 1, Math.floor(ph * bins)); acc[q] += sig[i]; cnt[q]++; } }
  const prof = Array.from(acc, (v, i) => v / Math.max(1, cnt[i])); let mx = 0, mn = 0; for (let i = 0; i < bins; i++) { if (prof[i] > prof[mx]) mx = i; if (prof[i] < prof[mn]) mn = i; }
  return { prof, depth: prof[mx] - prof[mn], peakPh: (mx + .5) / bins };
}
// how much of a signal's variance at the beat rate is phase-locked: the per-beat profile against the beat-to-beat scatter
function beatLockedShare(sig, beats, bins = 12) {
  const rows = []; for (let k = 0; k + 1 < beats.length; k++) { const a = beats[k] * FR, b = beats[k + 1] * FR, row = new Float64Array(bins).fill(NaN); for (let q = 0; q < bins; q++) { const i = Math.round(a + (q + .5) / bins * (b - a)); row[q] = sig[i]; } if (row.every(Number.isFinite)) rows.push(row); }
  if (rows.length < 4) return NaN; const m = new Float64Array(bins); for (const r of rows) for (let q = 0; q < bins; q++) m[q] += r[q] / rows.length;
  let vm = 0, vt = 0; const mm = mean(m); for (let q = 0; q < bins; q++) vm += (m[q] - mm) ** 2; for (const r of rows) { const rm = mean(r); for (let q = 0; q < bins; q++) vt += (r[q] - rm) ** 2; } return vm * rows.length / (vt || 1e-12);
}
const circ = (ds) => { let c = 0, s = 0; for (const d of ds) { c += Math.cos(2 * Math.PI * d); s += Math.sin(2 * Math.PI * d); } c /= ds.length; s /= ds.length; return { R: Math.hypot(c, s), mu: Math.atan2(s, c) / (2 * Math.PI) }; };
function svg(name, n, series, marks) {
  const W = 1400, H = 90, pad = 4, rowsH = series.length * H, g = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${rowsH + 20}" font-family="monospace" font-size="11"><rect width="100%" height="100%" fill="#111"/>`];
  series.forEach(([lab, a, col, lo, hi], k) => { const y0 = k * H; let mn = lo ?? Infinity, mx = hi ?? -Infinity; if (lo == null) for (const v of a) if (Number.isFinite(v)) { mn = Math.min(mn, v); mx = Math.max(mx, v); } if (mx <= mn) mx = mn + 1;
    let d = ''; const step = Math.max(1, Math.floor(n / W)); for (let i = 0; i < n; i += step) { const v = a[i]; if (!Number.isFinite(v)) continue; const x = i / n * W, y = y0 + H - pad - (Math.min(mx, Math.max(mn, v)) - mn) / (mx - mn) * (H - 2 * pad); d += (d ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1); }
    g.push(`<line x1="0" x2="${W}" y1="${y0 + H}" y2="${y0 + H}" stroke="#333"/><path d="${d}" fill="none" stroke="${col}" stroke-width="1"/><text x="4" y="${y0 + 12}" fill="#ccc">${lab} [${(+mn).toPrecision(3)} .. ${(+mx).toPrecision(3)}]</text>`); });
  for (const m of marks) g.push(`<line x1="${m.t * FR / n * W}" x2="${m.t * FR / n * W}" y1="0" y2="${rowsH}" stroke="#f80" stroke-dasharray="3 3"/><text x="${m.t * FR / n * W + 3}" y="${rowsH + 14}" fill="#f80">${m.name}</text>`);
  for (let s = 0; s < n / FR; s += 10) g.push(`<text x="${s * FR / n * W}" y="${rowsH + 14}" fill="#666">${s}s</text>`);
  g.push('</svg>'); fs.writeFileSync(path.join(DIR, name + '.svg'), g.join(''));
}

const results = {};
for (const name of NAMES) {
  const { meta, rows } = readLog(path.join(DIR, name + '.jsonl')); if (rows.length < 100) { console.log('skip', name); continue; }
  const t0a = meta.t0audio, dur = Math.min(meta.dur, rows.at(-1).t - t0a - .2);
  const F = features(readWav(meta.wav), meta.start, dur), n = F.n;
  // song time in the log: received audio minus the song's start in the analyser's count
  for (const r of rows) r.ts = r.t - t0a;
  // the harness read the song's start a little late (page busy): align the log to the wav by the page's own level against the wav's loudness
  let ALIGN = 0; { const lvT = (sh) => { const a = new Float64Array(n).fill(NaN); let j = 0; for (let i = 0; i < n; i++) { const t = i / FR + sh; while (j + 1 < rows.length && rows[j + 1].ts <= t) j++; const r = rows[j]; if (r && Math.abs(r.ts - t) < .08) a[i] = r.lvl; } return a; };
    const lin = F.rms.map((v) => Math.pow(10, v / 20)), base = fillNaN(lvT(0)); const xc = xcorr(hp(smooth(lin, 5), 100), hp(base, 100), 60); ALIGN = xc.lagMs / 1000; for (const r of rows) r.ts -= ALIGN; }
  const rs = rows.filter((r) => r.ts >= 0); const G = (k) => { const a = new Float64Array(n).fill(NaN); let j = 0; for (let i = 0; i < n; i++) { const t = i / FR; while (j + 1 < rs.length && rs[j + 1].ts <= t) j++; const r = rs[j]; if (r && Math.abs(r.ts - t) < .08 && r[k] != null) a[i] = r[k]; } return a; };
  const K = ['sc', 'sx', 'sy', 'shell', 'kick', 'spk', 'chaos', 'regA', 'reg', 'coreR', 'coreI', 'halo', 'morphA', 'skinA', 'caA', 'ph', 'cnt', 'gate', 'lock', 'hz', 'groove', 'A', 'Vl', 'M', 'show', 'z', 'D', 'awake', 'grid', 'X', 'abpm', 'aconf', 'lvl', 'drop', 'bead', 'hor', 'rhy', 'lum', 'area', 'a15', 'a30', 'a50', 'cy', 'cx', 'diff'];
  const S = {}; for (const k of K) S[k] = G(k);
  const truthP = path.join(DIR, name + '.truth.json'), truth = fs.existsSync(truthP) ? JSON.parse(fs.readFileSync(truthP, 'utf8')) : null;
  let beats, bpmRef, refKind; if (truth) { beats = truth.beats.map((b) => b.t - meta.start).filter((t) => t >= 0 && t < dur); refKind = 'ground truth'; }
  else { const tb = trackBeats(F.flux); beats = tb.beats; bpmRef = tb.bpm; refKind = 'offline DP tracker (not ground truth)'; }
  const bpmAt = (t) => { if (truth) { const s = truth.sections.find((s) => t >= s.start && t < s.end); if (s) return s.bpm; return 60 / (truth.beats[1].t - truth.beats[0].t); } return bpmRef; };
  // visible signals
  const radius = fillNaN(Float64Array.from(Number.isFinite(mean(S.a30)) ? S.a30 : S.area, (a) => Math.sqrt(a))), diff = fillNaN(S.diff), sc = fillNaN(S.sc), cyPx = fillNaN(Float64Array.from(S.cy, (v) => v * 520));
  const flux = F.flux, env = smooth(F.rms, 50), fluxS = smooth(flux, 50);
  const R = { name, alignMs: +(ALIGN * 1000).toFixed(0), refKind, dur: +dur.toFixed(1), fps: +(rows.length / ((rows.at(-1).now - rows[0].now) / 1000)).toFixed(1) };
  // 1 cross-correlations
  R.xc = {
    onset_vs_pixelMotion: xcorr(hp(flux, 50), hp(diff, 50), 50),
    lowOnset_vs_scaleRise: xcorr(hp(F.low, 50), hp(Float64Array.from(sc, (v, i) => Math.max(0, v - (sc[i - 1] ?? v))), 50), 50),
    onset_vs_scale: xcorr(hp(flux, 50), hp(sc, 50), 50),
    loudness_vs_scale_slow: xcorr(hp(env, 1000), hp(smooth(sc, 50), 1000), 300),
    loudness_vs_pixelMotion_slow: xcorr(hp(env, 1000), hp(smooth(diff, 100), 1000), 300),
    onsetDensity_vs_pixelMotion_slow: xcorr(hp(fluxS, 1000), hp(smooth(diff, 100), 1000), 300),
  };
  for (const v of Object.values(R.xc)) { v.r = +v.r.toFixed(3); v.r0 = +v.r0.toFixed(3); }
  // 2 beat alignment
  const usable = beats.filter((t) => t > 4);   // skip the first seconds of waking
  const bsSc = beatSync(hp(sc, 200), usable), bsRad = beatSync(hp(radius, 200), usable), bsDiff = beatSync(hp(diff, 200), usable), bsCy = beatSync(hp(cyPx, 200), usable), bsFlux = beatSync(hp(flux, 200), usable);
  const meanRad = mean(radius) * 520 / 2;   // body radius in px (area share of a 520 px window, as sqrt(area/pi)... approx: half-width of the occupied square)
  R.beat = {
    scaleProfileDepthPct: +(bsSc.depth / mean(sc) * 100).toFixed(2), scalePeakPhase: +bsSc.peakPh.toFixed(2),
    radiusDepthPx: +(bsRad.depth * 520 / Math.sqrt(Math.PI)).toFixed(2), bodyRadiusPx: +(mean(radius) * 520 / Math.sqrt(Math.PI)).toFixed(1), radiusPeakPhase: +bsRad.peakPh.toFixed(2),
    verticalDipDepthPx: +bsCy.depth.toFixed(2), pixelMotionPeakPhase: +bsDiff.peakPh.toFixed(2), pixelMotionDepthRel: +(bsDiff.depth / mean(diff)).toFixed(2), audioOnsetPeakPhase: +bsFlux.peakPh.toFixed(2), lowOnsetPeakPhase: +beatSync(hp(F.low, 200), usable).peakPh.toFixed(2),
    scaleBeatLockedShare: +beatLockedShare(hp(sc, 200), usable).toFixed(3), pixelBeatLockedShare: +beatLockedShare(hp(diff, 200), usable).toFixed(3), audioBeatLockedShare: +beatLockedShare(hp(flux, 200), usable).toFixed(3),
  };
  R.beat.scaleProfile = bsSc.prof.map((v) => +(v / mean(sc) * 100).toFixed(2));
  R.beat.otherDepthRel = {}; for (const k of ["shell", "kick", "coreI", "coreR", "spk", "halo", "lum"]) { const a = fillNaN(S[k]); const b = beatSync(hp(a, 200), usable); R.beat.otherDepthRel[k] = { depthRel: +(b.depth / (Math.abs(mean(a)) || 1e-9)).toFixed(3), peakPh: +b.peakPh.toFixed(2), locked: +beatLockedShare(hp(a, 200), usable).toFixed(3) }; }
  // felt beats (SHOW.count increments) against the reference beats
  const felt = []; for (let i = 1; i < rs.length; i++) if (rs[i].cnt > rs[i - 1].cnt && rs[i].ts > 4) { const f = (1 - rs[i - 1].ph) / Math.max(1e-6, rs[i].ph + 1 - rs[i - 1].ph); felt.push({ t: rs[i - 1].ts + f * (rs[i].ts - rs[i - 1].ts), hor: rs[i].hor, gate: rs[i].gate }); }
  const offs = [], offsMs = []; for (const fb of felt) { const bpm = bpmAt(fb.t), P = 60 / bpm; let k = 0; while (k + 1 < beats.length && beats[k + 1] <= fb.t) k++; const near = [beats[k], beats[k + 1]].filter(Number.isFinite).reduce((a, b) => Math.abs(b - fb.t) < Math.abs(a - fb.t) ? b : a);
    // the shown phase leads the received audio by the horizon; it is drawn ~1.5 frames + 4 ms later (the page's own estimate): screen time = t + 29 ms
    const d = (fb.t + .029 - near); offs.push(d / P); offsMs.push(d * 1000); }
  const c = offs.length ? circ(offs) : { R: NaN, mu: NaN };
  const ib = felt.slice(1).map((f, i) => f.t - felt[i].t);
  R.felt = { n: felt.length, phaseR: +c.R.toFixed(3), meanOffsetMs: +(c.mu * 60 / bpmAt(30) * 1000).toFixed(0), medAbsOffMs: +[...offsMs].map(Math.abs).sort((a, b) => a - b)[offsMs.length >> 1]?.toFixed(0), gatedShare: +(felt.filter((f) => f.gate > .5).length / Math.max(1, felt.length)).toFixed(2) };
  const fb = felt.map((f) => f.t - .029); R.feltGrid = { audioLocked: +beatLockedShare(hp(flux, 200), fb).toFixed(3), audioLockedRef: +beatLockedShare(hp(flux, 200), usable).toFixed(3), scaleLocked: +beatLockedShare(hp(sc, 200), fb).toFixed(3), radiusLocked: +beatLockedShare(hp(radius, 200), fb).toFixed(3), pixLocked: +beatLockedShare(hp(diff, 200), fb).toFixed(3), radiusDepthPx: +(beatSync(hp(radius, 200), fb).depth * 520 / Math.sqrt(Math.PI)).toFixed(2), audioOnsetPeakPh: +beatSync(hp(flux, 200), fb).peakPh.toFixed(2), radiusPeakPh: +beatSync(hp(radius, 200), fb).peakPh.toFixed(2), scalePeakPh: +beatSync(hp(sc, 200), fb).peakPh.toFixed(2) };
  // tempo: felt and analyser vs reference, per second
  const ratios = { '1': 0, '2': 0, '1/2': 0, '3/2': 0, '2/3': 0, other: 0 }, aratios = { ...ratios, none: 0 }; let nS = 0;
  const cls = (r) => { for (const [k, v] of [['1', 1], ['2', 2], ['1/2', .5], ['3/2', 1.5], ['2/3', 2 / 3]]) if (Math.abs(Math.log(r / v)) < .04) return k; return 'other'; };
  for (let s = 5; s < dur; s++) { const i = s * FR, ref = bpmAt(s); if (!Number.isFinite(S.hz[i])) continue; nS++; ratios[cls(S.hz[i] * 60 / ref)]++; const ab = S.abpm[i]; if (ab > 0) aratios[cls(ab / ref)]++; else aratios.none++; }
  for (const k in ratios) ratios[k] = +(ratios[k] / nS).toFixed(2); for (const k in aratios) aratios[k] = +(aratios[k] / nS).toFixed(2);
  R.tempo = { refBpm: truth ? [...new Set(truth.sections.map((s) => s.bpm))].join('/') || +(60 / (truth.beats[1].t - truth.beats[0].t)).toFixed(1) : +bpmRef.toFixed(1), feltBpmMedian: +(([...S.hz].filter(Number.isFinite).sort((a, b) => a - b)[Math.floor(n / 2)] || 0) * 60).toFixed(1), feltRatio: ratios, analyserRatio: aratios };
  // 3 gates
  const share = (a, f) => { let k = 0, m = 0; for (let i = 5 * FR; i < n; i++) if (Number.isFinite(a[i])) { m++; if (f(a[i])) k++; } return +(k / Math.max(1, m)).toFixed(2); };
  R.gates = { lockOver05: share(S.lock, (v) => v > .5), danceOver03: share(S.D, (v) => v > .3), danceOver05: share(S.D, (v) => v > .5), danceMean: +mean(S.D.slice(5 * FR)).toFixed(2), showGateOver05: share(S.gate, (v) => v > .5), maximalismOver04: share(S.M, (v) => v > .4), morphShowOver03: share(S.show, (v) => v > .3), asleepOver05: share(S.z, (v) => v > .5), rhythmOrganAligned: share(S.rhy, (v) => v > .5), beadsOn: share(S.bead, (v) => v > .3) };
  // 4 statistics of motion (for comparing songs)
  const lo = 5 * FR, sl = (a) => a.slice(lo);
  R.stats = { scaleMean: +mean(sl(sc)).toFixed(3), scaleStd: +std(sl(sc)).toFixed(4), scaleStdFast: +std(sl(hp(sc, 50))).toFixed(4), radiusPx: R.beat.bodyRadiusPx, radiusStdPx: +(std(sl(radius)) * 520 / Math.sqrt(Math.PI)).toFixed(2), pixMotionMean: +mean(sl(diff)).toFixed(4), pixMotionStd: +std(sl(diff)).toFixed(4),
    shiftStd: +Math.hypot(std(sl(S.sx)), std(sl(S.sy))).toFixed(4), spikes: +mean(sl(S.spk)).toFixed(3), chaos: +mean(sl(S.chaos)).toFixed(3), coreI: +mean(sl(S.coreI)).toFixed(2), coreIStd: +std(sl(S.coreI)).toFixed(3), halo: +mean(sl(S.halo)).toFixed(2), lum: +mean(sl(S.lum)).toFixed(3), lumStd: +std(sl(S.lum)).toFixed(4), arousal: +mean(sl(S.A)).toFixed(2), arousalStd: +std(sl(S.A)).toFixed(3), valence: +mean(sl(S.Vl)).toFixed(2), X: +mean(sl(S.X)).toFixed(2),
    audioRmsDbMean: +mean(sl(F.rms)).toFixed(1), audioRmsDbStd: +std(sl(F.rms)).toFixed(1), audioOnsetMean: +mean(sl(flux)).toFixed(1), audioCentroidHz: +mean(sl(F.cen)).toFixed(0) };
  // 5 sections (synthetic only)
  if (truth && truth.sections.length) R.sections = truth.sections.map((s) => { const a = Math.round(Math.max(0, s.start - meta.start) * FR), b = Math.round(Math.min(dur, s.end - meta.start) * FR); if (b <= a) return null; const m = (x) => +mean(x.slice(a, b)).toFixed(3);
    return { name: s.name, start: +s.start.toFixed(1), rmsDb: +mean(F.rms.slice(a, b)).toFixed(1), scale: m(sc), radiusPx: +(mean(radius.slice(a, b)) * 520 / Math.sqrt(Math.PI)).toFixed(1), pixMotion: +mean(diff.slice(a, b)).toFixed(4), dance: m(S.D), lock: m(S.lock), M: m(S.M), show: m(S.show), A: m(S.A), feltBpm: +(mean(S.hz.slice(a, b)) * 60).toFixed(1), ...(() => { const bb = beats.filter((t) => t >= s.start - meta.start && t < s.end - meta.start), q = beatSync(hp(sc, 200), bb), pd = beatSync(hp(diff, 200), bb); return { beatDepthPct: +(q.depth / mean(sc) * 100).toFixed(2), scalePeakPh: +q.peakPh.toFixed(2), scaleLocked: +beatLockedShare(hp(sc, 200), bb).toFixed(3), pixLocked: +beatLockedShare(hp(diff, 200), bb).toFixed(3), audioLocked: +beatLockedShare(hp(flux, 200), bb).toFixed(3) }; })(), asleep: m(S.z) }; }).filter(Boolean);
  if (truth && truth.sections.length) { // response latency at section changes: time for the 1 s smoothed pixel motion / dance to cross halfway between the two sections' levels
    const dS = smooth(diff, 50); R.transitions = [];
    for (let k = 1; k < truth.sections.length; k++) { const A = truth.sections[k - 1], Bs = truth.sections[k], tb = Bs.start - meta.start; if (tb > dur - 3) continue;
      for (const [lab, sig] of [['pixMotion', dS], ['dance', S.D], ['lock', S.lock], ['scale', smooth(sc, 50)], ['arousal', S.A]]) { const before = mean(sig.slice(Math.round((tb - 4) * FR), Math.round(tb * FR))), after = mean(sig.slice(Math.round((tb + 6) * FR), Math.round((tb + 10) * FR))), half = (before + after) / 2;
        let lat = null; for (let i = Math.round(tb * FR); i < Math.min(n, Math.round((tb + 10) * FR)); i++) if ((after > before && sig[i] >= half) || (after < before && sig[i] <= half)) { lat = (i / FR - tb); break; }
        R.transitions.push({ at: `${A.name}->${Bs.name}`, signal: lab, before: +before.toFixed(4), after: +after.toFixed(4), halfwaySec: lat == null ? null : +lat.toFixed(2) }); } } }
  results[name] = R;
  const marks = truth ? truth.sections.map((s) => ({ t: s.start - meta.start, name: s.name })).filter((m) => m.t >= 0) : [];
  svg(name, n, [['audio rms dB', F.rms, '#7cf'], ['audio onset flux', smooth(flux, 5), '#7cf'], ['body scale uScale', sc, '#fc6'], ['visible radius (px share)', radius, '#fc6'], ['pixel motion (frame diff)', smooth(diff, 5), '#f96'],
    ['dance gate MOT.D', S.D, '#9f9', 0, 1], ['mind.lock', S.lock, '#9f9', 0, 1], ['maximalism REST.M', S.M, '#c9f', 0, 1], ['skin shown MORPH.show', S.show, '#c9f', 0, 1], ['arousal', S.A, '#f9c', 0, 1], ['felt bpm (mind)', Float64Array.from(S.hz, (v) => v * 60), '#ff9', 40, 200], ['analyser bpm', S.abpm, '#ff9', 40, 200], ['asleep SLEEP.z', S.z, '#888', 0, 1]], marks);
  // zoom: 8 s of a groove, scale against beats
  { const z0 = Math.min(Math.max(10, dur / 2) | 0, Math.max(0, dur - 9)) * FR, zn = 8 * FR, cut = (a) => a.slice(z0, z0 + zn), bm = new Float64Array(zn); for (const t of beats) { const i = Math.round(t * FR) - z0; if (i >= 0 && i < zn) for (let j = 0; j < 3; j++) bm[i + j] = 1; }
    const zs = [['beats (reference)', bm, '#f80', 0, 1], ['audio onset flux', cut(flux), '#7cf'], ['body scale', cut(sc), '#fc6'], ['visible radius', cut(radius), '#fc6'], ['vertical centroid px', cut(cyPx), '#9cf'], ['pixel motion', cut(diff), '#f96'], ['shown phase SHOW.phase', cut(S.ph), '#9f9', 0, 1]];
    svg(name + '-zoom', zn, zs, [{ t: 0, name: `from ${(z0 / FR).toFixed(0)} s` }]); }
  console.log(name, 'ok');
}
fs.writeFileSync(path.join(DIR, 'results.json'), JSON.stringify(results, null, 1));
})();
