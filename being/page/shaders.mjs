// being/page/shaders.mjs - the page's GLSL: the body, its aura, the final composite and the unrolled memory picture
import { SKIN_GLSL } from '../skin/lenia.mjs';
import { CA_GLSL } from '../cellab/gpu.mjs';

/* the remembered skin's procedural vocabulary, shared by the body shader and the memory pictures */
export const SONG_GLSL = /* glsl */`
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
  }
`;
/* the body: a liquid-metal mass with lobes and falling drops, ray-marched around an analytic core of light (EXT: the local folder's pieces) */
export const bodyFragment = ({ EXT, NOTES, ND, NT, TP, NS }) => `
  uniform vec2 uRes; uniform float uTime; uniform vec2 uLook; uniform float uScale; uniform vec2 uShift; uniform float uWide;
  uniform vec4 uL[ ${NOTES} ]; uniform vec4 uD[ ${ND} ]; uniform vec3 uNoteC[ ${NOTES} ];
  uniform vec4 uT[ ${NT * TP} ]; uniform vec4 uTB[ ${NT} ]; uniform float uRimK; uniform float uHaloK; uniform float uThinK; uniform vec4 uS[ ${NS} ];
  uniform float uGrain; uniform float uFrac; uniform float uIntr; uniform float uDisp; uniform float uSeed; uniform float uSplit; uniform float uRays; uniform float uCool; uniform float uCrisp; uniform float uSpikeP; uniform float uFlowS;
  uniform float uNoteTint; uniform vec3 uLight; uniform float uCoreR; uniform float uCoreI; uniform float uGlow; uniform float uK;
  uniform float uRise; uniform float uMaskR; uniform float uImm; uniform vec4 uRiseSeed; uniform float uRW[ 8 ]; uniform float uEther;
  uniform float uJour; uniform float uPeak; uniform float uPhen[ 8 ]; uniform float uCyA; uniform float uCyN; uniform float uCyPh; uniform vec3 uCyAx; uniform float uPhenT; uniform float uPhenK; uniform float uPhenS; uniform float uMarb; uniform float uIllum; uniform float uAbsorption; uniform float uJFlow; uniform float uJBars; uniform float uJPal;
  uniform float uShellR; uniform float uThick; uniform float uOpen; uniform float uHalo; uniform float uChaos; uniform float uVar; uniform sampler2D uSkin; uniform float uSkinA; uniform float uZoom; uniform float uEnv; uniform float uTurbSpeed; uniform float uTurbDetail; uniform float uWob;
  uniform float uSpikes; uniform float uSpikeF; uniform float uFilm; uniform vec3 uMetal;
  uniform float uRing; uniform float uRingA; uniform float uRing2; uniform float uRing2A;
  uniform float uSparks; uniform float uMote; uniform float uAwake; uniform float uHat; uniform float uKick;
  uniform float uSH[ 21 ]; uniform vec4 uJc; uniform float uJw; uniform float uNuc; uniform float uNucRot; uniform vec3 uTissueC;
  uniform sampler2D uSongTex; uniform sampler2D uSongGlow; uniform float uSongAmt; uniform float uSongRot;
  uniform float uProp; uniform float uAro; uniform float uEcho; uniform vec4 uPWa; uniform vec4 uPWb; uniform vec4 uPWc; uniform vec4 uCast;${EXT.shader.decl}
  uniform sampler2D uSongGene; uniform vec3 uDnaOff; uniform float uMid[ 4 ]; uniform float uMw[ 4 ]; uniform float uMatMix; uniform float uMatScale; uniform vec4 uWR[ 2 ]; uniform float uWRA; uniform vec4 uSer[ 48 ]; uniform float uSerA[ 3 ]; uniform vec4 uSerB[ 3 ]; uniform vec4 uGl[ 6 ]; uniform float uGlR[ 6 ]; uniform float uGlisten; uniform float uBeatPulse; uniform float uRegP[ 8 ]; uniform float uRegA; uniform sampler2D uTissue; uniform float uTissueA; uniform samplerCube uMorph; uniform float uMorphA; uniform float uMorphD; uniform float uHide; uniform vec3 uStainM, uStainN, uStainC, uStainO; uniform float uStainA;
  uniform sampler2D uCa; uniform float uCaA; uniform float uCaD; uniform float uCaN; uniform vec3 uCaHueC; uniform float uCaHue; uniform sampler2D uCv; uniform float uCvA;   // the CelLab automata (being/cellab): on the surface, and inside (a half-resolution pass)
  vec2 songUV( vec3 d ) { vec2 uv = vec2( atan( d.z, d.x ) * .15915494 + .5 + uSongRot, asin( clamp( d.y, -1., 1. ) ) * .31830989 + .5 );
    uv += .006 * vec2( sin( uv.y * 31. + uTime * .9 ), sin( uv.x * 27. - uTime * .7 ) );   // the remembered skin boils a little
    return vec2( fract( uv.x ), clamp( uv.y, 0., 1. ) ); }
${SONG_GLSL}
  // real spherical harmonics l = 2..4 (Cartesian form, roughly unit peak): the vibration modes of a drop (cymatics on a body)
  float shDisp( vec3 n ) {
    float x = n.x, y = n.y, z = n.z, x2 = x * x, y2 = y * y, z2 = z * z;
    float s = 0.;
    s += uSH[ 0 ] * 2. * x * y + uSH[ 1 ] * 2. * y * z + uSH[ 2 ] * .5 * ( 3. * z2 - 1. ) + uSH[ 3 ] * 2. * x * z + uSH[ 4 ] * ( x2 - y2 );
    s += uSH[ 5 ] * y * ( 3. * x2 - y2 ) + uSH[ 6 ] * 5. * x * y * z + uSH[ 7 ] * y * ( 5. * z2 - 1. ) * .6 + uSH[ 8 ] * .5 * z * ( 5. * z2 - 3. )
       + uSH[ 9 ] * x * ( 5. * z2 - 1. ) * .6 + uSH[ 10 ] * 2.5 * z * ( x2 - y2 ) + uSH[ 11 ] * x * ( x2 - 3. * y2 );
    s += uSH[ 12 ] * 4. * x * y * ( x2 - y2 ) + uSH[ 13 ] * 2. * y * z * ( 3. * x2 - y2 ) + uSH[ 14 ] * x * y * ( 7. * z2 - 1. ) * 1.2 + uSH[ 15 ] * y * z * ( 7. * z2 - 3. ) * .8
       + uSH[ 16 ] * .125 * ( 35. * z2 * z2 - 30. * z2 + 3. ) + uSH[ 17 ] * x * z * ( 7. * z2 - 3. ) * .8 + uSH[ 18 ] * ( x2 - y2 ) * ( 7. * z2 - 1. ) * .6
       + uSH[ 19 ] * 2. * x * z * ( x2 - 3. * y2 ) + uSH[ 20 ] * ( x2 * ( x2 - 3. * y2 ) - y2 * ( 3. * x2 - y2 ) );
    return s;
  }
  // the nucleus: a quaternion Julia set (q <- q^2 + c), its 4D constant c set by the being's state; distance estimate
  // d = 0.5 |q| log|q| / |dq| (Hart 1989; iq "3D Julia sets")
  float julia( vec3 p, out float trap ) {
    vec4 q = vec4( p, uJw ); float dr = 1.; trap = 1e9;
    for ( int i = 0; i < 9; i++ ) {
      dr = 2. * length( q ) * dr;
      q = vec4( q.x * q.x - dot( q.yzw, q.yzw ), 2. * q.x * q.yzw ) + uJc;
      trap = min( trap, dot( q, q ) );
      if ( dot( q, q ) > 16. ) break;
    }
    float r = length( q );
    return .5 * r * log( r ) / max( dr, 1e-6 );
  }
  mat2 rot( float a ) { float c = cos( a ), s = sin( a ); return mat2( c, - s, s, c ); }
  float smin( float a, float b, float k ) { float h = max( k - abs( a - b ), 0. ) / k; return min( a, b ) - h * h * k * .25; }
  float hash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
  // thickness of the metal shell in each direction: slow low-frequency noise, so thin spots drift around; lead opens them, bass closes them
  float shellTh( vec3 p ) {
    vec3 n = normalize( p + 1e-5 );
    float a = sin( n.x * 2.3 + uTime * .17 ) * sin( n.y * 2.1 - uTime * .13 + 1.7 );
    float b = sin( n.z * 2.6 + uTime * .11 + 3. ) * sin( n.x * 1.7 - uTime * .15 + .6 );
    return uThick + uVar * ( a + b );
  }
${SKIN_GLSL}
${CA_GLSL}
  float hash3( vec3 g ) { return fract( sin( dot( g, vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 ); }
  // ---- the proposed materials (lab, uProp): how they move the body's mass, always radial from the nucleus ----
  float pNoise( vec3 x ) { vec3 i = floor( x ), f = fract( x ); f = f * f * ( 3. - 2. * f );
    return mix( mix( mix( hash3( i ), hash3( i + vec3( 1., 0., 0. ) ), f.x ), mix( hash3( i + vec3( 0., 1., 0. ) ), hash3( i + vec3( 1., 1., 0. ) ), f.x ), f.y ),
                mix( mix( hash3( i + vec3( 0., 0., 1. ) ), hash3( i + vec3( 1., 0., 1. ) ), f.x ), mix( hash3( i + vec3( 0., 1., 1. ) ), hash3( i + vec3( 1., 1., 1. ) ), f.x ), f.y ), f.z ); }
  float pFbm( vec3 x ) { return .5 * pNoise( x ) + .3 * pNoise( x * 2.03 + 11.7 ) + .2 * pNoise( x * 4.1 + 23.1 ); }
  float propShape( vec3 p ) {   // in body units (the shell's radius is 1), times the shell radius at the end
    float R = uShellR, r = length( p ), s = 0.; vec3 dir = p / max( r, 1e-4 ), q = p / R;
    if ( uPWa.x > .01 ) { float n = pFbm( dir * 1.5 - dir * uTime * ( .6 + .8 * uAro ) ); s += uPWa.x * ( n - .45 ) * ( .05 + .12 * uAro + .06 * uBeatPulse ); }   // fire: the surface only heaves gently; the flame itself is light (fireVolume)
    if ( uPWa.y > .01 ) s += uPWa.y * .07 * uAro * uAro * ( pFbm( q * 3.2 + uTime * vec3( .9, -.7, .5 ) ) - .5 );   // water: glassy when calm, choppy when intense
    if ( uPWa.z > .01 ) s += uPWa.z * ( .22 * ( pFbm( dir * 1.7 + 4. ) - .5 ) + .07 * ( pFbm( dir * 4.5 + 1. ) - .5 ) );   // earth: relief cutting the shells round the nucleus (the rings themselves are shaded, not carved: carved grooves let rays skip the thin shell)
    if ( uPWa.w > .01 ) s += uPWa.w * ( .14 + .05 * sin( uTime * .7 ) + .08 * ( pFbm( dir * 2. + uTime * vec3( .3, .2, -.25 ) ) - .5 ) );   // air: the body breathes out, expansive
    if ( uPWa.z > .01 ) s += uPWa.z * ( ( .003 + .007 * uAro ) * sin( dot( dir, vec3( 5., 3., 4. ) ) * 3. - uTime * 31. ) + .028 * uEcho * sin( dot( dir, vec3( 4., 6., 5. ) ) + uTime * 12. ) );   // earth: a fine tremble, and its hits ringing back as echoes
    if ( uPWb.z > .01 ) { float rg = 1. - abs( 2. * pFbm( q * 2.4 + 3. ) - 1. ); s += uPWb.z * ( .03 + .05 * uAro + .16 * uKick ) * pow( rg, 4. ); }   // mars: ridges, folded hard at hits
    return s * R;
  }
  float seg( vec3 p, vec4 a, vec4 b ) { vec3 pa = p - a.xyz, ba = b.xyz - a.xyz; float h = clamp( dot( pa, ba ) / dot( ba, ba ), 0., 1. ); return length( pa - ba * h ) - mix( a.w, b.w, h ); }
  // watery rings, flattened like Saturn's, flowing in streams with gaps; two of them, slowly precessing, that cross and merge
  float wRings( vec3 p ) {
    float d = 1e9;
    for ( int i = 0; i < 2; i++ ) {
      vec3 ax = uWR[ i ].xyz; float h = dot( p, ax ); vec3 pl = p - ax * h;
      vec3 e1 = normalize( cross( ax, vec3( .31, .17, .93 ) ) ), e2 = cross( ax, e1 );
      float ang = atan( dot( pl, e2 ), dot( pl, e1 ) ), fi = float( i );
      float th = .042 * uWRA * ( .55 + .45 * ( .5 + .5 * sin( ang * 3. - uTime * 1.1 + fi * 2.1 ) ) * ( .7 + .3 * sin( ang * 7. + uTime * .8 - fi ) ) ) - .004;
      d = min( d, length( vec2( length( pl ) - uWR[ i ].w, h * 2. ) ) / 2. - th );
    }
    return d;
  }
  // the serpents as attractors: chains on their orbits (being/flourish.mjs), pulled onto the body so its own mass rises after them (pullPoints)
  float serpA() { return max( uSerA[ 0 ], max( uSerA[ 1 ], uSerA[ 2 ] ) ); }
  float serpentD( vec3 p ) {
    float d = 1e9;
    for ( int s = 0; s < 3; s++ ) if ( uSerA[ s ] > .01 && length( p - uSerB[ s ].xyz ) - uSerB[ s ].w < .2 )
      for ( int i = 0; i < 15; i++ ) d = min( d, seg( p, uSer[ s * 16 + i ], uSer[ s * 16 + i + 1 ] ) );   // one tapering body: capsules sharing ends and radii meet seamlessly with min (a smooth union would swell every joint into a bead)
    return d;
  }
  // ---- rising (lab/prototypes/fractal-body.html, RISE): at moments the body leaves its sphere and becomes a fractal, pure geometry or light ----
  // uRise 0 the body as it is .. 1 fully risen into a mix of the eight forms, weighted by uRW (RISE in the page); uEther: the surface gives way to light. Built at the prototype's scale (shell .62), scaled by uShellR.
  float rTrap;   // orbit trap of the last form evaluated, for its light
  const float RPHI = 1.618034, RR = .62;
  float rBulb( vec3 p ) {   // the Mandelbulb, its power breathing
    vec3 z = p; float dr = 1., r = 0., n = mix( 5., 9.5, uRiseSeed.x ) - 2. * ( .5 + .5 * sin( uTime * .23 ) ) * ( 1. - uRise ); rTrap = 1e9;   // each song its own power
    for ( int i = 0; i < 7; i++ ) {
      r = length( z ); if ( r > 2. ) break;
      float th = acos( clamp( z.y / r, -1., 1. ) ) + uTime * .05 + uRiseSeed.y * 3., ph = atan( z.z, z.x ) + uRiseSeed.z * 6.;
      dr = pow( r, n - 1. ) * n * dr + 1.;
      z = pow( r, n ) * vec3( sin( th * n ) * cos( ph * n ), cos( th * n ), sin( th * n ) * sin( ph * n ) ) + p;
      rTrap = min( rTrap, dot( z, z ) );
    }
    rTrap = clamp( sqrt( rTrap ) * .6, 0., 1. );
    return .5 * log( max( r, 1e-4 ) ) * r / dr;
  }
  vec3 rNearV( vec3 p ) {   // the nearest of the icosahedron's 12 vertices
    vec3 V[ 6 ] = vec3[ 6 ]( vec3( 0., .52573, .85065 ), vec3( 0., -.52573, .85065 ), vec3( .52573, .85065, 0. ), vec3( -.52573, .85065, 0. ), vec3( .85065, 0., .52573 ), vec3( .85065, 0., -.52573 ) );
    vec3 b = V[ 0 ]; float m = -1.;
    for ( int i = 0; i < 6; i++ ) { float d = dot( p, V[ i ] ); if ( abs( d ) > m ) { m = abs( d ); b = V[ i ] * sign( d ); } }
    return b;
  }
  float rCrystal( vec3 p ) {   // the Sierpinski icosahedron (scale phi^2)
    float s = 1.; rTrap = 1e9;
    float S = mix( 2.35, 2.95, uRiseSeed.z );   // each song its own scale and twist
    for ( int i = 0; i < 3; i++ ) { p = p * S - rNearV( p ) * ( S - 1. ); p.xy *= rot( ( .2 * sin( uTime * .21 + float( i ) ) + ( uRiseSeed.y - .5 ) * 1.2 ) * uRise ); p.yz *= rot( ( uRiseSeed.w - .5 ) * .8 * uRise ); s *= S; rTrap = min( rTrap, length( p ) ); }
    rTrap = clamp( rTrap * .5, 0., 1. );
    return ( ( abs( p.x ) + abs( p.y ) + abs( p.z ) ) * .57735 - .5 - .08 * sin( uTime * .4 ) ) / s;
  }
  float rApollo( vec3 p ) {   // Apollonian sphere inversion: spheres inside spheres
    float sc = 1., k0 = mix( 1.02, 1.32, uRiseSeed.z ) + .1 * sin( uTime * .2 ); rTrap = 1e9;
    for ( int i = 0; i < 6; i++ ) { p = -1. + 2. * fract( .5 * p + .5 ); float r2 = dot( p, p ); rTrap = min( rTrap, r2 ); float k = k0 / r2; p *= k; sc *= k; }
    rTrap = clamp( rTrap, 0., 1. );
    return .25 * abs( p.y ) / sc;
  }
  float rSponge( vec3 p, float d ) {   // Menger carving
    float s = 1.;
    for ( int i = 0; i < 4; i++ ) { vec3 a = mod( p * s, 2. ) - 1.; s *= 3.; vec3 r = abs( 1. - 3. * abs( a ) );
      d = max( d, ( min( max( r.x, r.y ), min( max( r.y, r.z ), max( r.z, r.x ) ) ) - 1. ) / s ); }
    return d;
  }
  const vec3 RG[ 16 ] = vec3[ 16 ](   // GDF face normals: icosahedron 0..9, dodecahedron 10..15
    vec3( .577350, .577350, .577350 ), vec3( -.577350, .577350, .577350 ), vec3( .577350, -.577350, .577350 ), vec3( .577350, .577350, -.577350 ),
    vec3( 0., .356822, .934172 ), vec3( 0., -.356822, .934172 ), vec3( .934172, 0., .356822 ), vec3( -.934172, 0., .356822 ), vec3( .356822, .934172, 0. ), vec3( -.356822, .934172, 0. ),
    vec3( 0., .850651, .525731 ), vec3( 0., -.850651, .525731 ), vec3( .525731, 0., .850651 ), vec3( -.525731, 0., .850651 ), vec3( .850651, .525731, 0. ), vec3( -.850651, .525731, 0. ) );
  float rWire( vec3 p, float r, int a, int b, float w ) {   // the edges of a convex polyhedron: where its two nearest face planes meet
    float d1 = -1e9, d2 = -1e9;
    for ( int i = 0; i < 16; i++ ) { if ( i < a || i >= b ) continue; float v = abs( dot( p, RG[ i ] ) ); if ( v > d1 ) { d2 = d1; d1 = v; } else if ( v > d2 ) d2 = v; }
    float sd = d1 - r;
    return max( length( vec2( max( sd, - .2 ), d2 - r ) ), abs( sd ) ) - w;
  }
  float rGeo( vec3 p ) {   // nested icosahedron and dodecahedron wireframes, each 1/phi the last, counter-rotating
    float d = 1e9, r = RR * mix( .95, 1.15, uRise ); rTrap = 0.;
    for ( int k = 0; k < 6; k++ ) {
      float fk = float( k ), sg = mod( fk, 2. ) * 2. - 1.;
      vec3 q = p; q.xz *= rot( sg * uTime * ( .11 + .04 * fk ) + uRiseSeed.y * 6. ); q.xy *= rot( sg * uTime * .07 + fk + uRiseSeed.w * 6. );
      float e = ( k % 2 == 0 ) ? rWire( q, r, 0, 10, .006 + .004 * r ) : rWire( q, r * .87, 10, 16, .006 + .004 * r );
      if ( e < d ) { d = e; rTrap = fk / 6.; }
      r /= RPHI;
    }
    return min( d, length( p ) - .035 );
  }
  float rCoral( vec3 p ) {   // from the nucleus toward the twelve vertices; each tip branches again
    float d = 1e9, sc = 1., L = mix( .3, .55, uRise ) * mix( .8, 1.2, uRiseSeed.x ), B = mix( 2.4, 3.3, uRiseSeed.w ); rTrap = 0.;
    for ( int i = 0; i < 4; i++ ) {
      vec3 v = rNearV( p );
      float h = clamp( dot( p, v ), 0., L ), e = ( length( p - v * h ) - .055 * ( 1. - .5 * h / L ) ) / sc;
      if ( e < d ) { d = e; rTrap = float( i ) / 4.; }
      p -= v * L; p.xy *= rot( .25 * sin( uTime * .13 + float( i ) ) + ( uRiseSeed.y - .5 ) * 1.4 ); p *= B; sc *= B;
    }
    return d;
  }
  const vec3 RN1 = vec3( -.80901699, .30901699, .5 ), RN2 = vec3( .30901699, -.5, .80901699 );
  vec3 rIcoFold( vec3 p ) {
    for ( int k = 0; k < 3; k++ ) { p = abs( p ); p -= 2. * min( 0., dot( p, RN1 ) ) * RN1; p -= 2. * max( 0., dot( p, RN2 ) ) * RN2; }
    return p;
  }
  float rLattice( vec3 p ) {   // great circles of the icosahedral mirrors on nested spheres; the panes thin away as it rises
    float d = 1e9, r = RR * mix( 1., 1.12, uRise ); rTrap = 0.;
    for ( int k = 0; k < 4; k++ ) {
      float fk = float( k ), sg = mod( fk, 2. ) * 2. - 1.;
      vec3 q = p; q.xz *= rot( sg * uTime * ( .07 + .03 * fk ) + fk + uRiseSeed.y * 6. ); q.xy *= rot( sg * uTime * .05 + 2. * fk + uRiseSeed.z * 6. );
      vec3 f = rIcoFold( q ), g = rIcoFold( vec3( q.xy * rot( .628318 ), q.z ) );
      float lines = min( min( f.x, min( f.y, f.z ) ), min( abs( dot( f, RN1 ) ), abs( dot( f, RN2 ) ) ) );
      float lines2 = min( min( g.x, min( g.y, g.z ) ), min( abs( dot( g, RN1 ) ), abs( dot( g, RN2 ) ) ) );
      float shellD = abs( length( p ) - r ), w = .0035 + .002 * r;
      float web = length( vec2( shellD, max( min( lines, lines2 * 1.6 ), 0. ) ) ) - w;
      float e = k == 0 ? min( web, shellD - .006 + .01 * uRise ) : web;   // the outer pane thins away as it rises
      if ( e < d ) { d = e; rTrap = fk / 4. + ( lines < lines2 ? 0. : .12 ); }
      r /= RPHI;
    }
    return min( d, length( p ) - .03 );
  }
  // one form, fully grown at rise k; p in prototype units
  float riseForm( int v, vec3 p, float k ) {
    float r = length( p );
    if ( v == 0 ) { float s = RR / 1.1 * mix( .9, 1.15, k ); return rBulb( p / s ) * s; }
    if ( v == 1 ) { float s = RR * mix( .5, 1.1, k ); return rCrystal( p / s ) * s; }
    if ( v == 2 ) { float s = mix( .12, .2, uRiseSeed.x ); return max( max( rApollo( p / s + uRiseSeed.yzw * 2. ) * s, r - RR * mix( 1., 1.25, k ) ), -( r - RR * .25 ) ); }
    if ( v == 3 ) { vec3 q = p; q.xz *= rot( uTime * .05 + uRiseSeed.y * 3. ); q.yz *= rot( uRiseSeed.w * 2. ); float z = mix( 1.4, 1.1, k ) * mix( .8, 1.3, uRiseSeed.x ); return max( rSponge( q * z, ( r - RR * mix( 1., 1.3, k ) ) * z ) / z, -( r - RR * .5 * k ) ); }
    if ( v == 4 ) { float s = RR / 1.05 * mix( .3, 1.1, k ) * mix( .85, 1.2, uRiseSeed.x ), tr; vec3 jq = p; jq.xy *= rot( uRiseSeed.y * 6.28 ); jq.yz *= rot( uRiseSeed.z * 6.28 ); float j = julia( jq / s, tr ) * s; rTrap = clamp( sqrt( tr ), 0., 1. ); return j; }
    if ( v == 5 ) return rGeo( p );
    if ( v == 6 ) { float s = RR * 1.25; return rCoral( p / s ) * s; }
    return rLattice( p );
  }
  // the body (d, in its own units) given way to the mix: the masses (bloom, crystal, foam, sponge, julia, coral) morph into one
  // another by weight; the line forms (geometry, lattice) layer over them, receding as their weight falls
  float riseBody( vec3 p, float d ) {
    float sc = uShellR / RR; p /= sc; float d0 = d / sc, k = smoothstep( 0., 1., uRise );
    float mass = 1e9, l = 1e9, bw = 0., tr = 0.;
    for ( int v = 0; v < 8; v++ ) {
      float w = uRW[ v ]; if ( w < .02 ) continue;
      float gs = 1. + .5 * k, f = riseForm( v, p / gs, k ) * gs;   // the forms reach past the surface: they are what grows out of it
      // each form grows as far as its weight: the leading one fully, the others as smaller sprouts (a union keeps each one's
      // structure; averaging their distances would smooth them all away); thin lines only recede when nearly gone
      if ( v == 5 || v == 7 ) l = smin( l, f + max( 0., .45 - w ) * .025, .02 );
      else mass = smin( mass, f + ( 1. - min( w * 1.6, 1. ) ) * .05, .02 );
      if ( w > bw ) { bw = w; tr = rTrap; }
    }
    rTrap = tr;
    float F = smin( mass, l, .03 );
    // grown out of the body, never replacing it: the form is eroded to nothing at first and comes out of the surface as it rises,
    // only within a margin round the body that widens with it; it is the body's own material wherever it shows
    float Fg = max( F + ( 1. - k ) * .035, d0 - .9 * k );
    float dm = mix( d0, F, .7 * k );   // the body's own outline leans toward the form, never all the way: still the body, shaped by it
    return smin( dm, Fg, .025 + .03 * k ) * sc;
  }
  // ---- the journey (JOURNEY in the page; lab/prototypes/illuminated.html, absorption.html; lab/research/absorption.md) ----
  // uMarb: marbled ink over the body (Lu, Jaffer et al. 2012, "Mathematical Marbling": each stroke has a closed-form inverse, so a
  // point's colour is found by undoing the strokes newest-first); uIllum: a gilded plait raised on it; uAbsorption: the brain's own
  // geometry (Klüver's form constants, drawn as Bressloff et al. 2001 explain them) round it; uJour: how far the journey has gone.
  const float JTAU = 6.2831853;
  float jh1( float n ) { return fract( sin( n * 127.1 + 1.3 ) * 43758.5453 ); }
  vec3 jh3( float n ) { return vec3( jh1( n ), jh1( n + 17.7 ), jh1( n + 41.3 ) ); }
  vec3 jRotAx( vec3 p, vec3 k, float a ) { return p * cos( a ) + cross( k, p ) * sin( a ) + k * dot( k, p ) * ( 1. - cos( a ) ); }
  vec3 jHue( vec3 c, float a ) { vec3 k = vec3( .57735 ); return max( c * cos( a ) + cross( k, c ) * sin( a ) + k * dot( k, c ) * ( 1. - cos( a ) ), 0. ); }
  vec3 jInk( float x ) {   // 0: ON's own colours (its light and metal, turned a little either way); 1-4: the reference's pigments
    int i = int( floor( fract( x ) * 4. ) ), pal = int( uJPal + .5 );
    if ( pal == 0 ) { vec3 L = uLight / max( max( uLight.r, max( uLight.g, uLight.b ) ), .05 ) * .8, M = uMetal / max( max( uMetal.r, max( uMetal.g, uMetal.b ) ), .05 ) * .85;
      vec3 c[ 4 ] = vec3[ 4 ]( jHue( L, 1.3 ) * .5, M * .55, jHue( L, -1.4 ) * .6, jHue( M, 2.2 ) * .45 ); return c[ i ]; }   // deep inks turned round the wheel from its light: lacquer on a bright body, never a wash of its own colour
    pal -= 1;
    if ( pal == 0 ) { vec3 c[ 4 ] = vec3[ 4 ]( vec3( .70, .30, .20 ), vec3( .91, .80, .64 ), vec3( .62, .27, .18 ), vec3( .85, .70, .55 ) ); return c[ i ]; }
    if ( pal == 1 ) { vec3 c[ 4 ] = vec3[ 4 ]( vec3( .40, .47, .60 ), vec3( .55, .42, .34 ), vec3( .30, .36, .50 ), vec3( .68, .58, .50 ) ); return c[ i ]; }
    if ( pal == 2 ) { vec3 c[ 4 ] = vec3[ 4 ]( vec3( .62, .64, .55 ), vec3( .45, .48, .42 ), vec3( .74, .72, .64 ), vec3( .40, .38, .36 ) ); return c[ i ]; }
    vec3 c[ 4 ] = vec3[ 4 ]( vec3( .16, .30, .62 ), vec3( .85, .64, .28 ), vec3( .10, .18, .40 ), vec3( .92, .84, .66 ) ); return c[ i ];
  }
  vec3 jUnrake( vec3 p, float amt ) {   // the moving strokes: a vortex and two wavy rakes (exact inverses: shifts across their own direction)
    vec3 ax = normalize( vec3( .3, 1., .25 ) ); float dd = length( cross( p, ax ) );
    p = jRotAx( p, ax, - amt * 1.3 * sin( uJFlow * .11 ) * exp( - dd * dd * 1.2 ) );
    p -= normalize( vec3( 1., .15, .1 ) ) * amt * .38 * sin( dot( p, normalize( vec3( -.15, 1., .05 ) ) ) * 3.3 + uJFlow * .5 );
    p -= normalize( vec3( .1, -.3, 1. ) ) * amt * .22 * sin( dot( p, normalize( vec3( 1., .2, -.05 ) ) ) * 6.1 - uJFlow * .37 );
    return p;
  }
  // returns the ink's colour and how much ink is there (a): the drops arrive one by one as the journey goes, then spread
  vec4 jMarble( vec3 p, out float vein ) {
    p = jUnrake( p, mix( .25, 1.9, uJour ) );
    if ( uJour > .35 ) p = mix( p, jUnrake( p * 1.8 + 3., 1.6 ) / 1.8 - 3. / 1.8, smoothstep( .35, .8, uJour ) );   // the flow folds into itself
    vein = 0.;
    vec3 Mc = normalize( vec3( 0., 1., .3 ) ), Nc = normalize( vec3( 1., 0., -.2 ) );
    float sp = .16, dt = abs( mod( dot( p, Nc ) + sp * .5, sp ) - sp * .5 );
    p -= Mc * .22 * pow( .03, dt / sp ) * ( uJPal < .5 ? 1.4 : .5 );   // a fine comb: feathered lines
    for ( int j = 0; j < 40; j++ ) {   // ink drops: the newest fall on the bar and push the older aside
      float id, r; vec3 c;
      if ( j < 4 ) { float b = floor( uJBars ) - float( j ), age = uJBars - b;
        id = b; c = normalize( jh3( b * 3.1 ) - .5 ) * 1.5; r = ( .14 + .2 * jh1( b * 5.7 ) ) * ( 1. - exp( - age * 4. ) ) * ( 1. - smoothstep( 3., 4., age ) ); }
      else { id = float( j ) * 13.7 + uJPal * 3.; c = normalize( jh3( id ) - .5 ) * 1.5; float born = uMarb * 1.25 - jh1( id * 9.1 );
        r = ( .1 + .32 * jh1( id * 2.3 ) * jh1( id * 4.1 + 2. ) ) * smoothstep( 0., .3, born ); }   // each stone falls in its turn and spreads
      if ( r < .002 ) continue;
      vec3 q = p - c; float L = length( q );
      if ( L < r ) { vein = max( vein, smoothstep( .9, 1., L / r ) ); return vec4( jInk( jh1( id * .37 ) ) * ( .88 + .12 * L / r ) * ( .96 + .04 * sin( L / r * 40. ) ), 1. ); }
      vein = max( vein, exp( - ( L - r ) * 140. ) * .9 );
      p = c + q * sqrt( max( 0., 1. - r * r / ( L * L ) ) );
    }
    float st = dot( p, normalize( vec3( .2, 1., .1 ) ) ) * 6.;
    return vec4( jInk( floor( st ) * .25 + .1 ), .25 * smoothstep( .3, .8, uJour ) );   // between the stones, only a faint wash, late
  }
  // a plait (the ground of Celtic knotwork): two families of bands crossing over and under in turn, gilded; aa: edge softness
  vec4 jPlait( vec2 g, float w, float aa ) {
    float a = g.x + g.y, b = g.x - g.y, da = abs( fract( a + .5 ) - .5 ), db = abs( fract( b + .5 ) - .5 );
    bool aOver = mod( floor( a + .5 ) + floor( b + .5 ), 2. ) < .5;
    float dOv = aOver ? da : db, dUn = aOver ? db : da, ow = .045;
    vec3 gold = vec3( .86, .64, .28 ), umber = vec3( .16, .10, .07 );
    vec4 col = vec4( 0. );
    col = mix( col, vec4( umber, 1. ), 1. - smoothstep( w + ow, w + ow + aa, dUn ) );
    col = mix( col, vec4( gold * ( .55 + .45 * sqrt( max( 0., 1. - dUn * dUn / ( w * w ) ) ) ), 1. ), 1. - smoothstep( w, w + aa, dUn ) );
    col = mix( col, vec4( umber, 1. ), 1. - smoothstep( w + ow, w + ow + aa, dOv ) );
    col = mix( col, vec4( gold * ( .6 + .5 * sqrt( max( 0., 1. - dOv * dOv / ( w * w ) ) ) ) + .5 * smoothstep( .3 * w, 0., abs( dOv - w * .25 ) ) * vec3( 1., .92, .75 ), 1. ), 1. - smoothstep( w, w + aa, dOv ) );
    return col;
  }
  vec3 jSpin( vec3 s ) { return jRotAx( s, vec3( 0., 1., 0. ), uJFlow * .03 ); }
  vec2 jSphereUV( vec3 s ) { return vec2( atan( s.x, s.z ) / JTAU * 16., asin( clamp( s.y, -1., 1. ) ) / JTAU * 16. ) + vec2( 0., uJFlow * .02 ); }
  float jReveal( vec3 s ) { return 1. - smoothstep( uIllum * 3.4 - .3, uIllum * 3.4, acos( clamp( dot( s, normalize( vec3( .3, .8, .5 ) ) ), -1., 1. ) ) ); }   // the engraving grows across the body from one point
  float jRelief( vec3 n ) { vec3 s = jSpin( n ); return jPlait( jSphereUV( s ), .06, .06 ).a * jReveal( s ); }   // the engraving's depth
  float map( vec3 p ) {
    p.x /= 1. + uWide;
    float pr = uProp > .5 ? propShape( p ) : 0.;   // lab: the proposed materials move the shell itself outward from the nucleus
    float d = ( abs( length( p ) - uShellR - pr ) - shellTh( p ) ) * ( uProp > .5 ? .6 : 1. );   // where thickness is <= 0 there is no metal: a hole the core shines through
    for ( int i = 0; i < ${NOTES}; i++ ) if ( uL[ i ].w > .001 ) d = smin( d, length( p - uL[ i ].xyz ) - uL[ i ].w, uK );
    for ( int i = 0; i < ${ND}; i++ ) if ( uD[ i ].w > .001 ) {
      vec3 q = p - uD[ i ].xyz; float dd = length( q ) - uD[ i ].w;
      if ( uFrac > .05 ) dd = mix( dd, ( abs( q.x ) + abs( q.y ) + abs( q.z ) - uD[ i ].w * 1.5 ) * .577, min( uFrac, 1. ) );   // fracture: drops become faceted shards
      d = smin( d, dd, uK * .8 );
    }
    for ( int i = 0; i < ${NS}; i++ ) if ( uS[ i ].w > .001 ) d = smin( d, length( p - uS[ i ].xyz ) - uS[ i ].w, uK * .7 );   // satellite orbs
    for ( int i = 0; i < ${NT}; i++ ) if ( uT[ ${TP} * i + 1 ].w > .002 && length( p - uTB[ i ].xyz ) < uTB[ i ].w ) {   // only near it   // flowing tendrils: a tapered curve of capsules, melted into the body at the root
      float e = 1e9;
      for ( int j = 0; j < ${TP - 1}; j++ ) e = min( e, seg( p, uT[ ${TP} * i + j ], uT[ ${TP} * i + j + 1 ] ) );
      d = smin( d, e, min( uK * .9, .09 ) );   // a soft neck at the root, not a melt that swallows it
    }
    if ( uWRA > .01 ) d = smin( d, wRings( p ), .07 );   // the rings melt into the body where they pass through it
    if ( serpA() > .01 && dot( p, p ) < 2.2 ) d = smin( d, serpentD( p ), .06 );   // the serpent's pull: the mass rises after it, no seam
    d += .016 * uWob * sin( p.x * 3.7 + uTime * .31 ) * sin( p.y * 4.1 - uTime * .27 ) * sin( p.z * 3.3 + uTime * .23 );   // slow surface wobble
    // surface displacement, only evaluated near the surface and clamped, with the march step reduced to match (uDisp)
    if ( d < .45 ) {
      float disp = 0.;
      if ( uChaos > .01 ) {   // intensity: domain-warped turbulence, faster, finer and deeper the wilder the music gets
        float tt = uTime * ( .4 + uChaos * 2.6 ) * uTurbSpeed;
        vec3 q = p * ( 2.2 + uChaos * 2.2 ) * uTurbDetail;
        q += uChaos * .75 * vec3( sin( q.y * 1.7 + tt ), sin( q.z * 1.3 - tt * .8 ), sin( q.x * 1.5 + tt * 1.1 ) );
        float nz = sin( q.x + tt ) * sin( q.y * 1.1 - tt * .7 ) * sin( q.z * .9 + tt * .6 ) + .35 * sin( q.x * 1.9 - tt * 1.3 ) * sin( q.y * 1.7 + tt ) * sin( q.z * 2.1 + tt * .4 );
        disp += nz * pow( min( uChaos, 1.6 ), 1.4 ) * .13 * smoothstep( .45, 0., d );
      }
      if ( uSpikes > 0. ) {   // ferrofluid spikes, shimmering with the hi-hats
        vec3 n = normalize( p );
        float s = sin( n.x * uSpikeF + uTime * .4 ) * sin( n.y * uSpikeF * 1.07 ) * sin( n.z * uSpikeF * .93 - uTime * .3 );
        disp += pow( max( s, 0. ), uSpikeP ) * uSpikes * smoothstep( .2, 0., d );
      }
      if ( uGrain > .01 ) {   // noisiness: sand-like micro grain, re-seeded fast
        vec3 g = p * ( 26. + 14. * uGrain ) + vec3( 0., uTime * .15, 0. );   // a fine sandy texture anchored to the metal, drifting slowly
        vec3 gi = floor( g ), gf = fract( g ); gf = gf * gf * ( 3. - 2. * gf );
        float sand = mix( mix( mix( hash3( gi ), hash3( gi + vec3( 1, 0, 0 ) ), gf.x ), mix( hash3( gi + vec3( 0, 1, 0 ) ), hash3( gi + vec3( 1, 1, 0 ) ), gf.x ), gf.y ),
                          mix( mix( hash3( gi + vec3( 0, 0, 1 ) ), hash3( gi + vec3( 1, 0, 1 ) ), gf.x ), mix( hash3( gi + vec3( 0, 1, 1 ) ), hash3( gi + vec3( 1, 1, 1 ) ), gf.x ), gf.y ), gf.z );
        disp += ( sand - .5 ) * .012 * min( uGrain, 1.3 ) * smoothstep( .12, 0., d );
      }
      if ( uFrac > .01 ) {   // roughness: sharp ridged, stepped facets
        vec3 q = p * 3.4 + vec3( 1.7, 4.3, 2.1 );
        float r1 = 1. - abs( sin( q.x + sin( q.y * 1.3 + uTime * .2 ) + sin( q.z * .9 ) ) ), r2 = 1. - abs( sin( q.y * 1.7 + q.z * .6 + sin( q.x * 1.1 ) ) );
        float rg = r1 * r2; rg *= rg;
        disp += ( floor( rg * 3. ) / 3. * .6 + rg * .4 ) * .05 * min( uFrac, 1.3 ) * smoothstep( .3, 0., d );
      }
      if ( uIntr > .01 ) {   // intricacy: small secondary ripples
        disp += uIntr * .011 * sin( p.x * 17. + uTime * 1.1 + sin( p.y * 9. ) ) * sin( p.y * 15. - uTime * .9 ) * sin( p.z * 13. + uTime * .7 ) * smoothstep( .2, 0., d );
      }
      disp += shDisp( normalize( p ) ) * smoothstep( .3, 0., d );
      if ( uCyA > .001 ) {   // cymatics: the leading planet's number as a sectoral standing wave of the whole body (Saturn 3 ... Moon 9), round a slowly turning axis
        vec3 nn = normalize( p ), e1 = normalize( cross( uCyAx, vec3( .31, .17, .93 ) ) ), e2 = cross( uCyAx, e1 );
        float st = length( cross( nn, uCyAx ) ), phi = atan( dot( nn, e2 ), dot( nn, e1 ) );
        disp += uCyA * pow( st, uCyN * .5 ) * cos( uCyN * phi + uCyPh ) * smoothstep( .3, 0., d );
      }
      if ( uRegA > .001 ) {   // the motor population's eight regions (being/kuramoto.mjs): each swells on its own pulse where it is out of step with the rest
        vec3 n = normalize( p ); float rs = 0., rw = 1e-3;
        for ( int g = 0; g < 8; g++ ) {
          vec3 rd = vec3( mod( float( g ), 2. ), mod( floor( float( g ) * .5 ), 2. ), floor( float( g ) * .25 ) ) * 2. - 1.;
          float k = max( dot( n, rd ) * .57735, 0. ); k *= k * k; rs += k * uRegP[ g ]; rw += k;
        }
        disp += uRegA * rs / rw * smoothstep( .3, 0., d );
      }
      if ( uSongAmt > .01 ) { vec3 sn = normalize( p ); float hgt = textureLod( uSongTex, songUV( sn ), 0. ).a, gl = textureLod( uSongGlow, songUV( sn ), 0. ).r;
        disp += ( ( hgt - .45 ) * .09 + gl * .025 ) * uSongAmt * smoothstep( .25, 0., d ) * ( 1. - smoothstep( .85, .99, abs( sn.y ) ) ); }   // the remembered song raises and carves the metal
      if ( uMorphA > .01 ) disp += ( textureLod( uMorph, normalize( p ), 1. ).r - .5 ) * 2. * uMorphD * uMorphA * smoothstep( .15, 0., d );   // the song's grown form (morph.mjs)
      if ( uIllum > .01 ) disp -= jRelief( normalize( p ) ) * .004 * smoothstep( .15, 0., d );   // the journey's engraving, cut into the metal
      if ( uSkinA > .01 ) { vec3 sn = normalize( p ), sk = skinSample( uSkin, sn ); disp += ( sk.r - .3 ) * .035 * uSkinA * smoothstep( .15, 0., d ) * ( 1. - smoothstep( .85, .99, abs( sn.y ) ) ); }   // fades at the poles, where the texture pinches   // the living skin raises the metal where it grows
      if ( uCaA > .01 ) disp += ( caLook( normalize( p ) ).a - .35 ) * uCaD * uCaA * smoothstep( .15, 0., d );   // the automaton carves the metal: live cells raised, resting ones sunk
      d -= clamp( disp, - .12, .12 ) * smoothstep( - .012, .012, shellTh( p ) );   // displacement never refills the holes where the metal has parted
    }
    if ( uRise > .001 ) d = riseBody( p, d );   // rising: the body gives way to a fractal or pure geometry
    return d;
  }
  vec3 normalAt( vec3 p ) {
    vec2 k = vec2( 1., -1. ); float h = .0018;
    return normalize( k.xyy * map( p + k.xyy * h ) + k.yyx * map( p + k.yyx * h ) + k.yxy * map( p + k.yxy * h ) + k.xxx * map( p + k.xxx * h ) );
  }
  float calcAO( vec3 p, vec3 n ) {
    float d1 = shellTh( p + n * .055 );
    return clamp( 1. - 2.6 * max( .055 - d1, 0. ), .42, 1. );
  }
  vec4 noteTint( vec3 p ) {   // which lobes this point belongs to, as a blend of their note colours; alpha: how much lobe it is
    vec3 c = vec3( 0. ); float w = 1e-4;
    for ( int i = 0; i < ${NOTES}; i++ ) { float k = exp( - max( length( p - uL[ i ].xyz ) - uL[ i ].w, 0. ) * 22. ) * step( .001, uL[ i ].w ); c += uNoteC[ i ] * k; w += k; }
    return vec4( c / w, w / ( w + .08 ) );
  }
  vec3 env( vec3 r, vec3 p ) {
    vec3 sky = mix( vec3( .018, .02, .038 ), vec3( .24, .24, .31 ), smoothstep( -.7, 1., r.y ) ) + uLight * .32 * smoothstep( -.2, 1., r.y );
    float cw = 1. - .58 * uCrisp;   // brighter sound: narrower, crisper highlights
    vec3 keyDir = normalize( vec3( -.48, .62, .62 ) ), rimDir = normalize( vec3( .65, .28, -.7 ) );
    float ggxKey = pow( max( dot( r, keyDir ), 0. ), 28. / max( cw, .25 ) ) * ( .9 + .75 * uCrisp );
    float ggxRim = pow( max( dot( r, rimDir ), 0. ), 14. / max( cw, .3 ) ) * ( .35 + .35 * uCrisp );
    sky += vec3( 1., .99, .96 ) * ( smoothstep( .08 * cw, 0., abs( r.y - .5 ) ) * ( .85 + .4 * uCrisp ) + ggxKey * .65 );
    sky += vec3( .82, .88, 1. ) * ( smoothstep( .05 * cw, 0., abs( r.x + .62 ) ) * smoothstep( -.2, .4, r.y ) * ( .5 + .3 * uCrisp ) + ggxRim * .5 );
    sky += uLight * smoothstep( .1, 0., abs( r.y + .35 ) ) * .38;
    vec3 toCore = normalize( - p );
    float k = max( dot( r, toCore ), 0. ), size = clamp( uCoreR * 1.6 / max( length( p ), .05 ), .05, .99 );
    return sky * uEnv + uLight * ( smoothstep( 1. - size * size * 1.6, 1., k ) * 5.2 + pow( k, 4. ) * .85 ) * uGlow;
  }
  vec3 film( float x ) { return .5 + .5 * cos( 6.2831853 * ( x + vec3( 0., .33, .67 ) ) ); }
  // ---- materials (being/materials.mjs): 0-5 the original six, 6-9 the elements, 10-16 the planets in their metals ----
  float mNoise( vec3 x ) { vec3 i = floor( x ), f = fract( x ); f = f * f * ( 3. - 2. * f );
    return mix( mix( mix( hash3( i ), hash3( i + vec3( 1, 0, 0 ) ), f.x ), mix( hash3( i + vec3( 0, 1, 0 ) ), hash3( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
                mix( mix( hash3( i + vec3( 0, 0, 1 ) ), hash3( i + vec3( 1, 0, 1 ) ), f.x ), mix( hash3( i + vec3( 0, 1, 1 ) ), hash3( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z ); }
  float mFbm( vec3 x ) { return .55 * mNoise( x ) + .3 * mNoise( x * 2.03 + 11.7 ) + .15 * mNoise( x * 4.11 + 23.1 ); }
  // nearest and second-nearest cell distance (8-tap octant 3D Worley): solar granulation, lunar craters
  vec2 mCells( vec3 x ) { vec3 i = floor( x ), f = fract( x ), b = step( .5, f ); float d1 = 8., d2 = 8.;
    for ( int k = 0; k < 8; k++ ) { vec3 o = vec3( float( k - ( k / 2 ) * 2 ), float( ( k / 2 ) - ( k / 4 ) * 2 ), float( k / 4 ) ) + b - 1., g = i + o;
      vec3 c = o + vec3( hash3( g ), hash3( g + 17.3 ), hash3( g + 41.9 ) ) - f; float d = dot( c, c );
      if ( d < d1 ) { d2 = d1; d1 = d; } else if ( d < d2 ) d2 = d; }
    return sqrt( vec2( d1, d2 ) ); }
  // bubbles in water: a sparse field of spheres in 8-tap octant cell space
  vec3 mBubbles( vec3 x, vec3 L ) {
    vec3 i = floor( x ), f = fract( x ), b = step( .5, f ), res = vec3( 0. );
    for ( int k = 0; k < 8; k++ ) {
      vec3 o = vec3( float( k - ( k / 2 ) * 2 ), float( ( k / 2 ) - ( k / 4 ) * 2 ), float( k / 4 ) ) + b - 1., g = i + o;
      if ( hash3( g + 5.1 ) < ${EXT.shader.bubbles || '.55'} ) continue;
      vec3 c = o + .2 + .6 * vec3( hash3( g ), hash3( g + 17.3 ), hash3( g + 41.9 ) ) - f;
      float rad = .1 + .3 * hash3( g + 9.7 ) * hash3( g + 3.3 ), d = length( c );
      if ( d > rad + .04 ) continue;
      float rim = smoothstep( .05, 0., abs( d - rad ) ) + .6 * pow( clamp( d / rad, 0., 1. ), 6. ) * step( d, rad );
      float inside = smoothstep( rad, rad - .03, d );
      float spec = pow( max( dot( normalize( - c + 1e-4 ), L ), 0. ), 40. ) * inside;
      res = max( res, vec3( rim, inside, spec ) );
    }
    return res;
  }
  vec3 mBubbleFlow( vec3 q, float t ) {   // a slow current round the body, with a little wander of its own
    float a = t * .18; vec3 k = normalize( vec3( .35, 1., .2 ) );
    q = q * cos( a ) + cross( k, q ) * sin( a ) + k * dot( k, q ) * ( 1. - cos( a ) );
    return q + .06 * vec3( sin( q.y * 3. + t * .7 ), sin( q.z * 3. - t * .6 ), sin( q.x * 3. + t * .5 ) );
  }
  vec3 mBlackbody( float h ) { h = clamp( h, 0., 1.5 ); return vec3( smoothstep( .12, .55, h ) * 1.7, smoothstep( .38, .9, h ) * 1.15, smoothstep( .78, 1.3, h ) * .95 ); }
  // the inner light seen along a ray from a surface point (through glass, water, air)
  float mCoreAlong( vec3 p, vec3 d ) { return exp( - max( 0., length( cross( p, d ) ) - uCoreR ) * 7. ) * step( 0., - dot( p, d ) ); }
  vec3 mRipple( vec3 p, vec3 n, float f, float s, float a ) {   // a liquid surface's moving normal
    vec3 d1 = normalize( vec3( 1., .3, .2 ) ), d2 = normalize( vec3( -.4, 1., .5 ) ), d3 = normalize( vec3( .3, -.5, 1. ) );
    vec3 g = d1 * cos( dot( p, d1 ) * f + uTime * 1.3 * s ) + d2 * cos( dot( p, d2 ) * f * 1.23 - uTime * 1.1 * s ) + d3 * cos( dot( p, d3 ) * f * .81 + uTime * .9 * s );
    return normalize( n + a * ( g - n * dot( g, n ) ) ); }
  // one material at a surface point: rgb, and alpha (air lets the world through)
  // ---- the proposed elements and planets (lab, uProp; lab/prototypes/material-proposals.html): colours from the 777 scales ----
  vec3 pHex( float r, float g, float b ) { return pow( vec3( r, g, b ) / 255., vec3( 2.2 ) ); }
  float pThick( vec3 p, vec3 d ) { return clamp( ( 1.8 * max( - dot( p, d ), .06 ) + 2.5 * max( shellTh( p ), 0. ) ) / max( uShellR, .15 ), .12, 2.4 ); }
  mat2 pRot( float a ) { float c = cos( a ), s = sin( a ); return mat2( c, - s, s, c ); }
  // earth's relief for bump-mapping (body units): latewood grooves and fine grain (single-pass, no Worley in gradient)
  float earthH( vec3 Q ) {
    float r = length( Q ), ring = fract( r * 30. - uTime * .01 );
    return - .6 * smoothstep( .35, .8, ring ) * smoothstep( 1., .9, ring ) + .25 * mNoise( vec3( r * 120., Q.y * 4., Q.z * 4. ) );
  }
  vec3 pFlow( vec3 q, float t ) {   // drifting 3D curl-warped field so tones wander and mix without static stripes
    vec3 w = q; w.xz *= pRot( t * .09 + q.y * .45 ); w.xy *= pRot( - t * .07 + q.z * .35 );
    return w + .45 * vec3( mNoise( w * 1.9 + t * .22 ) - .5, mNoise( w * 1.9 + 7.3 - t * .19 ) - .5, mNoise( w * 1.9 + 15.1 + t * .16 ) - .5 );
  }
  vec4 propShade( int id, vec3 p, vec3 n, vec3 rd ) {
    float R = uShellR, t = uTime, ndv = max( dot( n, - rd ), 0. ), fr = pow( 1. - ndv, 5. );
    vec3 q = p / R, r = reflect( rd, n ), l = normalize( vec3( -.48, .62, .62 ) ), sn = normalize( p );
    float dif = max( dot( n, l ), 0. ), rr = length( q ), a = 1.;
    vec3 col = vec3( 0. );
    if ( id == 6 ) {   // fire: the body is the coal: a dark crust with glowing veins; the flame itself is light (fireVolume)
      float temp = .3 + .7 * uAro;
      vec2 ck = mCells( q * 3.2 + sn * t * .08 ); float vein = smoothstep( .09, 0., ck.y - ck.x );   // the cracks between plates of crust
      float glowN = mFbm( q * 2.6 - sn * t * .9 );
      vec3 crimson = pHex( 174., 14., 54. ), verm = pHex( 217., 56., 30. ), scar = pHex( 255., 42., 0. ), gold = pHex( 255., 176., 0. );
      vec3 coal = mix( vec3( .012, .004, .003 ), crimson * .35, smoothstep( .35, .8, glowN ) * temp );
      vec3 hot = mix( verm, mix( scar, gold, smoothstep( .55, .95, temp ) ), smoothstep( .3, .8, glowN ) );
      col = coal + hot * vein * ( .5 + 1.6 * temp ) * ( .7 + .5 * uBeatPulse + .5 * uKick ) + scar * pow( 1. - ndv, 3. ) * .35 * temp;   // and a hot rim where the flame stands behind it
    } else if ( id == 7 ) {   // water: absorbed by depth (sea green thin, deep blue, olive deepest), Fresnel, caustics from the core
      vec3 rf = refract( rd, n, .75 ); float th = pThick( p, rf );
      vec3 through = exp( - vec3( 2.1, .55, .28 ) * th * 1.4 );
      vec3 deep = pHex( 0., 77., 171. ), sea = pHex( 20., 156., 136. ), olive = pHex( 91., 99., 0. );
      vec3 body = mix( sea * 1.3, deep, smoothstep( .2, 1., th ) ); body = mix( body, olive * .55, smoothstep( 1.5, 2.1, th ) );
      vec3 w = q + rf * th * .5;
      float ca = sin( w.x * 9. + t * 1.1 + sin( w.y * 5. ) ) + sin( w.y * 8. - t * .9 + sin( w.z * 6. ) ) + sin( w.z * 10. + t + sin( w.x * 4. ) );
      float caus = pow( smoothstep( 1., 0., abs( ca ) ), 4. );
      vec3 core = uLight * exp( - length( w ) * 2.2 ) * ( .5 + .6 * uGlow );
      col = body * ( .18 + .5 * through.b ) + core * through + sea * caus * .7 * through.g + env( r, p ) * ( .02 + .98 * fr ) * 1.4;
      { vec3 bH = normalize( l - rd ), b1 = mBubbles( mBubbleFlow( q, t ) * 4.6, bH );
        col = col * ( 1. - .4 * b1.y ) + vec3( .55, .9, 1. ) * b1.x * .62 + vec3( 1. ) * b1.z * 2.3 + sea * b1.y * .12; }
      { float salt = smoothstep( .84, .92, mNoise( q * 58. + 3. ) ) * smoothstep( .3, .7, mFbm( q * 4. ) );   // salt: crystal flecks in the water, each catching the light as it turns
        float tw = pow( max( dot( reflect( rd, normalize( n + .6 * ( vec3( mNoise( q * 58. ), mNoise( q * 58. + 9. ), mNoise( q * 58. + 17. ) ) - .5 ) ) ), l ), 0. ), 24. );
        col += mix( vec3( 1., .97, .9 ), pHex( 254., 221., 0. ), .25 ) * salt * ( .25 + 2.5 * tw ); }
      float foam = uKick * smoothstep( .35, .8, mFbm( q * 7. + t ) ) * smoothstep( .5, 0., ndv );
      col = mix( col, mix( vec3( 1. ), pHex( 187., 41., 187. ), .25 + .25 * sin( ndv * 20. + t ) ) * .9, foam );
    } else if ( id == 8 ) {   // air: a cloud; thick at the core, frayed and thin at the edge, sky blue where thin, a pale-yellow lining
      float f = mFbm( q * 1.7 + vec3( t * .35, t * .2, 0. ) ), edge = pow( 1. - ndv, 1.5 ), lightN = smoothstep( -.6, .9, dot( sn, l ) );
      vec3 sky = pHex( 138., 186., 211. ), pale = pHex( 254., 231., 77. ), bem = pHex( 0., 149., 141. );
      col = mix( pale * ( .75 + .45 * f ) + bem * .05, mix( sky * 1.25, pale, .35 ), edge ) * ( .35 + .7 * lightN ) + pale * ( .4 + pow( lightN, 3. ) * .8 ) * edge;   // bright pale yellow (its table colour), sky blue only at the thinnest edge
      col += uLight * mCoreAlong( p, rd ) * .35 * uGlow + vec3( 1. ) * smoothstep( .9, .97, mNoise( q * 45. + t * 3. ) ) * 1.6;   // scintillation: points that catch the light
      a = clamp( .55 + .5 * f - .6 * edge, .06, .95 );
    } else if ( id == 9 ) {   // earth: shell rings (earlywood amber, latewood brown) tinted by the four soil colours, amber heart through cracks, moss low.
      float grow = t * .01, e = .004, h0 = earthH( q );
      vec3 gq = vec3( earthH( q + vec3( e, 0., 0. ) ) - h0, earthH( q + vec3( 0., e, 0. ) ) - h0, earthH( q + vec3( 0., 0., e ) ) - h0 ) / e;
      vec2 cr = mCells( q * 2.6 + 1.3 ); float crack = smoothstep( .035, 0., cr.y - cr.x ) * smoothstep( .55, .7, mFbm( q * 1.7 + 8. ) );
      vec3 nb = normalize( n - .018 * ( gq - n * dot( gq, n ) ) ); float difB = max( dot( nb, l ), 0. ), cav = clamp( 1. + .9 * ( h0 - .8 * crack ), .25, 1. );
      float ring = fract( rr * 30. - grow ), bi = mod( floor( rr * 7.5 - grow * .25 ), 4. );
      vec3 cit = pHex( 222., 219., 44. ), oli = pHex( 141., 136., 0. ), rus = pHex( 115., 24., 23. ), brown = pHex( 56., 32., 10. ), amber = pHex( 255., 183., 52. ), green = pHex( 0., 165., 80. ), yel = pHex( 254., 221., 0. );
      vec3 soil = bi < 1. ? cit : bi < 2. ? oli : bi < 3. ? rus : vec3( .08, .07, .06 );
      float late = smoothstep( .35, .8, ring ) * smoothstep( 1., .9, ring );
      vec3 wood = mix( mix( amber * .5, brown * .3, late ), soil * .4, .28 ) * ( .7 + .5 * mNoise( vec3( rr * 120., q.y * 4., q.z * 4. ) ) );
      wood = mix( wood, green * ( .55 + .3 * mNoise( q * 9. ) ) + yel * smoothstep( .78, .86, mNoise( q * 50. ) ) * .7, smoothstep( .38, .62, mFbm( q * 2.2 + 5. ) ) * .8 );
      float hollow = smoothstep( .99, .93, rr ) * smoothstep( .3, .55, mNoise( q * 3. + 2. ) );
      vec3 moss = mix( green * .5, green * .22, mNoise( q * 18. ) ) * ( .8 + .4 * mNoise( q * 40. ) ) + yel * smoothstep( .78, .86, mNoise( q * 55. ) ) * .7;
      col = mix( wood, moss, hollow * .9 ) * ( .04 + .8 * difB + .08 * uGlow ) * cav * cav + env( reflect( rd, nb ), p ) * pow( 1. - max( dot( nb, - rd ), 0. ), 5. ) * .1;
      col = mix( col, amber * ( 1. + 1.4 * uAro + .5 * uBeatPulse ), crack * ( 1. - hollow ) );
    } else if ( id == 10 ) {   // saturn: a black mirror, indigo beneath, blue meridians
      vec3 w = q; w.xz *= pRot( t * .05 );
      float mer = smoothstep( .015, 0., abs( sin( atan( w.z, w.x ) * 6. ) ) ) * ( .5 + .5 * smoothstep( 1., .2, abs( w.y ) ) );
      col = env( r, p ) * mix( vec3( .04, .045, .07 ), vec3( 1. ), fr ) + pHex( 0., 20., 137. ) * .35 * pow( 1. - ndv, 2. ) + pHex( 0., 10., 68. ) * .2 + pHex( 0., 133., 202. ) * mer * .9 + pHex( 174., 14., 54. ) * .05 * smoothstep( .75, 1., ndv );
    } else if ( id == 11 ) {   // jupiter: swirling violet and lapis cyclones under tin, with golden pyrite sparks
      vec3 w = pFlow( q, t * .9 );
      float b = mFbm( w * 2.2 + vec3( 0., t * .08, 0. ) ), vort = mFbm( w * 3.8 - b * 1.8 );
      vec3 vio = pHex( 127., 20., 170. ), blu = pHex( 0., 105., 215. ), pur = pHex( 94., 23., 235. ), az = pHex( 31., 115., 184. );
      vec3 alb = mix( mix( vio, blu, smoothstep( .25, .75, vort ) ), pur, smoothstep( .55, .9, b ) * .65 );
      float lap = smoothstep( .48, .78, mFbm( w * 3.2 + 9. ) ); alb = mix( alb, az, lap * .65 );
      col = alb * ( .22 + .72 * dif ) + env( r, p ) * mix( vec3( .55, .58, .65 ), vec3( 1. ), fr ) * .55 + pHex( 254., 221., 0. ) * smoothstep( .82, .91, mNoise( w * 46. ) ) * lap * 2.6;
    } else if ( id == 12 ) {   // mars: dark forged steel; ridges glow scarlet from the hits, cooling orange; azure lightning at the strongest
      float rg = 1. - abs( 2. * pFbm( q * 2.4 + 3. ) - 1. );
      float hot = pow( rg, 6. ) * uKick + pow( rg, 9. ) * ( .15 + .5 * uBeatPulse ) * uAro;
      col = env( r, p ) * mix( vec3( .3, .31, .33 ), vec3( 1. ), fr ) * .9 + vec3( .04 ) * dif + mix( pHex( 200., 8., 21. ), pHex( 255., 109., 0. ), smoothstep( .4, 1., hot ) ) * hot * 3.5;
      float bolt = smoothstep( .012, 0., abs( pFbm( q * 2.2 + floor( t * 7. ) * 3.1 ) - .5 ) ) * smoothstep( .65, .9, uKick );
      col += vec3( .55, .8, 1. ) * bolt * 4.;
    } else if ( id == 13 ) {   // sun: translucent amber lit from inside, gold granulation, rose and salmon in the shadows
      vec2 g = mCells( sn * 9. + vec3( 0., t * .12, 0. ) ); float gran = smoothstep( 0., .45, g.y - g.x );
      float inner = exp( - pThick( p, refract( rd, n, .8 ) ) * 1.1 );
      vec3 gold = pHex( 254., 221., 0. ), orange = pHex( 255., 109., 0. ), rose = pHex( 253., 195., 198. ), salmon = pHex( 242., 83., 48. ), amber = pHex( 255., 165., 0. );
      col = mix( orange, gold, gran ) * ( .35 + 1.4 * inner ) * ( .8 + .4 * uBeatPulse ) * ( .6 + .5 * uGlow );
      col = mix( col, mix( salmon, rose, .5 ) * .7, ( 1. - dif ) * .45 * ( 1. - inner ) ) + amber * pow( 1. - ndv, 2.5 ) * 1.3 + env( r, p ) * fr * .4;
    } else if ( id == 14 ) {   // venus: copper skin with light under it, emerald gem patches, a cerise flush
      vec3 cu = vec3( .955, .638, .538 ); float wrap = max( 0., ( dot( n, l ) + .45 ) / 1.45 );
      vec3 skin = cu * cu * ( .08 + .45 * wrap ) + vec3( .9, .3, .2 ) * .12 * ( 1. - dif ) * ( 1. - fr ) + env( r, p ) * mix( cu, vec3( 1. ), fr ) * 1.5 + cu * pow( max( dot( r, l ), 0. ), 12. ) * .6;
      float gem = smoothstep( .6, .66, mFbm( q * 2.2 + 2. ) );
      vec3 gemC = mix( pHex( 0., 165., 80. ), vec3( .25, .85, .8 ), mFbm( q * 6. ) ) * ( .15 + .6 * dif ) + env( r, p ) * mix( vec3( .08 ), vec3( 1. ), fr ) * 1.1;
      float flush = ( .5 + .5 * sin( t * .4 ) ) * ( .3 + .7 * uAro ) * smoothstep( .2, .9, ndv );
      col = mix( mix( skin, gemC, gem ), pHex( 164., 18., 71. ) * ( .5 + .5 * wrap ), flush * .25 * ( 1. - gem ) );
    } else if ( id == 15 ) {   // mercury: the mirror, opal play-of-colour in patches, nerve veins flickering
      col = env( r, p ) * mix( vec3( .78, .79, .8 ), vec3( 1. ), fr ) * 1.15;
      float opalM = smoothstep( .55, .7, mFbm( q * 2.3 + t * .08 ) );
      vec3 opal = .5 + .5 * cos( 6.2831 * ( ndv * 7. + mFbm( q * 5. ) * 6. + t * .3 + vec3( 0., .33, .67 ) ) );
      col = mix( col, col * .35 + opal * ( .45 + .9 * pow( 1. - ndv, 1.5 ) ), opalM * .75 );
      float vein = pow( 1. - abs( 2. * mFbm( q * 4.5 + 7. ) - 1. ), 18. ), flick = .4 + .6 * step( .4, hash3( vec3( floor( t * 12. ), floor( q.y * 3. ), 1. ) ) );
      col += vec3( .9, .95, 1. ) * vein * flick * ( .4 + 1.6 * uAro + uBeatPulse );
    } else if ( id == 16 ) {   // moon: pearl silver, a moonstone sheen floating inside, the terminator of its phase
      vec3 sun = normalize( vec3( sin( 1.1 + t * .04 ), .2, cos( 1.1 + t * .04 ) * .6 - .2 ) );
      float lit = smoothstep( -.08, .12, dot( n, sun ) );
      vec3 pearl = mix( vec3( .93, .93, .95 ), vec3( .95, .9, .97 ), mFbm( q * 4. ) );
      col = env( normalize( mix( r, n, .3 ) ), p ) * mix( pearl * .8, vec3( 1. ), fr ) * ( .06 + .94 * lit ) + pearl * 1.1 * lit * max( dot( n, sun ), 0. ) + pearl * .03 * ( 1. - lit );
      col += pHex( 138., 186., 211. ) * exp( - pow( ( ndv - .55 + .15 * sin( t * .3 + q.y * 2. ) ) * 4., 2. ) ) * .3 * ( .3 + .7 * lit );
    } else if ( id == 17 ) {   // cinnabar: a forged iron-porphyry crust parting in glowing windows over gold and scarlet sulphur fire
      vec3 wf = pFlow( q, t * 1.1 );
      vec2 c = mCells( wf * 3.6 + .7 ); float win = smoothstep( .24, .03, c.x ) * smoothstep( .32, .68, mFbm( wf * 2.1 - sn * t * .35 ) );
      float rg = 1. - abs( 2. * mFbm( wf * 2.5 + 3. ) - 1. ), vein = smoothstep( .06, 0., c.y - c.x ) + pow( rg, 5. ) * ( .4 + uKick );
      vec3 scar = pHex( 255., 36., 0. ), porp = pHex( 110., 13., 37. ), flame = pHex( 255., 106., 0. ), gold = pHex( 255., 205., 35. ), iron = vec3( .24, .21, .22 );
      float inner = exp( - pThick( p, refract( rd, n, .78 ) ) * 1.15 );
      vec3 furnace = mix( scar, mix( flame, gold, inner * ( .6 + .4 * c.y ) ), .55 + .45 * mFbm( wf * 4. - t * .5 ) ) * ( 1.1 + 1.3 * uAro + .9 * uBeatPulse );
      vec3 armor = env( r, p ) * mix( iron, vec3( 1., .75, .55 ), fr ) * .85 + mix( iron * .35, porp, mFbm( wf * 2.8 ) ) * ( .2 + .75 * dif );
      col = mix( armor, furnace, clamp( win + vein * .65, 0., 1. ) ) + scar * pow( 1. - ndv, 2.8 ) * ( .45 + .55 * uAro );
    } else if ( id == 18 ) {   // terracotta: deep indigo and warm umber earth with copper-emerald veins and points of light set in it
      vec3 wf = pFlow( q, t * .55 );
      float strata = mFbm( wf * 2.4 + vec3( 0., rr * 3.5, 0. ) ), gemM = smoothstep( .52, .72, mFbm( wf * 3.1 + 4. ) );
      vec2 pinC = mCells( normalize( wf + 1e-4 ) * 5.2 ); float nail = smoothstep( .14, .02, pinC.x ) * ( .65 + .6 * mCoreAlong( p, refract( rd, n, .72 ) ) );
      vec3 ro = pHex( 232., 74., 20. ), ind = pHex( 24., 13., 92. ), oli = pHex( 110., 107., 46. ), brn = pHex( 92., 56., 24. ), em = pHex( 0., 158., 96. ), cu = vec3( .955, .638, .538 );
      float wrap = max( 0., ( dot( n, l ) + .45 ) / 1.45 );
      vec3 earth = mix( mix( brn, oli, strata ), mix( ro, ind, smoothstep( .28, .75, mFbm( wf * 1.8 + 9. ) ) ), .52 );
      earth = mix( earth, mix( em, cu * .85, mFbm( wf * 5. ) ), gemM * .68 );
      col = earth * ( .18 + .82 * wrap ) * ( .8 + .25 * mNoise( q * 28. ) ) + env( r, p ) * mix( cu * .45 + ind * .4, vec3( 1., .95, .88 ), fr ) * .65;
      col += mix( cu, vec3( 1., .92, .72 ), .55 ) * nail * ( 1.1 + 1.2 * uBeatPulse + .7 * uGlow ) + pHex( 196., 212., 240. ) * pow( 1. - ndv, 2.6 ) * .38;
    } else if ( id == 19 ) {   // tourmaline: two wandering air currents, orange and mauve, parted by a flashing quicksilver edge
      vec3 wf = pFlow( q, t * 1.25 );
      float field = mFbm( wf * 2.1 + vec3( t * .18, - t * .14, 0. ) ) - .48 + .18 * dot( sn, vec3( cos( t * .27 ), .25, sin( t * .27 ) ) );
      float twin = smoothstep( -.14, .14, field ), sword = exp( - pow( field * 18., 2. ) );
      vec3 org = pHex( 255., 123., 36. ), mau = pHex( 216., 161., 232. ), lea = pHex( 232., 196., 104. ), sky = pHex( 135., 206., 235. ), rgry = pHex( 158., 107., 130. );
      vec3 curA = mix( org, lea, mFbm( wf * 3.8 ) ), curB = mix( mau, mix( sky, rgry, .45 ), mFbm( wf * 3.8 + 6. ) );
      vec3 tint = mix( curA, curB, twin );
      float core = mCoreAlong( p, refract( rd, n, .68 ) ), vein = pow( 1. - abs( 2. * mFbm( wf * 4.6 + 7. ) - 1. ), 16. );
      vec3 opal = film( ndv * 4. + field * 3. + t * .2 );
      col = tint * ( .28 + .65 * dif + .75 * core ) + mix( vec3( .92, .95, 1. ), opal, .35 ) * ( sword * ( 1.6 + 1.2 * uBeatPulse ) + vein * ( .5 + 1.1 * uAro ) ) + env( r, p ) * mix( vec3( .78, .79, .82 ), vec3( 1. ), fr ) * .95;
      a = clamp( .76 + .2 * abs( field ) + .2 * sword - .28 * pow( 1. - ndv, 1.8 ), .35, .98 );
    } else if ( id == 20 ) {   // amber: a translucent amber-pearl shell round a deep maroon-violet water heart with caustics and bubbles
      vec3 rf = refract( rd, n, .74 ); float th = pThick( p, rf );
      vec3 wf = pFlow( q + rf * th * .4, t * .65 );
      vec3 amb = pHex( 255., 179., 25. ), mar = pHex( 122., 6., 28. ), rus = pHex( 168., 71., 30. ), dgrn = pHex( 46., 66., 51. ), vio = pHex( 92., 36., 158. ), silver = vec3( .9, .93, .98 );
      float heart = smoothstep( .25, 1.35, th ) * ( .55 + .45 * mFbm( wf * 2.5 ) );
      vec3 cup = mix( mix( amb * 1.25, rus, smoothstep( .2, .9, mFbm( wf * 3. ) ) ), mix( mar * 1.35, mix( vio, dgrn, .35 ), mFbm( wf * 2.2 + 5. ) ), heart );
      float ca = sin( wf.x * 8. + t ) + sin( wf.y * 7. - t * .8 ) + sin( wf.z * 9. + t * .7 );
      float caus = pow( smoothstep( 1.1, 0., abs( ca ) ), 4. );
      vec3 b1 = mBubbles( mBubbleFlow( q, t * .8 ) * 4.2, normalize( l - rd ) );
      col = cup * ( .32 + .75 * exp( - th * .75 ) + .35 * dif ) + mix( amb, mar, .4 ) * caus * .65 + silver * ( b1.x * .55 + b1.z * 1.9 ) + env( r, p ) * mix( amb * .5 + silver * .4, vec3( 1. ), fr ) * 1.1;
      col += pHex( 138., 186., 211. ) * exp( - pow( ( ndv - .52 + .14 * mNoise( wf * 2. ) ) * 4.2, 2. ) ) * .35;
    } else if ( id == 21 ) {   // heliodor: boiling granulation and writhing currents in deep purple and scarlet-amber with a moving cat's-eye ray
      vec3 wf = pFlow( q, t * .85 );
      vec2 g = mCells( wf * 5.2 + vec3( 0., t * .18, 0. ) ); float gran = smoothstep( 0., .38, g.y - g.x ), scaleRim = smoothstep( .07, 0., g.y - g.x );
      float serp = smoothstep( .28, .74, mFbm( wf * 2.4 - sn * t * .3 ) );
      vec3 hel = pHex( 212., 245., 22. ), pur = pHex( 74., 0., 92. ), ramb = pHex( 224., 90., 20. ), gry = pHex( 122., 126., 138. ), gold = pHex( 255., 210., 0. );
      vec3 tang = normalize( cross( n, normalize( vec3( .25, 1., -.2 ) + .35 * ( wf - q ) ) ) );
      float eye = exp( - pow( dot( tang, normalize( l - rd ) ) * 6.2, 2. ) );
      float inner = exp( - pThick( p, refract( rd, n, .8 ) ) * 1.05 );
      vec3 plasma = mix( pur * .85, mix( ramb, mix( gold, hel, gran ), serp ), .45 + .55 * inner );
      col = mix( plasma, gry * .45, ( 1. - dif ) * .25 * ( 1. - serp ) ) * ( .35 + .85 * dif + .55 * uBeatPulse ) + mix( hel, gold, .5 ) * ( eye * ( 1.6 + 1.1 * uAro ) + scaleRim * serp * .85 ) + env( r, p ) * fr * .85;
    } else if ( id == 22 ) {   // peridot: translucent olive earth under a plum-slate veil, a blazing light inside, wandering sparks and quicksilver veins
      vec3 rf = refract( rd, n, .66 ); float th = pThick( p, rf );
      vec3 wf = pFlow( q + rf * .18, t * .6 );
      vec3 per = pHex( 141., 182., 0. ), slt = pHex( 104., 118., 138. ), ggry = pHex( 78., 110., 88. ), plm = pHex( 107., 29., 74. ), moss = pHex( 38., 92., 58. );
      float patchM = mFbm( wf * 2.5 ), cloak = smoothstep( .15, .85, ( 1. - ndv ) + .35 * ( mFbm( wf * 1.9 + 5. ) - .5 ) );
      vec3 earth = mix( mix( moss, per, smoothstep( .25, .78, patchM ) ), mix( ggry, slt, mFbm( wf * 3.8 ) ), .38 );
      earth = mix( earth, plm * ( .75 + .5 * mFbm( wf * 3. ) ), cloak * .62 );
      // the inner lantern & primordial flame-seeds (yod sparks) + mercurial quicksilver nerve-filaments
      float lantern = mCoreAlong( p, rf ) * 1.4 + exp( - th * 1.35 ) * .65;
      vec2 sd = mCells( wf * 4.6 - vec3( 0., t * .32, 0. ) );
      float yodSeed = smoothstep( .15, .02, sd.x ) * smoothstep( .42, .75, mFbm( wf * 2.2 + 3. ) );
      float nerve = pow( 1. - abs( 2. * mFbm( wf * 4.2 + 7. ) - 1. ), 16. ) * ( .45 + .55 * sin( t * 5. + sd.y * 9. ) );
      vec3 flameCol = mix( pHex( 255., 195., 45. ), vec3( 1., .98, .88 ), clamp( lantern * .6 + yodSeed, 0., 1. ) );
      vec3 opal = film( ndv * 3.5 + patchM * 2.5 + t * .15 );
      col = earth * ( .22 + .72 * dif + .45 * exp( - th * 1.1 ) ) + flameCol * ( lantern * ( 1.1 + .9 * uGlow + .6 * uBeatPulse ) + yodSeed * ( 1.8 + 1.4 * uAro ) );
      col += mix( vec3( .88, .94, 1. ), opal, .4 ) * nerve * ( .65 + 1.3 * uAro + .8 * uBeatPulse ) + env( r, p ) * mix( slt * .5 + plm * .3, vec3( 1. ), fr ) * .95;
    } else if ( id == 23 ) {   // jade: poised emerald and ultramarine crystal planes with warm copper glints and a pale-green feathered sheen
      vec3 wf = pFlow( q, t * .5 );
      vec2 cr = mCells( wf * 3.1 ); float plane = clamp( cr.y - cr.x, 0., 1. ), edge = smoothstep( .045, 0., cr.y - cr.x );
      float bal = smoothstep( -.25, .25, mFbm( wf * 2.1 ) - .5 + .2 * dot( sn, vec3( sin( t * .2 ), cos( t * .2 ), 0. ) ) );
      vec3 em = pHex( 0., 179., 89. ), blu = pHex( 13., 58., 168. ), bg = pHex( 15., 118., 110. ), pal = pHex( 124., 232., 158. ), cu = vec3( .955, .638, .538 );
      float wrap = max( 0., ( dot( n, l ) + .45 ) / 1.45 ), core = mCoreAlong( p, refract( rd, n, .65 ) );
      vec3 gem = mix( mix( em, bg, plane ), blu, bal * .68 );
      col = gem * ( .24 + .78 * wrap + .65 * core ) + mix( pal, cu, .45 ) * edge * ( .75 + .9 * uBeatPulse ) + pal * pow( 1. - ndv, 2.4 ) * .55 + env( normalize( mix( r, n, .15 * plane ) ), p ) * mix( cu * .45 + pal * .35, vec3( 1. ), fr ) * 1.05;
    } else if ( id == 24 ) {   // malachite: abyssal dark water and obsidian, drifting peacock iridescence, red embers and swimming glowing currents
      vec3 rf = refract( rd, n, .75 ); float th = pThick( p, rf );
      vec3 wf = pFlow( q + rf * th * .35, t * .6 );
      float flow = mFbm( wf * 2.6 + vec3( 0., t * .15, 0. ) ), ridge = 1. - abs( 2. * mFbm( wf * 3.4 + 2. ) - 1. );
      vec3 gb = pHex( 0., 158., 142. ), brn = pHex( 94., 66., 47. ), dk = pHex( 18., 12., 10. ), liv = pHex( 50., 30., 70. ), mars = pHex( 190., 22., 28. );
      vec3 iri = mix( gb * 1.35, mix( liv * 1.8, film( ndv * 2.2 + flow * 1.6 + t * .08 ), .45 ), smoothstep( .2, .85, ( 1. - ndv ) + .35 * ( flow - .5 ) ) );
      float swim = pow( ridge, 10. ) * smoothstep( .35, .8, mFbm( wf * 2. - t * .4 ) );
      vec3 b1 = mBubbles( mBubbleFlow( q, t * .7 ) * 4.4, normalize( l - rd ) );
      vec3 deep = mix( dk * .35, mix( brn * .55, liv * .75, flow ), exp( - th * 1.1 ) );
      col = deep * ( .2 + .75 * dif ) + mix( gb, vec3( .7, 1., .92 ), .45 ) * ( swim * ( 1.3 + 1.2 * uAro ) + b1.x * .45 ) + mars * pow( ridge, 7. ) * ( .35 + 1.4 * uKick + .7 * uBeatPulse ) + env( r, p ) * mix( iri, vec3( 1. ), fr ) * 1.1;
    } else if ( id == 25 ) {   // lazuli: swirling lapis-blue water and molten gold fire fusing into emerald glass, a rainbow arc across it
      vec3 rf = refract( rd, n, .74 ); float th = pThick( p, rf );
      vec3 wf = pFlow( q, t * 1.05 );
      float fA = mFbm( wf * 2.3 + vec3( 0., - t * .28, 0. ) ), fB = mFbm( wf * 2.5 + 8.3 + vec3( t * .2, 0., 0. ) );
      float fuse = exp( - pow( ( fA - fB ) * 5.5, 2. ) ), bal = smoothstep( -.22, .22, fA - fB );
      vec3 blu = pHex( 10., 72., 224. ), dblu = pHex( 20., 36., 138. ), yel = pHex( 255., 208., 0. ), grn = pHex( 0., 184., 92. ), fire = pHex( 255., 95., 15. );
      vec3 vessel = mix( mix( dblu, blu, fA ), mix( fire, yel, fB ), bal );
      vessel = mix( vessel, grn * 1.25, fuse * .78 );   // blue water + yellow fire -> emerald stone in the mixing zone
      vec3 rbow = film( ndv * 1.8 + ( fA - fB ) * 1.4 - t * .08 );
      float arc = exp( - pow( ( ndv - .48 + .18 * ( fA - .5 ) ) * 4.5, 2. ) );
      col = vessel * ( .28 + .75 * dif + .55 * exp( - th * .95 ) ) + rbow * arc * ( .75 + .85 * uGlow + .6 * uBeatPulse ) + yel * smoothstep( .83, .92, mNoise( wf * 42. ) ) * 1.8 + env( r, p ) * mix( grn * .4 + yel * .4, vec3( 1. ), fr ) * .85;
    } else if ( id == 26 ) {   // basalt: faceted black and indigo stone with magma veins and a golden-crimson iris
      vec3 wf = pFlow( q, t * .45 );
      vec2 hex = mCells( wf * 4.4 ); float groove = smoothstep( .055, 0., hex.y - hex.x ), facet = smoothstep( 0., .28, hex.y - hex.x );
      vec3 ind = pHex( 34., 10., 120. ), blk = vec3( .018, .018, .03 ), gry = pHex( 37., 40., 48. ), mars = pHex( 217., 30., 24. ), gold = pHex( 235., 175., 35. );
      // an iris at the centre of the visible face, opening and closing with the music
      float gaze = clamp( dot( normalize( n + .14 * ( wf - q ) ), - rd ), 0., 1. );
      float pupil = smoothstep( .94, .975, gaze ), iris = smoothstep( .78, .92, gaze ) * ( 1. - pupil );
      float irisFib = .5 + .5 * sin( atan( wf.y, wf.x ) * 18. + mFbm( wf * 6. ) * 5. );
      vec3 stone = mix( blk, mix( gry, ind * .6, mFbm( wf * 2.5 ) ), facet * .75 ) * ( .2 + .8 * dif );
      stone += mix( ind, mars, smoothstep( .35, .8, mFbm( wf * 3. + t * .2 ) ) * ( .4 + .6 * uAro + uKick ) ) * groove * ( .9 + 1.3 * uAro + .8 * uBeatPulse );
      vec3 eyeCol = mix( mars, gold, irisFib ) * ( 1.3 + 1.1 * uBeatPulse + .8 * uGlow );
      vec3 disp = film( ndv * 4.5 + hex.x * 2.5 );
      col = mix( stone, eyeCol, iris * .88 ) * ( 1. - .92 * pupil ) + env( r, p ) * mix( ind * .7, mix( vec3( 1. ), disp * 1.4, .45 ), fr ) * 1.1;
    } else if ( id == 27 ) {   // amethyst: a translucent violet and sky-blue nebula with an eight-pointed star and falling silver dew
      vec3 wf = pFlow( q, t * .75 );
      float neb = mFbm( wf * 2.2 - vec3( 0., t * .24, 0. ) ), cur = mFbm( wf * 3.6 + neb * 1.7 );
      vec3 vio = pHex( 123., 31., 162. ), sky = pHex( 100., 181., 246. ), mau = pHex( 142., 107., 191. ), wht = pHex( 240., 220., 247. );
      vec2 stUV = n.xy + .12 * ( wf.xy - q.xy ); float ang = atan( stUV.y, stUV.x ), rad = length( stUV );
      float star8 = ( pow( abs( cos( ang * 4. + t * .15 ) ), 14. ) + pow( abs( cos( ang * 4. + .7854 + t * .15 ) ), 18. ) * .65 ) * exp( - rad * 2.8 ) * smoothstep( .15, .85, ndv );
      float dew = smoothstep( .83, .93, mNoise( wf * 38. + vec3( 0., t * 1.4, 0. ) ) );
      float core = mCoreAlong( p, refract( rd, n, .67 ) );
      vec3 body = mix( mix( vio, mau, neb ), mix( sky, wht, smoothstep( .35, .8, cur ) ), .42 + .38 * ( 1. - ndv ) );
      col = body * ( .26 + .68 * dif + .7 * core ) + wht * ( star8 * ( 1.6 + 1.2 * uGlow + .9 * uBeatPulse ) + dew * ( 1.4 + uAro ) ) + env( r, p ) * ( .08 + .92 * fr );
      a = clamp( .78 + .18 * cur + .2 * star8 - .25 * pow( 1. - ndv, 1.7 ), .38, .98 );
    } else if ( id == 28 ) {   // selenite: deep ultraviolet-crimson and midnight water with floating pearl moonstone clouds round a hidden golden core
      vec3 rf = refract( rd, n, .75 ); float th = pThick( p, rf );
      vec3 wf = pFlow( q + rf * th * .4, t * .5 );
      float tide = mFbm( wf * 2.3 + vec3( 0., t * .14, 0. ) ), veil = mFbm( wf * 3.9 - tide * 1.4 );
      vec3 crim = pHex( 143., 0., 66. ), buff = pHex( 235., 220., 194. ), pnk = pHex( 201., 140., 167. ), stn = pHex( 143., 136., 128. ), sea = pHex( 25., 168., 124. ), gold = pHex( 255., 183., 43. );
      vec3 tang = normalize( cross( n, normalize( vec3( .2, 1., -.15 ) + .4 * ( wf - q ) ) ) );
      float chat = exp( - pow( dot( normalize( l - rd ), tang ) * 5.8, 2. ) );
      float scarab = mCoreAlong( p, rf ) * exp( - th * .85 );
      vec3 b1 = mBubbles( mBubbleFlow( q, t * .65 ) * 4., normalize( l - rd ) );
      vec3 ocean = mix( mix( crim * .85, pnk, smoothstep( .28, .78, tide ) ), mix( sea * .75, stn, veil ), .35 * ( 1. - exp( - th ) ) );
      col = ocean * ( .22 + .7 * dif + .4 * exp( - th * .9 ) ) + mix( buff, pnk, .3 ) * chat * ( .95 + .8 * uGlow ) + gold * scarab * ( 1.1 + .8 * uBeatPulse ) + buff * ( b1.x * .45 + b1.z * 1.5 ) + env( r, p ) * mix( buff * .5 + crim * .3, vec3( 1. ), fr ) * .85;
    } else if ( id == 29 ) {   // diamond: pure white brilliance, a crystalline point at the core, white-gold flecks and a prism halo
      vec3 wf = pFlow( q, t * .7 );
      float core = mCoreAlong( p, refract( rd, n, .65 ) );
      float crown = pow( max( 0., dot( n, normalize( vec3( 0., 1., .2 ) + .2 * ( wf - q ) ) ) ), 3.5 );
      float fleck = smoothstep( .82, .93, mNoise( wf * 44. + t * .5 ) );
      vec3 wht = vec3( 1., 1., 1. ), wgold = pHex( 255., 246., 214. ), disp = film( ndv * 3.8 + mFbm( wf * 2.5 ) * 1.6 - t * .1 );
      col = mix( wht * .92, wgold, .25 + .35 * mFbm( wf * 2.2 ) ) * ( .42 + .65 * dif + 1.15 * core * ( 1. + .6 * uGlow ) ) + wgold * fleck * ( 1.6 + uBeatPulse ) + disp * pow( 1. - ndv, 2.4 ) * .65 + env( r, p ) * ( .25 + .95 * fr + .35 * crown );
      a = clamp( .84 + .16 * core - .2 * pow( 1. - ndv, 1.8 ), .48, .99 );
    } else if ( id == 30 ) {   // star sapphire: a soft sky-blue and pearl-grey spiral galaxy flecked with ruby, sapphire and gold
      vec3 wf = pFlow( q, t * .85 );
      float ang = atan( wf.z, wf.x ) + length( wf.xz ) * 4.5 - t * .45;
      float arm = pow( .5 + .5 * cos( ang * 2. + mFbm( wf * 2.8 ) * 3.2 ), 3. );
      vec3 sky = pHex( 100., 181., 246. ), prl = pHex( 207., 216., 232. ), gry = pHex( 142., 153., 168. ), rub = pHex( 235., 35., 75. ), sap = pHex( 25., 95., 255. ), gld = pHex( 255., 215., 70. );
      float stR = smoothstep( .84, .93, mNoise( wf * 38. + 1.7 ) ), stB = smoothstep( .84, .93, mNoise( wf * 41. + 5.3 ) ), stG = smoothstep( .85, .94, mNoise( wf * 45. + 9.1 ) );
      vec3 body = mix( mix( gry * .75, sky, mFbm( wf * 2.2 ) ), prl * 1.15, arm * .75 );
      col = body * ( .26 + .74 * dif ) + ( rub * stR + sap * stB + gld * stG ) * ( 1.7 + 1.2 * uAro + uBeatPulse ) + env( r, p ) * mix( prl, vec3( 1. ), fr ) * .95;
    } else if ( id == 31 ) {   // crimson sea: a deep black-indigo sea round a glowing crimson and dark-brown hollow, flecked with rose
      vec3 rf = refract( rd, n, .75 ); float th = pThick( p, rf );
      vec3 wf = pFlow( q + rf * th * .35, t * .42 );
      vec2 hex = mCells( wf * 3.8 ); float rim = smoothstep( .07, 0., hex.y - hex.x );
      vec3 crim = pHex( 184., 15., 58. ), blk = pHex( 10., 10., 16. ), brn = pHex( 59., 31., 26. ), pnk = pHex( 216., 167., 184. );
      float core = mCoreAlong( p, rf ) * exp( - th * .85 ), fleck = smoothstep( .83, .92, mNoise( wf * 36. ) );
      vec3 sea = mix( blk, mix( brn, crim, smoothstep( .28, .78, mFbm( wf * 2.4 ) ) ), .42 * exp( - th * .9 ) + .48 * core );
      col = sea * ( .22 + .75 * dif ) + crim * ( core * ( 1.1 + .8 * uGlow ) + rim * .55 ) + pnk * ( fleck * 1.4 + rim * .4 * uBeatPulse ) + env( r, p ) * mix( crim * .35 + pnk * .25, vec3( 1. ), fr ) * .95;
    } else if ( id == 32 ) {   // royal amethyst: deep violet and sapphire-blue crystal planes with golden rays inside
      vec3 wf = pFlow( q, t * .55 );
      vec2 c4 = mCells( wf * 3.6 ); float edge = smoothstep( .065, 0., c4.y - c4.x ), plane = smoothstep( 0., .3, c4.y - c4.x );
      vec3 vio = pHex( 94., 23., 235. ), blu = pHex( 26., 86., 255. ), pur = pHex( 106., 13., 173. ), gld = pHex( 255., 215., 0. );
      float core = mCoreAlong( p, refract( rd, n, .72 ) );
      vec3 gem = mix( mix( pur, vio, mFbm( wf * 2.3 ) ), blu * 1.15, plane * ( .35 + .65 * ( 1. - ndv ) ) );
      col = gem * ( .26 + .74 * dif + .55 * core ) + gld * ( edge * ( .95 + .9 * uGlow + .7 * uBeatPulse ) + core * .55 ) + env( r, p ) * mix( blu * .65 + gld * .35, vec3( 1. ), fr ) * 1.05;
    } else if ( id == 33 ) {   // ruby iron: a five-sided furnace of scarlet-orange plasma cut by dark iron cleavage
      vec3 wf = pFlow( q, t * 1.15 );
      vec2 c5 = mCells( wf * 4.5 ); float seam = smoothstep( .075, 0., c5.y - c5.x ), plate = smoothstep( .04, .24, c5.y - c5.x );
      vec3 org = pHex( 255., 98., 0. ), scr = pHex( 230., 25., 25. ), cri = pHex( 208., 0., 27. ), blk = vec3( .02, .015, .018 );
      float heat = smoothstep( .25, .82, mFbm( wf * 3.1 - vec3( 0., t * .6, 0. ) ) );
      vec3 iron = mix( blk, mix( cri, scr, heat ), plate * .55 );
      vec3 forge = mix( scr, org * 1.35, heat ) * ( seam * ( 1.4 + 1.5 * uKick + uAro ) + .45 * pow( heat, 2.5 ) );
      col = iron * ( .2 + .78 * dif ) + forge + env( r, p ) * mix( scr, vec3( 1., .82, .55 ), fr ) * .9;
    } else if ( id == 34 ) {   // rose gold: clear rose, salmon and gold-amber crystal round a six-rayed golden heart and a six-fold lattice
      vec3 rf = refract( rd, n, .72 ); float th = pThick( p, rf );
      vec3 wf = pFlow( q, t * .65 );
      vec2 uv6 = n.xy + .12 * ( wf.xy - q.xy ); float ang6 = atan( uv6.y, uv6.x ), rad6 = length( uv6 );
      float star6 = pow( abs( cos( ang6 * 3. + t * .18 ) ), 10. ) * exp( - rad6 * 2.2 ) * smoothstep( .15, .88, ndv );
      float grid6 = max( exp( - pow( sin( wf.x * 18.85 ) * 5.5, 2. ) ), exp( - pow( sin( wf.y * 18.85 ) * 5.5, 2. ) ) ) * smoothstep( .35, .85, mFbm( wf * 2.5 ) );
      vec3 rse = pHex( 255., 141., 161. ), gld = pHex( 255., 215., 0. ), sal = pHex( 250., 114., 82. ), amb = pHex( 245., 166., 35. );
      float core = mCoreAlong( p, rf );
      vec3 body = mix( mix( rse, sal, mFbm( wf * 2.2 ) ), amb, .4 + .4 * core );
      col = body * ( .28 + .72 * dif + .85 * exp( - th * .9 ) ) + gld * ( ( star6 + core * .85 ) * ( 1.35 + .95 * uGlow + .8 * uBeatPulse ) + grid6 * .45 ) + env( r, p ) * mix( gld * .7 + rse * .3, vec3( 1. ), fr );
      a = clamp( .82 + .15 * star6 - .2 * pow( 1. - ndv, 1.7 ), .45, .98 );
    } else if ( id == 35 ) {   // emerald amber: living amber, emerald and yellow-green prism glass with olive and gold flecks
      vec3 rf = refract( rd, n, .74 ); float th = pThick( p, rf );
      vec3 wf = pFlow( q + rf * th * .3, t * .75 );
      float bloom = mFbm( wf * 2.4 + vec3( 0., t * .2, 0. ) ), petal = mFbm( wf * 3.8 - bloom * 1.5 );
      vec3 amb = pHex( 255., 179., 25. ), eme = pHex( 0., 184., 98. ), ygr = pHex( 168., 224., 36. ), olv = pHex( 107., 142., 35. ), gld = pHex( 255., 218., 65. );
      float fleck = smoothstep( .82, .92, mNoise( wf * 38. ) );
      vec3 glass = mix( mix( olv, eme, bloom ), mix( ygr, amb, smoothstep( .3, .78, petal ) ), .48 + .35 * ( 1. - ndv ) );
      col = glass * ( .26 + .74 * dif + .55 * exp( - th ) ) + gld * fleck * ( 1.5 + .9 * uBeatPulse + .6 * uGlow ) + env( r, p ) * mix( eme * .5 + amb * .5, vec3( 1. ), fr ) * .95;
    } else if ( id == 36 ) {   // opal lattice: a violet, orange and russet interference lattice flickering with white sparks
      vec3 wf = pFlow( q, t * 1.2 );
      float w1 = sin( wf.x * 14. + wf.y * 9. - t * 2.4 ), w2 = sin( wf.y * 15. - wf.z * 11. + t * 2.1 ), w3 = sin( wf.z * 13. + wf.x * 10. - t * 1.8 );
      float cym = smoothstep( .45, .92, abs( w1 + w2 + w3 ) / 3. );
      vec3 vio = pHex( 123., 31., 162. ), org = pHex( 255., 123., 0. ), rus = pHex( 168., 56., 32. ), ybr = pHex( 212., 160., 86. );
      float spark = smoothstep( .84, .94, mNoise( wf * 44. + t * 2.5 ) );
      vec3 body = mix( mix( vio, rus, mFbm( wf * 2.5 ) ), mix( org, ybr, cym ), .45 + .4 * cym );
      col = body * ( .25 + .75 * dif ) + mix( org, vec3( 1. ), .65 ) * ( pow( cym, 4. ) * ( .85 + .9 * uAro ) + spark * ( 1.6 + uHat * 1.5 ) ) + env( r, p ) * mix( org * .5 + vio * .5, vec3( 1. ), fr ) * 1.05;
    } else if ( id == 37 ) {   // violet quartz: a deep indigo and violet moonstone mirror with citrine and azure flecks over silver tides
      vec3 rf = refract( rd, n, .75 ); float th = pThick( p, rf );
      vec3 wf = pFlow( q + rf * th * .35, t * .6 );
      float tide = mFbm( wf * 2.3 + vec3( 0., t * .18, 0. ) );
      vec3 ind = pHex( 40., 16., 120. ), vio = pHex( 138., 43., 226. ), dpr = pHex( 42., 10., 74. ), cit = pHex( 228., 208., 10. ), azu = pHex( 55., 155., 255. );
      vec3 tang = normalize( cross( n, normalize( vec3( .25, 1., .1 ) + .35 * ( wf - q ) ) ) );
      float sheen = exp( - pow( dot( normalize( l - rd ), tang ) * 5.5, 2. ) );
      float flC = smoothstep( .83, .93, mNoise( wf * 39. + 2.1 ) ), flA = smoothstep( .83, .93, mNoise( wf * 42. + 6.7 ) );
      vec3 base = mix( dpr, mix( ind, vio, tide ), .55 + .35 * exp( - th * .9 ) );
      col = base * ( .24 + .74 * dif ) + mix( vio, vec3( .88, .92, 1. ), .55 ) * sheen * ( 1.05 + .85 * uBeatPulse ) + ( cit * flC + azu * flA ) * ( 1.5 + .8 * uGlow ) + env( r, p ) * mix( vio * .6, vec3( 1. ), fr );
    } else {   // fourfold earth: four warped quarters of citrine, olive, russet and black, rayed and flecked with gold
      vec3 wf = pFlow( q, t * .5 );
      float qx = smoothstep( -.18, .18, wf.x + .22 * ( mFbm( wf * 2.4 ) - .5 ) );
      float qz = smoothstep( -.18, .18, wf.z + .22 * ( mFbm( wf * 2.4 + 4.7 ) - .5 ) );
      vec3 cit = pHex( 228., 208., 10. ), olv = pHex( 94., 122., 30. ), rus = pHex( 166., 58., 34. ), blk = pHex( 20., 16., 22. ), gld = pHex( 255., 215., 0. );
      vec3 four = mix( mix( cit, olv, qx ), mix( rus, blk, qx ), qz );
      float border = exp( - pow( ( qx - .5 ) * 7., 2. ) ) + exp( - pow( ( qz - .5 ) * 7., 2. ) );
      float fleck = smoothstep( .81, .92, mNoise( wf * 40. ) );
      col = four * ( .26 + .76 * dif ) + gld * ( border * .55 * ( .7 + uGlow ) + fleck * ( 1.55 + uBeatPulse + .8 * uKick ) ) + env( r, p ) * mix( four + gld * .25, vec3( 1. ), fr ) * .85;
    }
    // the light's four casts (uCast, lightCast() in materials.mjs: x radiant core, y reflective, z sharp contrast, w gold flecks)
    float wCore = mCoreAlong( p, rd ), wFleck = smoothstep( .84, .94, mNoise( q * 46. + t * .3 ) );
    col += col * ( .28 * uCast.x * wCore * ( .5 + uGlow ) ) + env( r, p ) * ( .18 * uCast.y * fr ) + pHex( 255., 225., 130. ) * ( .32 * uCast.w * wFleck );
    col = mix( col, pow( max( col, 0. ), vec3( 1.12 ) ) * 1.08, .35 * uCast.z );
    col = col / ( 1. + col * .45 ); col = pow( max( col, 0. ), vec3( .4545 ) );   // lit in linear light like the prototype, written in the page's display values
    return vec4( col, a );
  }
  vec4 matShade( int id, vec3 p, vec3 n, vec3 rd, vec2 pat, vec4 moS, vec3 songC, vec3 songC0, vec3 f0m ) {
    if ( ( uProp > .5 && id >= 6 ) || id >= 17 ) return propShade( id, p, n, rd );   // proposed elements and metals, the stones and the gems
    vec3 v = - rd, r = reflect( rd, n ), sn = normalize( p );
    float ndv = max( dot( n, v ), 0. ), fres = pow( 1. - ndv, 5. ) * uRimK, dist = length( p ), dif = max( dot( n, normalize( - p ) ), 0. );
    vec3 accent = uStainM, col = vec3( 0. ); float a = 1.;
    if ( id == 0 ) {   // liquid metal: the original, pigmented by the remembered song
      col = env( r, p ) * mix( f0m, vec3( 1. ), fres ) + uLight * f0m * dif * uGlow * 1.4 / ( 1. + dist * dist * 6. ) + f0m * ( .5 + .5 * n.y ) * .07;
      col = mix( col, col * .55 + songC * ( .35 + .5 * dif + .25 * uGlow ), .7 * uSongAmt );
    } else if ( id == 1 ) {   // glass: a reflection, and the inner light seen through it
      vec3 rr = refract( rd, n, .7 ); float coreSeen = mCoreAlong( p, rr );
      vec3 tint = mix( vec3( 1. ), songC0 * 1.4 + .1, .65 ) * ( 1. - .5 * pat.x * uSongAmt );
      col = env( r, p ) * ( .06 + .94 * fres ) * 1.2 + tint * ( uLight * coreSeen * ( .25 + uGlow * .55 ) + env( rr, p ) * .22 ) * ( .55 + .45 * pat.x ) + accent * pat.y * .3;
    } else if ( id == 2 ) {   // velvet flesh: light wrapping round from inside, a sheen at grazing angles
      float wrap = max( 0., ( dif + .5 ) / 1.5 ); vec3 alb = mix( vec3( .5, .32, .38 ), songC * 1.2, .8 * uSongAmt + .2 );
      col = alb * ( .14 + .95 * wrap * uLight * ( .45 + uGlow ) ) + pow( 1. - ndv, 2.5 ) * mix( alb, vec3( 1. ), .55 ) * .75;
    } else if ( id == 3 ) {   // obsidian: a black mirror where only the pattern's edges catch light
      col = env( r, p ) * mix( .03, 1., fres ) * vec3( .85, .9, 1. ) + accent * pat.y * .45;
    } else if ( id == 4 ) {   // iridescent film over the pattern
      col = env( r, p ) * ( film( ndv * 1.8 + pat.x * .8 + uTime * .04 ) * .9 + .1 ) + film( pat.x + ndv ) * dif * uGlow * .35;
    } else if ( id == 5 ) {   // fluorescent: a specimen under the microscope, dark tissue lit only by its stains
      float memM = max( pat.y, moS.g * min( uMorphA, 1. ) ), nucM = moS.b * min( uMorphA, 1. ), orgM = moS.a * min( uMorphA, 1. );
      col = uStainC * ( .4 + .6 * pat.x * ( 1. - memM ) ) + uStainM * memM * ( .7 + .8 * uGlow + .6 * uBeatPulse ) + uStainN * nucM * ( .6 + .7 * uGlow ) + uStainO * orgM * ( .8 + .9 * uGlow + .4 * uBeatPulse ) + env( r, p ) * fres * .18;
      float m = max( max( col.r, col.g ), col.b ) + 1e-4; col *= ( 1. - exp( - m * 1.3 ) ) / m;   // a soft knee that keeps the hue
    } else if ( id == 6 ) {   // fire: a crust of embers with flame rising through it, hottest at its edges and on the beat
      vec3 q = sn * 2.4; q.y -= uTime * .75;
      q += .7 * vec3( mNoise( q * 1.3 + uTime * .4 ), mNoise( q * 1.3 + 7.1 - uTime * .3 ), mNoise( q * 1.3 + 13.7 ) ) - .35;
      float heat = mFbm( q * 1.7 ) * ( .8 + .45 * pat.y ) + .22 * uBeatPulse + .25 * uKick + .45 * pow( 1. - ndv, 1.6 ) - .08;
      float burn = smoothstep( .42, .6, heat );
      col = mix( env( r, p ) * .06 * vec3( 1., .8, .7 ) + vec3( .035, .018, .012 ), mBlackbody( heat * 1.25 ) * ( 1.1 + .9 * uGlow ), burn );
    } else if ( id == 7 ) {   // water: deep and clear, rippling, caustic light playing in it
      vec3 n2 = mRipple( p, n, 9., 1., .16 ), r2 = reflect( rd, n2 ); float f2 = .02 + .98 * pow( 1. - max( dot( n2, v ), 0. ), 5. );
      vec3 rr = refract( rd, n2, .75 ); float seen = mCoreAlong( p, rr );
      float ca = sin( sn.x * 13. + uTime * .9 + sin( sn.y * 7. ) ) + sin( sn.y * 11. - uTime * .7 + sin( sn.z * 9. ) ) + sin( sn.z * 12. + uTime * .8 + sin( sn.x * 6. ) );
      float caus = pow( smoothstep( 1.1, 0., abs( ca ) ), 3. );
      vec3 deep = vec3( .01, .13, .2 ), shallow = vec3( .1, .55, .62 );
      col = env( r2, p ) * f2 * 1.25 + mix( deep, shallow, .35 * ( 1. - ndv ) + .5 * seen ) * ( .3 + uGlow * .6 ) + uLight * seen * .45 * uGlow + shallow * caus * ( .25 + .45 * uGlow );
      { vec3 bL = normalize( normalize( vec3( -.48, .62, .62 ) ) - rd ), bq = mBubbleFlow( p / uShellR, uTime );
        vec3 b1 = mBubbles( bq * 4.6, bL );
        col = col * ( 1. - .4 * b1.y ) + vec3( .75, .95, 1. ) * b1.x * .68 + vec3( 1. ) * b1.z * 1.55 + shallow * b1.y * .15; }
    } else if ( id == 8 ) {   // air: almost nothing; wind-drawn wisps, a bright rim, the world and the inner light through it
      vec3 wq = sn * 2.6 + vec3( uTime * .55, uTime * .08, uTime * .21 );
      float wisp = smoothstep( .48, .82, mFbm( vec3( wq.x * .55, wq.y * 2.8, wq.z * .55 ) + .6 * mNoise( wq * 1.9 ) ) );
      float rim = pow( 1. - ndv, 2.2 ), seen = mCoreAlong( p, rd );
      col = env( r, p ) * fres * .7 + vec3( 1., .98, .86 ) * ( rim * .55 + wisp * .5 ) * ( .35 + .65 * uGlow ) + uLight * seen * .35 * uGlow;
      a = clamp( .12 + .6 * rim + .45 * wisp + .5 * seen, 0., 1. );
    } else if ( id == 9 ) {   // earth: matte stone in strata of four soil colours (citrine, olive, russet, black), with mineral glints
      float s = dot( p, normalize( vec3( .3, 1., .2 ) ) ) * 8. + 1.8 * mFbm( p * 2.3 + 4. );
      float band = fract( s * .25 ) * 4.; int bi = int( band );
      vec3 c0 = bi == 0 ? vec3( .72, .62, .24 ) : bi == 1 ? vec3( .38, .39, .17 ) : bi == 2 ? vec3( .46, .2, .11 ) : vec3( .07, .06, .05 );
      vec3 c1 = bi == 0 ? vec3( .38, .39, .17 ) : bi == 1 ? vec3( .46, .2, .11 ) : bi == 2 ? vec3( .07, .06, .05 ) : vec3( .72, .62, .24 );
      vec3 alb = mix( c0, c1, smoothstep( .8, 1., fract( band ) ) ) * ( .7 + .6 * mNoise( p * 38. ) ) * ( .75 + .5 * pat.x );
      float glint = step( .992, hash3( floor( p * 70. ) ) ) * pow( max( dot( r, normalize( vec3( -.4, .8, .5 ) ) ), 0. ), 6. );
      col = alb * ( .16 + .5 * ( .5 + .5 * n.y ) + dif * uLight * ( .45 + uGlow ) * .9 ) + env( r, p ) * fres * .12 + vec3( 1. ) * glint * 2.;
    } else if ( id == 10 ) {   // Saturn, lead: dull, heavy, a grey with indigo in its shadows, ringed by fine bands
      vec3 f0 = vec3( .47, .48, .52 ), rR = normalize( mix( r, n, .55 ) );
      float y = dot( sn, normalize( vec3( .25, 1., -.1 ) ) ), rings = ( .5 + .5 * sin( y * 70. ) ) * smoothstep( .32, .04, abs( y ) );
      col = env( rR, p ) * mix( f0, vec3( 1. ), fres ) * .75 * ( .8 + .4 * mNoise( p * 9. ) ) + uLight * f0 * dif * uGlow * .5;
      col = mix( col, col * .45 + vec3( .1, .06, .3 ) * .25, rings * .8 ) + vec3( .75, .72, .8 ) * pow( rings, 6. ) * .25 * ( .5 + uGlow ) + vec3( .16, .08, .4 ) * pow( 1. - ndv, 3. ) * .3;
    } else if ( id == 11 ) {   // Jupiter, tin: a gas giant's zonal bands, turning at their own speeds, under a tin glaze
      float lat = sn.y, ang = uTime * .05 * sin( lat * 11. ); vec3 q = vec3( cos( ang ) * sn.x - sin( ang ) * sn.z, sn.y, sin( ang ) * sn.x + cos( ang ) * sn.z );
      float l2 = lat + .07 * ( mFbm( q * vec3( 3., 7., 3. ) ) - .5 ), b = .5 + .5 * sin( l2 * 23. );
      vec3 alb = mix( mix( vec3( .45, .28, .18 ), vec3( .8, .58, .34 ), b ), vec3( .95, .9, .8 ), smoothstep( .7, 1., b ) );
      vec3 spotC = normalize( vec3( cos( uTime * .03 ), -.35, sin( uTime * .03 ) ) ); float spot = smoothstep( .16, .06, length( ( sn - spotC ) * vec3( 1., 1.8, 1. ) ) );
      alb = mix( alb, vec3( .72, .3, .17 ), spot * .85 );
      col = alb * ( .35 + .45 * ( .5 + .5 * n.y ) + dif * mix( uLight, vec3( 1., .9, .75 ), .6 ) * ( .4 + uGlow ) ) + env( r, p ) * mix( vec3( .8, .82, .88 ) * .3, vec3( 1. ), fres ) * .45 + vec3( .5, .2, .9 ) * pow( 1. - ndv, 3. ) * .2;
    } else if ( id == 12 ) {   // Mars, iron: raw iron rusting in patches, its edges forge-hot on the beat
      vec3 f0 = vec3( .56, .57, .58 );
      float rust = smoothstep( .45, .62, mFbm( p * 3.1 + 3. ) + .3 * ( 1. - pat.x ) );
      vec3 ralb = mix( vec3( .55, .17, .06 ), vec3( .8, .36, .12 ), mNoise( p * 14. ) );
      vec3 iron = env( r, p ) * mix( f0, vec3( 1. ), fres ) + uLight * f0 * dif * uGlow * .7;
      col = mix( iron, ralb * ( .28 + .5 * ( .5 + .5 * n.y ) + .85 * dif * mix( uLight, vec3( 1., .8, .6 ), .5 ) * ( .4 + uGlow ) ) + env( r, p ) * fres * .06, rust );
      float hot = pat.y * ( .25 + .9 * uBeatPulse + .8 * uKick ) + .15 * pow( 1. - ndv, 3. );
      col += mBlackbody( .55 + .45 * hot ) * hot * 1.4;
    } else if ( id == 13 ) {   // the Sun, gold: polished gold boiling with granulation, a corona at its limb
      vec3 f0 = vec3( 1., .766, .336 );
      vec2 c = mCells( sn * 9. + vec3( 0., uTime * .12, 0. ) ); float gran = smoothstep( .0, .5, c.y - c.x );
      col = env( r, p ) * mix( f0, vec3( 1. ), fres ) * .65 + vec3( 1., .62, .18 ) * ( .25 + .75 * gran ) * ( .45 + .9 * uGlow ) + vec3( 1., .72, .32 ) * pow( 1. - ndv, 2.5 ) * ( .8 + uGlow );
    } else if ( id == 14 ) {   // Venus, copper: polished copper, verdigris (emerald) settling in its hollows, a sky-blue sheen
      vec3 f0 = vec3( .955, .638, .538 );
      float pat2 = smoothstep( .5, .7, mFbm( p * 4. ) + .45 * ( 1. - pat.x ) );
      vec3 verd = mix( vec3( .2, .55, .45 ), vec3( .3, .74, .62 ), mNoise( p * 18. ) );
      col = mix( env( r, p ) * mix( f0, vec3( 1. ), fres ) + uLight * f0 * dif * uGlow * .9, verd * ( .18 + .8 * dif * uLight * ( .4 + uGlow ) ) + env( r, p ) * fres * .06, pat2 );
      col += vec3( .53, .81, .92 ) * pow( 1. - ndv, 3. ) * .35;
    } else if ( id == 15 ) {   // Mercury, quicksilver: a perfect liquid mirror, quick ripples, a yellow-purple film at its edges
      vec3 n2 = mRipple( p, n, 17., 2.2, .12 ), r2 = reflect( rd, n2 ); float nd2 = max( dot( n2, v ), 0. ), f2 = pow( 1. - nd2, 5. );
      col = env( r2, p ) * mix( vec3( .78, .79, .8 ), vec3( 1. ), f2 ) * 1.15;
      vec3 fl = mix( vec3( 1., .9, .05 ), vec3( .42, .05, .68 ), .5 + .5 * sin( nd2 * 12. + uTime * 1.5 ) );
      col = mix( col, col * fl * 1.7, .4 * pow( 1. - nd2, 1.5 ) );
    } else {   // the Moon, silver: satin silver with maria and craters, a moonstone's blue light drifting across it
      vec3 f0 = vec3( .972, .96, .915 ), rS = normalize( mix( r, n, .3 ) );
      float maria = smoothstep( .45, .66, mFbm( sn * 2.2 + 5. ) ); vec2 c = mCells( sn * 6.5 + 3. );
      float rimC = smoothstep( .07, 0., abs( c.x - .33 ) ) * step( c.x, .45 ), floorC = smoothstep( .33, .2, c.x );
      col = env( rS, p ) * mix( f0, vec3( 1. ), fres ) * .8 * ( 1. - .4 * maria ) * ( 1. - .25 * floorC ) + vec3( .9 ) * rimC * .18 * ( .4 + uGlow );
      col += vec3( .55, .7, 1. ) * exp( - pow( ( ndv - .55 + .15 * sin( uTime * .3 ) ) * 4., 2. ) ) * ( .25 + .45 * uGlow );
    }
    return vec4( col, a );
  }

  void main() {
    vec2 uvW = ( gl_FragCoord.xy - .5 * uRes ) / uRes.y, uv0 = uvW - uShift, uv = uv0 / uScale;   // uvW: the window, uv0: the entity, moved by the stereo image
    vec3 ro = vec3( 0., 0., 4.2 * uZoom );
    ro.yz *= rot( uLook.y * .35 ); ro.xz *= rot( uLook.x * .55 );
    vec3 ww = normalize( - ro ), uu = normalize( cross( ww, vec3( 0., 1., 0. ) ) ), vv = cross( uu, ww );
    vec3 rd = normalize( uu * uv.x + vv * uv.y + ww * 1.6 );
    float bc = dot( ro, rd ), hc = bc * bc - dot( ro, ro ) + uCoreR * uCoreR;
    float tCore = hc > 0. ? - bc - sqrt( hc ) : 1e9, dCore = length( ro + rd * max( - bc, 0. ) );
    vec3 col = vec3( 0. ); float alpha = 0.;
    float bb = dot( ro, rd ), hb = bb * bb - dot( ro, ro ) + 1.45 * 1.45;
    bool hit = false; float t = 0., rGlow = 0., rGlowT = 0.;
    if ( hb > 0. && uHide < .5 ) {   // beads: the liquid shell is gone, the core still shines
      t = max( - bb - sqrt( hb ), 0. ); float tEnd = uRise > .2 ? - bb + sqrt( hb ) : min( - bb + sqrt( hb ), tCore );   // risen, the form may pass through the core
      int nMax = 64 + int( 96. * uRise );
      for ( int i = 0; i < 160; i++ ) {
        if ( i >= nMax ) break;
        float d = map( ro + rd * t );
        if ( uEther > .01 ) { float g = exp( - max( d, 0. ) * 90. ); rGlow += g * .05; rGlowT += g * .05 * rTrap; }   // ether: light gathered where the ray grazes the form
        if ( d < .0016 ) { hit = true; break; }
        t += d * clamp( .8 - .36 * min( uChaos, 1.15 ) - uDisp * 3., .3, .8 ) * ( 1. - .2 * uRise );
        if ( t > tEnd ) break;
      }
    }
    if ( hit ) {
      vec3 p = ro + rd * t, n = normalAt( p ), v = - rd;
      float hideK = 1. - smoothstep( 0., .5, uHide );
      vec3 sn = normalize( p ); vec2 suv = songUV( sn );
      vec3 songC0 = vec3( .5 ), sg = vec3( 0. ); vec4 gn = vec4( .5 ); vec2 pat = vec2( .5, 0. );
      // the living skin's height (r) and growth edges (g): materials catch light on the forms it carves, nothing is painted on
      if ( uSkinA > .01 ) { vec3 skv = skinSample( uSkin, sn ) * ( 1. - smoothstep( .85, .99, abs( sn.y ) ) ); pat = vec2( skv.r, skv.g ); }
      vec4 caS = vec4( 0. ); float caE = 0.;
      if ( uCaA > .01 ) {   // the automaton's height and its fronts (the height's slope) become the pattern the materials shade
        vec3 e1 = normalize( cross( abs( sn.y ) < .95 ? vec3( 0., 1., 0. ) : vec3( 1., 0., 0. ), sn ) ), e2 = cross( sn, e1 ); float ce = 1.6 / uCaN;
        caS = caLook( sn ); caE = clamp( length( vec2( caLook( normalize( sn + e1 * ce ) ).a - caLook( normalize( sn - e1 * ce ) ).a, caLook( normalize( sn + e2 * ce ) ).a - caLook( normalize( sn - e2 * ce ) ).a ) ) * 1.6, 0., 1. );
        pat = mix( pat, vec2( caS.a, caE ), clamp( uCaA, 0., 1. ) * .85 );
      }
      float morphAO = 1.; vec4 moS = vec4( .5, 0., 0., .5 );
      if ( uMorphA > .01 ) {
        float mLod = clamp( log2( t / ( uRes.y * uScale * 1.6 * .0041 ) ), 0., 3. );   // texels per screen pixel: a small body samples a coarser mip
        vec4 mo = textureLod( uMorph, sn, mLod ); float blurH = textureLod( uMorph, sn, 4. ).r; moS = mo;
        pat = mix( pat, mo.rg, clamp( uMorphA, 0., 1. ) * ( 1. - .45 * min( uSkinA, 1. ) ) );
        morphAO = clamp( 1. + ( mo.r - blurH ) * 2.6, .6, 1.08 );   // cavities darken softly, ridges catch a little more light
      }
      vec3 r = reflect( rd, n ); float ndv = max( dot( n, v ), 0. ), fres = pow( 1. - ndv, 5. ) * uRimK;
      float dist = length( p ), dif = max( dot( n, normalize( - p ) ), 0. );
      float songG = sg.r;
      vec3 songC = songC0 * mix( .4, 1.4, pat.x ) * ( 1. - .55 * smoothstep( .35, .8, sg.b ) ) * mix( 1., .55, pat.y );   // pattern, its edges, the veins between sounds
      // the metal's own colour: its base, the lobes' note colours, the film, the remembered song
      vec4 nt = noteTint( p );
      vec3 f0 = mix( uMetal, uMetal * .35 + nt.rgb * .9, uNoteTint * nt.a * smoothstep( uCoreR * 1.3, uCoreR * 2.2, dist ) );
      if ( uFilm > 0. ) f0 = mix( f0, film( ndv * 1.6 + uTime * .05 ) * .9 + .1, uFilm );
      f0 = mix( f0, songC * 1.25, .85 * uSongAmt );
      // up to four materials, each in its own territories: evaluate the top two at this point in a non-unrolled loop so the compiler emits matShade only once
      float sc0 = -1e9, sc1 = -1e9; int id0 = 0, id1 = 0;
      for ( int s = 0; s < 4; s++ ) {
        if ( uMw[ s ] > .002 ) {
          vec3 o = vec3( float( s ) * 7.31, float( s ) * 3.17, float( s ) * 5.53 ), q = sn * uMatScale + o + vec3( uTime * .045, - uTime * .03, uTime * .02 );
          float fld = mNoise( q ) * .65 + mNoise( q * 2.1 + 9. ) * .35 + ( pat.x - .5 ) * ( mod( float( s ), 2. ) < .5 ? .7 : -.7 );
          float scv = log( uMw[ s ] ) + uMatMix * 3. * ( fld - .5 );
          int mid = int( uMid[ s ] + .5 );
          if ( scv > sc0 ) { sc1 = sc0; id1 = id0; sc0 = scv; id0 = mid; }
          else if ( scv > sc1 ) { sc1 = scv; id1 = mid; }
        }
      }
      float tau = mix( 1., .12, uMatMix ), w1 = sc1 > -1e8 ? exp( ( sc1 - sc0 ) / tau ) : 0.;
      float wsum = 1e-4, bio = 0., matA = 0.;
      col = vec3( 0. );
      int nEval = min( w1 > .035 ? 2 : 1, int( uRes.x ) );   // uniform bound stops GLSL from unrolling 5x copies of matShade
      for ( int s = 0; s < nEval; s++ ) {
        int id = s == 0 ? id0 : id1;
        float w = s == 0 ? 1. : w1;
        vec4 m = matShade( id, p, n, rd, pat, moS, songC, songC0, f0 );
        col += m.rgb * w; matA += m.a * w; wsum += w; if ( id == 5 ) bio += w;
      }
      col /= wsum; matA /= wsum; bio /= wsum;
      if ( uWRA > .01 ) {   // where the rings are, it is water
        float kR = smoothstep( .025, .0, wRings( p ) ) * min( 1., uWRA * 1.5 );
        if ( kR > .01 ) {
          vec3 wCol = env( r, p ) * ( .12 + .88 * fres ) * 1.3 + mix( vec3( .01, .16, .28 ), vec3( .12, .58, .66 ), .4 + .4 * uGlow ) + vec3( .7, .95, 1. ) * pow( max( dot( r, normalize( vec3( -.55, .5, .67 ) ) ), 0. ), 40. ) * .8;
          col = mix( col, wCol, kR ); matA = mix( matA, 1., kR );
        }
      }
      if ( serpA() > .01 ) {   // where the mass follows a serpent's pull, a faint oil-film sheen runs along its back
        float kS = smoothstep( .03, .0, serpentD( p ) );
        if ( kS > .01 ) col += film( ndv * 2.6 + uTime * .08 + dot( p, vec3( 3., 5., 4. ) ) ) * ( .12 + .3 * pow( 1. - ndv, 1.5 ) ) * ( .5 + uGlow ) * kS;
        float spine = smoothstep( .012, -.006, serpentD( p ) );   // its spine: a line of light along the crest, swelling on the beat
        col += mix( uLight, vec3( .85, .95, 1. ), .5 ) * spine * ( .12 + .3 * uBeatPulse ) * ( .4 + uGlow );
      }
      if ( uGlisten > .01 ) {   // glistening: tiny facets each catching the light for a moment
        vec3 g = floor( sn * 150. ); float hh = hash3( g );
        vec3 fn = normalize( n + ( vec3( hash3( g + 3.1 ), hash3( g + 7.7 ), hash3( g + 1.3 ) ) - .5 ) * .55 );
        float sp = pow( max( dot( reflect( rd, fn ), normalize( vec3( -.55, .5, .67 ) ) ), 0. ), 260. ) * step( .5, hh ) * ( .5 + .5 * sin( uTime * 8. + hh * 60. ) );
        col += mix( vec3( 1., .97, .9 ), uLight, .2 ) * sp * uGlisten * 10.; matA = max( matA, min( 1., sp * uGlisten * 10. ) );
      }
      float geoAO = calcAO( p, n );
      col *= mix( 1., geoAO, .72 ) * mix( 1., morphAO, smoothstep( .3, 1., uMorphA ) );   // cavities between lobes/tendrils/drops and grown form self-shadow naturally
      if ( uMarb > .01 || uIllum > .01 ) {   // the journey on the body: ink as a coloured film on the metal (its reflections stay), then fine gilded engraving
        vec3 sj = jSpin( sn ); float vein; vec4 mc = jMarble( sj * 1.5, vein );
        float ia = mc.a * uMarb;
        col = mix( col, col * mc.rgb * 2.1 + mc.rgb * ( .04 + .06 * dif ) * ( .5 + uGlow ), ia * .85 );
        col *= 1. - vein * .45 * uMarb;   // the fine dark lines where one stone pushed against another
        if ( uIllum > .01 ) {
          vec4 k = jPlait( jSphereUV( sj ), .06, .03 ); float g = k.a * jReveal( sj );
          float spec = pow( max( dot( r, normalize( vec3( -.48, .62, .62 ) ) ), 0. ), 16. );
          col = mix( col, col * vec3( 1., .82, .52 ) * 1.15 + vec3( 1., .86, .58 ) * spec * 1.2, g * ( .25 + .5 * spec ) );   // gilded lines: barely there until they catch the key light
        }
      }
      if ( uPhen[ 3 ] > .01 ) {   // silver: caustics, the web light weaves through moving water, playing over the body
        vec2 cp = vec2( atan( sn.z, sn.x ) * 2.2, sn.y * 3.5 ) * 2.2 + 30.; vec2 ci = cp; float cc = 1.;
        for ( int k = 0; k < 4; k++ ) { float tt = uPhenT * .35 * ( 1. - 3.5 / float( k + 1 ) ); ci = cp + vec2( cos( tt - ci.x ) + sin( tt + ci.y ), sin( tt - ci.y ) + cos( tt + ci.x ) );
          cc += 1. / length( vec2( cp.x / ( sin( ci.x + tt ) / .005 ), cp.y / ( cos( ci.y + tt ) / .005 ) ) ); }
        cc = pow( abs( 1.17 - pow( cc / 4., 1.4 ) ), 7. );
        col += vec3( .7, .85, 1. ) * clamp( cc, 0., 2. ) * .55 * uPhen[ 3 ] * ( .4 + .6 * fres + .4 * dif );
      }
      if ( uPhen[ 6 ] > .01 && uPhenK > .01 ) {   // iron: at a hit a branching discharge crawls over the surface from where it struck, and fades
        vec3 sd = normalize( vec3( cos( uPhenS * 2.4 ), sin( uPhenS * 1.7 ), cos( uPhenS * 3.1 ) ) );
        float reach = acos( clamp( dot( sn, sd ), -1., 1. ) ), front = ( 1. - uPhenK ) * 3.2 + .3;
        vec3 wp = sn * 3. + .6 * vec3( mNoise( sn * 4. + uPhenS ), mNoise( sn * 4. + 7. + uPhenS ), mNoise( sn * 4. + 13. + uPhenS ) );
        float br = abs( mFbm( wp ) - .5 ) + .35 * abs( mFbm( wp * 2.7 + 3. ) - .5 );   // ridges of a warped field: the discharge's branches
        float arc = ( 1. - smoothstep( .0, .028, br ) ) * smoothstep( front, front - .5, reach );
        col += ( vec3( .7, .85, 1. ) * arc * 1.6 + vec3( 1., .25, .1 ) * ( 1. - smoothstep( .0, .09, br ) ) * smoothstep( front, front - .8, reach ) * .5 ) * uPhenK * uPhen[ 6 ];
      }
      // lab: the proposed materials carry their own colour; the overlays below fade where they are
      float pk = 1. - .85 * uProp * clamp( dot( uPWa, vec4( 1. ) ) + dot( uPWb, vec4( 1. ) ) + dot( uPWc, vec4( 1. ) ), 0., 1. );
      // in every material the stains show through: membranes and nuclei carry the song's colours
      col += pk * ( uStainM * moS.g * .22 + uStainN * moS.b * .3 + uStainO * moS.a * .26 ) * uStainA * min( uMorphA, 1. ) * ( .35 + .8 * uGlow ) * ( 1. - bio );
      float thS = shellTh( p );
      float thin = smoothstep( .07, 0., thS ) * smoothstep( .9, .3, dist ) * uThinK;     // light bleeding through thin metal
      float sss = pow( clamp( dot( rd, sn ) * .5 + .5, 0., 1. ), 2.2 ) * smoothstep( .11, -.02, thS ) * ( 1. - ndv );
      col += uLight * ( thin * ( .35 + uOpen * 1.3 ) + sss * .26 ) * uGlow * pk;
      if ( uSparks > 0. ) col += uLight * smoothstep( .996, 1., dot( r, normalize( - p ) ) ) * uSparks * 6.;
      if ( uRays > .01 ) col += uLight * uRays * .35 * thin;
      if ( uSkinA > .01 ) {   // living skin: the grown pattern darkens the metal, its edges glow with the core's light
        vec3 sn = normalize( p ), sk = skinSample( uSkin, sn ) * ( 1. - smoothstep( .85, .99, abs( sn.y ) ) );
        col = mix( col, col * ( .5 + .5 * ( 1. - sk.r ) ), .5 * min( uSkinA, 1. ) * pk ) + uLight * sk.g * .55 * min( uSkinA, 1. ) * uGlow * pk;
      }
      if ( uCaA > .01 ) {   // the automaton: resting cells sink in shadow, live cells stain the metal in its palette leaning to the being's hue (a multiply: the material's reflections stay), its fronts catch the core's light
        float k = min( uCaA, 1. ) * pk; vec3 pc = caS.rgb * caS.rgb; float pl = dot( pc, vec3( .3, .5, .2 ) );
        vec3 stain = mix( pc, uCaHueC * ( .25 + 1.3 * pl ), uCaHue );
        col *= mix( 1., .45 + .55 * caS.a, .6 * k );
        col = mix( col, col * ( .35 + 1.9 * stain ), .75 * k * smoothstep( .05, .6, caS.a ) );
        col += ( uLight * caE * .5 + stain * caS.a * .14 ) * uGlow * k;
      }
      if ( uTissueA > .01 ) {   // its nervous tissue firing: faint flashes under the surface
        vec3 tz = skinSample( uTissue, normalize( p ) );
        col += uTissueC * tz.g * .3 * uTissueA * ( .4 + uGlow ) * pk;
      }
      if ( uSongAmt > .01 ) col += mix( uLight, songC0 * 1.6 + .15, .6 ) * songG * ( .9 + 1.2 * uSongAmt ) * ( .5 + .5 * fres ) * ( .6 + .8 * pat.x );   // where it recognises the sound, it glows
      if ( uCvA > .01 ) {   // the automaton inside, seen where the metal is thin or clear (air), and as a soft glow through it
        vec4 cv = textureLod( uCv, gl_FragCoord.xy / uRes, 0. ); float see = clamp( thin * 1.4 + sss * .8 + ( 1. - matA ) * .9 + .45 * pow( 1. - ndv, 2. ), 0., 1. );
        col += cv.rgb * min( uCvA, 1. ) * ( .3 + .7 * see ) * 1.6 * ( 1. + .6 * uImm ); matA = max( matA, cv.a * min( uCvA, 1. ) * see );
      }
      alpha = matA; col *= hideK; alpha *= hideK;
      if ( uEther > .01 ) {   // ether: the surface keeps only its silhouette and edges; the rest is light
        float rim = pow( 1. - ndv, 2.5 );
        vec3 ghost = ( film( rTrap * .8 + .55 + .03 * uTime ) * .6 + .5 ) * rim * ( .8 + .6 * uGlow ) + env( r, p ) * .12;
        col = mix( col, ghost, uEther * .9 ); alpha = mix( alpha, rim * .8 + .12, uEther * .9 );
      }
    } else if ( tCore < 1e8 ) {
      vec3 p0 = ro + rd * tCore;
      float mu = max( dot( normalize( p0 ), - rd ), 0. );
      vec3 lightCol = mix( uLight * 1.6, vec3( 1. ), pow( mu, 2. ) ) * ( .7 + uCoreI + uGlow + uKick * 2. ) * mix( 1., .45, uHide );
      col = lightCol; alpha = 1.;
      if ( uNuc > .01 ) {
        // nucleus space: the core sphere maps to |q| < 1.35, slowly turning with the felt pulse
        float sN = uCoreR / 1.35; mat2 rn = rot( uNucRot );
        float tn = 0., trap = 1., hitN = 0.; vec3 q = p0;
        float tMax = 2. * uCoreR;
        for ( int i = 0; i < 48; i++ ) {
          q = p0 + rd * tn; vec3 lq = q / sN; lq.xz *= rn;
          float dj = julia( lq, trap ) * sN;
          if ( dj < .0006 ) { hitN = 1.; break; }
          tn += max( dj * .9, .0004 ); if ( tn > tMax ) break;
        }
        if ( hitN > .5 ) {
          vec2 e = vec2( .002, 0. ); float tr;
          vec3 lq = q / sN; lq.xz *= rn;
          vec3 nn = normalize( vec3( julia( lq + e.xyy, tr ) - julia( lq - e.xyy, tr ), julia( lq + e.yxy, tr ) - julia( lq - e.yxy, tr ), julia( lq + e.yyx, tr ) - julia( lq - e.yyx, tr ) ) );
          float rim = pow( 1. - max( dot( nn, - rd ), 0. ), 2. );
          vec3 body = mix( uTissueC, uLight, clamp( trap * .7, 0., 1. ) ) * ( .45 + .55 * max( dot( nn, normalize( vec3( .3, .8, .5 ) ) ), 0. ) );
          col = mix( lightCol * .35, body * ( 1.3 + uCoreI ) + rim * uLight * 1.5, uNuc );
        } else col = lightCol * mix( 1., .35, uNuc );   // the light dims around the nucleus so its form reads
      }
    }
    if ( ! hit && uCvA > .01 ) {   // through a hole, between the beads: the inside itself, in front of the core's light
      vec4 cv = textureLod( uCv, gl_FragCoord.xy / uRes, 0. ); float k = min( uCvA, 1. );
      col = col * ( 1. - .6 * cv.a * k ) + cv.rgb * k * ( 1. + .4 * uImm ); alpha = max( alpha, cv.a * k );
    }
    float hx = max( dCore - uCoreR, 0. ), hk = 6.5 - uHalo * 3.2 - uKick * 2.2;
    vec3 htint = vec3( 1. - .2 * uCool, 1. - .04 * uCool, 1. + .18 * uCool );   // brighter sound: a cooler halo
    float halo = exp( - hx * hk ) * .9 + exp( - hx * 24. ) * 1.4;
    vec3 hcol = vec3( halo );
    if ( uSplit > .001 ) hcol = vec3( exp( - hx * hk * ( 1. - uSplit ) ) * .9 + exp( - hx * 24. * ( 1. - uSplit ) ) * 1.4, halo, exp( - hx * hk * ( 1. + uSplit ) ) * 1.9 + exp( - hx * 24. * ( 1. + uSplit ) ) * 1.4 );   // glitch: RGB split of the glow
    col += uLight * htint * hcol * ( uGlow + uKick * 1.2 ) * ( hit ? .25 : mix( 1., .12, uHide ) ) * uHaloK;   // beads: no shell covers the halo, so it stays a soft inner glow behind the lights
    if ( uRays > .01 ) {   // the core speaks: faint streaks through the gaps
      vec2 rv = uv0; float ang = atan( rv.y, rv.x ), rl = length( rv );
      float st = pow( max( 0., sin( ang * 9. + uTime * .7 ) * sin( ang * 5. - uTime * .45 + 1. ) ), 3. );
      col += uLight * st * uRays * exp( - rl * 3.2 ) * smoothstep( uCoreR * .8, uCoreR * 1.6, rl ) * ( hit ? .12 : .6 );
    }
    float rr = length( uv0 );
    col += uLight * ( smoothstep( .014, 0., abs( rr - uRing ) ) * uRingA + smoothstep( .014, 0., abs( rr - uRing2 ) ) * uRing2A );   // the snare's shockwave (twice on a drop)
    if ( uSparks > 0. ) {
      vec2 g = uv0 * 34., id = floor( g ); float hsh = hash( id );
      float tw = smoothstep( 1. - uMote, 1., hsh ) * smoothstep( .12, 0., length( fract( g ) - .5 ) ) * ( .3 + uHat * 1.6 ) * ( .5 + .5 * sin( uTime * 9. + hsh * 40. ) );
      col += uLight * tw * uSparks * smoothstep( .5, .15, rr ) * 1.4;
    }
    for ( int i = 0; i < 6; i++ ) if ( uGl[ i ].w > .003 ) {   // glints and stars: sunlight catching it, at its moments
      vec2 dd = uvW - uGl[ i ].xy; float sz = uGl[ i ].z, I = uGl[ i ].w, ga = uGlR[ i ];
      vec2 e = vec2( cos( ga ), sin( ga ) ), q = vec2( dot( dd, e ), dot( dd, vec2( - e.y, e.x ) ) ), q2 = vec2( q.x + q.y, q.y - q.x ) * .7071;
      float rr0 = length( dd ) / sz;
      float core = exp( - rr0 * rr0 * 20. ) * 2.2 + exp( - rr0 * 4. ) * .3;
      float rays = exp( - abs( q.y ) / ( sz * .016 ) ) * exp( - abs( q.x ) / ( sz * 1.3 ) ) + exp( - abs( q.x ) / ( sz * .016 ) ) * exp( - abs( q.y ) / ( sz * 1.3 ) )
                 + .45 * ( exp( - abs( q2.y ) / ( sz * .011 ) ) * exp( - abs( q2.x ) / ( sz * .55 ) ) + exp( - abs( q2.x ) / ( sz * .011 ) ) * exp( - abs( q2.y ) / ( sz * .55 ) ) );
      float halo = sz > .18 ? exp( - pow( ( rr0 - 1.05 ) * 8., 2. ) ) * .16 : 0.;   // the great star's rainbow halo
      col += ( mix( vec3( 1., .97, .9 ), uLight, .22 ) * ( core + rays ) + film( rr0 * .55 + .1 ) * halo ) * I;
    }
    if ( uProp > .5 && uPWa.x > .08 ) {   // proposed fire: 8-step fast shellTh volumetric flame (no full map() inlining)
      float R = uShellR, fb = dot( ro, rd ), fh = fb * fb - dot( ro, ro ) + 4.0 * R * R;
      if ( fh > 0. ) {
        float t0 = max( - fb - sqrt( fh ), 0. ), t1 = min( hit ? t : - fb + sqrt( fh ), tCore );
        float dtF = max( t1 - t0, 0. ) / 8., tt = t0 + dtF * ( .25 + .5 * fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( .06711056, .00583715 ) ) ) ) );
        vec3 fcol = vec3( 0. ); float tr = 1.;
        for ( int i = 0; i < 8; i++ ) {
          if ( tt > t1 ) break;
          vec3 q = ro + rd * tt; float dd = shellTh( q );
          if ( dd > 0. && dd < R * .85 ) {
            vec3 dir = normalize( q ); float h = dd / ( R * ( .16 + .45 * uAro + .2 * uBeatPulse ) );
            vec3 sw = dir; float ang = uTime * ( .5 + .6 * uAro ) + h * 1.4; sw.xz = mat2( cos( ang ), - sin( ang ), sin( ang ), cos( ang ) ) * sw.xz;
            float n = mFbm( sw * 2.6 + q / R * .6 - dir * uTime * ( 1.2 + 1.6 * uAro ) );
            float dens = smoothstep( .5 + .28 * h, .62 + .28 * h, n + .08 ) * exp( - h * 2. );
            float heat = ( .3 + .6 * uAro ) * exp( - h * 2.2 ) + .08 * uBeatPulse;
            vec3 c = mix( vec3( .55, .03, .12 ), vec3( .9, .2, .06 ), smoothstep( .15, .4, heat ) ); c = mix( c, vec3( 1., .45, .02 ), smoothstep( .4, .7, heat ) ); c = mix( c, vec3( 1., .82, .25 ), smoothstep( .7, .95, heat ) );
            float a = dens * dtF / R * .7 * uPWa.x;
            fcol += tr * c * a * ( 1. + 1.5 * heat ); tr *= 1. - clamp( a * .5, 0., 1. );
            fcol += tr * vec3( 1., .32, .06 ) * exp( - dd / ( R * ( .22 + .3 * uAro ) ) ) * dtF / R * .55 * uPWa.x * ( .6 + .4 * uBeatPulse );
          }
          tt += dtF;
        }
        col = col * tr + fcol; alpha = max( alpha, clamp( 1. - tr + max( fcol.r, max( fcol.g, fcol.b ) ) * .6, 0., 1. ) );
      }
    }
    if ( uEther > .01 && rGlow > 0. ) col += ( film( rGlowT / max( rGlow, 1e-4 ) * .8 + .55 + .03 * uTime ) * .5 + .5 ) * rGlow * uEther * ( .6 + .5 * uGlow );   // ether: the form as light
    col *= .25 + .75 * uAwake;
${EXT.shader.screen}
    if ( uJour * uPeak > .02 ) {   // the journey's peaks: the body itself joins (it only does at a drop, chills or a climax) (the reference's arc): saturated, then liquid relief, then the hues turn and some bands invert
      float J = uJour * uPeak, lum = dot( col, vec3( .3, .59, .11 ) ), on = hit ? 1. : 0.;   // only the body and the field's light: the empty dark stays dark (and the desktop shows through)
      col = max( mix( vec3( lum ), col, 1. + .9 * smoothstep( .2, .6, J ) * on ), 0. );
      float melt = smoothstep( .4, .75, J ) * ( hit ? 1. : 0. );
      float hgt = dot( col, vec3( .3, .59, .11 ) ); vec3 nm = normalize( vec3( - dFdx( hgt ), - dFdy( hgt ), .012 ) ), rf2 = reflect( vec3( 0., 0., -1. ), nm );
      col = mix( col, col * ( .5 + .7 * smoothstep( -.4, 1., rf2.y ) ) + vec3( 1., .97, .9 ) * pow( max( dot( rf2, normalize( vec3( -.45, .6, .65 ) ) ), 0. ), 12. ) * .8, melt * .8 );
      float turn = smoothstep( .6, 1., J ) * on, lr = log( max( length( uv ), .01 ) );
      float a = turn * ( uJFlow * .25 + lum * 4. + lr * 3. ); vec3 k = vec3( .57735 );
      col = max( col * cos( a ) + cross( k, col ) * sin( a ) + k * dot( k, col ) * ( 1. - cos( a ) ), 0. );
      float band = smoothstep( .45, .55, fract( lr * 2. - uJFlow * .05 + lum ) );
      col = mix( col, mix( col, max( 1. - col, 0. ), .85 ), band * smoothstep( .8, 1., J ) * on );
    }
    vec3 mapped = 1. - exp( - col * 1.22 );
    float lum = dot( col, vec3( .2126, .7152, .0722 ) ), mLum = 1. - exp( - lum * 1.22 );
    col = mix( mapped, col * ( mLum / max( lum, 1e-4 ) ), .28 );
    alpha = max( alpha, clamp( max( col.r, max( col.g, col.b ) ) * 1.25, 0., 1. ) ) * smoothstep( uMaskR, uMaskR * .8, length( uvW ) );   // its round window; full screen, it opens
    col *= smoothstep( uMaskR, uMaskR * .8, length( uvW ) );   // (the black ground of full screen is made in the final pass, so the aura still shows round it)
    gl_FragColor = vec4( min( col, vec3( alpha ) ), alpha );
  }`;
/* the feedback aura: an iterated image map around the creature (decay x warp of the previous frame + its glow) */
export const AURA_FRAG = `precision highp float; varying vec2 vUv; uniform sampler2D uPrev, uScene; uniform float uZoom, uRot, uDecay, uGain, uTime, uAspect, uWarp, uFlow, uFz, uHue, uSun, uSunRot; uniform vec3 uTint; uniform vec4 uFk;
    // the form constants (tunnel, spiral, honeycomb, cobweb; Klüver) as potentials in cortical coordinates (log r, angle): the
    // echoes climb their gradient, so the body's own light gathers into them (Bressloff et al. 2001 draw them the same way)
    float pot(vec2 q) {
      vec2 k = vec2(log(max(length(q), 1e-3)), atan(q.y, q.x)) * 3.8197;   // 24 cells round
      float t = cos(6.2831853 * (k.x - uFz)), sp = cos(6.2831853 * (.5 * k.x + .5 * k.y - uFz));
      float hx = cos(6.2831853 * k.y) + cos(6.2831853 * (.5 * k.y + .866 * (k.x - uFz))) + cos(6.2831853 * (.5 * k.y - .866 * (k.x - uFz)));
      float cw = .6 * cos(6.2831853 * k.y) + .4 * cos(6.2831853 * (k.x - uFz));   // smooth, no creases
      return uFk.x * t + uFk.y * sp + uFk.z * hx / 1.5 + uFk.w * cw;
    }
    void main(){
      vec2 c = (vUv - .5) * vec2(uAspect, 1.);
      float r = length(c);
      c /= uZoom;                                                       // sample nearer the centre: echoes flow outward
      float a = uRot * (1. - .9 * uSun) * (1. + .6 * r); c = mat2(cos(a), -sin(a), sin(a), cos(a)) * c;
      c += uWarp * (1. - .9 * uSun) * vec2(sin(c.y * 9. + uTime * .7), cos(c.x * 9. - uTime * .6));   // the sun's rays stay straight
      float ridge = 0.;
      if (uFlow > .001) {   // sample down the gradient, so what was there moves up it
        float e = .004, p0 = pot(c); vec2 g = vec2(pot(c + vec2(e, 0.)) - p0, pot(c + vec2(0., e)) - p0) / e;
        c -= g * uFlow * .0009 * (.3 + r);
        ridge = p0;
      }
      float ray = 0., rayI = 0.;
      if (uSun > .001) {   // the sun's materials: long rays turning slowly round it, gold, flame, red, white and green in turn
        float th = atan(c.y, c.x) + uSunRot, n = 22.;
        float u = th * n / 6.2831853; rayI = floor(u); ray = 1. - abs(fract(u) - .5) * 2.;   // 1 on a ray's spine
        c *= 1. - .018 * uSun;   // the light streams outward along them
        c = mat2(cos(.0015 * uSun), -sin(.0015 * uSun), sin(.0015 * uSun), cos(.0015 * uSun)) * c;
      }
      vec2 uv = c / vec2(uAspect, 1.) + .5;
      vec3 prev = texture2D(uPrev, uv).rgb * uDecay * uTint;
      if (uSun > .001) {
        float k = mod(rayI, 5.);
        vec3 tint = k < 1. ? vec3(1., .82, .35) : k < 2. ? vec3(1., .55, .2) : k < 3. ? vec3(.9, .3, .18) : k < 4. ? vec3(1., .97, .85) : vec3(.55, .78, .4);
        float spine = smoothstep(.15, .85, ray);
        prev *= mix(vec3(1.), tint * (.97 + .06 * spine), .06 * uSun);   // each pass leans the echo toward its ray's colour
        prev *= 1. + uSun * (.06 * pow(spine, 6.) - .1);   // light lingers on the rays' spines and dies between them: long tapered rays
      }
      prev *= 1. + uFlow * .02 * clamp(ridge, -1., 1.);   // the ridges keep their light a little longer: the form sharpens out of the glow
      if (abs(uHue) > 1e-4) { vec3 k = vec3(.57735); prev = max(prev * cos(uHue) + cross(k, prev) * sin(uHue) + k * dot(k, prev) * (1. - cos(uHue)), 0.); }   // each echo a little further round the colour wheel
      vec4 sc = texture2D(uScene, vUv);
      vec3 emit = max(sc.rgb - .08, 0.) * uGain * (1. - .5 * sc.a);
      gl_FragColor = vec4(max(prev - .002, 0.) + emit, 1.);
    }`;
/* the final picture: the scene over its aura, the look (pixels, colour levels, dither) and the glitch artifacts */
export const COMPOSITE_FRAG = `precision highp float; varying vec2 vUv; uniform sampler2D uFb, uScene; uniform float uFbAmt, uPix, uLev, uDith, uGS, uGA, uGT, uGTm, uRayA, uMaskR, uImm; uniform vec2 uRes, uRayC; uniform vec3 uRayT;
    vec4 samp(vec2 uv) { vec4 sc = texture2D(uScene, uv); vec3 fb = texture2D(uFb, uv).rgb * uFbAmt; return vec4(sc.rgb + fb * (1. - sc.a), max(sc.a, clamp(max(fb.r, max(fb.g, fb.b)) * 1.5, 0., 1.))); }
    float gh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + uGT * 17.13) * 43758.5453); }   // per-glitch-frame hash
    float luma(vec3 c) { return dot(c, vec3(.299, .587, .114)); }
    // glitch artifacts (lab): 1 split, 2 tear, 3 mosh, 4 sort, 5 crt, 6 corrupt; uGA 0..1
    vec4 glitch(vec2 uv) {
      float A = uGA, s = floor(uGS + .5);
      if (s == 1.) {                                                    // split: the channels pulled apart, radially and along a jittered axis
        vec2 d = (uv - .5) * .03 * A + (vec2(gh(vec2(1., 0.)), gh(vec2(2., 0.))) - .5) * .025 * A;
        vec4 r = samp(uv + d), g = samp(uv), b = samp(uv - d);
        return vec4(r.r, g.g, b.b, max(r.a, max(g.a, b.a)));
      }
      if (s == 2.) {                                                    // tear: bands of rows slide sideways, red lags behind
        float band = floor(uv.y * mix(8., 48., gh(vec2(3., 0.))));
        float dx = (gh(vec2(band, 5.)) - .5) * .3 * A * step(1. - .55 * A, gh(vec2(band, 4.)));
        vec4 c = samp(vec2(uv.x + dx, uv.y)); c.r = samp(vec2(uv.x + dx * 1.5, uv.y)).r;
        return c;
      }
      if (s == 3.) {                                                    // mosh: macroblocks slip, some flatten to one colour and one gradient
        vec2 bs = 16. * (1. + 2. * step(.5, gh(vec2(6., 0.)))) / uRes, cell = floor(uv / bs);
        float h = gh(cell); vec2 u = uv;
        if (h < .4 * A) u += (vec2(gh(cell + 7.), gh(cell + 9.)) - .5) * bs * 8. * A;
        vec4 c = samp(u);
        if (h > 1. - .3 * A) { vec2 o = (floor(u / bs) + .5) * bs; vec4 c0 = samp(o), c1 = samp(o + vec2(bs.x, 0.)); c = mix(c, mix(c0, c1, fract(u.x / bs.x)), .9); }
        return c;
      }
      if (s == 4.) {                                                    // sort: bright pixels stream down their column, as in pixel sorting
        vec4 c = samp(uv); float l = luma(c.rgb), len = .16 * A * (.3 + .7 * gh(vec2(floor(uv.x * uRes.x / 3.), 8.)));
        for (int i = 1; i <= 12; i++) { float f = float(i) / 12.; vec4 p = samp(uv + vec2(0., len * f)); float lp = luma(p.rgb) * (1. - .5 * f);
          if (lp > l && lp > .25) { c = p; l = lp; } }
        return c;
      }
      if (s == 5.) {                                                    // crt: barrel, shadow mask, scanlines, a rolling bar
        vec2 c = uv - .5; c *= 1. + .25 * A * dot(c, c); vec2 u = c + .5;
        vec4 col = samp(u); col.r = samp(u + vec2(.002 * A, 0.)).r; col.b = samp(u - vec2(.002 * A, 0.)).b;
        col.rgb *= mix(1., .6 + .4 * sin(u.y * uRes.y * 1.5708), A);
        float m = mod(floor(uv.x * uRes.x), 3.); col.rgb *= mix(vec3(1.), vec3(m == 0. ? 1. : .65, m == 1. ? 1. : .65, m == 2. ? 1. : .65), .7 * A);
        col.rgb *= 1. + .3 * A * exp(-pow((fract(u.y + uGTm * .12) - .5) * 10., 2.));
        return col;
      }
      if (s == 6.) {                                                    // corrupt: blocks swap channels, invert or lose bits
        vec2 bs = vec2(mix(24., 120., gh(vec2(10., 0.))), mix(3., 28., gh(vec2(11., 0.)))) / uRes, cell = floor(uv / bs);
        float h = gh(cell + 3.), k = gh(cell + 5.); vec4 c = samp(uv);
        if (h < .3 * A) c.rgb = k < .33 ? c.gbr : k < .66 ? c.brg : max(c.a - c.rgb, 0.);
        else if (h > 1. - .25 * A) c.rgb = floor(c.rgb * 3. + k) / 3.;
        return c;
      }
      return samp(uv);
    }
    void main(){
      vec2 uv = vUv, cell = floor(vUv * uRes / uPix);                   // retro: uPix buffer pixels per block (1 = off)
      if (uPix > 1.) uv = (cell + .5) * uPix / uRes;
      vec4 g = uGA > .001 ? glitch(uv) : samp(uv); vec3 col = g.rgb; float a = g.a;
      if (uRayA > .001) {   // the sun's materials: light shafts, its core's light scattered outward through the gaps in its own shape (the spikes and lobes cast the shadows between them)
        vec2 dl = (uRayC - uv) / 40.; vec2 pp = uv + dl * fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453); float dec = 1.; vec3 acc = vec3(0.);
        for (int i = 0; i < 40; i++) { pp += dl; vec3 sc = texture2D(uScene, pp).rgb; acc += sc * max(dot(sc, vec3(.3, .59, .11)) - .4, 0.) * dec; dec *= .975; }
        vec3 sh = acc / 40. * uRayA * uRayT * 7.;
        sh *= smoothstep(uMaskR, uMaskR * .64, length((uv - .5) * vec2(uRes.x / uRes.y, 1.)));   // inside its round window (full screen, wider)
        col += sh; a = max(a, clamp(dot(sh, vec3(.3, .59, .11)) * 1.6, 0., 1.));
      }
      if (uLev > 1.) {                                                  // colour depth: uLev levels a channel, a 4x4 ordered dither between them
        vec2 q = mod(cell, 4.); float b = mod(q.x * 4. + q.y * 7. + floor(q.y * .5) * 3., 16.) / 16. - .5;   // a 16-step ordered pattern
        vec4 v = vec4(col, a) * (uLev - 1.) + b * uDith;
        gl_FragColor = floor(v + .5) / (uLev - 1.);
      } else gl_FragColor = vec4(col, mix(a, 1., uImm));
    }`;
/* a memory's picture: the song's procedural skin unrolled (same GLSL as the body) */
export const UNWRAP_FRAG = `precision highp float; varying vec2 vUv; uniform sampler2D uSongTex, uSongGlow, uSongGene; uniform float uTime; uniform vec3 uDnaOff;
    ${SONG_GLSL}
    vec3 dirOf( vec2 uv ) { float lon = ( uv.x - .5 ) * 6.2831853, lat = ( uv.y - .5 ) * 3.14159265; return vec3( cos( lat ) * cos( lon ), sin( lat ), cos( lat ) * sin( lon ) ); }
    uniform sampler2D uSkinT; uniform samplerCube uMorphT; uniform float uLiving; uniform vec3 uLightC, uTint;
    uniform vec3 uSM, uSN, uSC, uSO;
    vec2 hgt( vec2 uv ) { vec2 m = textureCube( uMorphT, dirOf( uv ) ).rg, l = texture2D( uSkinT, uv ).rg; return mix( m, l, uLiving ); }
    void main() {   // the song's grown form (and its living skin) as a lit metal relief
      vec2 e = vec2( 1. / 512., 1. / 256. );
      vec2 h0 = hgt( vUv ); float h = h0.x, hx = hgt( vUv + vec2( e.x, 0. ) ).x, hy = hgt( vUv + vec2( 0., e.y ) ).x;
      float edge = h0.y;
      vec3 nr = normalize( vec3( ( h - hx ) * 14., ( h - hy ) * 14., 1. ) );
      float lit = max( dot( nr, normalize( vec3( -.4, .5, .8 ) ) ), 0. ), spec = pow( max( dot( reflect( - normalize( vec3( -.4, .5, .8 ) ), nr ), vec3( 0., 0., 1. ) ), 0. ), 24. );
      vec3 metal = vec3( .55, .56, .6 ) * ( .25 + .75 * lit ) * ( .45 + .55 * h ) + spec * .8;
      vec4 st = textureCube( uMorphT, dirOf( vUv ) ); float nuc = st.b * ( 1. - uLiving ), org = st.a * ( 1. - uLiving );
      vec3 fl = uSC * 2.5 * ( .35 + .65 * h ) + uSM * edge * 1.1 + uSN * nuc * .9 + uSO * org * .95;   // each structure in its own dye, on dark
      gl_FragColor = vec4( mix( metal * .22 * mix( vec3( 1. ), uSC * 5., .35 ), vec3( 0. ), .5 ) + ( 1. - exp( - fl * 1.4 ) ), 1. );
    }`;
