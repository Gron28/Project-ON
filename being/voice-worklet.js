// being/voice-worklet.js - the being's voice (AudioWorklet). Its body and ear made audible, never a recording:
//   hum      its 28 ear oscillators (Hopf: z' = (mu + i w) z - |z|^2 z) at their own frequencies, swelling where its
//            memory has energy: an ear that emits sound, like spontaneous otoacoustic emissions (Kemp 1979)
//   breath   a 28-band noise vocoder shaped by the remembered band levels (Dudley 1939): timbre and rhythm survive
//   shell    four modes of a struck metal shell (bell partial ratios 1 : 2.83 : 5.42 : 8.77), rung by remembered onsets
//   sub      a low sine for remembered sub-bass
// Messages: { t: 'state', gain, hum, breath, bands[28] (0..1 log levels), onset, rough, sub, shellHz } and { t: 'stop' }.
// It posts { t: 'level', rms } ~10 times a second so the page can tell its own voice from other sound.
const NB = 28, SR = sampleRate, TAU = Math.PI * 2;
const CF = Array.from({ length: NB }, (_, k) => 55 * 2 ** (k / 4));
const MODES = [1, 2.83, 5.42, 8.77], MODE_AMP = [1, 0.55, 0.32, 0.18], MODE_DECAY = [1.6, 1.0, 0.6, 0.35];

class BeingVoice extends AudioWorkletProcessor {
  constructor() {
    super();
    this.zr = new Float64Array(NB).fill(1e-3); this.zi = new Float64Array(NB);
    this.bp = CF.map((f) => this.biquad(f, 4.3));       // quarter-octave band-pass per ear band
    this.bs = CF.map(() => new Float64Array(4));
    this.env = new Float64Array(NB); this.target = new Float64Array(NB);
    this.gain = 0; this.gainTo = 0; this.hum = 0; this.humTo = 0; this.breath = 0; this.breathTo = 0;
    this.rough = 0; this.sub = 0; this.subTo = 0; this.subPh = 0; this.roughPh = 0;
    this.modeAmp = new Float64Array(4); this.modePh = new Float64Array(4); this.shellHz = 140;
    this.lastOnset = 0; this.seed = 22222; this.acc = 0; this.accN = 0; this.alive = true;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.t === 'stop') { this.gainTo = 0; this.stopping = true; return; }
      if (m.t !== 'state') return;
      this.stopping = false;
      if (Number.isFinite(m.gain)) this.gainTo = Math.max(0, Math.min(0.5, m.gain));
      if (Number.isFinite(m.hum)) this.humTo = m.hum; if (Number.isFinite(m.breath)) this.breathTo = m.breath;
      if (m.bands && m.bands.length === NB) {
        // log levels (0..1, log1p(amp/.015)/4) -> linear band gains relative to the loudest, gently expanded
        let mx = 1e-6; const a = new Float64Array(NB);
        for (let k = 0; k < NB; k++) { a[k] = 0.015 * (Math.exp(4 * m.bands[k]) - 1); if (a[k] > mx) mx = a[k]; }
        for (let k = 0; k < NB; k++) this.target[k] = (a[k] / mx) ** 1.6;
      }
      if (Number.isFinite(m.rough)) this.rough = m.rough;
      if (Number.isFinite(m.sub)) this.subTo = m.sub;
      if (Number.isFinite(m.shellHz)) this.shellHz = m.shellHz;
      if (Number.isFinite(m.onset) && m.onset > 0.25 && m.onset > this.lastOnset + 0.1) for (let i = 0; i < 4; i++) this.modeAmp[i] = Math.max(this.modeAmp[i], MODE_AMP[i] * Math.min(1, m.onset));   // a remembered hit rings the shell
      this.lastOnset = Number.isFinite(m.onset) ? m.onset : 0;
    };
  }
  biquad(f, q) { const w = TAU * f / SR, al = Math.sin(w) / (2 * q), a0 = 1 + al; return [al / a0, 0, -al / a0, -2 * Math.cos(w) / a0, (1 - al) / a0]; }
  noise() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 2147483648 - 1; }
  process(inputs, outputs) {
    const out = outputs[0], L = out[0], R = out[1] || out[0], n = L.length, dt = 1 / SR;
    const kg = 1 - Math.exp(-n / (SR * (this.gainTo > this.gain ? 1.8 : 1.2))), ks = 1 - Math.exp(-n / (SR * 0.25)), ke = 1 - Math.exp(-n / (SR * 0.08));
    this.gain += (this.gainTo - this.gain) * kg; this.hum += (this.humTo - this.hum) * ks; this.breath += (this.breathTo - this.breath) * ks; this.sub += (this.subTo - this.sub) * ks;
    for (let k = 0; k < NB; k++) this.env[k] += (this.target[k] - this.env[k]) * ke;
    const mdec = MODE_DECAY.map((d) => Math.exp(-n / (SR * d)));
    for (let i = 0; i < n; i++) {
      let hum = 0, br = 0;
      const nz = this.noise();
      for (let k = 0; k < NB; k++) {
        const e = this.env[k];
        if (this.hum > 0.002 && e > 0.02 && CF[k] < 2600) {   // Hopf emitter: settles on a limit cycle of radius sqrt(mu)
          const mu = 0.6 * e * e, w = TAU * CF[k] * dt, zr = this.zr[k], zi = this.zi[k], r2 = zr * zr + zi * zi;
          const c = Math.cos(w), s = Math.sin(w), g = 1 + (mu - r2) * 40 * dt;
          this.zr[k] = (zr * c - zi * s) * g; this.zi[k] = (zr * s + zi * c) * g;
          hum += this.zr[k] / (1 + k * 0.08);
        }
        if (this.breath > 0.002 && e > 0.01) {   // band-passed noise, shaped by the remembered level
          const b = this.bp[k], st = this.bs[k];
          const y = b[0] * nz + b[1] * st[0] + b[2] * st[1] - b[3] * st[2] - b[4] * st[3];
          st[1] = st[0]; st[0] = nz; st[3] = st[2]; st[2] = y;
          br += y * e;
        }
      }
      this.roughPh += TAU * 70 * dt; br *= 1 - 0.45 * this.rough * (0.5 + 0.5 * Math.sin(this.roughPh));
      let shell = 0;
      for (let m = 0; m < 4; m++) { if (this.modeAmp[m] < 1e-4) continue; this.modePh[m] += TAU * this.shellHz * MODES[m] * dt; shell += Math.sin(this.modePh[m]) * this.modeAmp[m]; }
      this.subPh += TAU * 46 * dt;
      let x = hum * 0.08 * this.hum + br * 0.9 * this.breath + shell * 0.12 + Math.sin(this.subPh) * 0.25 * this.sub;
      x = Math.tanh(x * 1.5) * this.gain;   // soft limit, then the (quiet) master
      L[i] = x; if (R !== L) R[i] = x;
      this.acc += x * x; this.accN++;
    }
    for (let m = 0; m < 4; m++) this.modeAmp[m] *= mdec[m];
    if (this.accN >= SR / 10) { this.port.postMessage({ t: 'level', rms: Math.sqrt(this.acc / this.accN), shell: this.modeAmp[0] }); this.acc = 0; this.accN = 0; }
    return true;
  }
}
registerProcessor('being-voice', BeingVoice);
