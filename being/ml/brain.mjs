// brain.mjs - renderer-side wrapper around ml/brain-worker.mjs.
//
//   import { createBrain } from './ml/brain.mjs';
//   const brain = createBrain(new URL('./models/', location.href).href);
//   brain.onResult((r) => { ... r.styles, r.moods, r.unknown ... });
//   brain.push(float32Mono48k);          // from the audio callback, any chunk size
//   await brain.ready;                   // optional: resolves when all models are loaded
//   brain.dispose();

const CHUNK = 4800; // 0.1 s at 48 kHz

export function createBrain(baseUrl, { onSilent, onError, patches } = {}) {
  const worker = new Worker(new URL('./brain-worker.mjs', import.meta.url), { type: 'module' });
  const listeners = new Set();
  let ready = false;
  let audioEnd = 0;
  let resolveReady, rejectReady;
  const readyP = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });
  readyP.catch(() => {}); // an unobserved rejection must not become an unhandled-rejection error

  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'result') listeners.forEach((fn) => fn(m));
    else if (m.type === 'ready') { ready = true; resolveReady(m); }
    else if (m.type === 'silent') onSilent && onSilent(m);
    else if (m.type === 'error') { rejectReady(new Error(m.message)); onError ? onError(m.message) : console.error('[brain]', m.message); }
  };
  worker.onerror = (e) => { rejectReady(e); onError ? onError(e.message) : console.error('[brain] worker error', e.message); };
  worker.postMessage({ type: 'init', baseUrl: new URL(baseUrl, location.href).href, patches });

  // re-chunk to ~0.1 s so the worker sees steady, small messages whatever the capture callback size is
  let acc = new Float32Array(CHUNK * 2), fill = 0;

  return {
    ready: readyP,
    push(samples) {
      if (!ready) return; // do not queue audio while the models are still loading
      if (fill + samples.length > acc.length) {
        const bigger = new Float32Array(Math.max(acc.length * 2, fill + samples.length));
        bigger.set(acc.subarray(0, fill));
        acc = bigger;
      }
      acc.set(samples, fill);
      fill += samples.length;
      while (fill >= CHUNK) {
        const out = acc.slice(0, CHUNK); // fresh buffer, transferred (no copy on the way)
        acc.copyWithin(0, CHUNK, fill);
        fill -= CHUNK;
        audioEnd += CHUNK / 48000;
        worker.postMessage({ type: 'audio', samples: out, audioEnd }, [out.buffer]);
      }
    },
    onResult(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    get audioEnd() { return audioEnd; },
    dispose() {
      listeners.clear();
      try { worker.postMessage({ type: 'dispose' }); } catch {}
      worker.terminate();
    },
  };
}
