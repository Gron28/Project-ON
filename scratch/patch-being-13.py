import io
p = 'being/index.html'
s = io.open(p, encoding='utf8').read()
io.open('scratch/index.before-13.html', 'w', encoding='utf8').write(s)
def rep(a, b, n=1):
    global s
    assert a in s, ('missing', a[:110])
    s = s.replace(a, b, n)

# ---- pet mode: no UI at all (the dashboard and the menus hold everything) ----------------------------------------------
rep("  #dials { position: fixed;", "  body.pet #dials, body.pet #say, body.pet #hud, body.pet #being, body.pet #fb { display: none !important; }\n  #dials { position: fixed;")
rep("const localPointer=new URLSearchParams(location.search).get('local')==='1';",
    "const localPointer=new URLSearchParams(location.search).get('local')==='1';\nif (new URLSearchParams(location.search).get('ui') === '0') document.body.classList.add('pet');   // the desktop pet: no UI")

# ---- tuning persists (the dashboard sets it) --------------------------------------------------------------------------------
rep("pet.onLook(l => { look = { lobes: 'metal', ...l, fx: { ...l.fx } }; onTune(l.tune || {});",
    "const storedTune = () => { try { return JSON.parse(localStorage.getItem('being-tune') || '{}') || {}; } catch { return {}; } };\npet.onLook(l => { look = { lobes: 'metal', ...l, fx: { ...l.fx } }; onTune({ ...storedTune(), ...(l.tune || {}) });")

# ---- developer overrides, applied where each system decides -------------------------------------------------------------
rep("const DEV = { stain: false };   // developer overrides (the dashboard sets these)",
    "const DEV = { stain: false, mat: -1, family: null, layer: {}, M: null, sleep: 'auto', maturity: null, light: null, metal: null, uni: {} };   // developer overrides (the dashboard sets these)")
rep("    const g = MORPH.song ? lerpGenome(MORPH.dna, MORPH.evolved || MORPH.song, MORPH.t) : MORPH.dna;",
    "    let g = MORPH.song ? lerpGenome(MORPH.dna, MORPH.evolved || MORPH.song, MORPH.t) : MORPH.dna;\n    if (DEV.family) g = { ...g, w: { ...DEV.family } };")
rep("  const target = MORPH.song ? Math.max(MORPH.floor, c01((exp - 20) / 100)) : 0;",
    "  const target = DEV.maturity != null ? DEV.maturity : MORPH.song ? Math.max(MORPH.floor, c01((exp - 20) / 100)) : 0;")
rep("  U.uMatA.value.set(w[0], w[1], w[2], w[3]); U.uMatB.value.set(w[4], w[5]);",
    "  if (DEV.mat >= 0) for (let i = 0; i < 6; i++) w[i] = i === DEV.mat ? 1 : 0;\n  U.uMatA.value.set(w[0], w[1], w[2], w[3]); U.uMatB.value.set(w[4], w[5]);")
rep("  SLEEP.z += ((B2.silence > 2 ? 1 : 0) - SLEEP.z) * (1 - Math.exp(-dt / (B2.silence > 2 ? 2.5 : .25)));",
    "  const asleep = DEV.sleep === 'asleep' || (DEV.sleep === 'auto' && B2.silence > 2);\n  SLEEP.z += ((asleep ? 1 : 0) - SLEEP.z) * (1 - Math.exp(-dt / (asleep ? 2.5 : .25)));")
rep("  REST.M += (want - REST.M) * (1 - Math.exp(-dt / (want > REST.M ? .25 : 3)));",
    "  REST.M += ((DEV.M != null ? DEV.M : want) - REST.M) * (1 - Math.exp(-dt / (want > REST.M ? .25 : 3)));")
rep("      const target = (name === REST.win[group] ? 1 : REST.M) * (1 - SLEEP.z * (name === 'morph' ? .9 : 1));",
    "      const force = DEV.layer[name];\n      const target = force === 'on' ? 1 : force === 'off' ? 0 : (name === REST.win[group] ? 1 : REST.M) * (1 - SLEEP.z * (name === 'morph' ? .9 : 1));")
rep("  for (const key of ORNAMENTS) { REST.saved.set(key, U[key].value); U[key].value *= og; }",
    """  for (const key of ORNAMENTS) { REST.saved.set(key, U[key].value); U[key].value *= og; }
  for (const [key, v] of Object.entries(DEV.uni)) if (U[key] && typeof U[key].value === 'number') { if (!REST.saved.has(key)) REST.saved.set(key, U[key].value); U[key].value = v; }   // raw uniform overrides
  if (DEV.light) U.uLight.value.setRGB(DEV.light[0], DEV.light[1], DEV.light[2]);
  if (DEV.metal) U.uMetal.value.setRGB(DEV.metal[0], DEV.metal[1], DEV.metal[2]);""")

# ---- the dashboard snapshot: everything inside, ~8 times a second while someone looks ------------------------------------
start = s.index("  pet.devSnap({\n    title: ML.title, source, perf: { fps, frameMs: lastFrameMs },")
end = s.index("    fb: ML.fb, events: DEV_EV\n  });\n}", start) + len("    fb: ML.fb, events: DEV_EV\n  });\n}")
s = s[:start] + """  window.__gpuT = true;   // GPU timer queries per pass while the dashboard is open
  const m = mind, e = earFrame, g = MORPH.cur, ti = timing, num = (x, d = 3) => (Number.isFinite(x) ? +x.toFixed(d) : 0);
  const snap = {
    t: now, perf: { fps, frameMs: num(lastFrameMs, 1), gpu: GT.res.bake || GT.res.body ? window.__gpuStats() : null },
    ear: e ? { amp: Array.from(e.amp, (x) => num(x, 4)), onset: num(e.onset), rough: num(e.rough), sub: num(e.sub), level: num(e.level, 4), hum: num(e.hum) } : null,
    tissue: { act: num(tissueStats.act, 4), sigma: num(tissueStats.sigma), branching: num(tissueStats.branching) },
    engine: { level: num(st.level, 4), intensity: num(st.intensity), energy: num(st.energy), centroid: num(st.centroid), drums: { kick: num(st.drums.kick), snare: num(st.drums.snare), hat: num(st.drums.hat) },
      beat: { bpm: num(st.beat.bpm, 1), confidence: num(st.beat.confidence) }, structure: { section: st.structure.section, tension: num(st.structure.tension) }, character: st.character ? Object.fromEntries(Object.entries(st.character).map(([k, v]) => [k, num(v)])) : null },
    mind: { feeling: m.feeling(), arousal: num(m.arousal), valence: num(m.valence), mood: num(m.mood), energy: num(m.energy), bored: num(m.bored), confused: num(m.confused),
      lock: num(m.lock), groove: num(m.groove), sync: num(m.sync), surprise: num(m.surprise), entropy: num(m.entropy), daPhasic: num(m.daPhasic), daAnt: num(m.daAnticipation), daTonic: num(m.daTonic),
      pulseBpm: num(m.pulseHz * 60, 1), phase: num(SHOW.phase), resonance: Array.from(m.resonance, (x) => num(x)), resonanceHz: Array.from(m.resonanceHz, (x) => num(x)), pitch: Array.from(m.pitch, (x) => num(x)),
      traits: { f0: num(m.traits.f0 * 60, 1), aHome: num(m.traits.aHome), vHome: num(m.traits.vHome), hue: num(m.traits.hue) }, life: m.life },
    timing: { bias: num(ti.bias), errMs: num(ti.errorMs, 1), predicted: num(ti.predicted), evidence: ti.evidence, gate: num(SHOW.gate), horizon: num(LATM.horizon, 1), delay: num(LATM.delay, 1),
      grid: Object.fromEntries(Object.entries(ti.grid).map(([k, v]) => [k, Array.from(v, (x) => num(x, 2))])) },
    morph: { t: num(MORPH.t), song: MORPH.song ? morphTop(MORPH.song) : null, w: Object.fromEntries(MORPH_FAMILIES.map((f) => [f, num(g.w[f] || 0)])), sym: g.sym, mirror: g.mirror, freq: num(g.freq), crisp: num(g.crisp, 1),
      depth: num(g.depth, 4), cells: MORPH.cellN, sections: MORPH.sec, stain: g.stain ? { names: g.stain.names } : null, stainNow: { mem: U.uStainM.value.toArray().map((x) => num(x)), nuc: U.uStainN.value.toArray().map((x) => num(x)), cyto: U.uStainC.value.toArray().map((x) => num(x)) } },
    rest: { M: num(REST.M), win: { ...REST.win }, g: Object.fromEntries(Object.entries(REST.g).map(([k, v]) => [k, num(v)])), sal: Object.fromEntries(Object.entries(REST.sal).map(([k, v]) => [k, num(v)])) },
    sleep: num(SLEEP.z), pressure: { p: num(pressure.pressure), charge: num(pressure.charge), tension: num(pressure.tension), state: pressure.state }, beads: { on: BEAD.on, a: num(BEAD.a) },
    materials: { names: MATS, w: Array.from(MAT.x, (x) => num(x)), cur: MAT.cur },
    memory: { title: MEM.meta ? MEM.meta.title : null, artist: MEM.meta ? MEM.meta.artist : null, album: MEM.meta ? MEM.meta.album : null, plays: MEM.meta ? MEM.meta.plays : 0,
      familiarity: MEM.song ? num(MEM.song.familiarity) : 0, experience: MEM.song ? num(MEM.song.experience, 1) : 0, known: MEM.known },
    look: { light: U.uLight.value.toArray().map((x) => num(x)), metal: U.uMetal.value.toArray().map((x) => num(x)), glow: num(U.uGlow.value) },
    tune: { user: { ...ML.user }, live: Object.fromEntries(Object.entries(T).map(([k, v]) => [k, num(v)])) }, dials: { rhythm: DIALS.rhythm, sync: DIALS.sync },
    dev: DEV, seed: SEED, log: blog.slice(0, 8), events: DEV_EV.slice(-30),
  };
  if (now - (devFrame.picAt || 0) > 2500) { devFrame.picAt = now; try { snap.skinPng = songPng(); } catch {} }   // the grown skin, unrolled
  pet.devSnap(snap);
}
// the dashboard's commands: tuning, colours, forcing systems, actions
pet.onDevCmd(c => {
  if (!c || typeof c !== 'object') return;
  const rgb = (v) => (Array.isArray(v) && v.length === 3 && v.every(Number.isFinite) ? v.map((x) => Math.max(0, Math.min(2, x))) : null);
  switch (c.k) {
    case 'tune': { if (!ML.keys.includes(c.key) || !Number.isFinite(c.v)) return; const t = { ...storedTune(), [c.key]: c.v }; try { localStorage.setItem('being-tune', JSON.stringify(t)); } catch {} onTune(t); break; }
    case 'tuneReset': { const t = { ...storedTune() }; if (c.key) delete t[c.key]; else for (const k in t) delete t[k]; try { localStorage.setItem('being-tune', JSON.stringify(t)); } catch {} onTune(t); break; }
    case 'stain': { const v = rgb(c.v); if (!v || !['mem', 'nuc', 'cyto'].includes(c.which)) return; DEV.stain = true; ({ mem: U.uStainM, nuc: U.uStainN, cyto: U.uStainC })[c.which].value.fromArray(v); break; }
    case 'stainAuto': DEV.stain = false; MORPH.next = 0; break;
    case 'stainAmt': if (Number.isFinite(c.v)) U.uStainA.value = Math.max(0, Math.min(2, c.v)); break;
    case 'light': DEV.light = rgb(c.v); break;
    case 'metal': DEV.metal = rgb(c.v); break;
    case 'material': DEV.mat = Number.isInteger(c.v) && c.v >= 0 && c.v < 6 ? c.v : -1; break;
    case 'family': DEV.family = c.v && typeof c.v === 'object' ? Object.fromEntries(MORPH_FAMILIES.map((f) => [f, Math.max(0, +c.v[f] || 0)])) : null; MORPH.next = 0; break;
    case 'layer': if (typeof c.name === 'string') { if (c.v === 'on' || c.v === 'off') DEV.layer[c.name] = c.v; else delete DEV.layer[c.name]; } break;
    case 'M': DEV.M = Number.isFinite(c.v) ? Math.max(0, Math.min(1, c.v)) : null; break;
    case 'sleep': DEV.sleep = ['auto', 'awake', 'asleep'].includes(c.v) ? c.v : 'auto'; break;
    case 'maturity': DEV.maturity = Number.isFinite(c.v) ? Math.max(0, Math.min(1, c.v)) : null; MORPH.next = 0; break;
    case 'uniform': if (typeof c.name === 'string' && U[c.name] && typeof U[c.name].value === 'number') { if (Number.isFinite(c.v)) DEV.uni[c.name] = c.v; else delete DEV.uni[c.name]; } break;
    case 'beads': window.__beads(); break;
    case 'section': morphSection(); skinFlush(.8, 'dashboard'); break;
    case 'songGenome': { const r = Math.random; const ch = Object.fromEntries(CHAR_KEYS.map((k) => [k, r()])); window.__morphForce(ch, (r() * 1e9) >>> 0, Number.isFinite(c.v) ? c.v : 1); break; }
    case 'dial': if (c.key === 'rhythm' && Number.isFinite(c.v)) { document.getElementById('rhythm').value = Math.round(c.v * 100); document.getElementById('rhythm').oninput(); }
      else if (c.key === 'sync' && Number.isFinite(c.v)) DIALS.setSync(c.v); break;
    case 'clearOverrides': Object.assign(DEV, { stain: false, mat: -1, family: null, layer: {}, M: null, sleep: 'auto', maturity: null, light: null, metal: null, uni: {} }); MORPH.next = 0; break;
  }
});""" + s[end:]
rep("pet.onDev(on => { devOn = on; });", "pet.onDev(on => { devOn = on; if (!on) window.__gpuT = false; });")
io.open(p, 'w', encoding='utf8').write(s)
print('patched', len(s))
