# Absorption: research notes

Question: how can ON become hypnotic, in tune with the absorption of the moment, so that sitting with it for a while is absorbing, illuminating and uplifting (the self-transcendent kind of absorption, not dissociation or overload)?

Status: research and a proposed design. Only the rising forms are built (`RISE` in `being/index.html`, `lab/prototypes/fractal-body.html`). Written 2026-10-19.

Each finding below is labelled with how strong its evidence is.

## 1. What the research says

### Absorption in music comes from predictability, not intensity
- **Hove et al. 2016**, *Cerebral Cortex* 26(7):3116-24, "Brain network reconfiguration and perceptual decoupling during an absorptive state of consciousness". fMRI of 15 experienced shamanic practitioners listening to steady drumming, absorbed vs not. Absorbed, the default-network hub (posterior cingulate) became more central and more coupled to the control network (dACC, insula), and the auditory pathway was *less* connected. Their reading: the drumming is so predictable it can be gated out, which frees an extended inner train of thought "wherein integration and insight can occur". (Strong design, small N.)
- **Becker 2004**, *Deep Listeners: Music, Emotion, and Trancing*. Argues that deep emotional listening and ceremony absorption are one family: absorption, duration, a diminished sense of self, and a sense of special knowledge. (Ethnomusicology with physiological measures; a theory, not a trial.)

Design consequence: absorbed, ON should become *more* steady and predictable, not more reactive. Long periods (bars, phrases), continuous motion, no jolts. It should hold the pulse so reliably that the eye can let go.

### The music that supports peak experiences
- **Barrett, Robbins, Smooke, Brown, Griffiths 2017**, *Frontiers in Psychology* 8:1238. Practitioners rated the music that supports peak mystical experiences in psilocybin sessions; 22 pieces analysed. Peak-period music has regular, predictable phrase structure and orchestration, continuous forward motion that builds slowly, and *lower* perceptual brightness than the music before the peak. (A survey of experts plus signal analysis, not a controlled test.)

Design consequence: at the deepest point, slow continuous forward motion (an endless zoom into the fractal, a tunnel) and a dimmer, warmer, softer light, not a brighter one.

### The brain's own geometry
- **Klüver's form constants**: tunnels, spirals, honeycombs (lattices) and cobwebs recur across mescaline, migraine, falling asleep and flicker.
- **Bressloff, Cowan, Golubitsky, Thomas, Wiener 2001**, *Phil. Trans. R. Soc. B* 356:299-330. When V1's resting state goes unstable, the patterns that form, mapped back through the retina-to-cortex map, are exactly these form constants. These are the shapes the visual system makes by itself. (Mathematical model, well matched to reports.)
- **Amaya et al. 2023**, *PLOS ONE*. Closed-eye flicker at 3, 8, 10 and 18 Hz: Klüver forms and motion were strongest at 10 Hz rhythmic flicker; arrhythmic flicker at the same rate weakened them a lot.

Design consequence: the form constants are the most native "geometric and ethereal" vocabulary there is. Lattice and Geometry already sit close to honeycomb and cobweb; tunnel and spiral are missing. **But no strobing**: see §2.

### Fractals that calm rather than overwhelm
- **Hagerhall et al. 2008**, *Perception*. EEG while viewing fractals: dimension D ≈ 1.3 gave the highest frontal alpha (relaxed but attentive). Taylor's reported stress-recovery figure for D 1.3-1.5 comes from popular accounts; I could not find its primary paper.
- **Kaplan, Attention Restoration Theory**: "soft fascination" (clouds, leaves, water) holds attention without effort and leaves room for reflection; "hard fascination" (games, thrillers) consumes it. (Influential, but its terms are loosely defined, per Neilson et al.)

Design consequence: absorbed, sparse mid-complexity forms (D ≈ 1.3-1.5), slowly changing, nature-like. Today's Crystal and Coral are too dense for this. Hard-fascination tricks (fast cuts, glitches, sparkle storms) belong elsewhere.

### Awe, self-transcendence, connection
- **Yaden, Haidt, Hood, Vago, Newberg 2017**, *Review of General Psychology*. Self-transcendent experiences (flow, awe, peak and mystical experiences, love, mindfulness) share reduced self-salience and increased connectedness.
- **Chirico et al. 2017**, *Scientific Reports* 7. Awe = perceived vastness + need for accommodation. Immersive video raised awe, presence and parasympathetic activation compared with flat screens.
- **Glowacki et al. 2022**, *Scientific Reports* 12 (Isness-D). People in shared VR appear as luminous energy bodies, radiance concentrated at the heart. Ego-dissolution and mystical-experience scores were statistically indistinguishable from published psychedelic studies. (N = 58, compared against other studies, not head to head.)

Design consequence: vastness (forms whose scale opens past the body, depth that keeps going) and accommodation (structure that is lawful but never fully grasped: self-similarity that keeps revealing more). Radiance from the nucleus as the "heart".

### Breath
- HRV biofeedback (Lehrer & Gevirtz 2014, as summarised in Frontiers in Neuroscience 2020, doi 10.3389/fnins.2020.570400): breathing at the resonance rate, about 4.5-6.5 breaths/min, maximises respiratory sinus arrhythmia via the baroreflex, and is usually taught with on-screen visual pacing.

Design consequence: in deep absorption the body's slow swell can drift toward about 6/min, inviting the breath without asking for it. It would be a quiet, implicit invitation to slow breathing, never a guide.

### Sound and sight together
- Visuals driven by real-time audio analysis gave a slightly better aesthetic experience than randomised ones (Erdmann et al., *Frontiers in Virtual Reality*). Viewers preferred more frequent sync of musical and visual accents (Rogers & Gibson 2012, unpublished). The effects are small.

Design consequence: keep the sync tight (ON already corrects its latency). The bigger gains are in steadiness and form, not in more reactivity.

## 2. Safety and what not to do
- **Photosensitive epilepsy.** The absorption-inducing flicker band (3-30 Hz, strongest at 10 Hz) is also the risk band. WCAG 2.3.1: no more than 3 flashes a second, unless below the general and red flash thresholds (roughly 10% relative-luminance change; saturated red is more dangerous). ON must never strobe. Rhythmic modulation stays small in luminance and large in area or slow in time, and is never saturated red.
- **Not dissociation.** The target is the positive, empowering kind: reduced self-salience *with* connectedness and clarity (Yaden). Keep exits gentle and leave the person in charge: absorption is earned by the music and ends when the music changes; it is never forced.

## 3. Proposed design: an absorption organ
1. **Absorption depth** (`ABSORB.d`, 0..1): the mind's lock × groove × low surprise × time, integrated over tens of seconds. The serpents' absorption score (`flourish.mjs`) already integrates most of this. It falls quickly on surprise or a section change and rises slowly.
2. As depth grows:
   - motion slows to phrase scale, jolts and jitter fade, and every pulse-driven movement keeps exactly to the beat (predictability lets the eye let go);
   - rising moves toward the form-constant forms (lattice/honeycomb, cobweb, plus new tunnel and spiral forms), sparse (D ≈ 1.3-1.5), with mass forms (Julia) inside as a heart;
   - slow forward motion: an endless zoom into the self-similar form, about one octave per phrase;
   - light dims and warms, ether rises: a radiant nucleus and translucent lines;
   - the body's swell drifts toward about 6/min.
3. A peak inside absorption (chills, the drop): a brief opening (vastness: the forms expand past the window's mask), then a return to the steady state.

## 4. Open questions to test
- Does steadier mean more hypnotic for the user's music, or less alive? Compare A/B with a long, steady track.
- Is the 6/min swell felt as an invitation or as a distraction?
- What fractal dimension do the rising forms actually have (box-count on screenshots)?

## Sources
- Hove et al. 2016: https://pmc.ncbi.nlm.nih.gov/articles/PMC4898667
- Becker 2004: https://erudit.org/fr/revue/ethno/2005/v27/n2/014054ar.html (review)
- Barrett et al. 2017: https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2017.01238/full
- Bressloff et al. 2001: https://www.math.utah.edu/~bresslof/publications/01-1.pdf
- Amaya et al. 2023: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10089352/
- Klüver forms review: https://link.springer.com/article/10.1038/s41598-024-52372-1
- Hagerhall et al. 2008: https://journals.sagepub.com/doi/10.1068/p5918
- Attention Restoration Theory: https://en.wikipedia.org/wiki/Attention_restoration_theory ; critique: https://experts.umn.edu/en/publications/a-review-of-the-limitations-of-attention-restoration-theory-and-t/
- Yaden et al. 2017: https://journals.sagepub.com/doi/10.1037/gpr0000102
- Chirico et al. 2017: https://doaj.org/article/970dc3aeab664366bc927dd08e5920c7
- Glowacki et al. 2022: https://pmc.ncbi.nlm.nih.gov/articles/PMC9149675
- Resonance breathing review: https://frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2020.570400/full
- Music visualisation and aesthetics: https://labs.sonicfield.org/library/seeing-the-music
- WCAG 2.3.1: https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html
