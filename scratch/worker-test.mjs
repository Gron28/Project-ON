const msgs = { ear: [], tissue: [] };
globalThis.self = { postMessage: (m) => { (msgs[m.type] || (msgs[m.type] = [])).push(m); } };
await import('../being/worker.mjs');
const SR = 48000;
const feed = (sec, gen) => { const n = 4800; for (let t = 0; t < sec * SR; t += n) { const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = gen((t + i) / SR); self.onmessage({ data: { type: 'pcm', mono: x } }); } };
const report = (label) => {
  const e = msgs.ear.at(-1), ti = msgs.tissue.at(-1);
  const mu = Array.from(e.mu); const amp = Array.from(e.amp);
  console.log(`${label.padEnd(26)} | mu min ${Math.min(...mu).toFixed(3)} max ${Math.max(...mu).toFixed(3)} | hum ${e.hum.toFixed(2)} | amp@220 ${amp[12].toFixed(4)} amp@880 ${amp[20].toFixed(4)} max ${Math.max(...amp).toFixed(4)} | onset ${e.onset.toFixed(2)} rough ${e.rough.toFixed(3)} sub ${e.sub.toFixed(3)} | tissue act ${(ti.act * 1000).toFixed(2)}e-3 sigma ${ti.sigma.toFixed(2)} br ${ti.branching.toFixed(2)}`);
};
const t0 = performance.now();
feed(6, () => 0); report('silence 6 s');
feed(10, () => 0); report('silence 16 s');
feed(3, (t) => 0.002 * Math.sin(2 * Math.PI * 220 * t)); report('whisper 220 Hz');
feed(3, (t) => 0.02 * Math.sin(2 * Math.PI * 220 * t)); report('soft 220 Hz (x10)');
feed(3, (t) => 0.2 * Math.sin(2 * Math.PI * 220 * t)); report('loud 220 Hz (x100)');
feed(6, (t) => 0.2 * Math.sin(2 * Math.PI * 220 * t)); report('loud 220 Hz, 9 s later');
feed(3, (t) => 0); report('silence after loud 3 s');
feed(10, (t) => 0); report('silence after loud 13 s');
// kick-like pulses at 2 Hz plus a rough 60 Hz AM tone
feed(6, (t) => { const ph = t % 0.5; return 0.5 * Math.exp(-ph * 25) * Math.sin(2 * Math.PI * 60 * ph) + 0.05 * (1 + Math.sin(2 * Math.PI * 70 * t)) * Math.sin(2 * Math.PI * 880 * t); }); report('kicks 2 Hz + rough tone');
const onsets = msgs.ear.slice(-300).map((m) => m.onset); console.log('onset peaks per 3 s:', onsets.filter((o, i) => o > 0.3 && (i === 0 || onsets[i - 1] <= 0.3)).length);
console.log(`cost: ${((performance.now() - t0) / 1000).toFixed(1)} s wall for ${6+10+3+3+3+6+3+10+6} s of audio`);
