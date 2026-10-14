// being/morph-gl.mjs - bakes a morph genome (morph.mjs) into a cube map the body samples as height (r), edges (g) and a
// per-cell / per-feature variation (b). A cube map has no seams and no pinched poles, and at 384 px per face it carries
// about eight times the detail of the old 192 x 96 skin. The bake is a full-screen pass per face; the body reads it in
// its distance field (displacement), for ambient occlusion (height minus a blurred mip) and in every material.
import { CPPN_W, CPPN_UNITS, CPPN_LAYERS, cellCentres, cellFabric } from './morph.mjs';

const BAKE_GLSL = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform int uFace; uniform float uTime;
  uniform vec4 uW0, uW1;                       // family weights: (cppn, cells, pollen, turing), (lace, attractor, -, -)
  uniform vec3 uAxis; uniform float uSym, uMirror, uFreq, uCrisp;
  uniform vec4 uCW[ ${CPPN_W / 4} ]; uniform vec4 uCA[ ${(CPPN_LAYERS * CPPN_UNITS) / 4} ]; uniform vec3 uLatent;
  uniform vec4 uCells, uCells2, uPollen, uPollen2, uTuring, uLace, uMotion;
  uniform vec4 uPts[ 256 ];                    // cell centres (xyz) and tissue code (w: compartment + .5 rim + .49 variation)
  uniform sampler2D uAtt;                      // an attractor: r soft volume, g filaments, b nodes
  float gPx = .005;                            // the angle one texel covers (every edge is drawn about a texel wide, whatever the scale)

  vec3 faceDir( vec2 st ) {   // OpenGL cube map convention (sampled with the same convention by the body)
    vec2 c = st * 2. - 1.;
    if ( uFace == 0 ) return normalize( vec3( 1., - c.y, - c.x ) );
    if ( uFace == 1 ) return normalize( vec3( - 1., - c.y, c.x ) );
    if ( uFace == 2 ) return normalize( vec3( c.x, 1., c.y ) );
    if ( uFace == 3 ) return normalize( vec3( c.x, - 1., - c.y ) );
    if ( uFace == 4 ) return normalize( vec3( c.x, - c.y, 1. ) );
    return normalize( vec3( - c.x, - c.y, - 1. ) );
  }
  vec3 hash33( vec3 p ) { p = fract( p * vec3( .1031, .1030, .0973 ) ); p += dot( p, p.yxz + 33.33 ); return fract( ( p.xxy + p.yxx ) * p.zyx ); }
  float hash11( float x ) { return fract( sin( x * 127.1 + 311.7 ) * 43758.5453 ); }
  // the distance, in texels, of a scalar field's zero crossing (a crisp contour of constant width wherever the field is steep or flat)
  float texelDist( float v ) { return abs( v ) / max( length( vec2( dFdx( v ), dFdy( v ) ) ), 2e-4 ) + 40. * smoothstep( .25, .5, abs( v ) ); }   // a flat field has no contour
  // Worley: nearest and second-nearest feature distance in a 3D lattice (Worley 1996)
  vec2 worley( vec3 p ) {
    vec3 i = floor( p ), f = fract( p ); float d1 = 9., d2 = 9.;
    for ( int z = - 1; z <= 1; z++ ) for ( int y = - 1; y <= 1; y++ ) for ( int x = - 1; x <= 1; x++ ) {
      vec3 g = vec3( float( x ), float( y ), float( z ) ), o = hash33( i + g ), r = g + o - f; float d = dot( r, r );
      if ( d < d1 ) { d2 = d1; d1 = d; } else if ( d < d2 ) d2 = d;
    }
    return sqrt( vec2( d1, d2 ) );
  }
  float actf( float x, float c ) {
    if ( c < .5 ) return sin( x * 1.7 );
    if ( c < 1.5 ) return exp( - x * x );
    if ( c < 2.5 ) return abs( fract( x * .5 ) - .5 ) * 4. - 1.;
    if ( c < 3.5 ) return tanh( x );
    return abs( x ) - .8;
  }
  float codeAt( int i ) { vec4 v = uCA[ i / 4 ]; int k = i - ( i / 4 ) * 4; return k == 0 ? v.x : k == 1 ? v.y : k == 2 ? v.z : v.w; }
  // CPPN (Stanley 2007): 8 inputs (folded position, distance from the axis, a slowly moving latent, a bias), 3 layers of 8
  vec2 cppn( vec3 f, float ang ) {
    float F = uFreq * 1.6, tt = uMotion.x;
    vec4 a = vec4( f * F, ang * F * 1.3 ), b = vec4( sin( uLatent.x + tt * .21 ), sin( uLatent.y - tt * .17 ), cos( uLatent.z + tt * .13 ), 1. );
    for ( int L = 0; L < ${CPPN_LAYERS}; L++ ) {
      float h0, h1, h2, h3, h4, h5, h6, h7;
      int base = L * ${CPPN_UNITS};
      h0 = actf( dot( uCW[ ( base + 0 ) * 2 ], a ) + dot( uCW[ ( base + 0 ) * 2 + 1 ], b ), codeAt( base + 0 ) );
      h1 = actf( dot( uCW[ ( base + 1 ) * 2 ], a ) + dot( uCW[ ( base + 1 ) * 2 + 1 ], b ), codeAt( base + 1 ) );
      h2 = actf( dot( uCW[ ( base + 2 ) * 2 ], a ) + dot( uCW[ ( base + 2 ) * 2 + 1 ], b ), codeAt( base + 2 ) );
      h3 = actf( dot( uCW[ ( base + 3 ) * 2 ], a ) + dot( uCW[ ( base + 3 ) * 2 + 1 ], b ), codeAt( base + 3 ) );
      h4 = actf( dot( uCW[ ( base + 4 ) * 2 ], a ) + dot( uCW[ ( base + 4 ) * 2 + 1 ], b ), codeAt( base + 4 ) );
      h5 = actf( dot( uCW[ ( base + 5 ) * 2 ], a ) + dot( uCW[ ( base + 5 ) * 2 + 1 ], b ), codeAt( base + 5 ) );
      h6 = actf( dot( uCW[ ( base + 6 ) * 2 ], a ) + dot( uCW[ ( base + 6 ) * 2 + 1 ], b ), codeAt( base + 6 ) );
      h7 = actf( dot( uCW[ ( base + 7 ) * 2 ], a ) + dot( uCW[ ( base + 7 ) * 2 + 1 ], b ), codeAt( base + 7 ) );
      a = vec4( h0, h1, h2, h3 ) * 1.6; b = vec4( h4, h5, h6, h7 ) * 1.6;
    }
    int o = ${CPPN_LAYERS * CPPN_UNITS * 2};
    return vec2( dot( uCW[ o ], a ) + dot( uCW[ o + 1 ], b ), dot( uCW[ o + 2 ], a ) + dot( uCW[ o + 3 ], b ) );
  }
  // every structure answers (height, membranes, nuclei, organelles): the body stains each in its own dye
  vec4 cppnSkin( vec3 f, float ang ) {
    vec2 o = cppn( f, ang );
    float h = 1. / ( 1. + exp( - uCrisp * .45 * o.x ) ), w = 1.5;
    float line = 1. - smoothstep( w * .5, w * .5 + 1.1, texelDist( o.x ) ), fine = ( 1. - smoothstep( w * .4, w * .4 + 1., texelDist( o.y ) ) ) * smoothstep( .004, .02, length( vec2( dFdx( o.y ), dFdy( o.y ) ) ) );   // only where the second output really varies
    float blot = smoothstep( .86, .98, 1. / ( 1. + exp( - uCrisp * .3 * o.y ) ) ) * h * h * ( 1. - line );
    return vec4( h, line, blot, fine * ( 1. - line ) * .85 );
  }
  // nested tissue: cells (nearest / second-nearest centre) with thin walls, grouped in compartments with thick walls and a rim;
  // each cell has a nucleus (ellipse, nucleolus) and a few organelle specks, all of constant crisp width
  vec4 cells( vec3 d ) {
    float n = uCells.x, b1 = - 2., b2 = - 2.; vec4 p1 = vec4( 0., 1., 0., 0. ), p2 = p1;
    for ( int i = 0; i < 256; i++ ) {
      if ( float( i ) >= n ) break;
      vec4 P = uPts[ i ]; float k = dot( d, P.xyz );
      if ( k > b1 ) { b2 = b1; p2 = p1; b1 = k; p1 = P; } else if ( k > b2 ) { b2 = k; p2 = P; }
    }
    float a1 = acos( clamp( b1, - 1., 1. ) ), cellR = sqrt( 4. / n ), px = gPx;
    float db = ( b1 - b2 ) / max( length( p1.xyz - p2.xyz ), 1e-3 );   // distance to the border with the neighbour (radians)
    float c1 = floor( p1.w ), c2 = floor( p2.w ), fr = p1.w - c1, rim = step( .5, fr ), vr = clamp( ( fr - .5 * rim ) / .49, 0., 1. );
    float wc = min( .02, cellR * ( .03 + uCells.w * .35 ) );
    float thin = 1. - smoothstep( wc - px, wc + px, db );
    float sep = c1 != c2 ? 1. : 0.;
    float thick = sep * ( 1. - smoothstep( wc * 2.2 - px, wc * 2.2 + px, db ) );
    vec3 c = p1.xyz, t1 = normalize( cross( c, abs( c.y ) < .9 ? vec3( 0., 1., 0. ) : vec3( 1., 0., 0. ) ) ), t2 = cross( c, t1 );
    float th = 6.2831853 * vr; vec2 q = mat2( cos( th ), - sin( th ), sin( th ), cos( th ) ) * vec2( dot( d, t1 ), dot( d, t2 ) );   // the cell's own frame
    // nucleus: an ellipse, a chromatin tone and a nucleolus; epidermal cells have small ones; some cells show none
    float rN = cellR * ( .22 + .08 * fract( vr * 5.3 ) ) * ( 1. - .38 * rim ), has = step( fract( vr * 3.7 ), .3 + .7 * uCells2.x );
    float nm = ( 1. - smoothstep( rN - px, rN + px, length( q * vec2( 1., 1.2 ) ) ) ) * has;
    float nl = 1. - smoothstep( rN * .26 - px, rN * .26 + px, length( q - vec2( rN * .3, - rN * .15 ) ) );
    float nuc = nm * ( .74 + .26 * nl );
    // organelles: three specks scattered in the cytoplasm
    float org = 0.;
    for ( int k = 0; k < 3; k ++ ) {
      float fk = float( k ), ph = 6.2831853 * fract( vr * 7.31 + fk * .37 ), rho = .4 + .5 * fract( vr * 13.7 + fk * .61 ), rs = max( cellR * .05, px * 1.5 );
      org = max( org, 1. - smoothstep( rs - px, rs + px, length( q - vec2( cos( ph ), sin( ph ) ) * rho * cellR * .62 ) ) );
    }
    org *= ( 1. - nm ) * smoothstep( wc, wc * 3.5, db ) * mix( 1., .35, rim );
    // the rim (epidermis) walls stain with the organelle dye; the rest with the membrane dye, compartments strongest
    float mem = max( thin * mix( .8, .3, rim * ( 1. - sep ) ), thick );
    org = max( org, thin * rim * ( 1. - sep ) * .9 );
    float groove = smoothstep( 0., wc * 3.2, db ), dome = sqrt( max( 0., 1. - pow( clamp( a1 / ( cellR * 1.15 ), 0., 1. ), 2. ) ) );
    float cleft = sep > .5 ? smoothstep( 0., wc * 7., db ) : 1.;   // compartments are parted by a deeper cleft
    float h = .3 + .4 * mix( groove, dome * groove, uCells.z ) * cleft + ( hash11( c1 ) - .5 ) * .12 + nm * .26 * ( 1. - uCells.z * .5 ) - rim * .04;
    return vec4( h, mem, nuc, org );
  }
  // a pollen grain: spines (echinate) with bright tips, a reticulate net wall, pores (apertures) with raised rims, furrows (colpi)
  vec4 pollen( vec3 d, vec3 l, float phiRaw ) {
    float ns = uPollen.x, h = .5, mem = 0., nuc = 0., org = 0., px = gPx;
    if ( ns > 1. ) {
      float sc = pow( ns, .3333 ) * 1.25, pxl = px * sc; vec2 w = worley( d * sc );
      float sp = pow( clamp( 1. - w.x * 1.35, 0., 1. ), 1.2 + 3. * uPollen.y );
      h += sp * .55 * uPollen.y;
      org = max( org, 1. - smoothstep( .09 - pxl, .09 + pxl * 1.5, w.x ) );                                       // the spine's tip
      mem = max( mem, .55 * ( 1. - smoothstep( 0., pxl * 1.6 + .012, abs( w.x - .4 ) ) ) * uPollen.y );          // its base ring
    }
    if ( uPollen2.x > .02 ) {
      float sc = 7. + 9. * uFreq, pxl = px * sc; vec2 w = worley( d * sc );
      float net = 1. - smoothstep( .05 - pxl, .05 + pxl, ( w.y - w.x ) * .5 );                                      // the muri: a net of walls
      h += ( ( 1. - smoothstep( .0, .05 + pxl * 3., ( w.y - w.x ) * .5 ) ) - .4 ) * .3 * uPollen2.x; mem = max( mem, net * uPollen2.x );
      org = max( org, ( 1. - smoothstep( .05 - pxl, .06 + pxl, w.x ) ) * uPollen2.x * .8 );                         // a granule in each lumen
    }
    float np = uPollen.z;
    for ( int i = 0; i < 12; i++ ) {   // pores at a Fibonacci arrangement around the axis
      if ( float( i ) >= np ) break;
      float y = 1. - 2. * ( float( i ) + .5 ) / np, r = sqrt( 1. - y * y ), a = float( i ) * 2.39996;
      vec3 c = vec3( cos( a ) * r, y, sin( a ) * r ); float ang = acos( clamp( dot( l, c ), - 1., 1. ) ), pr = .16 + .25 / sqrt( np );
      float pore = 1. - smoothstep( pr - px, pr + px, ang );
      float rimm = 1. - smoothstep( 0., pr * .14 + px, abs( ang - pr * 1.1 ) );
      h += - pore * .45 + rimm * .2; mem = max( mem, rimm ); nuc = max( nuc, pore * ( .8 + .2 * smoothstep( .3, .0, ang / pr - .5 ) ) );
    }
    float nc = uPollen.w;
    if ( nc > .5 ) {   // colpi: long furrows along meridians, stopping short of the poles
      float seg = 6.2831853 / nc, dp = abs( mod( phiRaw + seg * .5, seg ) - seg * .5 ) * length( l.xz ), mk = smoothstep( .85, .55, abs( l.y ) );
      float fur = ( 1. - smoothstep( .06 - px, .06 + px, dp ) ) * mk;
      h -= fur * .5; nuc = max( nuc, fur * .85 ); mem = max( mem, ( 1. - smoothstep( 0., px * 1.4 + .012, abs( dp - .075 ) ) ) * mk );
    }
    return vec4( clamp( h, 0., 1. ), mem, nuc, org );
  }
  // Turing-like: band-limited waves (one wavelength, many directions) cut by a threshold: labyrinths, spots, holes.
  // Organised by the anatomy as on a pufferfish: stripes radiate from the song's poles (the mouth) and rings circle a second
  // focus (the eye); away from both the pattern stays isotropic. All weights vanish well before any crease: no seam.
  vec4 turing( vec3 d, vec3 l, float phiRaw ) {
    float s = 0.;
    for ( int i = 0; i < 28; i++ ) {
      vec3 k = normalize( hash33( vec3( float( i ) * 1.37, uTuring.w, 3.1 ) ) - .5 );
      s += cos( uTuring.x * dot( d, k ) + 6.2831853 * hash33( vec3( uTuring.w, float( i ), 7.7 ) ).x + uMotion.x * .35 * ( k.x - k.z ) );
    }
    s /= sqrt( 14. );
    float ang = acos( clamp( l.y, - 1., 1. ) );
    vec3 eye = normalize( vec3( cos( uTuring.w ), .6, sin( uTuring.w ) ) );
    float aE = acos( clamp( dot( l, eye ), - 1., 1. ) );
    float rays = cos( floor( uTuring.x * .75 ) * phiRaw + ( l.y < 0. ? 1.1 : 0. ) ) * 1.35, rings = cos( uTuring.x * .9 * aE + uMotion.x * .4 ) * 1.35;
    float wN = smoothstep( 1.35, .55, min( ang, 3.14159265 - ang ) ), wE = smoothstep( 1.25, .45, aE );
    float so = ( wN * rays + wE * rings ) / ( wN + wE + 1e-3 );
    s = mix( s, so, max( wN, wE ) * uTuring.z );
    float g = max( length( vec2( dFdx( s ), dFdy( s ) ) ), 1e-5 ), sd = ( s - uTuring.y ) / g;   // signed distance to the contour, in texels
    float soft = mix( 8., 3., clamp( ( uCrisp - 3. ) / 16., 0., 1. ) );   // the plateau's slope (the body displaces by it); the contour line stays crisp
    float h = smoothstep( - soft, soft, sd );
    float line = 1. - smoothstep( 1.1, 2.7, abs( sd ) );
    float halo = ( 1. - smoothstep( 1., 2.4, abs( ( s - uTuring.y - .5 * ( wN + wE ) - .45 ) / g ) ) ) * ( 1. - line );
    return vec4( .18 + .62 * h, line, smoothstep( 5., 13., sd ), halo * .9 );
  }
  // circle-inversion lace (an Apollonian limit set) on the stereographic plane of each hemisphere
  vec4 laceHemi( vec3 f, float hemi ) {
    vec2 q = f.xz / ( 1. + hemi * f.y ) + ( hemi < 0. ? vec2( .41, -.23 ) : vec2( 0. ) );
    float c = cos( uLace.z + uMotion.x * .05 ), s = sin( uLace.z + uMotion.x * .05 );
    q = mat2( c, - s, s, c ) * q * ( 1.2 + uLace.y * 1.6 ) + vec2( .31, .17 );
    float scale = 1., ls = uLace.x;
    for ( int i = 0; i < 9; i++ ) {
      q = - 1. + 2. * fract( .5 * q + .5 );
      float r2 = max( dot( q, q ), 1e-4 ), k = ls / r2; q *= k; scale *= k;
    }
    float dist = .25 * abs( q.y ) / scale, w = max( .006 + .01 / uCrisp, gPx * 1.6 ), line = 1. - smoothstep( 0., w, dist );
    float deep = smoothstep( 3.2, 5.2, log( scale ) );   // the smallest circles of the nest: their outlines stain with the organelle dye, their insides with the nuclear dye
    return vec4( .3 + .65 * ( 1. - smoothstep( 0., w * 4., dist ) ), line * ( 1. - deep ), ( 1. - line ) * deep * .8, line * deep );
  }
  vec4 lace( vec3 f ) { float w = smoothstep( -.3, .3, f.y ); return mix( laceHemi( f, -1. ), laceHemi( f, 1. ), w ); }   // no seam at the equator
  // a strange attractor drawn as filaments, wrapped around the axis (repeated by the symmetry, like a mandala)
  vec4 attractor( vec3 f ) {
    float ph = atan( f.z, f.x ) + uMotion.x * .03;
    float an = acos( clamp( f.y, -1., 1. ) ) / 1.5707963, as = acos( clamp( -f.y, -1., 1. ) ) / 1.5707963;   // from each pole
    vec2 un = .5 + .48 * min( an, 1.2 ) * vec2( cos( ph ), sin( ph ) ), us = .5 + .48 * min( as, 1.2 ) * vec2( cos( -ph + 1.3 ), sin( -ph + 1.3 ) );
    vec4 t = mix( texture2D( uAtt, us ), texture2D( uAtt, un ), smoothstep( -.3, .3, f.y ) );   // blended, no seam at the equator
    return vec4( .3 + .3 * t.r + .22 * t.g, t.g, t.b * ( .35 + .65 * t.g ), t.r * .5 * ( 1. - t.g ) );
  }
  void main() {
    vec3 d = faceDir( vUv );
    gPx = max( length( dFdx( d ) ), length( dFdy( d ) ) );
    vec3 ax = normalize( uAxis ), tx = normalize( abs( ax.y ) < .99 ? cross( ax, vec3( 0., 1., 0. ) ) : cross( ax, vec3( 1., 0., 0. ) ) ), bz = cross( ax, tx );
    vec3 l = vec3( dot( d, tx ), dot( d, ax ), dot( d, bz ) );
    float phiRaw = atan( l.z, l.x ), rho = length( l.xz );
    // the song's symmetry without seams: the angle about the axis is multiplied, not folded (a kaleidoscope fold leaves
    // a hard line at every fold, which drew a star around the pole); mirror symmetry uses an even, smooth function
    float an = phiRaw * max( uSym, 1. );
    vec3 f = vec3( rho * cos( an ), l.y, rho * ( uMirror > .5 ? sin( an ) * sin( an ) * 2. - 1. : sin( an ) ) );
    vec4 acc = vec4( 0. ); float wsum = 1e-4;
    if ( uW0.x > .01 ) { acc += uW0.x * cppnSkin( f, acos( clamp( l.y, - 1., 1. ) ) ); wsum += uW0.x; }
    if ( uW0.y > .01 ) { acc += uW0.y * cells( d ); wsum += uW0.y; }
    if ( uW0.z > .01 ) { acc += uW0.z * pollen( d, l, phiRaw ); wsum += uW0.z; }
    if ( uW0.w > .01 ) { acc += uW0.w * turing( d, l, phiRaw ); wsum += uW0.w; }
    if ( uW1.x > .01 ) { acc += uW1.x * lace( f ); wsum += uW1.x; }
    if ( uW1.y > .01 ) { acc += uW1.y * attractor( f ); wsum += uW1.y; }
    // r: height, g: membranes / edges, b: nuclei, a: organelles / third structure
    gl_FragColor = acc / wsum;
  }
`;

export function createMorph(renderer, THREE, { size = 384, mipmaps = true, half = true } = {}) {
  const rt = new THREE.WebGLCubeRenderTarget(size, { type: half ? THREE.HalfFloatType : THREE.UnsignedByteType, format: THREE.RGBAFormat, generateMipmaps: mipmaps, minFilter: mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
  const ATT = 768, attData = new Uint8Array(ATT * ATT * 4);   // 768: the filaments stay about a texel wide when wrapped around a pole
  const attTex = new THREE.DataTexture(attData, ATT, ATT, THREE.RGBAFormat); attTex.magFilter = attTex.minFilter = THREE.LinearFilter; attTex.needsUpdate = true;
  const U = {
    uFace: { value: 0 }, uTime: { value: 0 }, uW0: { value: new THREE.Vector4(0, 1, 0, 0) }, uW1: { value: new THREE.Vector4() },
    uAxis: { value: new THREE.Vector3(0, 1, 0) }, uSym: { value: 1 }, uMirror: { value: 0 }, uFreq: { value: 1 }, uCrisp: { value: 6 },
    uCW: { value: Array.from({ length: CPPN_W / 4 }, () => new THREE.Vector4()) }, uCA: { value: Array.from({ length: (CPPN_LAYERS * CPPN_UNITS) / 4 }, () => new THREE.Vector4()) },
    uLatent: { value: new THREE.Vector3() },
    uCells: { value: new THREE.Vector4(8, .5, .5, .08) }, uCells2: { value: new THREE.Vector4() },
    uPollen: { value: new THREE.Vector4() }, uPollen2: { value: new THREE.Vector4() }, uTuring: { value: new THREE.Vector4(20, 0, 0, 1) },
    uLace: { value: new THREE.Vector4(1.1, 1, 0, 0) }, uMotion: { value: new THREE.Vector4() },
    uPts: { value: Array.from({ length: 256 }, () => new THREE.Vector4(0, 1, 0, 0)) }, uAtt: { value: attTex },
  };
  const mat = new THREE.ShaderMaterial({ uniforms: U, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }', fragmentShader: BAKE_GLSL });
  const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  const state = { cellsKey: '', attKey: '', genome: null, cellN: 0, attMs: 0 };

  function setCells(n, jitter, seed, cg = {}, axis = [0, 1, 0]) {
    const layout = Math.round(cg.layout || 0), comps = cg.comps || 6, sectors = cg.sectors || 7;
    const key = `${n}|${jitter.toFixed(2)}|${seed}|${layout}|${comps}|${sectors}|${layout ? axis.map((v) => v.toFixed(1)).join() : ''}`;
    if (key === state.cellsKey) return;
    state.cellsKey = key;
    const P = cellCentres(n, jitter, seed), code = cellFabric(P, { layout, comps, sectors, axis, seed });
    for (let i = 0; i < 256; i++) { const p = P[i] || [0, 1, 0]; U.uPts.value[i].set(p[0], p[1], p[2], code[i] || 0); }
    U.uCells.value.x = P.length; state.cellN = P.length;
  }
  // attractor densities take tens of ms: a worker computes them, the texture updates when one arrives
  const worker = new Worker(new URL('./morph-worker.mjs', import.meta.url), { type: 'module' });
  let attAsked = 0;
  worker.onmessage = (e) => {
    if (e.data.key !== state.attKey) return;   // an older request: the song has moved on
    attData.set(e.data.tex);
    attTex.needsUpdate = true; state.attMs = performance.now() - attAsked;
  };
  worker.onerror = (e) => console.error('morph worker:', e.message);
  function setAttractor(spec) {
    const key = `${spec.kind}|${spec.seed}`;
    if (key === state.attKey) return;
    state.attKey = key; attAsked = performance.now();
    worker.postMessage({ spec, size: ATT, points: 600000, key });
  }
  /**
   * @param g genome (morph.mjs); cellN the current cell count (cleavage), cellSeed a seed for the mosaic
   */
  function setGenome(g, { cellN = null, cellSeed = 1 } = {}) {
    if (!g) return;
    state.genome = g;
    U.uW0.value.set(g.w.cppn || 0, g.w.cells || 0, g.w.pollen || 0, g.w.turing || 0);
    U.uW1.value.set(g.w.lace || 0, g.w.attractor || 0, 0, 0);
    U.uAxis.value.set(g.axis[0], g.axis[1], g.axis[2]);
    U.uSym.value = g.sym === 6 ? 5 : g.sym === 12 ? 7 : g.sym; U.uMirror.value = g.mirror; U.uFreq.value = g.freq; U.uCrisp.value = g.crisp;
    for (let i = 0; i < CPPN_W / 4; i++) U.uCW.value[i].set(g.cppn.W[i * 4], g.cppn.W[i * 4 + 1], g.cppn.W[i * 4 + 2], g.cppn.W[i * 4 + 3]);
    for (let i = 0; i < U.uCA.value.length; i++) U.uCA.value[i].set(g.cppn.act[i * 4], g.cppn.act[i * 4 + 1], g.cppn.act[i * 4 + 2], g.cppn.act[i * 4 + 3]);
    U.uLatent.value.set(g.cppn.latent[0], g.cppn.latent[1], g.cppn.latent[2]);
    if ((g.w.cells || 0) > 0.01) setCells(cellN == null ? g.cells.n : cellN, g.cells.jitter, cellSeed, g.cells, g.axis);
    U.uCells.value.set(state.cellN || 8, g.cells.jitter, g.cells.dome, g.cells.wall); U.uCells2.value.set(g.cells.nucleus, 0, 0, 0);
    U.uPollen.value.set(g.pollen.spines, g.pollen.spineH, g.pollen.pores, g.pollen.colpi); U.uPollen2.value.set(g.pollen.reticulum, 0, 0, 0);
    U.uTuring.value.set(g.turing.k, g.turing.thr, g.turing.radial, g.turing.seed % 997);
    U.uLace.value.set(g.lace.s, g.lace.scale, g.lace.twist, 0);
    if ((g.w.attractor || 0) > 0.01 && g.attractor) setAttractor(g.attractor);
  }
  /** bake all six faces; motion: flow time (x), felt pulse phase (y), bass (z), arousal (w) */
  function bake(time, motion) {
    U.uTime.value = time;
    if (motion) U.uMotion.value.copy(motion);
    const prev = renderer.getRenderTarget(), prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    for (let f = 0; f < 6; f++) { U.uFace.value = f; renderer.setRenderTarget(rt, f); renderer.render(scene, cam); }
    renderer.setRenderTarget(prev); renderer.autoClear = prevAuto;
  }
  return { texture: rt.texture, setGenome, bake, state, uniforms: U, size };
}
