// feed-worklet.js - turns PCM chunks from the main process (per-app Windows loopback: int16 stereo 48 kHz)
// into a live stereo AudioNode. Chunks arrive on the port as Int16Array views; a ring buffer of ~1 s
// absorbs jitter. Output starts once 40 ms is queued, and resets to the newest audio if it falls
// more than 400 ms behind, so the brain always hears now.
class Feed extends AudioWorkletProcessor {
  constructor() {
    super();
    this.cap = 1 << 16; // frames
    this.L = new Float32Array(this.cap); this.R = new Float32Array(this.cap);
    this.w = 0; this.r = 0; this.primed = false;
    this.port.onmessage = (e) => {
      const v = e.data; // Int16Array, interleaved stereo
      const n = v.length >> 1;
      for (let i = 0; i < n; i++) { const k = this.w & (this.cap - 1); this.L[k] = v[2 * i] / 32768; this.R[k] = v[2 * i + 1] / 32768; this.w++; }
      if (this.w - this.r > 19200) this.r = this.w - 4800; // more than 400 ms queued: skip to the last 100 ms
    };
  }
  process(inputs, outputs) {
    const out = outputs[0], o0 = out[0], o1 = out[1] || out[0], n = o0.length;
    const avail = this.w - this.r;
    if (!this.primed) { if (avail < 1920) { o0.fill(0); o1.fill(0); return true; } this.primed = true; }
    for (let i = 0; i < n; i++) {
      if (this.r < this.w) { const k = this.r & (this.cap - 1); o0[i] = this.L[k]; o1[i] = this.R[k]; this.r++; }
      else { o0[i] = 0; o1[i] = 0; this.primed = false; }
    }
    return true;
  }
}
registerProcessor('feed', Feed);
