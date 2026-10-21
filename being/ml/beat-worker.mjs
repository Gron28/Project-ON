// beat-worker.mjs - module Web Worker (also a Node worker_thread) around BeatCore (the rhythm organ's ear).
//
// in:  {type:'init', baseUrl}                  baseUrl = URL (string) of the models/ folder, trailing slash
//      {type:'audio', samples: Float32Array}   48 kHz mono, any chunk size (~0.1 s is ideal)
//      {type:'dispose'}
// out: {type:'ready', loadMs} | {type:'beat', ...see beat-core.mjs} | {type:'silent', rms} | {type:'error', message}

import * as ort from '../../node_modules/onnxruntime-web/dist/ort.wasm.min.mjs';
import { BeatCore } from './beat-core.mjs';

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
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = new URL('../../node_modules/onnxruntime-web/dist/', import.meta.url).href;

const loader = (baseUrl) => async (name, kind) => {
  const url = new URL(name + (kind === 'bin' ? '.bin' : '.onnx'), new URL(baseUrl));
  if (isNodeWorker) { const fs = await import('node:fs/promises'); const { fileURLToPath } = await import('node:url'); return fs.readFile(fileURLToPath(url)); }
  const res = await fetch(url); if (!res.ok) throw new Error(`${url} -> ${res.status}`); return res.arrayBuffer();
};

let core = null, chain = Promise.resolve();
onMessage((msg) => { chain = chain.then(() => handle(msg)).catch((err) => post({ type: 'error', message: String((err && err.stack) || err) })); });
async function handle(msg) {
  if (msg.type === 'init') { const t0 = performance.now(); core = new BeatCore({ ort, loadModel: loader(msg.baseUrl) }); await core.init(); post({ type: 'ready', loadMs: performance.now() - t0 }); }
  else if (msg.type === 'audio') {
    if (!core || !core.ready) return;
    if (Number.isFinite(msg.audioEnd)) core.pushed = Math.round(msg.audioEnd * core.inputRate) - msg.samples.length;   // the page's clock
    const r = await core.push(msg.samples);
    if (r) post(r.silent ? { type: 'silent', rms: r.rms } : r, r.silent ? [] : [r.beat.buffer, r.down.buffer]);
  } else if (msg.type === 'dispose') { if (core) await core.dispose(); core = null; }
}
