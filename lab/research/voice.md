# A voice for the being: research notes

Question: when the cursor rests on the creature, can it make sound, recreating its favourite sounds "from the memory of its senses"? The answer should follow biology and what the being actually stores, and it should sound good rather than like a gimmick.

Status: research only. Nothing is built. All code references were read on 2026-10-09 while other agents were editing the repository, so line numbers may drift.

## 0. What the being stores today (read from the code)

| Store | Where | What it holds | Can it be turned back into sound? |
|---|---|---|---|
| Song map `weights` | `memory.mjs` `createMap`, saved as b64 Float32 | 48x24 = 1152 prototypes, 32 dims each, learned from 100 ms ear frames (`memoryHear` in `index.html` averages 10 ear frames) | **Yes, as a timbre.** Each prototype is close to invertible (see 0.1). It has no time order inside it: one prototype is one steady 100 ms colour. |
| `meta.hits` | same | seconds of the song each unit stands for | This is a stationary distribution over units, so it tells you which sounds were frequent. It does not say which sounds were liked, and it has no transitions. |
| `meta.groove` | `timing.mjs serialize()` | kick/snare/hat p(hit) and strength on a 16-slot grid | **Yes, as rhythm.** It is a drum pattern you can sample. |
| `meta.bpm` | page, when `mind.lock > .4` | felt tempo | Yes, as the tempo of its voice. |
| `meta.char` | page, 14 analyzer descriptors (loudness ... tempo) | the song's absolute character | Indirectly: noisiness, tonality, roughness, brightness and bassWeight can set the carrier mix and spectral tilt. |
| `meta.feeling` | page, slow average of valence + 0.5 tonic DA | one scalar per song | This tells it which song is the favourite. It cannot tell which moment was liked. |
| `meta.matScore`, `meta.material` | page line ~1451 | dopamine- and valence-weighted time per material | This is the only store that ranks anything by liking, but it is about looks, not sounds. |
| `mind.serialize()` | `mind.mjs` | traits, P (personal tempo), mood, energy, V, life counters (chills) | It gives the voice's own character: f0 and personal tempo come from the traits. |
| Analyzer chroma | `analysis.mjs` `chromaRaw`/`hcAcc` | 12 pitch classes, internal only | Not exposed in `an.state` and not stored, so the voice cannot sing in the song's key yet. |

**Nothing stores which moments it loved.** Dopamine moments (`daPhasic` peaks, the `chill` event in `mind.mjs` ~l.259, the listener's love click via `mind.inject`) change state but leave no trace in the song memory. Nothing stores sequences either: the map knows the sounds but not their order.

### 0.1 Inverting `featureOf` (memory.mjs l.23)

The 32 dimensions are:
- `out[0..27]`: `a_k / (mx + 0.3)` with `a_k = log1p(amp_k / 0.015)`. This is the spectral shape relative to the loudest band, 4 bands per octave from 55 Hz to 5.9 kHz.
- `out[28]`: `mean(a) / 4`.
- `out[29]`: onset / 1.5.
- `out[30]`: roughness x 2.5 (30-150 Hz envelope fluctuation).
- `out[31]`: sub-bass envelope x 6.

The scale removed by the normalisation can be recovered: `mean(a) = (mx + 0.3) * mean(out[0..27])`, so `mx + 0.3 = 4 * out[28] / mean(out[0..27])`. From that, `a_k = out_k * (mx + 0.3)` and `amp_k = 0.015 * (exp(a_k) - 1)`. The only losses are clamping at 1 and SOM averaging. `amp_k` is the Hopf unit's response, which is compressed by about 1/3 power near mu = 0 (ear.mjs header). The input level in that band is therefore roughly proportional to `amp_k^3` until the ear's self-tuning (`mu`) saturates. Use this expansion if the voice should sound like what came in. Skip it if it should sound like what the being felt, which is already compressed and gentler. I recommend skipping it, or expanding only partly.

The other dimensions map to synthesis controls:
- onset sets attack sharpness and a noise transient.
- roughness sets amplitude modulation at 30-150 Hz. This is the same definition the ear uses (Arnal et al. 2015), so the being "hears" its own roughness again.
- sub sets a 40-60 Hz sine.

### 0.2 The CF lattice is a diminished-seventh stack

`EAR_CF = 55 * 2^(k/4)` puts the units 3 semitones apart: A, C, D#, F#, A... If the units hum at their own centre frequencies, the result is always a stacked diminished chord, which sounds eerie and alien. That works for a dream hum in silence, but it clashes with most songs. To sing along with music, the tonal carriers need retuning to the song's pitch classes (see 3.3).

## 1. Biology

### 1.1 Ears that emit sound
- Kemp (1978) found evoked otoacoustic emissions, sound coming back out of the ear canal after a click. Spontaneous emissions (SOAEs) are faint, stable tones that ears emit in silence (Kemp 1979; Zurek 1981). They occur in humans, lizards, birds and frogs. Bergevin et al. (2015) argue that their salient features are shared across tetrapods, which suggests a common generation mechanism.
- Insects show the same thing. Fly and mosquito antennae oscillate by themselves when the active process is unchecked (Goepfert & Robert 2003), and these are the same Hopf-like units that `ear.mjs` already cites.
- In the Hopf model (Camalet et al. 2000; Eguiluz et al. 2000; Hudspeth 2014), an oscillator self-tuned to slightly above the bifurcation (mu > 0) settles on a limit cycle with |z| = sqrt(mu/kappa). That limit cycle is the emission. Vilfan & Duke (2008) reproduce the lizard's SOAE spectra, including their frequency clustering, with a chain of coupled Hopf oscillators. Fruth, Jülicher & Lindner (2014) reproduce the population statistics of human SOAEs with a coupled active-oscillator model.
- The being already does this internally: in silence `mu` creeps to `MU_MAX = 0.04` and each unit hums at DELTA (`ear.mjs`). Its "voice" can therefore literally be its ear made audible. Two changes would make it sound alive rather than mechanical. First, a little coupling between neighbouring units, so emissions cluster and beat as in Vilfan & Duke. Second, per-being detuning of a few cents from the DNA seed, so every being's SOAE fingerprint differs, as human SOAEs differ from person to person.
- Evoked emissions add a second layer. Two loud tones into a cubic oscillator produce distortion products such as 2f1 - f2 (DPOAEs). A quiet halo of the ear's own distortion products while music plays is biologically exact, but it is a later refinement.

### 1.2 Songbirds: template, babble, practise, replay
- Template learning: a young bird memorises a tutor song (a sensory template, Marler 1970). Then it practises, comparing its own output to the template by auditory feedback. A bird deafened before practice never develops normal song (Konishi 1965). Reviews: Doupe & Kuhl (1999), and Brainard & Doupe (2000, 2002).
- Babbling: juvenile subsong is highly variable "babble" driven by a forebrain nucleus (LMAN) that injects variability (Aronov, Andalman & Fee 2008; Kao, Doupe & Brainard 2005). Reinforcement from auditory feedback then shapes it (Tumer & Brainard 2007). Tchernichovski et al. (2001) tracked the gradual convergence.
- Replay: in sleeping zebra finches, the song-premotor neurons (RA) replay the bursting patterns of daytime singing (Dave & Margoliash 2000). In the hippocampus, replay favours rewarded places, and reward increases reverse replay (Ambrose, Pfeiffer & Foster 2016). Mapped onto the being:
  - **its map = the template** (the sensory memory of songs);
  - **a random walk on the map = subsong / babble**, which sounds plausible because neighbouring map units are similar sounds (that is what a SOM is);
  - **replaying a stored loved moment = crystallised song, or sleep replay**;
  - **analysis-by-synthesis**: render a phrase, run it through its own `ear.mjs`, and compare `featureOf` with the target unit. This is template matching through its own ear. It can run offline in a worker, faster than real time, with no loopback involved.

### 1.3 Not hearing itself: corollary discharge
- The classic sources are von Holst & Mittelstaedt (1950) and Sperry (1950). Crapse & Sommer (2008) review corollary discharge across species.
- Crickets: a single corollary-discharge interneuron inhibits the auditory pathway exactly while the cricket sings, so it stays sensitive to others between chirps (Poulet & Hedwig 2006).
- Marmosets: auditory cortex is suppressed during the animal's own calls, yet it stays sensitive to perturbations of the feedback (Eliades & Wang 2008). Suppression is not deafness; the prediction is subtracted.
- Mice: motor cortex suppresses auditory cortex during movement-generated sounds (Schneider, Nelson & Mooney 2014).
- Bats contract their middle-ear muscles during each call, attenuating their own loud pulse (Suga & Jen 1975).
- Electric fish: cerebellum-like circuits learn a negative image of the self-generated signal and add it, cancelling the predictable part (Bell 1981; Bell, Han & Sawtell 2008; Requarth & Sawtell 2011). This is the adaptive-filter version, and it maps directly onto software.

**Design consequence.** The being must know what it is saying and discount it. Its voice must not wake it from sleep, startle it, raise dopamine, be learned into the song map, or be heard as drum hits by `timing.mjs`. It should still notice when the room answers, for example music resuming over its hum.

## 2. Resynthesis from auditory representations

| Method | Fits this data? | Notes |
|---|---|---|
| Channel vocoder (Dudley 1939): band envelopes multiply carriers in the same bands | **Best fit** | 28 bands at 10-100 Hz frames is exactly a vocoder frame. With noise carriers the result sounds whispered. Shannon et al. (1995) showed that speech stays intelligible with only 4 noise-vocoded bands, so rhythm and contour survive easily. Melody is poorly conveyed by noise carriers, as in cochlear-implant music perception (Limb & Roy 2014). Use tonal carriers for tonal material. |
| Additive / oscillator bank: one sine (or Hopf emitter) per band, amplitude from the envelope | Good | Cheapest option, and the voice is the ear itself (1.1). Pitch is limited to the CF lattice (0.2) unless retuned. |
| Griffin-Lim (Griffin & Lim 1984) | No | Needs an STFT magnitude with overlap and fine frequency resolution. 28 quarter-octave bands is far too coarse, and there is no phase to iterate on. |
| Auditory-model inversion: Slaney, Naar & Lyon (1994) cochleagram/correlogram inversion; Decorsière et al. (2015) iterative inversion of auditory spectrograms | Later, offline | These are the principled versions of "invert what the ear heard". They are iterative and need a finer representation than the stored map. The analysis-by-synthesis loop in 1.2 is the cheap analogue that uses the being's own ear. |
| Granular synthesis (Roads 2001) or concatenative synthesis (Schwarz 2006, CataRT) | Partly | No raw audio is stored, so classic granular is impossible. The map, however, is a descriptor-indexed corpus: each unit is a grain recipe (envelope + onset + roughness + sub), and a walk through the map is concatenative synthesis from its own vocabulary. Grains of 50-150 ms with overlap-add and the 100 ms frame period fit. |
| Physical / modal model of its own body | **Yes, as the body** | It is a liquid-metal sphere. A thin shell or bell has inextensional bending modes, which Rayleigh gives as f_n ∝ n(n^2 - 1)/sqrt(n^2 + 1) (Theory of Sound; French 1983 for wine glasses). For n = 2, 3, 4, 5 the ratios are **1 : 2.83 : 5.42 : 8.77**, which is singing-bowl or wine-glass territory (Inácio, Henrique & Antunes 2006 measured singing bowls; their modes are beating doublets). Run the voice through 4-8 resonators (biquads or a modal bank; van den Doel & Pai 1998, Cook 2002, Bilbao 2009) at these ratios, with a fundamental from the being's traits, and you get a timbral fingerprint: a hum through a metal throat. |

**Why the modes fit the visuals.** The body's cymatics organ is already spherical harmonics of degree l = 2, 3, 4 (`uSH[21]` = 5 + 7 + 9 coefficients, `index.html` ~l.220). Shell mode n = l, so the sound modes and the visible modes are the same objects. When the voice excites mode n, `uSH` degree n should ring with the same envelope.

## 3. What to store going forward

All of these are small. Ship them first, because they need listening time to fill.

1. **`meta.love`** (Float32 x 1152, rounded like `hits`): a dopamine-weighted hits histogram. In `memoryHear`, after `learn`, add `love[bmu] += (max(0, mind.daPhasic) + 0.3*max(0, mind.valence)) * 0.1`. Its favourite sounds are then the top units of `love`, not of `hits`. This is the same weighting the page already uses for `matScore`. Cost is about +6 KB of JSON per song.
2. **`meta.sketches`**: up to 4 loved moments per song. Keep a ring buffer of the last ~6 s of ear frames: 28 band amplitudes as log uint8 plus onset, rough and sub, at 50-100 Hz. When a `chill` event fires, `daPhasic` peaks above about 0.7, or the listener clicks love, keep 4 s before and 2 s after. Store the frames with the grid phase (`SHOW.phase`), `pulseHz` and the DA peak, and replace the weakest sketch when full. This is the reward-tagged trace that replay draws on (1.2). Cost is about 24-48 KB raw per sketch, roughly comparable to the existing map JSON (about 197 KB b64 of weights). Raw audio is deliberately not stored: the memory stays a memory of its senses, and a 28-band envelope cannot reproduce a copyrighted recording, only its ghost.
3. **`meta.chroma`** (12 floats): the song's long-term pitch-class profile. The analyzer computes `hcAcc` and `chromaRaw` but does not expose them in `an.state`, so a one-line export is needed. With this, tonal carriers can be retuned to the song's strongest pitch classes, and the voice sings in key.
4. Optionally, a coarse transition matrix: 16 k-means clusters of the map, 16x16 counts. This turns babble into a Markov walk with the song's own grammar. It is cheap, but less vivid than sketches.

## 4. Implementation in Electron

### 4.1 Synthesis
- Use one `AudioWorkletProcessor` ("syrinx"), created on first hover, in its own `AudioContext({ sampleRate: 48000, latencyHint: 'interactive' })` and suspended when silent. In system mode the page already creates an AudioContext and worklet for capture (`index.html` ~l.787); that one can be reused or kept separate.
- Inside the worklet:
  - 28 Hopf emitters (the `ear.mjs` normal form with per-unit target mu = A_k^2, so |z| = A_k; the limit cycle gives naturally soft swells, with tau about 1/(mu w));
  - a 28-band noise vocoder for the breathy and percussive part;
  - a sub sine;
  - roughness AM;
  - a 4-8 mode shell resonator bank;
  - a soft limiter and a master gain.
- The page posts control frames at 50-100 Hz: band targets, carrier mix, onset triggers from the groove grid, and mode excitations. No SharedArrayBuffer is needed.
- CPU: this is the same order of work as the existing ear loop (28 complex units per sample in `worker.mjs`), plus about 40 biquads. That is a small fraction of one core and below the GPU work. It has not been measured; measure it with the existing perf harness when built.
- Latency: hover-to-sound latency is irrelevant because the sound fades in. Singing on the beat over music, however, must schedule ahead by `ctx.baseLatency + ctx.outputLatency`, in the same way `beOnTime()` and `LATM` compensate the display. Use `SHOW.phase`, never the mind's raw pulse.

### 4.2 Politeness
- Start after a 0.5-0.8 s hover dwell, fade in over 1.5-3 s (the Hopf swell does part of this), and fade out over 2-3 s on leave, ending at a bar line when it is singing rhythmically.
- Default level is a whisper, at about -30 dBFS peak. Over music, stay at least 15-20 dB under the heard level, or sing only in gaps.
- Add a hard limiter, and never use an attack faster than about 10 ms.
- Add a Settings option, Voice: off / whisper / sing, stored in `being-settings.json`.
- Stay silent when the window is hidden, while dragging, and during tap-to-sync calibration.

### 4.3 Feedback: it must not hear itself
- **Per-app mode** (e.g. Spotify) uses `PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE`. The being's own output is not in the capture, so there is no feedback.
- **System mode** uses Chromium `getDisplayMedia` with Electron `audio: 'loopback'` (`main.cjs` ~l.77). This captures the endpoint mix, which **includes the being's own output**. `loopbackWithMute` would mute local playback, which is wrong here.
- **Native fix.** The vendored C++ already supports exclusion. `CLoopbackCapture::StartCaptureAsync(processId, includeProcessTree, ...)` and `ActivateAudioInterface` pick `PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE` when `includeProcessTree` is false (`native/source/src/loopback-capture.cpp` l.65-81, l.202-210). The N-API wrapper, however, hardcodes `true` (`loopback-capture-wrapper.cpp` l.30). What is needed:
  1. Read an optional boolean third argument (with the finish callback moving to the fourth, or use an options object).
  2. Rebuild under the pinned Electron.
  3. Update `native/capture.cjs` SHA256 and `native/README.md` together. The README says rebuilding is a developer-only operation.
  4. Then system mode becomes `startLoopbackCapture(process.pid /* Electron main = browser process */, cb, done, exclude=true)`. The target must be the browser process: Chromium renders audio in the audio-service utility process, which is a child of the browser process, so excluding the browser tree removes it. Verify this with a test tone.
  5. Note the global single-capture guard (`hasActiveProcess`): system and per-app capture cannot both run.
  This API requires Windows build 20348+, which `main.cjs` already checks.
- **Zero-native alternative to test first.** Chromium added `kLoopbackWithoutChromeId` ("all audio but Chrome", implemented with process-loopback EXCLUDE) in May 2025, and the Screen Capture spec has the `restrictOwnAudio` constraint. Electron 44 (Chromium 152) may honour `getDisplayMedia({audio: {restrictOwnAudio: true}})` together with `audio: 'loopback'`. This is **unverified**: probe it with a test tone (about 30 min). If it works, no rebuild is needed.
- **Software efference copy**, which is needed regardless of capture mode because a delayed or leaky path is always possible:
  - The voice posts its own per-band envelope, the expected self-signal, to `worker.mjs`.
  - The worker learns a gain and delay per band (cross-correlation, like `timing.mjs` learns `bias`) and subtracts the predicted self-envelope before onset, level and memory features. This is the electric-fish negative image.
  - Separately, a corollary-discharge flag in the page gates the consequences. While the being sings: no wake-from-sleep on sound below predicted self-level plus a margin, no startle, no `memoryHear` learning, no drum events into `timing`, and no dopamine from its own sound. Only the residual (other sound) counts, as in the cricket and marmoset.
  - Full-band NLMS echo cancellation at 48 kHz is possible, but it is expensive in JS and unnecessary once native exclude exists.

## 5. Interaction design

Hover develops the voice like a bird, and the length of the hover is the dial:

| Hover time | Silence / asleep | Music playing |
|---|---|---|
| 0.6-3 s | **Hum (SOAE)**: its ear's spontaneous emissions become audible, shaped by its favourite map unit (top of `love`, falling back to `hits`). It breathes on the sleep rhythm (~0.2 Hz), not a beat. | A quiet drone in the song's pitch classes (needs `meta.chroma`), locked to `SHOW.phase`. |
| 3-10 s | **Babble**: a walk on the song map weighted by `love`, grain by grain, with soft rhythm from `meta.groove` at `meta.bpm`. | Call and response: it answers in the music's gaps and breaks rather than over the vocal (antiphonal duetting: Mann, Dingess & Slater 2006; vocal turn-taking as coupled oscillators: Takahashi, Narayanan & Ghazanfar 2013). |
| 10 s+ | **Replay**: its best sketch of the last song or of its favourite song (highest `feeling`), vocoded, as a ghost of the moment it loved. | Usually nothing more, because restraint matters while music plays. |

Coupling to the body:
- **Singing radiates outward, hearing lands inward.** While it sings, the nucleus (`uNuc`) brightens with the voice envelope, and the shell rings in `uSH` degrees 2/3/4 with the same modal envelopes the audio resonators use.
- **You see what it remembers.** During babble and replay, the recognition glow (`map.act`) lights the map units being sung, and the memory skin surfaces through the existing cuttlefish gate (`SKIN`), so the listener sees the walk across its memory.
- Its own voice does not kick the tissue (corollary discharge), so the tissue stays a picture of hearing.
- Love click while it sings reinforces that sketch or unit (adds to `love`), as reinforcement of babble (Tumer & Brainard 2007).

## Sources

- Kemp DT (1978) Stimulated acoustic emissions from within the human auditory system. JASA 64:1386.
- Kemp DT (1979) Evidence of mechanical nonlinearity and frequency selective wave amplification in the cochlea. Arch Otorhinolaryngol 224:37.
- Zurek PM (1981) Spontaneous narrowband acoustic signals emitted by human ears. JASA 69:514.
- Bergevin C et al. (2015) Salient features of otoacoustic emissions are common across tetrapod groups and suggest shared properties of generation mechanisms. PNAS 112:3362.
- Camalet S, Duke T, Jülicher F, Prost J (2000) Auditory sensitivity provided by self-tuned critical oscillations of hair cells. PNAS 97:3183.
- Eguiluz VM et al. (2000) Essential nonlinearities in hearing. PRL 84:5232.
- Goepfert MC, Robert D (2003) Motion generation by Drosophila mechanosensory neurons. PNAS 100:5514.
- Hudspeth AJ (2014) Integrating the active process of hair cells with cochlear function. Nat Rev Neurosci 15:600.
- Vilfan A, Duke T (2008) Frequency clustering in spontaneous otoacoustic emissions from a lizard's ear. Biophys J 95:4622. https://pmc.ncbi.nlm.nih.gov/articles/PMC2576359
- Fruth F, Jülicher F, Lindner B (2014) An active oscillator model describes the statistics of spontaneous otoacoustic emissions. Biophys J 107(4), Aug 2014. https://pmc.ncbi.nlm.nih.gov/articles/PMC4142242
- Marler P (1970) A comparative approach to vocal learning: song development in white-crowned sparrows. J Comp Physiol Psychol 71:1.
- Konishi M (1965) The role of auditory feedback in the control of vocalization in the white-crowned sparrow. Z Tierpsychol 22:770.
- Doupe AJ, Kuhl PK (1999) Birdsong and human speech: common themes and mechanisms. Annu Rev Neurosci 22:567.
- Brainard MS, Doupe AJ (2000) Auditory feedback in learning and maintenance of vocal behaviour. Nat Rev Neurosci 1:31.
- Brainard MS, Doupe AJ (2002) What songbirds teach us about learning. Nature 417:351.
- Kao MH, Doupe AJ, Brainard MS (2005) Contributions of an avian basal ganglia-forebrain circuit to real-time modulation of song. Nature 433:638.
- Aronov D, Andalman AS, Fee MS (2008) A specialized forebrain circuit for vocal babbling in the juvenile songbird. Science 320:630.
- Tumer EC, Brainard MS (2007) Performance variability enables adaptive plasticity of 'crystallized' adult birdsong. Nature 450:1240.
- Tchernichovski O et al. (2001) Dynamics of the vocal imitation process. Science 291:2564.
- Dave AS, Margoliash D (2000) Song replay during sleep and computational rules for sensorimotor vocal learning. Science 290:812.
- Ambrose RE, Pfeiffer BE, Foster DJ (2016) Reverse replay of hippocampal place cells is uniquely modulated by changing reward. Neuron 91:1124.
- von Holst E, Mittelstaedt H (1950) Das Reafferenzprinzip. Naturwissenschaften 37:464. Sperry RW (1950) J Comp Physiol Psychol 43:482.
- Crapse TB, Sommer MA (2008) Corollary discharge across the animal kingdom. Nat Rev Neurosci 9:587.
- Poulet JFA, Hedwig B (2006) The cellular basis of a corollary discharge. Science 311:518.
- Eliades SJ, Wang X (2008) Neural substrates of vocalization feedback monitoring in primate auditory cortex. Nature 453:1102.
- Schneider DM, Nelson A, Mooney R (2014) A synaptic and circuit basis for corollary discharge in the auditory cortex. Nature 513:189.
- Suga N, Jen PH (1975) Peripheral control of acoustic signals in the auditory system of echolocating bats. J Exp Biol 62:277.
- Bell CC (1981) An efference copy which is modified by reafferent input. Science 214:450. Bell CC, Han V, Sawtell NB (2008) Cerebellum-like structures and their implications for cerebellar function. Annu Rev Neurosci 31:1. Requarth T, Sawtell NB (2011) Neural mechanisms for filtering self-generated sensory signals in cerebellum-like circuits. Curr Opin Neurobiol 21:602.
- Arnal LH et al. (2015) Human screams occupy a privileged niche in the communication soundscape. Curr Biol 25:2051.
- Dudley H (1939) The vocoder. Bell Labs Record 18:122.
- Shannon RV et al. (1995) Speech recognition with primarily temporal cues. Science 270:303.
- Limb CJ, Roy AT (2014) Technological, biological, and acoustical constraints to music perception in cochlear implant users. Hear Res 308:13.
- Griffin DW, Lim JS (1984) Signal estimation from modified short-time Fourier transform. IEEE TASSP 32:236.
- Slaney M, Naar D, Lyon RF (1994) Auditory model inversion for sound separation. ICASSP. https://engineering.purdue.edu/~malcolm/interval/1994-036
- Decorsière R, Søndergaard PL, MacDonald EN, Dau T (2015) Inversion of auditory spectrograms, traditional spectrograms, and other envelope representations. IEEE/ACM TASLP 23:46. https://orbit.dtu.dk/en/publications/inversion-of-auditory-spectrograms-traditional-spectrograms-and-o/
- Roads C (2001) Microsound. MIT Press. Schwarz D et al. (2006) Real-time corpus-based concatenative synthesis with CataRT. DAFx.
- Rayleigh JWS (1894) The Theory of Sound, vol. 1 (bells, thin shells). French AP (1983) In vino veritas: a study of wineglass acoustics. Am J Phys 51:688.
- Inácio O, Henrique L, Antunes J (2006) The dynamics of Tibetan singing bowls. Acta Acustica 92:637.
- van den Doel K, Pai DK (1998) The sounds of physical shapes. Presence 7:382. Cook PR (2002) Real Sound Synthesis for Interactive Applications. Bilbao S (2009) Numerical Sound Synthesis.
- Mann NI, Dingess KA, Slater PJB (2006) Antiphonal four-part synchronized chorusing in a Neotropical wren. Biol Lett 2:1.
- Takahashi DY, Narayanan DZ, Ghazanfar AA (2013) Coupled oscillator dynamics of vocal turn-taking in monkeys. Curr Biol 23:2162.
- Microsoft: PROCESS_LOOPBACK_MODE. https://learn.microsoft.com/en-us/windows/win32/api/audioclientactivationparams/ne-audioclientactivationparams-process_loopback_mode ; Application loopback sample. https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/
- Chromium: Adds support for loopback audio without Chrome and "all audio" on Windows (May 2025). https://chromium.googlesource.com/chromium/src/+/3175cfc2eb08b30f30cac087311d267cf2caf1b6
- MDN: restrictOwnAudio. https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/restrictOwnAudio
- Electron: setDisplayMediaRequestHandler `audio: 'loopback' | 'loopbackWithMute'` (Windows only). https://www.electronjs.org/docs/latest/api/session
- MDN: AudioContext baseLatency / outputLatency. https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/baseLatency
