# ON

A living music visualizer for your desktop. It floats on screen as a liquid-metal creature that hears music, learns
each song, and grows a skin of its own for it.

## Install

Windows 10 or 11, x64. Double-click **Setup.cmd**, then **Install**. Everything stays in this folder; no administrator
access. Afterwards use the shortcut or **Launch.cmd**.

Linux (x64/arm64, PulseAudio or PipeWire): needs Node.js 20+ and `pulseaudio-utils` (`pactl`, `parec`); `playerctl`
is optional, for song titles. Run `./setup.sh`: it adds **Being** to the applications menu and the desktop (`--no-desktop` skips the desktop
shortcut, `--autostart` starts it on login, `--uninstall` removes them all), then start it from either or `./launch.sh`.

## Use

- **Drag** it anywhere. **Right-click** it for options.
- The tray icon opens **Settings**: audio source, size, always on top, start with Windows (start on login on Linux).
- **Dashboard** (right-click or tray) shows what it hears, feels and decides, and controls colours, layers and tuning.
- It listens to Spotify when Spotify is running, otherwise to all system audio.

- **Showcase**: dashboard → Actions → *Showcase (silent test run)*, or `./showcase.sh`: a separate window that plays silent synthetic
  music and walks through every state and animation, captioned (→ ← to step, space to pause). Your being is not touched.

## How it works

Its senses and inner life are built from mechanisms shared by hearing animals, not from a language model: a self-tuned
critical ear (Hopf oscillators), excitable tissue held near criticality, startle, a felt pulse that learns to predict
the beat, expectation and reward, mood and energy, and a memory of every song. Each song grows a skin genome (cell
mosaics, pollen, Turing patterns, lace, attractors) stained in its own colours. `CLAUDE.md` has the module map; `lab/`
has the research and experiments.

## Develop

```
npm start               the desktop pet
set ENTITY_WINDOW=1     an ordinary window with dials
npm test                unit tests
```

The earlier fly-connectome experiment still runs with `ENTITY_PAGE=fly` (`renderer/`, `brain/`, `data/`).

## Licences and data

The code is the author's own. Some data and models it ships carry their own terms: the fly-connectome experiment's data
(FlyWire, CC BY-NC 4.0) and the Essentia/Discogs-EffNet models (CC BY-NC-SA) are for non-commercial use; check
`lab/NOTEBOOK.md` §8 before any commercial use; `THIRD_PARTY.md` lists everything that is not the author's own, with its terms. Astronomy by [astronomy-engine](https://github.com/cosinekitty/astronomy)
(MIT), checked against NASA JPL Horizons. No licence is granted for the rest yet.
