// bench.mjs - how fast does the whole brain run on this machine?  node tools/bench.mjs [seconds] [jonHz]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBrain, FlyBrain } from '../brain/lif.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brain.json'), 'utf8'));
const buf = fs.readFileSync(path.join(ROOT, 'data', 'brain.bin'));
const brain = parseBrain(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), meta);
const seconds = +(process.argv[2] || 2), hz = +(process.argv[3] || 100);
const fly = new FlyBrain(brain, { dt: 0.5 });

// drive the ear: JO-A and JO-B at `hz` Poisson, as a loud sustained tone would
const ids = Uint32Array.from([...brain.groups['JO-A'], ...brain.groups['JO-B']]);
fly.setDrive(ids, new Float32Array(ids.length).fill(hz));
const G = brain.groups;
const t0 = performance.now();
let lastReport = t0;
for (let ms = 0; ms < seconds * 1000; ms += 100) {
  fly.run(100);
  if (performance.now() - lastReport > 1000 || ms + 100 >= seconds * 1000) {
    lastReport = performance.now();
    const wall = (lastReport - t0) / 1000;
    console.log(`brain ${(fly.time / 1000).toFixed(1)} s | wall ${wall.toFixed(1)} s | speed ${(fly.time / 1000 / wall).toFixed(2)}x | active ${fly.nActive} | spikes ${fly.totalSpikes}` +
      ` | AMMC ${fly.groupRate(G.AMMC).toFixed(0)} WED ${fly.groupRate(G.WED).toFixed(0)} pC1 ${fly.groupRate(G.pC1).toFixed(0)} pC2l ${fly.groupRate(G.pC2l).toFixed(0)} KC ${fly.groupRate(G.KC).toFixed(1)} MBON ${fly.groupRate(G.MBON).toFixed(0)} DN ${fly.groupRate(G.DN).toFixed(1)} PAM ${fly.groupRate(G.PAM).toFixed(1)} Hz`);
  }
}
