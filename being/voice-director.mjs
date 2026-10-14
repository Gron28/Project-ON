// being/voice-director.mjs - when and what the being sings (the sound itself is voice-worklet.js; the memory voice.mjs).
// It sings when asked (the sing button; toggle() starts and stops it) and the longer it sings, the further it goes
// (like a songbird from subsong to crystallised song): a hum (its ear's own resonance, coloured by a sound it loved),
// then babble (a walk over its song map, stepping on the remembered tempo), then a replay of a loved moment. Each time
// it starts from a different loved place. Polite: a whisper, slow fades, about 30 s at most, and the audio engine is
// suspended when it is quiet.
import { decodeUnit, babbleStep, sketchFrames, unpackFrame, FRAME, FPS } from './voice.mjs';
import { NU } from './memory.mjs';

const GAIN = { off: 0, whisper: 0.05, sing: 0.11 }, MAX_SONG = 30;
/** a starting place: drawn from what it loved (squared, so it prefers its favourites), different every time */
function pickStart(love) {
  let sum = 0; const w = new Float64Array(NU);
  for (let u = 0; u < NU; u++) { w[u] = 0.002 + (love ? love[u] * love[u] : 0); sum += w[u]; }
  let t = Math.random() * sum; for (let u = 0; u < NU; u++) { t -= w[u]; if (t <= 0) return u; }
  return Math.floor(Math.random() * NU);
}

export function createVoice({ workletUrl }) {
  let ctx = null, node = null, starting = null, rms = 0, shell = 0, hoverT = 0, singing = false, active = false, sketchI = 0, quietT = 0, unit = -1, stepAt = 0, replay = null, stage = null, mode = 'whisper';
  const dec = { bands: new Float32Array(28), level: 0, onset: 0, rough: 0, sub: 0 }, fr = { bands: new Float32Array(28), level: 0, onset: 0, rough: 0, sub: 0 };
  async function start() {
    if (node) { if (ctx.state === 'suspended') await ctx.resume(); return; }
    if (starting) return starting;
    starting = (async () => {
      ctx = new AudioContext({ latencyHint: 'playback' });
      await ctx.audioWorklet.addModule(workletUrl);
      node = new AudioWorkletNode(ctx, 'being-voice', { numberOfOutputs: 1, outputChannelCount: [2] });
      node.port.onmessage = (e) => { if (e.data.t === 'level') { rms = e.data.rms; shell = e.data.shell; } };
      node.connect(ctx.destination);
    })();
    try { await starting; } finally { starting = null; }
  }
  const send = (m) => { if (node) node.port.postMessage(m); };
  function state(d, hum, breath, onset) {
    send({ t: 'state', gain: GAIN[mode] ?? GAIN.whisper, hum, breath, bands: Array.from(d.bands), onset, rough: d.rough, sub: d.sub, shellHz: 120 });
  }
  return {
    get singing() { return singing; }, get stage() { return stage; }, get rms() { return rms; }, get shell() { return shell; },
    get mode() { return mode; }, set mode(m) { if (m in GAIN) mode = m; },
    get active() { return active; },
    /** the sing button: start singing, or stop */
    toggle() { active = !active && mode !== 'off'; return active; },
    /** is a captured chunk of this loudness just its own voice coming back (system-audio capture)? */
    isOwn(chunkRms) { return (singing || rms > 0.0015) && chunkRms < rms * 2 + 0.006; },   // includes the fading tail and capture delay
    /** something else is sounding: stop at once */
    interrupt() { active = false; if (singing) { send({ t: 'stop' }); singing = false; stage = null; hoverT = 0; } },
    /**
     * @param s { weights, hits, love, sketches, bpm }
     */
    frame(dt, s) {
      if (active && hoverT > MAX_SONG) active = false;   // a song, not a drone
      const can = active && mode !== 'off' && s.weights;
      hoverT = can ? hoverT + dt : 0;
      if (!can) {
        if (singing) { send({ t: 'stop' }); singing = false; stage = null; replay = null; quietT = 0; }
        if (!singing && node && ctx.state === 'running') { quietT += dt; if (quietT > 3.5) ctx.suspend(); }   // the fade has finished: no audio work at all
        return;
      }
      if (!singing) { singing = true; quietT = 0; unit = pickStart(s.love); stepAt = 0; sketchI++; start().catch((e) => { console.warn('voice:', e.message); singing = false; }); }
      const beat = 60 / Math.max(50, Math.min(160, s.bpm || 84));
      if (hoverT < 3) {   // hum: its ear resonating with its most-loved sound
        stage = 'hum'; decodeUnit(s.weights, unit, dec); state(dec, 1, 0.12, 0);
      } else if (hoverT < 10 || !s.sketches || !s.sketches.length) {   // babble: wandering its memory on the beat
        stage = 'babble'; stepAt -= dt;
        if (stepAt <= 0) { stepAt += beat * (Math.random() < 0.25 ? 0.5 : 1); unit = babbleStep(unit, s.love, s.hits); decodeUnit(s.weights, unit, dec); state(dec, 0.35, 0.8, Math.max(0.3, dec.onset * 1.2)); }
      } else {   // replay: a moment it loved, as its senses kept it
        stage = 'replay';
        if (!replay) { const f = sketchFrames(s.sketches[sketchI % s.sketches.length]); replay = f ? { f, t: 0, n: f.length / FRAME } : null; }   // a different kept moment each time
        if (replay) {
          replay.t += dt; const i = Math.floor(replay.t * FPS) % (replay.n + FPS * 1.5);
          if (i < replay.n) { unpackFrame(replay.f, i * FRAME, fr); state(fr, 0.2, 1, fr.onset); }
          else state({ bands: new Float32Array(28), rough: 0, sub: 0 }, 0.1, 0, 0);   // a breath between replays
        }
      }
    },
  };
}
