# E08 The song's skin (morph) and the swarm (pressure, organism)

## Skin
Question: can the skin be crisp, organic and very different per song while shaping the metal (height/AO), not painted?
Method: `scratch/morph-gallery.cjs`, `scratch/morph-one.cjs` force six song characters (`__morphForce`) through the real body.
Result: lace (string quartet), spined pollen cells (rap), attractor spikes (noise), cell mosaic (techno), foam lace
(ambient), radiolarian filigree (ballad). Cost (`scratch/bake-bench.cjs`, GPU sync): bake 0.9-3.8 ms per family at 384 px,
cells the most; with GPU timer queries in the app (`scratch/perf-lab.cjs`) the bake is 1.3-2.9 ms and the body raymarch
15-28 ms at an 800 px window (it was already the heavy part). The bake runs every other frame.
Open: the body raymarch cost on this iGPU; attractor densities take ~0.5-1.5 s in the worker before they appear.

## Swarm
Question: can the body burst into a particle organism that reads as one cell (not a scatter of clumps)?
Method: `scratch/swarm-lab.cjs` bursts (`__burst`) and photographs the life cycle; three song characters compared.
Findings: with self-attracting species it formed berries and clumps (as the research predicted). Making sheet species
slightly SELF-REPELLING under a radial spring spreads them evenly (Thomson-like) into membranes, vesicles and rings;
cohesion is kept only for the core and nucleoli. Three characters gave three distinct organisms (ring or not, beads or
not, organelles, colours). Jets need low friction to fly; they are thrown toward the viewer because the overlay canvas
cannot be hidden behind the body.
Tests: `tests/swarm.test.mjs` (calm never bursts; wild music jets, bursts after >20 s, gathers after 20-90 s; refractory).
Open: no depth sharing between the WebGPU overlay and the body (fine while the body is hidden); swarm GPU time not yet
measured with timestamp queries (16k particles; research measured 32k at ~1.3 ms).
