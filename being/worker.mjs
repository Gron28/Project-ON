// being/worker.mjs - the being's ear and nervous tissue on their own thread (see ear.mjs and tissue.mjs).
//
// In:  { type:'pcm', mono:Float32Array }  (48 kHz, silence included: it hums and dreams in silence)
//      { type:'kick', amount }            (a startle burst through the tissue)
//      { type:'recycle', tex }            (optional: the page hands a tissue texture buffer back, so none is allocated per frame)
// Out: { type:'ear', amp, mu, onset, rough, sub, level, hum }  every 10 ms of audio
//      { type:'tissue', tex, act, sigma, branching }           every ~33 ms of audio

import { createEar, SR, NE, DELTA } from './ear.mjs';
import { createTissue } from './tissue.mjs';

const ear = createEar();
const tissue = createTissue({ earUnits: NE });
const drive = new Float64Array(NE);
let toEar = 0, toTissue = 0, toTex = 0;
const TEX_BYTES = 128 * 64 * 4, pool = [];   // tissue texture buffers handed back by the page
const EAR_EVERY = SR / 100, TISSUE_EVERY = SR * 4 / 1000, TEX_EVERY = SR / 30;

// sync: captured audio reaches the ear before it reaches the listener (output latency), so it is delayed by `delay` ms
const DL = new Float32Array(SR);   // up to 1 s
let dlW = 0, delaySamples = Math.round(SR * 0.04);
self.onmessage = (e) => {
  const d = e.data;
  if (d.type === 'kick') { tissue.kick(d.amount || 1); return; }
  if (d.type === 'recycle') { if (d.tex && d.tex.length === TEX_BYTES && pool.length < 4) pool.push(d.tex); return; }
  if (d.type === 'delay') { delaySamples = Math.max(0, Math.min(SR - 1, Math.round(SR * (d.ms || 0) / 1000))); return; }
  if (d.type !== 'pcm') return;
  const x = d.mono;
  for (let n = 0; n < x.length; n++) {
    DL[dlW] = x[n];
    let rd = dlW - delaySamples; if (rd < 0) rd += SR;
    const xs = DL[rd];
    if (++dlW === SR) dlW = 0;
    ear.sample(xs);
    if (++toEar >= EAR_EVERY) { toEar = 0; const f = ear.frame(); self.postMessage(f, [f.amp.buffer, f.mu.buffer]); }
    if (++toTissue >= TISSUE_EVERY) {
      toTissue = 0;
      // ear amplitude -> excitation probability per cell and step (relative to the unit's own hum, compressive)
      for (let k = 0; k < NE; k++) drive[k] = 0.012 * Math.max(0, Math.log1p(ear.env[k] / DELTA) - 0.8);
      tissue.step(drive);
    }
    if (++toTex >= TEX_EVERY) { toTex = 0; const r = tissue.render(); const tex = pool.pop() || new Uint8Array(TEX_BYTES); tex.set(r.tex); self.postMessage({ type: 'tissue', tex, act: r.act, sigma: r.sigma, branching: r.branching }, [tex.buffer]); }
  }
};
