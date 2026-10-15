// brain-core.mjs - the recognition pipeline, independent of Worker / Node / DOM.
//
//   48 kHz mono chunks -> streaming resampler -> 16 kHz ring (6 s) -> every 1.5 s of NEW audio:
//   latest 3.2 s -> log-mel patches (3 x 128 frames) -> EffNet-Discogs (400 styles + 1280-d embedding)
//   -> classification heads on every patch embedding -> averaged over patches -> result object.
//   The same window also gives one 187-frame patch (same front end) -> MusiCNN-MSD (200-d) -> arousal and valence
//   regressors trained on human ratings (emoMusic, DEAM; Essentia transfer-learning heads), averaged: `av`.
//
// The host injects `ort` (an onnxruntime-web module) and `loadModel(name, kind)` returning the file
// ('onnx' -> ArrayBuffer/Uint8Array, 'json' -> parsed object), so the same code runs in a Web Worker
// (fetch) and in Node (fs).

import { MelExtractor, Resampler, SR, PATCH, BANDS } from './mel.mjs';
import { VGGishMel, PATCH as YPATCH, BANDS as YBANDS } from './vggish-mel.mjs';

export const ANALYSIS_EVERY_S = 1.5;
export const WINDOW_S = 3.2;
export const RING_S = 6;
export const SILENCE_RMS = 0.002; // about -54 dBFS over the analysed window
const DEFAULT_PATCHES = 2; // 3 patches ~ 300 ms on one WASM thread, 2 ~ 200 ms, 1 ~ 100 ms

const EFFNET = 'discogs-effnet-bsdynamic-1';
const hd = (name) => `${name}-discogs-effnet-1`;

// key, model file, label whose probability we report (index is resolved from the json "classes")
const SCALAR_HEADS = [
  ['aggressive', hd('mood_aggressive'), 'aggressive'],
  ['relaxed', hd('mood_relaxed'), 'relaxed'],
  ['happy', hd('mood_happy'), 'happy'],
  ['sad', hd('mood_sad'), 'sad'],
  ['party', hd('mood_party'), 'party'],
  ['electronic', hd('mood_electronic'), 'electronic'],
  ['acoustic', hd('mood_acoustic'), 'acoustic'],
  ['dance', hd('danceability'), 'danceable'],
  ['voice', hd('voice_instrumental'), 'voice'],
  ['tonal', hd('tonal_atonal'), 'tonal'],
  ['bright', hd('timbre'), 'bright'], // nsynth_bright_dark has no ONNX; "timbre" (bright/dark) replaces it
  ['approachable', `approachability_regression-discogs-effnet-1`, null],
  ['engaging', `engagement_regression-discogs-effnet-1`, null],
];
// arousal / valence: MusiCNN embedding + two regressors, each output (valence, arousal) on the datasets' 1..9 scale
const MUSICNN = 'msd-musicnn-1', MUSICNN_PATCH = 187, AV_HEADS = ['emomusic-msd-musicnn-2', 'deam-msd-musicnn-2'];
// sounds of the world (YAMNet, AudioSet's 521 classes) gathered by element: what the being hears besides the music
const YAMNET = 'audioset-yamnet-1';
export const SOUND_GROUPS = {
  water: [282, 283, 284, 285, 286, 287, 288, 289, 291, 438, 439, 442, 443, 444, 450],   // water, rain, stream, waterfall, ocean, waves, gurgling, liquid, splash, drip, pour, trickle, boiling
  earth: [103, 106, 107, 108, 112, 114, 116, 121, 122, 126, 127, 278],                  // wild animals, birds and their song, insects, crickets, bees, frogs, rustling leaves
  air: [23, 35, 36, 201, 277, 279, 453],                                                  // sigh, whistling, breathing, wind chime, wind, wind noise, whoosh
  fire: [292, 293, 426, 427, 484],                                                        // fire, crackle, fireworks, firecracker, sizzle
  storm: [280, 281, 420, 430, 487],                                                       // thunderstorm, thunder, explosion, boom, rumble
  music: [132],
  // voices, by kind: the being acts differently on each (and on speech with no music around it: an audiobook, a podcast)
  speech: [0, 1, 2, 3, 65], singing: [24, 26, 29, 30], choir: [25], rap: [31], chant: [27, 28, 32],
  whisper: [12], shout: [6, 9, 10, 11], laugh: [13, 14, 17], cry: [19, 20],
};
const TAG_HEADS = [
  ['instruments', hd('mtg_jamendo_instrument')],
  ['themes', hd('mtg_jamendo_moodtheme')],
];

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

export class BrainCore {
  /**
   * @param {{ort:any, loadModel:(name:string, kind:'onnx'|'json')=>Promise<any>, inputRate?:number, patches?:1|2|3}} opts
   *   patches: EffNet patches per analysis (~100 ms each on one WASM thread); 2 is the default
   */
  constructor({ ort, loadModel, inputRate = 48000, patches = DEFAULT_PATCHES, layers = {} }) {
    // layers: which models run. style = genre / mood / instruments / embedding (Discogs-EffNet + heads), feel = arousal / valence (MusiCNN + heads), world = sounds of the world (YAMNet). Off means not loaded and not run.
    this.layers = { style: layers.style !== false, feel: layers.feel !== false, world: layers.world !== false };
    this.nPatches = Math.max(1, Math.min(3, patches | 0));
    this.ort = ort;
    this.loadModel = loadModel;
    this.inputRate = inputRate;
    this.mel = new MelExtractor();
    this.resampler = new Resampler(inputRate, SR);
    this.ring = new Float32Array(RING_S * SR);
    this.ringEnd = 0; // total 16 kHz samples ever written
    this.sinceAnalysis = 0; // 16 kHz samples since last analysis
    this.winLen = Math.round(WINDOW_S * SR);
    this.patchBuf = new Float32Array(this.nPatches * PATCH * BANDS);
    this.window = new Float32Array(this.winLen);
    this._rs = new Float32Array(16384);
    this.ready = false;
  }

  async init() {
    const { ort } = this;
    const opts = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
    const mk = async (name) => ort.InferenceSession.create(new Uint8Array(await this.loadModel(name, 'onnx')), opts);

    if (this.layers.style) {
      const meta = await this.loadModel(EFFNET, 'json');
      this.styles = meta.classes; // 400 labels "Parent---Style"
      this.parents = this.styles.map((s) => s.split('---')[0]);
      this.parentNames = [...new Set(this.parents)];
      this.parentIdx = Int32Array.from(this.parents, (p) => this.parentNames.indexOf(p));
      this.effnet = await mk(EFFNET);

      this.heads = [];
      for (const [key, file, label] of SCALAR_HEADS) {
        const json = await this.loadModel(file, 'json');
        const idx = label ? json.classes.indexOf(label) : 0;
        if (idx < 0) throw new Error(`${file}: label ${label} not in ${json.classes}`);
        this.heads.push({ key, idx, width: json.classes.length, regression: !label, session: await mk(file) });
      }
      this.tagHeads = [];
      for (const [key, file] of TAG_HEADS) {
        const json = await this.loadModel(file, 'json');
        this.tagHeads.push({ key, labels: json.classes, session: await mk(file) });
      }
    }
    if (this.layers.world) {
      this.yamnet = await mk(YAMNET); this.yamClasses = (await this.loadModel(YAMNET, 'json')).classes;
      this.vgg = new VGGishMel(); this.yamBuf = new Float32Array(3 * YPATCH * YBANDS);
    }
    if (this.layers.feel) {
      this.musicnn = await mk(MUSICNN);
      this.avHeads = [];
      for (const f of AV_HEADS) this.avHeads.push(await mk(f));   // tensor names differ between the two exports: used by position
      this.avBuf = new Float32Array(MUSICNN_PATCH * BANDS);
    }
    if (this.layers.style) {
      // warm-up so the first real analysis is not paying for graph optimisation / WASM page-in
      const z = new ort.Tensor('float32', new Float32Array(PATCH * BANDS), [1, PATCH, BANDS]);
      const o = await this.effnet.run({ melspectrogram: z });
      await this.heads[0].session.run({ embeddings: new ort.Tensor('float32', o.embeddings.data, [1, 1280]) });
    }
    this.ready = true;
  }

  /** Feed 48 kHz mono samples. Returns an array of 0..n results (n > 1 only for very large chunks). */
  async push(samples) {
    const results = [];
    const every = Math.round(ANALYSIS_EVERY_S * SR);
    let off = 0;
    while (off < samples.length) {
      // take only as much input as is needed to reach the next analysis boundary
      const needOut = Math.max(1, every - this.sinceAnalysis);
      const takeIn = Math.min(samples.length - off, Math.ceil(needOut * this.resampler.step));
      const piece = samples.subarray(off, off + takeIn);
      off += takeIn;
      const cap = Math.ceil(piece.length / this.resampler.step) + 4;
      if (this._rs.length < cap) this._rs = new Float32Array(cap);
      const n = this.resampler.process(piece, this._rs);
      this._write(this._rs, n);
      if (this.sinceAnalysis >= every && this.ringEnd >= this.winLen) {
        this.sinceAnalysis = 0;
        const r = await this.analyse();
        if (r) results.push(r);
      }
    }
    return results;
  }

  _write(buf, n) {
    const cap = this.ring.length;
    for (let i = 0; i < n; i++) this.ring[(this.ringEnd + i) % cap] = buf[i];
    this.ringEnd += n;
    this.sinceAnalysis += n;
  }

  _latestWindow() {
    const cap = this.ring.length, start = this.ringEnd - this.winLen;
    for (let i = 0; i < this.winLen; i++) this.window[i] = this.ring[(start + i) % cap];
    return this.window;
  }

  /**
   * Perceived arousal and valence of the window (the music's, not the being's): mean of the emoMusic and DEAM heads.
   * Mapped from their 1..9 scale: arousal 2.5 -> 0, 7 -> 1; valence 5 -> 0, 2.5 / 7.5 -> -1 / 1. raw keeps the 1..9 means.
   */
  async _av(x) {
    if (!this.musicnn || !this.mel.patches(x, 0, x.length, 1, 1, this.avBuf, MUSICNN_PATCH)) return null;
    const { ort } = this;
    const e = (await this.musicnn.run({ [this.musicnn.inputNames[0]]: new ort.Tensor('float32', this.avBuf, [1, MUSICNN_PATCH, BANDS]) })).embeddings.data;
    const et = new ort.Tensor('float32', e, [1, 200]);
    let v = 0, a = 0;
    for (const h of this.avHeads) { const o = (await h.run({ [h.inputNames[0]]: et }))[h.outputNames[0]].data; v += o[0] / this.avHeads.length; a += o[1] / this.avHeads.length; }
    return { arousal: clamp01((a - 2.5) / 4.5), valence: Math.max(-1, Math.min(1, (v - 5) / 2.5)), raw: { arousal: a, valence: v } };
  }

  /** What it hears besides the music: AudioSet sound events over the window (up to 3 patches of 0.96 s), by element group. */
  async _events(x) {
    if (!this.yamnet) return null;
    const n = this.vgg.patches(x, x.length, 3, this.yamBuf);
    if (!n) return null;
    const { ort } = this;
    const o = await this.yamnet.run({ [this.yamnet.inputNames[0]]: new ort.Tensor('float32', this.yamBuf.subarray(0, n * YPATCH * YBANDS), [n, YPATCH, YBANDS]) });
    const a = o[this.yamnet.outputNames[1]].data, W = a.length / n, mean = new Float32Array(W);
    for (let p = 0; p < n; p++) for (let i = 0; i < W; i++) mean[i] += a[p * W + i] / n;
    const groups = {};
    for (const [g, ids] of Object.entries(SOUND_GROUPS)) { let m = 0; for (const i of ids) m = Math.max(m, mean[i] || 0); groups[g] = m; }
    const top = [...mean.keys()].sort((i, j) => mean[j] - mean[i]).slice(0, 6).map((i) => [this.yamClasses[i], mean[i]]);
    return { ...groups, top };
  }

  /** The style layer: EffNet over the window, then the mood / tag heads. */
  async _style(x) {
    const { ort } = this;
    const patchHop = this.nPatches > 1 ? Math.floor((199 - PATCH) / (this.nPatches - 1)) : 1; // 199 frames in 3.2 s: 2 patches at 0,71 / 3 at 0,35,70
    const n = this.mel.patches(x, 0, x.length, patchHop, this.nPatches, this.patchBuf);
    if (!n) return null;

    const inp = new ort.Tensor('float32', this.patchBuf.subarray(0, n * PATCH * BANDS), [n, PATCH, BANDS]);
    const out = await this.effnet.run({ melspectrogram: inp });
    const act = out.activations.data, emb = out.embeddings.data;
    const NS = this.styles.length, ED = 1280;

    const p = new Float32Array(NS); // styles: mean over patches
    const embedding = new Float32Array(ED);
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < NS; i++) p[i] += act[k * NS + i] / n;
      for (let i = 0; i < ED; i++) embedding[i] += emb[k * ED + i] / n;
    }

    const scalars = {};
    const embT = new ort.Tensor('float32', emb, [n, ED]);
    for (const h of this.heads) {
      const o = (await h.session.run({ embeddings: embT })).activations.data;
      let v = 0;
      for (let k = 0; k < n; k++) v += o[k * h.width + h.idx] / n;
      scalars[h.key] = h.regression ? clamp01(v) : v;
    }
    const tags = {};
    for (const h of this.tagHeads) {
      const o = (await h.session.run({ embeddings: embT })).activations.data;
      const w = h.labels.length, m = new Float32Array(w);
      for (let k = 0; k < n; k++) for (let i = 0; i < w; i++) m[i] += o[k * w + i] / n;
      tags[h.key] = topK(m, h.labels, 5);
    }
    return { p, n, scalars, tags, embedding };
  }

  /** Analyse the latest window now. Returns a result, or {silent:true, rms} when gated. */
  async analyse() {
    const t0 = performance.now();
    const x = this._latestWindow();
    let e = 0;
    for (let i = 0; i < x.length; i++) e += x[i] * x[i];
    const rms = Math.sqrt(e / x.length);
    if (rms < SILENCE_RMS) return { silent: true, rms };

    const { ort } = this;
    const style = this.layers.style ? await this._style(x) : null;
    if (this.layers.style && !style) return null;   // no complete patch yet
    const av = await this._av(x);
    const events = await this._events(x);
    if (!style) return { type: 'result', av, events, embedding: null, rms, patches: 0, ms: performance.now() - t0 };
    const { p, n, scalars, tags, embedding } = style;
    const NS = p.length;
    const stats = styleStats(p);
    const gsum = new Float64Array(this.parentNames.length);
    for (let i = 0; i < NS; i++) gsum[this.parentIdx[i]] += p[i];
    const genres = topK(Float32Array.from(gsum, (v) => v / (stats.sum || 1)), this.parentNames, 5);

    return {
      type: 'result',
      styles: topK(p, this.styles, 12),
      genres,
      moods: {
        aggressive: scalars.aggressive, relaxed: scalars.relaxed, happy: scalars.happy, sad: scalars.sad,
        party: scalars.party, electronic: scalars.electronic, acoustic: scalars.acoustic,
      },
      dance: scalars.dance, voice: scalars.voice, tonal: scalars.tonal,
      approachable: scalars.approachable, engaging: scalars.engaging, bright: scalars.bright,
      instruments: tags.instruments, themes: tags.themes,
      av, events,
      embedding,
      confidence: stats.top1,
      entropy: stats.entropy,
      unknown: stats.unknown,
      rms,
      patches: n,
      ms: performance.now() - t0,
    };
  }

  dispose() {
    const all = [this.effnet, ...this.heads.map((h) => h.session), ...this.tagHeads.map((h) => h.session)];
    return Promise.all(all.map((s) => s && s.release && s.release()));
  }
}

function topK(arr, labels, k) {
  const idx = Array.from(arr.keys ? arr.keys() : arr, (_, i) => i).sort((a, b) => arr[b] - arr[a]).slice(0, k);
  return idx.map((i) => [labels[i], arr[i]]);
}

/**
 * Out-of-distribution score. The 400 outputs are independent sigmoids, so "sure of one style" and
 * "unsure of everything" look different from a softmax. Three views of the same distribution:
 *   H   normalised entropy of p / sum(p)         (1 = every style equally plausible, ~0 = one style)
 *   top1 the largest probability                  (a trained style is present with p ~ 0.3+)
 *   top3 the share of the total mass held by the 3 best styles (concentration)
 * Each is mapped to 0..1 "unfamiliarity" and blended: unknown = 0.4*H' + 0.35*(1-top1') + 0.25*(1-top3').
 * The bounds below come from the synthetic calibration in test-brain.mjs (and the model's typical output
 * range); they are meant to be re-tuned against the user's real listening.
 */
export const UNKNOWN_BOUNDS = { hLo: 0.55, hHi: 0.9, top1Hi: 0.4, top3Lo: 0.04, top3Hi: 0.3 };
export function styleStats(p) {
  let sum = 0, top1 = 0;
  for (let i = 0; i < p.length; i++) { sum += p[i]; if (p[i] > top1) top1 = p[i]; }
  let h = 0;
  const t3 = [0, 0, 0];
  for (let i = 0; i < p.length; i++) {
    const v = p[i];
    if (v > 0 && sum > 0) { const q = v / sum; h -= q * Math.log(q); }
    if (v > t3[0]) { t3[2] = t3[1]; t3[1] = t3[0]; t3[0] = v; }
    else if (v > t3[1]) { t3[2] = t3[1]; t3[1] = v; }
    else if (v > t3[2]) t3[2] = v;
  }
  const entropy = sum > 0 ? h / Math.log(p.length) : 1;
  const top3 = sum > 0 ? (t3[0] + t3[1] + t3[2]) / sum : 0;
  const B = UNKNOWN_BOUNDS;
  const lin = (x, lo, hi) => clamp01((x - lo) / (hi - lo));
  const hU = lin(entropy, B.hLo, B.hHi);
  const t1U = 1 - clamp01(top1 / B.top1Hi);
  const t3U = 1 - lin(top3, B.top3Lo, B.top3Hi);
  return { sum, top1, top3, entropy, unknown: clamp01(0.4 * hU + 0.35 * t1U + 0.25 * t3U) };
}
