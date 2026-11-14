"""The being's voice: remembers loved moments, sings them on hover in silence (being/voice*.mjs). Usage: python patch-voice.py being/index.html"""
import io, sys
p = sys.argv[1] if len(sys.argv) > 1 else 'being/index.html'
s = io.open(p, encoding='utf8').read()
assert 'createVoice' not in s, 'already patched'
def rep(a, b, n=1):
    global s
    assert a in s, ('missing', a[:110])
    s = s.replace(a, b, n)

rep("import { createPressure } from './pressure.mjs';", """import { createPressure } from './pressure.mjs';
import { createSketcher, keepSketch, loveUpdate, validSketch } from './voice.mjs';
import { createVoice } from './voice-director.mjs';""")
if "import { createMap, dnaWeights, featureOf, blend, paint, unb64, geneDna," in s and " b64," not in s.split("from './memory.mjs'")[0].split('import { createMap')[-1]:
    rep("import { createMap, dnaWeights, featureOf, blend, paint, unb64, geneDna,", "import { createMap, dnaWeights, featureOf, blend, paint, unb64, b64, geneDna,")

# ---- memory of loved moments, a love map and the song's key (no sound is ever stored) --------------------------------------
rep("async function onTrack(t) {", """/* ---------- its voice (being/voice.mjs, voice-director.mjs, voice-worklet.js) ----------
   While it listens it keeps a few seconds of its ear around moments it loved (chills, a dopamine peak, "Love this"), a
   love map over its song map, and the song's key as its ear folds it. When someone hovers over it in silence or sleep it
   sings from that memory: a hum, then babble, then a replay. Its own voice never counts as hearing (efference copy). */
const VOICE = { sk: createSketcher(), love: new Float32Array(NU), chroma: new Float32Array(12), n: 0, cool: -1e9, over: 0 };
const voice = createVoice({ workletUrl: new URL('./voice-worklet.js', import.meta.url).href });
try { const m = localStorage.getItem('being-voice'); if (m) voice.mode = m; } catch {}
function voiceKeep(reason, score) { if (MEM.meta && VOICE.sk.capture(reason, score, { bpm: Math.round(mind.pulseHz * 60), title: MEM.meta.title || '' })) blog.unshift(`keeps this moment (${reason})`); }
function voiceHear(d) {   // every ear frame (100/s): the sketch ring at 50/s, and dopamine peaks
  if (++VOICE.n % 2) return;
  for (const sk of VOICE.sk.push(d)) if (MEM.meta) { MEM.meta.sketches = keepSketch(MEM.meta.sketches, sk); devEvent('kept moment'); }
  const t = beingClock.t;
  if (mind.daPhasic > .85 && d.level > .008 && t - VOICE.cool > 25) { VOICE.cool = t; voiceKeep('dopamine', Math.min(1, mind.daPhasic * .8)); }
}
function voiceFrame(dt) {
  voice.frame(dt, { hover: S.hit, dragging: !!drag.down, quiet: SLEEP.z > .5 || S.quiet > 3, weights: MEM.song ? MEM.song.weights : null,
    hits: null, love: VOICE.love, sketches: MEM.meta && Array.isArray(MEM.meta.sketches) ? MEM.meta.sketches.filter(validSketch) : null,
    bpm: (MEM.meta && MEM.meta.bpm) || mind.pulseHz * 60 });
  if (voice.singing || voice.rms > .001) {   // singing glows from inside, and its shell rings
    const v = Math.min(1, voice.rms * 30);
    U.uGlow.value += .3 * v; U.uCoreI.value *= 1 + .9 * v; U.uBeatPulse.value = Math.max(U.uBeatPulse.value, Math.min(1, voice.shell * 1.5));
  }
}
async function onTrack(t) {""")
rep("  if (d.type === 'ear') { earFrame = d; if (d.onset > onsetPeak) onsetPeak = d.onset; memoryHear(d); }",
    "  if (d.type === 'ear') { earFrame = d; if (d.onset > onsetPeak) onsetPeak = d.onset; memoryHear(d); voiceHear(d); }")
rep("    const b = MEM.song.bmu;", """    const b = MEM.song.bmu;
    loveUpdate(VOICE.love, b, Math.max(0, mind.daPhasic) + .5 * Math.max(0, mind.valence));   // what it liked, where on its map
    for (let i = 0; i < 12; i++) VOICE.chroma[i] += .004 * (mind.pitch[i] - VOICE.chroma[i]);""")
rep("    else if (e.type === 'chill') { B.chill = 1;", "    else if (e.type === 'chill') { voiceKeep('chills', 1); B.chill = 1;")
rep("function feedback(sign) {\n  mind.inject(sign);", "function feedback(sign) {\n  if (sign > 0) voiceKeep('love', 1.2);\n  mind.inject(sign);")
rep("  const d = MEM.song.serialize(); d.meta = {", "  if (MEM.meta) { MEM.meta.love = b64(VOICE.love); MEM.meta.chroma = Array.from(VOICE.chroma, (x) => +x.toFixed(3)); }\n  const d = MEM.song.serialize(); d.meta = {")
rep("  MEM.key = t.key;\n", "  MEM.key = t.key;\n  VOICE.love.fill(0); VOICE.chroma.fill(0); voice.interrupt();\n")
rep("    if (stored.meta.groove) timing.recall(stored.meta.groove);", """    if (stored.meta.groove) timing.recall(stored.meta.groove);
    if (typeof stored.meta.love === 'string') { try { const l = unb64(stored.meta.love); if (l.length === NU && l.every(Number.isFinite)) VOICE.love.set(l); } catch {} }
    if (Array.isArray(stored.meta.chroma) && stored.meta.chroma.length === 12) VOICE.chroma.set(stored.meta.chroma.map((x) => +x || 0));""")
# its own voice is not hearing: captured sound it can explain as itself is silenced; anything louder stops the song
rep("  pushIn(mono.subarray(0, n));", """  if (voice.singing || voice.rms > .0015) {
    let e = 0; for (let i = 0; i < n; i++) e += mono[i] * mono[i];
    if (voice.isOwn(Math.sqrt(e / Math.max(1, n)))) { VOICE.over = 0; mono.fill(0, 0, n); }
    else if (++VOICE.over > 3) { voice.interrupt(); VOICE.over = 0; }   // someone else is sounding: it falls silent and listens
    else mono.fill(0, 0, n);
  }
  pushIn(mono.subarray(0, n));""")
rep("  restApply(dt);\n", "  restApply(dt);\n  voiceFrame(dt);\n")
# dashboard: voice mode, and what it is doing
rep("    case 'beads': window.__beads(); break;", "    case 'beads': window.__beads(); break;\n    case 'voice': if (['off', 'whisper', 'sing'].includes(c.v)) { voice.mode = c.v; try { localStorage.setItem('being-voice', c.v); } catch {} } break;")
rep("    sleep: num(SLEEP.z),", "    voice: { mode: voice.mode, stage: voice.stage, rms: num(voice.rms, 4), moments: MEM.meta && Array.isArray(MEM.meta.sketches) ? MEM.meta.sketches.length : 0 },\n    sleep: num(SLEEP.z),")
window_hook = "window.__beadInfo = () =>"
rep(window_hook, "window.__voice = () => ({ mode: voice.mode, stage: voice.stage, singing: voice.singing, rms: +voice.rms.toFixed(4), moments: MEM.meta && MEM.meta.sketches ? MEM.meta.sketches.length : 0, love: +VOICE.love.reduce((a, x) => a + x, 0).toFixed(2) });   // lab\nwindow.__voiceKeep = (r = 'lab') => voiceKeep(r, 1);\n" + window_hook)
io.open(p, 'w', encoding='utf8').write(s)
print('patched', p, len(s))
