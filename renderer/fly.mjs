// fly.mjs - the bridge between the entity's body and the fly brain in its worker.
//
//   const fly = await createFly({ audioContext, canvas });   // loads the connectome, starts the worker and the ear worklet
//   source.connect(fly.earNode);                              // whatever is playing goes into the fly's antennae
//   fly.frame(dt, now);                                       // once per frame: smooths the readouts, raises decisions
//   fly.see(canvas);                                          // after rendering: the fly looks at the entity (every 2nd frame is plenty)
//   fly.state                                                 // { valence, steer, arousal, sleep, startle, motor, speed, rates, taste, ... }
//   fly.on('turn' | 'startle' | 'leave' | 'wander' | 'liked' | 'disliked', fn)
//   fly.dopamine('love' | 'no')                               // inject reward / punishment dopamine (PAM / PPL1)
//
// The readouts are population rates of real neuron groups (see brain/worker.mjs). This file only smooths them
// and turns sustained states into discrete events; it holds no opinion about what the entity should look like.

const EYE_W = 48, EYE_H = 27;

export async function createFly({ audioContext, onProgress = () => {} } = {}) {
  onProgress('loading the connectome');
  const meta = await (await fetch('../data/brain.json')).json();
  const bin = await (await fetch('../data/brain.bin')).arrayBuffer();
  const worker = new Worker('../brain/worker.mjs', { type: 'module' });
  worker.onerror = (e) => console.error(`fly worker: ${e.message} @ ${e.filename}:${e.lineno}`);
  const earChannel = new MessageChannel();
  let brain = null, F = null;
  const ready = new Promise((res) => {
    worker.addEventListener('message', (e) => { if (e.data.type === 'ready') { brain = e.data; res(); } else if (e.data.type === 'frame') F = e.data; });
  });
  worker.postMessage({ type: 'init', bin, meta, earPort: earChannel.port2 }, [bin, earChannel.port2]);
  onProgress('waking 139,255 neurons');
  await ready;

  await audioContext.audioWorklet.addModule('../audio/ear-worklet.js');
  const earNode = new AudioWorkletNode(audioContext, 'ear', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: 'explicit' });
  earNode.port.postMessage({ port: earChannel.port1 }, [earChannel.port1]);

  const eyeCanvas = document.createElement('canvas'); eyeCanvas.width = EYE_W; eyeCanvas.height = EYE_H;
  const eyeCtx = eyeCanvas.getContext('2d', { willReadFrequently: true });
  const eyeImg = new Uint8Array(EYE_W * EYE_H);

  const listeners = {};
  const emit = (ev, data) => { for (const fn of listeners[ev] || []) fn(data); };
  const state = {
    valence: 0, steer: 0, arousal: 0, sleep: 0, startle: 0, motor: 0, speed: 1, time: 0, active: 0, spikesPerSec: 0,
    rates: {}, taste: { meanAvoid: 1, meanApproach: 1, meanDN: 1, edges: 0 }, ear: { bands: [], rms: 0, behind: 0 },
    turnHold: 0, dislikeHold: 0, lastDecision: 0, lastStartle: -1e9, spikes: new Uint32Array(0), yaw: 0,
  };
  // per-neuron glow for the brain view: decays each frame, set to 1 on a spike
  const N = brain.N, activity = new Float32Array(N);

  return {
    state, brain, meta, earNode, activity, worker,
    on(ev, fn) { (listeners[ev] || (listeners[ev] = [])).push(fn); },
    dopamine(kind) {
      if (kind === 'love') { worker.postMessage({ type: 'dopamine', reward: 60, punish: 0, ms: 1500 }); emit('liked'); }
      else { worker.postMessage({ type: 'dopamine', reward: 0, punish: 60, ms: 1500 }); emit('disliked'); }
    },
    set(key, value) { worker.postMessage({ type: 'set', key, value }); },
    /** the fly looks at the picture: pass the canvas right after it was rendered */
    see(canvas) {
      eyeCtx.drawImage(canvas, 0, 0, EYE_W, EYE_H);
      const d = eyeCtx.getImageData(0, 0, EYE_W, EYE_H).data;
      for (let i = 0, j = 0; i < eyeImg.length; i++, j += 4) eyeImg[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
      worker.postMessage({ type: 'see', img: eyeImg.slice() });
    },
    /** once per frame. dt seconds, now ms. Returns true when a new readout arrived. */
    frame(dt, now) {
      const decay = Math.exp(-dt / 0.14);
      for (let i = 0; i < N; i++) activity[i] *= decay;
      state.startle *= Math.exp(-dt / 0.12);
      const f = F; if (!f) return false; F = null;
      const r = f.rates, k = 1 - Math.exp(-dt / 0.25);
      state.rates = r; state.taste = f.taste; state.ear = f.ear; state.speed = f.speed; state.time = f.time; state.active = f.active; state.spikesPerSec = f.spikesPerSec;
      state.steer += k * (f.steer - state.steer);
      state.valence += k * 0.5 * (f.valence - state.valence);
      state.arousal += k * (Math.min(1, (r.DN || 0) / 25) - state.arousal);
      state.sleep += k * 0.2 * (Math.min(1, Math.max(0, ((r.dFB || 0) - 3) / 15)) - state.sleep);
      state.motor = Math.min(1, (r.motor || 0) / 40);
      state.yaw += state.steer * dt * 1.2;
      const sp = f.spikes; state.spikes = sp;
      for (let i = 0; i < sp.length; i++) activity[sp[i]] = 1;
      // ---- decisions: sustained states become events
      if (f.startle) { state.startle = 1; if (now - state.lastStartle > 8000) { state.lastStartle = now; emit('startle'); } }
      if (Math.abs(state.steer) > 0.22) state.turnHold += dt; else state.turnHold = Math.max(0, state.turnHold - dt * 2);
      if (state.turnHold > 1.6 && now - state.lastDecision > 6000) { state.lastDecision = now; state.turnHold = 0; emit('turn', state.steer > 0 ? 1 : -1); }
      if (state.valence < -0.35) state.dislikeHold += dt; else state.dislikeHold = Math.max(0, state.dislikeHold - dt);
      if (state.dislikeHold > 10 && now - state.lastDecision > 8000) { state.lastDecision = now; state.dislikeHold = 0; emit('leave'); }
      const dwell = 45000 * (1 + Math.max(0, state.valence) * 2);
      if (now - state.lastDecision > dwell) { state.lastDecision = now; emit('wander'); }
      return true;
    },
  };
}
