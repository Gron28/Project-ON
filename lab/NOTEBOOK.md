# Lab notebook 01 — a primordial being that listens

*Date: 2026-10-08. Status: research and first experiments. No product code was written for this phase.*

## 0. The question

Felipe's brief, restated:

> A real-time, fractal, primordial, alien "universal being". It ebbs and flows and morphs constantly with the music. It is far more complex than the blob, but it is still one organic figure. It is built from the building blocks that all creatures share. It is not a copy of the fruit fly or of any other animal. Its core replicates the most primal machinery that senses vibration and *feels* music. It is unique for each person. We get there like a lab: papers first, our own experiments, training where needed. Then we check it against the blob's algorithm, or let it be fully emergent.

The working question for this notebook is: **what are the shared building blocks of hearing and feeling, how do they behave, and how could they be recombined into a being that is alive in a measurable sense?**

Method:
- Five parallel literature reviews, using primary sources wherever possible:
  - the primal ear and brainstem;
  - rhythm, expectation and emotion;
  - generative neural substrates;
  - organic and fractal visuals;
  - the music-perception baseline.
- Five experiments of our own on the FlyWire connectome and on classic models. Code is in `lab/experiments/` and raw results in `lab/results/`.

Where a claim comes from a paper we did not read in full, it says so. Every performance figure for the laptop is an estimate until it is measured.

---

## 1. What our own experiments found

### E01 · Anatomy of hearing in the fly connectome (`01-auditory-anatomy.mjs`)
The layers are counted by synaptic hops from the 446 sound-sensing Johnston's organ neurons (JO-A, JO-B, JO-D).

| Hop | Neurons | Inhibitory | Median fan-in / fan-out |
|---|---|---|---|
| 0 (ear) | 446 | 18% | — (more than half have no outputs of 5 or more synapses) |
| 1 | 99 | **46%** | 26 / 27 |
| 2 | 598 | **41%** | 37 / 39 |
| 3 | 2,353 | 37% | 25 / 25 |
| 4 | 7,149 | 39% | 26 / 25 |

The auditory core (hops 0–2) has 1,143 neurons and 14,202 connections. Its statistics:
- Synaptic weights are log-normal: the median is 10 synapses and the log-standard deviation is 0.75.
- **Reciprocity is 15.7%**, against 1.1% for a random graph of the same density, so about 14 times chance. The whole-brain figure is 13.8% (Lin et al. 2024).
- **68% of synapses run within a layer**, 25% forward and 6% backward.
- The biggest auditory hubs are GABAergic interneurons (CB0466, CB3882) that receive about 500–880 auditory synapses each.
- One descending neuron (DNp12) receives direct auditory input at hop 2, a reflex path to the body.
- Sound and wind/gravity receptors share only 18% of their targets.

**Reading.** Primal hearing is not a pipeline. It is a recurrent, laterally coupled sheet, rich in fast inhibition and in reciprocal excitation–inhibition loops. That matches the brain-wide finding that 3-cycles with an inhibitory member are over-represented (Lin et al. 2024).

### E02 · Which rhythms does that circuit follow? (`02-rhythm-transfer.mjs`)
We drove the ear with amplitude-modulated input and with click trains, using the published whole-brain LIF model (Shiu et al. 2024).
- The circuit follows modulation flat up to about 16 Hz. Locking (vector strength at hop 2) falls from 0.58 to 0.22 by 64 Hz.
- It locks to clicks at every tempo from 60 to 240 bpm (vector strength above 0.9), with **no preferred tempo**.
- Activity collapses after the second relay: hop 1 fires at about 13 Hz, hop 2 at 3.5 Hz, hop 3 at 0.2 Hz and hop 4 at about 0. With the ear's synapses at their real strength, it dies after hop 2.

**Reading.** The fly model detects onsets and low-pass-filters rhythm. It has no resonance, no adaptation and no anticipation, so it cannot entrain or *feel* a beat. Those ingredients have to come from other building blocks (Section 2).

### E03 · Is the circuit critical? (`03-criticality.mjs`)

| Coupling | Ear drive | Branching ratio σ | Behaviour |
|---|---|---|---|
| ×1 (published) | 2–20 Hz | 0.61–0.86 | subcritical: the signal fades |
| ×1 | 40 Hz | 1.13 | avalanche size slope −1.33, close to the critical −1.5 |
| ×1 | 80–160 Hz | 1.15–1.31 | supercritical bursts of up to 38,000 spikes |
| ×1.5 to ×3 | any | about 1.01–1.04 | ignites into self-sustained activity that ignores the input |

The dynamic range at the published coupling is only 7.8 dB.

**Reading.** The window between deaf and seizing is narrow, and nothing holds the circuit inside it. Real nervous systems hold themselves there with their own feedback (Section 2.4).

### E04 · Replication: Kinouchi & Copelli 2006 (`04-kinouchi-replication.mjs`) ✅
We tested an excitable network with 100,000 units, mean degree K = 10 and 5 states.

| σ | 0 | 0.5 | 0.8 | 0.9 | **1.0** | 1.1 | 1.25 | 1.5 |
|---|---|---|---|---|---|---|---|---|
| Dynamic range (dB) | 17.3 | 19.2 | 22.2 | 23.7 | **26.5** | 23.8 | 21.8 | 20.0 |
| Low-input response exponent | 0.97 | 0.93 | 0.83 | 0.77 | **0.53** | 0.72 | 0.82 | 0.80 |

This matches the paper: about 17 dB uncoupled, about 26 dB at σ = 1, and a Stevens exponent of 1/2 at criticality. **A sensing sheet hears both a whisper and a wall of sound only when held at σ ≈ 1.** This is now a result we can build on.

### E05 · Replication attempt: the "missing pulse" (`05-missing-pulse.mjs`) ◑ not replicated yet
The claim (Velasco & Large 2011; Large et al. 2015) is that an oscillator network feels the beat even when the rhythm has **zero spectral energy** at the beat.

We used three banks of 289 oscillators over 0.25–16 Hz: a linear bank, a critical bank, and a motor-like layer with 1:2, 1:3, 2:1 and 3:1 connections. The rhythm was verified to have zero energy at 2 Hz.

What we saw:
- **Linear bank:** no 2 Hz peak (contrast 0.85).
- **Critical bank:** no 2 Hz peak.
- **Motor layer:** a real local peak at 2 Hz, 2.4–4.2 times its neighbours. But inside the 0.5–4 Hz beat band, its strongest response is at 4 Hz.
- On an isochronous beat, the nonlinear banks sharpen the pulse enormously: 2 Hz contrast is 7–58 against 1.4 for the linear bank.

Likely causes are in our implementation:
- the frequency scaling favours fast oscillators;
- the paper's learned inhibitory feedback from motor to sensory layer is missing;
- the sign of the motor layer's α is uncertain in the PDF;
- the paper used a threshold readout.

**Next:** a faithful port of pyGrFNN (BSD-3) to compare against. Until then this is an open claim, not a building block.

---

## 2. The primal stack: shared building blocks, from vibration to feeling

Each layer below is a mechanism found across many species. Each is cheap enough for this laptop, and each has a measurable behaviour we can test. Together they form a candidate "innermost brain" for the being.

### 2.1 Skin and ear: the self-tuned critical oscillator
**Convergent evolution.** The same module appears in three unrelated ears:
- the frog hair bundle;
- the fruit-fly antenna (Göpfert & Robert 2003; Nadrowski et al. 2008);
- the mosquito flagellum.

It is a force-gated channel in series with a gating spring, plus adaptation motors with calcium feedback. The result is an oscillator that parks itself at a **Hopf bifurcation**. Fly *atonal* even rescues hair cells in Math1-null mice (Wang et al. 2002). This is as universal as hearing gets.

**Normal form** (Eguíluz et al. 2000): ż = (μ + iω₀)z − |z|²z + F·e^{iωt}. At μ = 0:
- response R = F^{1/3} and gain F^{−2/3}, compressing about 80 dB into about 20 dB;
- tuning sharpens as the input gets weaker;
- distortion tones (2f₁−f₂) appear: "phantom notes" that are not in the music.

When μ > 0 it hums on its own. That hum is a **spontaneous otoacoustic emission**: the ear's own voice.

**Self-tuning** (Camalet et al. 2000): a slow feedback, τ ≈ 1 s, holds μ near 0. Loud sound pushes it subcritical (fatigue), and silence lets it drift into humming.

**For the being:**
- A CARFAC cascade (Lyon 2011, Apache-2.0, actively maintained, has emscripten bindings) forms the travelling-wave "cochlear skin".
- It drives about 100–250 self-tuned Hopf units in an AudioWorklet. Estimated cost is a few percent of one core.
- The being becomes slightly deaf after loud passages, hums in silence, and hears tones that aren't there.

### 2.2 The body ear: bass is felt, not heard
- **Saccule.** It responds to loud low-frequency sound above about 90 dB(A) (Todd & Cody 2000). Its best frequency is about 100 Hz for vibration and about 500 Hz for air sound.
- **Pacinian skin receptors.** They cover 65–400 Hz, peaking at about 250 Hz (Bolanowski 1988).
- **Undetectable sub-bass makes people dance more.** Sub-bass at 8–37 Hz raised concert dancing by 11.8%, and nobody noticed it (Cameron et al. 2022).

**For the being:** a separate "body ear" for sub-bass drives whole-body sway and inertia. A Pacinian band drives shivering of the skin. A constant-Q bank from 0.5 to 10 Hz on the envelope, preferring about 2 Hz, drives locomotion-like rhythm.

### 2.3 Brainstem reflexes: the oldest reactions
- **Startle.** The arc is three synapses long; hindleg muscle responds in about 8 ms in rats. It has habituation, sensitization and prepulse inhibition (Davis 1982; Groves & Thompson 1970; Blumenthal 2005).
  - In music the preceding beats act as prepulses, and repetition habituates.
  - So the being flinches at the first drop and stops flinching at every kick. That is biologically correct and reads strongly as alive (compare *Bion*, Brown & Fagg 2006).
- **Modulation filterbank** (Dau et al. 1997). It splits sound into three axes:
  - rhythm, below 10 Hz;
  - roughness, 30–150 Hz;
  - pitch periodicity, above about 130 Hz.
- **Roughness is a primal alarm.** Screams sit at 30–150 Hz modulation, aversion peaks at 40–80 Hz, and these rates engage the amygdala (Arnal et al. 2015, 2019). This gives an approach/withdraw axis for free.
- **Tempo preference from adaptation.** Rats synchronise best at 120–140 bpm. The preference comes from a conserved roughly 250 ms adaptation kernel, not from body size (Ito et al. 2022). This is a universal reason for a preferred tempo.

### 2.4 Nervous tissue held at the edge
- **Criticality maximises sensing.** Dynamic range peaks at σ = 1 (Kinouchi & Copelli 2006), replicated in E04.
- **Homeostasis makes the operating point follow the music** (Zierenberg et al. 2018). The branching ratio settles at m = 1 − h/r\*, where h is the input rate and r\* the target rate.
  - Loud, dense music gives an input-driven, calmer network.
  - Silence gives reverberation and bursts, the network "dreaming".
  - Nothing is hand-mapped.
- **Self-organisation mechanisms:**
  - depressing synapses (Levina et al. 2007: critical at α ≈ 1.4);
  - inhibitory STDP for excitation–inhibition balance (Vogels et al. 2011);
  - slow synaptic scaling (Turrigiano 1998).
- **Unifying principle.** The hair bundle, the cortex and the most dynamic Flow-Lenia matter all sit at the edge of an instability, and are held there by their own feedback. This is the strongest candidate for the being's core law.

> **The being is something held at the edge of instability by its own feedback, which music pushes across.**

### 2.5 Resonance: body-time
- **Gradient-frequency oscillator networks** (Large et al. 2010, 2015). A sensory layer near Hopf plus a motor layer near a double limit cycle. The motor layer keeps pulsing after the music stops: an afterglow.
- **Personal tempo** (ASHLE, Roman et al. 2023). The being locks to any tempo but always drifts back to its own spontaneous tempo f₀.
- **Leading the beat.** Delayed self-feedback makes its pulse lead the beat slightly (Roman et al. 2019), as humans do.
- **Lockedness** is the order parameter of a forced Kuramoto population (Ott–Antonsen form; Childs & Strogatz 2008). It gives a natural "snap into the groove". Implemented in `being/kuramoto.mjs`: below critical coupling, forced only while onsets come, so lock snaps in, holds on a little longer than it caught hold, and fades in 2-4 s of silence.
- **Chimeras.** With nonlocal coupling, parts of the body lock while others drift (Abrams & Strogatz 2004). That is the visual expression of ambiguous or polyrhythmic music.
- **Caveat.** Harding et al. 2025 (*Nat Rev Neurosci*) argue that anticipation comes from resonance itself ("strong anticipation"), not from predictive models. We can use both (2.6). Their disagreement is itself a signal.

### 2.6 Expectation: mind-time
- **Temporal expectation.** PIPPET (Cannon 2021) gives phase belief, surprise and *omission* surprise ("it should have hit there").
- **Content expectation.** PPM-Decay (Harrison et al. 2020, MIT) over rhythm, harmony and timbre symbols gives information content (surprise) and entropy (uncertainty). Use a forgetting short-term memory (half-life about 3.5 s) and a long-term memory that grows over weeks: **the being's enculturation**.
- **Continuous change detection.** D-REX (Skerritt-Davis & Elhilali 2018).
- **Precision.** The same deviant is more surprising in a stable context (Friston 2010).
- **Valence as a derivative.** Valence = −dF/dt (Joffily & Coricelli 2013), with F as smoothed, precision-weighted surprise. The second derivative names four states:
  - **hope:** surprise falling faster and faster;
  - **fear:** chaos accelerating;
  - **happiness;**
  - **unhappiness.**

### 2.7 Value: what moves it
- **Pleasure surface** (Cheung et al. 2019). Pleasure depends on surprise S and uncertainty U, plus their interaction U×S (β = −0.124). The surface is a saddle: low uncertainty with high surprise is pleasant, and so is high uncertainty with low surprise. The nucleus accumbens and caudate track uncertainty.
- **Personal sweet spot** (Mas-Herrero & Marco-Pallarés 2025). Liking V = −|IC − PreSS·Entropy|², where PreSS is a reliable per-person "predictability sweet spot" (test–retest ICC 0.67). A higher PreSS predicts jazz preference.
- **Groove.** Wanting to move follows an inverted U against syncopation (Witek et al. 2014), peaking near index 31–35. The peak shifts up with exposure, which is a sensitisation rule for taste.
- **Dopamine** (Salimpoor 2011; Ferreri 2019; Schultz 1997):
  - anticipatory: rises in the seconds before a peak (caudate);
  - phasic: fires at the peak (nucleus accumbens);
  - tonic: sets vigour.
- **Test case: fake drops.** The model predicts a negative phasic dip on a fake drop. That is a testable signature.

### 2.8 Affect, homeostasis, curiosity
- **Core affect.** Modelled as an Ornstein–Uhlenbeck process (DynAffect, Kuppens 2010). Each being has its own home base, variability and attractor strength.
- **Mood** integrates prediction errors and biases perception (Eldar et al. 2016). It works as a serotonin-like slow state.
- **Energy and fatigue** as homeostatic reward (Keramati & Gutkin 2014). The same music is rewarding or tiring depending on the being's state, so some days it prefers calmer music.
- **Curiosity** = learning progress (Schmidhuber 2010; Oudeyer 2007).
  - **Boredom:** nothing left to learn and the music is predictable.
  - **Confusion:** nothing learnable and the music is unpredictable.
  - Together they reproduce Berlyne's inverted U over time.
- **Neuromodulators** (Doya 2002; Yu & Dayan 2005; Aston-Jones & Cohen 2005):
  - dopamine is the prediction error;
  - noradrenaline is unexpected uncertainty, raising gain and startle;
  - acetylcholine is expected uncertainty and learning rate;
  - serotonin is patience and mood.
  - These can diffuse through the body as fields, so different regions are in different states.

### 2.9 Identity: one being per person
- **Innate seed.** f₀ (personal tempo), affect home bases, dopamine gain (some beings are simply less moved; Mas-Herrero 2014), PreSS, preferred syncopation s\*, coupling looseness and neuromodulator baselines.
- **Development:**
  - long-term expectation statistics;
  - Hebbian oscillator ratios, which over time favour duple or triple feel (Kim & Large 2021);
  - a timbre codebook;
  - a familiarity map with an inverted-U liking curve (Berlyne; Chmiel & Schubert 2017);
  - evaluative conditioning: taste becomes the history of what *moved it*, not what it heard;
  - episodic "moments" that replay their feeling when the music returns, an analogue of nostalgia.
- **Genome.** A CPPN, adaptive-HyperNEAT style, paints neuron density, cell classes, wiring exponents and plasticity rules across the body (Stanley 2007; Risi & Stanley). An offline MAP-Elites archive (Mouret & Clune 2015) guarantees every seed is both viable and distinct.

---

## 3. Perception baseline: what the blob already hears, and the best upgrades

The blob's analyzer is a good foundation. It provides HPSS drums, a PLL beat with downbeat, chroma, sections, build-ups and drops, and 14 absolute character descriptors. It also runs EffNet-Discogs, which gives 400 styles, moods and a 1280-d embedding, plus a taste model.

The research says:

1. **Emotion.** EffNet has *no* published arousal/valence head and generalises poorly for emotion (MusAV, Bogdanov et al. 2022). Better options:
   - **MusiCNN** (3.2 MB) plus the `emomusic-msd-musicnn-2` head (82 KB), which has the best valence generalisation: 74.8% of pairs ordered correctly.
   - Mind the output order: it is **(valence, arousal)** on a 1–9 scale.
   - Realistic ceilings: within-song arousal r ≈ 0.6–0.7; within-song valence is close to unpredictable (r ≈ 0.1–0.2, DEAM). So arousal can be fast, and valence must be slow and section-level.
2. **A psychoacoustic pack.** Cheap on the existing FFT: BS.1770 short-term LUFS, sharpness, fluctuation strength (4 Hz), roughness, pulse clarity, syncopation on the beat grid, mode and key clarity, and harmonic change.
3. **Tension.** Use Farbood's 2012 model exactly: slopes over a 3 s window, weights 3/3/2/2/1, β = 5 trend memory, integration step 0.25 s. It reaches r ≈ 0.84 against listener tension.
4. **Downbeat correction.** Every 1–2 s, run "Beat This!" small (2M parameters, MIT) to correct the PLL from behind. Downbeat F1 is about 78% offline against about 50% for online trackers.
5. **Stem awareness.** Distil Demucs offline into a tiny live student for drums, bass, vocals and other loudness at 10–20 fps.

In the new design, these signals are **senses**, not drivers. They feed the expectation and value layers. They do not map directly to shapes.

---

## 4. Body and visuals

### What the references teach about looking alive
Sources: Lomas, Latham, Floraform, Hoff, Sims, Jenson, Akten.
1. **Rules, not shapes.** Local rules, plus one constraint that keeps the form coherent.
2. **Hierarchy.** Horns of horns, three or more octaves of scale.
3. **Differential rates.** Neurons should drive *rates*, not positions.
4. **Viscous motion.** Overdamped, with fast-attack and slow-release muscles.
5. **Travelling waves.** Latham's "pulse" and "breath".
6. **Symmetry with symmetry breaking.** Radiolarian geometry.
7. **Translucency.** Seeing inside is what reads as biology.
8. **Real light on unreal matter.** Latham: "too real is boring, too unreal disorients".
9. **Curated gene limits.** Every individual is beautiful by construction.

### Techniques that matter most
- **Fractals as tissue inside an organic envelope, not as the whole body.** The candidates:
  - quaternion Julia sets are the most "embryonic" and morph smoothly through 8 parameters;
  - KIFS gives crystal ↔ radiolarian ↔ insect with about 11 continuous parameters;
  - gyroid and minimal surfaces give porous bone and real butterfly-scale nanostructure;
  - Wythoff polyhedra morph continuously between the "perfect shapes".
- **The MilkDrop secret.** It is a feedback loop: each frame warps the previous one plus a new seed. That is an iterated function system in image space. Wrapping the creature in a feedback aura gives MilkDrop-level richness for about 0.5 ms. Neuron spikes injected into it leave comet trails, a visible memory of thought.
- **Cymatics on a body are spherical harmonics.** The vibration modes of a drop are Y_lm, so spectral bands driving harmonic degrees is a *physically true* music-to-form mapping. Faraday-wave symmetry can be chosen by the music's harmonic interval.
- **The nervous system shown like calcium imaging.** Dark field, neurons that flare and fade, per-person "Brainbow" colours, drawn inside the translucent body with Beer–Lambert attenuation.
- **Ontogeny as identity.** The body keeps a record of its life: growth, skin pattern, vessel network. Two beings with the same seed still diverge.

### Three visual concepts
These come from the visuals review. Performance figures are estimates for the Arc 140V.

| | A · Radiolarian Choir | B · Kaleidoscopic Medusa | C · Morphogenetic Bloom |
|---|---|---|---|
| Body | glassy protist with a polyhedral lattice shell (12 vertices = 12 pitch classes), spherical-harmonic cymatics, quaternion-Julia nucleus | jellyfish bell plus Latham horn tentacles with Gielis cross-sections | 20k–60k Lomas-style cells that divide, ruffle and die |
| Inside | gyroid cytoplasm, phyllotactic neurons with spines, Hopf-fibre "streaming" | KIFS/Mandelbox tissue, a Physarum nerve web grown toward active neurons | growth waves driven by neuron territories; X-ray "dream" mode |
| Signature | perfect geometry, breathing | MilkDrop trails, the richest | the most alive, its body is its history |
| Cost / risk | about 6–10 ms / low | about 10–13 ms / medium | about 6–9 ms / high engineering |

All three keep the blob's identity: one centred organic figure, liquid and metallic-glassy, lit from within.

---

## 5. Putting it together: three candidate beings

These range from most grounded to most alien. The primal stack (2.1–2.3) is the same in all three, because it is the "innermost brain" Felipe asked for.

**I · The Resonant Listener (oscillator-first).**
- **Structure:** Hopf ear, body ear, brainstem reflexes, resonance layer, expectation, value, affect, identity.
- **Body:** concept A or B, driven by phases, lockedness, dopamine and affect.
- **Cost and risk:** cheapest and most music-specific; every layer is a published, testable model.
- **Weakness:** the "nervous tissue" is abstract (oscillators and scalars), so less emergent surprise.

**II · The Critical Nervous System (tissue-first).**
- **Structure:** everything in I, plus a generated spiking sheet of 50k–150k neurons.
  - Its wiring grammar comes from real brains: homophily wiring (Akarca 2021), cell-class blocks, reciprocity of about 0.14, log-normal weights, over-represented excitation–inhibition loops, hubs first.
  - It is held critical by homeostasis.
  - Its motor pools drive the body, and the body's deformation feeds back as proprioception.
- **Strength:** the most "built from the building blocks"; behaviour emerges, especially between songs and in silence.
- **Cost:** needs WebGPU event-driven simulation (about 2–5 ms of GPU per frame, estimated) and careful criticality control. E03 shows why.

**III · The Morphogenetic Alien (the brain is the body).**
- **Structure:** Flow-Lenia matter with per-cell parameters and an excitable channel, held critical, living inside it. Excitation waves reshape the matter, so movement *is* thought (compare Sensorimotor Lenia, Hamon et al. 2024).
- **Sound input:** through a tonotopic epithelium, regions of the body that feel different bands.
- **Strength:** the most alien and open-ended.
- **Weakness:** genomes need offline evolution on a cloud GPU; the highest risk.

**Recommendation for discussion:** build the primal stack (I) first, as a lab instrument we can measure. Then grow II's tissue on top of it, and keep III as the long-term horizon. Felipe's idea to "check alignment with the blob" becomes a measurement rather than a design choice: how much of the being's emergent state is mutual information with the blob's hand mappings? We can expose that as a dial between *anchored* and *emergent*.

---

## 6. How we will know it is alive: measurable criteria

| Property | Test | Expected if alive |
|---|---|---|
| Criticality | branching ratio (multistep regression estimator), avalanche exponents | m ≈ 1 in silence, input-driven under music; sizes −1.5, durations −2 |
| Dynamic range | 60 dB level sweep | peak at m ≈ 1, Stevens exponent ≈ 0.5 (E04) |
| Entrainment | Arnold tongue: phase locking against tempo detuning | lock zones, 1:2 and 2:3 mode locking |
| Feeling a pulse | missing-pulse rhythms (E05, to finish) | pulse at the beat with no spectral energy there |
| Afterglow | music stops | keeps pulsing for seconds, then drifts to its own tempo f₀ |
| Autonomy | silence | spontaneous activity, Lempel–Ziv complexity well above periodic and shuffled surrogates; humming ear |
| Habituation | 20 repeats of a hit or song | response decays, recovers after novelty |
| Anticipation | EDM build-ups and fake drops | anticipatory dopamine ramps before drops; phasic dopamine positive at real drops, negative at fake ones |
| Taste | syncopation ladder; IC × entropy grid | inverted U, a personal sweet spot that shifts with exposure |
| Individuality | two beings, same songs | genome decodable from responses near 100%; beings diverge over weeks |
| Alignment | against the blob's mappings | measured, then chosen |

---

## 7. Next experiments (proposed, not started)

1. **E06 · Hopf ear.**
   - Test the 1/3 law at the characteristic frequency against 1 dB/dB off it.
   - Two-tone test: 2f₁−f₂ should grow at about 1 dB/dB.
   - Silence should give onset of a spontaneous emission; loud exposure should give fatigue and recovery.
   - CARFAC→WASM cost on this laptop.
2. **E07 · Faithful GrFNN.** Port pyGrFNN and rerun the missing-pulse test, plus afterglow and tempo-step tests.
3. **E08 · Homeostatic sheet.** Reproduce m = 1 − h/r\*. Drive the sheet with real music and with silence, and check criticality.
4. **E09 · Wiring grammar.** Generate a 50k-neuron alien network and compare its statistics with the FlyWire numbers from E01 and Lin 2024. Then measure whether sound now propagates.
5. **E10 · Inner life on real music.** An EDM set with build-ups and fake drops. Check dopamine signatures, groove, startle habituation and Joffily–Coricelli hope/fear.
6. **E11 · Individuality.** Two seeds, two listening "diets", a simulated week.
7. **Rendering calibration.** Run iq's Mandelbulb and Julia shaders and the WebGPU jellyfish and MLS-MPM demos in Electron on the Arc 140V to replace the estimates.

---

## 8. Risks, licences, honesty

- **FlyWire data** is CC BY-NC 4.0. We use it only to *measure* statistics; the being does not contain the fly.
- **Essentia models** are CC BY-NC-SA 4.0 and **essentia.js** is AGPL-3.0. Fine for a personal piece; a problem for commercial release.
- **GrFNN Toolbox** is GPL, and its README lists Circular Logic LLC patents 7,376,562 and 8,583,442 ("Rhythm processing and frequency tracking in gradient frequency nonlinear oscillator networks"). Implement from the published equations or the BSD-3 pyGrFNN, and check patent status before any commercial use.
- Permissive options:
  - CARFAC: Apache-2.0
  - Beat This!: MIT
  - PPM-Decay: MIT
  - ncps: Apache-2.0
  - SwissGL: Apache-2.0
  - WebGPU-Ocean, Splash and the jellyfish demo: MIT
- **Valence from audio is weak.** The being's valence should come mostly from its own dynamics (surprise, learning, locking), not from a classifier.
- **No prior art was found** for a music-listening, critical, plastic, per-person nervous system driving an emergent body. That makes the idea unclaimed, but it also means there is no reference to copy.

---

## Appendix: key sources

- **Hearing:** Camalet et al. 2000 *PNAS*; Eguíluz et al. 2000 *PRL* 84:5232; Hudspeth 2014 *Nat Rev Neurosci* 15:600; Göpfert & Robert 2003 *PNAS* 100:5514; Nadrowski et al. 2008 *Curr Biol* 18:1365; Lyon 2011 *JASA* 130:3893 (CARFAC); Todd & Cody 2000 *JASA* 107:496; Cameron et al. 2022 *Curr Biol*; Arnal et al. 2015 *Curr Biol*, 2019 *Nat Commun*; Ito et al. 2022 *Sci Adv*; Dau et al. 1997 *JASA*.
- **Rhythm and emotion:** Large et al. 2010 *Physica D*; Velasco & Large 2011 ISMIR; Large et al. 2015 *Front Syst Neurosci*; Harding et al. 2025 *Nat Rev Neurosci*; Roman et al. 2019, 2023 *PLoS Comput Biol*; Cannon 2021 (PIPPET); Harrison et al. 2020 (PPM-Decay); Cheung et al. 2019 *Curr Biol*; Mas-Herrero & Marco-Pallarés 2025 *PNAS*; Witek et al. 2014 *PLoS One*; Salimpoor et al. 2011 *Nat Neurosci*; Ferreri et al. 2019 *PNAS*; Joffily & Coricelli 2013 *PLoS Comput Biol*; Kuppens 2010; Eldar et al. 2016; Keramati & Gutkin 2014; Juslin 2013; Farbood 2012.
- **Substrates:** Kinouchi & Copelli 2006 *Nat Phys*; Zierenberg et al. 2018 *PRX*; Levina et al. 2007 *Nat Phys*; Beggs & Plenz 2003; Lin et al. 2024 *Nature*; Song et al. 2005 *PLoS Biol*; Akarca et al. 2021 *Nat Commun*; Izhikevich 2003, 2007; Vogels et al. 2011; Plantec et al. 2023 (Flow-Lenia); Hamon et al. 2024 *Sci Adv*; Mordvintsev et al. 2020 (Growing NCA); Stanley 2007 (CPPN); Mouret & Clune 2015.
- **Visuals:** Lomas 2014 "Cellular Forms"; Latham & Todd (Mutator VR, *Leonardo*); Nervous System Floraform; iq articles (Mandelbulb, 3D Julia, palettes); Geiss's MilkDrop authoring guide; Barré-Brisebois & Bouchard GDC 2011 (translucency); Ahrens et al. 2013 *Nat Methods*; Livet et al. 2007 *Nature* (Brainbow).
- **Perception:** Bogdanov et al. 2022 ISMIR (MusAV); Aljanaki et al. 2017 (DEAM); Foscarin et al. 2024 (Beat This!); Heydari et al. (BeatNet+).
