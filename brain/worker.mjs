// worker.mjs - the brain's own thread.
//
// Loads the compiled connectome, runs the spiking simulation in step with the audio clock, listens
// to the ear (envelope rows straight from the audio worklet) and the eye (small luminance frames
// from the renderer), applies plasticity, and posts a readout ~60 times a second:
//   { type:'frame', time, speed, rates:{group:Hz}, valence, steer, startle, spikes:Uint32Array, ... }
//
// Messages in:
//   { type:'init', bin:ArrayBuffer, meta, earPort:MessagePort, opts }
//   { type:'see', img:Uint8Array }                          (from the renderer, ~60 Hz)
//   { type:'dopamine', reward:Hz, punish:Hz, ms }           (love / not this)
//   { type:'set', key, value }                              (earGain, speed, eyes on/off)
//   on earPort: { type:'env', t0, rows:Float32Array, rms }  (from the worklet)

import { parseBrain, FlyBrain } from './lif.mjs';
import { createEar, ENV_BANDS, ENV_COLS, ENV_RATE, EAR_GROUPS } from './ear.mjs';
import { createEye } from './eye.mjs';
import { createPlasticity } from './plasticity.mjs';

const READ_GROUPS = ['JO-A', 'JO-B', 'JO-C', 'JO-D', 'JO-E', 'JO-F', 'AMMC', 'WED', 'pC1', 'pC2l', 'aIPg', 'KC', 'MBON', 'MBON-approach', 'MBON-avoid', 'PAM', 'PPL1', 'APL',
  'DN', 'DN-left', 'DN-right', 'DNa', 'DNb', 'DNp', 'DNg', 'DNge', 'DNpe', 'DNp09', 'DNa02', 'DNp13', 'EPG', 'PEN', 'hDelta', 'dFB', 'clock', 'motor', 'endocrine', 'ascending', 'sensory-photo_receptor', 'sensory-eye_bristle', 'sensory-head_bristle'];

let brain, fly, ear, eye, plast, meta;
let earPort = null;
const S = {
  earGain: 3,          // FAFB Johnston's organ axons are only partly reconstructed: multiply their synapses
  speed: 1,            // brain seconds per audio second the brain is asked to keep
  eyes: true,
  dt: 1.0,           // ms; the integration is exact per step, dt only sets spike-time resolution
};
// envelope stream: a ring of rows indexed by audio time
const ENV_RING = ENV_RATE * 4; // 4 s
const envRing = new Float32Array(ENV_RING * ENV_COLS);
let envHead = -1;              // index (row number since start) of the newest row
let envT0 = -1;                // audio time of row 0
let audioRms = 0;
let lastEnvArrival = 0;
let brainRow = 0;              // the envelope row the brain is currently hearing
let dopamine = { reward: 0, punish: 0, until: 0 };
let giantFiber = null;
let frameImg = null;
let running = false;
let wallStart = 0, brainStart = 0;
let lastFrame = 0;
let lastRates = {};
let speedEst = 1;
let plastAcc = 0;
let lastSpikeTotal = 0;
let dnLeftSmooth = 0, dnRightSmooth = 0;
let pamAvg = 1.5, pplAvg = 10, pamVar = 1, pplVar = 25, baselined = false;

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') init(m);
  else if (m.type === 'see') frameImg = m.img;
  else if (m.type === 'dopamine') { dopamine = { reward: m.reward || 0, punish: m.punish || 0, until: fly ? fly.time + (m.ms || 1000) : 0 }; }
  else if (m.type === 'set') { S[m.key] = m.value; if (m.key === 'earGain') applyEarGain(); }
};

function init(m) {
  meta = m.meta;
  brain = parseBrain(m.bin, meta);
  fly = new FlyBrain(brain, { dt: S.dt });
  ear = createEar(brain.groups, brain.side);
  eye = createEye(brain.pos, brain.side, brain.groups['sensory-photo_receptor'] || new Uint32Array(0), { maxHz: 60 });
  plast = createPlasticity(brain, fly);
  giantFiber = (brain.groups.DNp || []).length ? Array.from(brain.groups.DNp).filter((i) => (meta.types[i] || '').startsWith('DNp01')) : [];
  // external drive = ear + eye, one concatenated list
  const ids = new Uint32Array(ear.n + eye.n); ids.set(ear.ids, 0); ids.set(eye.ids, ear.n);
  const rates = new Float32Array(ids.length);
  fly.setDrive(ids, rates);
  S._rates = rates;
  Object.assign(S, m.opts || {});
  applyEarGain();
  earPort = m.earPort;
  if (earPort) earPort.onmessage = (ev) => onEnv(ev.data);
  running = true;
  wallStart = performance.now(); brainStart = 0;
  self.postMessage({ type: 'ready', N: brain.N, E: brain.E, groups: Object.fromEntries(Object.entries(brain.groups).map(([k, v]) => [k, v.length])), ear: ear.n, eye: eye.n, plastic: plast.stats.edges, pos: brain.pos, cls: brain.cls, nt: brain.nt, side: brain.side });
  loop();
}

let earGainApplied = 1;
function applyEarGain() {
  if (!fly) return;
  const f = S.earGain / earGainApplied;
  if (f === 1) return;
  for (const g of EAR_GROUPS) for (const i of brain.groups[g] || []) for (let e = brain.rowPtr[i]; e < brain.rowPtr[i + 1]; e++) fly.wmv[e] *= f;
  earGainApplied = S.earGain;
}

function onEnv(m) {
  if (m.type !== 'env') return;
  const rows = m.rows, n = rows.length / ENV_COLS;
  if (envT0 < 0) { envT0 = m.t0; envHead = -1; brainRow = 0; }
  for (let r = 0; r < n; r++) {
    envHead++;
    envRing.set(rows.subarray(r * ENV_COLS, (r + 1) * ENV_COLS), (envHead % ENV_RING) * ENV_COLS);
  }
  audioRms = m.rms;
  lastEnvArrival = performance.now();
}

// The brain keeps pace with the audio: every loop it advances brain time until it has heard the
// newest envelope row (minus a small lead), or until its time budget for this slice is spent.
function loop() {
  if (!running) return;
  const t0 = performance.now();
  const budgetMs = 14; // leave room for message handling; the loop reschedules immediately
  const rowsPerStep = ENV_RATE * S.dt / 1000; // 1 row per 0.5 ms step
  let steps = 0;
  if (envHead >= 0) {
    const target = envHead - 4; // stay 2 ms behind the newest row
    // if the brain fell more than 150 ms behind (slow machine), skip ahead: it hears now, not the past
    if (target - brainRow > ENV_RATE * 0.15) brainRow = target - ENV_RATE * 0.05;
    while (brainRow < target && performance.now() - t0 < budgetMs) {
      hearRow(brainRow);
      stepBrain();
      brainRow += rowsPerStep;
      steps++;
    }
  } else if (performance.now() - lastEnvArrival > 500) {
    // no audio yet: the brain still lives, hearing silence
    const n = Math.round(16 / S.dt);
    for (let k = 0; k < n && performance.now() - t0 < budgetMs; k++) { hearSilence(); stepBrain(); steps++; }
  }
  const now = performance.now();
  if (now - lastFrame >= 16) { lastFrame = now; postFrame(now - t0, steps); }
  schedule();
}
const sched = new MessageChannel(); sched.port1.onmessage = () => loop();
function schedule() { sched.port2.postMessage(0); }

const silence = new Float32Array(ENV_COLS);
function hearSilence() { ear.push(silence, 0); S._rates.set(ear.rates, 0); }
function hearRow(row) {
  const r = (row | 0) % ENV_RING;
  ear.push(envRing, r * ENV_COLS);
  S._rates.set(ear.rates, 0);
}

function stepBrain() {
  // eyes: the newest frame, sampled whenever one arrived
  if (frameImg) { if (S.eyes) { eye.see(frameImg); S._rates.set(eye.rates, ear.n); } else S._rates.fill(0, ear.n); frameImg = null; }
  // injected dopamine: Poisson spikes straight into PAM / PPL1, like an optogenetic pulse
  if (fly.time < dopamine.until) {
    const p = fly.dt / 1000;
    if (dopamine.reward > 0) for (const i of brain.groups.PAM) if (fly.rng() < dopamine.reward * p && fly.refUntil[i] <= fly.step) fly.spike(i);
    if (dopamine.punish > 0) for (const i of brain.groups.PPL1) if (fly.rng() < dopamine.punish * p && fly.refUntil[i] <= fly.step) fly.spike(i);
  }
  fly.tick();
  plastAcc += fly.dt;
  if (plastAcc >= 10) {
    const inj = fly.time < dopamine.until;
    const pam = fly.groupRate(brain.groups.PAM), ppl = fly.groupRate(brain.groups.PPL1);
    plast.update(plastAcc, Math.max(0, pam - pamAvg) + (inj ? dopamine.reward : 0), Math.max(0, ppl - pplAvg) + (inj ? dopamine.punish : 0));
    plastAcc = 0;
  }
}

function postFrame(busyMs, steps) {
  const rates = {};
  for (const g of READ_GROUPS) if (brain.groups[g]) rates[g] = fly.groupRate(brain.groups[g]);
  // the fly's own evaluation: reward dopamine against punishment dopamine, each against its usual level
  const pam = rates.PAM || 0, ppl = rates.PPL1 || 0;
  // ...each against what has been usual for this brain lately (30 s), so valence means "better or worse than lately"
  const kv = 1 - Math.exp(-16 / 30000);
  if (!baselined && fly.time > 2000) { pamAvg = pam; pplAvg = ppl; baselined = true; }
  pamAvg += kv * (pam - pamAvg); pplAvg += kv * (ppl - pplAvg);
  pamVar += kv * ((pam - pamAvg) ** 2 - pamVar); pplVar += kv * ((ppl - pplAvg) ** 2 - pplVar);
  const valence = Math.tanh((pam - pamAvg) / (Math.sqrt(pamVar) + 0.5)) - Math.tanh((ppl - pplAvg) / (Math.sqrt(pplVar) + 2));
  // steering: left / right descending neurons (smoothed 200 ms)
  const k = 1 - Math.exp(-16 / 200);
  dnLeftSmooth += k * ((rates['DN-left'] || 0) - dnLeftSmooth);
  dnRightSmooth += k * ((rates['DN-right'] || 0) - dnRightSmooth);
  const steer = (dnRightSmooth - dnLeftSmooth) / (Math.max(dnRightSmooth, dnLeftSmooth) + 0.5);
  // startle: the giant fibre (DNp01) fired since the last frame
  let startle = 0;
  if (giantFiber) for (const i of giantFiber) if (fly.spikeCount[i] !== (S._gf ? S._gf[i] : 0)) startle = 1;
  if (giantFiber) { if (!S._gf) S._gf = new Uint32Array(brain.N); for (const i of giantFiber) S._gf[i] = fly.spikeCount[i]; }
  const spikes = fly.takeSpikes();
  const total = fly.totalSpikes;
  const spikesPerSec = (total - lastSpikeTotal) * (1000 / 16); lastSpikeTotal = total;
  // speed: brain ms advanced per wall ms over the last second
  const wall = performance.now();
  if (!S._sp) S._sp = { t: wall, b: fly.time };
  if (wall - S._sp.t > 1000) { speedEst = (fly.time - S._sp.b) / (wall - S._sp.t); S._sp = { t: wall, b: fly.time }; }
  self.postMessage({
    type: 'frame', time: fly.time, speed: speedEst, busyMs, steps, active: fly.nActive, spikesPerSec, rates, valence, steer, startle,
    ear: { bands: Array.from(ear.bandRate.subarray(0, ENV_BANDS)).map((v, i) => Math.max(v, ear.bandRate[ENV_BANDS + i])), left: Array.from(ear.bandRate.subarray(0, ENV_BANDS)), right: Array.from(ear.bandRate.subarray(ENV_BANDS)), rms: audioRms, behind: envHead - brainRow },
    taste: { ...plast.stats }, spikes,
  }, [spikes.buffer]);
}
