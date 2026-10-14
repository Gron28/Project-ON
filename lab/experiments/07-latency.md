# E07 Being on time (latency and rhythm prediction)

Question: how late are the body's drum hits and pulse relative to what the listener hears, and can prediction remove it?

Method: `scratch/latency-lab.cjs` feeds a 120 bpm kick track (`scratch/make-clicks.py`) in real time in 10 ms chunks, logs when
each sample reaches the page and what the body shows each frame. Seen = frame time + 1.5 frames + 4 ms (display);
heard = arrival - 15 ms (capture) + 30 ms (built-in speakers). The analyzer's own kick stamps are compared with the truth.

| version | kick flash, seen - heard | beat pulse | notes |
|---|---|---|---|
| before (reactive, sync dial delayed everything 40 ms) | +70 ms | +70 ms | measured 56 ms arrival-to-frame |
| prediction (`being/timing.mjs`), first 20 s | +33 ms | ~0 ms | still learning the groove: reactive hits |
| prediction, after 20 s | +0 to +9 ms, sd ~8 | same | 100% of kicks predicted, own timing error ~5 ms |

Analyzer stamps: kick -1 ms ± 3, beat 0 ms ± 1 (accurate). Real songs: a dance track 81% predicted (±18 ms); a
half-time or loose track falls back to reacting (graceful). Predictions stop when a drum has not been heard for 2.5 beats.

Open: true output latency is unknown to the being (it cannot hear the speakers); the speaker-delay dial and "tap to sync"
set it. Built-in speakers measured here by assumption (30 ms), not by microphone.
