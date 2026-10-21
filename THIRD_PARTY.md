# Third-party code, models and data

This file lists what ON ships or depends on that is not the author's own, with the terms each one states. It is a
summary of what the repository itself records (`being/models/LICENSE-NOTE.txt`, `native/README.md`, `package.json`,
`lab/NOTEBOOK.md` section 8); read the originals for the exact terms. Items marked **verify** are not stated anywhere in
the repository and should be checked at the source before any redistribution.

## Non-commercial material (read before any commercial use)

| What | Where | Terms |
|---|---|---|
| Essentia / MTG pretrained models: Discogs-EffNet and its heads, MusiCNN-MSD, emoMusic and DEAM heads | `being/models/*.onnx`, `*.json` | CC BY-NC-SA 4.0 (attribution, non-commercial, share-alike). A proprietary licence is available from the MTG on request. Citations are in `being/models/LICENSE-NOTE.txt`. |
| YAMNet (`audioset-yamnet-1`), as distributed by Essentia | `being/models/audioset-yamnet-1.*` | Distributed through the same Essentia collection; the original model is Google's. **verify** its licence at the source. |
| FlyWire fly-connectome data | `data/brain.bin`, `data/brain.json` | CC BY-NC 4.0. Used only by the earlier lab experiment (`ENTITY_PAGE=fly`, `renderer/`, `brain/`), to measure statistics. |

## Models and code with permissive terms

| What | Where | Terms |
|---|---|---|
| Beat This! (small), Foscarin, Schlueter and Widmer, ISMIR 2024 | `being/models/beat-this-small0.onnx`, `beat-this-mel.bin`; used by `being/ml/beat-core.mjs` | MIT, as stated in `being/ml/beat-core.mjs` and `lab/NOTEBOOK.md`. **verify** against the upstream repository when redistributing the weights. |
| Windows Implementation Libraries (headers) | `native/source/` | MIT, Microsoft Corporation (`native/WIL-LICENSE.txt`). |
| Windows per-app capture addon, from `@kokapuk/application-loopback` 1.0.2 | `native/win32-x64/addon.node`, source in `native/source/` | MIT per its package metadata; the original author's notice is kept in `native/README.md`. A locally built binary, not an upstream release (see that file). |

## npm dependencies

Declared in `package.json`; licences as installed.

| Package | Licence |
|---|---|
| `three` | MIT |
| `onnxruntime-web` | MIT |
| `astronomy-engine` | MIT |
| `@webamp/butterchurn`, `butterchurn-presets` (used by the earlier lab experiment) | MIT |
| `electron` (development dependency) | MIT |

Transitive dependencies are recorded in `package-lock.json`.

## The author's own code

Everything else (`being/`, `setup/`, `lab/`, `tests/`, `main.cjs`, ...) is the author's own work. No licence has been
granted for it yet; until one is added, all rights are reserved.
