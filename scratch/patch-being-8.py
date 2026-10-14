import io
p = 'being/index.html'
s = io.open(p, encoding='utf8').read()
io.open('scratch/index.before-8.html', 'w', encoding='utf8').write(s)
def rep(a, b, n=1):
    global s
    assert a in s, ('missing', a[:110])
    s = s.replace(a, b, n)

# ---- imports ----------------------------------------------------------------------------------------------------------------
rep("import { speciesFor } from './species-lenia.mjs';", """import { speciesFor } from './species-lenia.mjs';
import { morphFor, dnaGenome, lerpGenome, mutate, validGenome, FAMILIES as MORPH_FAMILIES } from './morph.mjs';
import { createMorph } from './morph-gl.mjs';""")

# ---- uniforms ---------------------------------------------------------------------------------------------------------------
rep("uTissue: { value: null }, uTissueA: { value: .5 },", "uTissue: { value: null }, uTissueA: { value: .5 }, uMorph: { value: null }, uMorphA: { value: 0 }, uMorphD: { value: .03 },")
rep("uniform sampler2D uTissue; uniform float uTissueA;", "uniform sampler2D uTissue; uniform float uTissueA; uniform samplerCube uMorph; uniform float uMorphA; uniform float uMorphD;")

# ---- shape: the song's morphogenetic skin raises and carves the metal ------------------------------------------------------
rep("      if ( uSkinA > .01 ) { vec3 sn = normalize( p ), sk = skinSample( uSkin, sn ); disp += ",
    "      if ( uMorphA > .01 ) disp += ( textureLod( uMorph, normalize( p ), 0. ).r - .5 ) * 2. * uMorphD * uMorphA * smoothstep( .15, 0., d );   // the song's grown form (morph.mjs)\n      if ( uSkinA > .01 ) { vec3 sn = normalize( p ), sk = skinSample( uSkin, sn ); disp += ")

# ---- shading: its forms catch the light (height, edges) and shade their own creases (height minus a blurred mip) ----------
rep("      if ( uSkinA > .01 ) { vec3 skv = skinSample( uSkin, sn ) * ( 1. - smoothstep( .85, .99, abs( sn.y ) ) ); pat = vec2( skv.r, skv.g ); }",
    """      if ( uSkinA > .01 ) { vec3 skv = skinSample( uSkin, sn ) * ( 1. - smoothstep( .85, .99, abs( sn.y ) ) ); pat = vec2( skv.r, skv.g ); }
      float morphAO = 1.;
      if ( uMorphA > .01 ) {
        vec4 mo = textureLod( uMorph, sn, 0. ); float blurH = textureLod( uMorph, sn, 4. ).r;
        pat = mix( pat, mo.rg, clamp( uMorphA, 0., 1. ) * ( 1. - .45 * min( uSkinA, 1. ) ) );
        morphAO = clamp( 1. + ( mo.r - blurH ) * 4.5, .3, 1.15 );   // cavities darken, ridges catch a little more light
      }""")
rep("      col = ( cMetal * uMatA.x + cGlass * uMatA.y + cVelvet * uMatA.z + cObs * uMatA.w + cIri * uMatB.x + cBio * uMatB.y ) / wsum;",
    "      col = ( cMetal * uMatA.x + cGlass * uMatA.y + cVelvet * uMatA.z + cObs * uMatA.w + cIri * uMatB.x + cBio * uMatB.y ) / wsum;\n      col *= mix( 1., morphAO, min( uMorphA, 1. ) );")
rep("  U.uDisp.value = Math.min(.14, U.uSkinA.value * .03 +", "  U.uDisp.value = Math.min(.14, U.uSkinA.value * .03 + U.uMorphA.value * U.uMorphD.value * 1.2 +")

# ---- the living skin (Lenia) is now one family among the morph families ----------------------------------------------------
rep("  const want = (.35 + .75 * SKIN.expr) * T.skinAmt;   // the skin carves deeper when the song surfaces",
    "  const want = (.06 + .95 * MORPH.living + .3 * SKIN.expr) * T.skinAmt;   // Lenia is the 'living' family of the song's skin")

# ---- the morph director ------------------------------------------------------------------------------------------------------
rep("function beingBody(dt, t) {", """/* ---------- the song's skin (morph.mjs, morph-gl.mjs) ----------
   Every song starts on the being's own DNA skin and grows into the song's genome while it listens (maturity t, from 20 s
   to 2 min); a known song comes back already grown (preconception). The cell mosaic cleaves 2, 4, 8, ... as it matures.
   Sections mutate the genome a little. The bake runs every frame (it carries slow internal motion). */
const morph = createMorph(renderer, THREE, { size: 384 });
U.uMorph.value = morph.texture;
const MORPH = { dna: dnaGenome(SEED), song: null, evolved: null, cur: null, t: 0, floor: 0, sec: 0, living: 0, cellN: 0, next: 0, flow: 0, half: false, motion: new THREE.Vector4() };
MORPH.cur = MORPH.dna; MORPH.living = MORPH.dna.w.living || 0;
const morphTop = (g) => MORPH_FAMILIES.filter(f => (g.w[f] || 0) > .12).sort((a, b) => g.w[b] - g.w[a]).join('+');
function morphTick(dt, t) {
  const exp = MEM.song ? MEM.song.experience : 0;
  const target = MORPH.song ? Math.max(MORPH.floor, c01((exp - 20) / 100)) : 0;
  MORPH.t += (target - MORPH.t) * (1 - Math.exp(-dt / 4));
  MORPH.flow += dt * (.12 + .7 * mind.arousal);
  if (t >= MORPH.next) {
    MORPH.next = t + .12;
    const g = MORPH.song ? lerpGenome(MORPH.dna, MORPH.evolved || MORPH.song, MORPH.t) : MORPH.dna;
    MORPH.cur = g; MORPH.living = g.w.living || 0;
    if ((MORPH.t > .5) !== MORPH.half) { MORPH.half = MORPH.t > .5; if (MORPH.half) { blog.unshift('its skin becomes the song'); skinFlush(.9, 'the song takes shape'); } }
    // cleavage: the mosaic divides as it gets to know the song
    const full = Math.max(2, g.cells.n), k = Math.max(1, Math.round(1 + MORPH.t * (Math.log2(full) - 1))), n = Math.min(full, 2 ** k);
    if (MORPH.cellN && n > MORPH.cellN && (g.w.cells || 0) > .12) { blog.unshift(`its skin divides: ${n} cells`); skinFlush(.55, 'it divides'); }
    MORPH.cellN = n;
    morph.setGenome(g, { cellN: n, cellSeed: (SEED ^ (MEM.key ? keyHash(MEM.key) : 7)) >>> 0 });
  }
  MORPH.motion.set(MORPH.flow, SHOW.phase, earFrame ? earFrame.sub : 0, mind.arousal);
  morph.bake(t, MORPH.motion);
  U.uMorphA.value = .55 + .25 * MORPH.t + .45 * Math.min(1, SKIN.expr);   // the song surfacing carves its form deeper
  U.uMorphD.value = MORPH.cur.depth;
}
function morphSection() {   // a new section: the song's form evolves a step (deterministic for this song and section)
  if (!MORPH.song || MORPH.t < .4) return;
  MORPH.sec++;
  MORPH.evolved = mutate(MORPH.evolved || MORPH.song, (keyHash(MEM.key) ^ Math.imul(MORPH.sec, 7919)) >>> 0, .1);
}
window.__morph = () => ({ t: +MORPH.t.toFixed(2), song: MORPH.song ? morphTop(MORPH.song) : null, cur: morphTop(MORPH.cur), cells: MORPH.cellN, sym: MORPH.cur.sym, attMs: +morph.state.attMs.toFixed(1), living: +MORPH.living.toFixed(2) });
window.__morphForce = (char, seed, t = 1) => { MORPH.song = morphFor(char, seed >>> 0, SEED); MORPH.evolved = null; MORPH.floor = t; MORPH.t = t; MORPH.next = 0; MORPH.cellN = 0; return morphTop(MORPH.song); };   // lab hook
function beingBody(dt, t) {""")
rep("    U.uSongAmt.value = 0;   // the remembered song is never painted on: it shapes the living skin",
    "    U.uSongAmt.value = 0;   // the remembered song is never painted on: it shapes the living skin\n    morphTick(dt, t);")
# the song's genome is chosen with its Lenia species (after 20 s of listening), stored with the song
rep("      MEM.meta.lenia = speciesFor(charOf(MEM.meta.char), keyHash(MEM.key), SEED);",
    """      MEM.meta.lenia = speciesFor(charOf(MEM.meta.char), keyHash(MEM.key), SEED);
      if (!MORPH.song) { MEM.meta.morph = morphFor(charOf(MEM.meta.char), keyHash(MEM.key), SEED); MORPH.song = MEM.meta.morph; MORPH.evolved = null; MORPH.sec = 0; blog.unshift(`grows a ${morphTop(MORPH.song)} skin`); }""")
# a known song comes back with its form already grown
rep("    if (stored.meta.lenia) applySpecies(stored.meta.lenia);",
    "    if (stored.meta.lenia) applySpecies(stored.meta.lenia);\n    if (validGenome(stored.meta.morph)) { MORPH.song = stored.meta.morph; MORPH.floor = .8; }")
rep("  MEM.key = t.key;", "  MEM.key = t.key;\n  MORPH.song = null; MORPH.evolved = null; MORPH.floor = 0; MORPH.sec = 0; MORPH.cellN = 0;   // back toward its own skin until it knows this song")
rep("      case 'section': if (!hadDrop && now - S.flashT > 300) {", "      case 'section': morphSection(); if (!hadDrop && now - S.flashT > 300) {")

# ---- the memory picture: the grown form (and the living skin) as a lit metal relief ---------------------------------------
rep("uSkinT: { value: null }, uLightC: U.uLight,", "uSkinT: { value: null }, uMorphT: { value: null }, uLiving: { value: 0 }, uLightC: U.uLight,")
rep("""    uniform sampler2D uSkinT; uniform vec3 uLightC, uTint;
    void main() {   // the song's living skin as a lit metal relief
      vec2 e = vec2( 1. / 192., 1. / 96. );
      float h = texture2D( uSkinT, vUv ).r, hx = texture2D( uSkinT, vUv + vec2( e.x, 0. ) ).r, hy = texture2D( uSkinT, vUv + vec2( 0., e.y ) ).r;
      float edge = texture2D( uSkinT, vUv ).g;""",
"""    uniform sampler2D uSkinT; uniform samplerCube uMorphT; uniform float uLiving; uniform vec3 uLightC, uTint;
    vec2 hgt( vec2 uv ) { vec2 m = textureCube( uMorphT, dirOf( uv ) ).rg, l = texture2D( uSkinT, uv ).rg; return mix( m, l, uLiving ); }
    void main() {   // the song's grown form (and its living skin) as a lit metal relief
      vec2 e = vec2( 1. / 512., 1. / 256. );
      vec2 h0 = hgt( vUv ); float h = h0.x, hx = hgt( vUv + vec2( e.x, 0. ) ).x, hy = hgt( vUv + vec2( 0., e.y ) ).x;
      float edge = h0.y;""")
rep("      vec3 nr = normalize( vec3( ( h - hx ) * 6., ( h - hy ) * 6., 1. ) );", "      vec3 nr = normalize( vec3( ( h - hx ) * 14., ( h - hy ) * 14., 1. ) );")
rep("  UNW.uTime.value = U.uTime.value; UNW.uSkinT.value = skin.texture;", "  UNW.uTime.value = U.uTime.value; UNW.uSkinT.value = skin.texture; UNW.uMorphT.value = morph.texture; UNW.uLiving.value = Math.min(.8, MORPH.living);")
io.open(p, 'w', encoding='utf8').write(s)
print('patched', len(s))
