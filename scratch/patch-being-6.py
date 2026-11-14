import io
p = 'being/index.html'
s = io.open(p, encoding='utf8').read()
def rep(a, b, n=1):
    global s
    assert a in s, ('missing', a[:110])
    s = s.replace(a, b, n)

# ---- uniforms: the living skin (Lenia) is back on uSkin; the nervous tissue gets its own channel ---------------------------
rep("  uSongGene: { value: null }, uDnaOff: { value: new THREE.Vector3() },",
    "  uSongGene: { value: null }, uDnaOff: { value: new THREE.Vector3() }, uTissue: { value: null }, uTissueA: { value: .5 },")
rep("  uniform sampler2D uSongGene; uniform vec3 uDnaOff; uniform vec4 uMatA; uniform vec2 uMatB; uniform float uBeatPulse;",
    "  uniform sampler2D uSongGene; uniform vec3 uDnaOff; uniform vec4 uMatA; uniform vec2 uMatB; uniform float uBeatPulse; uniform sampler2D uTissue; uniform float uTissueA;")

# ---- shading: no painted pattern. The materials read the living skin's height and edges (shape, not paint) ------------------
start = s.index("      if ( uSongAmt > .01 ) {\n        songC0 = textureLod( uSongTex, suv, 0. ).rgb;")
end = s.index("      vec3 r = reflect( rd, n );", start)
s = s[:start] + """      // the living skin's height (r) and growth edges (g): materials catch light on the forms it carves, nothing is painted on
      if ( uSkinA > .01 ) { vec3 skv = skinSample( uSkin, sn ) * ( 1. - smoothstep( .85, .99, abs( sn.y ) ) ); pat = vec2( skv.r, skv.g ); }
""" + s[end:]
rep("      vec3 accent = mix( uLight, songC0 * 1.8 + .1, .55 );", "      vec3 accent = mix( uLight, uTissueC, .4 );")
# original skin shading (edges lit by the core light) + the nervous tissue's faint flashes as a separate layer
rep("        col = mix( col, col * ( .5 + .5 * ( 1. - sk.r ) ), .5 * min( uSkinA, 1. ) ) + mix( uLight, uTissueC, .75 ) * sk.g * .75 * uSkinA * ( .35 + uGlow );",
    """        col = mix( col, col * ( .5 + .5 * ( 1. - sk.r ) ), .5 * min( uSkinA, 1. ) ) + uLight * sk.g * .55 * min( uSkinA, 1. ) * uGlow;
      }
      if ( uTissueA > .01 ) {   // its nervous tissue firing: faint flashes under the surface
        vec3 tz = skinSample( uTissue, normalize( p ) );
        col += uTissueC * tz.g * .3 * uTissueA * ( .4 + uGlow );""")

# ---- JS: bring back the real Lenia skin; species per song; growth seeded where the sound lives; flushes deepen it ------------
rep("import { createMap, dnaWeights, featureOf, blend, paint, unb64, geneDna, songLook, keyHash, CHAR_KEYS, MW, MH, NU, DIM } from './memory.mjs';",
    "import { createMap, dnaWeights, featureOf, blend, paint, unb64, geneDna, songLook, keyHash, CHAR_KEYS, MW, MH, NU, DIM } from './memory.mjs';\nimport { speciesFor } from './species-lenia.mjs';")
rep("const skin = { setParams() {}, feed() {}, step() {}, stats: null };   // the Lenia skin is replaced by the being's tissue\nU.uSkin.value = tissueTex;",
    """const skin = createSkin(renderer, THREE, { width: 192, height: 96 });   // its living skin: one Lenia species per song (species-lenia.mjs)
U.uSkin.value = skin.texture; U.uTissue.value = tissueTex;
const charOf = (arr) => (arr ? Object.fromEntries(CHAR_KEYS.map((k, i) => [k, arr[i]])) : null);
function applySpecies(def, why) {
  if (!def) return;
  skin.setParams({ pattern: def, growth: .5, speed: .5, contrast: .6 });
  ML.skin = def.family || 'custom';
  if (why) blog.unshift(why);
}
applySpecies(speciesFor(null, SEED, SEED));   // before it knows a song: its own species""")
# mlFrame: the analyzer no longer picks the skin pattern; the skin's depth follows the cuttlefish flushes
start = s.index("  // without a mind (off, or still loading), the analysis picks the skin pattern")
end = s.index("  U.uSkinA.value += (want - U.uSkinA.value)", start)
s = s[:start] + "  const want = (.35 + .75 * SKIN.expr) * T.skinAmt;   // the skin carves deeper when the song surfaces\n" + s[end:]
# the memory flushes now deepen the living skin instead of painting a pattern
rep("    U.uSongAmt.value += (Math.min(1, SKIN.expr) * (.45 + .55 * learned) * (.6 + .4 * S.awake) - U.uSongAmt.value) * (1 - Math.exp(-dt / .9));",
    """    U.uSongAmt.value = 0;   // the remembered song is never painted on: it shapes the living skin
    U.uTissueA.value = .35 + .4 * c01(tissueStats.act * 60);
    // the longer it listens, the more the skin becomes this song's species (fixed once it knows the song well enough)
    if (MEM.meta && !MEM.meta.lenia && MEM.song.experience > 20) {
      MEM.meta.lenia = speciesFor(charOf(MEM.meta.char), keyHash(MEM.key), SEED);
      applySpecies(MEM.meta.lenia, `grows a ${MEM.meta.lenia.family} skin for this song`);
      skinFlush(1, 'its own skin');
    }""")
# a known song brings its species back immediately (preconception)
rep("    mind.recall(stored.meta.feeling || 0, MEM.meta.plays); MEM.recog = 1; B.chill = Math.max(B.chill, .5);",
    "    mind.recall(stored.meta.feeling || 0, MEM.meta.plays); MEM.recog = 1; B.chill = Math.max(B.chill, .5);\n    if (stored.meta.lenia) applySpecies(stored.meta.lenia);")
# where the being recognises the sound on its body map, its skin grows
rep("    MEM.song.learn(MEM.feat, .1); MEM.general.learn(MEM.feat, .1);",
    """    MEM.song.learn(MEM.feat, .1); MEM.general.learn(MEM.feat, .1);
    const b = MEM.song.bmu;
    if (b >= 0 && Math.random() < .25 + .5 * a.onset) skin.seedAt((b % MW + .5) / MW, (((b / MW) | 0) + .5) / MH, .6 + .4 * Math.min(1, a.onset), .7 + .5 * Math.min(1, a.onset));""")
# the memory picture: the song's living skin, lit as relief
rep("const UNW = { uSongTex: { value: songTex }, uSongGlow: { value: songGlowTex }, uSongGene: { value: songGeneTex }, uTime: { value: 0 }, uDnaOff: U.uDnaOff };",
    "const UNW = { uSongTex: { value: songTex }, uSongGlow: { value: songGlowTex }, uSongGene: { value: songGeneTex }, uTime: { value: 0 }, uDnaOff: U.uDnaOff, uSkinT: { value: null }, uLightC: U.uLight, uTint: U.uTissueC };")
start = s.index("    void main() {\n      vec3 c0 = texture2D( uSongTex, vUv ).rgb, sg = texture2D( uSongGlow, vUv ).rgb; vec4 g = texture2D( uSongGene, vUv );")
end = s.index("    }` })));", start)
s = s[:start] + """    uniform sampler2D uSkinT; uniform vec3 uLightC, uTint;
    void main() {   // the song's living skin as a lit metal relief
      vec2 e = vec2( 1. / 192., 1. / 96. );
      float h = texture2D( uSkinT, vUv ).r, hx = texture2D( uSkinT, vUv + vec2( e.x, 0. ) ).r, hy = texture2D( uSkinT, vUv + vec2( 0., e.y ) ).r;
      float edge = texture2D( uSkinT, vUv ).g;
      vec3 nr = normalize( vec3( ( h - hx ) * 6., ( h - hy ) * 6., 1. ) );
      float lit = max( dot( nr, normalize( vec3( -.4, .5, .8 ) ) ), 0. ), spec = pow( max( dot( reflect( - normalize( vec3( -.4, .5, .8 ) ), nr ), vec3( 0., 0., 1. ) ), 0. ), 24. );
      vec3 metal = vec3( .55, .56, .6 ) * ( .25 + .75 * lit ) * ( .45 + .55 * h ) + spec * .8;
      gl_FragColor = vec4( metal + uLightC * edge * .35 + uTint * edge * .15, 1. );
""" + s[end:]
rep("  UNW.uTime.value = U.uTime.value;", "  UNW.uTime.value = U.uTime.value; UNW.uSkinT.value = skin.texture;")
io.open(p, 'w', encoding='utf8').write(s)
print('patched', len(s))
