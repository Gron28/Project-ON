// lab/prototypes/nervous-system/io-worklet.js - plays what the lab feeds the ear (a ring of up to 2 s, kept short so the sound
// stays close to what is shown) and, when asked, sends the microphone back in chunks of 1024 samples.
class NsIo extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new Float32Array(96000); this.r = 0; this.w = 0; this.capture = false; this.cap = new Float32Array(1024); this.cn = 0;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'capture') { this.capture = !!d.on; return; }
      if (d.type === 'flush') { this.r = this.w; return; }
      if (d.type !== 'play') return;
      const x = d.data, N = this.ring.length;
      for (let i = 0; i < x.length; i++) { this.ring[this.w] = x[i]; this.w = (this.w + 1) % N; }
      const fill = (this.w - this.r + N) % N;
      if (fill > 0.25 * sampleRate) this.r = (this.w - Math.round(0.08 * sampleRate) + N) % N;   // drifted behind: catch up
    };
  }
  process(inputs, outputs) {
    const out = outputs[0][0], N = this.ring.length;
    if (out) for (let i = 0; i < out.length; i++) { if (this.r !== this.w) { out[i] = this.ring[this.r]; this.r = (this.r + 1) % N; } else out[i] = 0; }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    const inp = inputs[0] && inputs[0][0];
    if (this.capture && inp) for (let i = 0; i < inp.length; i++) { this.cap[this.cn++] = inp[i]; if (this.cn === 1024) { this.port.postMessage(this.cap.slice()); this.cn = 0; } }
    return true;
  }
}
registerProcessor('ns-io', NsIo);
