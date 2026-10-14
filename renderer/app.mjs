// app.mjs - the body: audio in, the fly's brain in a worker, MilkDrop presets steered by the fly, and the
// fly brain itself drawn at its real coordinates on top.
//
//   sound ──► ear worklet ──► brain worker ──► frame readouts ──► this file ──► picture
//                                   ▲                                              │
//                                   └───────────── eye (48x27 luminance) ◄─────────┘
//
// What the fly controls (all of it comes out of real neuron populations, see brain/worker.mjs):
//   perception     JON band drive replaces MilkDrop's bass / mid / treb: the preset reacts to what the fly hears
//   steer          right minus left descending neurons: yaw of the brain view and a sideways warp of the picture;
//                  a sustained turn is a decision: it walks to the next (right) or previous (left) preset
//   startle        the giant fibre (DNp01) fired: hard cut to a new preset and a white flash
//   valence        PAM (reward) against PPL1 (punishment) dopamine: hue warmth and saturation; long dislike -> leave
//   arousal        total descending activity: zoom breathing and chromatic spread
//   sleep          dorsal fan-shaped body: dims and slows the picture
//   motor          brain motor neurons (proboscis, antennae, neck): tiny jitters
import * as THREE from 'three';
import butterchurn from 'butterchurn';

const $ = (s) => document.querySelector(s);
const say = (t, ms = 2500) => { const e = $('#say'); e.textContent = t; e.classList.add('on'); clearTimeout(say.t); say.t = setTimeout(() => e.classList.remove('on'), ms); };
const log = [];
const note = (t) => { log.unshift(`${new Date().toLocaleTimeString()} ${t}`); log.length = Math.min(log.length, 8); say(t); };

// ------------------------------------------------------------------------------------------------
// presets: every pack that ships converted JSON
self.self = self;
for (const p of ['base', 'extra', 'nonMinimal', 'md1']) { await import(`../node_modules/butterchurn-presets/dist/${p}.js`); }
const PRESETS = {};
for (const p of ['base', 'extra', 'nonMinimal', 'md1']) { const m = self[p]; const o = m && (m.default || m); if (o && typeof o === 'object') Object.assign(PRESETS, o.getPresets ? o.getPresets() : o); }
const NAMES = Object.keys(PRESETS).sort();
$('#bootmsg').textContent = `${NAMES.length} presets, loading the connectome`;

// ------------------------------------------------------------------------------------------------
// brain
const metaRes = await fetch('../data/brain.json'); const META = await metaRes.json();
const bin = await (await fetch('../data/brain.bin')).arrayBuffer();
const worker = new Worker('../brain/worker.mjs', { type: 'module' });
const earChannel = new MessageChannel();
worker.onerror = (e) => console.error(`worker error: ${e.message} @ ${e.filename}:${e.lineno}`);
let BRAIN = null; // { N, pos, cls, nt, side, groups }
let F = null;     // last frame readout
const ready = new Promise((res) => { worker.addEventListener('message', (e) => { if (e.data.type === 'ready') { BRAIN = e.data; res(); } else if (e.data.type === 'frame') F = e.data; }); });
worker.postMessage({ type: 'init', bin, meta: META, earPort: earChannel.port2 }, [bin, earChannel.port2]);
await ready;
$('#bootmsg').textContent = `${BRAIN.N.toLocaleString()} neurons awake, ${BRAIN.ear} in the ear, ${BRAIN.eye.toLocaleString()} in the eyes`;

// ------------------------------------------------------------------------------------------------
// audio
const ctx = new AudioContext({ sampleRate: 48000 });
await ctx.audioWorklet.addModule('../audio/ear-worklet.js');
const earNode = new AudioWorkletNode(ctx, 'ear', { numberOfInputs: 1, numberOfOutputs: 0, processorOptions: {} });
earNode.port.postMessage({ port: earChannel.port1 }, [earChannel.port1]);
const mute = ctx.createGain(); mute.gain.value = 0; mute.connect(ctx.destination);
const analyser = ctx.createAnalyser(); analyser.fftSize = 1024; /* Butterchurn samples 512 points from 1024 */ analyser.smoothingTimeConstant = 0;
const timeBytes = new Uint8Array(analyser.fftSize);
// per-app capture (Windows): PCM chunks from the main process go into a feeder worklet
await ctx.audioWorklet.addModule('../audio/feed-worklet.js');
const feed = new AudioWorkletNode(ctx, 'feed', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
let feeding = false;
window.entity.onPcm((chunk) => { if (!feeding) return; const b = chunk.byteOffset % 2 ? chunk.slice() : chunk; feed.port.postMessage(new Int16Array(b.buffer, b.byteOffset, b.byteLength >> 1)); });
window.entity.onPcmEnd(() => { if (feeding) note('the app stopped playing'); });
async function refreshApps() {
  const sel = $('#src');
  for (const o of [...sel.options]) if (o.value.startsWith('app:')) o.remove();
  const { apps, error } = await window.entity.listApps();
  if (error) { sel.title = error; return; }
  for (const a of apps) { const o = document.createElement('option'); o.value = `app:${a.pid}`; o.textContent = `${a.name}: ${a.title.slice(0, 40)}`; sel.appendChild(o); }
}
let source = null, sourceKind = '', audioEl = null;
async function setSource(kind) {
  try {
    if (source) { try { source.disconnect(); } catch {} if (source.mediaStream) source.mediaStream.getTracks().forEach((t) => t.stop()); source = null; }
    if (audioEl) { audioEl.pause(); audioEl = null; }
    if (feeding) { feeding = false; await window.entity.stopApp(); }
    if (kind.startsWith('app:')) {
      const r = await window.entity.startApp(+kind.slice(4));
      if (r.error) { note(`app capture: ${r.error}`); return; }
      feeding = true; source = feed;
      kind = $('#src').selectedOptions[0]?.textContent || kind;
    } else if (kind === 'system') {
      const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
      stream.getVideoTracks().forEach((t) => t.stop());
      source = ctx.createMediaStreamSource(stream);
    } else if (kind === 'mic') {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      source = ctx.createMediaStreamSource(stream);
    } else if (kind === 'file') {
      const file = await window.entity.pickAudioFile();
      if (!file) return;
      audioEl = new Audio(); audioEl.src = 'file:///' + file.replace(/\\/g, '/'); audioEl.loop = true;
      source = ctx.createMediaElementSource(audioEl); source.connect(ctx.destination);
      await audioEl.play();
    }
    if (!source) return;
    source.connect(earNode); source.connect(analyser); analyser.connect(mute);
    sourceKind = kind; note(`listening to ${kind}`);
  } catch (e) { note(`audio: ${e.message}`); }
}
$('#src').addEventListener('change', (e) => setSource(e.target.value));
$('#src').addEventListener('pointerdown', () => refreshApps());
await ctx.resume();
await refreshApps();
// prefer a running Spotify (per-app capture does not depend on the default output device), else system audio
const spotify = [...$('#src').options].find((o) => /spotify/i.test(o.textContent));
if (spotify) { $('#src').value = spotify.value; setSource(spotify.value); } else setSource('system');

// ------------------------------------------------------------------------------------------------
// MilkDrop layer (Butterchurn) on its own canvas, perception from the fly
const bc = $('#bc');
const viz = butterchurn.createVisualizer(ctx, bc, { width: bc.width, height: bc.height, pixelRatio: 1, textureRatio: 1 });
const AL = viz.renderer.audioLevels;
const origLevels = AL.updateAudioLevels.bind(AL);
let perception = [0, 0, 0];
const att = new Float32Array(3).fill(1);
AL.updateAudioLevels = (fps, frame) => {
  origLevels(fps, frame);
  // MilkDrop's levels sit around 1 (= average); the fly's band drive is 0..1. Blend: the preset follows the fly's ear.
  for (let b = 0; b < 3; b++) {
    const own = AL.val[b], fly = 0.35 + 1.9 * perception[b];
    AL.val[b] = 0.3 * own + 0.7 * fly;
    att[b] += 0.08 * (AL.val[b] - att[b]); AL.att[b] = att[b];
  }
};
let presetIdx = Math.floor(Math.random() * NAMES.length), presetAt = performance.now();
function loadPreset(i, blend, why) { presetIdx = (i + NAMES.length) % NAMES.length; viz.loadPreset(PRESETS[NAMES[presetIdx]], blend); presetAt = performance.now(); if (why) note(`${why} → ${NAMES[presetIdx].slice(0, 48)}`); }
loadPreset(presetIdx, 0);

// ------------------------------------------------------------------------------------------------
// three: a post-processed composite of the MilkDrop canvas + the brain itself
const canvas = $('#view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.autoClear = false; // the frame is built in passes (picture, then the brain on top); clear by hand
const bcTex = new THREE.CanvasTexture(bc); bcTex.minFilter = THREE.LinearFilter; bcTex.magFilter = THREE.LinearFilter; bcTex.colorSpace = THREE.NoColorSpace;
const postScene = new THREE.Scene(), postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const PU = { tex: { value: bcTex }, uSteer: { value: 0 }, uValence: { value: 0 }, uArousal: { value: 0 }, uStartle: { value: 0 }, uSleep: { value: 0 }, uJitter: { value: new THREE.Vector2() }, uTime: { value: 0 }, uAspect: { value: 1 } };
postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: PU, depthTest: false, depthWrite: false,
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */`
    precision highp float; varying vec2 vUv; uniform sampler2D tex; uniform float uSteer, uValence, uArousal, uStartle, uSleep, uTime, uAspect; uniform vec2 uJitter;
    vec3 hueRotate(vec3 c, float a){ float s = sin(a), co = cos(a); mat3 m = mat3(0.299,0.587,0.114, 0.299,0.587,0.114, 0.299,0.587,0.114) + co*mat3(0.701,-0.587,-0.114, -0.299,0.413,-0.114, -0.3,-0.588,0.886) + s*mat3(0.168,0.330,-0.497, -0.328,0.035,0.292, 1.25,-1.05,-0.203); return c * m; }
    void main(){
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      // a turning fly skews the world sideways; arousal breathes the zoom
      float z = 1.0 - 0.06 * uArousal;
      c.x += uSteer * 0.12 * c.y * c.y * sign(c.y);
      c.x += uSteer * 0.05;
      c *= z;
      c += uJitter;
      uv = c + 0.5;
      // chromatic spread grows with arousal
      float ca = 0.004 * uArousal + 0.02 * uStartle;
      vec3 col;
      col.r = texture2D(tex, uv + vec2(ca, 0.0)).r;
      col.g = texture2D(tex, uv).g;
      col.b = texture2D(tex, uv - vec2(ca, 0.0)).b;
      // valence: warm and rich when rewarded, cold and drained when punished
      col = hueRotate(col, uValence * 0.35);
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(lum), col, 1.0 + 0.45 * uValence);
      col *= 1.0 + 0.15 * uValence;
      // sleep dims and vignettes
      float r = length((vUv - 0.5) * vec2(uAspect, 1.0));
      col *= mix(1.0, 0.35, uSleep) * (1.0 - uSleep * smoothstep(0.3, 0.9, r));
      col = mix(col, vec3(1.0), uStartle * 0.6);
      gl_FragColor = vec4(col, 1.0);
    }`,
})));

// the brain: one point per neuron at its real position
const N = BRAIN.N, pos = BRAIN.pos;
const brainScene = new THREE.Scene();
const brainCam = new THREE.PerspectiveCamera(40, 1, 10, 5000);
let center = new THREE.Vector3(), extent = 1;
{ const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (let i = 0; i < N; i++) for (let a = 0; a < 3; a++) { const p = pos[i * 3 + a]; if (p < mn[a]) mn[a] = p; if (p > mx[a]) mx[a] = p; } center.set((mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2); extent = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]); }
const geo = new THREE.BufferGeometry();
const P = new Float32Array(N * 3); for (let i = 0; i < N * 3; i++) P[i] = pos[i] - center.getComponent(i % 3);
geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
const activity = new Float32Array(N);
geo.setAttribute('act', new THREE.BufferAttribute(activity, 1).setUsage(THREE.DynamicDrawUsage));
// colour by class: sensory cyan, descending orange, central violet, optic blue-grey, motor red, modulatory (DA/5HT/OA) gold
const COL = new Float32Array(N * 3);
{ const by = { optic: [0.35, 0.45, 0.75], central: [0.62, 0.45, 0.95], sensory: [0.3, 0.9, 1], visual_projection: [0.45, 0.6, 0.9], ascending: [0.5, 1, 0.6], descending: [1, 0.6, 0.25], sensory_ascending: [0.3, 1, 0.8], visual_centrifugal: [0.5, 0.5, 0.9], motor: [1, 0.3, 0.3], endocrine: [1, 0.85, 0.4], unknown: [0.6, 0.6, 0.6] };
  for (let i = 0; i < N; i++) { let c = by[META.superClass[BRAIN.cls[i]]] || by.unknown; const nt = META.nt[BRAIN.nt[i]]; if (nt === 'DA' || nt === 'SER' || nt === 'OCT') c = [1, 0.85, 0.3]; COL[i * 3] = c[0]; COL[i * 3 + 1] = c[1]; COL[i * 3 + 2] = c[2]; } }
geo.setAttribute('color', new THREE.BufferAttribute(COL, 3));
// weight: the optic lobes are 77k of the 139k neurons and the photoreceptors fire all the time; dim them so the central brain reads
const WGT = new Float32Array(N);
for (let i = 0; i < N; i++) { const c = META.superClass[BRAIN.cls[i]]; WGT[i] = c === 'optic' ? 0.35 : c === 'sensory' ? 0.3 : 1; }
geo.setAttribute('wgt', new THREE.BufferAttribute(WGT, 1));
const BU = { uSize: { value: 1 }, uGhost: { value: 0.035 }, uAlpha: { value: 1 }, uH: { value: 800 } };
const points = new THREE.Points(geo, new THREE.ShaderMaterial({
  uniforms: BU, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: `attribute float act; attribute float wgt; attribute vec3 color; varying float vA; varying float vW; varying vec3 vC; uniform float uSize, uH;
    void main(){ vA = act; vW = wgt; vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
      // a soma is ~2 um; a firing one swells to 7 um of light. uH / (2 tan(fov/2)) converts um at depth -z to pixels
      gl_PointSize = max(1.0, uSize * (2.0 + 5.0 * act * wgt) * (uH / 0.728) / -mv.z); }`,
  fragmentShader: `precision highp float; varying float vA; varying float vW; varying vec3 vC; uniform float uGhost, uAlpha;
    void main(){ vec2 d = gl_PointCoord - 0.5; float r2 = dot(d, d); if (r2 > 0.25) discard; float k = 1.0 - r2 * 4.0; float a = (uGhost + vA * 0.5) * vW * k * uAlpha; gl_FragColor = vec4(mix(vC, vec3(1.0), vA * 0.35) * a, a); }`,
}));
brainScene.add(points);
const brainTarget = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
const overlayScene = new THREE.Scene();
const OU = { tex: { value: brainTarget.texture }, uMix: { value: 1 } };
overlayScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: OU, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: `precision highp float; varying vec2 vUv; uniform sampler2D tex; uniform float uMix; void main(){ vec4 c = texture2D(tex, vUv); gl_FragColor = vec4(c.rgb * uMix, c.a * uMix); }`,
})));

// the eye: what the fly sees, a 48x27 luminance picture of its own painting
const EYE_W = 48, EYE_H = 27;
const eyeCanvas = document.createElement('canvas'); eyeCanvas.width = EYE_W; eyeCanvas.height = EYE_H;
const eyeCtx = eyeCanvas.getContext('2d', { willReadFrequently: true });
const eyeImg = new Uint8Array(EYE_W * EYE_H);

// ------------------------------------------------------------------------------------------------
// state the fly drives
const St = { steer: 0, yaw: 0, valence: 0, arousal: 0, sleep: 0, startle: 0, turnHold: 0, dislikeHold: 0, likeHold: 0, view: 0 };
const VIEWS = ['both', 'picture', 'brain'];
let hud = true;
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  brainTarget.setSize(Math.round(w * renderer.getPixelRatio()), Math.round(h * renderer.getPixelRatio()));
  BU.uH.value = h * renderer.getPixelRatio();
  brainCam.aspect = w / h; brainCam.updateProjectionMatrix();
  PU.uAspect.value = w / h;
}
addEventListener('resize', resize); resize();

function dopamine(kind) {
  if (kind === 'love') { worker.postMessage({ type: 'dopamine', reward: 60, punish: 0, ms: 1500 }); note('love → reward dopamine (PAM)'); }
  else { worker.postMessage({ type: 'dopamine', reward: 0, punish: 60, ms: 1500 }); note('not this → punishment dopamine (PPL1)'); }
}
$('#ctl .love').addEventListener('click', () => dopamine('love'));
$('#ctl .no').addEventListener('click', () => dopamine('no'));
$('#hudb').addEventListener('click', () => toggleHud());
$('#viewb').addEventListener('click', () => { St.view = (St.view + 1) % VIEWS.length; say(`view: ${VIEWS[St.view]}`); });
$('#nextb').addEventListener('click', () => loadPreset(presetIdx + 1, 1.5, 'you chose'));
function toggleHud() { hud = !hud; document.body.classList.toggle('hud', hud); }
addEventListener('keydown', (e) => {
  if (e.key === 'l' || e.key === 'L') dopamine('love');
  else if (e.key === 'x' || e.key === 'X') dopamine('no');
  else if (e.key === 'h' || e.key === 'H') toggleHud();
  else if (e.key === 'v' || e.key === 'V') { St.view = (St.view + 1) % VIEWS.length; say(`view: ${VIEWS[St.view]}`); }
  else if (e.key === 'n' || e.key === 'N') loadPreset(presetIdx + 1, 1.5, 'you chose');
  else if (e.key === 'e' || e.key === 'E') { St.eyes = !(St.eyes ?? true); worker.postMessage({ type: 'set', key: 'eyes', value: St.eyes }); say(`eyes ${St.eyes ? 'open' : 'closed'}`); }
});
let hoverT = 0; addEventListener('mousemove', () => { document.body.classList.add('hover'); clearTimeout(hoverT); hoverT = setTimeout(() => document.body.classList.remove('hover'), 2500); });

// ------------------------------------------------------------------------------------------------
// the loop
$('#boot').remove();
let last = performance.now();
const hudEl = $('#hud');
let hudAt = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const f = F;
  if (f) {
    // ---- what the fly hears becomes MilkDrop's levels: bass = low JONs + wind, mid = JO-A low, treb = JO-A high/air
    const b = f.ear.bands;
    perception = [Math.max(b[0], b[1], b[2], b[3]), Math.max(b[4], b[5]), Math.max(b[6], b[7], b[8])];
    // ---- decisions
    const r = f.rates;
    const k = 1 - Math.exp(-dt / 0.25);
    St.steer += k * (f.steer - St.steer);
    St.valence += k * 0.5 * (f.valence - St.valence);
    const dn = r.DN || 0;
    St.arousal += k * (Math.min(1, dn / 25) - St.arousal);
    St.sleep += k * 0.2 * (Math.min(1, Math.max(0, ((r.dFB || 0) - 3) / 15)) - St.sleep);
    St.yaw += St.steer * dt * 1.2;
    // the giant fibre fires on every big hit; it flashes every time but only cuts when it has had 8 s to settle
    if (f.startle) { St.startle = 1; if (now - presetAt > 8000) loadPreset(Math.floor(Math.random() * NAMES.length), 0, 'startled (giant fibre)'); }
    St.startle *= Math.exp(-dt / 0.12);
    const since = (now - presetAt) / 1000;
    // a sustained turn is a decision to walk on
    if (Math.abs(St.steer) > 0.22) St.turnHold += dt; else St.turnHold = Math.max(0, St.turnHold - dt * 2);
    if (St.turnHold > 1.6 && since > 6) { loadPreset(presetIdx + (St.steer > 0 ? 1 : -1), 2.5, St.steer > 0 ? 'turned right' : 'turned left'); St.turnHold = 0; }
    // it leaves what it dislikes, it stays with what it likes
    if (St.valence < -0.35) St.dislikeHold += dt; else St.dislikeHold = Math.max(0, St.dislikeHold - dt);
    if (St.dislikeHold > 10 && since > 8) { loadPreset(presetIdx + 7, 1.5, 'disliked, moved on'); St.dislikeHold = 0; }
    // nothing happening for a long while: wander
    const dwell = 45 * (1 + Math.max(0, St.valence) * 2);
    if (since > dwell) loadPreset(presetIdx + 1 + Math.floor(Math.random() * 3), 4, 'wandered');
    // ---- neuron flashes
    const decay = Math.exp(-dt / 0.14);
    for (let i = 0; i < N; i++) activity[i] *= decay;
    const sp = f.spikes; for (let i = 0; i < sp.length; i++) activity[sp[i]] = 1;
    geo.attributes.act.needsUpdate = true;
    F = null;
  }
  // ---- MilkDrop
  analyser.getByteTimeDomainData(timeBytes);
  viz.render({ audioLevels: { timeByteArray: timeBytes, timeByteArrayL: timeBytes, timeByteArrayR: timeBytes } });
  bcTex.needsUpdate = true;
  // ---- the eye sees the painting (every 2nd frame is plenty: photoreceptors integrate ~10 ms)
  if ((frame.n = (frame.n || 0) + 1) & 1) {
    eyeCtx.drawImage(bc, 0, 0, EYE_W, EYE_H);
    const d = eyeCtx.getImageData(0, 0, EYE_W, EYE_H).data;
    for (let i = 0, j = 0; i < eyeImg.length; i++, j += 4) eyeImg[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
    worker.postMessage({ type: 'see', img: eyeImg.slice() });
  }
  // ---- composite
  PU.uSteer.value = St.steer; PU.uValence.value = St.valence; PU.uArousal.value = St.arousal; PU.uStartle.value = St.startle; PU.uSleep.value = St.sleep; PU.uTime.value = now / 1000;
  const jit = (f && f.rates.motor ? Math.min(1, f.rates.motor / 40) : 0) * 0.004;
  PU.uJitter.value.set((Math.random() - 0.5) * jit, (Math.random() - 0.5) * jit);
  const view = VIEWS[St.view];
  renderer.setRenderTarget(null);
  renderer.clear();
  if (view !== 'brain') renderer.render(postScene, postCam);
  if (view !== 'picture') {
    const dist = extent * (view === 'brain' ? 1.3 : 1.9) * (1 - 0.15 * St.arousal);
    brainCam.position.set(Math.sin(St.yaw + now * 0.00005) * dist, -dist * 0.25, Math.cos(St.yaw + now * 0.00005) * dist);
    brainCam.lookAt(0, 0, 0);
    brainCam.up.set(0, -1, 0);
    BU.uSize.value = view === 'brain' ? 1.3 : 1;
    BU.uGhost.value = view === 'brain' ? 0.06 : 0.025;
    renderer.setRenderTarget(brainTarget); renderer.clear(); renderer.render(brainScene, brainCam);
    renderer.setRenderTarget(null);
    OU.uMix.value = view === 'brain' ? 1 : 0.85 - 0.5 * St.sleep;
    renderer.render(overlayScene, postCam);
  }
  if (hud && now - hudAt > 120 && f) { hudAt = now; drawHud(f, since(now)); }
}
const since = (now) => (now - presetAt) / 1000;
function drawHud(f, sinceS) {
  const r = f.rates, g = (k, d = 1) => (r[k] ?? 0).toFixed(d);
  const bar = (v, cls = '') => `<div class="bar ${cls}"><i style="width:${cls ? Math.abs(v) * 50 : Math.min(100, v * 100)}%;${cls && v < 0 ? 'transform:translateX(-100%)' : ''}"></i></div>`;
  hudEl.innerHTML = `
    <h1>Entity Alive · Drosophila melanogaster, FlyWire v783</h1>
    <div class="row"><span>brain time</span><span>${(f.time / 1000).toFixed(1)} s · ${f.speed.toFixed(2)}x real · ${f.active.toLocaleString()} active</span></div>
    <div class="row"><span>spikes</span><span>${Math.round(f.spikesPerSec).toLocaleString()} /s · ear ${f.ear.behind > 0 ? Math.round(f.ear.behind / 2) : 0} ms behind</span></div>
    <div class="row"><span>preset</span><span>${NAMES[presetIdx].slice(0, 40)} · ${sinceS.toFixed(0)} s</span></div>
    <div class="row"><span>source</span><span>${sourceKind || 'none'} · rms ${(f.ear.rms || 0).toFixed(3)}</span></div>
    <div class="dim">ear (Johnston's organ) band drive: sub · B-lo · B-mid · B-hi · A-lo · A-mid · A-hi · air · onset</div>
    <div class="grp">${f.ear.bands.map((b, i) => `<span>${['sub', 'B-lo', 'B-mid', 'B-hi', 'A-lo', 'A-mid', 'A-hi', 'air', 'onset'][i]} ${bar(b)}</span>`).join('')}</div>
    <div class="row"><span>valence (PAM reward − PPL1 punish)</span><span>${f.valence.toFixed(2)}</span></div>${bar(f.valence, 'val')}
    <div class="row"><span>steer (DN right − left)</span><span>${f.steer.toFixed(2)}</span></div>${bar(f.steer, 'val')}
    <div class="row"><span>arousal (descending)</span><span>${St.arousal.toFixed(2)}</span></div>${bar(St.arousal)}
    <div class="dim">population rates, Hz</div>
    <div class="grp">
      <span>JO-A ${g('JO-A', 0)}</span><span>JO-B ${g('JO-B', 0)}</span><span>JO-C/E ${((r['JO-C'] + r['JO-E']) / 2).toFixed(0)}</span>
      <span>AMMC ${g('AMMC', 0)}</span><span>WED ${g('WED')}</span><span>pC1 ${g('pC1')}</span>
      <span>DN L ${g('DN-left')}</span><span>DN R ${g('DN-right')}</span><span>DNp ${g('DNp')}</span>
      <span>PAM ${g('PAM')}</span><span>PPL1 ${g('PPL1')}</span><span>MBON ${g('MBON')}</span>
      <span>KC ${g('KC', 2)}</span><span>EPG ${g('EPG')}</span><span>dFB ${g('dFB')}</span>
      <span>motor ${g('motor')}</span><span>clock ${g('clock')}</span><span>eyes ${g('sensory-photo_receptor')}</span>
    </div>
    <div class="row"><span>taste (synapse weight vs connectome)</span><span>avoid ${f.taste.meanAvoid.toFixed(3)} · approach ${f.taste.meanApproach.toFixed(3)} · DN ${f.taste.meanDN.toFixed(3)}</span></div>
    <div class="dim">${f.taste.edges.toLocaleString()} plastic synapses · L love · X not this · V view · N next · E eyes · H hud</div>
    <div class="log">${log.map((l) => `<div>${l}</div>`).join('')}</div>`;
}
requestAnimationFrame(frame);
