# scratch/

Lab harnesses: headless runs of the real app or its pure modules, used to measure, tune and photograph it. They are not
part of the app and nothing imports them.

- The first comment line of each file says what it does and how to call it (most take their options from environment
  variables, for example `WAV=`, `SHOTS=`, `ONLY=`, `FORCE=`).
- `.cjs` files run under Electron (`./node_modules/.bin/electron scratch/<file>.cjs`, `electron.cmd` on Windows);
  `.mjs` files under Node.
- Their output (screenshots, recordings, logs) is written here and is git-ignored.
- The ones `CLAUDE.md` points to (`being-smoke`, `showcase-check`, `showcase-steps`, `latency-lab`, `material-gallery`,
  `perf-lab`, ...) are the maintained ones. The rest are probes written for one question each and may need small
  updates to run against the current code.
