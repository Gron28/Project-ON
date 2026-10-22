// being/page/input.mjs - the captured sound: int16 stereo PCM to the engine's mono, the stereo picture, the system-audio tap
/* Stereo: the engine works in mono, so the left/right picture is measured here, per chunk, and kept with the sample
   index it belongs to, so it is shown with the same sync delay as everything else.
   pan: -1 left .. +1 right (lows below ~200 Hz, highs above ~2 kHz, and everything); width: 0 mono .. 1 very wide */
export function createInput({ an, voice, pushIn }) {
  const STN = 256, ST = { idx: new Float64Array(STN), lo: new Float32Array(STN), hi: new Float32Array(STN), all: new Float32Array(STN), wd: new Float32Array(STN), n: 0 };
  const aLo = Math.exp(-2 * Math.PI * 200 / 48000), aHi = Math.exp(-2 * Math.PI * 2000 / 48000);
  let lpL = 0, lpR = 0, l2L = 0, l2R = 0;
  function stereoChunk(L, R, n) {
    let eLL = 0, eLR = 0, eHL = 0, eHR = 0, eL = 0, eR = 0, eX = 0;
    let pL = lpL, pR = lpR, qL = l2L, qR = l2R;   // locals: a store to a module-level `let` double boxes a HeapNumber
    for (let i = 0; i < n; i++) {
      const l = L[i], r = R[i];
      pL = l + (pL - l) * aLo; pR = r + (pR - r) * aLo;   // low-pass: the lows
      qL = l + (qL - l) * aHi; qR = r + (qR - r) * aHi;   // what is left above it: the highs
      const hl = l - qL, hr = r - qR;
      eLL += pL * pL; eLR += pR * pR; eHL += hl * hl; eHR += hr * hr; eL += l * l; eR += r * r;
      eX += l * r;
    }
    lpL = pL; lpR = pR; l2L = qL; l2R = qR;
    const pan = (a, b) => a + b > 1e-7 * n ? (b - a) / (a + b) : 0;
    const k = ST.n % STN;
    ST.idx[k] = an.total; ST.lo[k] = pan(eLL, eLR); ST.hi[k] = pan(eHL, eHR); ST.all[k] = pan(eL, eR);
    // width: how different the two channels are (1 - correlation); a hard-panned mono sound is not wide
    ST.wd[k] = eL > 1e-7 * n && eR > 1e-7 * n ? Math.min(1, Math.max(0, 1 - eX / Math.sqrt(eL * eR))) : 0; ST.n++;
  }
  function stereoAt(index, out) {   // the newest reading at or before this sample index
    for (let j = 1; j <= Math.min(ST.n, STN); j++) {
      const k = (ST.n - j) % STN;
      if (ST.idx[k] <= index) { out.lo = ST.lo[k]; out.hi = ST.hi[k]; out.all = ST.all[k]; out.wd = ST.wd[k]; return out; }
    }
    out.lo = out.hi = out.all = out.wd = 0; return out;
  }
  let mono = new Float32Array(2048);
  let chL = new Float32Array(2048), chR = new Float32Array(2048);
  function takePcm(buf) {   // int16 stereo 48 kHz -> mono float for the engine, and left/right for the stereo picture
    const bytes = buf.byteOffset % 2 ? buf.slice() : buf, v = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1), n = v.length >> 1;
    if (mono.length < n) { mono = new Float32Array(n * 2); chL = new Float32Array(n * 2); chR = new Float32Array(n * 2); }
    for (let i = 0; i < n; i++) { const l = v[2 * i] / 32768, r = v[2 * i + 1] / 32768; chL[i] = l; chR[i] = r; mono[i] = (l + r) * .5; }
    if (voice.singing || voice.rms > .0015) {
      let e = 0; for (let i = 0; i < n; i++) e += mono[i] * mono[i];
      if (voice.isOwn(Math.sqrt(e / Math.max(1, n)))) mono.fill(0, 0, n);   // only its own voice coming back: not hearing
    }
    pushIn(mono.subarray(0, n));
    stereoChunk(chL, chR, n);
  }
  return { ST, stereoChunk, stereoAt, takePcm };
}
// all system audio (getDisplayMedia): an AudioWorklet that posts interleaved stereo blocks
export const WORKLET = `class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.b = new Float32Array(2048); this.n = 0; }
  process(inputs) {
    const c = inputs[0]; if (!c || !c.length) return true;
    const l = c[0], r = c[1] || l;
    for (let i = 0; i < l.length; i++) { this.b[this.n++] = l[i]; this.b[this.n++] = r[i]; if (this.n === 2048) { this.port.postMessage(this.b); this.b = new Float32Array(2048); this.n = 0; } }
    return true;
  }
}
registerProcessor('tap', Tap);`;
