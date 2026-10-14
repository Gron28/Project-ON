// compile-connectome.mjs - turns the public FlyWire v783 tables into one compact binary the brain loads.
//
//   node tools/compile-connectome.mjs            (reads data/raw/*.csv.gz + neuron_annotations.tsv, writes data/brain.bin + data/brain.json)
//
// Sources (all public, no login):
//   https://storage.googleapis.com/flywire-data/codex/data/fafb/783/{connections,neurons,classification,consolidated_cell_types,coordinates,labels}.csv.gz
//   https://github.com/flyconnectome/flywire_annotations  (Supplemental_file1_neuron_annotations.tsv: cell types, soma positions, hemibrain types)
// Cite: Dorkenwald et al. 2024 Nature (connectome), Schlegel et al. 2024 Nature (annotations), Eckstein et al. 2024 Cell (neurotransmitters).
// FlyWire data terms: CC BY-NC 4.0 (non-commercial).
//
// Output layout (little endian), described by brain.json "sections" (byte offset + length):
//   pos      Float32 x N*3   soma (or representative) position in micrometres
//   sign     Int8    x N     +1 excitatory, -1 inhibitory (GABA / glutamate), per Shiu et al. 2024
//   nt       Uint8   x N     neurotransmitter code (see brain.json "nt")
//   cls      Uint8   x N     super class code (see brain.json "superClass")
//   side     Int8    x N     -1 left, +1 right, 0 centre / unknown
//   rowPtr   Uint32  x N+1   CSR row pointers (outgoing connections of neuron i: rowPtr[i] .. rowPtr[i+1])
//   col      Uint32  x E     postsynaptic neuron index
//   w        Int16   x E     signed synapse count (sign of the presynaptic neuron x synapse count, |w| <= 32767)
//   groups   Uint32  x G     concatenated neuron index lists; brain.json "groups" has {name: [offset, count]}

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data', 'raw');
const OUT_BIN = path.join(ROOT, 'data', 'brain.bin');
const OUT_JSON = path.join(ROOT, 'data', 'brain.json');

const NT = ['UNKNOWN', 'ACH', 'GABA', 'GLUT', 'DA', 'SER', 'OCT'];
const NT_ALIAS = { acetylcholine: 'ACH', gaba: 'GABA', glutamate: 'GLUT', dopamine: 'DA', serotonin: 'SER', octopamine: 'OCT' };
const SUPER = ['unknown', 'optic', 'central', 'sensory', 'visual_projection', 'ascending', 'descending', 'sensory_ascending', 'visual_centrifugal', 'motor', 'endocrine'];

async function* lines(file) {
  const raw = fs.createReadStream(file);
  const stream = file.endsWith('.gz') ? raw.pipe(zlib.createGunzip()) : raw;
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) yield line;
}
// simple CSV split for files without embedded commas in the fields we use (labels.csv has quoted fields: handled separately)
const split = (line) => line.split(',');

async function main() {
  const t0 = Date.now();
  // ---- 1. neuron list: index by root id, in classification order --------------------------------
  const idOf = new Map(); // root_id string -> index
  const cls = [], side = [], subClass = [];
  for await (const line of lines(path.join(RAW, 'classification.csv.gz'))) {
    if (line.startsWith('root_id')) continue;
    const f = split(line); // root_id,flow,super_class,class,sub_class,hemilineage,side,nerve
    const i = cls.length;
    idOf.set(f[0], i);
    cls.push(Math.max(0, SUPER.indexOf(f[2])));
    side.push(f[6] === 'left' ? -1 : f[6] === 'right' ? 1 : 0);
    subClass.push(f[4] || '');
  }
  const N = cls.length;
  console.log(`neurons: ${N}`);

  // ---- 2. neurotransmitter per neuron (neurons.csv), sign per Shiu et al. --------------------------
  const nt = new Uint8Array(N), sign = new Int8Array(N).fill(1);
  for await (const line of lines(path.join(RAW, 'neurons.csv.gz'))) {
    if (line.startsWith('root_id')) continue;
    const f = split(line); // root_id,group,nt_type,...
    const i = idOf.get(f[0]);
    if (i === undefined) continue;
    const code = Math.max(0, NT.indexOf(f[2]));
    nt[i] = code;
    if (f[2] === 'GABA' || f[2] === 'GLUT') sign[i] = -1;
  }

  // ---- 3. positions: representative position from coordinates.csv, replaced by the soma when known --
  const pos = new Float32Array(N * 3);
  const seen = new Uint8Array(N);
  for await (const line of lines(path.join(RAW, 'coordinates.csv.gz'))) {
    if (line.startsWith('root_id')) continue;
    const m = line.match(/^(\d+),\[\s*(\d+)\s+(\d+)\s+(\d+)\s*\]/);
    if (!m) continue;
    const i = idOf.get(m[1]);
    if (i === undefined || seen[i]) continue;
    seen[i] = 1;
    pos[i * 3] = +m[2] / 1000; pos[i * 3 + 1] = +m[3] / 1000; pos[i * 3 + 2] = +m[4] / 1000; // nm -> um
  }

  // ---- 4. cell types: consolidated primary type + Schlegel annotations (soma, hemibrain type, synonyms) --
  const type = new Array(N).fill('');
  for await (const line of lines(path.join(RAW, 'consolidated_cell_types.csv.gz'))) {
    if (line.startsWith('root_id')) continue;
    const f = split(line);
    const i = idOf.get(f[0]);
    if (i !== undefined) type[i] = f[1] || '';
  }
  const hemi = new Array(N).fill(''), syn = new Array(N).fill('');
  let soma = 0, header = null;
  for await (const line of lines(path.join(RAW, 'neuron_annotations.tsv'))) {
    const f = line.split('\t');
    if (!header) { header = Object.fromEntries(f.map((k, j) => [k, j])); continue; }
    const i = idOf.get(f[header.root_id]);
    if (i === undefined) continue;
    if (!type[i]) type[i] = f[header.cell_type] || '';
    hemi[i] = f[header.hemibrain_type] || '';
    syn[i] = f[header.synonyms] || '';
    const sx = f[header.soma_x], sy = f[header.soma_y], sz = f[header.soma_z];
    if (sx && sy && sz) { pos[i * 3] = +sx * 4 / 1000; pos[i * 3 + 1] = +sy * 4 / 1000; pos[i * 3 + 2] = +sz * 40 / 1000; soma++; } // voxel (4,4,40 nm) -> um
    if (!nt[i]) { const code = NT.indexOf(NT_ALIAS[f[header.top_nt]] || ''); if (code > 0) { nt[i] = code; if (code === 2 || code === 3) sign[i] = -1; } }
  }
  console.log(`soma positions: ${soma}`);

  // community labels (labels.csv): only used to find a few named song neurons (aPN1, pC2l, vPN1)
  const labelHits = { aPN1: new Set(), pC2l: new Set(), vPN1: new Set() };
  for await (const line of lines(path.join(RAW, 'labels.csv.gz'))) {
    if (line.startsWith('root_id')) continue;
    const id = line.slice(0, line.indexOf(','));
    const i = idOf.get(id);
    if (i === undefined) continue;
    const label = line.slice(id.length + 1, 200);
    for (const k of Object.keys(labelHits)) if (label.includes(k)) labelHits[k].add(i);
  }

  // ---- 5. groups --------------------------------------------------------------------------------
  const groups = {};
  const add = (name, i) => (groups[name] || (groups[name] = [])).push(i);
  for (let i = 0; i < N; i++) {
    const t = type[i], h = hemi[i], s = syn[i];
    const pre = (p) => t.startsWith(p) || h.startsWith(p);
    // ear: Johnston's organ neurons by subgroup (JO-A/B sound, JO-C/E wind & gravity, JO-D, JO-F grooming)
    for (const g of ['JO-A', 'JO-B', 'JO-C', 'JO-D', 'JO-E', 'JO-F']) if (t.startsWith(g)) add(g, i);
    if (t.startsWith('JO-') && !/^JO-[A-F]/.test(t)) add('JO-other', i);
    if (subClass[i] === 'auditory') add('auditory', i);
    if (subClass[i] === 'wind_gravity') add('wind_gravity', i);
    // second order auditory
    if (pre('AMMC')) add('AMMC', i);
    if (pre('WED')) add('WED', i);
    if (labelHits.aPN1.has(i)) add('aPN1', i);
    if (labelHits.vPN1.has(i)) add('vPN1', i);
    if (labelHits.pC2l.has(i) || s.includes('pC2l')) add('pC2l', i);
    // courtship / arousal
    if (/^pC1[a-e]/.test(t) || /^pC1[a-e]/.test(h)) add('pC1', i);
    if (pre('aIPg')) add('aIPg', i);
    if (pre('vpoEN') || pre('vpoDN')) add('vpo', i);
    // mushroom body
    if (pre('KC')) { add('KC', i); if (t.startsWith('KCg')) add('KCg', i); else if (t.startsWith('KCab')) add('KCab', i); else if (t.startsWith('KCapbp')) add('KCapbp', i); }
    if (pre('MBON')) { add('MBON', i); add(sign[i] < 0 && nt[i] === 3 ? 'MBON-avoid' : 'MBON-approach', i); }
    if (pre('PAM')) add('PAM', i);
    if (pre('PPL1')) add('PPL1', i);
    if (pre('APL')) add('APL', i);
    if (pre('DPM')) add('DPM', i);
    // central complex compass and steering
    if (pre('EPG')) add('EPG', i);
    if (pre('PEN')) add('PEN', i);
    if (pre('PEG')) add('PEG', i);
    if (pre('PFL3')) add('PFL3', i);
    if (pre('PFL2')) add('PFL2', i);
    if (/^FB6/.test(t) || /^FB6/.test(h)) add('dFB', i); // dorsal fan-shaped body: sleep drive
    if (/^hDelta/.test(t)) add('hDelta', i);
    // clock
    if (/^(DN1|LNd|s-LNv|l-LNv|LPN|DN3|DN2)/.test(t)) add('clock', i);
    // descending neurons (the fly's motor commands), by side and family
    if (cls[i] === 6) {
      add('DN', i); add(side[i] < 0 ? 'DN-left' : side[i] > 0 ? 'DN-right' : 'DN-mid', i);
      const fam = (t.match(/^DN[a-z]+/) || h.match(/^DN[a-z]+/) || [''])[0];
      if (fam) add(fam, i);
      if (pre('DNa02')) add('DNa02', i); // turning
      if (pre('DNp09')) add('DNp09', i); // forward walking / courtship pursuit
      if (pre('DNp13')) add('DNp13', i); // pulse song preferring (pMN1)
      if (pre('DNg')) add('DNg-all', i);
    }
    if (cls[i] === 9) add('motor', i);
    if (cls[i] === 10) add('endocrine', i);
    if (cls[i] === 5) add('ascending', i);
    if (cls[i] === 3 && subClass[i] && !/auditory|wind_gravity|grooming/.test(subClass[i])) add('sensory-' + subClass[i], i);
  }
  // ascending/descending of a few summary groups so the renderer can also colour by class
  for (const name of Object.keys(groups)) groups[name] = Uint32Array.from(groups[name]);
  const gnames = Object.keys(groups).sort();
  console.log('groups:', gnames.map((n) => `${n}=${groups[n].length}`).join(' '));

  // ---- 6. connections -> CSR ------------------------------------------------------------------
  let E = 0;
  const pre = [], post = [], cnt = [];
  let dropped = 0;
  for await (const line of lines(path.join(RAW, 'connections.csv.gz'))) {
    if (line.startsWith('pre_root_id')) continue;
    const f = split(line); // pre_root_id,post_root_id,neuropil,syn_count,nt_type
    const a = idOf.get(f[0]), b = idOf.get(f[1]);
    if (a === undefined || b === undefined) { dropped++; continue; }
    pre.push(a); post.push(b); cnt.push(+f[3]);
    E++;
  }
  console.log(`connections: ${E} (dropped ${dropped})`);
  // the same pair can appear once per neuropil: merge
  const deg = new Uint32Array(N + 1);
  for (let e = 0; e < E; e++) deg[pre[e] + 1]++;
  for (let i = 0; i < N; i++) deg[i + 1] += deg[i];
  const order = new Uint32Array(E);
  { const fill = deg.slice(0, N); for (let e = 0; e < E; e++) order[fill[pre[e]]++] = e; }
  const rowPtr = new Uint32Array(N + 1), colTmp = new Uint32Array(E), wTmp = new Int16Array(E);
  let k = 0;
  for (let i = 0; i < N; i++) {
    const s = deg[i], t = deg[i + 1];
    const idx = Array.from(order.subarray(s, t)).sort((x, y) => post[x] - post[y]);
    rowPtr[i] = k;
    let last = -1;
    for (const e of idx) {
      const p = post[e];
      if (p === last) { wTmp[k - 1] = Math.max(-32767, Math.min(32767, wTmp[k - 1] + sign[i] * cnt[e])); continue; }
      colTmp[k] = p; wTmp[k] = sign[i] * Math.min(32767, cnt[e]); k++; last = p;
    }
  }
  rowPtr[N] = k;
  const col = colTmp.subarray(0, k), w = wTmp.subarray(0, k);
  console.log(`merged connections: ${k}`);

  // ---- 7. write ---------------------------------------------------------------------------------
  const groupOffsets = {}, groupArr = new Uint32Array(gnames.reduce((s, n) => s + groups[n].length, 0));
  { let o = 0; for (const n of gnames) { groupOffsets[n] = [o, groups[n].length]; groupArr.set(groups[n], o); o += groups[n].length; } }
  const sections = {};
  const parts = [];
  let off = 0;
  const put = (name, arr) => { const b = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength); sections[name] = { offset: off, length: arr.length, type: arr.constructor.name }; parts.push(b); off += b.length; const pad = (8 - (off % 8)) % 8; if (pad) { parts.push(Buffer.alloc(pad)); off += pad; } };
  put('pos', pos); put('sign', sign); put('nt', nt); put('cls', cls instanceof Uint8Array ? cls : Uint8Array.from(cls)); put('side', Int8Array.from(side));
  put('rowPtr', rowPtr); put('col', col); put('w', w); put('groups', groupArr);
  fs.writeFileSync(OUT_BIN, Buffer.concat(parts));
  // a short human type string per neuron is useful for the UI (hover): keep only the first 24 chars, as a JSON array it is ~2 MB
  const meta = {
    version: 1, N, E: k, bytes: off, sections, nt: NT, superClass: SUPER, groups: groupOffsets,
    source: 'FlyWire FAFB v783 (Codex public tables + flyconnectome/flywire_annotations)',
    license: 'FlyWire data: CC BY-NC 4.0. Cite Dorkenwald et al. 2024, Schlegel et al. 2024, Eckstein et al. 2024.',
    model: { tau_m_ms: 20, v_rest_mV: -52, v_reset_mV: -52, v_th_mV: -45, t_ref_ms: 2.2, tau_syn_ms: 5, delay_ms: 1.8, w_syn_mV: 0.275, ref: 'Shiu et al. 2024 Nature, A Drosophila computational brain model reveals sensorimotor processing' },
    types: type.map((t) => t.slice(0, 24)),
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(meta));
  console.log(`wrote ${OUT_BIN} (${(off / 1e6).toFixed(1)} MB) and ${OUT_JSON} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

main().catch((e) => { console.error(e); process.exit(1); });
