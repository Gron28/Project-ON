// being/worker.mjs - the being's ear and nervous tissue on their own thread (see ear.mjs and tissue.mjs).
//
// In:  { type:'pcm', mono:Float32Array }  (48 kHz, silence included: it hums and dreams in silence)
//      { type:'kick', amount }            (a startle burst through the tissue)
//      { type:'feedback', kind:'pattern'|'noise', band, amount }  (a predicted hit: a fixed stamp in band 0 low .. 2 high;
//                                          a surprise: as many cells at random; see tissue.mjs)
//      { type:'recycle', tex }            (optional: the page hands a tissue texture buffer back, so none is allocated per frame)
//      { type:'organism', on, genome, seed, label, drive }  (the lab organism, lab/organism/watch.mjs: grown on 'on', freed on 'off')
//      { type:'org-drive', on }           (drive switched without regrowing the organism)
//      { type:'org-pull', full } / { type:'org-phase', phase }  (the dashboard's snapshot request; the being's shown beat phase)
// Out: { type:'ear', amp, mu, onset, rough, sub, level, hum }  every 10 ms of audio
//      { type:'tissue', tex, act, sigma, branching }           every ~33 ms of audio
//      { type:'organism', status, cost, staticVersion, static?, live, timing }  answering each 'org-pull'
//      { type:'org-drive', t, reg, motor, pulse, brace, impact, chrom, body, feel }  while drive is on: after an audio block
//                                          that advanced the organism, at most 60/s on average (watch.mjs drive())

import { createEar, SR, NE, DELTA } from './ear.mjs';
import { createTissue } from './tissue.mjs';

const ear = createEar();
// in silence its set point wanders: slow up and down states (lab E09); its links learn from the feedback below (lab E11)
const tissue = createTissue({ earUnits: NE, wander: 0.7, plastic: 0.05 });
const drive = new Float64Array(NE);
let toEar = 0, toTissue = 0, toTex = 0;
const TEX_BYTES = 128 * 64 * 4, pool = [];   // tissue texture buffers handed back by the page
const EAR_EVERY = SR / 100, TISSUE_EVERY = SR * 4 / 1000, TEX_EVERY = SR / 30;

// sync: captured audio reaches the ear before it reaches the listener (output latency), so it is delayed by `delay` ms
const DL = new Float32Array(SR);   // up to 1 s
let dlW = 0, delaySamples = Math.round(SR * 0.04);
// the lab organism: hears this ear (a 4 ms tap per network step), drives nothing unless drive is on; loaded only when switched on
let watch = null, orgGen = 0, orgStatus = 'off', orgError = '', toOrg = 0;
// drive (experimental, settings.organism.drive): its state goes to the page, which lets it move the being
let orgDrive = false, orgTicks = 0, driveNext = 0;
async function setOrganism(d) {
  const gen = ++orgGen;
  orgDrive = !!(d.on && d.drive);
  watch = null; orgStatus = d.on ? 'developing' : 'off'; orgError = '';
  if (!d.on) return;
  try {
    const m = await import('../lab/organism/watch.mjs');
    if (gen !== orgGen) return;
    watch = m.createWatch({ genome: d.genome, seed: d.seed, label: d.label }); watch.transferables = m.transferables; orgStatus = 'live'; toOrg = 0;
  } catch (err) { if (gen === orgGen) { orgStatus = 'failed'; orgError = String(err && err.message || err); } }
}
self.onmessage = (e) => {
  const d = e.data;
  if (d.type === 'organism') { setOrganism(d); return; }
  if (d.type === 'org-drive') { orgDrive = !!d.on; return; }
  if (d.type === 'org-phase') { if (watch) watch.onPhase = +d.phase || 0; return; }
  if (d.type === 'org-pull') {
    if (!watch) { self.postMessage({ type: 'organism', status: orgStatus, error: orgError || undefined }); return; }
    const s = watch.snapshot(!!d.full); self.postMessage({ type: 'organism', ...s }, watch.transferables(s)); return;
  }
  if (d.type === 'kick') { tissue.kick(d.amount || 1); return; }
  if (d.type === 'feedback') { if (d.kind === 'pattern') tissue.pattern(d.band, d.amount); else if (d.kind === 'noise') tissue.noise(d.amount); return; }
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
    if (watch && ++toOrg === 192) { toOrg = 0; watch.tick(ear.tap()); orgTicks++; }
    if (++toEar >= EAR_EVERY) { toEar = 0; const f = ear.frame(); self.postMessage(f, [f.amp.buffer, f.mu.buffer]); }
    if (++toTissue >= TISSUE_EVERY) {
      toTissue = 0;
      // ear amplitude -> excitation probability per cell and step (relative to the unit's own hum, compressive)
      for (let k = 0; k < NE; k++) drive[k] = 0.012 * Math.max(0, Math.log1p(ear.env[k] / DELTA) - 0.8);
      tissue.step(drive);
    }
    if (++toTex >= TEX_EVERY) { toTex = 0; const r = tissue.render(); const tex = pool.pop() || new Uint8Array(TEX_BYTES); tex.set(r.tex); self.postMessage({ type: 'tissue', tex, act: r.act, sigma: r.sigma, branching: r.branching, readout: r.readout, coherence: r.coherence }, [tex.buffer]); }
  }
  // drive: posted as soon as the block is done, so it is no older than the audio it heard; at most 60 a second on average
  // (a post is allowed up to 8 ms early, so blocks that arrive in bursts every ~16 ms are not halved to 30 a second)
  if (watch && orgDrive && orgTicks >= 2) {
    const now = performance.now();
    if (now >= driveNext) { driveNext = Math.max(driveNext + 1000 / 60, now + 1000 / 60 - 8); orgTicks = 0; const o = watch.drive(); o.type = 'org-drive'; self.postMessage(o, [o.reg.buffer]); }
  }
};

