import io, re
p = 'being/index.html'
s = io.open(p, encoding='utf8').read()
io.open('scratch/index.before-7.html', 'w', encoding='utf8').write(s)
def rep(a, b, n=1):
    global s
    assert a in s, ('missing', a[:110])
    s = s.replace(a, b, n)

# ---- imports ----------------------------------------------------------------------------------------------------------------
rep("import { createMind, traitsFor } from './mind.mjs';", "import { createMind, traitsFor } from './mind.mjs';\nimport { createTiming, blendGrids } from './timing.mjs';")

# ---- visuals read the SHOWN pulse (predicted to the moment the listener hears it), not the mind's raw pulse -----------------
for a, b in [('m.pulsePhase', 'SHOW.phase'), ('mind.pulsePhase', 'SHOW.phase'), ('m.pulseCount', 'SHOW.count'), ('mind.pulseCount', 'SHOW.count')]:
    s = s.replace(a, b)

# ---- timing: the being learns the groove and its own timing; the latency model decides how far ahead to draw --------------
rep("function beingBeat(s) {", """/* ---------- being on time (being/timing.mjs) ----------
   Latency model. A frame computed now is seen DISP ms later; the newest sample arrived GAP ms ago and was played CAP ms
   before that; the listener hears audio OUT ms (speaker delay dial) after it is played. When the sound reaches the
   listener before the picture can (wired or built-in speakers), the rhythm is drawn AHEAD by prediction (horizon). When
   the sound is later (Bluetooth), everything is delayed instead (delay line in the worker, and the analyzer). */
const LATM = { gap: 10, frame: 16.7, cap: 15, horizon: 0, delay: 0, sentDelay: -1 };
const timing = createTiming({ prior: (() => { try { return JSON.parse(localStorage.getItem('being-groove-' + SEED) || 'null'); } catch { return null; } })() });
try { timing.restoreSelf(JSON.parse(localStorage.getItem('being-timing-' + SEED) || 'null')); } catch {}
const saveTiming = () => { try { localStorage.setItem('being-timing-' + SEED, JSON.stringify(timing.serializeSelf())); } catch {} };
setInterval(saveTiming, 20000); addEventListener('beforeunload', saveTiming);
// the shown pulse: the being's grid (16 slots = 4 felt beats) at the moment the listener hears this frame
const SHOW = { phase: 0, count: 0, slot: 0, prev: null, gate: 0 };
const GH = { ta: new Float64Array(64), cum: new Float64Array(64), n: 0 };   // recent (heard audio time, grid position)
function gridAt(t) {   // grid position (cumulative slots, before bias) of the heard grid at audio time t (s)
  const n = Math.min(GH.n, 64); if (!n || !Number.isFinite(t)) return NaN;
  const last = (GH.n - 1) % 64;
  if (t >= GH.ta[last]) return GH.cum[last] + (t - GH.ta[last]) * 4 * mind.pulseHz;
  for (let j = 1; j < n; j++) {
    const a = (GH.n - 1 - j) % 64, b = (GH.n - j) % 64;
    if (GH.ta[a] <= t) { const u = (t - GH.ta[a]) / Math.max(1e-6, GH.ta[b] - GH.ta[a]); return GH.cum[a] + u * (GH.cum[b] - GH.cum[a]); }
  }
  return NaN;
}
const PRED = [];
function beOnTime(dt, f0) {
  if (f0 - lastIn < 250) LATM.gap += (Math.min(60, f0 - lastIn) - LATM.gap) * .05;
  if (dt > 0) LATM.frame += (Math.min(50, dt * 1000) - LATM.frame) * .05;
  const disp = 1.5 * LATM.frame + 4, ready = LATM.gap + disp + LATM.cap;   // how late a picture of the newest sound would be
  LATM.delay = Math.max(0, DIALS.sync - ready); LATM.horizon = Math.max(0, ready - DIALS.sync);
  if (Math.abs(LATM.delay - LATM.sentDelay) > 4) { LATM.sentDelay = LATM.delay; beingWorker.postMessage({ type: 'delay', ms: LATM.delay }); }
  // the heard grid at the analysed audio time
  const ta = Math.max(0, an.total - Math.round(LATM.delay * 48)) / SR, cum = (mind.pulseCountRaw + mind.pulsePhaseRaw) * 4;
  const k = GH.n % 64; GH.ta[k] = ta; GH.cum[k] = cum; GH.n++;
  timing.advance(cum);
  const slotMs = 250 / Math.max(.3, mind.pulseHz);
  const shown = cum + timing.bias + LATM.horizon / slotMs;
  SHOW.gate = c01((mind.lock - .2) / .4) * timing.readiness;
  if (SHOW.prev !== null && shown > SHOW.prev && shown - SHOW.prev < 3) {
    if (SHOW.gate > .05 && S.awake > .3) for (const h of timing.predict(SHOW.prev, shown, PRED)) {
      const mix = h.type === 'kick' ? T.mixKick : h.type === 'snare' ? T.mixSnare : T.mixHat;
      if (mix > 0) drumHit(h.type, Math.max(.2, Math.min(1, h.strength * SHOW.gate * mix)), true);
    }
    if (Math.floor(shown / 4) > Math.floor(SHOW.prev / 4)) beatShown(f0 + disp);   // tap calibration compares taps with SEEN beats
  }
  SHOW.prev = shown; SHOW.slot = shown;
  const beats = shown / 4; SHOW.count = Math.floor(beats); SHOW.phase = beats - SHOW.count;
}
function beingBeat(s) {""")

# ---- drum hits: one function for heard hits and predicted hits -------------------------------------------------------------
start = s.index("      case 'kick': V.kick = Math.max(V.kick, s);")
end = s.index("      case 'build':", start)
body = s[start:end]
kick = re.search(r"      case 'kick': (.*?) break;\n", body, re.S).group(1)
snare = re.search(r"      case 'snare': (.*?) break;\n", body, re.S).group(1)
hat = re.search(r"      case 'hat': (.*?) break;\n", body, re.S).group(1)
s = s[:start] + """      case 'kick': case 'snare': case 'hat': {
        // what it predicted it has already shown, on time; a heard hit only adds what it did not expect
        const ex = timing.observe(e.type, e.strength || .6, gridAt(e.time), 250 / Math.max(.3, mind.pulseHz)) * SHOW.gate;
        if (ex < .5) drumHit(e.type, s * (1 - ex), live);
        break;
      }
""" + s[end:]
rep("function handleEvents(evs, now) {", """function drumHit(type, s, live) {   // a drum hit on the body (heard, or predicted ahead of time)
  if (type === 'kick') { """ + kick + """ }
  else if (type === 'snare') { """ + snare + """ }
  else if (type === 'hat') { """ + hat + """ }
}
function handleEvents(evs, now) {""")
# beats from the analyzer's tracker no longer mark calibration beats (the shown grid does)
rep("      case 'beat': beatShown(now); break;", "      case 'beat': break;")
rep("      case 'downbeat': beatShown(now); S.down = 1;", "      case 'downbeat': S.down = 1;")

# ---- frame loop: analyzer delayed only when the sound is late; timing runs after the mind --------------------------------
rep("  an.analyseUpTo(Math.max(0, an.total - Math.round(DIALS.sync * 48)));", "  an.analyseUpTo(Math.max(0, an.total - Math.round(LATM.delay * 48)));")
rep("  stereoAt(an.total - Math.round(DIALS.sync * 48), SP);", "  stereoAt(an.total - Math.round(LATM.delay * 48), SP);")
rep("  handleEvents(an.drain(), f0);\n", "  const evsNow = an.drain();\n")
rep("rhythm: DIALS.rhythm, beat: an.state.beat })); onsetPeak = 0;", "rhythm: DIALS.rhythm, beat: an.state.beat })); onsetPeak = 0;\n  beOnTime(dt, f0); handleEvents(evsNow, f0);")

# ---- dials: the sync dial is now the speaker delay; the worker delay comes from the latency model ------------------------
rep("beingWorker.postMessage({ type: 'delay', ms: DIALS.sync }); try {", "try {")
rep("""  <label for="sync">sync <input id="sync" type="range" min="0" max="400" step="5" value="40"><b id="syncv">40 ms</b></label>""",
    """  <label for="sync" title="how late your speakers or headphones play the sound (built-in or wired ~20-40 ms, Bluetooth ~150-250 ms)">speaker delay <input id="sync" type="range" min="0" max="400" step="5" value="30"><b id="syncv">30 ms</b></label>
  <label><button id="tapsync" type="button" title="tap the creature (or Space) on every beat you hear, 8 times">tap to sync</button></label>""")
rep("const DIALS = { rhythm: .6, sync: 40 };", "const DIALS = { rhythm: .6, sync: 30 };")
rep("  for (const el of [rIn, sIn]) el.addEventListener('pointerdown', e => e.stopPropagation());",
    """  for (const el of [rIn, sIn]) el.addEventListener('pointerdown', e => e.stopPropagation());
  const tb = document.getElementById('tapsync'); tb.addEventListener('pointerdown', e => e.stopPropagation()); tb.onclick = () => calibrate();
  DIALS.setSync = (ms) => { sIn.value = Math.round(ms / 5) * 5; apply(); };""")
rep("  #dials b { width: 44px; text-align: right; font-weight: 600; }", """  #dials b { width: 44px; text-align: right; font-weight: 600; }
  #dials button { font: inherit; color: inherit; background: rgba(159, 230, 255, .14); border: 1px solid rgba(159, 230, 255, .35); border-radius: 6px; padding: 2px 8px; cursor: pointer; }""")

# ---- calibration: taps against the SHOWN beats move the speaker delay (people tap ~25 ms early, Repp 2005) ----------------
rep("""  const s = C.deltas.slice().sort((a, b) => a - b), med = (s[3] + s[4]) / 2, off = Math.round(Math.max(0, Math.min(450, look.offset + med)));
  C.on = false; look.offset = off; pet.setOffset(off); say('sync set to ' + off + ' ms');""",
    """  const s = C.deltas.slice().sort((a, b) => a - b), med = (s[3] + s[4]) / 2, off = Math.round(Math.max(0, Math.min(400, DIALS.sync + med + 25)));
  C.on = false; DIALS.setSync(off); say('speaker delay set to ' + off + ' ms');""")
rep("addEventListener('keydown', e => { if (e.key === 'Escape' && C.on) cancelCal('calibration cancelled'); });",
    "addEventListener('keydown', e => { if (e.key === 'Escape' && C.on) cancelCal('calibration cancelled'); if (e.code === 'Space' && C.on) { e.preventDefault(); tap(performance.now()); } });")
rep("say('tap the entity on every beat · 8 taps', 10000)", "say('tap the creature or Space on every beat you hear · 8 taps', 10000)")

# ---- memory: a song keeps its groove and tempo; a return primes them; songs teach the general groove ----------------------
rep("  const d = MEM.song.serialize(); d.meta = { ...d.meta, ...MEM.meta, experience: MEM.song.experience, lastHeard: Date.now() };",
    "  if (MEM.meta && timing.evidence > 16) { MEM.meta.groove = timing.serialize(); if (mind.lock > .4) MEM.meta.bpm = mind.pulseHz * 60; }\n  const d = MEM.song.serialize(); d.meta = { ...d.meta, ...MEM.meta, experience: MEM.song.experience, lastHeard: Date.now() };")
rep("  await saveSong();\n  MEM.key = t.key;", """  await saveSong();
  if (MEM.meta && MEM.meta.groove && MEM.song && MEM.song.experience > 30) {   // what this song taught it about how music grooves
    try { const g = blendGrids(JSON.parse(localStorage.getItem('being-groove-' + SEED) || 'null'), MEM.meta.groove, .15); localStorage.setItem('being-groove-' + SEED, JSON.stringify(g)); } catch {}
  }
  let prior = null; try { prior = JSON.parse(localStorage.getItem('being-groove-' + SEED) || 'null'); } catch {}
  timing.reset(prior);
  MEM.key = t.key;""")
rep("    if (stored.meta.lenia) applySpecies(stored.meta.lenia);", "    if (stored.meta.lenia) applySpecies(stored.meta.lenia);\n    if (stored.meta.groove) timing.recall(stored.meta.groove);\n    if (Number.isFinite(stored.meta.bpm)) mind.prime(stored.meta.bpm / 60);")

# ---- panel: how well it keeps time ------------------------------------------------------------------------------------------
rep(" · on beat ${Math.round(100 - 100 * m.beatError)}%` : '');",
    " · on beat ${Math.round(100 - 100 * m.beatError)}%` : '') + ` · timing ±${timing.errorMs.toFixed(0)} ms · predicts ${Math.round(100 * timing.predicted)}% · ${LATM.horizon > 1 ? 'draws ' + LATM.horizon.toFixed(0) + ' ms ahead' : 'waits ' + LATM.delay.toFixed(0) + ' ms'}`;")
# lab hook
rep("window.__songPng = () => songPng();   // lab hook", "window.__songPng = () => songPng();   // lab hook\nwindow.__timingInfo = () => ({ bias: +timing.bias.toFixed(3), errMs: +timing.errorMs.toFixed(1), predicted: +timing.predicted.toFixed(2), evidence: timing.evidence, gate: +SHOW.gate.toFixed(2), horizon: +LATM.horizon.toFixed(1), delay: +LATM.delay.toFixed(1), gap: +LATM.gap.toFixed(1), frame: +LATM.frame.toFixed(1), lock: +mind.lock.toFixed(2), bpm: +(mind.pulseHz * 60).toFixed(1) });")
io.open(p, 'w', encoding='utf8').write(s)

m = 'being/mind.mjs'; t = io.open(m, encoding='utf8').read()
a = "get pulsePhase() { return phM / TAU; }, get pulseCount() { return motorCycles; },"
assert a in t
if 'pulsePhaseRaw' not in t: t = t.replace(a, a + " get pulsePhaseRaw() { return phM / TAU; }, get pulseCountRaw() { return motorCycles; },", 1)
io.open(m, 'w', encoding='utf8').write(t)
print('patched', len(s))
