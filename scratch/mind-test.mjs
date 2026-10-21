// drive worker + mind with synthetic music; print the inner life every 2 s
const msgs = [];
globalThis.self = { postMessage: (m) => { if (m.type === 'ear') msgs.push(m); } };
await import('../being/worker.mjs');
const { createMind, traitsFor } = await import('../being/mind.mjs');
const CF = Float64Array.from({ length: 28 }, (_, k) => 55 * 2 ** (k / 4));
const mind = createMind(traitsFor(42), { earCF: CF });
const SR = 48000, FPS = 60;
let t = 0, lastEar = null, INT = 0.5;
const log = [];
function run(sec, gen, label, tension = 0) {
  const n = SR / FPS;
  for (let f = 0; f < sec * FPS; f++) {
    const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = gen(t + i / SR); t += n / SR;
    msgs.length = 0; self.onmessage({ data: { type: 'pcm', mono: x } });
    let peak = 0; for (const m of msgs) { if (m.onset > peak) peak = m.onset; lastEar = m; }
    const ev = mind.step(1 / FPS, lastEar, peak, { tension: typeof tension === 'function' ? tension(t) : tension, intensity: INT });
    for (const e of ev) log.push(`${t.toFixed(1)}s ${e.type}${e.amount ? ' ' + e.amount.toFixed(2) : ''}`);
    if (f % (2 * FPS) === 2 * FPS - 1) console.log(`${label.padEnd(16)} t=${t.toFixed(0).padStart(3)} | ${mind.feeling().padEnd(14)} A ${mind.arousal.toFixed(2)} V ${mind.valence.toFixed(2)} | lock ${mind.lock.toFixed(2)} pulse ${(mind.pulseHz * 60).toFixed(0)}bpm groove ${mind.groove.toFixed(2)} sync ${mind.sync.toFixed(2)} | IC ${mind.surprise.toFixed(2)} DA ph ${mind.daPhasic.toFixed(2)} ant ${mind.daAnticipation.toFixed(2)} | hab ${mind.habituation.toFixed(2)} bored ${mind.bored.toFixed(2)} energy ${mind.energy.toFixed(2)}`);
  }
}
const kick = (tt, bpm) => { const ph = tt % (60 / bpm); return 0.6 * Math.exp(-ph * 30) * Math.sin(2 * Math.PI * 55 * ph); };
const hat = (tt, bpm) => { const ph = (tt + 30 / bpm) % (60 / bpm); return 0.08 * Math.exp(-ph * 120) * (Math.random() * 2 - 1); };
const chord = (tt) => 0.05 * (Math.sin(2 * Math.PI * 220 * tt) + Math.sin(2 * Math.PI * 277 * tt) + Math.sin(2 * Math.PI * 330 * tt));
run(6, () => 0, 'silence');
run(4, (tt) => kick(tt, 120), 'first kicks');
run(16, (tt) => kick(tt, 120) + hat(tt, 120) + chord(tt), 'groove 120');
run(8, (tt) => hat(tt, 120) * 3 + chord(tt) * (1 + (tt % 8) / 4), 'build-up', (tt) => 0.5 + 0.06 * (tt % 8));
INT = 0.95; run(8, (tt) => kick(tt, 120) * 1.3 + hat(tt, 120) + chord(tt) * 1.5, 'drop');
INT = 0.6; run(30, (tt) => kick(tt, 120) + hat(tt, 120) + chord(tt), 'same loop 30s');
INT = 0; run(8, () => 0, 'silence again');
console.log('events:', log.join(' | '));
