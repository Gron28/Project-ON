// being/mind.mjs - the being's inner life. Pure module (no DOM), stepped once per rendered frame.
//
// Every state variable is a published mechanism (see lab/NOTEBOOK.md section 2). Nothing here maps a sound feature to a
// shape: the body reads these states, and these states are dynamics driven by the ear.
//
//   startle      brainstem reflex with habituation, sensitization and prepulse inhibition (Davis 1982; Groves & Thompson
//                1970; Blumenthal 2005). It flinches at the first big hit and learns to ignore the 50th.
//   resonance    a bank of critical Hopf oscillators 0.5-8 Hz driven by the ear's onsets (Large et al. 2010, 2015) and a
//                motor oscillator with its own spontaneous tempo f0 that locks to the felt pulse and drifts back home in
//                silence (ASHLE, Roman et al. 2023). Its phase is the body's pulse, its lock is "being in the groove".
//   expectation  a 16-slot onset model on the being's own pulse grid (PPM-like, with forgetting): surprise (information
//                content) and uncertainty (entropy) per slot (Pearce 2018; Harrison et al. 2020).
//   value        Cheung et al. 2019 pleasure surface (surprise x uncertainty), groove inverted-U on syncopation around its own
//                preferred level s* (Witek et al. 2014), learning progress as curiosity (Oudeyer 2007), roughness as aversion
//                (Arnal 2015). Dopamine: phasic = value prediction error (Schultz 1997), anticipatory = build-up x value
//                (Salimpoor 2011), tonic = slow average (Niv 2007).
//   affect       arousal and valence as Ornstein-Uhlenbeck processes around personal home bases (Kuppens 2010), valence also
//                fed by -dF/dt of smoothed surprise (Joffily & Coricelli 2013); mood integrates prediction errors (Eldar 2016);
//                energy drains with dancing and recovers in calm (Keramati & Gutkin 2014); boredom when nothing is left to learn.
//   contagion    the music's own perceived arousal and valence (regressors trained on human ratings: emoMusic, DEAM) set
//                where arousal and valence settle: the being catches the music's expression (emotional contagion,
//                Juslin & Vastfjall 2008, BRECVEMA). Loudness alone does not: mastered music is loud whatever it expresses.
//                Without that reading (models not loaded) a bottom-up estimate stands in, scaled so it cannot saturate.
//
// Decisions it makes (events): 'startle' (amount), 'reform' (bored: grows a new form), 'chill', 'recoil' (disappointment).

const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const clamp01 = (x) => clamp(x, 0, 1);

export function mulberry32(a) {
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** The innate seed: who this being is before it hears anything. */
export function traitsFor(seed) {
  const r = mulberry32(seed);
  return {
    seed,
    f0: 1.6 + 0.8 * r(),            // spontaneous tempo, Hz (96-144 bpm)
    aHome: 0.2 + 0.2 * r(),         // arousal home base
    vHome: -0.1 + 0.3 * r(),        // valence home base
    sStar: 0.25 + 0.2 * r(),        // preferred syncopation (0..1 scale of the index below)
    gDA: 0.6 + 0.7 * r(),           // how much music moves it (dopamine gain)
    looseness: 0.5 + r(),           // how easily it falls out of the groove
    hue: r(),                       // its own colour, from which valence bends warm or cold
    restless: 0.5 + r(),            // how quickly boredom builds
  };
}

export function createMind(traits, { earUnits = 28, earCF = null } = {}) {
  const T = traits;
  // ---- resonance bank: critical oscillators, 12 per octave, 0.5-8 Hz ----------------------------------
  const NR = 49, RF = Float64Array.from({ length: NR }, (_, i) => 0.5 * 2 ** (i / 12));
  const rr = new Float64Array(NR), ri = new Float64Array(NR), ramp = new Float64Array(NR);
  // motor oscillator (personal tempo)
  let phM = 0, fM = T.f0, motorCycles = 0;
  // ---- startle -------------------------------------------------------------------------------------------
  let onsetLevel = 0.05, H = 1, sens = 0, lastOnsetT = -1e9, lastPrepulseT = -1e9, lastStartleT = -1e9;
  let peakExp = 0.4, lastHitT = -1e9, prevO = 0, rising = false;   // expected size of a hit, learned from the hits themselves
  // ---- expectation on a 16-slot grid ------------------------------------------------------------------------
  const P = new Float64Array(16).fill(0.3);        // p(onset in slot)
  let slotIdx = -1, slotOnset = 0, IC = 0, Hent = 1, icFast = 1, icSlow = 1, F = 1, Fprev = 1, dF = 0;
  const syncW = [0, 3, 2, 3, 1, 3, 2, 3, 1, 3, 2, 3, 1, 3, 2, 3];   // metric depth: downbeat 0 ... sixteenths 3 (Witek-style)
  let syncNum = 0, syncDen = 1e-6, sync = 0.3;
  // z-scoring of surprise and uncertainty over ~1 min
  let sM = 1, sV = 0.25, uM = 0.8, uV = 0.05;
  // ---- value, dopamine, affect --------------------------------------------------------------------------
  let V = 0, daPh = 0, daAnt = 0, daTon = 0, h = 0;
  let A = T.aHome, Val = T.vHome, mood = 0, energy = 0.8, bored = 0, confused = 0;
  let mA = 0.3, mV = 0, hasM = 0;
  let heard = 0, quietFor = 0;                        // seconds of sound since the last silence: a build-up needs a context (Huron 2006, ITPRA)                     // contagion: the music's perceived arousal and valence, and trust in it
  let lock = 0, groove = 0, lastReform = 0, lastChill = -1e9, buildSeen = -1e9, trackerPull = 0, beatError = 0;
  let time = 0;
  let ringT = 0;
  const pitch = new Float32Array(12);
  // ear unit -> pitch class (nearest semitone of its centre frequency, A = 440)
  const pcOf = earCF ? Array.from(earCF, (f) => ((Math.round(12 * Math.log2(f / 440)) % 12) + 12 + 9) % 12) : null;
  const events = [];
  const life = { born: Date.now(), listenSeconds: 0, grooveSeconds: 0, chills: 0, reforms: 0 };
  const noise = mulberry32((T.seed ^ 0x5bd1e995) >>> 0);
  const gauss = () => { let u = 0; while (!u) u = noise(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * noise()); };

  const state = {
    traits: T, events, pitch,
    get arousal() { return A; }, get valence() { return Val; }, get mood() { return mood; }, get energy() { return energy; },
    get bored() { return bored; }, get confused() { return confused; }, get habituation() { return H; },
    get lock() { return lock; }, get groove() { return groove; }, get sync() { return sync; }, get beatError() { return beatError; },
    get surprise() { return F; }, get dF() { return dF; }, get IC() { return IC; }, get entropy() { return Hent; },
    get musicArousal() { return mA; }, get musicValence() { return mV; }, get contagion() { return hasM; },
    get daPhasic() { return daPh; }, get daAnticipation() { return daAnt; }, get daTonic() { return daTon; },
    get pulseHz() { return fM; }, get pulsePhase() { return phM / TAU; }, get pulseCount() { return motorCycles; }, get pulsePhaseRaw() { return phM / TAU; }, get pulseCountRaw() { return motorCycles; },
    get startle() { return Math.max(0, 1 - (time - lastStartleT) / 0.25); },
    resonance: ramp, resonanceHz: RF,
    feeling() {   // a word for the HUD, from the state (GEMS-like regions, Zentner 2008)
      if (state.startle > 0.5) return 'startled';
      if (daAnt > 0.5) return 'anticipating';
      if (time - lastChill < 3) return 'chills';
      if (bored > 0.6) return 'bored';
      if (confused > 0.6) return 'confused';
      if (A < 0.2 && Val > 0) return 'peaceful';
      if (A < 0.15) return 'dormant';
      if (groove > 0.5 && Val > 0.1) return 'in the groove';
      if (A > 0.7 && Val > 0.1) return 'elated';
      if (A > 0.6 && Val < -0.2) return 'tense';
      if (A < 0.35 && Val < -0.2) return 'solemn';   // calm and dark: GEMS 'sadness' / 'transcendence', not anxiety
      if (Val < -0.3) return 'uneasy';
      return lock > 0.5 ? 'entrained' : 'listening';
    },
  };

  /**
   * @param {number} dt seconds
   * @param {{amp:Float32Array, mu:Float32Array, onset:number, rough:number, sub:number, level:number, hum:number}|null} ear latest ear frame
   * @param {number} onsetPeak largest ear onset since the last frame
   * @param {{tension:number, musicA?:number, musicV?:number}} senses from the analyzer (build-up tension) and the
   *   music's perceived arousal (0..1) and valence (-1..1) from the mood model (undefined when it has nothing fresh), optional
   */
  state.step = (dt, ear, onsetPeak, senses = {}) => {
    events.length = 0;
    dt = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0;            // the render clock can hand back 0 or a negative step
    if (!Number.isFinite(onsetPeak)) onsetPeak = 0;
    time += dt;
    // one bad number from outside (an analyzer value, an ear frame) must not poison a state that integrates it forever
    const fin = (x, d = 0) => (Number.isFinite(x) ? x : d);
    const level = ear ? fin(ear.level) : 0, rough = ear ? clamp01(fin(ear.rough) * 2.5) : 0, sub = ear ? fin(ear.sub) : 0;
    if (senses.intensity !== undefined && !Number.isFinite(senses.intensity)) senses = { ...senses, intensity: undefined };
    // loudness: part absolute (the ear's level), part within-song (the analyzer's intensity, if given), so a quiet verse is calm
    const absLoud = clamp01(Math.log10(1 + level * 30) / Math.log10(31));
    const loud = senses.intensity === undefined ? absLoud : 0.35 * absLoud + 0.65 * clamp01(senses.intensity);

    // ---- pitch: the ear's own tonotopy folded onto 12 pitch classes ----------------------------------------
    if (ear && pcOf) {
      const acc = new Float32Array(12); let mx = 1e-9;
      for (let k = 0; k < ear.amp.length; k++) { const a = Math.max(0, fin(ear.amp[k]) - 0.016); acc[pcOf[k]] += a; }
      for (let i = 0; i < 12; i++) if (acc[i] > mx) mx = acc[i];
      for (let i = 0; i < 12; i++) pitch[i] += 0.25 * (acc[i] / mx * clamp01(loud * 3) - pitch[i]);
    }

    // ---- startle (brainstem) ---------------------------------------------------------------------------------
    const o = onsetPeak;
    onsetLevel += (1 - Math.exp(-dt / 2)) * (o - onsetLevel);
    H += (1 - H) * (dt / 30);                                       // habituation recovers in ~30 s
    sens += -sens * dt / 10 + 0.1 * A * dt;                        // sensitization follows arousal
    peakExp += (0.4 - peakExp) * (dt / 10);                         // without hits, the expectation of a hit fades back
    // a hit = a local peak of the onset signal; it startles only when it is much bigger than the hits it has learned to expect
    const isPeak = rising && o < prevO && prevO > 0.25 && time - lastHitT > 0.12;
    rising = o > prevO || (rising && o === prevO);
    if (isPeak) {
      const hit = prevO; lastHitT = time;
      const sincePre = time - lastPrepulseT;
      const ppi = sincePre > 0.03 && sincePre < 0.5 ? 0.5 * Math.exp(-((sincePre - 0.1) ** 2) / 0.02) : 0;   // prepulse inhibition
      const R = clamp01((hit / (1.6 * peakExp + 0.2) - 1) * 1.2) * H * (1 + sens) * (1 - ppi);
      if (R > 0.15) { lastStartleT = time; H *= 0.7; events.push({ type: 'startle', amount: clamp01(R) }); A = clamp01(A + 0.25 * R); }
      peakExp += 0.2 * (hit - peakExp);
      lastPrepulseT = time;
    }
    prevO = o;
    if (o > 0.25) lastOnsetT = time;

    // ---- resonance: critical bank driven by onset strength (substeps of ~4 ms) ---------------------------
    const x = Math.min(0.6, o * 0.5);
    const sub_n = Math.max(1, Math.ceil(dt / 0.004)), h_ = dt / sub_n;
    for (let s = 0; s < sub_n; s++) {
      for (let i = 0; i < NR; i++) {
        const f = RF[i], c = Math.cos(TAU * f * h_), sn = Math.sin(TAU * f * h_);
        let nr = rr[i] * c - ri[i] * sn + f * h_ * x * 4, ni = rr[i] * sn + ri[i] * c;
        const d = 1 / (1 + f * h_ * (nr * nr + ni * ni) * 2);   // critical: alpha 0, beta1 -2 (semi-implicit)
        rr[i] = nr * d; ri[i] = ni * d;
      }
    }
    let best = -1, bestS = 0, sum = 0, n = 0;
    for (let i = 0; i < NR; i++) {
      const a = Math.hypot(rr[i], ri[i]); ramp[i] = a;
      if (RF[i] >= 0.8 && RF[i] <= 3.2) {
        const prior = Math.exp(-((Math.log2(RF[i] / T.f0)) ** 2) / (2 * 0.6 * 0.6));   // its own tempo is easier to feel
        const s = a * (0.5 + prior); sum += a; n++;
        if (s > bestS) { bestS = s; best = i; }
      }
    }
    const aS = best >= 0 ? ramp[best] : 0, mean = n ? sum / n : 1e-6;
    const contrast = aS / (mean + 1e-4);
    lock += (1 - Math.exp(-dt / 0.8)) * (Math.max(clamp01((contrast - 1) / (1.5 * T.looseness)) * clamp01(aS * 6), 0.9 * trackerPull) - lock);
    // motor oscillator: phase-locks to the felt pulse oscillator, frequency drifts back to f0 without input
    const phS = best >= 0 ? Math.atan2(ri[best], rr[best]) : phM;
    const fS = best >= 0 ? RF[best] : T.f0;
    // fold the felt pulse into the motor's octave nearest to f0
    let ratio = 1; while (fS * ratio < T.f0 / 1.42) ratio *= 2; while (fS * ratio > T.f0 * 1.42) ratio /= 2;
    // rhythm accuracy (a listener's dial): 0 = its own feel (the resonance it feels, pulled to its own tempo),
    // 1 = on the beat (the analyzer's beat tracker pulls tempo and phase into lock, like a musician following a drummer)
    const L = clamp01(Number.isFinite(senses.rhythm) ? senses.rhythm : 0), own = 1 - L, bt = senses.beat;
    const err = Math.sin(phS * ratio - phM);
    phM += TAU * fM * dt + 3 * lock * err * dt * (0.25 + 0.75 * own);
    fM += (0.6 * lock * (fS * ratio - fM) * (0.25 + 0.75 * own) - 0.08 * (fM - T.f0) * own) * dt;
    trackerPull = 0;
    if (bt && L > 0 && bt.confidence > 0.15 && bt.bpm > 40 && bt.bpm < 300 && Number.isFinite(bt.phase)) {   // a tracker value outside this is garbage, not a tempo
      const g = L * Math.min(1, bt.confidence * 1.6);
      let e = bt.phase * TAU - phM; e -= TAU * Math.round(e / TAU);
      beatError += (1 - Math.exp(-dt / 1)) * (Math.abs(e) / Math.PI - beatError);
      fM += (bt.bpm / 60 - fM) * (1 - Math.exp(-dt * 8 * g));
      phM += e * (1 - Math.exp(-dt * 14 * g));
      trackerPull = g;
    }
    while (phM >= TAU) { phM -= TAU; motorCycles++; }
    while (phM < 0) phM += TAU;

    // ---- expectation on the being's own grid (16 slots = 4 felt beats) ----------------------------------------
    slotOnset = Math.max(slotOnset, o);
    const slot = ((motorCycles % 4) * 4 + Math.floor((phM / TAU) * 4)) % 16;
    if (slot !== slotIdx) {
      if (slotIdx >= 0 && lock > 0.15) {
        const hit = slotOnset > 0.25 ? 1 : 0, p = clamp(P[slotIdx], 0.03, 0.97);
        IC = -Math.log2(hit ? p : 1 - p);
        Hent = -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
        P[slotIdx] += 0.08 * (hit - P[slotIdx]);                    // forgetting memory (~12 bars)
        icFast += 0.08 * (IC - icFast); icSlow += 0.015 * (IC - icSlow);
        sM += 0.01 * (IC - sM); sV += 0.01 * ((IC - sM) ** 2 - sV);
        uM += 0.01 * (Hent - uM); uV += 0.01 * ((Hent - uM) ** 2 - uV);
        if (hit) { syncNum += syncW[slotIdx] / 3 * slotOnset; syncDen += slotOnset; }
        // hedonic input per slot: Cheung 2019 surface (z-scored), syncopation sweet spot, curiosity, roughness
        const Sz = (IC - sM) / Math.sqrt(sV + 1e-3), Uz = (Hent - uM) / Math.sqrt(uV + 1e-3);
        const cheung = -0.143 * Uz - 0.327 * Sz - 0.124 * Uz * Sz;
        const lp = icSlow - icFast;                                  // learning progress: surprise falling = learning
        // learning the song is itself rewarding: its skin map's error falling (compression progress; Schmidhuber 2010)
        const mapProgress = Number.isFinite(senses.progress) ? Math.max(0, senses.progress) * 25 : 0;
        h = T.gDA * (0.6 * cheung + 1.2 * groove + 2.0 * Math.max(0, lp) + mapProgress) - 0.8 * rough;
        const delta = h - V;                                         // reward prediction error (TD(0), value as slow average)
        V += 0.05 * delta;
        daPh = clamp(delta, -1.5, 1.5);
        if (daPh < -0.9 && time - lastChill > 5) events.push({ type: 'recoil', amount: -daPh });
      }
      slotIdx = slot; slotOnset = 0;
    }
    sync += (1 - Math.exp(-dt / 6)) * (syncNum / syncDen - sync); syncNum *= Math.exp(-dt / 8); syncDen *= Math.exp(-dt / 8);
    groove += (1 - Math.exp(-dt / 1.5)) * (lock * Math.exp(-((sync - T.sStar) ** 2) / (2 * 0.15 * 0.15)) * clamp01(loud * 2) - groove);
    daPh *= Math.exp(-dt / 0.4);
    F += (1 - Math.exp(-dt / 2)) * (icFast - F);
    const dFi = (F - Fprev) / Math.max(dt, 1e-3); Fprev = F; dF += (1 - Math.exp(-dt / 1)) * (dFi - dF);
    // a song's opening rise is not a build-up: anticipation needs ~6-12 s of the music to anticipate from
    if (level > 0.01) { heard += dt; quietFor = 0; } else if ((quietFor += dt) > 2) heard = 0;
    const tension = clamp01(senses.tension || 0) * clamp01((heard - 6) / 6);
    if (tension > 0.5) buildSeen = time;
    daAnt += (1 - Math.exp(-dt / 0.6)) * (tension * (0.5 + Math.max(0, V)) * T.gDA - daAnt);
    daTon += (1 - Math.exp(-dt / 30)) * (h - daTon);

    // ---- affect -----------------------------------------------------------------------------------------------
    const density = clamp01(onsetLevel * 2);
    const novelty = Number.isFinite(senses.familiarity) ? 1 - senses.familiarity : 0;   // sounds its memory cannot place
    // contagion: the model reads a 3.2 s window every 1.5 s; its values are eased (~2.5 s), trusted while they keep coming
    if (Number.isFinite(senses.musicA) && Number.isFinite(senses.musicV)) {
      const k = 1 - Math.exp(-dt / 2.5);
      mA += k * (clamp01(senses.musicA) - mA); mV += k * (clamp(senses.musicV, -1, 1) - mV); hasM = Math.min(1, hasM + dt / 3);
    } else hasM = Math.max(0, hasM - dt / 10);
    // the music's character sets the level; the moment (within-song intensity, density) moves it inside that range
    const aMusic = 0.06 + 0.82 * mA * (0.6 + 0.4 * loud) + 0.12 * density * mA;
    const aBottomUp = 0.55 * clamp01(T.aHome * (0.5 + 0.5 * energy) + 0.75 * loud + 0.25 * density + 0.25 * rough + 0.15 * clamp01(sub * 8));
    const aTarget = clamp01(hasM * aMusic + (1 - hasM) * aBottomUp + 0.2 * daAnt + 0.12 * rough * mA + 0.08 * novelty * clamp01(loud * 3) + 0.05 * (T.aHome - 0.3));
    A += (1 - Math.exp(-dt / 1.6)) * (aTarget - A) + 0.02 * Math.sqrt(dt) * gauss();
    A = clamp01(A);
    // valence: the music's expression first, then its own reward, groove and surprise (no longer all pushing upward)
    const vTarget = clamp(0.4 * T.vHome + 0.75 * hasM * mV + mood + 0.35 * daPh + 0.15 * groove - 0.2 * clamp(dF, -1, 1) - 0.5 * rough + 0.1 * daTon, -1, 1);
    Val += (1 - Math.exp(-dt / 3)) * (vTarget - Val) + 0.03 * Math.sqrt(dt) * gauss();
    Val = clamp(Val, -1, 1);
    mood += (dt / 180) * (Math.tanh(2 * daPh + daTon) - mood);
    energy = clamp01(energy + (-0.012 * groove * A + 0.006 * (1 - A)) * dt);
    const lpAbs = Math.abs(icSlow - icFast);
    const nothingToLearn = lpAbs < 0.03 && loud > 0.05;
    bored = clamp01(bored + dt * (nothingToLearn && F < 0.6 ? 0.02 * T.restless : -0.03) - dt * 0.05 * Math.max(0, daPh));
    confused = clamp01(confused + dt * (nothingToLearn && F > 1.2 ? 0.03 : -0.03));
    // a living system must never die of one bad number: anything non-finite goes back to its resting value
    if (!Number.isFinite(A)) A = T.aHome; if (!Number.isFinite(Val)) Val = T.vHome; if (!Number.isFinite(energy)) energy = 0.8;
    if (!Number.isFinite(heard)) heard = 0; if (!Number.isFinite(quietFor)) quietFor = 0;
    if (!Number.isFinite(mA) || !Number.isFinite(mV) || !Number.isFinite(hasM)) { mA = 0.3; mV = 0; hasM = 0; }
    if (!Number.isFinite(mood)) mood = 0; if (!Number.isFinite(dF)) dF = 0; if (!Number.isFinite(F)) F = 1; if (!Number.isFinite(daTon)) daTon = 0;
    // the integrators and the clock: each goes back to rest on its own, so one bad frame is forgotten instead of kept
    if (!Number.isFinite(lock)) lock = 0; if (!Number.isFinite(groove)) groove = 0; if (!Number.isFinite(bored)) bored = 0; if (!Number.isFinite(confused)) confused = 0;
    if (!Number.isFinite(daPh)) daPh = 0; if (!Number.isFinite(daAnt)) daAnt = 0; if (!Number.isFinite(V)) V = 0; if (!Number.isFinite(h)) h = 0;
    if (!Number.isFinite(sync)) sync = 0.3; if (!Number.isFinite(beatError)) beatError = 0; if (!Number.isFinite(Fprev)) Fprev = F;
    if (!Number.isFinite(IC)) IC = 0; if (!Number.isFinite(Hent)) Hent = 1; if (!Number.isFinite(icFast)) icFast = 1; if (!Number.isFinite(icSlow)) icSlow = 1;
    if (!Number.isFinite(sM) || !Number.isFinite(sV)) { sM = 1; sV = 0.25; } if (!Number.isFinite(uM) || !Number.isFinite(uV)) { uM = 0.8; uV = 0.05; }
    if (!Number.isFinite(syncNum) || !Number.isFinite(syncDen) || syncDen <= 0) { syncNum = 0; syncDen = 1e-6; }
    if (!Number.isFinite(onsetLevel)) onsetLevel = 0.05; if (!Number.isFinite(H)) H = 1; if (!Number.isFinite(sens)) sens = 0; if (!Number.isFinite(peakExp)) peakExp = 0.4;
    if (!Number.isFinite(fM) || fM < 0.2 || fM > 6) fM = clamp(Number.isFinite(fM) ? fM : T.f0, 0.2, 6);
    if (!Number.isFinite(phM)) phM = 0;
    for (let i = 0; i < NR; i++) if (!Number.isFinite(rr[i]) || !Number.isFinite(ri[i])) { rr[i] = 0; ri[i] = 0; }
    // ---- enculturation: music it grooves to slowly reshapes its own tempo and taste (Witek 2014 S6; Roman 2023) --
    if (groove > 0.5 && daPh > 0) {
      T.f0 += dt * 0.0015 * (fM - T.f0);                            // hours of a tempo pull its spontaneous tempo
      T.sStar += dt * 0.0008 * (sync - T.sStar);                     // enjoyed syncopation becomes the preferred level
      life.grooveSeconds += dt;
    }
    if (loud > 0.05) life.listenSeconds += dt;
    // ---- decisions --------------------------------------------------------------------------------------------
    if (bored > 0.7 && time - lastReform > 25) { lastReform = time; bored = 0.3; life.reforms++; events.push({ type: 'reform', why: 'bored' }); }
    if (daPh > 0.7 && A > 0.55 && time - buildSeen < 10 && time - lastChill > 30) { lastChill = time; life.chills++; events.push({ type: 'chill' }); }
    void ringT;
    return events;
  };

  /** what it carries from one session to the next: its (drifted) traits, its rhythmic expectations, its moods */
  state.serialize = () => ({ v: 1, traits: { ...T }, P: Array.from(P), mood, energy, V, life: { ...life }, savedAt: Date.now() });
  state.restore = (o) => {
    if (!o || o.v !== 1) return false;
    for (const k of ['f0', 'sStar']) if (Number.isFinite(o.traits?.[k])) T[k] = o.traits[k];
    if (Array.isArray(o.P) && o.P.length === 16) o.P.forEach((x, i) => { if (Number.isFinite(x)) P[i] = x; });
    if (Number.isFinite(o.mood)) mood = clamp(o.mood, -1, 1);
    // energy recovers while it was away (about 1 per 8 hours)
    if (Number.isFinite(o.energy)) energy = clamp01(o.energy + (Date.now() - (o.savedAt || Date.now())) / (8 * 3600e3));
    if (Number.isFinite(o.V)) V = o.V;
    if (o.life) Object.assign(life, o.life);
    return true;
  };
  state.life = life;
  /** a known song returns: the feeling it left comes back first (episodic memory; Juslin 2013) */
  state.recall = (feeling = 0, plays = 1) => {
    const f = clamp(feeling, -1, 1), strength = Math.min(1, 0.4 + 0.15 * plays);
    Val = clamp(Val + 0.6 * f * strength, -1, 1); mood = clamp(mood + 0.1 * f, -1, 1);
    daPh = clamp(0.4 + 0.8 * f, -1.5, 1.5) * strength; A = clamp01(A + 0.15 * strength);
    events.push({ type: 'recognize', feeling: f });
  };
  /** a known song's tempo comes back before the first beat: the motor starts at the remembered pulse (folded near f0) */
  state.prime = (hz) => {
    if (!Number.isFinite(hz) || hz < 0.3 || hz > 5) return false;
    let f = hz; while (f < T.f0 / 1.42) f *= 2; while (f > T.f0 * 1.42) f /= 2;
    fM = f; return true;
  };
  /** love / not-this from the listener: injected dopamine, like an optogenetic pulse */
  state.inject = (sign) => { if (sign > 0) { daPh = 1.2; V -= 0.2; mood += 0.05; } else { daPh = -1.2; bored = Math.min(1, bored + 0.5); } };
  return state;
}
