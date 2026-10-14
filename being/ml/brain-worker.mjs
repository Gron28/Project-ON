// brain-worker.mjs - module Web Worker (also works as a Node worker_thread) around BrainCore.
//
// in:  {type:'init', baseUrl, patches?:1|2|3}                       baseUrl = URL (string) of the models/ folder, trailing slash
//      {type:'audio', samples: Float32Array}        48 kHz mono, any chunk size (~0.1 s is ideal)
//      {type:'dispose'}
// out: {type:'ready', loadMs}
//      {type:'result', styles, genres, moods, dance, voice, tonal, approachable, engaging, bright,
//                      instruments, themes, embedding, confidence, entropy, unknown, rms, patches, ms}
//      {type:'silent', rms}                          window below the RMS gate, inference skipped
//      {type:'error', message}
//
// onnxruntime-web runs single-threaded WASM inside this worker, so the page stays free.

import * as ort from '../../node_modules/onnxruntime-web/dist/ort.wasm.min.mjs';
import { BrainCore } from './brain-core.mjs';

const isNodeWorker = typeof self === 'undefined' || typeof self.postMessage !== 'function';
let post, onMessage;
if (isNodeWorker) {
  const { parentPort } = await import('node:worker_threads');
  post = (m, t) => parentPort.postMessage(m, t);
  onMessage = (fn) => parentPort.on('message', fn);
} else {
  post = (m, t) => self.postMessage(m, t);
  onMessage = (fn) => { self.onmessage = (e) => fn(e.data); };
}

ort.env.wasm.numThreads = 1; // 1 is plenty (~100 ms/analysis) and needs no SharedArrayBuffer / COOP+COEP
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = new URL('../../node_modules/onnxruntime-web/dist/', import.meta.url).href;

function makeLoader(baseUrl) {
  const base = new URL(baseUrl);
  return async (name, kind) => {
    const url = new URL(name + (kind === 'json' ? '.json' : '.onnx'), base);
    if (isNodeWorker) {
      const fs = await import('node:fs/promises');
      const { fileURLToPath } = await import('node:url');
      const buf = await fs.readFile(fileURLToPath(url));
      return kind === 'json' ? JSON.parse(buf.toString('utf8')) : buf;
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    return kind === 'json' ? res.json() : res.arrayBuffer();
  };
}

let core = null;
let chain = Promise.resolve(); // BrainCore is not re-entrant: serialise messages

onMessage((msg) => {
  chain = chain.then(() => handle(msg)).catch((err) => post({ type: 'error', message: String(err && err.stack || err) }));
});

async function handle(msg) {
  if (msg.type === 'init') {
    const t0 = performance.now();
    core = new BrainCore({ ort, loadModel: makeLoader(msg.baseUrl), inputRate: msg.inputRate || 48000, patches: msg.patches });
    await core.init();
    post({ type: 'ready', loadMs: performance.now() - t0 });
  } else if (msg.type === 'audio') {
    if (!core || !core.ready) return;
    for (const r of await core.push(msg.samples)) {
      if (r.silent) post({ type: 'silent', rms: r.rms });
      else post({ ...r, audioEnd: msg.audioEnd }, [r.embedding.buffer]);
    }
  } else if (msg.type === 'dispose') {
    if (core) await core.dispose();
    core = null;
  }
}
