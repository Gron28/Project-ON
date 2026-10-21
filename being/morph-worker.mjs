// being/morph-worker.mjs - computes strange-attractor filament maps off the main thread (they take tens of ms)
import { attractorDensity } from './morph.mjs';
self.onmessage = (e) => {
  const { spec, size, points, key } = e.data;
  const a = attractorDensity(spec, size, points);
  self.postMessage({ key, density: a.density, tex: a.tex }, [a.density.buffer, a.tex.buffer]);
};
