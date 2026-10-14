import io
p = 'being/index.html'
s = io.open(p, encoding='utf8').read()
def rep(a, b):
    global s
    assert a in s, ('missing', a[:90])
    s = s.replace(a, b, 1)

rep("import { createMind, traitsFor } from './mind.mjs';",
    "import { createMind, traitsFor } from './mind.mjs';\nimport { createMap, dnaWeights, featureOf, blend, paint, unb64, MW, MH, NU, DIM } from './memory.mjs';")

# ---- uniforms + shader: the song skin colours and shapes the metal, and lights up where it recognises the sound -------
rep("  uTissueC: { value: new THREE.Color(.4, 1, .8) }\n};",
"""  uTissueC: { value: new THREE.Color(.4, 1, .8) },
  // its memory of the song: colour + height (RGBA) and recognition glow (R) of the self-organizing map on its skin
  uSongTex: { value: null }, uSongGlow: { value: null }, uSongAmt: { value: 0 }, uSongRot: { value: 0 }
};""")
rep("  uniform float uSH[ 21 ]; uniform vec4 uJc; uniform float uJw; uniform float uNuc; uniform float uNucRot; uniform vec3 uTissueC;",
"""  uniform float uSH[ 21 ]; uniform vec4 uJc; uniform float uJw; uniform float uNuc; uniform float uNucRot; uniform vec3 uTissueC;
  uniform sampler2D uSongTex; uniform sampler2D uSongGlow; uniform float uSongAmt; uniform float uSongRot;
  vec2 songUV( vec3 d ) { return vec2( fract( atan( d.z, d.x ) * .15915494 + .5 + uSongRot ), asin( clamp( d.y, -1., 1. ) ) * .31830989 + .5 ); }""")
rep("      disp += shDisp( normalize( p ) ) * smoothstep( .3, 0., d );",
    "      disp += shDisp( normalize( p ) ) * smoothstep( .3, 0., d );\n      if ( uSongAmt > .01 ) { vec3 sn = normalize( p ); float hgt = textureLod( uSongTex, songUV( sn ), 0. ).a, gl = textureLod( uSongGlow, songUV( sn ), 0. ).r;\n        disp += ( ( hgt - .45 ) * .09 + gl * .025 ) * uSongAmt * smoothstep( .25, 0., d ) * ( 1. - smoothstep( .85, .99, abs( sn.y ) ) ); }   // the remembered song raises and carves the metal")
rep("      if ( uFilm > 0. ) f0 = mix( f0, film( dot( n, v ) * 1.6 + uTime * .05 ) * .9 + .1, uFilm );",
"""      if ( uFilm > 0. ) f0 = mix( f0, film( dot( n, v ) * 1.6 + uTime * .05 ) * .9 + .1, uFilm );
      vec3 songC = vec3( 0. ); float songG = 0.;
      if ( uSongAmt > .01 ) { vec2 suv = songUV( normalize( p ) ); songC = textureLod( uSongTex, suv, 0. ).rgb; songG = textureLod( uSongGlow, suv, 0. ).r; f0 = mix( f0, songC * 1.15, .8 * uSongAmt ); }""")
rep("      alpha = 1.;\n    } else if ( tCore < 1e8 ) {",
"""      if ( uSongAmt > .01 ) col += mix( uLight, songC * 1.6 + .15, .6 ) * songG * ( .9 + 1.2 * uSongAmt ) * ( .5 + .5 * fres );   // where it recognises the sound, it glows
      alpha = 1.;
    } else if ( tCore < 1e8 ) {""")

# ---- memory state, learning, persistence ---------------------------------------------------------------------------
rep("const feedBeing = f =>",
"""/* ---------- its memory of songs (being/memory.mjs): one self-organizing map per song, grown on its skin ---------- */
const songTex = new THREE.DataTexture(new Uint8Array(NU * 4), MW, MH, THREE.RGBAFormat), songGlowTex = new THREE.DataTexture(new Uint8Array(NU * 4), MW, MH, THREE.RGBAFormat);
for (const t of [songTex, songGlowTex]) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true; }
const MEM = { dna: null, general: null, song: null, key: '', meta: null, known: 0, ready: false, acc: { amp: new Float32Array(28), onset: 0, rough: 0, sub: 0, level: 0, n: 0, t: 0 }, feat: new Float32Array(DIM), saveAt: 0, genSaveAt: 0, paintAt: 0, recog: 0 };
const pngCanvas = document.createElement('canvas'); pngCanvas.width = 256; pngCanvas.height = 128;
function songPng() {   // a picture of what it remembers: its skin map, unrolled
  const c = pngCanvas.getContext('2d'), src = document.createElement('canvas'); src.width = MW; src.height = MH;
  const img = src.getContext('2d').createImageData(MW, MH), { color } = paint(MEM.song, mind.traits.hue);
  for (let u = 0; u < NU; u++) { img.data[u * 4] = color[u * 4]; img.data[u * 4 + 1] = color[u * 4 + 1]; img.data[u * 4 + 2] = color[u * 4 + 2]; img.data[u * 4 + 3] = 255; }
  src.getContext('2d').putImageData(img, 0, 0); c.imageSmoothingEnabled = true; c.drawImage(src, 0, 0, 256, 128);
  return pngCanvas.toDataURL('image/png');
}
async function saveSong() {
  if (!MEM.ready || !MEM.key || !MEM.song || MEM.song.experience < 5) return;
  const d = MEM.song.serialize(); d.meta = { ...d.meta, ...MEM.meta, experience: MEM.song.experience, lastHeard: Date.now() };
  await pet.memorySave(SEED, MEM.key, d, songPng());
}
async function saveGeneral() { if (MEM.ready) await pet.memorySave(SEED, '__general__', MEM.general.serialize(), null); }
async function initMemory() {
  MEM.dna = dnaWeights(SEED);
  const g = await pet.memoryLoad(SEED, '__general__');
  MEM.general = createMap({ weights: g ? unb64(g.weights) : MEM.dna, meta: g ? g.meta : {}, fast: false });
  MEM.song = createMap({ weights: blend(MEM.general.weights, MEM.dna, .15) });   // before it knows what is playing
  MEM.known = (await pet.memoryIndex(SEED)).length;
  MEM.ready = true;
}
initMemory();
async function onTrack(t) {
  if (!MEM.ready) await initMemory();
  await saveSong();
  MEM.key = t.key;
  const stored = await pet.memoryLoad(SEED, t.key);
  if (stored) {   // a known song: its skin comes back, plus a little of what it has learned since from other songs
    MEM.song = createMap({ weights: blend(unb64(stored.weights), MEM.general.weights, .15), meta: stored.meta });
    MEM.meta = { ...stored.meta, title: t.title, artist: t.artist, plays: (stored.meta.plays || 1) + 1 };
    mind.recall(stored.meta.feeling || 0, MEM.meta.plays); MEM.recog = 1; B.chill = Math.max(B.chill, .5);
    blog.unshift(`remembers ${t.title}`); say(`remembers · ${t.title}`);
  } else {        // a new song: its first impression is everything it has heard before, mixed with its own DNA
    MEM.song = createMap({ weights: blend(MEM.general.weights, MEM.dna, .15) });
    MEM.meta = { title: t.title, artist: t.artist, plays: 1, firstHeard: Date.now(), feeling: 0 };
    MEM.known++; blog.unshift(`new song: ${t.title}`); say(`a new song · ${t.title}`);
  }
}
pet.onTrack(t => { onTrack(t).catch(e => console.warn('memory', e)); });
pet.onOpenMemories(() => pet.openMemories(SEED));
addEventListener('beforeunload', () => { saveSong(); saveGeneral(); });
// ear frames arrive at 100 Hz; every 100 ms of sound becomes one memory sample
function memoryHear(e) {
  const a = MEM.acc;
  for (let k = 0; k < 28; k++) a.amp[k] += e.amp[k];
  a.onset = Math.max(a.onset, e.onset); a.rough += e.rough; a.sub = Math.max(a.sub, e.sub); a.level = Math.max(a.level, e.level); a.n++;
  if (a.n < 10 || !MEM.ready) return;
  for (let k = 0; k < 28; k++) a.amp[k] /= a.n;
  const frame = { amp: a.amp, onset: a.onset, rough: a.rough / a.n, sub: a.sub, level: a.level };
  if (a.level > .008) {   // it only learns from sound, not from silence
    featureOf(frame, MEM.feat);
    MEM.song.learn(MEM.feat, .1); MEM.general.learn(MEM.feat, .1);
    if (MEM.meta) MEM.meta.feeling = (MEM.meta.feeling || 0) + .01 * (mind.valence + .5 * mind.daTonic - (MEM.meta.feeling || 0));
  }
  a.amp.fill(0); a.onset = 0; a.rough = 0; a.sub = 0; a.level = 0; a.n = 0;
}
const feedBeing = f =>""")
rep("  if (d.type === 'ear') { earFrame = d; if (d.onset > onsetPeak) onsetPeak = d.onset; }",
    "  if (d.type === 'ear') { earFrame = d; if (d.onset > onsetPeak) onsetPeak = d.onset; memoryHear(d); }")

# ---- the mind hears how familiar the sound is and how fast it is learning the song ------------------------------------
rep("{ tension: an.state.structure.tension, intensity: an.state.intensityAbs ?? an.state.intensity })",
    "{ tension: an.state.structure.tension, intensity: an.state.intensityAbs ?? an.state.intensity, familiarity: MEM.song ? MEM.song.familiarity : undefined, progress: MEM.song ? MEM.song.progress : undefined })")

# ---- the body wears it ---------------------------------------------------------------------------------------------------
rep("function beingBody(dt, t) {\n  if (!GENOME.sh.length) growGenome(SEED);",
"""function beingBody(dt, t) {
  if (!GENOME.sh.length) growGenome(SEED);
  if (MEM.song) {
    MEM.song.decay(dt);
    if (t - MEM.paintAt > .1) { MEM.paintAt = t; const { color, glow } = paint(MEM.song, mind.traits.hue, songTex.image.data, songGlowTex.image.data); songTex.needsUpdate = true; songGlowTex.needsUpdate = true; }
    U.uSongTex.value = songTex; U.uSongGlow.value = songGlowTex;
    // the remembered song shows more the longer it has listened to it (and fully at once when it recognises a known song)
    const learned = c01(MEM.song.experience / 90);
    MEM.recog *= Math.exp(-dt / 6);
    U.uSongAmt.value += ((.25 + .6 * learned + .2 * MEM.recog) * (.6 + .4 * S.awake) - U.uSongAmt.value) * (1 - Math.exp(-dt / 1.5));
    U.uSongRot.value += dt * .004 * (1 + mind.arousal);   // its skin slowly turns, so the map boils past
    if (t - MEM.saveAt > 30) { MEM.saveAt = t; saveSong(); }
    if (t - MEM.genSaveAt > 90) { MEM.genSaveAt = t; saveGeneral(); }
  }""")

# ---- the inner-life panel names what it remembers ---------------------------------------------------------------------
rep("  bLog.textContent = blog.join(' · ') || ' ';",
"""  const mem = MEM.song ? `${MEM.meta ? (MEM.meta.plays > 1 ? 'remembers' : 'learning') + ' “' + (MEM.meta.title || '?') + '”' + (MEM.meta.plays > 1 ? ' · ' + MEM.meta.plays + '×' : '') : 'listening'} · ${(MEM.song.experience / 60).toFixed(1)} min · familiar ${(MEM.song.familiarity * 100).toFixed(0)}% · knows ${MEM.known}` : '';
  bLog.textContent = mem + (blog.length ? ' · ' + blog[0] : '');""")
io.open(p, 'w', encoding='utf8').write(s)
print('patched', len(s))
