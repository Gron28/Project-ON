import io
p = 'being/index.html'
s = io.open(p, encoding='utf8').read()
def rep(a, b):
    global s
    assert a in s, ('missing', a[:100])
    s = s.replace(a, b, 1)

# ---- uniforms ------------------------------------------------------------------------------------------------------------
rep("  uSongTex: { value: null }, uSongGlow: { value: null }, uSongAmt: { value: 0 }, uSongRot: { value: 0 }\n};",
"""  uSongTex: { value: null }, uSongGlow: { value: null }, uSongAmt: { value: 0 }, uSongRot: { value: 0 },
  // procedural genes of the remembered skin, the being's offset in pattern space, its materials (weights), its felt beat
  uSongGene: { value: null }, uDnaOff: { value: new THREE.Vector3() },
  uMatA: { value: new THREE.Vector4(1, 0, 0, 0) }, uMatB: { value: new THREE.Vector2(0, 0) }, uBeatPulse: { value: 0 }
};""")
rep("  uniform sampler2D uSongTex; uniform sampler2D uSongGlow; uniform float uSongAmt; uniform float uSongRot;",
"""  uniform sampler2D uSongTex; uniform sampler2D uSongGlow; uniform float uSongAmt; uniform float uSongRot;
  uniform sampler2D uSongGene; uniform vec3 uDnaOff; uniform vec4 uMatA; uniform vec2 uMatB; uniform float uBeatPulse;""")

# ---- procedural fractal vocabulary -------------------------------------------------------------------------------------
rep("    return vec2( fract( uv.x ), clamp( uv.y, 0., 1. ) ); }",
"""    return vec2( fract( uv.x ), clamp( uv.y, 0., 1. ) ); }
  // procedural vocabulary for the remembered skin: every patch's genes (family, scale, warp, sharpness) pick and tune these
  float h13( vec3 p ) { p = fract( p * .1031 ); p += dot( p, p.zyx + 31.32 ); return fract( ( p.x + p.y ) * p.z ); }
  vec3 h33( vec3 p ) { p = fract( p * vec3( .1031, .1030, .0973 ) ); p += dot( p, p.yxz + 33.33 ); return fract( ( p.xxy + p.yxx ) * p.zyx ); }
  float vnz( vec3 p ) { vec3 i = floor( p ), f = fract( p ); f = f * f * ( 3. - 2. * f );
    return mix( mix( mix( h13( i ), h13( i + vec3( 1, 0, 0 ) ), f.x ), mix( h13( i + vec3( 0, 1, 0 ) ), h13( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
                mix( mix( h13( i + vec3( 0, 0, 1 ) ), h13( i + vec3( 1, 0, 1 ) ), f.x ), mix( h13( i + vec3( 0, 1, 1 ) ), h13( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z ); }
  float fbm3( vec3 p ) { float a = .5, s = 0.; for ( int i = 0; i < 4; i++ ) { s += a * vnz( p ); p = p * 2.03 + 1.7; a *= .5; } return s; }
  vec2 vor( vec3 p ) {   // Worley cells: distance to the nearest and second-nearest feature point
    vec3 i = floor( p ), f = fract( p ); float d1 = 8., d2 = 8.;
    for ( int z = -1; z <= 1; z++ ) for ( int y = -1; y <= 1; y++ ) for ( int x = -1; x <= 1; x++ ) {
      vec3 g = vec3( float( x ), float( y ), float( z ) ), rr = g + h33( i + g ) - f; float d = dot( rr, rr );
      if ( d < d1 ) { d2 = d1; d1 = d; } else if ( d < d2 ) d2 = d;
    }
    return vec2( sqrt( d1 ), sqrt( d2 ) );
  }
  float kali( vec3 p ) {   // Kali's fractal (p = |p| / p.p - c): crisp, self-similar filigree
    float acc = 0., prev = 0.;
    for ( int i = 0; i < 10; i++ ) { p = abs( p ) / dot( p, p ) - vec3( .58, .62, .48 ); float m = length( p ); acc += exp( - 2.5 * abs( m - prev ) ); prev = m; }
    return acc / 10.;
  }
  float ridge( vec3 p ) { float a = .5, s = 0.; for ( int i = 0; i < 4; i++ ) { float n = 1. - abs( vnz( p ) * 2. - 1. ); s += a * n * n; p = p * 2.1 + 3.1; a *= .5; } return s; }
  // x: pattern value (crisp, 0..1), y: its edges
  vec2 songPattern( vec3 q, vec4 g ) {
    vec3 x = q * mix( 3., 15., g.y ) + uDnaOff + vec3( 0., uTime * .02, 0. );
    x += g.z * 1.8 * ( vec3( vnz( x * .5 + 1.7 ), vnz( x * .5 + 4.1 ), vnz( x * .5 + 8.3 ) ) - .5 );   // domain warp
    float f = g.x * 3.;
    float w0 = max( 0., 1. - abs( f ) ), w1 = max( 0., 1. - abs( f - 1. ) ), w2 = max( 0., 1. - abs( f - 2. ) ), w3 = max( 0., 1. - abs( f - 3. ) );
    float v = 0., e = 0.;
    if ( w0 > .01 ) { float m = fbm3( x * .7 ), b = .5 + .5 * sin( m * 18. + x.y * .6 ); v += w0 * b; e += w0 * smoothstep( .85, 1., b ); }          // marble
    if ( w1 > .01 ) { vec2 c = vor( x ); float cell = c.y - c.x; v += w1 * smoothstep( 0., .35, cell ); e += w1 * ( 1. - smoothstep( 0., .05 + .1 * ( 1. - g.w ), cell ) ); }   // cells
    if ( w2 > .01 ) { float k = kali( x * .18 ); v += w2 * k; e += w2 * smoothstep( .5, .72, k ); }                                                 // filigree
    if ( w3 > .01 ) { float r = ridge( x * .6 ); v += w3 * r; e += w3 * smoothstep( .5, .78, r ); }                                                 // ridged veins
    v = clamp( ( v - .5 ) * mix( 1.2, 6., g.w ) + .5, 0., 1. );   // sharpness: soft gradients to crisp thresholds
    return vec2( v, clamp( e, 0., 1. ) );
  }""")

# ---- surface shading: the procedural skin with relief, then six materials --------------------------------------------------
rep("""      vec3 p = ro + rd * t, n = normalAt( p ), v = - rd, r = reflect( rd, n );
      float fres = pow( 1. - max( dot( n, v ), 0. ), 5. );
      vec4 nt = noteTint( p );
      vec3 f0 = mix( uMetal, uMetal * .35 + nt.rgb * .9, uNoteTint * nt.a * smoothstep( uCoreR * 1.3, uCoreR * 2.2, length( p ) ) );
      if ( uFilm > 0. ) f0 = mix( f0, film( dot( n, v ) * 1.6 + uTime * .05 ) * .9 + .1, uFilm );
      vec3 songC = vec3( 0. ); float songG = 0.;
      if ( uSongAmt > .01 ) { vec2 suv = songUV( normalize( p ) ); vec3 sg = textureLod( uSongGlow, suv, 0. ).rgb; songC = textureLod( uSongTex, suv, 0. ).rgb; songG = sg.r;
        songC *= 1. - .55 * smoothstep( .35, .8, sg.b );   // the boundaries between the song's sounds show as dark veins
        f0 = mix( f0, songC * 1.25, .85 * uSongAmt ); }
      float dist = length( p ), dif = max( dot( n, normalize( - p ) ), 0. );
      col = env( r, p ) * mix( f0, vec3( 1. ), fres ) + uLight * f0 * dif * uGlow * 1.4 / ( 1. + dist * dist * 6. );
      col += f0 * ( .5 + .5 * n.y ) * .07;                                               // soft sky fill so the form reads as volume""",
"""      vec3 p = ro + rd * t, n = normalAt( p ), v = - rd;
      vec3 sn = normalize( p ); vec2 suv = songUV( sn );
      vec3 songC0 = vec3( .5 ), sg = vec3( 0. ); vec4 gn = vec4( .5 ); vec2 pat = vec2( .5, 0. );
      if ( uSongAmt > .01 ) {
        songC0 = textureLod( uSongTex, suv, 0. ).rgb; sg = textureLod( uSongGlow, suv, 0. ).rgb; gn = textureLod( uSongGene, suv, 0. );
        pat = songPattern( sn, gn );
        // relief: the pattern's gradient bends the normal, so the remembered texture is carved, crisp, into the surface
        vec3 t1 = normalize( cross( sn, abs( sn.y ) < .99 ? vec3( 0., 1., 0. ) : vec3( 1., 0., 0. ) ) ), t2 = cross( sn, t1 );
        float pa = songPattern( normalize( sn + t1 * .004 ), gn ).x, pb = songPattern( normalize( sn + t2 * .004 ), gn ).x;
        n = normalize( n - ( t1 * ( pa - pat.x ) + t2 * ( pb - pat.x ) ) * ( .5 + gn.w ) * .55 * uSongAmt );
      }
      vec3 r = reflect( rd, n ); float ndv = max( dot( n, v ), 0. ), fres = pow( 1. - ndv, 5. );
      float dist = length( p ), dif = max( dot( n, normalize( - p ) ), 0. );
      float songG = sg.r;
      vec3 songC = songC0 * mix( .4, 1.4, pat.x ) * ( 1. - .55 * smoothstep( .35, .8, sg.b ) ) * mix( 1., .55, pat.y );   // pattern, its edges, the veins between sounds
      vec3 accent = mix( uLight, songC0 * 1.8 + .1, .55 );
      // metal: the original liquid metal, pigmented by the remembered song
      vec4 nt = noteTint( p );
      vec3 f0 = mix( uMetal, uMetal * .35 + nt.rgb * .9, uNoteTint * nt.a * smoothstep( uCoreR * 1.3, uCoreR * 2.2, dist ) );
      if ( uFilm > 0. ) f0 = mix( f0, film( ndv * 1.6 + uTime * .05 ) * .9 + .1, uFilm );
      f0 = mix( f0, songC * 1.25, .85 * uSongAmt );
      vec3 cMetal = env( r, p ) * mix( f0, vec3( 1. ), fres ) + uLight * f0 * dif * uGlow * 1.4 / ( 1. + dist * dist * 6. ) + f0 * ( .5 + .5 * n.y ) * .07;
      cMetal = mix( cMetal, cMetal * .55 + songC * ( .35 + .5 * dif + .25 * uGlow ), .7 * uSongAmt );
      // glass: a reflection, and the inner light seen through it, tinted and patterned by the song
      vec3 rr = refract( rd, n, .7 ); float off = length( cross( p, rr ) );
      float coreSeen = exp( - max( 0., off - uCoreR ) * 7. ) * step( 0., - dot( p, rr ) );
      vec3 tint = mix( vec3( 1. ), songC0 * 1.4 + .1, .65 ) * ( 1. - .5 * pat.x * uSongAmt );
      vec3 cGlass = env( r, p ) * ( .04 + .96 * fres ) + tint * ( uLight * coreSeen * ( .7 + uGlow * 1.6 ) + env( rr, p ) * .3 ) + accent * pat.y * .25;
      // velvet flesh: light wrapping round from inside, a sheen at grazing angles
      float wrap = max( 0., ( dif + .5 ) / 1.5 );
      vec3 alb = mix( vec3( .5, .32, .38 ), songC * 1.2, .8 * uSongAmt + .2 );
      vec3 cVelvet = alb * ( .14 + .95 * wrap * uLight * ( .45 + uGlow ) ) + pow( 1. - ndv, 2.5 ) * mix( alb, vec3( 1. ), .55 ) * .75;
      // obsidian: a black mirror where only the pattern's edges catch light
      vec3 cObs = env( r, p ) * mix( .03, 1., fres ) * vec3( .85, .9, 1. ) + accent * pat.y * .45;
      // iridescent film over the pattern
      vec3 cIri = env( r, p ) * ( film( ndv * 1.8 + pat.x * .8 + uTime * .04 ) * .9 + .1 ) + film( pat.x + ndv ) * dif * uGlow * .35;
      // bioluminescent: a dark body whose pattern lights up on its felt beat
      vec3 cBio = songC * .06 + accent * ( pat.y * 1.7 + pat.x * .22 ) * ( .45 + .7 * uGlow + .9 * uBeatPulse ) + env( r, p ) * fres * .3;
      float wsum = uMatA.x + uMatA.y + uMatA.z + uMatA.w + uMatB.x + uMatB.y + 1e-4;
      col = ( cMetal * uMatA.x + cGlass * uMatA.y + cVelvet * uMatA.z + cObs * uMatA.w + cIri * uMatB.x + cBio * uMatB.y ) / wsum;""")
rep("""      if ( uSongAmt > .01 ) {
        // the remembered song is pigment in the metal, lit from inside by the core and the room, not only a reflection
        col = mix( col, col * .55 + songC * ( .35 + .5 * dif + .25 * uGlow ), .7 * uSongAmt );
        col += mix( uLight, songC * 1.6 + .15, .6 ) * songG * ( .9 + 1.2 * uSongAmt ) * ( .5 + .5 * fres );   // where it recognises the sound, it glows
      }""",
"""      if ( uSongAmt > .01 ) col += mix( uLight, songC0 * 1.6 + .15, .6 ) * songG * ( .9 + 1.2 * uSongAmt ) * ( .5 + .5 * fres ) * ( .6 + .8 * pat.x );   // where it recognises the sound, it glows""")

# ---- JS: genes texture, DNA offset, material competition ---------------------------------------------------------------------
rep("import { createMap, dnaWeights, featureOf, blend, paint, unb64, MW, MH, NU, DIM } from './memory.mjs';",
    "import { createMap, dnaWeights, featureOf, blend, paint, unb64, geneDna, MW, MH, NU, DIM } from './memory.mjs';")
rep("const songTex = new THREE.DataTexture(new Uint8Array(NU * 4), MW, MH, THREE.RGBAFormat), songGlowTex = new THREE.DataTexture(new Uint8Array(NU * 4), MW, MH, THREE.RGBAFormat);\nfor (const t of [songTex, songGlowTex])",
    "const songTex = new THREE.DataTexture(new Uint8Array(NU * 4), MW, MH, THREE.RGBAFormat), songGlowTex = new THREE.DataTexture(new Uint8Array(NU * 4), MW, MH, THREE.RGBAFormat), songGeneTex = new THREE.DataTexture(new Uint8Array(NU * 4), MW, MH, THREE.RGBAFormat);\nfor (const t of [songTex, songGlowTex, songGeneTex])")
rep("    if (t - MEM.paintAt > .1) { MEM.paintAt = t; const { color, glow } = paint(MEM.song, mind.traits.hue, songTex.image.data, songGlowTex.image.data); songTex.needsUpdate = true; songGlowTex.needsUpdate = true; }\n    U.uSongTex.value = songTex; U.uSongGlow.value = songGlowTex;",
    "    if (t - MEM.paintAt > .1) { MEM.paintAt = t; paint(MEM.song, mind.traits.hue, songTex.image.data, songGlowTex.image.data, songGeneTex.image.data, MEM.geneDna || (MEM.geneDna = geneDna(SEED))); songTex.needsUpdate = true; songGlowTex.needsUpdate = true; songGeneTex.needsUpdate = true; }\n    U.uSongTex.value = songTex; U.uSongGlow.value = songGlowTex; U.uSongGene.value = songGeneTex;")
rep("{ color } = paint(MEM.song, mind.traits.hue);", "{ color } = paint(MEM.song, mind.traits.hue, undefined, undefined, undefined, MEM.geneDna || geneDna(SEED));")
rep("function beingBody(dt, t) {\n  if (!GENOME.sh.length) growGenome(SEED);",
"""/* ---------- its materials: six ways of being matter, in competition; it changes at meaningful moments ----------
   Each material's pull comes from how it feels and what it hears, plus its own DNA and what it learned it loved this song in.
   Pulls compete through mutual inhibition (no chooser: the strongest wins); the visible material only switches at a section,
   a drop, chills, a new form or boredom, then cross-fades. */
const MATS = ['liquid metal', 'glass', 'velvet flesh', 'obsidian', 'iridescent', 'bioluminescent'];
const MAT = { x: Float32Array.from([1, 0, 0, 0, 0, 0]), cur: 0, prev: 0, fade: 1, lastSwitch: -1e9, section: -1, dna: null, gate: '' };
function materialGate(why) { MAT.gate = why; }
function materials(dt, t, m) {
  if (!MAT.dna) { let a = (SEED * 2654435761) >>> 0; MAT.dna = MATS.map(() => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return (a / 4294967296 - .5) * .3; }); }
  const ch = an.state.character || {}, fam = MEM.song ? MEM.song.familiarity : .5, fav = MEM.meta && Number.isInteger(MEM.meta.material) ? MEM.meta.material : -1;
  const aff = [.45 + .25 * m.groove,
    .5 * (1 - m.arousal) + .35 * Math.max(0, m.valence) + .3 * (ch.tonality || 0),
    .4 * Math.max(0, m.valence) + .35 * (1 - (ch.brightness || .5)) + .2 * (1 - m.arousal),
    .55 * Math.max(0, -m.valence) + .35 * (ch.roughness || 0) + .25 * (ch.bassWeight || 0),
    .55 * B.chill + .35 * (1 - fam) + .3 * (ch.brightness || 0),
    .45 * m.arousal + .35 * m.groove + .45 * m.daAnticipation];
  let sum = 0; for (let i = 0; i < 6; i++) sum += MAT.x[i];
  for (let i = 0; i < 6; i++) {
    const a = aff[i] + MAT.dna[i] + (i === fav ? .3 : 0);
    MAT.x[i] = Math.max(0, MAT.x[i] + dt / 2.5 * (a - MAT.x[i] - .6 * (sum - MAT.x[i]) + .08 * (Math.random() - .5)));
  }
  // moments where it may change what it is made of
  const sec = an.state.structure.section | 0;
  if (sec !== MAT.section) { if (MAT.section >= 0) materialGate('a new section'); MAT.section = sec; }
  if (S.drop > .9) materialGate('the drop');
  if (MAT.gate && t - MAT.lastSwitch > (MAT.gate === 'the drop' ? 5 : 10)) {
    let best = 0; for (let i = 1; i < 6; i++) if (MAT.x[i] > MAT.x[best]) best = i;
    if (best !== MAT.cur) { MAT.prev = MAT.cur; MAT.cur = best; MAT.fade = 0; MAT.lastSwitch = t; blog.unshift(`${MAT.gate}: becomes ${MATS[best]}`); }
    MAT.gate = '';
  } else if (MAT.gate && t - MAT.lastSwitch <= 5) MAT.gate = '';
  MAT.fade = Math.min(1, MAT.fade + dt / 2.5);
  const w = [0, 0, 0, 0, 0, 0]; w[MAT.cur] += MAT.fade; w[MAT.prev] += 1 - MAT.fade;
  U.uMatA.value.set(w[0], w[1], w[2], w[3]); U.uMatB.value.set(w[4], w[5]);
  // the song remembers the material it was loved in: dopamine and pleasure accumulate for the current material
  if (MEM.meta) { const sc = MEM.meta.matScore || (MEM.meta.matScore = [0, 0, 0, 0, 0, 0]); sc[MAT.cur] += (Math.max(0, m.daPhasic) + .3 * Math.max(0, m.valence)) * dt; let b = 0; for (let i = 1; i < 6; i++) if (sc[i] > sc[b]) b = i; MEM.meta.material = b; }
  U.uBeatPulse.value = Math.pow(Math.max(0, 1 - m.pulsePhase), 3) * m.lock;
}
function beingBody(dt, t) {
  if (!GENOME.sh.length) growGenome(SEED);
  materials(dt, t, mind);
  if (!U.uDnaOff.value.lengthSq()) { let a = SEED >>> 0; const r = () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; }; U.uDnaOff.value.set(r() * 60, r() * 60, r() * 60); }""")
# events that open the material gate; a recognised song starts in the material it was loved in
rep("    } else if (e.type === 'reform') { reseed(true);", "    } else if (e.type === 'reform') { materialGate('a new form'); reseed(true);")
rep("    else if (e.type === 'chill') { B.chill = 1; blog.unshift('chills'); }", "    else if (e.type === 'chill') { B.chill = 1; blog.unshift('chills'); materialGate('chills'); }")
rep("    mind.recall(stored.meta.feeling || 0, MEM.meta.plays); MEM.recog = 1; B.chill = Math.max(B.chill, .5);",
    "    mind.recall(stored.meta.feeling || 0, MEM.meta.plays); MEM.recog = 1; B.chill = Math.max(B.chill, .5);\n    if (Number.isInteger(stored.meta.material) && stored.meta.material !== MAT.cur) { MAT.prev = MAT.cur; MAT.cur = stored.meta.material; MAT.fade = 0; MAT.lastSwitch = beingClock.t; MAT.x[MAT.cur] += .5; }")
# the inner-life panel names its material
rep("  bFeel.textContent = m.feeling();", "  bFeel.textContent = m.feeling() + ' · ' + MATS[MAT.cur];")
io.open(p, 'w', encoding='utf8').write(s)
print('patched', len(s))
