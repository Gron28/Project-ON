// a 4-section synthetic song (pads, drums, bass, voice-like), 12 s each, looped twice: 96 s, 48 kHz mono 16-bit
import fs from 'node:fs';
const SR = 48000, SEC = 12, N = SR * SEC * 4 * 2, out = new Int16Array(N);
let s1 = 1; const rnd = () => { s1 = (Math.imul(s1, 1664525) + 1013904223) | 0; return (s1 >>> 0) / 4294967296 * 2 - 1; };
const sec = [
  (t) => 0.22 * Math.sin(2 * Math.PI * 220 * t) + 0.18 * Math.sin(2 * Math.PI * 277.2 * t) + 0.18 * Math.sin(2 * Math.PI * 329.6 * t) + 0.1 * Math.sin(2 * Math.PI * 440 * t) * Math.sin(2 * Math.PI * 0.3 * t),
  (t) => { const k = t % 0.5, s = (t + 0.25) % 0.5, h = t % 0.125; return 0.9 * Math.exp(-k * 25) * Math.sin(2 * Math.PI * 55 * k) + 0.3 * Math.exp(-s * 40) * rnd() + 0.12 * Math.exp(-h * 120) * rnd(); },
  (t) => { const f = 55 * ((t % 2) > 1 ? 1.5 : 1), saw = 2 * ((f * t) % 1) - 1; return 0.35 * saw * Math.exp(-(t % 0.25) * 6) + 0.35 * Math.exp(-(t % 0.5) * 25) * Math.sin(2 * Math.PI * 50 * (t % 0.5)); },
  (t) => 0.3 * Math.sin(2 * Math.PI * 180 * t + 3 * Math.sin(2 * Math.PI * 5 * t)) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 700 * t)) + 0.2 * Math.sin(2 * Math.PI * 1200 * t) * Math.exp(-(t % 1) * 2) + ((t % 1) < 0.05 ? 0.15 * rnd() : 0),
];
for (let i = 0; i < N; i++) { const t = i / SR, s = Math.floor(t / SEC) % 4; out[i] = Math.max(-1, Math.min(1, sec[s](t))) * 30000; }
const hdr = Buffer.alloc(44); hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + N * 2, 4); hdr.write('WAVE', 8); hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22); hdr.writeUInt32LE(SR, 24); hdr.writeUInt32LE(SR * 2, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34); hdr.write('data', 36); hdr.writeUInt32LE(N * 2, 40);
fs.writeFileSync(process.argv[2], Buffer.concat([hdr, Buffer.from(out.buffer)]));
