import io
p = 'being/index.html'
s = io.open(p, encoding='utf8').read()
def rep(a, b, count=1):
    global s
    n = s.count(a)
    assert n >= 1, ('missing', a[:80])
    s = s.replace(a, b) if count == 0 else s.replace(a, b, count)

# ---- paths, imports, title --------------------------------------------------------------------------------
rep('"three": "./node_modules/three/build/three.module.js"', '"three": "../node_modules/three/build/three.module.js"')
rep('<title>Entity</title>', '<title>Being</title>')
rep("import { rankPatterns } from './mind/prompt.mjs';", "import { rankPatterns } from './mind/prompt.mjs';\nimport { createMind, traitsFor } from './mind.mjs';")

# ---- being HUD styles + element ------------------------------------------------------------------------------
rep('</style>', '''  #being { position: fixed; left: 10px; top: 10px; width: 250px; padding: 8px 10px 9px; border-radius: 10px; background: rgba(6, 6, 14, .72); color: #dfe3ff;
    font: 600 10px/1.25 ui-monospace, Consolas, monospace; display: none; pointer-events: none; }
  body.hud #being { display: block; }
  #being .feel { font: 700 15px/1.2 system-ui, "Segoe UI", sans-serif; letter-spacing: .02em; color: #fff; margin-bottom: 4px; }
  #being .sub { opacity: .6; margin-bottom: 6px; }
  #being canvas { display: block; width: 230px; height: 150px; cursor: default; }
  #being .log { margin-top: 5px; opacity: .8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>''')
rep('<div id="hud"></div>', '<div id="hud"></div>\n<div id="being"><div class="feel">waking</div><div class="sub"></div><canvas width="460" height="300"></canvas><div class="log"></div></div>')

# ---- the being: worker (ear + tissue) and mind --------------------------------------------------------------
rep('''const pushIn = f => { an.push(f); if (brain) brain.push(f); lastIn = performance.now(); received += f.length;''',
'''/* ---------- the being: its ear and tissue run in a worker, its inner life in being/mind.mjs ---------- */
const EAR_CF = Float64Array.from({ length: 28 }, (_, k) => 55 * 2 ** (k / 4));
let SEED = 0; try { SEED = +localStorage.getItem('being-seed') || 0; } catch {}
if (!SEED) { SEED = (Math.random() * 2147483647) | 0; try { localStorage.setItem('being-seed', String(SEED)); } catch {} }
let mind = createMind(traitsFor(SEED), { earCF: EAR_CF });
const beingWorker = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });
beingWorker.onerror = e => console.error('being worker:', e.message);
let earFrame = null, onsetPeak = 0, tissueStats = { act: 0, sigma: 1, branching: 1 };
const tissueTex = new THREE.DataTexture(new Uint8Array(128 * 64 * 4), 128, 64, THREE.RGBAFormat);
tissueTex.wrapS = THREE.RepeatWrapping; tissueTex.wrapT = THREE.ClampToEdgeWrapping; tissueTex.magFilter = tissueTex.minFilter = THREE.LinearFilter; tissueTex.needsUpdate = true;
beingWorker.onmessage = e => {
  const d = e.data;
  if (d.type === 'ear') { earFrame = d; if (d.onset > onsetPeak) onsetPeak = d.onset; }
  else if (d.type === 'tissue') { tissueTex.image.data.set(d.tex); tissueTex.needsUpdate = true; tissueStats = d; }
};
const feedBeing = f => { const c = new Float32Array(f); beingWorker.postMessage({ type: 'pcm', mono: c }, [c.buffer]); };
const BEAT = { bpm: 0, phase: 0, confidence: 0, count: 0, downbeat: false, barPhase: 0 };
function beingBeat(s) {   // the body pulses with what the being feels, not with the analyzer's beat tracker
  BEAT.bpm = mind.pulseHz * 60; BEAT.phase = mind.pulsePhase; BEAT.confidence = c01(mind.lock * 1.2); BEAT.count = mind.pulseCount;
  BEAT.downbeat = mind.pulseCount % 4 === 0; BEAT.barPhase = ((mind.pulseCount % 4) + mind.pulsePhase) / 4;
  return BEAT;
}
const blog = [];
const B = { chill: 0, recoil: 0, flinch: 0, hue: 0 };
function beingEvents(evs) {
  for (const e of evs) {
    if (e.type === 'startle') {
      const a = e.amount; B.flinch = Math.max(B.flinch, a); V.kick = Math.max(V.kick, a); if (a > .45) S.ring = 0;
      for (let k = 0, n = Math.round(a * 7); k < n; k++) spawnDrop(.045 + .045 * a);
      S.jit.x += (Math.random() - .5) * a * .5; S.jit.y += (Math.random() - .5) * a * .5; S.jit.z += (Math.random() - .5) * a * .5;
      beingWorker.postMessage({ type: 'kick', amount: a });
      blog.unshift('startled ' + a.toFixed(2));
    } else if (e.type === 'reform') { reseed(true); blog.unshift('bored: grew a new form'); say('bored · it grows a new form'); }
    else if (e.type === 'chill') { B.chill = 1; blog.unshift('chills'); }
    else if (e.type === 'recoil') { B.recoil = 1; blog.unshift('disappointed'); }
  }
  blog.length = Math.min(blog.length, 3);
}
const pushIn = f => { an.push(f); feedBeing(f); if (brain) brain.push(f); lastIn = performance.now(); received += f.length;''')
# silence keeps flowing into the being too (it hums and dreams in silence)
rep('an.push(ZERO.subarray(0, m)); n -= m;', 'an.push(ZERO.subarray(0, m)); feedBeing(ZERO.subarray(0, m)); n -= m;')

# ---- the skin is the being's own tissue ------------------------------------------------------------------------
rep('''const skin = createSkin(renderer, THREE, { width: 192, height: 96 });
U.uSkin.value = skin.texture;''', '''const skin = { setParams() {}, feed() {}, step() {}, stats: null };   // the Lenia skin is replaced by the being's tissue
U.uSkin.value = tissueTex;''')
rep("  const want = ML.skin === 'none' ? 0 : .6 * T.skinAmt * S.awake;",
    "  const want = (.45 + .5 * c01(tissueStats.act * 60)) * T.skinAmt;   // its nervous tissue always shows; brighter when busy")

# ---- senses into the body: the being's pulse, arousal and ear-pitch -------------------------------------------
rep('MIX.beat = s.beat;', 'MIX.beat = beingBeat(s.beat);')
rep('MIX.intensity = Math.pow(c01(b * T.sens), T.curve); }', 'MIX.intensity = Math.pow(c01(b * T.sens), T.curve); MIX.intensity = c01(.2 * MIX.intensity + .8 * mind.arousal); }')
rep('for (let i = 0; i < 12; i++) MIX.notes[i] = c01(s.notes[i] * T.mixNotes);', 'for (let i = 0; i < 12; i++) MIX.notes[i] = c01((.45 * s.notes[i] + .55 * mind.pitch[i]) * T.mixNotes);')

# ---- step the mind each frame, before the body reads it ---------------------------------------------------------
rep('  readChar(an.state, dt); deriveChar();', '''  readChar(an.state, dt); deriveChar();
  beingEvents(mind.step(dt, earFrame, onsetPeak, { tension: an.state.structure.tension, intensity: an.state.intensityAbs ?? an.state.intensity })); onsetPeak = 0;
  B.chill *= Math.exp(-dt / 2.5); B.recoil *= Math.exp(-dt / .6); B.flinch *= Math.exp(-dt / .25);''')
# it never goes fully dormant: in silence it rests, hums and dreams
rep('S.awake += ((awake ? 1 : 0) - S.awake) * Math.min(1, dt * (awake ? 3 : .6));', 'S.awake += ((awake ? 1 : .42) - S.awake) * Math.min(1, dt * (awake ? 3 : .6));')
# anticipation pulls it in and makes it tremble like a build-up; disappointment too
rep('S.tension += (structure.tension - S.tension) * (1 - Math.exp(-dt / .15));', 'S.tension += (Math.max(structure.tension * .5, mind.daAnticipation * .9, B.recoil * .7) - S.tension) * (1 - Math.exp(-dt / .15));')
# breathing at its own tempo when quiet, swelling with anticipation, shrinking when disappointed
rep('  U.uScale.value = Math.max(.62, rawScale', '''  const quiet = c01(S.quiet / 4);
  const breath = quiet * .035 * Math.sin(2 * Math.PI * mind.pulsePhase) * (.5 + (earFrame ? earFrame.hum * 4 : 0));
  const beingScale = rawScale * (1 + .07 * mind.daAnticipation - .06 * B.recoil + .03 * B.flinch) + breath;
  U.uScale.value = Math.max(.62, beingScale''')
rep(" <= 1 ? rawScale : 1 + .18 * Math.tanh((rawScale - 1) / .18));", " <= 1 ? beingScale : 1 + .18 * Math.tanh((beingScale - 1) / .18));")
# its light: its own hue, bent warm by pleasure and cold by unease; saturation is arousal
rep("  else if (look.light === 'music') lightTo.setHSL(MOOD_HUE[(structure.section | 0) % 4], .85, .6);",
'''  else if (look.light === 'music') lightTo.setHSL(MOOD_HUE[(structure.section | 0) % 4], .85, .6);
  else if (look.light === 'being') {
    const h0 = mind.traits.hue, v = mind.valence + .5 * mind.mood;
    // positive valence leans towards amber, negative towards deep blue, along the shorter way round the hue circle
    const toward = v >= 0 ? .08 : .62; let dh = toward - h0; if (dh > .5) dh -= 1; if (dh < -.5) dh += 1;
    B.hue = (((h0 + dh * Math.min(1, Math.abs(v)) * .8) % 1) + 1) % 1;
    lightTo.setHSL(B.hue, .35 + .55 * mind.arousal, .5 + .12 * c01(mind.daTonic + .5) + .1 * B.chill);
  }''')
# pleasure brightens it, chills make it iridescent and shimmer
rep('  U.uGlow.value = (.28 + S.awake * (.22 + X * .55 + st.level * .25)) * (.6 + .75 * loudF + contrast) * T.glow;',
    '  U.uGlow.value = (.28 + S.awake * (.22 + X * .55 + st.level * .25)) * (.6 + .75 * loudF + contrast) * T.glow * (1 + .35 * Math.max(0, mind.daPhasic) + .4 * B.chill);\n  U.uFilm.value = Math.max(U.uFilm.value, B.chill * .9);')
# a tired being moves slower
rep('  if (!frozen) time += dt * (.3 + S.awake * .7) * (1 + .4 * Q.den - .3 * Q.flow);', '  if (!frozen) time += dt * (.3 + S.awake * .7) * (1 + .4 * Q.den - .3 * Q.flow) * (.65 + .35 * mind.energy);')
# lobe colours around its light
rep('function lobeColour(kind, pc, j, out) {', "function lobeColour(kind, pc, j, out) {\n  if (kind === 'being') return out.setHSL((((B.hue + (j / 11 - .5) * (.12 + .25 * mind.arousal)) % 1) + 1) % 1, .55 + .35 * mind.arousal, .5 + .1 * mind.pitch[pc]);")
# love / not this inject dopamine into the being
rep('function feedback(sign) {', 'function feedback(sign) {\n  mind.inject(sign); blog.unshift(sign > 0 ? "loved: reward dopamine" : "not this: punishment dopamine");')
# new seed: hatch a different being
rep('pet.onReseed(() => reseed());', '''pet.onReseed(() => reseed());
pet.onNewSeed(() => { SEED = (Math.random() * 2147483647) | 0; try { localStorage.setItem('being-seed', String(SEED)); } catch {} mind = createMind(traitsFor(SEED), { earCF: EAR_CF }); reseed(); say('a new being hatched'); });''')

# ---- draw its inner life ------------------------------------------------------------------------------------------
rep('  if (S.awake > .05 || ++skip % 3 === 0) renderer.render(scene, camera);', '''  if (S.awake > .05 || ++skip % 3 === 0) renderer.render(scene, camera);
  if (look.hud && f0 - beingHudT > 66) { beingHudT = f0; drawBeing(); }''')
rep('/* ---------- loop ---------- */', '''/* ---------- its inner life, drawn: ear (hum vs fatigue), felt pulse bank, pulse dial, affect and drives ---------- */
let beingHudT = 0;
const bEl = document.getElementById('being'), bFeel = bEl.querySelector('.feel'), bSub = bEl.querySelector('.sub'), bLog = bEl.querySelector('.log'), bc = bEl.querySelector('canvas').getContext('2d');
function drawBeing() {
  const m = mind, W = 460, Hh = 300;
  bFeel.textContent = m.feeling();
  bSub.textContent = `being #${(SEED % 100000).toString().padStart(5, '0')} · own tempo ${(m.traits.f0 * 60).toFixed(0)} bpm · feels ${(m.pulseHz * 60).toFixed(0)} bpm`;
  bLog.textContent = blog.join(' · ') || ' ';
  bc.clearRect(0, 0, W, Hh);
  bc.font = '600 15px ui-monospace, Consolas, monospace'; bc.textBaseline = 'top';
  const label = (t, x, y) => { bc.fillStyle = 'rgba(223,227,255,.6)'; bc.fillText(t, x, y); };
  // ear: one bar per hair-cell unit, height = what it hears; colour = its state (cyan humming, white at the edge, red tired)
  label('ear', 0, 0);
  if (earFrame) for (let k = 0; k < 28; k++) {
    const a = earFrame.amp[k], mu = earFrame.mu[k], h = Math.min(60, Math.max(2, Math.log1p(a / .015) * 22));
    bc.fillStyle = mu > 0 ? '#7ff0ff' : mu < -.03 ? `rgba(255,${120 + 135 * (1 + mu / .08)},120,1)` : '#ffffff';
    bc.fillRect(40 + k * 14.5, 66 - h, 10, h);
  }
  // resonance: the felt-pulse oscillators 0.5-8 Hz; the motor pulse as a dot running round a ring
  label('pulse', 0, 76);
  const ra = m.resonance; let mx = 1e-6; for (const a of ra) mx = Math.max(mx, a);
  for (let i = 0; i < ra.length; i++) { const h = ra[i] / mx * 50; bc.fillStyle = 'rgba(180,170,255,.9)'; bc.fillRect(40 + i * 6.6, 140 - h, 4.6, h); }
  const cx = 420, cy = 112, r = 26, ph = m.pulsePhase * 2 * Math.PI - Math.PI / 2;
  bc.strokeStyle = `rgba(255,255,255,${.2 + .6 * m.lock})`; bc.lineWidth = 2; bc.beginPath(); bc.arc(cx, cy, r, 0, 2 * Math.PI); bc.stroke();
  bc.fillStyle = '#fff'; bc.beginPath(); bc.arc(cx + r * Math.cos(ph), cy + r * Math.sin(ph), 5 + 4 * m.lock, 0, 2 * Math.PI); bc.fill();
  // drives: horizontal meters
  const meters = [['arousal', m.arousal, '#ffb347'], ['valence', (m.valence + 1) / 2, '#9fe6ff'], ['groove', m.groove, '#7bf0a0'], ['surprise', Math.min(1, m.surprise / 2), '#ff7bd5'],
    ['dopamine', Math.min(1, Math.max(0, m.daPhasic + .5)), '#ffe66b'], ['anticip.', m.daAnticipation, '#ffd36b'], ['startle hab.', 1 - m.habituation, '#ff6b5e'], ['bored', m.bored, '#b0b0c0'],
    ['energy', m.energy, '#6bd36b'], ['tissue σ', Math.min(1, tissueStats.sigma / 1.4), '#8f7bff']];
  meters.forEach(([name, v, col], i) => {
    const x = (i % 2) * 230, y = 156 + Math.floor(i / 2) * 28;
    label(name, x, y); bc.fillStyle = 'rgba(255,255,255,.12)'; bc.fillRect(x + 110, y + 4, 100, 8); bc.fillStyle = col; bc.fillRect(x + 110, y + 4, 100 * Math.max(0, Math.min(1, v)), 8);
  });
}
/* ---------- loop ---------- */''')
io.open(p, 'w', encoding='utf8').write(s)
print('patched', len(s))
