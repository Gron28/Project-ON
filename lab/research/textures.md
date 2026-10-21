# Research: song-driven skin generators (height / AO / internal flow)

Date: 2026-10-08. Scope: per-song procedural surface for the ray-marched liquid-metal being
(Electron + three.js WebGL2, Intel Arc 140V). Read-only research; no code changed.
Source status: [v] = fetched and checked this session; [m] = from memory / well-known, verify before quoting.

---

## 0. Diagnosis of the current skin (from `renderer/skin/lenia.mjs`)

- 192x96 equirectangular HalfFloat, sampled with `textureLod(..., 0.0)` by direction (`skinUV`).
- Why it cannot look crisp: a blob ~600 px across has ~1900 px of equator over 192 texels, so
  ~10 screen px per texel, bilinear. Equirect also pinches at the poles (texels shrink to points),
  and the Lenia Laplacian is anisotropic there.
- So for any new generator, resolution and parameterisation matter as much as the algorithm.
  Two fixes, use both:
  1. **Bake target**: cube map 6x256^2 (or an octahedral map 512^2) RGBA16F. No pole pinch, ~4-5x
     more texels per screen pixel. Stateful sims (RD/MST) can stay at 6x128^2 and still beat equirect.
  2. **Analytic detail at the hit point**: stateless families (CPPN, Kleinian, folds) can be evaluated
     per pixel only at the final ray hit (for normals/AO/micro-height), so edges are pixel-crisp
     regardless of bake resolution. The march loop itself only reads the baked map.

Proposed channel contract (keeps the "never painted colour" rule):
R = height (displacement), G = cavity/AO (height minus blurred height), B = flow/age (internal
movement; drives sub-surface shimmer / anisotropy), A = family mask / edge.

---

## 1. projectM / MilkDrop: what to borrow

Sources: projectM https://github.com/projectM-visualizer/projectm [v] (C++, LGPL-2.1; expression
evaluator https://github.com/projectM-visualizer/projectm-eval [v]); MilkDrop preset authoring guide
https://www.geisswerks.com/milkdrop/milkdrop_preset_authoring.html [v]; Butterchurn (WebGL MilkDrop
in JS) https://github.com/jberg/butterchurn, `src/audio/audioLevels.js` [v].

How presets map audio:
- Three bands: bass 20-320 Hz, mid 320-2800 Hz, treb 2800-11025 Hz (Butterchurn) [v].
- **Everything is relative**: `bass = imm / longAvg`, `bass_att = avg / longAvg`, so 1.0 = "normal for
  this song", <0.7 quiet, >1.3 loud [v]. Short avg rate 0.2 rising / 0.5 falling, long avg 0.992 per
  frame at 30 fps (rate^(30/fps)) [v]. This is why any preset "works" on any song, and also why
  MilkDrop alone does NOT make songs look different: absolute character is normalised away.
- Per-frame equations (once per frame: zoom, rot, warp, cx, cy, dx, dy, sx, sy, decay, q1..q32) and
  per-vertex equations on a warp mesh (meshx x meshy, typically 8-128 x 6-96) using x, y, rad, ang [v].
- Warp shader: samples the previous frame at warped UV, multiplies by decay (~0.97-0.98), writes back:
  the persistent feedback buffer. Composite shader: display-only, does not persist [v].
  GetBlur1/2/3 and noise_lq/mq/hq are available to both [v].
- Musicality advice in the guide: drive motion from bass/mid/treb, use `_att` for slow organic motion,
  stagger oscillator frequencies (1.13/1.23/1.33) to avoid lock-step, decay + centre darkening to
  avoid whitewash [v].

Borrow for the skin:
1. **Two-clock audio**: absolute song descriptors pick WHAT the skin is (genome); MilkDrop-style
   relative values (x / longAvg) drive HOW MUCH it moves now. Same song = same genome = stable;
   different songs = different genomes.
2. **Feedback warp on the baked skin map** (an IFS in image space): each frame
   `skin_t = decay * skin_{t-1}(warp(dir)) + (1 - decay) * generator(dir)`, warp = rotation about a
   song-chosen axis + zoom toward a pole + small curl-noise displacement; amounts from `bass_att`,
   `mid_att`, beat phase. Gives "internal movement" to every family, including the stateless ones,
   for ~0.1 ms at 6x256^2.
3. The q-variable pattern: one small uniform block of per-song constants shared by all passes.

---

## 2. Chaotic maps / attractors as density height maps

Formulas:
- Clifford [v, Bourke https://paulbourke.net/fractals/clifford/]:
  x' = sin(a y) + c cos(a x); y' = sin(b x) + d cos(b y). Examples (a,b,c,d): (-1.4,1.6,1.0,0.7),
  (1.6,-0.6,-1.2,1.6), (1.7,1.7,0.6,1.2), (1.5,-1.8,1.6,0.9).
- Peter de Jong [v, https://paulbourke.net/fractals/peterdejong/]:
  x' = sin(a y) - cos(b x); y' = sin(c x) - cos(d y). Examples: (1.641,1.902,0.316,1.525),
  (0.970,-1.899,1.381,-1.506), (1.4,-2.3,2.4,-2.1), (-2.24,0.43,-0.65,-2.43).
- Ikeda [v, https://paulbourke.net/fractals/ikeda/]: z' = a + b z exp(i k - i p / (1 + |z|^2)),
  a = 0.85, b = 0.9, k = 0.4, p = 7.7. Common real form [m]: t = 0.4 - 6/(1 + x^2 + y^2),
  x' = 1 + u(x cos t - y sin t), y' = u(x sin t + y cos t); chaotic for u > ~0.6, nicest 0.7-0.95.
- Gumowski-Mira [m]: F(x) = a x + 2(1 - a) x^2 / (1 + x^2); x' = b y + F(x); y' = -x + F(x').
  b ~ 0.93-1.0 (b = 1 conservative, "fish/bird" mosaics), a roughly in [-0.8, 0.4]; very sensitive to a.
- Henon [m]: x' = 1 - a x^2 + y, y' = b x; classic (1.4, 0.3). Narrow chaotic region, little variety: skip.
- Lorenz [m]: dx = s(y - x), dy = x(r - z) - y, dz = x y - b z; (10, 28, 8/3). ODE, one recognisable
  shape: low variety. More varied 3D ODEs: Thomas (b ~ 0.18-0.21), Aizawa, Halvorsen [m].
- Field-Golubitsky symmetric icons [formula m; Bourke https://paulbourke.net/fractals/symmetryinchaos/
  v confirms 5 params lambda, alpha, beta, omega, gamma + degree n, lambda usually in [-3, 3], alpha of
  opposite sign]: z' = (lambda + alpha z conj(z) + beta Re(z^n) + i omega) z + gamma conj(z)^(n-1).
  n-fold symmetric, reads as radiolarian/diatom; n can follow tonal clarity.

Rendering: density histogram, not plotted points [v Bourke]. Increment a grid cell per visit, run long,
tone-map afterwards, e.g. h = log(1 + count) / log(1 + max) (log reveals the filaments) [m].

Stable/interesting parameters, Sprott's method [v landing pages https://sprott.physics.wisc.edu/sa.htm,
https://sprott.physics.wisc.edu/pubs/paper203.htm]: random coefficients, iterate, keep only bounded
orbits with positive Lyapunov exponent; "the most visually appealing cases are those with small
Lyapunov exponents and correlation dimensions somewhat greater than one" [v]. Aks & Sprott 1996
(Empirical Studies of the Arts) report preference peaking near D ~ 1.3 [m]. Practical filter:
LE in (0.01, 0.4), box-count D in (1.15, 1.6), bounding box not tiny, histogram coverage 5-40%.

GPU approach on three.js / WebGL2 (no compute shaders, no atomics):
- 256k orbits in an RGBA32F "position texture" (512x512). Iterate pass: one full-screen draw applies
  the map 4-16 times per frame. Splat pass: `THREE.Points` reading positions in the vertex shader,
  additive blending into an R16F/R32F histogram that decays (MilkDrop decay), so it converges and can
  morph when parameters change.
- Onto the sphere: 2D maps via an octahedral unfold with mirror symmetry (seams hidden by the
  symmetry), or 3D ODE attractors splatted by direction normalize(p - c), which is seamless.
- Cost estimate on the Arc 140V: iterate 262k x 8 ~0.05 ms; splat 262k points with additive float
  blending ~0.5-1.5 ms (ROP-bound; keep the target small, 6x256^2 or 512^2). Parameter search on the
  CPU at song load: 500 candidates x 3k iterations = 1.5M map evals, a few ms in JS.
- Clifford/de Jong over [-3, 3]^4 have a large chaotic fraction and the widest shape diversity for the
  least code: the best "very different song to song" family. But shape is NOT continuous in the
  parameters (bifurcations, sudden collapse to cycles). Pick per song/section, validate with the
  Lyapunov filter, and crossfade histograms instead of lerping parameters.

---

## 3. Circle inversion / Kleinian limit sets

Sources: Jos Leys, "A fast algorithm for limit sets of Kleinian groups with the Maskit
parametrisation", 2017, http://www.josleys.com/articles/Kleinian%20escape-time_3.pdf [v, read];
Mumford, Series, Wright, *Indra's Pearls* (CUP 2002) [m]; iq "Apollonian" Shadertoy
https://www.shadertoy.com/view/4ds3zn [m; Shadertoy returns 403 to the fetcher]; knighty
"Pseudo Kleinian" (Fragmentarium "Knighty Collection"; search Shadertoy for "pseudo kleinian") [m];
Kali's kaliset / Kleinian variants on Shadertoy [m].

Maskit algorithm (per pixel, escape-time), from the PDF [v]:
- Generators a: z -> (t z - i)/(-i z), b: z -> z + 2; inverses A: z -> i/(i z + t), B: z -> z - 2;
  t = u + i v (u = 2, v = 0: classic tangent-circle chain; u = 1.95, v = 0.07: spirals).
- Loop: if Im z < 0 or Im z > u, stop (outside). Wrap x into the strip between line 1 and line 2:
  x -> (x + 2N - 1 + v y / u) mod 2 - 1 - v y / u. Below separation line 3 apply a, else A.
  Stop on leaving the strip (colour by side + iteration count) or on a detected 2-cycle (limit set).
- Separation line: y = u/2 + f K u (1 - exp(-M |x + v/2|)), f = +1 if x >= -v/2 else -1.
- Cusp groups (trace of a^n B^m = 2) give the dramatic spirals, e.g. the 2/15 cusp
  t = 1.85738240046052 - 0.0762580599328681 i.
- "800x227 px in < 1 s on an i7 CPU" [v]: trivial on a GPU.

Fit to the being: Mobius maps act on the Riemann sphere, which is the being's surface. Stereographically
project the surface direction, zoom/rotate in the complex plane, run the 2D algorithm, and use
iteration count / distance to the limit set as height. Seamless by construction, pixel-crisp when
evaluated at the hit point. Height: smoothstep on log(dist), with dist estimated from the running
derivative of the Mobius chain (accumulate |dz'/dz|) [m].

3D option (inside the SDF), iq Apollonian DE [m]:
  scale = 1; repeat 8: p = -1 + 2 fract(0.5 p + 0.5); r2 = dot(p, p); k = s / r2; p *= k; scale *= k;
  d = 0.25 |p.y| / scale. knighty's pseudo-Kleinian = box fold + sphere inversion, ~10-20 iterations [m].
Cost: as a full 3D DE inside the march loop, ~8-20 iterations x 80-120 march steps at 1080p, est.
4-10 ms on the Arc 140V, too much on top of the existing body. As a 2D height on the sphere,
~20-40 iterations per eval: bake 6x256^2 ~0.1-0.2 ms, per-pixel hit eval ~0.3-0.6 ms. Use the 2D version.

Look: ornamental, lacy, circles within circles, spirals at cusps; strongly "mathematical". Very
different from RD/attractors, so it is the family for tonal, consonant, slow music.

---

## 4. Morphogenesis

Gray-Scott [v Karl Sims https://www.karlsims.com/rd.html; Pearson classes v
https://mrob.com/pub/comp/xmorphia/pearson-classes.html; Pearson 1993, Science 261 m]:
  A' = A + (DA lap(A) - A B^2 + f (1 - A)) dt; B' = B + (DB lap(B) + A B^2 - (k + f) B) dt [equation form m]
  DA = 1.0, DB = 0.5, dt = 1, 3x3 Laplacian: centre -1, edges 0.2, corners 0.05 [v].
  Pearson classes (F, k) [v]: alpha 0.010/0.047 waves + spirals; beta 0.014/0.039 chaotic voids;
  gamma 0.022/0.051 branching worms; delta 0.030/0.055 hex negative spots; epsilon 0.018/0.055 unstable
  solitons; zeta 0.022/0.061 stable spots; eta 0.034/0.063 spots + worms; theta 0.030/0.057 concentric
  rings; iota 0.046/0.0594 molecule-like spots; kappa 0.050/0.063 hedgerow mazes; lambda 0.026/0.061
  dividing hex solitons; mu 0.046/0.065 parallel stripes; nu 0.046/0.067 inert solitons; xi 0.010/0.041
  BZ-like large spirals; pi 0.062/0.061 mixed loops; rho 0.090/0.059 and sigma 0.090/0.057 soap bubbles.
  Coral f = 0.0545, k = 0.062; mitosis f = 0.0367, k = 0.0649 [v]. Spatially varying (f, k) (by latitude
  or by a CPPN) puts several classes on one body.
  Diversity: high, but everything reads as "RD" (spots/stripes/mazes). Very cheap. Best as the
  internal-flow layer (B channel); spirals (alpha, xi) read as living tissue.

Multi-scale Turing (McCabe) [v Softology https://softologyblog.wordpress.com/2011/07/05/multi-scale-turing-patterns/;
paper J. McCabe, "Cyclic Symmetric Multi-Scale Turing Patterns" m]:
  for each scale s: act_s = blur(grid, ra_s); inh_s = blur(grid, ri_s); var_s = blur(|act_s - inh_s|, rv)
  best = argmin_s var_s per pixel; grid += (act_best > inh_best ? +amt_best : -amt_best); renormalise to [-1, 1].
  Knobs: number of scales (3-6), inhibitor/activator ratio (2-3x), radius spread (e.g. 50/25, 10/5,
  5/2.5, 1/0.5), per-scale step amounts, symmetry order (average with n-fold rotated copies after the
  blurs, before the variation step) [v]. Small step amounts give calm evolution [v].
  The most "fractal organic" family (nested labyrinths, coral of coral); its look changes a lot with
  scale ratios and amounts. Best morphogenesis option for "crisp fractal".
  GPU: blurs via the mip chain or 2-3 box passes per scale; at 6x128^2 or 256x128 with 4 scales,
  ~12-20 passes, est. 0.4-1.0 ms/frame (pass overhead dominates on an iGPU). Converges in ~100-300 steps
  (2-5 s), so treat it as slow, section-level growth: it grows the song's skin over time.

Gierer-Meinhardt [m, Meinhardt, *The Algorithmic Beauty of Sea Shells*]:
  a' = rho a^2 / (h (1 + kappa a^2)) - mu_a a + Da lap(a) + rho_0; h' = rho a^2 - mu_h h + Dh lap(h).
  Spots vs stripes via saturation kappa. Same look space as Gray-Scott, no extra variety: skip.

Cyclic CA [m, Griffeath]: N states, range r, threshold T; a cell advances to the next state if >= T
  neighbours hold it. Spirals and "demons", very cheap, but blocky/digital at low resolution.
  Optional as a B-channel flow pattern only.

Differential growth [m, Hoff https://inconvergent.net/generative/differential-line/]: polyline/mesh
  growth, not a field; needs geometry or the SDF of a line network, so it is expensive and off the
  texture pipeline. Skip for the skin (maybe later as body geometry).

Sphere caveat for every stateful sim: the equirect Laplacian is wrong near the poles. Run on a cube map
with edge-stitched sampling (WebGL2: 6 render targets + neighbour lookup by direction) or, simpler,
an octahedral map with mirrored-edge wrap (single 2D target).

---

## 5. CPPN (Stanley 2007) as a song-seeded 3D height field

Sources: K. O. Stanley, "Compositional pattern producing networks: A novel abstraction of development",
Genetic Programming and Evolvable Machines 8(2), 2007 [m]; Picbreeder (Secretan et al., 2008/2011) [m];
D. Ha, "Generating abstract patterns with TensorFlow" (otoro, 2016)
https://blog.otoro.net/2016/03/25/generating-abstract-patterns-with-tensorflow/ [v: inputs x, y, r plus an
8-d latent z; 3 tanh layers x 32; N(0, 1) weights; sigmoid or 0.5 sin + 0.5 output; tried softplus, abs,
sqrt, gaussian]; Mordvintsev et al., "Differentiable Image Parameterizations", Distill 2018, CPPN
section https://distill.pub/2018/differentiable-parameterizations/ [m]; Lehman & Stanley, novelty
search, Evolutionary Computation 2011 [m].

Why it fits: stateless, analytic, seamless on a sphere when the inputs are the 3D direction, crisp at
any resolution, huge variety from ~200 numbers, and the user's reference image (symmetric black/white
fields, rings, grids) is exactly CPPN output.

Node set (each node is a "regularity primitive", Stanley's key idea [m]):
  sin(x)            repetition: grids, rings
  gauss exp(-x^2)   bilateral symmetry, blobs
  abs(x)            mirror symmetry, creases
  tanh / sigmoid    thresholding: crisp black/white regions
  tri(x) = 1 - 2|fract(x) - 0.5|   crisp sawtooth repetition
  identity; optional x*y multiplicative node for interference
Inputs: u = (x, y, z) unit direction (optionally symmetry-folded first: abs() for mirror planes, or an
  icosahedral fold), rho = length(u.xy) (radial about the song's axis), bias 1, plus a 4-8 d latent l
  that moves with the music.
Fixed topology for the shader: 3 hidden layers x 8 units, per-unit activation chosen by the genome.
  h1 = f(W1 [u, rho, l, 1]); h2 = f(W2 h1 + b2); h3 = f(W3 h2 + b3); out = sigmoid(k (w4 . h3 + b4)).
  k = crispness gain (2 soft, 20 binary). ~250 MADs + 24 transcendentals per eval.
Height/AO: R = out; G = out - blur(out) (cavity), computed after the bake.
Weight scale sigma_w and input scale s set spatial frequency (higher = busier): the main density knob.

Song seeding:
- Genome g0 is a deterministic function of the song: weights = sigma_w * normalise(R e), where e is the
  EffNet-Discogs 1280-d embedding the analyzer already computes and R is a fixed random Gaussian matrix
  (constant app-wide seed). Similar songs get sibling skins; the same song gets the identical skin.
  Activation per unit = hash(song id, unit), biased by features (tonal -> more sin/gauss; noisy/rough ->
  more abs/tri/tanh).
- Evolve while listening (Picbreeder with the music as selector): at each section boundary or drop,
  make K = 8 mutants (Gaussian noise on 10-20% of weights, occasional activation swap), bake each at
  64^2, score by novelty (distance of a small descriptor, e.g. radial power spectrum + edge density +
  symmetry score, to an archive of this song's previous skins) inside a complexity band (Latham's
  curated gene limits), pick the best, and crossfade weights over 4-8 bars. Latent l follows chroma /
  tonal centroid continuously, so there is slow drift between sections.
- Per frame only the latent and the MilkDrop-style relative levels move; the genome is fixed per section.

Cost on the Arc 140V (~4 TFLOPS FP32 peak, assume ~30-40% achieved): bake 6x256^2 = 393k evals x
~300 flops ~0.12 GFLOP, about 0.1 ms; per-pixel hit evaluation with 4 taps for normals over ~40% of a
1080p frame: ~0.83M px x 4 x 300 ~1 GFLOP, about 0.5-0.8 ms. Never evaluate it inside the march loop.

---

## 6. Audio features to parameters

Principles:
1. **Two clocks** (from MilkDrop): song/section-level ABSOLUTE descriptors choose the genome and the
   family mix; frame-level RELATIVE values (x / own long average) drive amplitude and motion.
   Stability comes from the first, responsiveness from the second.
2. **Normalise absolute descriptors against a corpus**, not per song: map each descriptor to its
   percentile in a reference distribution (precompute on ~200 varied tracks) so genres spread across
   the whole parameter range instead of clustering in the middle.
3. **Aggregate robustly**: median over 10-30 s windows, update at section boundaries, hysteresis on
   family switches, slew-limit everything else.
4. **Semantic axes + fingerprint**: interpretable features drive the big, meaningful knobs; an
   embedding/ID hash drives the fine genome, so two similar songs still differ in detail.
5. **Crossmodal correspondences** (Spence 2011, Attention, Perception & Psychophysics 73 [m]):
   higher pitch / brighter timbre <-> smaller, sharper, more angular, higher spatial frequency;
   louder <-> bigger; noisier/rougher <-> rougher, more granular, irregular visual texture;
   consonant/tonal <-> smooth, symmetric, regular. Bouba/kiki: sharp attacks <-> angular forms.

Mapping table (proposal, not validated):
| feature (aggregation) | parameter |
|---|---|
| spectral flatness / tonalness (song) | family choice: tonal -> Kleinian + CPPN(sin/gauss); noisy -> attractor + MST; edge jaggedness |
| key clarity / chroma entropy (section) | symmetry order (high clarity -> 6, 12, icosahedral; low -> asymmetric) |
| key / tonal centre (section) | phase on a parameter loop ordered by the circle of fifths (related keys -> nearby shapes; a modulation visibly rotates the skin) |
| spectral centroid (song median) | spatial frequency: CPPN weight scale, MST smallest radius, Kleinian zoom, histogram zoom |
| roughness / dissonance (section) | symmetry breaking: perturb fold planes, Kleinian v, mutation sigma |
| onset density, pulse clarity (section) | crispness gain k, RD/MST step amount |
| tempo / beat phase (frame) | feedback-warp rotation per beat, RD feed oscillation locked to bars |
| loudness range / crest factor (song) | relief depth (height amplitude ceiling) |
| bass_rel, bass_att_rel (frame) | displacement amplitude, warp zoom |
| treb_rel (frame) | micro-detail / AO contrast |
| arousal (MusiCNN, fast) | flow speed in the B channel, feedback decay |
| valence (slow, section) | open (spots, rings) vs closed (labyrinth, maze) topologies |
| novelty / section change | genome evolution step (CPPN mutation, new attractor params, MST reseed) |

---

## 7. Recommendation (ranked): one skin system, five generator families

Infrastructure first: move the skin to a cube map or octahedral map 512^2 RGBA16F with the R/G/B/A
contract above; one "skin bake" pass that evaluates up to two families (uniform-selected branch, which
is coherent and cheap) and crossfades; a MilkDrop-style feedback warp pass over the result; the march
loop reads the baked map (Lipschitz-safe: scale the step by 1 / (1 + amp * maxGrad)); the final hit
re-evaluates analytic families for crisp normals.

| rank | family | type | why | est. cost (Arc 140V) |
|---|---|---|---|---|
| 1 | CPPN on the sphere | analytic | widest variety per byte, seamless, crisp, song-seeded via embedding, evolves by novelty; matches the reference image | bake ~0.1 ms + hit eval ~0.5-0.8 ms |
| 2 | Multi-scale Turing (McCabe) | stateful | the most organic-fractal look; reuses Lenia's ping-pong infra; grows the skin over the song | ~0.4-1.0 ms/frame |
| 3 | Kleinian / Maskit / Apollonian, 2D on the Riemann sphere | analytic | crisp lace and spirals, symmetric, suits tonal music; the surface is the sphere Mobius maps act on | bake ~0.2 ms + hit ~0.5 ms |
| 4 | Attractor density (de Jong / Clifford + symmetric icons) | particle splat | maximum song-to-song difference; Sprott/Lyapunov filter keeps it beautiful; for noisy/electronic | ~0.6-1.6 ms |
| 5 | Gray-Scott as flow layer | stateful | cheap living motion in B (spirals alpha/xi, mazes kappa); Pearson classes as named presets | ~0.3-0.6 ms |

Budget: active pair + feedback + flow ~1.5-3 ms. All costs are estimates, not measurements.
Skip: Henon and Lorenz (low variety), Gierer-Meinhardt (duplicates Gray-Scott), differential growth
(geometry, not a field), 3D Kleinian DE inside the march (4-10 ms).

Validation idea (measurable): bake 30 songs from 6 genres and compute a descriptor per skin (radial power
spectrum + edge density + symmetry score). Distance between genres should exceed the within-song
(across-time) distance by at least 3x.
