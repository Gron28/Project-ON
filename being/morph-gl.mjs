// being/morph-gl.mjs - bakes a morph genome (morph.mjs) into a cube map the body samples as height (r), edges (g) and a
// per-cell / per-feature variation (b). A cube map has no seams and no pinched poles, and at 384 px per face it carries
// about eight times the detail of the old 192 x 96 skin. The bake is a full-screen pass per face; the body reads it in
// its distance field (displacement), for ambient occlusion (height minus a blurred mip) and in every material.
import { FAMILIES as FAMILY_KEYS, CPPN_W, CPPN_UNITS, CPPN_LAYERS, cellCentres, cellFabric } from './morph.mjs';

const BAKE_GLSL = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform int uFace; uniform float uTime;
  uniform vec4 uW0, uW1;                       // family weights: (cppn, cells, pollen, turing), (lace, attractor, -, -)
  uniform vec3 uAxis; uniform float uSym, uMirror, uFreq, uCrisp;
  uniform vec4 uCW[ ${CPPN_W / 4} ]; uniform vec4 uCA[ ${(CPPN_LAYERS * CPPN_UNITS) / 4} ]; uniform vec3 uLatent;
  uniform vec4 uCells, uCells2, uPollen, uPollen2, uTuring, uLace, uLace2, uMotion;
  uniform vec4 uImpA, uImpB, uImpC;              // the elements the song lived through: fire water air earth | saturn jupiter mars sun | venus mercury moon -
  uniform vec4 uPts[ 256 ];                    // cell centres (xyz) and tissue code (w: compartment + .5 rim + .49 variation)
  uniform sampler2D uAtt;
  uniform samplerCube uPrev; uniform float uX;   // cross-fade: the previous skin, frozen when something discrete changed                      // an attractor: r soft volume, g filaments, b nodes
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
  // ---- the fractal family (genome 'lace'): fifteen kinds on the stereographic plane of each hemisphere (its unit disc) ----
  //  0 Apollonian circles · 1 Kleinian / Mandelbox folds · 2 Julia · 3 Mandelbrot detail · 4 Burning Ship · 5 Newton basins ·
  //  6 Sierpinski triangle · 7 pentaflake · 8 hexaflake · 9 Sierpinski carpet · 10 tricorn · 11 Phoenix · 12 Doyle spiral ·
  //  13 hyperbolic tiling {p,q} · 14 Julia pearls (orbit traps). uLace = (s, scale, twist, kind), uLace2 = parameters.
  vec2 cmul( vec2 a, vec2 b ) { return vec2( a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x ); }
  vec2 cdiv( vec2 a, vec2 b ) { float d = max( dot( b, b ), 1e-10 ); return vec2( a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y ) / d; }
  // a set drawn by its distance d (plane units): the edge a crisp line, the inside filled, a trap for the third structure
  vec4 fracOut( float d, float inside, float trap, float jac ) {
    float w = max( .006 + .01 / uCrisp, gPx * 1.6 ) * jac, line = 1. - smoothstep( 0., w, d );
    float h = .3 + .65 * ( 1. - smoothstep( 0., w * 4., d ) ) * ( 1. - inside ) + .62 * inside;
    return vec4( h, line * ( 1. - .6 * inside ), ( 1. - line ) * inside * .8, clamp( trap, 0., 1. ) * ( 1. - line ) * .7 );
  }
  // an escape-time set drawn by its bands (smooth iteration count n): an edge wherever a band changes, a texel wide
  vec4 bandsOut( float n, float inside, float trap ) {
    float b = n * .3, fw = max( abs( dFdx( b ) ) + abs( dFdy( b ) ), 1e-4 );
    float line = ( 1. - smoothstep( .9, 2.4, ( .5 - abs( fract( b ) - .5 ) ) / fw ) ) * ( 1. - inside ) * smoothstep( .3, 1.5, 1. / fw * .02 + .5 );
    return vec4( .28 + .42 * fract( b ) * ( 1. - inside ) + .6 * inside, line, inside * .8, clamp( trap, 0., 1. ) * ( 1. - inside ) * .7 );
  }
  vec4 fractalHemi( vec3 f, float hemi ) {
    float jac = 1. / max( 1. + hemi * f.y, .05 );   // plane units per sphere unit here
    vec2 q0 = f.xz * jac, q = q0 + ( hemi < 0. ? vec2( .41, -.23 ) : vec2( 0. ) );
    float c_ = cos( uLace.z + uMotion.x * .05 ), s_ = sin( uLace.z + uMotion.x * .05 );
    q = mat2( c_, - s_, s_, c_ ) * q;
    int kind = int( uLace.w + .5 );
    vec2 P = uLace2.xy; float Z = uLace2.z;
    if ( kind == 1 ) {   // Kleinian / Mandelbox folds: box folds and circle inversions
      float k = 1.5 + uLace.y * 2.; vec2 z = q * k, c0 = z; float dr = 1., S = -1.5 - P.x * .9, trap = 1e9;
      for ( int i = 0; i < 12; i++ ) { z = clamp( z, -1., 1. ) * 2. - z; float r2 = dot( z, z ); if ( r2 < .25 ) { z *= 4.; dr *= 4.; } else if ( r2 < 1. ) { z /= r2; dr /= r2; } z = z * S + c0; dr = dr * abs( S ) + 1.; trap = min( trap, abs( length( z ) - 1. ) ); }
      float d = ( length( z ) - 2. ) / abs( dr );
      return fracOut( abs( d ) / k, d < 0. ? 1. : 0., exp( - trap * 2. ), jac );
    }
    if ( kind == 2 || kind == 14 ) {   // Julia (2: the set's edge; 14: pearls, its orbits caught by circles)
      float k = .9 + uLace.y * .8; vec2 z = q * k, dz = vec2( 1., 0. ); float trap = 1e9, pearl = 1e9; bool esc = false;
      for ( int i = 0; i < 64; i++ ) {
        dz = 2. * cmul( z, dz ); z = cmul( z, z ) + P;
        trap = min( trap, length( z ) ); pearl = min( pearl, abs( length( z - vec2( .2, 0. ) ) - Z ) / max( length( dz ), 1e-6 ) );
        if ( dot( z, z ) > 256. ) { esc = true; break; }
      }
      if ( kind == 14 ) return fracOut( pearl / k, 0., exp( - trap * 2. ), jac );
      float r = length( z ), d = esc ? .5 * r * log( r ) / max( length( dz ), 1e-8 ) : 0.;
      return fracOut( d / k, esc ? 0. : 1., exp( - trap * 3. ), jac );
    }
    if ( kind == 3 ) {   // a detail of the Mandelbrot set
      vec2 c = P + q * Z, z = vec2( 0. ), dz = vec2( 0. ); float trap = 1e9; bool esc = false;
      for ( int i = 0; i < 96; i++ ) { dz = 2. * cmul( z, dz ) + vec2( 1., 0. ); z = cmul( z, z ) + c; trap = min( trap, length( z ) ); if ( dot( z, z ) > 256. ) { esc = true; break; } }
      float r = length( z ), d = esc ? .5 * r * log( r ) / max( length( dz ), 1e-8 ) : 0.;
      return fracOut( d / Z, esc ? 0. : 1., exp( - trap * 3. ), jac );
    }
    if ( kind == 4 || kind == 10 || kind == 11 ) {   // escape-time sets drawn by their bands: Burning Ship, tricorn, Phoenix
      vec2 z = kind == 11 ? q * ( 1. + uLace.y * .6 ) : vec2( 0. ), zp = vec2( 0. ), c = kind == 11 ? vec2( P.x, 0. ) : P + q * Z; float n = 0., trap = 1e9; bool esc = false;
      for ( int i = 0; i < 80; i++ ) {
        vec2 zn;
        if ( kind == 4 ) { vec2 a = abs( z ); zn = vec2( a.x * a.x - a.y * a.y, 2. * a.x * a.y ) + c; }
        else if ( kind == 10 ) { zn = vec2( z.x * z.x - z.y * z.y, -2. * z.x * z.y ) + c; }
        else { zn = cmul( z, z ) + c + P.y * zp; zp = z; }
        z = zn; trap = min( trap, length( z ) );
        if ( dot( z, z ) > 256. ) { esc = true; break; } n += 1.;
      }
      if ( esc ) n = n + 1. - log2( log2( max( dot( z, z ), 1.0001 ) ) * .5 );
      return bandsOut( n, esc ? 0. : 1., exp( - trap * 2. ) );
    }
    if ( kind == 5 ) {   // Newton basins of z^3 = 1 (relaxed by P.x): each root its own colour, the boundaries a fractal lace
      vec2 z = q * ( 1.6 + uLace.y ); float n = 0., a = 1. + P.x * .6;
      for ( int i = 0; i < 32; i++ ) { vec2 z2 = cmul( z, z ), dz = a * cdiv( cmul( z2, z ) - vec2( 1., 0. ), 3. * z2 ); z -= dz; if ( dot( dz, dz ) < 1e-6 ) break; n += 1.; }
      float id = z.x > 0. ? 0. : z.y > 0. ? 1. : 2., fw = abs( dFdx( id ) ) + abs( dFdy( id ) );
      float edge = smoothstep( .01, .5, fw ), band = fract( n * .2 );
      return vec4( .3 + .2 * id + .2 * band, edge, ( 1. - edge ) * step( 1.5, id ) * .8, ( 1. - edge ) * step( .5, id ) * step( id, 1.5 ) * .6 );
    }
    if ( kind >= 6 && kind <= 8 ) {   // n-gon IFS: Sierpinski triangle (3, 1/2), pentaflake (5, 1/2.618), hexaflake (6, 1/3)
      int N = kind == 6 ? 3 : kind == 7 ? 5 : 6; float K = kind == 6 ? 2. : kind == 7 ? 2.618 : 3., k = 1.1 + uLace.y * .7;
      vec2 z = q * k; float s = 1., trap = 1e9;
      for ( int i = 0; i < 9; i++ ) {
        vec2 best = vec2( 0. ); float bd = 1e9;
        for ( int j = 0; j < 6; j++ ) { if ( j >= N ) break; float a = 6.2831853 * float( j ) / float( N ) + 1.5707963 + P.x; vec2 v = vec2( cos( a ), sin( a ) ); float dd = length( z - v ); if ( dd < bd ) { bd = dd; best = v; } }
        z = best + ( z - best ) * K; s *= K; trap = min( trap, bd );
      }
      float d = ( length( z ) - 1.2 ) / s;
      return fracOut( abs( d ) / k, d < 0. ? 1. : 0., exp( - trap * 4. ), jac );
    }
    if ( kind == 9 ) {   // Sierpinski carpet
      float k = 1.05 + uLace.y * .5; vec2 z = q * k, b = abs( z ) - 1.; float d = length( max( b, 0. ) ) + min( max( b.x, b.y ), 0. ), s = 1.;
      for ( int i = 0; i < 5; i++ ) { vec2 a = mod( z * s, 2. ) - 1.; s *= 3.; vec2 r = abs( 1. - 3. * abs( a ) ); d = max( d, ( min( r.x, r.y ) - 1. ) / s ); }
      return fracOut( abs( d ) / k, d < 0. ? 1. : 0., 0., jac );
    }
    if ( kind == 12 ) {   // Doyle spiral: circles packed along log-spirals, shrinking into the pole
      float r = max( length( q ), 1e-4 ), th = atan( q.y, q.x ), n = floor( P.x ), m = floor( P.y ), tw = 6.2831853;
      vec2 u = vec2( log( r ) * n / tw + th * m / tw, th * n / tw - log( r ) * m / tw * .3 + uMotion.x * .02 );
      vec2 g = fract( u ) - .5; float dl = length( g ) - .42, d = dl * r * tw / n;
      return fracOut( abs( d ), dl < 0. ? 1. : 0., smoothstep( .42, 0., length( g ) ) * .6, jac );
    }
    if ( kind == 13 ) {   // hyperbolic tiling {p,q} of the Poincare disc (Escher's Circle Limit): each hemisphere is one disc
      vec2 z = q0 * .985; float pp = floor( P.x ), qq = floor( P.y ), al = 3.14159265 / pp, be = 3.14159265 / qq;
      float c = cos( be ) / sqrt( max( cos( be ) * cos( be ) - sin( al ) * sin( al ), 1e-4 ) ), R2 = c * c - 1.;
      vec2 nL = vec2( - sin( al ), cos( al ) ); float flips = 0.;
      for ( int i = 0; i < 48; i++ ) {
        bool ok = true;
        if ( z.y < 0. ) { z.y = - z.y; flips += 1.; ok = false; }
        float dl = dot( z, nL ); if ( dl > 0. ) { z -= 2. * dl * nL; flips += 1.; ok = false; }
        vec2 dz = z - vec2( c, 0. ); float r2 = dot( dz, dz ); if ( r2 < R2 ) { z = vec2( c, 0. ) + dz * R2 / r2; flips += 1.; ok = false; }
        if ( ok ) break;
      }
      float d = min( min( z.y, - dot( z, nL ) ), length( z - vec2( c, 0. ) ) - sqrt( R2 ) ) * ( 1. - dot( q0, q0 ) ) * .5;
      return fracOut( abs( d ), mod( flips, 2. ), smoothstep( .3, 0., length( z ) ) * .5, jac );
    }
    // 0: Apollonian circles (circle inversions)
    q = q * ( 1.2 + uLace.y * 1.6 ) + vec2( .31, .17 );
    float scale = 1., ls = uLace.x;
    for ( int i = 0; i < 9; i++ ) {
      q = - 1. + 2. * fract( .5 * q + .5 );
      float r2 = max( dot( q, q ), 1e-4 ), k = ls / r2; q *= k; scale *= k;
    }
    float dist = .25 * abs( q.y ) / scale, w = max( .006 + .01 / uCrisp, gPx * 1.6 ), line = 1. - smoothstep( 0., w, dist );
    float deep = smoothstep( 3.2, 5.2, log( scale ) );   // the smallest circles of the nest: their outlines stain with the organelle dye, their insides with the nuclear dye
    return vec4( .3 + .65 * ( 1. - smoothstep( 0., w * 4., dist ) ), line * ( 1. - deep ), ( 1. - line ) * deep * .8, line * deep );
  }
  vec4 lace( vec3 f ) {   // no seam at the equator; only the hemispheres that show are computed
    float w = smoothstep( -.3, .3, f.y );
    if ( w < .001 ) return fractalHemi( f, -1. ); if ( w > .999 ) return fractalHemi( f, 1. );
    return mix( fractalHemi( f, -1. ), fractalHemi( f, 1. ), w );
  }
  // the elements a song lived through, imprinted in its skin: each one's own trace, as deep as the time the song spent in it
  vec4 imprint( vec3 d ) {
    float h = 0., e = 0., ph = atan( d.z, d.x );
    if ( uImpA.x > .01 ) { vec2 w = worley( d * 7. ); float c = 1. - smoothstep( 0., .07, w.y - w.x ); h += uImpA.x * ( .5 * ( w.y - w.x ) - .1 ); e = max( e, uImpA.x * c ); }   // fire: the crackle of a cooled crust
    if ( uImpA.y > .01 ) { float r = sin( dot( d, normalize( vec3( .3, .8, .5 ) ) ) * 40. + 2. * sin( d.x * 6. + d.z * 5. ) ); h += uImpA.y * .08 * r; e = max( e, uImpA.y * smoothstep( .85, 1., r ) * .6 ); }   // water: ripple rings
    if ( uImpA.z > .01 ) { float rg = fract( acos( clamp( d.y, -1., 1. ) ) * 14. + 1.5 * sin( ph * 3. + d.y * 4. ) ); h -= uImpA.z * .12 * smoothstep( .6, .95, rg ); e = max( e, uImpA.z * smoothstep( .9, .97, rg ) ); }   // earth: growth rings
    if ( uImpA.w > .01 ) { float sw = sin( d.y * 30. + 4. * sin( ph * 2. + d.y * 3. ) ); h += uImpA.w * .03 * sw; e = max( e, uImpA.w * smoothstep( .9, 1., sw ) * .5 ); }   // air: wind-combed wisps
    if ( uImpB.x > .01 ) e = max( e, uImpB.x * smoothstep( .03, 0., abs( sin( ph * 6. ) ) ) );   // saturn: meridians
    if ( uImpB.y > .01 ) h += uImpB.y * .06 * sin( d.y * 22. + 2. * sin( ph * 2. ) );   // jupiter: bands
    if ( uImpB.z > .01 ) { vec2 w = worley( d * 4. + 2. ); float r = 1. - smoothstep( 0., .12, w.y - w.x ); h += uImpB.z * .1 * r; e = max( e, uImpB.z * r * .5 ); }   // mars: ridges
    if ( uImpB.w > .01 ) { vec2 w = worley( d * 12. + 5. ); h += uImpB.w * .1 * smoothstep( 0., .5, w.y - w.x ); }   // the sun: granulation
    if ( uImpC.x > .01 ) { vec2 w = worley( d * 3. + 9. ); h += uImpC.x * .08 * smoothstep( .6, .1, w.x ); }   // venus: soft swells
    if ( uImpC.y > .01 ) { vec2 w = worley( d * 9. + 3. ); e = max( e, uImpC.y * ( 1. - smoothstep( 0., .03, w.y - w.x ) ) * .7 ); }   // mercury: veins
    if ( uImpC.z > .01 ) { vec2 w = worley( d * 6. + 7. ); h -= uImpC.z * .1 * smoothstep( .32, .2, w.x ); e = max( e, uImpC.z * smoothstep( .04, 0., abs( w.x - .3 ) ) * .6 ); }   // the moon: craters
    return vec4( h, e, 0., 0. );
  }
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
    vec4 cur = acc / wsum;
    if ( dot( uImpA + uImpB + uImpC, vec4( 1. ) ) > .01 ) { vec4 imp = imprint( d ); cur.r += imp.x; cur.g = max( cur.g, imp.y ); cur.a = max( cur.a, imp.y * .5 ); }   // the song's history of elements
    if ( uX < 1. ) cur = mix( textureLod( uPrev, d, 0. ), cur, smoothstep( 0., 1., uX ) );   // discrete changes dissolve instead of popping
    gl_FragColor = cur;
  }
`;

export function createMorph(renderer, THREE, { size = 384, mipmaps = true, half = true, fade = 1.8 } = {}) {
  const rt = new THREE.WebGLCubeRenderTarget(size, { type: half ? THREE.HalfFloatType : THREE.UnsignedByteType, format: THREE.RGBAFormat, generateMipmaps: false, minFilter: mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
  const ATT = 768, attData = new Uint8Array(ATT * ATT * 4);   // 768: the filaments stay about a texel wide when wrapped around a pole
  const attTex = new THREE.DataTexture(attData, ATT, ATT, THREE.RGBAFormat); attTex.magFilter = attTex.minFilter = THREE.LinearFilter; attTex.needsUpdate = true;
  const U = {
    uFace: { value: 0 }, uTime: { value: 0 }, uW0: { value: new THREE.Vector4(0, 1, 0, 0) }, uW1: { value: new THREE.Vector4() },
    uAxis: { value: new THREE.Vector3(0, 1, 0) }, uSym: { value: 1 }, uMirror: { value: 0 }, uFreq: { value: 1 }, uCrisp: { value: 6 },
    uCW: { value: Array.from({ length: CPPN_W / 4 }, () => new THREE.Vector4()) }, uCA: { value: Array.from({ length: (CPPN_LAYERS * CPPN_UNITS) / 4 }, () => new THREE.Vector4()) },
    uLatent: { value: new THREE.Vector3() },
    uCells: { value: new THREE.Vector4(8, .5, .5, .08) }, uCells2: { value: new THREE.Vector4() },
    uPollen: { value: new THREE.Vector4() }, uPollen2: { value: new THREE.Vector4() }, uTuring: { value: new THREE.Vector4(20, 0, 0, 1) },
    uLace: { value: new THREE.Vector4(1.1, 1, 0, 0) }, uLace2: { value: new THREE.Vector4() }, uImpA: { value: new THREE.Vector4() }, uImpB: { value: new THREE.Vector4() }, uImpC: { value: new THREE.Vector4() }, uMotion: { value: new THREE.Vector4() },
    uPts: { value: Array.from({ length: 256 }, () => new THREE.Vector4(0, 1, 0, 0)) }, uAtt: { value: attTex },
    uPrev: { value: null }, uX: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({ uniforms: U, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }', fragmentShader: BAKE_GLSL });
  const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  const state = { cellsKey: '', attKey: '', genome: null, cellN: 0, attMs: 0, sig: '', fading: false, bakes: 0, deferred: 0 };
  // ---- cross-fade: a frozen copy of the skin to dissolve from, whenever something discrete changes ---------------------
  const snap = new THREE.WebGLCubeRenderTarget(size, { type: half ? THREE.HalfFloatType : THREE.UnsignedByteType, format: THREE.RGBAFormat, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
  U.uPrev.value = snap.texture;
  const CU = { uFace: { value: 0 }, uSrc: { value: rt.texture } };
  const copyScene = new THREE.Scene();
  copyScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: CU, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: `precision highp float; varying vec2 vUv; uniform int uFace; uniform samplerCube uSrc;
      vec3 faceDir( vec2 st ) { vec2 c = st * 2. - 1.;
        if ( uFace == 0 ) return normalize( vec3( 1., - c.y, - c.x ) ); if ( uFace == 1 ) return normalize( vec3( - 1., - c.y, c.x ) );
        if ( uFace == 2 ) return normalize( vec3( c.x, 1., c.y ) ); if ( uFace == 3 ) return normalize( vec3( c.x, - 1., - c.y ) );
        if ( uFace == 4 ) return normalize( vec3( c.x, - c.y, 1. ) ); return normalize( vec3( - c.x, - c.y, - 1. ) ); }
      void main() { gl_FragColor = textureLod( uSrc, faceDir( vUv ), 0. ); }` })));
  let baked = false, lastTime = null, stale = false;
  function freeze() {   // copy what is showing now; the next bakes dissolve from it
    if (!baked && !stale) return;
    if (stale) render();  // a deferred bake not drawn yet: bring it up to date first, so the dissolve starts from what would have shown
    const prev = renderer.getRenderTarget();
    for (let f = 0; f < 6; f++) { CU.uFace.value = f; renderer.setRenderTarget(snap, f); renderer.render(copyScene, cam); }
    renderer.setRenderTarget(prev);
    U.uX.value = 0; state.fading = true;
  }
  const signature = (g, n) => [FAMILY_KEYS.map((f) => ((g.w[f] || 0) > 0.01 ? f : '')).join(''), g.sym, g.mirror, g.cppn.act.join(''), n, g.cells && g.cells.layout, g.attractor && g.attractor.kind, g.attractor && g.attractor.seed, g.turing && g.turing.seed, g.lace && g.lace.kind].join('|');

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
    freeze();   // the new attractor image dissolves in
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
    const sig = signature(g, cellN) + '|' + cellSeed;
    if (sig !== state.sig) { if (state.sig) freeze(); state.sig = sig; }
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
    U.uLace.value.set(g.lace.s, g.lace.scale, g.lace.twist, g.lace.kind || 0); U.uLace2.value.set(g.lace.p1 || 0, g.lace.p2 || 0, g.lace.p3 || .03, 0);
    if ((g.w.attractor || 0) > 0.01 && g.attractor) setAttractor(g.attractor);
  }
  /**
   * bake all six faces; motion: flow time (x), felt pulse phase (y), bass (z), arousal (w). With defer, only the clock, the
   * motion and the cross-fade advance, and the faces are drawn by the next ensure() (or freeze()): a skin nothing samples
   * costs nothing, and one that is sampled is exactly what an immediate bake would have drawn.
   */
  function bake(time, motion, { defer = false } = {}) {
    if (state.fading) { const dt = lastTime == null ? 0 : Math.max(0, Math.min(0.2, time - lastTime)); U.uX.value = Math.min(1, U.uX.value + dt / fade); if (U.uX.value >= 1) state.fading = false; }
    lastTime = time;
    U.uTime.value = time;
    if (motion) U.uMotion.value.copy(motion);
    if (defer) { stale = true; state.deferred++; return; }
    render();
  }
  /** draw a deferred bake now, if one is waiting (call before anything samples the texture) */
  function ensure() { if (stale) render(); }
  function render() {
    const prev = renderer.getRenderTarget(), prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    for (let f = 0; f < 6; f++) { U.uFace.value = f; renderer.setRenderTarget(rt, f); renderer.render(scene, cam); }
    renderer.setRenderTarget(prev); renderer.autoClear = prevAuto;
    if (mipmaps) {   // one mip chain for the six faces (three.js would rebuild it after every face)
      const gl = renderer.getContext(), tex = renderer.properties.get(rt.texture).__webglTexture;
      if (tex) { renderer.state.bindTexture(gl.TEXTURE_CUBE_MAP, tex); gl.generateMipmap(gl.TEXTURE_CUBE_MAP); renderer.state.unbindTexture(); }
    }
    baked = true; stale = false; state.bakes++;
  }
  /** the elements the song lived through (11 weights 0..1: fire water air earth saturn jupiter mars sun venus mercury moon) */
  function setImprint(w) { const v = (i) => (Number.isFinite(w && w[i]) ? Math.max(0, Math.min(1, w[i])) : 0); U.uImpA.value.set(v(0), v(1), v(2), v(3)); U.uImpB.value.set(v(4), v(5), v(6), v(7)); U.uImpC.value.set(v(8), v(9), v(10), 0); }
  return { texture: rt.texture, setGenome, bake, ensure, freeze, setImprint, state, uniforms: U, size };
}
