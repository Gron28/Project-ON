// lab/prototypes/cellab/app.mjs - the CelLab gallery: automata on and inside ON's body, driven by a stand-in mind.
//
// Rules after CelLab / WebCA by Rudy Rucker and John Walker (Fourmilab, https://www.fourmilab.ch/cellab/), public domain:
// "All of these programs are in the public domain and may be used in any way without any restrictions whatsoever."
// Palettes are decoded from their dev kit. See rules.mjs for which rules are faithful ports and which are adaptations.

import { fullscreen, gpuTimer, rotYX } from './gl.mjs';
import { createSphere2D } from './sphere2d.mjs';
import { createVolume3D } from './volume3d.mjs';
import { RULES_2D, RULES_3D, RULE_INDEX_2D, RULE_INDEX_3D, MOOD_RULES, LIFE3D_VARIANTS } from './rules.mjs';
import { PALETTES, paletteRGBA, GRADIENTS, isGradient, gradientRGBA } from './palettes.mjs';
import { createMind } from './mind.mjs';
import { createStimuli } from '../nervous-system/stimuli.mjs';

const qs = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const canvas = $('c');
const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: qs.has('shot') });
if (!gl) throw new Error('WebGL2 is not available');
const half = !!gl.getExtension('EXT_color_buffer_float');
const draw = fullscreen(gl);
const timer = gpuTimer(gl);

// one cube-sphere per grid size (rules with glider-scale structure read better on a coarser grid); built on first use
const spheres = new Map();
let sphere = null;
function sphereFor(N) {
  N = +(qs.get('n') || N || 256);
  if (!spheres.has(N)) { const s = createSphere2D(gl, { N, half }); s.build(draw); spheres.set(N, s); }
  return (sphere = spheres.get(N));
}
const volume = createVolume3D(gl);

// ---- state
const S = {
  mode: qs.get('mode') === '3d' ? '3d' : '2d',
  rule2d: qs.get('mode') !== '3d' && qs.get('rule') ? qs.get('rule') : 'rainzha',
  rule3d: qs.get('mode') === '3d' && qs.get('rule') ? qs.get('rule') : 'scroll3d',
  life3d: qs.get('variant') || 'pyro',
  palette: qs.get('palette') || 'auto',
  mood: qs.get('mood') || 'auto',     // auto: the mind's mood
  follow: qs.get('follow') !== '0',   // the mood picks the rule
  input: qs.get('input') || 'groove',
  rate: 1, seeds: 1, relief: 1, tint: 0.45, glow: 1.1, smooth: 0.35, density: 1, shell: 0.6, scale: +(qs.get('scale') || 1),
  paused: false, drive: true,
};
const ruleMeta = () => (S.mode === '2d' ? RULES_2D.find((r) => r.id === S.rule2d) : RULES_3D.find((r) => r.id === S.rule3d));
let needInit = true, pendingSeeds = [], stepAcc = 0, stepsDone = 0, stepsRate = 0;

// ---- input: synthetic sound, a file, or the microphone; all of it goes through the mind
const stim = createStimuli();
const mind = createMind();
let actx = null, node = null, soundOn = false, fileBuf = null, filePos = 0, micStream = null;
function setInput(v) {
  S.input = v;
  if (micStream && v !== 'mic') { micStream.getTracks().forEach((t) => t.stop()); micStream = null; node?.port.postMessage({ type: 'capture', on: false }); }
  if (['groove', 'build', 'rough', 'poly', 'tone', 'silence', 'click'].includes(v)) stim.setMode(v);
  if (v === 'file') $('file').click();
  if (v === 'mic') startMic();
}
async function ensureAudio() {
  if (actx) return actx;
  actx = new AudioContext({ sampleRate: 48000 });
  await actx.audioWorklet.addModule(new URL('../nervous-system/io-worklet.js', import.meta.url));
  node = new AudioWorkletNode(actx, 'ns-io', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
  node.connect(actx.destination);
  node.port.onmessage = (e) => { if (S.input === 'mic') mind.feed(e.data); };
  return actx;
}
async function startMic() {
  try {
    await ensureAudio(); await actx.resume();
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    actx.createMediaStreamSource(micStream).connect(node);
    node.port.postMessage({ type: 'capture', on: true });
  } catch (e) { console.warn('microphone:', e.message); S.input = 'groove'; stim.setMode('groove'); syncUI(); }
}
$('file').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  await ensureAudio();
  const ab = await actx.decodeAudioData(await f.arrayBuffer());
  const m = new Float32Array(ab.length);
  for (let c = 0; c < ab.numberOfChannels; c++) { const d = ab.getChannelData(c); for (let i = 0; i < m.length; i++) m[i] += d[i] / ab.numberOfChannels; }
  fileBuf = m; filePos = 0; S.input = 'file'; syncUI();
};
const chunk = new Float32Array(9600);
function pumpAudio(dt) {
  if (S.input === 'mic') return;
  const n = Math.min(chunk.length, Math.round(dt * 48000));
  if (n <= 0) return;
  const x = chunk.subarray(0, n);
  if (S.input === 'file' && fileBuf) { for (let i = 0; i < n; i++) { x[i] = fileBuf[filePos++]; if (filePos >= fileBuf.length) filePos = 0; } }
  else if (S.input === 'file') x.fill(0);
  else stim.fill(x);
  mind.feed(x);
  if (soundOn && node) node.port.postMessage({ type: 'play', data: x.slice() });
}

// ---- rules, palettes, parameters
function paletteName() { return S.palette === 'auto' ? ruleMeta().palette : S.palette; }
function applyRule() {
  const m = ruleMeta();
  const pn = paletteName(), grad = isGradient(pn) ? 1 : 0;
  const pal = grad ? gradientRGBA(pn) : paletteRGBA(pn);
  if (S.mode === '2d') sphereFor(m.n).setPalette(pal, grad);
  else {
    volume.setPalette(pal, grad);
    if (S.rule3d === 'scroll3d') volume.setParams([22, 1, 10, 0]);
    else if (S.rule3d === 'brain3d') volume.setParams([4, 6, 5, 0]);
    else if (S.rule3d === 'life3d') {
      const v = LIFE3D_VARIANTS[S.life3d] || LIFE3D_VARIANTS.pyro;
      const mask = (a) => a.reduce((x, c) => (x | (1 << c)) >>> 0, 0);
      volume.setParams([mask(v.S), mask(v.B), v.states, 0]);
    } else volume.setParams([0, 0, 0, 0]);
  }
  $('cap-name').textContent = m.name;
  $('cap-tag').textContent = m.tag;
  $('cap-tag').className = 'tag ' + (m.tag === 'faithful' ? 'ok' : m.tag === '3D' ? 'td' : 'ad');
  $('cap-text').textContent = m.caption;
  $('cap-note').textContent = m.note;
  drawStrip(pal);
  $('variant-row').style.display = S.mode === '3d' && S.rule3d === 'life3d' ? '' : 'none';
  needInit = true;
}
function setMode(m) { S.mode = m; fillRules(); applyRule(); syncUI(); }
function setRule(id) { if (S.mode === '2d') S.rule2d = id; else S.rule3d = id; applyRule(); syncUI(); }
function pickForMood(mood) {
  const list = MOOD_RULES[S.mode][mood];
  const cur = S.mode === '2d' ? S.rule2d : S.rule3d;
  if (list.includes(cur)) return;
  setRule(list[0]);
}

// ---- seeds: where the mind's beats land
function randDir() { const z = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - z * z); return [r * Math.cos(a), r * Math.sin(a), z]; }
function addSeeds(n, strength = 1) {
  for (let i = 0; i < n; i++) {
    if (S.mode === '2d') { const [x, y, z] = randDir(); pendingSeeds.push({ x, y, z, r: (0.05 + 0.07 * strength) * (ruleMeta().seedR || 1) * (0.7 + 0.6 * Math.random()) }); }
    else {
      const [x, y, z] = randDir(), [nx, ny, nz] = randDir(), rr = 0.75 * Math.cbrt(Math.random());
      pendingSeeds.push({ x: x * rr, y: y * rr, z: z * rr, r: (0.1 + 0.1 * strength) * (0.7 + 0.6 * Math.random()), nx, ny, nz });
    }
  }
  if (pendingSeeds.length > 8) pendingSeeds = pendingSeeds.slice(-8);
}

// ---- view
let yaw = 0.4, pitch = 0.3, dragging = null, autoSpin = 0;
canvas.addEventListener('pointerdown', (e) => { dragging = { x: e.clientX, y: e.clientY, yaw, pitch }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => { if (!dragging) return; yaw = dragging.yaw + (e.clientX - dragging.x) * 0.006; pitch = Math.max(-1.4, Math.min(1.4, dragging.pitch + (e.clientY - dragging.y) * 0.006)); });
canvas.addEventListener('pointerup', () => { dragging = null; });
function resize() {
  const dpr = Math.min(1.5, window.devicePixelRatio || 1) * S.scale;
  const w = Math.max(64, Math.round(canvas.clientWidth * dpr)), h = Math.max(64, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}

// ---- frame
let last = performance.now(), tAll = 0, fpsE = 60, cpuE = 0, frameMs = [];
function frame(now) {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now; tAll += dt;
  const c0 = performance.now();
  if (dt > 0) { fpsE = fpsE * 0.95 + (1 / dt) * 0.05; frameMs.push(dt * 1000); if (frameMs.length > 240) frameMs.shift(); }
  resize();
  pumpAudio(dt);
  const ms = mind.st;
  for (const e of mind.take()) {
    if (!S.drive) continue;
    if (e.type === 'beat') addSeeds(Math.max(0, Math.round(S.seeds * (1 + 2 * ms.arousal) * (S.mode === '3d' ? 0.7 : 1))), 0.6 + 0.6 * ms.arousal);
    else if (e.type === 'hit') addSeeds(Math.round(S.seeds), 0.5);
    else if (e.type === 'startle') addSeeds(Math.round(2 * S.seeds) + 1, 1.4);
    else if (e.type === 'mood' && S.mood === 'auto' && S.follow) pickForMood(e.mood);
  }
  const mood = S.mood === 'auto' ? ms.mood : S.mood;
  const moodRate = { calm: 0.6, flowing: 1, rough: 1.15, wild: 1.4 }[mood];
  const m = ruleMeta();
  stepsRate = S.paused ? 0 : m.steps * S.rate * (S.drive ? (0.35 + 1.3 * ms.arousal) * moodRate : 1);
  timer.begin();
  const rule = S.mode === '2d' ? RULE_INDEX_2D[S.rule2d] : RULE_INDEX_3D[S.rule3d];
  if (needInit) {
    if (S.mode === '2d') sphere.step(draw, { rule, init: true, dens: m.dens });
    else volume.step(draw, { rule, init: true, dens: m.dens });
    needInit = false;
  }
  stepAcc += stepsRate * dt;
  let n = Math.min(S.mode === '2d' ? 6 : 4, Math.floor(stepAcc)); stepAcc -= n;
  if (stepAcc > 2) stepAcc = 2;
  for (let i = 0; i < n; i++) {
    const seeds = i === 0 ? pendingSeeds : [];
    if (S.mode === '2d') sphere.step(draw, { rule, seeds, dens: Math.min(1, 0.55 + 0.25 * S.seeds), leak: 0.0015 });
    else volume.step(draw, { rule, seeds, dens: Math.min(1, 0.55 + 0.25 * S.seeds) });
    if (i === 0) pendingSeeds = [];
    stepsDone++;
  }
  const keep = Math.pow(S.smooth, dt * 60);
  const rot = rotYX(yaw + (dragging ? 0 : (autoSpin += dt * 0.12)), pitch);
  if (S.mode === '2d') {
    sphere.look(draw, { rule, keep: rule >= 8 ? Math.max(keep, Math.pow(0.6, dt * 60)) : keep, blur: rule >= 8 ? 1 : 0.55 });
    sphere.render(draw, { w: canvas.width, h: canvas.height, rot, amp: m.relief * S.relief, tint: S.tint, glow: S.glow, time: tAll, pulse: ms.pulse });
  } else {
    volume.look(draw, { rule, keep });
    volume.render(draw, { w: canvas.width, h: canvas.height, rot, density: 14 * S.density, glow: 1.6 * S.glow, time: tAll, pulse: ms.pulse, shell: S.shell, steps: +(qs.get('steps') || 112), nucleus: 1.2 });
  }
  timer.end();
  cpuE = cpuE * 0.9 + (performance.now() - c0) * 0.1;
  hud(ms, mood);
  requestAnimationFrame(frame);
}

// ---- UI
function fillRules() {
  const sel = $('rule'); sel.innerHTML = '';
  for (const r of S.mode === '2d' ? RULES_2D : RULES_3D) { const o = document.createElement('option'); o.value = r.id; o.textContent = `${r.name}  (${r.tag})`; sel.appendChild(o); }
  $('relief-row').style.display = S.mode === '2d' ? '' : 'none';
  $('tint-row').style.display = S.mode === '2d' ? '' : 'none';
  $('density-row').style.display = S.mode === '3d' ? '' : 'none';
  $('shell-row').style.display = S.mode === '3d' ? '' : 'none';
}
function syncUI() {
  $('rule').value = S.mode === '2d' ? S.rule2d : S.rule3d;
  for (const b of document.querySelectorAll('[data-mode]')) b.classList.toggle('on', b.dataset.mode === S.mode);
  $('palette').value = S.palette; $('mood').value = S.mood; $('follow').checked = S.follow; $('input').value = S.input;
  $('variant').value = S.life3d; $('pause').textContent = S.paused ? 'Play' : 'Pause';
  $('sound').textContent = soundOn ? 'Sound off' : 'Sound on';
}
function drawStrip(rgba) {
  const cv = $('strip'), cx = cv.getContext('2d'), img = cx.createImageData(256, 1);
  img.data.set(rgba); cx.putImageData(img, 0, 0);
}
function bindRange(id, key, fmt = (v) => v.toFixed(2)) {
  const el = $(id), out = $(id + '-v');
  el.value = S[key]; out.textContent = fmt(+el.value);
  el.oninput = () => { S[key] = +el.value; out.textContent = fmt(S[key]); };
}
function initUI() {
  const ps = $('palette'); ps.innerHTML = '<option value="auto">rule default</option>';
  for (const k of [...GRADIENTS, ...Object.keys(PALETTES)]) { const o = document.createElement('option'); o.value = k; o.textContent = isGradient(k) ? `${k} (gradient)` : `${k} (CelLab)`; ps.appendChild(o); }
  const vs = $('variant'); for (const [k, v] of Object.entries(LIFE3D_VARIANTS)) { const o = document.createElement('option'); o.value = k; o.textContent = v.name; vs.appendChild(o); }
  fillRules();
  for (const b of document.querySelectorAll('[data-mode]')) b.onclick = () => setMode(b.dataset.mode);
  $('rule').onchange = (e) => setRule(e.target.value);
  $('palette').onchange = (e) => { S.palette = e.target.value; applyRule(); needInit = false; };
  $('variant').onchange = (e) => { S.life3d = e.target.value; applyRule(); };
  $('mood').onchange = (e) => { S.mood = e.target.value; if (S.mood !== 'auto') pickForMood(S.mood); };
  $('follow').onchange = (e) => { S.follow = e.target.checked; };
  $('input').onchange = (e) => setInput(e.target.value);
  $('drive').onchange = (e) => { S.drive = e.target.checked; };
  $('reset').onclick = () => { needInit = true; };
  $('pause').onclick = () => { S.paused = !S.paused; syncUI(); };
  $('drop').onclick = () => addSeeds(Math.max(1, Math.round(S.seeds * 2)), 1);
  $('random').onclick = () => {
    const list = S.mode === '2d' ? RULES_2D : RULES_3D, r = list[Math.floor(Math.random() * list.length)];
    const pals = [...GRADIENTS, ...Object.keys(PALETTES)];
    S.palette = Math.random() < 0.5 ? 'auto' : pals[Math.floor(Math.random() * pals.length)];
    if (S.mode === '3d') { const vk = Object.keys(LIFE3D_VARIANTS); S.life3d = vk[Math.floor(Math.random() * vk.length)]; }
    S.rate = +(0.5 + Math.random()).toFixed(2); S.seeds = +(0.5 + Math.random() * 2).toFixed(2);
    for (const [id, key] of [['rate', 'rate'], ['seeds', 'seeds']]) { $(id).value = S[key]; $(id + '-v').textContent = S[key].toFixed(2); }
    setRule(r.id);
  };
  $('sound').onclick = async () => { await ensureAudio(); soundOn = !soundOn; if (soundOn) await actx.resume(); else node.port.postMessage({ type: 'flush' }); syncUI(); };
  bindRange('rate', 'rate'); bindRange('seeds', 'seeds'); bindRange('relief', 'relief'); bindRange('tint', 'tint'); bindRange('glow', 'glow');
  bindRange('smooth', 'smooth'); bindRange('density', 'density'); bindRange('shell', 'shell');
  if (qs.get('ui') === '0') document.body.classList.add('bare');
  addEventListener('keydown', (e) => { if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return; if (e.code === 'Space') { S.paused = !S.paused; syncUI(); e.preventDefault(); } if (e.key === 'r') needInit = true; if (e.key === 'd') $('drop').click(); });
  syncUI();
}
function bar(id, v) { $(id).style.width = `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`; }
let hudT = 0;
function hud(ms, mood) {
  if ((hudT += 1) % 6) return;
  $('st-fps').textContent = fpsE.toFixed(0);
  $('st-gpu').textContent = timer.ms == null ? (timer.ok ? '...' : 'n/a') : timer.ms.toFixed(2);
  $('st-cpu').textContent = cpuE.toFixed(2);
  $('st-steps').textContent = stepsRate.toFixed(1);
  $('st-bpm').textContent = ms.lock > 0.3 ? ms.bpm.toFixed(0) : '-';
  $('st-mood').textContent = mood + (S.mood === 'auto' ? '' : ' (set)');
  bar('m-arousal', ms.arousal); bar('m-rough', ms.rough); bar('m-lock', ms.lock); bar('m-pulse', ms.pulse);
}

initUI();
applyRule();
syncUI();
setInput(S.input);
requestAnimationFrame(frame);

// lab hook: set state, read stats, drop seeds
window.__cellab = {
  S, mind,
  set(o) {
    if (o.mode && o.mode !== S.mode) { S.mode = o.mode; fillRules(); }
    if (o.rule) { if (S.mode === '2d') S.rule2d = o.rule; else S.rule3d = o.rule; }
    for (const k of ['palette', 'life3d', 'mood', 'follow', 'rate', 'seeds', 'relief', 'tint', 'glow', 'smooth', 'density', 'shell', 'paused', 'drive']) if (k in o) S[k] = o[k];
    if (o.input) setInput(o.input);
    applyRule(); syncUI();
  },
  seed(n = 3, s = 1) { addSeeds(n, s); },
  stats() {
    const f = frameMs.slice().sort((a, b) => a - b);
    return { fps: fpsE, gpuMs: timer.ms, gpuOk: timer.ok, cpuMs: cpuE, steps: stepsDone, stepsRate, p50: f[f.length >> 1], p95: f[Math.floor(f.length * 0.95)], w: canvas.width, h: canvas.height, mind: { ...mind.st } };
  },
  readState: () => (S.mode === '2d' ? sphere.readState() : null),
  readTables: () => sphere.readTables(),
};
