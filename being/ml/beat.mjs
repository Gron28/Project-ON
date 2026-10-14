// beat.mjs - renderer-side wrapper around ml/beat-worker.mjs (the rhythm organ's ear: Beat This! small).
//   const beat = createBeat(new URL('./models/', location.href).href); beat.onResult((r) => ...); beat.push(f32mono48k);
// Results carry times on the same clock as `beat.audioEnd` (seconds of audio pushed), so the page can extrapolate.

const CHUNK = 4800;
export function createBeat(baseUrl, { onError } = {}) {
  const worker = new Worker(new URL('./beat-worker.mjs', import.meta.url), { type: 'module' });
  const listeners = new Set();
  let ready = false, audioEnd = 0, acc = new Float32Array(CHUNK * 2), fill = 0;
  worker.onmessage = (e) => { const m = e.data; if (m.type === 'beat') listeners.forEach((fn) => fn(m)); else if (m.type === 'ready') ready = true; else if (m.type === 'error') (onError || console.error)(m.message); };
  worker.onerror = (e) => (onError || console.error)(e.message);
  worker.postMessage({ type: 'init', baseUrl: new URL(baseUrl, location.href).href });
  return {
    push(samples) {
      audioEnd += samples.length / 48000;   // the clock runs while loading, so times stay aligned once it is ready
      if (!ready) return;
      if (fill + samples.length > acc.length) { const b = new Float32Array(Math.max(acc.length * 2, fill + samples.length)); b.set(acc.subarray(0, fill)); acc = b; }
      acc.set(samples, fill); fill += samples.length;
      while (fill >= CHUNK) { const out = acc.slice(0, CHUNK); acc.copyWithin(0, CHUNK, fill); fill -= CHUNK; worker.postMessage({ type: 'audio', samples: out, audioEnd: audioEnd - fill / 48000 }, [out.buffer]); }
    },
    onResult(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    get audioEnd() { return audioEnd - fill / 48000; },
    get ready() { return ready; },
    dispose() { listeners.clear(); try { worker.postMessage({ type: 'dispose' }); } catch {} worker.terminate(); },
  };
}
