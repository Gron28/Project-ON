# Fission into a particle organism: research notes

Question: past an internal "pressure" threshold, the liquid-metal body breaks into thousands of small shiny metal balls that self-organise as a particle-life / Particle Lenia organism (species, organelles, membranes, rings, clusters orbiting a core) and later merge back into the blob. What is feasible on this machine (Electron 44.5.1 / Chromium 152.0.7977.130, three 0.186.1, Intel Arc 140V "xe-2lpg" iGPU, 16 GB), and how should it be built?

Status: research plus two measurements (a WebGPU benchmark and a CPU recipe check, both described below). Nothing is built.

## 0. What was measured here

### 0.1 WebGPU from `file://` in this Electron

Probe: hidden `BrowserWindow`, `loadFile(probe.html)`, the project's own `node_modules/electron/dist/electron.exe`.

- `location.protocol = file:`, `navigator.gpu` present, the adapter resolves: vendor `intel`, architecture `xe-2lpg`.
- Features include `timestamp-query`, `subgroups`, `shader-f16`, `float32-filterable`, `float32-blendable`.
- Limits: `maxStorageBufferBindingSize` 2 GiB, `maxComputeInvocationsPerWorkgroup` 1024, 16 storage buffers per stage, `maxTextureDimension3D` 2048.
- Chromium logs "The powerPreference option is currently ignored when calling requestAdapter() on Windows" (crbug 369219127). That doesn't matter here because there is only one GPU.
- A WebGL2 context works in the same page next to the WebGPU device.

### 0.2 Particle-life step cost on the Arc 140V (WebGPU compute)

The kernel is raw WGSL with five passes per step:
1. clear the cell counters
2. count particles per cell with `atomicAdd`, which also gives each particle its rank inside its cell
3. a 256-thread workgroup exclusive scan over the cells
4. scatter the particles into cell order (the whole particle is copied, which keeps memory access coherent)
5. compute forces over the 27 neighbouring cells, then integrate

The force is Mohr's particle-life function, with r_max = 1 cell, beta = 0.3, 6 to 8 species, and a periodic box. Each run times 60 steps, first right after a random start ("uniform") and again after 1500 steps of self-organisation ("organised"). "nb" is the average and maximum number of neighbours within r_max.

| N | grid | binning only | uniform ms/step (nb avg/max) | organised ms/step (nb avg/max) |
|---|---|---|---|---|
| 16 384 | 16^3 | 0.29 ms | 0.51 (21/55) | 0.54 (26/121) |
| 32 768 | 16^3 | 0.37 | 1.18 (40/104) | 1.32 (57/329) |
| 32 768 | 24^3 | 0.40 | 0.55 (12/47) | 0.68 (16/79) |
| 65 536 | 24^3 | 0.32 | 1.32 (24/71) | 1.59 (32/205) |
| 65 536 | 32^3 | 0.37 | 0.95 (10/38) | 1.00 (14/87) |
| 100 000 | 32^3 | 0.29 | 1.56 (16/47) | 2.35 (21/105) |
| 20 000 | 8^3 | 0.22 | 3.53 (201/447) | 4.45 (337/1274) |
| 32 768 | 10^3 | 0.28 | 4.36 (172/480) | 5.07 (281/1335) |
| 65 536 | 12^3 | 0.44 | 11.99 (456/1608) | 12.05 (568/1962) |

Rule of thumb: **step ≈ 0.3 ms + N × nb_avg × ~0.5 to 0.7 ns**. The cost is set by the neighbour count, not by N.
- At a 3 to 4 ms simulation budget you can afford about 5 M neighbour pairs per frame, for example 32k particles with about 150 neighbours each, or 64k with about 70.
- Organised states cluster, so the maximum neighbour count reaches 4 to 6 times the average. That causes warp divergence, so budget with the organised column.
- For comparison, lisyarus reports binning at about 0.1 ms on a GTX 1060 with about 10k bins, and 65 536 particles in 2D, with the force pass as the bottleneck.

### 0.3 3D particle-life rule check (CPU, N = 800, 2000 steps)

The model is Mohr's force, friction half-life 0.04, dt 0.02, force factor 10. Clusters are found by single linkage at 0.45 r_max. Metrics: mean radius of each species from the cluster centroid, and normalised angular momentum L/Σ(r|v|).

- **Without a stiff collision term, cohesive species collapse.** Mohr's repulsion is bounded (at most −1 × the force factor per neighbour), so when about 800 mutually attracting particles pile up the summed attraction wins, and they collapsed to a radius of about 0.45 r_max. Real balls need a separate short-range, high-gain collision force, which is also what lisyarus uses.
- **Spawning at the wrong density explodes.** When 1200 particles start packed at about 113 neighbours each, the repulsion core throws them out to about 150 r_max. Spawn spacing has to match the equilibrium spacing, or the burst has to be shaped on purpose (section 4).
- **The local rules make a swarm of small cells, not one organism.** With a spherical container plus a collision term, every matrix tried, including the hand-designed "membrane", "chaser ring" and "organelle" recipes, settled into about 10 clusters of 70 to 150 particles, each 0.3 to 0.5 r_max across. Layering inside those clusters was weak, and rotation was low (L ≈ 0.02 to 0.07; one cluster of the symmetric control reached 0.78).
  - The structure scale is r_max. A single cell with organelles and a membrane needs either a cell several r_max wide, which means many more particles per cell, or a second, body-scale force.
  - The textbook recipes are hypotheses. They are not reliable in 3D at this scale.

The scripts that produced 0.2 and 0.3 are in the session scratchpad, which is temporary. Port them to `lab/experiments/07-particles-*.mjs` if this goes ahead.

## 1. Particle Life: rules and structures

- **Ventrella, "Clusters"** (asymmetric multi-species particle system, video from 2017, still developed in 2025). It is the origin of the genre and is credited as the inspiration for Tom Mohr's Particle Life and ciphrd's Atomic Clusters. https://www.ventrella.com/Clusters/
- **Tom Mohr, particle-life (Java)**. The force on i from j, at distance r normalised by r_max, with beta (`rmin`) = 0.3:
  `F = r/beta − 1` for r < beta (universal repulsion), and `a_ij · (1 − |2r − 1 − beta| / (1 − beta))` for beta < r < 1, where a_ij ∈ [−1, 1] comes from the species matrix.
  The framework's accelerators return `Vector3d`, so it is 3D-capable. https://particle-life.com/java-framework/accelerators.html , https://github.com/tom-mohr/particle-life-app
- **Hunar Ahmad, particle-life**: `rule(group1, group2, g)` with `F = g/d` inside radius 80, velocity damped by 0.5 each step, three colours of 200 particles, g about ±0.34, and a 3D JavaScript demo. https://github.com/hunar4321/particle-life
- **Asymmetry is the engine.** When a_ij ≠ a_ji, Newton's third law is broken: A chases B while B flees A. That non-equilibrium drive is what makes the system move, chase and rotate. A symmetric matrix relaxes to static blobs.
- **Primordial Particle System** (Schmickl, Stefanec & Crailsheim 2016, Sci Rep). This is the best-documented emergence of *cells with a core and a membrane, which also reproduce*, and it comes from a single species with one law:
  `Δφ = α + β · N · sign(R − L)` with ⟨r = 5, α = 180°, β = 17°, v = 0.67⟩.
  Cells emerge at about 0.08 particles per unit area, and the life cycle goes spores (about 14 particles) → mature spores (about 18) → cells (about 48, with a dense core, a membrane and inner space) → division. The model is 2D, and there is no published 3D result that I verified. https://pmc.ncbi.nlm.nih.gov/articles/PMC5346932/
- **What reliably gives a "cell with organelles"** in 3D, from section 0.3 plus the general behaviour of these models: a *body plan* term on top of the local rules.
  - The membrane species gets a soft radial potential toward the body radius R_body, and the core species gets one toward the centre.
  - Organelle species get strong self-cohesion and repulsion toward the other organelle species.
  - Orbiting rings come from a tangential (swirl) term around an axis, or from an asymmetric pair confined to a radius band.
  - The local matrix then supplies texture and life (wobble, chasing, budding), and the body plan supplies a shape that reads as a cell.

## 2. Particle Lenia

Mordvintsev, Niklasson & Randazzo (2022, Google Research): https://google-research.github.io/self-organising-systems/particle-lenia/

- Lenia field: `U(x) = Σ_i K(|x − p_i|)`, with the ring kernel `K(r) = w_K exp(−(r − μ_K)²/σ_K²)`.
- Growth: `G(u) = exp(−(u − μ_G)²/σ_G²)`.
- Repulsion: `R(x) = c_rep/2 Σ_i max(1 − |x − p_i|, 0)²`.
- Energy: `E = R − G(U)`. Particles follow `dp_i/dt = −∇E(p_i)`, local gradient descent.
- Example parameters: μ_K = 4, σ_K = 1, w_K = 0.022, μ_G = 0.6, σ_G = 0.15, c_rep = 1, dt ≈ 0.1. Runs used 200 to 800 particles in 2D. The 3D run used **256 particles** and produced mushroom-shaped gliders.
- What emerges: rotors and gliders. A 200-particle rotor scales to 800 particles if the kernel and density are rescaled. Multiple species are possible in principle but were not explored.
- **3D feasibility at 30k.** The kernel reaches μ_K + 3σ_K ≈ 7 repulsion radii, which is about 1400 neighbours at liquid packing. That gives about 42 M pairs per step, or about 25 to 30 ms on this iGPU using the section 0.2 rule. **Exact Particle Lenia at 30k is too expensive.**
- **Workaround: particle-mesh (PM).** U is a sum of kernels, so it can be computed on a grid instead:
  1. splat the particles into a 64³ grid (atomics)
  2. convolve with K, either with an FFT or with K approximated as a difference of Gaussians, which is separable into 3 passes per Gaussian
  3. sample ∇U at each particle
  4. handle the repulsion with the short-range neighbour grid
  
  The cost is O(N + 64³), about 1 ms. Treat it as a "cytoplasm" field that shapes the organism at body scale. The small-N gliders and rotors will not transfer as-is.

## 3. GPU implementation (20k to 100k on the Arc iGPU)

**WebGPU compute (recommended for the simulation)**
- Use the five-pass counting-sort binning from section 0.2 (lisyarus describes the same scheme), with a cell size of r_max and a 27-cell neighbourhood.
- three 0.186 ships most of the parts:
  - `instancedArray` / `storage` (`src/nodes/accessors/Arrays.js`)
  - `atomicAdd`, `workgroupArray`, `workgroupBarrier`
  - `storageTexture3D` / `textureStore`
  - `renderer.compute()` / `computeAsync()`
  - `examples/jsm/gpgpu/CountingSort.js`, which provides the reset, histogram, prefix and scatter passes. Its prefix pass is a serial loop on **one thread** over `binCount`. That is fine for 4096 bins, but use a workgroup or subgroup scan (as in the probe, about 0.3 ms total) for 13k to 32k cells.
- **Catch 1: the existing page can't move to `WebGPURenderer` cheaply.** Its `NodeLibrary` only converts the built-in Mesh*/Line*/Points/Sprite materials, and there is no mapping for `ShaderMaterial`. The 130 KB GLSL ray-marched body would have to be ported to TSL or WGSL.
- **Catch 2: two copies of three.** `three.webgpu.js` (2.3 MB) is self-contained and does not import `three.core.js`, so loading it next to `three.module.js` loads two copies of the core classes.
- **Recommendation:** write the particle layer in **raw WebGPU** on its own transparent canvas stacked over the WebGL canvas. That means about 300 lines of WGSL and JS, with camera matrices copied from the THREE camera as Float32Arrays.

**WebGL2 (fallback)**
- There are no atomics and no scatter. GPU Gems 3 ch. 29 builds the grid with depth and stencil tricks: 4 passes, at most 4 particles per voxel, and a voxel must be no larger than the particle diameter. With r_max ≈ 5 ball diameters the neighbourhood becomes 11³ voxels, which is impractical. https://developer.nvidia.com/gpugems/gpugems3/part-v-physics-simulation/chapter-29-real-time-rigid-body-simulation-gpus
- A brute-force O(N²) texture loop caps out at about 4 to 8k particles.
- **The viable WebGL2 option is particle-mesh**, run inside the existing renderer:
  1. keep particle state in RGBA32F textures, ping-ponged
  2. splat gl.POINTS additively into a 64³ per-species density atlas (512×512, 4 species per RGBA target, MRT for 8)
  3. blur each species field with the kernel (difference of Gaussians, separable)
  4. compute the force on each particle as Σ_j a_ij ∇Φ_j
  
  Short-range collision then comes from a pressure ∇ρ term on a finer grid, so the balls overlap a little, which reads as liquid.
- Its advantages: one canvas, the blob's own depth buffer, and the density atlas can be ray-marched by the existing `map()` during transitions.
- Its costs: forces are smoothed at grid scale, and thin one-ball membranes need cells no larger than r_max/4.

## 4. Rendering thousands of shiny balls that match the blob

- **The blob's environment is analytic, not a cube map.** `env(r, p)` in `being/index.html` (around line 305) is a procedural sky plus horizon and side bands plus a core glow built from `uLight`, `uCrisp`, `uEnv`, `uGlow` and `uCoreR`. The metal is `f0 = uMetal` tinted by note lobes, with Schlick-ish Fresnel `pow(1 − n·v, 5)`. Porting those 15 lines to WGSL and feeding the same uniforms gives balls an identical reflection model, so the match is cheap.
- **Ball rendering: instanced sphere impostors.**
  - Draw one quad per particle with vertex pulling (`particles[vertex_index/6]`, as lisyarus does). Solve the ray-sphere hit, write `frag_depth`, reflect into `env()`, tint per species, and cheap AO from the density grid.
  - Writing frag_depth disables early-z, so use a depth pre-pass or accept the overdraw.
  - Estimate, not measured: 32k balls at about 150 px each is about 5 M fragments, roughly 0.5 to 1.5 ms.
- **Smoothing control: screen-space fluid rendering** (van der Laan, Green & Sainz 2009, "Screen Space Fluid Rendering with Curvature Flow", I3D; Green, GDC 2010).
  1. render the sphere depth
  2. smooth it with a bilateral filter or curvature flow, at half resolution
  3. reconstruct normals and shade with the same `env()`
  
  The number of smoothing iterations is a continuous control from "separate balls" (0) to "one liquid surface" (many), which makes it the natural transition control. Estimated 0.5 to 1 ms at half resolution over the body's bounding rect. (These sources are well known but were not re-fetched for this note.)
- **Voxelised density ray-march for the final merge.**
  1. splat the particles into a 64³ to 96³ field (`atomicAdd` into a u32 buffer, about 30k × 8 corners), then copy it into an r16f 3D texture
  2. ray-march the iso-surface with the same shading
  
  The result is smooth and blob-like but loses ball identity. Use it only while particles converge. Estimated 1 to 3 ms (as costly as the blob itself, which is hidden at that point).
- **Rejected options:** smooth-min over particle spheres inside the ray-marcher (O(N) per step, at most about 64 particles), and per-pixel metaballs over all particles.

**Transitions**
- **Blob to particles (fission).**
  1. At the trigger, evaluate the real GLSL `map()` on a 64³ grid in WebGL (render it to a 512×512 atlas), read it back asynchronously (PBO plus `fenceSync`, 262k half floats, no stall), and upload it to WebGPU.
  2. Rejection-sample the spawn positions inside `d < 0` at the equilibrium spacing (section 0.3), biased toward the surface. Normals come from ∇d.
  3. Initial velocity is the outward normal × the excess pressure, plus a tangential swirl.
  4. In the same frame, hide the WebGL blob and draw the particles with screen-space-fluid smoothing at maximum, so they read as the blob. Then relax the smoothing to zero over about 0.6 to 1 s while the burst plays out, and the blob visibly shatters into balls.
  5. Foreshadowing before the break: stretch the existing note lobes (`uL`) into necks, Plateau–Rayleigh style. Necks pinch once their length passes about π × their diameter, and the fastest-growing wavelength is about 9.02 × the neck radius. https://en.wikipedia.org/wiki/Plateau%E2%80%93Rayleigh_instability
- **Particles back to blob (merge).**
  1. Ramp up a "surface tension" term (cohesion toward the centroid plus raised friction) while ramping the matrix gains down to 0.
  2. Raise the screen-space-fluid smoothing, then switch to the density ray-march.
  3. When the RMS deviation of the iso-surface from the blob's base radius drops below a threshold, crossfade the canvases over 200 to 400 ms, with both showing a near-sphere at the same radius.

## 5. Pressure: physical analogues and a model

**Physics to borrow**
- **Rayleigh limit (Coulomb fission).** A charged drop splits when Q > Q_R = 8π √(ε0 γ r³), the standard Rayleigh 1882 result (formula from memory, not re-fetched). Charge pushes outward and surface tension γ holds the drop together. At the limit the drop sheds **only about 1.0 to 2.3 % of its mass but 10 to 18 % of its charge** as fine offspring droplets, then recovers. https://en.wikipedia.org/wiki/Electrospray_ionization
- **Weber number.** We = ρv²l/σ, inertial pressure over Laplace pressure. https://en.wikipedia.org/wiki/Weber_number
  Classic breakup regimes for a drop hit by a sudden flow (Pilch & Erdman 1987; Guildenbecher et al. 2009, from memory, not re-fetched):
  - vibrational below about 11
  - bag 11 to 35
  - multimode 35 to 80
  - sheet thinning 80 to 350
  - catastrophic above about 350
- **Plateau–Rayleigh instability:** described above, for the necks.

**Model**

The repo `CLAUDE.md` sets the convention that sound features never drive shape directly and that the body reads the mind's states. So pressure lives in `mind.mjs` as a cited state variable.

- **Charge, the slow drive.**
  `dq/dt = k_A·max(0, A − aHome) + k_D·daAnt + k_G·groove·lock·(1 − bored) − q/τ_q`, with τ_q ≈ 30 s.
  The inputs are sustained arousal above the being's own home base, build-up anticipation and long grooves. Calm songs leak the charge away.
- **Surface tension, the being's resilience.**
  `σ = σ0 · (0.6 + 0.4·energy) · (1 + h)`
  A tired being bursts more easily. The habituation term h rises after each fission and decays over about 3 to 5 minutes (a refractory period, like the existing startle habituation).
- **Pressure.** `P = q / σ`, normalised so that the Rayleigh limit is P = 1.
- **Partial fission (Coulomb jets), the frequent and cheap case.**
  - When P is between 0.7 and 1, a lobe tip throws a jet of about 1 to 2 % of the balls (a few hundred). They orbit and fall back within 3 to 6 s.
  - Each jet discharges about 15 % of q.
  
  This is the physics' own pressure-relief valve. It makes full fission rare unless the drive is sustained, and it foreshadows the full event.
- **Full fission, two ways to trigger it.**
  - The slow trigger, Rayleigh: P ≥ 1 held for at least 1.5 s.
  - The fast trigger, Weber: a momentary impulse such as a drop that resolves a build-up (`startle` × `daPhasic` right after `daAnt` > 0.5), scaled by the body's size and divided by σ, crossing a critical value while P > 0.6. The analogue of We above about 80 is breakup by "the drop".
- **Hysteresis (Schmitt trigger).**
  - The organism lives for at least 20 s.
  - Merge begins when P < 0.35 for 3 s, or after at most about 90 s, or at a song change.
  - After merging, the threshold is raised by h.
- **Calibration target:** zero fissions for most calm songs, one per intense song at most, and jets a few times per minute at high arousal. Fit k_A, k_D and k_G with a lab experiment that counts events per hour over the WAV corpus, the same way experiments 03 and 04 calibrate criticality.

## 6. The interaction matrix from the song (stable, per song)

Mirror the existing pipeline in `being/species-lenia.mjs`, `speciesFor(char, songSeed, beingSeed)`, which is deterministic per song key and is stored in `meta.lenia`. The new function would be `organismFor(char, songSeed, beingSeed)`, stored in `meta.organism` and restored at once when the song returns.

**Descriptor mapping** (the analyzer's 14 descriptors on cross-song scales, `CHAR_KEYS` in `memory.mjs`):
- Species count: S = 3 + round(4·intricacy), clamped to 3 to 7.
- Roles: core (which reuses the existing nucleus `uCoreR` glow), membrane, cytoplasm, and S − 3 organelle species. A ring species appears when regularity is high.
- Matrix: template(roles) + ε·noise(songSeed), with ε = 0.1 to 0.35 from change and noisiness.
- Self-cohesion (the diagonal) comes from harmony and tonality, giving round, smooth organelles.
- Cross-species repulsion comes from roughness, giving fragmented, spiky organelles.
- Asymmetry (|a_ij − a_ji|, the chase and orbit drive) comes from tempo × density × regularity. Handedness (the swirl sign) is the parity of keyHash.
- Body-plan radii come from bassWeight (a bigger core) and vocal (a thicker cytoplasm).
- Colour: species tints come from `songLook()`'s palette and are applied as a tint on the metal's f0, the way `noteTint` does it. Nothing is painted on.

**Stability**
1. Templates plus bounded noise, never a fully random matrix.
2. Choose deterministically with best-of-K: generate K = 8 seeded candidates, pre-roll each for about 300 steps at 4k particles on the GPU, spread over idle frames (well under 1 s in total), and score them:
   - the largest cluster holds at least 85 %
   - a layering index (species radial order matches the roles)
   - kinetic energy stays within a band
   - no collapse (the minimum spacing stays at or above about 0.6 of the collision radius)
   - L stays within a band

   Then store the winner.
3. Live music only modulates gains (±10 to 20 %): r_max breathes with the being's pulse (`pulsePhase`), friction follows energy, and the swirl follows groove × lock. The matrix itself is never re-randomised during a song.
4. Hard guards: a velocity clamp, a container potential at about 1.3 × R_body, and a reset of non-finite values (the same convention as `mind.step`).

## 7. Risks

- **Two-canvas compositing between WebGL and WebGPU is untested here.** The unknowns are frame-sync jitter, alpha premultiplication and the lack of shared depth. Mitigation: never show the blob and the particles overlapping with depth conflicts; crossfade instead. Spike this first.
- **Organism quality is the real risk, not performance.** Section 0.3 showed that the local rules alone make a swarm of small cells. Budget time for an interactive tuning harness (sliders over the matrix and the body plan, plus the automatic metrics).
- **Frame budget.** The blob's own ray-march cost on the iGPU has not been measured. In the particle phase the blob is hidden, so its budget is freed. The target is simulation at most 3 ms plus rendering at most 2 ms at 30k particles.
- **Maintenance.** WebGPU in Electron is fine at Chromium 152. Pin the Electron version, and fall back to "no fission" (or to particle-mesh on WebGL2) if `requestAdapter()` fails.
