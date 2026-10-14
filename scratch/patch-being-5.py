import io
p = 'being/index.html'
s = io.open(p, encoding='utf8').read()
def rep(a, b):
    global s
    assert a in s, ('missing', a[:100])
    s = s.replace(a, b, 1)

# ---- the procedural GLSL becomes a shared string (the body and the memory pictures use the same code) ------------------------
start = s.index("  // procedural vocabulary for the remembered skin")
end_marker = "    return vec2( v, clamp( e, 0., 1. ) );\n  }"
end = s.index(end_marker, start) + len(end_marker)
glsl = s[start:end]
s = s[:start] + "${SONG_GLSL}" + s[end:]
rep("const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);",
    "/* the remembered skin's procedural vocabulary, shared by the body shader and the memory pictures */\nconst SONG_GLSL = /* glsl */`\n" + glsl.replace('`', '') + "\n`;\nconst scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);")

# ---- memory: song fingerprint (absolute character) -> look; each song its own starting layout ------------------------------
rep("import { createMap, dnaWeights, featureOf, blend, paint, unb64, geneDna, MW, MH, NU, DIM } from './memory.mjs';",
    "import { createMap, dnaWeights, featureOf, blend, paint, unb64, geneDna, songLook, keyHash, CHAR_KEYS, MW, MH, NU, DIM } from './memory.mjs';")
rep("    MEM.meta = { title: t.title, artist: t.artist, plays: 1, firstHeard: Date.now(), feeling: 0 };",
    "    MEM.meta = { title: t.title, artist: t.artist, plays: 1, firstHeard: Date.now(), feeling: 0, char: CHAR_KEYS.map(k => (an.state.character && Number.isFinite(an.state.character[k]) ? an.state.character[k] : .4)) };")
rep("""  } else {        // a new song: its first impression is everything it has heard before, mixed with its own DNA
    MEM.song = createMap({ weights: blend(MEM.general.weights, MEM.dna, .15) });""",
"""  } else {        // a new song: its first impression is everything it has heard before, mixed with its own DNA and a layout of its own
    MEM.song = createMap({ weights: blend(blend(MEM.general.weights, MEM.dna, .15), dnaWeights((SEED ^ keyHash(t.key)) >>> 0), .4) });""")
# the song's character accumulates while it learns (fixed cross-song scales: this is what tells songs apart)
rep("    if (MEM.meta) MEM.meta.feeling = (MEM.meta.feeling || 0) + .01 * (mind.valence + .5 * mind.daTonic - (MEM.meta.feeling || 0));",
"""    if (MEM.meta) {
      MEM.meta.feeling = (MEM.meta.feeling || 0) + .01 * (mind.valence + .5 * mind.daTonic - (MEM.meta.feeling || 0));
      const ch = an.state.character; if (ch) { const c = MEM.meta.char || (MEM.meta.char = CHAR_KEYS.map(() => .4)); CHAR_KEYS.forEach((k, i) => { if (Number.isFinite(ch[k])) c[i] += .02 * (ch[k] - c[i]); }); }
    }""")
rep("paint(MEM.song, mind.traits.hue, songTex.image.data, songGlowTex.image.data, songGeneTex.image.data, MEM.geneDna || (MEM.geneDna = geneDna(SEED)));",
    "paint(MEM.song, mind.traits.hue, songTex.image.data, songGlowTex.image.data, songGeneTex.image.data, MEM.geneDna || (MEM.geneDna = geneDna(SEED)), currentLook());")
rep("const pngCanvas = document.createElement('canvas'); pngCanvas.width = 256; pngCanvas.height = 128;",
"""const currentLook = () => { const c = MEM.meta && MEM.meta.char; return songLook(c ? Object.fromEntries(CHAR_KEYS.map((k, i) => [k, c[i]])) : null, mind.traits.hue, SEED); };
const pngCanvas = document.createElement('canvas'); pngCanvas.width = 512; pngCanvas.height = 256;
// the picture of a memory is the real procedural skin, unrolled (same GLSL as the body), rendered on the GPU
const UNW = { uSongTex: { value: songTex }, uSongGlow: { value: songGlowTex }, uSongGene: { value: songGeneTex }, uTime: { value: 0 }, uDnaOff: U.uDnaOff };
const unwrapScene = new THREE.Scene(); unwrapScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: UNW, depthTest: false, depthWrite: false,
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
  fragmentShader: `precision highp float; varying vec2 vUv; uniform sampler2D uSongTex, uSongGlow, uSongGene; uniform float uTime; uniform vec3 uDnaOff;
    ${SONG_GLSL}
    vec3 dirOf( vec2 uv ) { float lon = ( uv.x - .5 ) * 6.2831853, lat = ( uv.y - .5 ) * 3.14159265; return vec3( cos( lat ) * cos( lon ), sin( lat ), cos( lat ) * sin( lon ) ); }
    void main() {
      vec3 c0 = texture2D( uSongTex, vUv ).rgb, sg = texture2D( uSongGlow, vUv ).rgb; vec4 g = texture2D( uSongGene, vUv );
      vec2 pat = songPattern( dirOf( vUv ), g );
      vec3 c = c0 * mix( .4, 1.4, pat.x ) * ( 1. - .55 * smoothstep( .35, .8, sg.b ) ) * mix( 1., .55, pat.y );
      float px = songPattern( dirOf( vUv + vec2( 1. / 512., 0. ) ), g ).x, py = songPattern( dirOf( vUv + vec2( 0., 1. / 256. ) ), g ).x;
      vec3 nr = normalize( vec3( ( pat.x - px ) * 2.5, ( pat.x - py ) * 2.5, 1. ) );
      gl_FragColor = vec4( c * ( .55 + .55 * max( dot( nr, normalize( vec3( -.4, .5, .8 ) ) ), 0. ) ) + pat.y * .06, 1. );
    }` })));
const unwrapRT = new THREE.WebGLRenderTarget(512, 256, { depthBuffer: false });""")
# replace the old blurry picture with the GPU unwrap
start = s.index("function songPng() {")
end = s.index("  return pngCanvas.toDataURL('image/png');\n}", start) + len("  return pngCanvas.toDataURL('image/png');\n}")
s = s[:start] + """function songPng() {   // a picture of what it remembers: its procedural skin for this song, unrolled
  paint(MEM.song, mind.traits.hue, songTex.image.data, songGlowTex.image.data, songGeneTex.image.data, MEM.geneDna || (MEM.geneDna = geneDna(SEED)), currentLook());
  songTex.needsUpdate = songGlowTex.needsUpdate = songGeneTex.needsUpdate = true;
  UNW.uTime.value = U.uTime.value;
  const prev = renderer.getRenderTarget(); renderer.setRenderTarget(unwrapRT); renderer.render(unwrapScene, camera);
  const px = new Uint8Array(512 * 256 * 4); renderer.readRenderTargetPixels(unwrapRT, 0, 0, 512, 256, px); renderer.setRenderTarget(prev);
  const ctx = pngCanvas.getContext('2d'), img = ctx.createImageData(512, 256);
  for (let y = 0; y < 256; y++) img.data.set(px.subarray((255 - y) * 512 * 4, (256 - y) * 512 * 4), y * 512 * 4);   // GL rows are bottom-up
  ctx.putImageData(img, 0, 0);
  return pngCanvas.toDataURL('image/png');
}""" + s[end:]

# ---- dials: rhythm accuracy and sync ------------------------------------------------------------------------------------------
rep("<div id=\"hud\"></div>",
"""<div id="hud"></div>
<div id="dials">
  <label for="rhythm">rhythm <small>own feel</small><input id="rhythm" type="range" min="0" max="100" value="60"><small>on the beat</small></label>
  <label for="sync">sync <input id="sync" type="range" min="0" max="400" step="5" value="40"><b id="syncv">40 ms</b></label>
</div>""")
rep("</style>", """  #dials { position: fixed; right: 8px; top: 48px; display: grid; gap: 4px; padding: 6px 9px; border-radius: 9px; background: rgba(6, 6, 14, .72); color: #dfe3ff;
    font: 600 10px/1.2 ui-monospace, Consolas, monospace; opacity: .45; transition: opacity .25s; z-index: 5; }
  #dials:hover { opacity: 1; }
  #dials label { display: flex; align-items: center; gap: 6px; justify-content: flex-end; }
  #dials small { opacity: .6; font-size: 9px; }
  #dials input { width: 110px; accent-color: #9fe6ff; }
  #dials b { width: 44px; text-align: right; font-weight: 600; }
</style>""")
rep("const BEAT = { bpm: 0, phase: 0, confidence: 0, count: 0, downbeat: false, barPhase: 0 };",
"""const BEAT = { bpm: 0, phase: 0, confidence: 0, count: 0, downbeat: false, barPhase: 0 };
// the listener's dials: how strictly it follows the beat tracker, and how late its hearing is (output latency)
const DIALS = { rhythm: .6, sync: 40 };
try { const d = JSON.parse(localStorage.getItem('being-dials') || '{}'); if (Number.isFinite(d.rhythm)) DIALS.rhythm = d.rhythm; if (Number.isFinite(d.sync)) DIALS.sync = d.sync; } catch {}
{
  const rIn = document.getElementById('rhythm'), sIn = document.getElementById('sync'), sV = document.getElementById('syncv');
  const apply = () => { DIALS.rhythm = rIn.value / 100; DIALS.sync = +sIn.value; sV.textContent = DIALS.sync + ' ms'; beingWorker.postMessage({ type: 'delay', ms: DIALS.sync }); try { localStorage.setItem('being-dials', JSON.stringify(DIALS)); } catch {} };
  rIn.value = Math.round(DIALS.rhythm * 100); sIn.value = DIALS.sync; rIn.oninput = sIn.oninput = apply; apply();
  for (const el of [rIn, sIn]) el.addEventListener('pointerdown', e => e.stopPropagation());
}""")
# the analyzer is delayed by the same sync as the ear
rep("an.analyseUpTo(Math.max(0, an.total - Math.round(look.offset * 48)));", "an.analyseUpTo(Math.max(0, an.total - Math.round(DIALS.sync * 48)));")
rep("stereoAt(an.total - Math.round(look.offset * 48), SP);", "stereoAt(an.total - Math.round(DIALS.sync * 48), SP);")
# the mind gets the dial and the tracker's beat
rep("familiarity: MEM.song ? MEM.song.familiarity : undefined, progress: MEM.song ? MEM.song.progress : undefined })",
    "familiarity: MEM.song ? MEM.song.familiarity : undefined, progress: MEM.song ? MEM.song.progress : undefined, rhythm: DIALS.rhythm, beat: an.state.beat })")
# the panel shows how close its pulse is to the tracker's
rep("  bSub.textContent = `being #${(SEED % 100000).toString().padStart(5, '0')} · ${(m.life.listenSeconds / 3600).toFixed(1)} h of music · own tempo ${(m.traits.f0 * 60).toFixed(0)} bpm · feels ${(m.pulseHz * 60).toFixed(0)} bpm`;",
    "  bSub.textContent = `being #${(SEED % 100000).toString().padStart(5, '0')} · ${(m.life.listenSeconds / 3600).toFixed(1)} h of music · own tempo ${(m.traits.f0 * 60).toFixed(0)} bpm · feels ${(m.pulseHz * 60).toFixed(0)} bpm` + (an.state.beat.confidence > .2 ? ` · tracker ${an.state.beat.bpm.toFixed(0)} · on beat ${Math.round(100 - 100 * m.beatError)}%` : '');")
io.open(p, 'w', encoding='utf8').write(s)
print('patched', len(s))
