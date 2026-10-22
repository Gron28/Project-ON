// analysis.mjs - real-time music analysis for the audio visualizer.
//
// Dependency-free ES module, no DOM: runs in the Electron renderer and in Node.
// Pipeline (sample rate 48 kHz, hop 512, window 1024, Hann):
//   1. HPSS per hop: harmonic = causal median over time (17 hops), percussive = median over
//      frequency (+-8 bins), soft masks H^2 / (H^2 + P^2). Bass / lead / pads come from the
//      harmonic part, drum bands from the percussive part.
//   2. Drum onsets (kick / snare / hat): log spectral flux per band against a running mean.
//   3. Beat tracker: band-normalised onset envelope -> autocorrelation (tempo, octave-resistant)
//      -> comb filter (phase and fine tempo) -> PLL-corrected running phase -> beat / downbeat.
//   4. Chroma notes + voice heuristic from a 4096 window every 4 hops.
//   5. Structure: 0.5 s block features -> novelty (sections), tension (build-ups), drops.
//   6. Character: ABSOLUTE descriptors (loudness, noisiness, roughness, ...) on fixed cross-song
//      scales, smoothed over a few seconds. Nothing there is normalised against the song itself, so
//      a string quartet, a rap track and harsh noise land in different places (state.character).
//
// Time convention: every event carries the audio-clock time of the thing it describes (the hit,
// the beat, the boundary), not the time it was detected. Detection trails by about one hop for
// drums, a few hops for beats and up to a second or two for sections.
//
// All buffers are preallocated; the only per-hop allocations are event objects when one fires.

import { realFFT } from './fft.mjs';

const HOP = 512;
const WIN = 1024;
const CWIN = 4096; // long window for pitch resolution (notes, voice)
const LOGC = 200; // log-compression gain on amplitude-scaled magnitudes: log1p(LOGC * mag)

// Calibrated against the synthetic test song: how long after the true onset an event is
// detected, in seconds. Events are stamped with (cursor - LAT) so they land on the onset.
const LAT = 0.009;
// The onset envelope used by the beat tracker peaks later than the first-detection of a hit
// (it is the sum over many bins, and the peak hop trails the first rising hop).
const ENV_LAT = 0.011;

// tempo ratios that are musically "the same beat" (double, half, 3:2, 2:3): switching needs more proof
const OCTAVES = [2, 0.5, 1.5, 2 / 3];

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// In-place insertion sort of the first n entries (n <= 17); returns the median.
// Cheaper than a general sort for these tiny windows and allocation-free.
function median(scr, n) {
  for (let i = 1; i < n; i++) {
    const v = scr[i];
    let j = i - 1;
    while (j >= 0 && scr[j] > v) { scr[j + 1] = scr[j]; j--; }
    scr[j + 1] = v;
  }
  return scr[n >> 1];
}

// Sorted window w[o .. o+n): replaces one entry equal to `out` with `v` and keeps it sorted, so a running median costs
// one shift instead of a sort. Returns false when `out` is not there (a NaN went through): the caller rebuilds.
function slide(w, o, n, out, v) {
  const e = o + n;
  let i = o;
  while (i < e && w[i] !== out) i++;
  if (i === e) return false;
  while (i > o && w[i - 1] > v) { w[i] = w[i - 1]; i--; }
  while (i < e - 1 && w[i + 1] < v) { w[i] = w[i + 1]; i++; }
  w[i] = v;
  return true;
}

export function createAnalyzer({ sampleRate = 48000 } = {}) {
  const sr = sampleRate;
  const dt = HOP / sr; // seconds per hop
  const hopRate = sr / HOP; // 93.75 Hz at 48 kHz
  const NB = WIN / 2 + 1;
  const binHz = sr / WIN;
  const cBinHz = sr / CWIN;

  // time-constant helpers: per-hop smoothing coefficient / decay factor for a time constant in ms
  const coef = (ms) => 1 - Math.exp(-(dt * 1000) / ms);
  const decay = (ms) => Math.exp(-(dt * 1000) / ms);

  // ---- input ring (>= 4 s) ------------------------------------------------------------------
  let ringSize = 1;
  while (ringSize < 4 * sr) ringSize <<= 1;
  const ringMask = ringSize - 1;
  const ring = new Float32Array(ringSize);
  let total = 0;
  let pos = WIN; // absolute end index of the next window to process
  let hopIdx = 0;
  let warm = 3; // hops during which flux is ignored (history is still filling)
  let events = [];

  // ---- band edges (bins of the 1024 FFT) ----------------------------------------------------
  const kLo = Math.max(1, Math.ceil(40 / binHz));
  const kHi = Math.max(kLo, Math.floor(150 / binHz));
  const sLo = kHi + 1;
  const sHi = Math.floor(5000 / binHz);
  const hLo = Math.ceil(6000 / binHz);
  const hHi = Math.min(NB - 1, Math.floor(16000 / binHz));
  const NBU = hHi + 1; // bins actually analysed
  const bassW = Math.max(1, Math.floor(150 / binHz)); // character bassWeight: bins below ~150 Hz
  const bassHi = Math.floor(250 / binHz);
  const leadHi = Math.floor(4000 / binHz);
  const padHi = Math.min(NBU - 1, Math.floor(12000 / binHz));

  // ---- public state -------------------------------------------------------------------------
  const state = {
    level: 0,
    centroid: 0,
    drums: { kick: 0, snare: 0, hat: 0 },
    bass: 0,
    lead: 0,
    pads: 0,
    voice: 0,
    notes: new Float32Array(12),
    beat: { bpm: 0, phase: 0, confidence: 0, count: 0, downbeat: false, barPhase: 0 },
    structure: { section: 0, tension: 0, novelty: 0 },
    energy: 0,
    intensity: 0,   // how intense this moment is within this song: keeps the song's own dynamic range (calm verse low, wild chorus high)
    intensityAbs: 0, // intensity scaled by the absolute picture (loudness, density, roughness): a quiet chill song never reaches wild
    // Absolute descriptors, all 0..1 on fixed scales (no AGC), smoothed over ~3-6 s. Scales: see "character" below.
    character: {
      loudness: 0, dynamics: 0, noisiness: 0, roughness: 0, tonality: 0, harmony: 0, regularity: 0,
      density: 0, intricacy: 0, brightness: 0, bassWeight: 0, vocal: 0, change: 0, tempo: 0,
    },
  };

  // ---- spectral analysis buffers ------------------------------------------------------------
  const fft = realFFT(WIN);
  const hann = new Float64Array(WIN);
  for (let i = 0; i < WIN; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WIN);
  const xw = new Float64Array(WIN); // windowed frame
  const re = new Float64Array(NB);
  const im = new Float64Array(NB);
  const MAGS = 4 / WIN; // makes a sine of amplitude A read ~A in its peak bin
  const mag = new Float32Array(NB);
  const HN = 17; // median length over time, and over frequency (+-8 bins)
  const hist = new Float32Array(HN * NB);
  const hSort = new Float32Array(NB * HN); // per bin, its HN history values sorted (the running time median)
  const scr = new Float32Array(HN); // the frequency window, sorted as it slides over the bins
  const tScr = new Float32Array(HN); // a time window being rebuilt
  const fq = (q) => mag[q < 0 ? 0 : q > NBU - 1 ? NBU - 1 : q]; // magnitude with the bin clamped to the analysed range
  const lp = new Float32Array(NB); // log percussive magnitudes (current)
  const lpPrev = new Float32Array(NB);
  const lr = new Float32Array(NB); // log raw magnitudes (current), for the beat envelope
  const lrPrev = new Float32Array(NB);
  const lh = new Float32Array(NB); // log harmonic magnitudes, for the downbeat accent
  const lhPrev = new Float32Array(NB);

  // ---- drum onset detectors (0 kick, 1 snare, 2 hat) ----------------------------------------
  const FLOOR = [0.5, 1.0, 1.5]; // absolute flux floors so near-silence never triggers
  const REFR = [100, 100, 60].map((ms) => Math.ceil((ms / 1000) * hopRate));
  const REL = 0.22; // a hit must also reach this fraction of the recent flux peak
  const fMean = [0, 0, 0];
  const fPeak = [0, 0, 0];
  const lastHit = [-1e9, -1e9, -1e9];
  const drumEnv = [0, 0, 0];
  const drumRel = [decay(110), decay(140), decay(60)];
  const kMean = coef(500);
  const dPeak = decay(4000);
  const evNames = ['kick', 'snare', 'hat'];
  const flux = new Float64Array(3);
  const owner = new Uint8Array(3);
  const chX = new Float64Array(3);
  let blockHits = 0; // drum hits since the last structure block
  let blockFlux = 0; // onset-envelope flux accumulated over the block (a smooth density measure)

  // ---- channel envelopes (AGC: each normalised against its own decaying peak) --------------
  const agcPeak = [0, 0, 0]; // bass, lead, pads
  const AGC_FLOOR = [0.004, 0.003, 0.002];
  const agcDecay = decay(8000);
  const chAtt = coef(20);
  const chRel = [coef(200), coef(150), coef(250)];
  const chEnv = [0, 0, 0];
  let slowMid = 0;
  // A kick's tail sits in the same bins as the bass and survives the 17-hop median (a kick rings
  // for ~0.3 s). While a kick is ringing the bass input is capped at what it was just before it.
  let bx1 = 0; // bass energy one and two hops ago
  let bx2 = 0;
  let bassPre = 0;
  let kickHold = false;
  const kSlowMid = coef(1500);
  let lvlPeak = 0;
  const lvlDecay = decay(15000);
  let lvlEnv = 0;
  let cenEnv = 0;

  // ---- beat tracking ------------------------------------------------------------------------
  const ENV_N = 1024;
  const envBuf = new Float32Array(ENV_N);
  let envCount = 0;
  const M_MAX = Math.round(4.8 * hopRate); // autocorrelation history
  const M_MIN = Math.round(2.5 * hopRate);
  const LAG_MIN = Math.floor((hopRate * 60) / 200);
  const LAG_MAX = Math.ceil((hopRate * 60) / 60);
  const ob = new Float32Array(M_MAX); // rectified, locally mean-removed envelope
  const os = new Float32Array(M_MAX); // lightly smoothed copy for the comb filter
  const ow = new Float32Array(M_MAX); // recency-weighted copy for the autocorrelation
  const cs = new Float64Array(M_MAX + 1);
  const ac = new Float32Array(2 * LAG_MAX + 4);
  const sc = new Float32Array(LAG_MAX + 2);
  const TEMPO_EVERY = Math.round(0.25 * hopRate);
  const ENV_ACTIVE = 1.0; // raw flux that counts as "something is playing"
  const ENV_W = [1.0, 0.6, 0.35]; // low / mid / high band weights: the beat follows the low end
  const ENV_EPS = [0.3, 1.0, 2.0];
  const envMean = [0, 0, 0];
  const envF = new Float64Array(3);
  const kEnvMean = coef(3000);
  let lastActive = -1e9;
  // detection latency of the envelope peak, in hops (see LAT)
  const ENV_LAG_HOPS = ENV_LAT / dt;
  let locked = false;
  let bpm = 0;
  let candBpm = 0;
  let candCount = 0;
  let bp = 0; // running beat position in beats; floor = beat number, fraction = phase
  let lastBeatNum = 0;
  let beatCount = 0;
  let conf = 0;
  let badPhase = 0;
  const accum = new Float64Array(4); // downbeat accent per beat position mod 4
  let downSlot = 0;
  let accCur = 0;
  let curJ = 0;
  let hfPeak = 0;
  let combPh = 0;
  const REF_N = 7; // tempo refinement: 7 candidate periods, 0.4% apart
  const REF_HALF = 3;
  const REF_STEP = 0.004;
  const refV = new Float64Array(REF_N);

  // ---- notes / voice ------------------------------------------------------------------------
  const cfft = realFFT(CWIN);
  const chann = new Float64Array(CWIN);
  for (let i = 0; i < CWIN; i++) chann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / CWIN);
  const cxw = new Float64Array(CWIN);
  const cre = new Float64Array(CWIN / 2 + 1);
  const cim = new Float64Array(CWIN / 2 + 1);
  const CS = 4 / CWIN;
  const CB = Math.min(CWIN / 2 + 1, Math.ceil(4200 / cBinHz) + 10);
  const cLoBin = Math.max(2, Math.round(110 / cBinHz));
  const cHiBin = Math.min(CB - 10, Math.round(4000 / cBinHz));
  const CH = 5; // median frames across time (harmonic part of the long spectrum)
  const cHist = new Float32Array(CH * CB);
  const cScr = new Float32Array(CH);
  const hm = new Float32Array(CB);
  const cum = new Float64Array(CB + 1);
  let cFrame = 0;
  const PK_MAX = 128;
  const pkF = new Float32Array(PK_MAX);
  const pkM = new Float32Array(PK_MAX);
  const chromaRaw = new Float32Array(12);
  const noteTarget = new Float32Array(12);
  const noteAtt = coef(50);
  const noteRel = coef(250);
  const pitchHists = new Float32Array(48); // semitone history of the last 24 frames, per voice pass
  const pitchNs = new Int32Array(2); // number of contiguous valid pitch frames, per pass
  let voiceTarget = 0;
  let vocalTarget = 0; // character.vocal: the same evidence, tuned for short syllables and weighted toward pitch movement
  let voiceEnv = 0;
  const voiceUp = coef(350);
  const voiceDown = coef(500);

  // ---- structure ----------------------------------------------------------------------------
  const BLOCK_HOPS = Math.round(0.5 * hopRate);
  const NF = 18; // features: loud, centroid, percRatio, bassRatio, density, bassLevel, chroma x12
  const FW = new Float32Array(NF).fill(1);
  for (let i = 6; i < NF; i++) FW[i] = 0.15;
  const FH_N = 40;
  const feat = new Float32Array(FH_N * NF);
  const featT = new Float64Array(FH_N); // block end time (s)
  const acc = new Float64Array(NF);
  let accN = 0;
  let accPerc = 0;
  let accBass = 0;
  let accTot = 0;
  let blockIdx = 0;
  let novMean = 0;
  let novVar = 0;
  let novN = 0;
  const novHist = new Float32Array(FH_N);
  let lastSectionT = -1e9;
  let tension = 0;
  let tPeak = 0;
  let resetIdx = 0;
  let buildArmed = true;
  let slowDens = 0;
  const kEnergy = coef(3000);
  // intensity: short-term loudness against a reference that follows the loudest recent passages (sinking ~6 dB per
  // 45 s), so a soft verse reads calm even after per-channel normalisation, plus how dense and bright the sound is
  const kSt = coef(400), kIntUp = coef(300), kIntDown = coef(1500), REF_SINK = 6 / (45 * hopRate);
  // the reference starts where mastered music usually peaks (~-18 dBFS RMS), so a soft intro reads calm from the
  // first second; if the source stays far below it (a quiet app or volume), it sinks quickly (2 dB/s) to meet it
  const PEAK20_SINK = 1 / (20 * hopRate);
  let stPow = 0, refDB = -18, peak20 = -60;

  // ---- character: absolute descriptors --------------------------------------------------------
  // Everything here lives on a FIXED scale shared by all songs (no AGC, no per-song peak), smoothed over ~3-6 s.
  // Scales and calibration (synthetic string quartet / rap / harsh noise / drone / busy fusion, see test-analysis.mjs):
  //   loudness    A-like weighted RMS (floored at -12 dB), 3 s power average: -45 dBFS -> 0, -9 dBFS -> 1
  //   dynamics    p95 - p10 of the 400 ms loudness over 8 s: 0 dB -> 0, 20 dB -> 1
  //   noisiness   spectral flatness 100 Hz-12 kHz on a 70 ms smoothed power spectrum: -35 dB -> 0, 0 dB -> 1
  //               (a sinusoid sits below -60 dB, white noise near -0.2 dB, pink about -5 dB)
  //   roughness   0.5 x envelope modulation + 0.5 x high-band hardness.
  //               modulation: depth of the 20-100 Hz fluctuation of the |>600 Hz| envelope (depth 0.08 -> 0, 0.6 -> 1),
  //                 counted only when that band is a real part of the sound (-30 dB below the total -> 0, -15 dB -> 1)
  //               hardness: flatness of 4-12 kHz (-35 dB -> 0, -5 dB -> 1) x that band's share of the total (-20 dB -> 0, -3 dB -> 1)
  //   tonality    share of the 110 Hz-4 kHz power standing in sharp spectral lines (a line at least 1.5-3.5x above the bins
  //               two steps away): TON_LO -> 0, TON_HI -> 1
  //   harmony     tonality gate (tonality 0.3 -> 1) x (0.5 x pitch classes sounding together, 2 -> 0, 5.5 -> 1
  //               + 0.5 x chroma change between 0.5 s blocks, mean cosine distance 0.25 -> 1)
  //   regularity  sqrt(beat confidence x tempo stability x onset-envelope periodicity) x onset-rate gate (0.5/s -> 0, 2/s -> 1)
  //   density     onsets per second, log scale: 0.5/s -> 0, 10/s -> 1
  //   intricacy   busy and varied: std over ~4 s of log flux, onset strengths, centroid; active half-octave bands;
  //               onset density, density x (1 - regularity) and harmony
  //   brightness  centroid, log scale: 200 Hz -> 0, 5 kHz -> 1
  //   bassWeight  share of the power below 150 Hz
  //   vocal       voice heuristic (pitch movement of a harmonic voice, see voicePass) gated by the 250 Hz-4 kHz energy share
  //               (0.15 -> 0, 0.4 -> 1), ~3 s
  //   change      mean distance between successive 0.5 s blocks of absolute loudness (10 dB), centroid (1 octave),
  //               flatness (15 dB) and bass share (0.5): mean distance CHG_FULL -> 1
  //   tempo       bpm / 200 (0 when unlocked)
  const chr = state.character;
  const LD_LO = -45, LD_HI = -9;
  const DYN_DB = 20;
  const FLAT_LO = -35, FLAT_HI = 0, FLAT_EPS = 1e-10;
  const HB_LO = -35, HB_HI = -5;
  const MOD_LO = 0.08, MOD_HI = 0.6, MOD_EPS = 3e-4; // MOD_EPS: absolute floor on the mean envelope, so near-silence cannot read as deeply modulated
  const TON_LO = 0.1, TON_HI = 0.7;
  const NEFF_LO = 2, NEFF_HI = 5.5, HCHG_FULL = 0.25;
  const DENS_LO = 0.5, DENS_HI = 10;
  const BR_LO = 200, BR_HI = 5000;
  const CHG_FULL = 0.5; // mean block distance (each term in units of CHG_SCALE) that reads as 1
  const CHG_SCALE = [10, 1, 15, 0.5]; // 10 dB loudness, 1 octave of centroid, 15 dB of flatness, half the energy moving to or from the bass
  const VOC_BASE = 0.1, VOC_SPAN = 0.2;
  const k3 = coef(3000);
  const kVoc = coef(2500);
  const kTemp = coef(1000);
  const k4 = coef(4000);
  // A-like weighting per bin (power), floored at -12 dB so bass still counts a little
  const aw = new Float32Array(NB);
  {
    const ra = (f) => {
      const f2 = f * f;
      return (12194 * 12194 * f2 * f2) / ((f2 + 20.6 * 20.6) * (f2 + 12194 * 12194) * Math.sqrt((f2 + 107.7 * 107.7) * (f2 + 737.9 * 737.9)));
    };
    const r1 = ra(1000);
    for (let k = 1; k < NB; k++) { const g = ra(k * binHz) / r1; aw[k] = Math.max(0.063, g * g); }
  }
  let ldPow = 0; // 3 s weighted power
  let stW = 0; // 400 ms weighted power
  const LD_N = 80; // 8 s of 100 ms loudness samples
  const ldRing = new Float32Array(LD_N);
  const ldScr = new Float32Array(LD_N);
  let ldIdx = 0;
  let dynTarget = 0;
  const kDyn = coef(2000);
  // spectral flatness
  const kF0 = Math.max(2, Math.ceil(100 / binHz));
  const kF1 = Math.min(NBU - 1, Math.floor(12000 / binHz));
  const kHB = Math.ceil(4000 / binHz);
  const ps = new Float64Array(NB);
  const kPs = coef(70);
  const NBAND = 14; // half-octave bands from 100 Hz
  const bandOf = new Uint8Array(NB);
  for (let k = kF0; k <= kF1; k++) bandOf[k] = Math.min(NBAND - 1, Math.max(0, Math.floor(2 * Math.log2((k * binHz) / 100))));
  const bandPow = new Float64Array(NBAND);
  let hfSm = 0;
  let noisSm = 0;
  // envelope modulation (roughness): >600 Hz (2 poles) -> |x| -> 2-pole lowpass at 100 Hz -> minus its 20 Hz mean
  const kRa = 1 - Math.exp((-2 * Math.PI * 600) / sr);
  const kRb = 1 - Math.exp((-2 * Math.PI * 100) / sr);
  const kRc = 1 - Math.exp((-2 * Math.PI * 20) / sr);
  let rLpA = 0, rLpB = 0, rE1 = 0, rE2 = 0, rE20 = 0;
  let depthSm = 0;
  // onsets
  const ONS_FLOOR = 9, ONS_REL = 1.6;
  const ONS_REFR = Math.ceil(0.07 * hopRate);
  const kOm = coef(1500);
  const onDecay = decay(4000);
  let oMean = 0, o1 = 0, o2 = 0, lastOn = -1e9, cntOn = 0;
  const ON_N = 16;
  const onT = new Float64Array(ON_N);
  const onS = new Float32Array(ON_N);
  let onIdx = 0;
  let sOnsSm = 0;
  // intricacy
  let fxM = 0, fxV = 0, cxM = 0, cxV = 0, bandsSm = 0;
  // bass, brightness, lead share
  let bwNum = 0, bwDen = 0, lsNum = 0, lsDen = 0;
  let brSm = 0;
  let vocSm = 0;
  // tonality / harmony (fed by chromaFrame, structureBlock)
  let tonSm = 0;
  const kTon = 1 - Math.exp((-4 * dt) / 3);
  const chromaH = new Float32Array(12);
  const hcAcc = new Float64Array(12);
  const hcPrev = new Float64Array(12);
  let hcPrevOk = false;
  let neffSm = 0;
  let hchgSm = 0;
  // regularity (fed by tempoTick)
  const kReg = 1 - Math.exp((-TEMPO_EVERY * dt) / 3);
  const BH_N = 12;
  const bpmHist = new Float64Array(BH_N);
  let bhIdx = 0;
  let regSm = 0;
  let onRate = 0; // onsets per second (set in characterHop), gates regularity: no onsets, no rhythm
  // change (fed by structureBlock): per 0.5 s block, absolute loudness (dB), centroid (octaves), flatness (dB), bass share
  const bAcc = new Float64Array(4);
  const bPrev = new Float64Array(4);
  let bN = 0;
  let bPrevOk = false;
  let chgSm = 0;
  const kChg = 1 - Math.exp(-0.5 / 4);
  const kHarm = 1 - Math.exp(-0.5 / 3.5);

  // =============================================================================================
  // Per-hop processing
  // =============================================================================================
  function hop() {
    const base = pos - WIN;
    const now = pos / sr;

    // --- windowed FFT of the current hop, plus time-domain RMS ---
    let sq = 0;
    for (let i = 0; i < WIN; i++) {
      const x = ring[(base + i) & ringMask];
      sq += x * x;
      xw[i] = x * hann[i];
    }
    fft(xw, re, im);
    const rms = Math.sqrt(sq / WIN);
    for (let k = 0; k < NBU; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]) * MAGS;

    // --- HPSS ---
    const slot = (hopIdx % HN) * NB;

    let totE = 0;
    let percE = 0;
    let bassE = 0;
    let leadE = 0;
    let padE = 0;
    let cenNum = 0;
    let cenDen = 0;
    let fKick = 0;
    let fSnare = 0;
    let fHat = 0;
    let fEnv = 0; // raw log flux over the whole spectrum (activity, density)
    let fEnvLo = 0;
    let fEnvMid = 0;
    let fEnvHi = 0;
    let fHarm = 0;
    let wE = 0; // A-weighted power (character loudness)
    let midE = 0; // raw power of the voice range (250 Hz-4 kHz), percussive part included
    let lowE = 0; // power below ~150 Hz
    const doFlux = warm <= 0;

    for (let k = 1; k < NBU; k++) {
      // harmonic estimate: median of this bin over the last HN hops (includes the current one)
      const hs = k * HN;
      const old = hist[slot + k];
      hist[slot + k] = mag[k];
      if (!slide(hSort, hs, HN, old, mag[k])) {
        for (let j = 0; j < HN; j++) tScr[j] = hist[j * NB + k];
        median(tScr, HN);
        hSort.set(tScr, hs);
      }
      const Hm = hSort[hs + (HN >> 1)];
      // percussive estimate: median of the current frame over +-8 bins (the window slides one bin per step)
      if (k === 1 || !slide(scr, 0, HN, fq(k - 9), fq(k + 8))) {
        for (let j = -8; j <= 8; j++) scr[j + 8] = fq(k + j);
        median(scr, HN);
      }
      const Pf = scr[HN >> 1];

      const m = mag[k];
      const h2 = Hm * Hm;
      const p2 = Pf * Pf;
      const maskP = p2 / (h2 + p2 + 1e-12); // soft mask: P^2 / (H^2 + P^2)
      const pm = m * maskP;

      // Percussive magnitude: masked magnitude, capped at 2x the frequency median so that narrow
      // tonal onsets (a new chord) cannot pass as percussion. Not used for the kick band, see below.
      let v = pm;
      if (v > 2 * Pf) v = 2 * Pf;
      lp[k] = Math.log1p(LOGC * v);

      totE += m * m;
      wE += m * m * aw[k];
      if (k <= bassW) lowE += m * m;
      if (k > bassHi && k <= leadHi) midE += m * m;
      percE += pm * pm;
      const hmag = m - pm;
      const he = hmag * hmag;
      if (k <= bassHi) bassE += he;
      else if (k <= leadHi) leadE += he;
      else if (k <= padHi) padE += he;
      cenNum += m * k;
      cenDen += m;

      if (k <= padHi) lr[k] = Math.log1p(LOGC * m);
      if (k <= leadHi) lh[k] = Math.log1p(LOGC * hmag);

      if (doFlux) {
        if (k <= kHi) {
          // A kick is narrow in frequency and sits on a steady bass tone that the soft mask would
          // claim, so its flux is taken on the raw magnitude, but only while the bin stands above
          // its harmonic median (a rising transient, not the median catching up with a tail).
          const e = lr[k] - lrPrev[k];
          // with only three bins, noise alone swings the sum, so each bin must rise by more than
          // a noise-sized step (0.5 in log units; a real kick rises by 3 or more)
          if (e > 0.5 && m > 1.3 * Hm) fKick += e - 0.5;
        } else {
          const d = lp[k] - lpPrev[k];
          if (d > 0) {
            if (k <= sHi) fSnare += d;
            else if (k >= hLo) fHat += d;
          }
        }
        if (k <= padHi) {
          const e = lr[k] - lrPrev[k];
          if (e > 0) {
            fEnv += e;
            if (k <= bassHi) fEnvLo += e;
            else if (k <= leadHi) fEnvMid += e;
            else fEnvHi += e;
          }
        }
        if (k <= leadHi) { const e = lh[k] - lhPrev[k]; if (e > 0) fHarm += e; }
      }
    }
    lpPrev.set(lp);
    lrPrev.set(lr);
    lhPrev.set(lh);
    if (warm > 0) warm--;

    // --- drum onsets ---
    // A snare is broadband but a hat is not: whichever of the two bands has a much larger
    // per-bin flux owns the hit, so snare noise does not double as a hat and vice versa.
    const perS = fSnare / (sHi - sLo + 1);
    const perH = fHat / (hHi - hLo + 1);
    flux[0] = fKick;
    flux[1] = fSnare;
    flux[2] = fHat;
    owner[0] = 1;
    owner[1] = perH > 3 * perS ? 0 : 1;
    owner[2] = perS > 3 * perH ? 0 : 1;
    let kickStrength = 0;
    for (let b = 0; b < 3; b++) {
      const f = flux[b];
      const thr = Math.max(FLOOR[b], 2.0 * fMean[b]);
      const above = f > thr && f > REL * fPeak[b] && owner[b] === 1;
      fMean[b] += kMean * (f - fMean[b]);
      const peak = f > fPeak[b] ? f : fPeak[b];
      fPeak[b] = Math.max(f, fPeak[b] * dPeak);
      const since = hopIdx - lastHit[b];
      if (above && since >= REFR[b]) {
        const s = 0.3 + 0.7 * (f / peak);
        lastHit[b] = hopIdx;
        events.push({ type: evNames[b], time: now - LAT, strength: s });
        if (s > drumEnv[b]) drumEnv[b] = s;
        blockHits++;
        if (b === 0) kickStrength = s;
      } else if (above && since <= 2) {
        // the same hit still rising on the next hop: lift the envelope, no new event
        const s = 0.3 + 0.7 * (f / peak);
        if (s > drumEnv[b]) drumEnv[b] = s;
      }
    }
    for (let b = 0; b < 3; b++) drumEnv[b] *= drumRel[b];
    if (kickStrength > 0 && !kickHold) bassPre = bx2;
    kickHold = drumEnv[0] > 0.1;
    state.drums.kick = drumEnv[0];
    state.drums.snare = drumEnv[1];
    state.drums.hat = drumEnv[2];

    // --- level, centroid ---
    lvlPeak = Math.max(rms, lvlPeak * lvlDecay);
    const lvlTarget = clamp01(rms / Math.max(lvlPeak, 0.002));
    lvlEnv += (lvlTarget > lvlEnv ? coef(10) : coef(120)) * (lvlTarget - lvlEnv);
    state.level = lvlEnv;

    const cenHz = cenDen > 1e-9 ? (cenNum / cenDen) * binHz : 0;
    const cenTarget = cenHz > 0 ? clamp01(Math.log2(cenHz / 150) / Math.log2(6000 / 150)) : 0;
    cenEnv += coef(150) * (cenTarget - cenEnv);
    state.centroid = cenEnv;

    // --- harmonic channels ---
    const bassRaw = Math.sqrt(bassE);
    const bassX = kickHold ? Math.min(bassRaw, bassPre) : bassRaw;
    bx2 = bx1;
    bx1 = bassRaw;
    const leadX = Math.sqrt(leadE);
    // pads: bright sustained harmonics plus the steady part of the mid band (min of the current
    // level and its slow mean keeps what has been sounding for seconds, drops fresh notes)
    slowMid += kSlowMid * (leadX - slowMid);
    const padX = Math.sqrt(padE) + 0.7 * Math.min(leadX, slowMid);
    chX[0] = bassX;
    chX[1] = leadX;
    chX[2] = padX;
    for (let c = 0; c < 3; c++) {
      agcPeak[c] = Math.max(chX[c], agcPeak[c] * agcDecay);
      const t = clamp01(chX[c] / Math.max(agcPeak[c], AGC_FLOOR[c]));
      chEnv[c] += (t > chEnv[c] ? chAtt : chRel[c]) * (t - chEnv[c]);
    }
    state.bass = chEnv[0];
    state.lead = chEnv[1];
    state.pads = chEnv[2];

    // --- beat envelope + tracker ---
    // Beat envelope: each band's flux is divided by its own long-term mean (so the 3 low bins
    // count as much as the 200 high ones) and the bands are weighted toward the low end.
    envF[0] = fEnvLo;
    envF[1] = fEnvMid;
    envF[2] = fEnvHi;
    let envV = 0;
    const kM = Math.max(kEnvMean, 1 / (hopIdx + 1));
    for (let i = 0; i < 3; i++) {
      envMean[i] += kM * (envF[i] - envMean[i]);
      envV += (ENV_W[i] * envF[i]) / (envMean[i] + ENV_EPS[i]);
    }
    if (fEnv > ENV_ACTIVE) lastActive = hopIdx;
    envBuf[envCount & (ENV_N - 1)] = envV;
    blockFlux += fEnv;
    envCount++;
    hfPeak = Math.max(fHarm, hfPeak * dPeak);
    trackerHop(now, kickStrength, hfPeak > 1e-6 ? fHarm / hfPeak : 0);
    if (envCount % TEMPO_EVERY === 0) tempoTick();

    // --- notes + voice (long window, every 4 hops) ---
    if (hopIdx % 4 === 0 && pos >= CWIN) chromaFrame();
    for (let i = 0; i < 12; i++) {
      const t = noteTarget[i];
      state.notes[i] += (t > state.notes[i] ? noteAtt : noteRel) * (t - state.notes[i]);
    }
    const vt = state.lead > 0.05 ? voiceTarget : 0;
    voiceEnv += (vt > voiceEnv ? voiceUp : voiceDown) * (vt - voiceEnv);
    state.voice = voiceEnv;

    // --- structure block accumulation ---
    const dB = 20 * Math.log10(rms + 1e-9);
    acc[0] += clamp01((dB + 45) / 35); // -45..-10 dB, where music actually lives
    acc[1] += cenTarget;
    acc[5] += chEnv[0];
    for (let i = 0; i < 12; i++) acc[6 + i] += state.notes[i];
    accPerc += percE;
    accBass += bassE;
    accTot += totE;
    accN++;
    if (accN >= BLOCK_HOPS) structureBlock(now);

    // --- energy: slow arousal ---
    const tempoN = locked ? clamp01((bpm - 70) / 90) : 0.4;
    const rawE = state.level * (0.6 + 0.25 * clamp01(slowDens / 8) + 0.15 * tempoN);
    state.energy += kEnergy * (rawE - state.energy);

    // --- intensity ---
    stPow += kSt * (rms * rms - stPow);
    const stDB = 10 * Math.log10(stPow + 1e-12);
    peak20 = Math.max(stDB, peak20 - PEAK20_SINK * 12);   // loudest of roughly the last 20 s
    refDB = Math.max(stDB, refDB - (refDB - peak20 > 12 && peak20 > -60 ? 2 / hopRate : REF_SINK));
    const rel = clamp01((stDB - (refDB - 22)) / 22), gate = clamp01((stDB + 60) / 10);
    const rawI = gate * (0.6 * Math.pow(rel, 1.5) + 0.28 * clamp01(slowDens / 8) * rel + 0.12 * cenEnv * rel);
    state.intensity += (rawI > state.intensity ? kIntUp : kIntDown) * (rawI - state.intensity);

    characterHop(rms, totE, wE, lowE, cenHz, fEnv, midE);

    hopIdx++;
  }

  // =============================================================================================
  // Character: absolute descriptors (see the constants block for the fixed scales)
  // =============================================================================================
  function characterHop(rms, totE, wE, lowE, cenHz, fEnv, midE) {
    const live = totE > 1e-8; // anything above ~ -80 dBFS
    const kW = 1 / (hopIdx + 1); // warm start: a plain running mean until the smoothing window is full
    const s3 = Math.max(k3, kW);

    // --- loudness: A-like weighted power, 3 s ---
    const wp = totE > 1e-20 ? rms * rms * (wE / totE) : rms * rms;
    // per-block absolute features for `change`
    bAcc[0] += Math.max(-80, 10 * Math.log10(wp + 1e-12));
    bAcc[1] += live && cenHz > 0 ? Math.log2(cenHz / 150) : 0;
    bN++;

    ldPow += s3 * (wp - ldPow);
    chr.loudness = clamp01((10 * Math.log10(ldPow + 1e-12) - LD_LO) / (LD_HI - LD_LO));

    // --- dynamics: spread of the 400 ms loudness over the last 8 s ---
    stW += Math.max(kSt, kW) * (wp - stW);
    if (hopIdx % 9 === 0) {
      ldRing[ldIdx % LD_N] = 10 * Math.log10(stW + 1e-12);
      ldIdx++;
      if (ldIdx % 5 === 0) {
        const n = Math.min(ldIdx, LD_N);
        let m = 0;
        for (let i = 0; i < n; i++) {
          const v = ldRing[i];
          if (v < -65) continue;
          let j = m - 1;
          while (j >= 0 && ldScr[j] > v) { ldScr[j + 1] = ldScr[j]; j--; }
          ldScr[j + 1] = v;
          m++;
        }
        dynTarget = m < 25 ? 0 : clamp01((ldScr[Math.floor(0.95 * (m - 1))] - ldScr[Math.floor(0.1 * (m - 1))]) / DYN_DB);
      }
    }
    chr.dynamics += Math.max(kDyn, kW) * (dynTarget - chr.dynamics);

    // --- flatness (whole band and 4-12 kHz) on a lightly smoothed power spectrum, band activity ---
    bandPow.fill(0);
    let lgA = 0, amA = 0, lgH = 0, amH = 0;
    for (let k = kF0; k <= kF1; k++) {
      const m = mag[k];
      const p = ps[k] + kPs * (m * m - ps[k]);
      ps[k] = p;
      const l = Math.log(p + FLAT_EPS);
      lgA += l;
      amA += p;
      if (k >= kHB) { lgH += l; amH += p; }
      bandPow[bandOf[k]] += p;
    }
    const nA = kF1 - kF0 + 1;
    const nH = kF1 - kHB + 1;
    const flatDB = (lgA / nA - Math.log(amA / nA + FLAT_EPS)) * 4.3429448;
    const hiFlatDB = (lgH / nH - Math.log(amH / nH + FLAT_EPS)) * 4.3429448;
    const hiShareDB = 10 * Math.log10(amH / (amA + 1e-20) + 1e-9);
    bAcc[2] += live ? Math.max(-35, flatDB) : -35;
    bAcc[3] += live ? lowE / totE : 0;
    const noisT = live ? clamp01((flatDB - FLAT_LO) / (FLAT_HI - FLAT_LO)) : 0;
    const hfT = live ? clamp01((hiFlatDB - HB_LO) / (HB_HI - HB_LO)) * clamp01((hiShareDB + 20) / 17) : 0;
    noisSm += s3 * (noisT - noisSm);
    hfSm += s3 * (hfT - hfSm);
    chr.noisiness = noisSm;
    let bMax = 0;
    for (let b = 0; b < NBAND; b++) if (bandPow[b] > bMax) bMax = bandPow[b];
    let nAct = 0;
    if (live) for (let b = 0; b < NBAND; b++) if (bandPow[b] > bMax * 1e-3) nAct++;
    bandsSm += s3 * (nAct - bandsSm);

    // --- roughness: amplitude fluctuation 20-100 Hz of the >600 Hz band, per sample ---
    let bpAcc = 0;
    let hpAcc = 0;
    let lLpA = rLpA, lLpB = rLpB, lE1 = rE1, lE2 = rE2, lE20 = rE20;   // locals: a store to a closure `let` double allocates a HeapNumber
    for (let i = pos - HOP; i < pos; i++) {
      const x = ring[i & ringMask];
      lLpA += kRa * (x - lLpA);
      const a = x - lLpA;
      lLpB += kRa * (a - lLpB);
      const b = a - lLpB;
      lE1 += kRb * ((b < 0 ? -b : b) - lE1);
      lE2 += kRb * (lE1 - lE2);
      lE20 += kRc * (lE2 - lE20);
      const d = lE2 - lE20;
      bpAcc += d * d;
      hpAcc += b * b;
    }
    rLpA = lLpA; rLpB = lLpB; rE1 = lE1; rE2 = lE2; rE20 = lE20;
    // only audible if that band is a real part of the sound (-30 dB below the total -> 0, -15 dB -> 1)
    const hpGate = clamp01((10 * Math.log10(hpAcc / HOP / (rms * rms + 1e-20) + 1e-9) + 30) / 15);
    depthSm += s3 * ((Math.sqrt(bpAcc / HOP) / (rE20 + MOD_EPS)) * hpGate - depthSm);
    const roughMod = clamp01((depthSm - MOD_LO) / (MOD_HI - MOD_LO));
    chr.roughness = clamp01(0.5 * roughMod + 0.5 * hfSm);

    // --- brightness, bass weight, vocal, tempo ---
    brSm += s3 * ((live && cenHz > 0 ? clamp01(Math.log(cenHz / BR_LO) / Math.log(BR_HI / BR_LO)) : 0) - brSm);
    chr.brightness = brSm;
    bwNum += s3 * (lowE - bwNum);
    bwDen += s3 * (totE - bwDen);
    chr.bassWeight = bwDen > 1e-8 ? clamp01(bwNum / bwDen) : 0;
    lsNum += s3 * (midE - lsNum);
    lsDen += s3 * (totE - lsDen);
    const leadShare = lsDen > 1e-8 ? lsNum / lsDen : 0;
    vocSm += Math.max(kVoc, kW) * ((live ? clamp01((vocalTarget - VOC_BASE) / VOC_SPAN) * clamp01((leadShare - 0.15) / 0.25) : 0) - vocSm);
    chr.vocal = vocSm;
    chr.tempo += kTemp * (clamp01(state.beat.bpm / 200) - chr.tempo);

    // --- onsets: peaks of the whole-spectrum log flux above 1.6x its recent mean ---
    cntOn *= onDecay;
    const mPrev = oMean;
    oMean += kOm * (fEnv - oMean);
    if (o1 > o2 && o1 >= fEnv && hopIdx - 1 - lastOn >= ONS_REFR && o1 > Math.max(ONS_FLOOR, ONS_REL * mPrev)) {
      lastOn = hopIdx - 1;
      cntOn += 1;
      onT[onIdx % ON_N] = (hopIdx - 1) * dt;
      onS[onIdx % ON_N] = Math.log(o1 / (mPrev + ONS_FLOOR));
      onIdx++;
    }
    o2 = o1;
    o1 = fEnv;
    const rate = cntOn / (4 * Math.max(0.25, 1 - Math.exp(-((hopIdx + 1) * dt) / 4)));
    onRate = rate;
    chr.density = clamp01(Math.log(rate / DENS_LO) / Math.log(DENS_HI / DENS_LO));

    // --- intricacy: variation of flux, onset strengths, centroid, plus active bands ---
    if (live) {
      let d = Math.log1p(fEnv * 0.1) - fxM;
      fxM += k4 * d;
      fxV = (1 - k4) * (fxV + k4 * d * d);
      d = (cenHz > 0 ? Math.log2(cenHz / 150) / 5.3 : 0) - cxM;
      cxM += k4 * d;
      cxV = (1 - k4) * (cxV + k4 * d * d);
    }
    if (hopIdx % 12 === 0) {
      const tNow = hopIdx * dt;
      let n = 0, s = 0, s2 = 0;
      for (let i = 0; i < ON_N; i++) {
        if (i >= onIdx || tNow - onT[i] > 4) continue;
        n++;
        s += onS[i];
        s2 += onS[i] * onS[i];
      }
      const sd = n > 1 ? Math.sqrt(Math.max(0, s2 / n - (s / n) * (s / n))) : 0;
      sOnsSm = clamp01(sd / 0.8) * clamp01(n / 6);
    }
    const sFlux = clamp01(Math.sqrt(fxV) / 0.8);
    const sCen = clamp01(Math.sqrt(cxV) / 0.3);
    const sBands = clamp01((bandsSm - 3) / 8);
    chr.intricacy = clamp01(0.15 * sFlux + 0.15 * sOnsSm + 0.05 * sCen + 0.1 * sBands + 0.25 * chr.density + 0.05 * chr.harmony + 0.25 * chr.density * (1 - chr.regularity));

    // --- intensityAbs: the relative intensity, scaled by the absolute picture ---
    const mix = 0.5 * chr.loudness + 0.25 * chr.density + 0.25 * chr.roughness;
    state.intensityAbs = clamp01(state.intensity * (0.25 + 0.75 * mix));
  }

  // =============================================================================================
  // Beat tracker
  // =============================================================================================

  // Runs every hop: advances the running beat position, emits beat/downbeat, scores the
  // downbeat accent. `kickS` is the kick strength this hop, `harmS` the harmonic change.
  function trackerHop(now, kickS, harmS) {
    if (!locked) {
      state.beat.phase = 0;
      state.beat.downbeat = false;
      state.beat.barPhase = 0;
      state.beat.bpm = 0;
      state.beat.confidence = conf;
      conf *= 0.995;
      return;
    }
    bp += bpm / (60 * hopRate);
    const num = Math.floor(bp);
    const phase = bp - num;

    // accent bookkeeping: the nearest beat (phase window -0.25..0.75) gets this hop's accent
    accCur += kickS + 0.5 * harmS;
    const j = Math.floor(bp + 0.25);
    if (j !== curJ) {
      const s = curJ & 3;
      accum[s] = 0.75 * accum[s] + accCur;
      accCur = 0;
      curJ = j;
      let best = downSlot;
      for (let i = 0; i < 4; i++) if (accum[i] > accum[best] * 1.15) best = i;
      downSlot = best;
    }

    if (num > lastBeatNum) {
      lastBeatNum = num;
      beatCount++;
      const t = now - phase * (60 / bpm);
      const inBar = (((num - downSlot) % 4) + 4) % 4;
      if (conf >= 0.2) {
        events.push({ type: 'beat', time: t, strength: 0.5 + 0.5 * conf });
        if (inBar === 0) events.push({ type: 'downbeat', time: t, strength: 1 });
      }
    }
    const inBar = (((num - downSlot) % 4) + 4) % 4;
    state.beat.bpm = bpm;
    state.beat.phase = phase;
    state.beat.confidence = conf;
    state.beat.count = beatCount;
    state.beat.downbeat = inBar === 0;
    state.beat.barPhase = (inBar + phase) / 4;
  }

  // Comb filter score for a beat that happened `phi` hops before the newest envelope sample:
  // the smoothed onset envelope summed at that phase and K periods back (older beats count less).
  function comb(phi, P, K, M) {
    let s = 0;
    let w = 1;
    for (let k = 0; k < K; k++) {
      const x = M - 1 - phi - k * P;
      if (x < 0) break;
      const i0 = Math.floor(x);
      const fr = x - i0;
      s += (os[i0] * (1 - fr) + (i0 + 1 < M ? os[i0 + 1] : os[i0]) * fr) * w;
      w *= 0.93;
    }
    return s;
  }

  // Best comb score over all phases for period P (half-hop steps); the winning phase index goes
  // to combPh.
  function bestComb(P, K, M) {
    const nPh = Math.floor(P * 2);
    let best = -1;
    for (let p = 0; p < nPh; p++) {
      const s = comb(p * 0.5, P, K, M);
      if (s > best) { best = s; combPh = p; }
    }
    return best;
  }

  // Runs every ~0.25 s: autocorrelation tempo, tempo smoothing, comb-filter phase, PLL.
  function tempoTick() {
    const M = Math.min(envCount, M_MAX);
    if (M < M_MIN) return;

    // is anything there at all? (digital silence or noise floor -> unlock)
    if (hopIdx - lastActive > 1.25 * hopRate) {
      locked = false;
      candCount = 0;
      bpm = 0;
      conf *= 0.5;
      regSm += kReg * (0 - regSm);
      chr.regularity = regSm;
      return;
    }

    // linear copy of the envelope, then remove the local mean (+-0.25 s) and rectify
    for (let i = 0; i < M; i++) ob[i] = envBuf[(envCount - M + i) & (ENV_N - 1)];
    cs[0] = 0;
    for (let i = 0; i < M; i++) cs[i + 1] = cs[i] + ob[i];
    const half = Math.round(0.25 * hopRate);
    for (let i = 0; i < M; i++) {
      const a = Math.max(0, i - half);
      const b = Math.min(M, i + half + 1);
      const v = ob[i] - (cs[b] - cs[a]) / (b - a);
      ow[i] = v > 0 ? v : 0;
    }
    for (let i = 0; i < M; i++) ob[i] = ow[i];
    for (let i = 0; i < M; i++) {
      const a = i > 0 ? ob[i - 1] : ob[i];
      const c = i < M - 1 ? ob[i + 1] : ob[i];
      os[i] = 0.25 * a + 0.5 * ob[i] + 0.25 * c;
    }
    // recency weighting lets a tempo change win within a few seconds
    const tau = 2.5 * hopRate;
    let mu = 0;
    for (let i = 0; i < M; i++) { ow[i] = ob[i] * Math.exp(-(M - 1 - i) / tau); mu += ow[i]; }
    mu /= M;

    // autocorrelation (unbiased by overlap length) up to twice the longest beat period
    const lagTop = Math.min(2 * LAG_MAX + 1, M - 30);
    for (let l = 0; l <= lagTop; l++) {
      let s = 0;
      for (let i = l; i < M; i++) s += ow[i] * ow[i - l];
      ac[l] = s / (M - l);
    }
    // score = ac at the lag + half of ac at twice the lag, times a log-Gaussian prior at 120 BPM
    let bestL = -1;
    let bestV = 0;
    let sum = 0;
    let n = 0;
    for (let l = LAG_MIN; l <= LAG_MAX; l++) {
      if (l > lagTop) break;
      let s = ac[l];
      if (2 * l <= lagTop) s += 0.5 * ac[2 * l];
      sc[l] = s;
      const oct = Math.log2(((hopRate * 60) / l) / 120);
      const w = Math.exp(-0.5 * (oct / 0.9) * (oct / 0.9));
      sum += s;
      n++;
      if (s * w > bestV) { bestV = s * w; bestL = l; }
    }
    if (bestL < 0 || n === 0) return;
    // parabolic refinement of the lag
    let lagF = bestL;
    if (bestL > LAG_MIN && bestL < Math.min(LAG_MAX, lagTop)) {
      const a = sc[bestL - 1];
      const b = sc[bestL];
      const c = sc[bestL + 1];
      const d = a - 2 * b + c;
      if (d < 0) lagF = bestL + Math.max(-1, Math.min(1, (0.5 * (a - c)) / d));
    }
    const estBpm = (hopRate * 60) / lagF;
    const ratio = sc[bestL] / (sum / n + 1e-9);
    const confEst = clamp01((ratio - 2) / 2.5);
    {
      // regularity: tracker confidence x tempo stability x sharpness of the onset autocorrelation peak
      // zero-mean normalised autocorrelation at the tempo lag (a rectified envelope sits near 0.3 on its own)
      const per = clamp01(((ac[bestL] - mu * mu) / (ac[0] - mu * mu + 1e-12)) / 0.4);
      bpmHist[bhIdx % BH_N] = locked ? Math.log2(bpm) : 0;
      bhIdx++;
      const n = Math.min(bhIdx, BH_N);
      let sx = 0, sxx = 0, allLocked = true;
      for (let i = 0; i < n; i++) {
        if (bpmHist[i] <= 0) allLocked = false;
        sx += bpmHist[i];
        sxx += bpmHist[i] * bpmHist[i];
      }
      // spread of the tracked tempo over the last ~3 s: 0 octaves -> 1, 0.05 octaves (3.5%) -> 0; unlocked -> 0
      const stab = n < 6 || !allLocked ? 0 : clamp01(1 - Math.sqrt(Math.max(0, sxx / n - (sx / n) * (sx / n))) / 0.05);
      regSm += kReg * (Math.sqrt(clamp01(conf / 0.5) * stab * per) * clamp01((onRate - 0.5) / 1.5) - regSm);
      chr.regularity = regSm;
    }

    // --- tempo smoothing: resist octave flips, switch only after consistent evidence ---
    let snap = false;
    if (!locked) {
      if (candCount > 0 && Math.abs(estBpm / candBpm - 1) < 0.05) {
        candBpm += 0.3 * (estBpm - candBpm);
        candCount++;
      } else { candBpm = estBpm; candCount = 1; }
      if (candCount >= 3) { locked = true; bpm = candBpm; candCount = 0; snap = true; }
    } else {
      const r = estBpm / bpm;
      if (Math.abs(r - 1) < 0.05) {
        // small deviations are left to the comb refinement below, which is far more precise than
        // the autocorrelation peak; only a real drift (> 1.5%) follows the estimate directly
        if (Math.abs(r - 1) > 0.015) bpm += 0.25 * (estBpm - bpm);
        candCount = 0;
      } else {
        if (candCount > 0 && Math.abs(estBpm / candBpm - 1) < 0.05) {
          candBpm += 0.3 * (estBpm - candBpm);
          candCount++;
        } else { candBpm = estBpm; candCount = 1; }
        let octave = false;
        for (let i = 0; i < OCTAVES.length; i++) if (Math.abs(r / OCTAVES[i] - 1) < 0.06) octave = true;
        if (candCount >= (octave ? 8 : 3)) { bpm = candBpm; candCount = 0; snap = true; }
      }
    }
    if (!locked) { conf += 0.3 * (confEst * 0.5 - conf); return; }

    // --- tempo refinement: the autocorrelation lag is only good to ~0.3%, and a period that is
    // off by that much smears a comb reaching 8 beats back. Try slightly longer / shorter periods
    // and keep the one whose pulse train lines up best with the envelope. ---
    let P = (hopRate * 60) / bpm;
    const K = Math.max(1, Math.min(8, Math.floor((M - 2) / P)));
    if (!snap && conf > 0.5) {
      let bi = 0;
      for (let i = 0; i < REF_N; i++) {
        refV[i] = bestComb(P * (1 + REF_STEP * (i - REF_HALF)), K, M);
        if (refV[i] > refV[bi]) bi = i;
      }
      let di = bi - REF_HALF;
      if (bi > 0 && bi < REF_N - 1) {
        const d = refV[bi - 1] - 2 * refV[bi] + refV[bi + 1];
        if (d < 0) di += 0.5 * (refV[bi - 1] - refV[bi + 1]) / d;
      }
      bpm += 0.3 * (bpm / (1 + REF_STEP * di) - bpm);
      P = (hopRate * 60) / bpm;
    }
    const nPh = Math.floor(P * 2);
    const bestS = bestComb(P, K, M);
    const bestPh = combPh;
    // sub-half-hop refinement: parabola through the best candidate and its two neighbours
    let phiF = bestPh * 0.5;
    const sA = comb(((bestPh - 1 + nPh) % nPh) * 0.5, P, K, M);
    const sB = comb(((bestPh + 1) % nPh) * 0.5, P, K, M);
    const dd = sA - 2 * bestS + sB;
    if (dd < 0) phiF += 0.5 * Math.max(-1, Math.min(1, (0.5 * (sA - sB)) / dd));
    // elapsed fraction of the current beat at the cursor, compensating detection latency
    let meas = (phiF + ENV_LAG_HOPS) / P;
    meas -= Math.floor(meas);

    if (snap || badPhase >= 4) {
      bp = Math.floor(bp) + meas;
      if (snap) { for (let i = 0; i < 4; i++) accum[i] = 0; downSlot = 0; accCur = 0; }
      curJ = Math.floor(bp + 0.25);
      lastBeatNum = Math.floor(bp);
      badPhase = 0;
    } else {
      let err = meas - (bp - Math.floor(bp));
      err -= Math.round(err);
      if (Math.abs(err) < 0.3) {
        // PLL: pull toward the measured phase; when confidence is low (a riser, a fill) the
        // measurement is mostly noise, so lean on the steady tempo instead
        bp += 0.2 * (0.35 + 0.65 * conf) * err;
        badPhase = 0;
      } else badPhase++;
    }
    conf += 0.3 * (confEst - conf);
  }

  // =============================================================================================
  // Notes (chroma) and voice, from the long window
  // =============================================================================================
  function chromaFrame() {
    const base = pos - CWIN;
    for (let i = 0; i < CWIN; i++) {
      cxw[i] = ring[(base + i) & ringMask] * chann[i];
    }
    cfft(cxw, cre, cim);
    const off = (cFrame % CH) * CB;
    for (let k = 0; k < CB; k++) cHist[off + k] = Math.sqrt(cre[k] * cre[k] + cim[k] * cim[k]) * CS;
    cFrame++;
    // harmonic part: median over the last frames removes drum bursts from the chroma
    const nF = Math.min(CH, cFrame);
    for (let k = 0; k < CB; k++) {
      for (let j = 0; j < nF; j++) cScr[j] = cHist[j * CB + k];
      hm[k] = median(cScr, nF);
    }
    cum[0] = 0;
    for (let k = 0; k < CB; k++) cum[k + 1] = cum[k] + hm[k];

    // spectral peaks: local maxima standing >= 1.7x above the mean of +-8 bins
    let np = 0;
    let maxProm = 0;
    let shareTot = 0;
    let shareForm = 0;
    let totPow = 0; // power of the harmonic spectrum in the pitch range
    let tonPow = 0; // part of it standing in clear spectral lines (peak bin and its two neighbours, weighted by sharpness)
    chromaRaw.fill(0);
    chromaH.fill(0);
    for (let k = cLoBin; k <= cHiBin; k++) {
      const m = hm[k];
      totPow += m * m;
      if (m < 0.0008 || m <= hm[k - 1] || m < hm[k + 1]) continue;
      const a = Math.max(0, k - 8);
      const b = Math.min(CB, k + 9);
      const prom = m / ((cum[b] - cum[a]) / (b - a) + 1e-12);
      // character tonal weight: how far the peak stands above the bins two steps away on both sides (a clean
      // line has a Hann main lobe 4 bins wide, so it towers over them; noise and dense hash do not). Unlike the
      // +-8 bin prominence this still works for a low drone whose partials are only ~5 bins apart.
      const wt = Math.min(1, (m / (Math.max(hm[k - 2], hm[k + 2]) + 1e-12) - 1.5) / 2);
      if (prom < 1.7 && wt <= 0) continue;
      // parabolic interpolation on log magnitudes gives the true frequency
      const la = Math.log(hm[k - 1] + 1e-12);
      const lb = Math.log(m + 1e-12);
      const lc = Math.log(hm[k + 1] + 1e-12);
      const den = la - 2 * lb + lc;
      const delta = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (la - lc)) / den)) : 0;
      const f = (k + delta) * cBinHz;
      const midi = 69 + 12 * Math.log2(f / 440);
      const pc = (((Math.round(midi) % 12) + 12) % 12);
      if (wt > 0) {
        tonPow += wt * (hm[k - 1] * hm[k - 1] + m * m + hm[k + 1] * hm[k + 1]);
        chromaH[pc] += wt * m * m;
      }
      if (prom < 1.7) continue;
      if (prom > maxProm) maxProm = prom;
      // weak peaks (noise-like prominence) are faded out, clear tonal peaks count fully
      const w = m * Math.min(1, (prom - 1.7) / 4);
      chromaRaw[pc] += w;
      if (np < PK_MAX) { pkF[np] = f; pkM[np] = m; np++; }
      shareTot += m;
      if (f >= 1000 && f <= 3500) shareForm += m;
    }
    // a clear tonal peak somewhere (close chord tones raise each other's neighbourhood, so ~2.5 rather than 4)
    if (maxProm >= 2.5) {
      let mx = 0;
      for (let i = 0; i < 12; i++) if (chromaRaw[i] > mx) mx = chromaRaw[i];
      for (let i = 0; i < 12; i++) {
        const v = Math.pow(chromaRaw[i] / mx, 1.25);
        noteTarget[i] = v < 0.22 ? 0 : v;
      }
    } else noteTarget.fill(0);

    const share = totPow > 1e-9 ? clamp01(tonPow / totPow) : 0;
    tonSm += kTon * (share - tonSm);
    chr.tonality = clamp01((tonSm - TON_LO) / (TON_HI - TON_LO));
    for (let i = 0; i < 12; i++) hcAcc[i] += chromaH[i];

    voiceFrame(np, shareTot, shareForm);
  }

  // Voice likelihood: harmonic-comb f0 candidate, then how much that pitch moves (vibrato and
  // glides are human; flat pitch is an instrument), plus formant-band share. Best effort.
  // Pass 0 is the original heuristic behind state.voice (6 harmonics, 8 continuous pitch steps). Pass 1 feeds
  // character.vocal: a low rapped voice spreads over more harmonics (10) and a syllable lasts only ~3 frames, so
  // it needs 3 steps and leans on the pitch movement.
  function voiceFrame(np, shareTot, shareForm) {
    voiceTarget = voicePass(0, 6, 8, 0.025, 0.1, 0.7, 0.2, 0.1, np, shareTot, shareForm);
    vocalTarget = voicePass(1, 10, 3, 0.06, 0.12, 0.9, 0.05, 0.05, np, shareTot, shareForm);
  }

  function voicePass(pass, nh, minSteps, vibLo, vibSpan, wVib, wForm, wHarm, np, shareTot, shareForm) {
    let bestS = 0;
    let bestI = -1;
    for (let p = 0; p < np; p++) {
      const f0 = pkF[p];
      if (f0 < 100 || f0 > 1000) continue;
      let s = 0;
      for (let h = 1; h <= nh; h++) {
        let mm = 0;
        for (let q = 0; q < np; q++) {
          if (Math.abs(pkF[q] / (h * f0) - 1) < 0.03 && pkM[q] > mm) mm = pkM[q];
        }
        s += mm / Math.sqrt(h);
      }
      if (s > bestS) { bestS = s; bestI = p; }
    }
    if (bestI < 0 || shareTot <= 0) { pitchNs[pass] = 0; return 0; }
    // refine f0 from the matched harmonics (higher harmonics give finer pitch resolution)
    const f0c = pkF[bestI];
    let fs = 0;
    let ws = 0;
    let explained = 0;
    for (let h = 1; h <= nh; h++) {
      let mm = 0;
      let ff = 0;
      for (let q = 0; q < np; q++) {
        if (Math.abs(pkF[q] / (h * f0c) - 1) < 0.03 && pkM[q] > mm) { mm = pkM[q]; ff = pkF[q]; }
      }
      if (mm > 0) { fs += (ff / h) * mm; ws += mm; explained += mm; }
    }
    const f0 = fs / ws;
    const harmonicity = clamp01(explained / shareTot);
    if (harmonicity < 0.3) { pitchNs[pass] = 0; return 0; }

    const st = 12 * Math.log2(f0 / 55);
    // shift history and append
    const o = pass * 24;
    for (let i = 0; i < 23; i++) pitchHists[o + i] = pitchHists[o + i + 1];
    pitchHists[o + 23] = st;
    const pn = Math.min(24, pitchNs[pass] + 1);
    pitchNs[pass] = pn;
    // movement: mean absolute semitone step among continuous steps, over the valid history
    let mv = 0;
    let cnt = 0;
    for (let i = 24 - pn + 1; i < 24; i++) {
      const d = Math.abs(pitchHists[o + i] - pitchHists[o + i - 1]);
      if (d < 1.5) { mv += d; cnt++; }
    }
    let vib = 0;
    if (cnt >= minSteps) vib = clamp01((mv / cnt - vibLo) / vibSpan);
    const form = clamp01((shareForm / shareTot - 0.08) / 0.25);
    return clamp01(clamp01(harmonicity / 0.4) * (wVib * vib + wForm * form + wHarm * harmonicity));
  }

  // Harmony per 0.5 s block: effective number of simultaneously strong pitch classes (exp of the chroma
  // entropy) and the cosine distance to the previous block's chroma (chord change), both smoothed over
  // ~3-4 s and gated by tonality (noise has no pitch classes, however flat its chroma looks).
  function harmonyBlock(nb) {
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += hcAcc[i];
    let neff = 0;
    let dist = 0;
    if (sum > 1e-9) {
      // number of pitch classes standing together: full count from 30% of the strongest, none below 10%
      let pmax = 0;
      for (let i = 0; i < 12; i++) if (hcAcc[i] > pmax) pmax = hcAcc[i];
      neff = 0;
      for (let i = 0; i < 12; i++) neff += clamp01((hcAcc[i] / pmax - 0.1) / 0.2);
      if (hcPrevOk) {
        let dot = 0, na = 0, nb2 = 0;
        for (let i = 0; i < 12; i++) {
          const a = Math.sqrt(hcAcc[i]);
          const b = Math.sqrt(hcPrev[i]);
          dot += a * b;
          na += a * a;
          nb2 += b * b;
        }
        dist = 1 - dot / (Math.sqrt(na * nb2) + 1e-12);
      }
      for (let i = 0; i < 12; i++) hcPrev[i] = hcAcc[i];
      hcPrevOk = true;
    } else hcPrevOk = false;
    const kk = Math.max(kHarm, 1 / nb);
    neffSm += kk * (neff - neffSm);
    hchgSm += kk * (dist - hchgSm);
    hcAcc.fill(0);
    const ent = clamp01((neffSm - NEFF_LO) / (NEFF_HI - NEFF_LO));
    const chg = clamp01(hchgSm / HCHG_FULL);
    chr.harmony = clamp01(chr.tonality / 0.3) * (0.5 * ent + 0.5 * chg);
  }

  // =============================================================================================
  // Structure: sections, tension, drops
  // =============================================================================================
  function structureBlock(now) {
    const inv = 1 / accN;
    const o = (blockIdx % FH_N) * NF;
    feat[o] = acc[0] * inv;
    feat[o + 1] = acc[1] * inv;
    feat[o + 2] = accTot > 1e-12 ? accPerc / accTot : 0;
    feat[o + 3] = accTot > 1e-12 ? accBass / accTot : 0;
    const secs = (accN * HOP) / sr;
    // onset density from summed flux: counting discrete hits per block quantises (0/1/2) and
    // makes the features jitter with where the beat falls against the block edge
    feat[o + 4] = clamp01(Math.log2(1 + blockFlux / secs / 100) / 4);
    const dens = blockHits / secs;
    feat[o + 5] = acc[5] * inv;
    for (let i = 0; i < 12; i++) feat[o + 6 + i] = acc[6 + i] * inv;
    featT[blockIdx % FH_N] = now;
    slowDens += 0.25 * (dens - slowDens); // ~2 s smoothing at 2 blocks/s
    acc.fill(0);
    accN = 0;
    accPerc = 0;
    accBass = 0;
    accTot = 0;
    blockHits = 0;
    blockFlux = 0;
    blockIdx++;

    const at = (idx, d) => feat[(((idx % FH_N) + FH_N) % FH_N) * NF + d];
    const nb = blockIdx; // number of blocks so far
    const last = nb - 1;

    // --- character: how far the feature vector moved this block, and the harmony of the block ---
    if (bN > 0) {
      let d2 = 0;
      for (let d = 0; d < 4; d++) {
        const v = bAcc[d] / bN;
        if (bPrevOk) {
          const df = (v - bPrev[d]) / CHG_SCALE[d];
          d2 += df * df;
        }
        bPrev[d] = v;
        bAcc[d] = 0;
      }
      bN = 0;
      if (bPrevOk) chgSm += Math.max(kChg, 1 / nb) * (Math.sqrt(d2) - chgSm);
      bPrevOk = true;
    }
    chr.change = clamp01(chgSm / CHG_FULL);
    harmonyBlock(nb);

    // --- novelty: distance between the mean of the last 2 s and the preceding 4 s ---
    if (nb >= 12) {
      let s2 = 0;
      for (let d = 0; d < NF; d++) {
        let a = 0;
        let b = 0;
        for (let i = 0; i < 4; i++) a += at(last - i, d);
        for (let i = 4; i < 12; i++) b += at(last - i, d);
        const diff = (a / 4 - b / 8) * FW[d];
        s2 += diff * diff;
      }
      const nov = Math.sqrt(s2);
      state.structure.novelty = nov;
      novHist[last % FH_N] = nov;
      // lowest novelty of the last 3 s (blocks before this one): a real change is a *rise* from
      // there, while the plateau left by the previous section is not
      let minI = last - 1;
      for (let i = last - 6; i < last; i++) {
        if (i >= 11 && novHist[i % FH_N] <= novHist[minI % FH_N]) minI = i;
      }
      const rise = nov - novHist[minI % FH_N];
      const sd = Math.sqrt(novVar);
      const thr = novMean + 2.2 * Math.max(sd, 0.015);
      const sinceSec = now - lastSectionT;
      let boundaryT = now;

      // drop test: loudness and bass jump up after tension was high
      let loudUp = 0;
      let bassUp = 0;
      for (let i = 0; i < 4; i++) {
        loudUp += at(last - i, 0) - at(last - 4 - i, 0);
        bassUp += at(last - i, 5) - at(last - 4 - i, 5);
      }
      loudUp /= 4;
      bassUp /= 4;
      const dropLike = tPeak >= 0.3 && loudUp > 0.03 && bassUp > 0.1;

      if (novN >= 8 && nov > thr && nov > 0.08 && rise >= 0.1 && (sinceSec > 6 || (dropLike && sinceSec > 3))) {
        // Detection trails the change by up to a second or two (the 2 s window has to fill), so
        // locate it: between the novelty minimum and now, the block step with the largest
        // before/after difference.
        let bestD = -1;
        let bestI = last;
        for (let i = Math.max(minI, last - 2); i <= last; i++) {
          if (i - 2 < 0) continue;
          let d2 = 0;
          for (let d = 0; d < NF; d++) {
            const a = 0.5 * (at(i, d) + at(Math.min(i + 1, last), d));
            const b = 0.5 * (at(i - 1, d) + at(i - 2, d));
            const df = (a - b) * FW[d];
            d2 += df * df;
          }
          if (d2 > bestD) { bestD = d2; bestI = i; }
        }
        boundaryT = featT[bestI % FH_N] - BLOCK_HOPS * dt; // start of that block
        lastSectionT = now;
        state.structure.section++;
        events.push({ type: 'section', time: boundaryT, strength: clamp01(nov / (thr + 1e-9) - 0.5) });
        if (dropLike) {
          events.push({ type: 'drop', time: boundaryT, strength: clamp01(0.5 + loudUp * 4) });
          tension = 0;
          tPeak = 0;
          resetIdx = nb;
          buildArmed = true;
        }
      }
      // Running stats see novelty clipped at the threshold. A section change keeps novelty high for
      // ~6 s (the 4 s reference window still straddles it); unclipped, that plateau would inflate
      // the baseline and hide the next change. Clipped, the stats still adapt to a busier song.
      const clipped = Math.min(nov, thr);
      const a = Math.max(1 / 40, 1 / (novN + 1));
      const dlt = clipped - novMean;
      novMean += a * dlt;
      novVar = (1 - a) * (novVar + a * dlt * dlt);
      novN++;
    }

    // --- tension: clipped trend (sum of per-block steps, each limited) over ~8 s ---
    // Clipping makes a step change count as one block of rise, a ramp as many.
    const w0 = Math.max(last - 16, resetIdx);
    const trend = (d, cap) => {
      let s = 0;
      for (let i = w0 + 1; i <= last; i++) {
        let df = at(i, d) - at(i - 1, d);
        df = df > cap ? cap : df < -cap ? -cap : df;
        s += df;
      }
      return s;
    };
    const tL = Math.max(0, trend(0, 0.03));
    const tC = Math.max(0, trend(1, 0.03));
    const tD = Math.max(0, trend(4, 0.04));
    const target = clamp01(4.5 * (0.8 * tL + 0.6 * tC + 0.35 * tD));
    if (target > tension) tension += 0.5 * (target - tension);
    else tension *= 0.78;
    tPeak = Math.max(tension, tPeak * 0.93);
    if (buildArmed && tension >= 0.5) {
      buildArmed = false;
      events.push({ type: 'build', time: now, strength: tension });
    } else if (!buildArmed && tension < 0.25) buildArmed = true;
    state.structure.tension = tension;
  }

  // =============================================================================================
  // Public API
  // =============================================================================================
  return {
    state,
    get total() { return total; },

    push(samples) {
      const n = samples.length;
      let w = total & ringMask;
      for (let i = 0; i < n; i++) {
        ring[w] = samples[i];
        w = (w + 1) & ringMask;
      }
      total += n;
    },

    analyseUpTo(index) {
      if (index > total) index = total;
      // more than 1 s of backlog: skip ahead rather than burn CPU catching up
      if (index - pos > sr) {
        pos = index;
        warm = 3;
      }
      // never read samples the ring has already overwritten
      const oldest = total - ringSize + CWIN;
      if (pos < oldest) { pos = oldest; warm = 3; }
      while (pos <= index) {
        hop();
        pos += HOP;
      }
    },

    drain() {
      const out = events;
      events = [];
      return out;
    },
  };
}
