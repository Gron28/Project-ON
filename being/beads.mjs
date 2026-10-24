// being/beads.mjs - the bead material: the being keeps its exact shape, but its body is made of thousands of tiny
// points of light instead of liquid metal: each bead a white-hot centre in a soft glow, the brightest with a faint
// four-point star, twinkling on its own clock, added together where they crowd (additive, no depth write).
//
// Each ball owns a direction (a Fibonacci sphere, so they start evenly spread). Every frame a small GPU pass sphere-traces
// from outside the body inward along that direction, using the body's own distance function map() (the same GLSL), so
// the balls sit exactly on the current surface: lobes, tendrils, drops, cymatics and the grown skin included. Positions
// follow the surface with a little lag (a viscous bead skin). The directions stream slowly around the song's axis
// (surface currents). The balls are drawn as camera-facing quads shaded as spheres with the body's env(), into the same
// scene, with depth; balls behind the core are hidden, and the core light shines through the gaps between them.
// Subdivision (a: 0 -> 1) spreads as a wave from an origin: first big overlapping beads (still a surface), then small
// separate balls. Melting runs it backwards: clusters of beads swell into each other and sag, glowing at the front.
//
// Life on top of the surface (all in the draw vertex shader, no extra pass): a size hierarchy (a few big beads, a middle
// rank, many small), species by tissue (membrane / nucleus / cytoplasm beads take their stain, nuclei glow), a beat
// shimmer, about one bead in ten that drifts loose, orbits the song axis a while and returns, and a sparse set of extra
// beads on rings (latitude bands about the song axis) around the body.

export function createBeads(THREE, renderer, { bodyFragment, U, W = 128, H = 128 }) {
  const N = W * H;
  const NO = Math.round(N * 0.035);   // orbiting beads: extra instances on the rings
  const cut = bodyFragment.indexOf('  void main() {');
  if (cut < 0) throw new Error('beads: body shader has no main()');
  const prefix = bodyFragment.slice(0, cut);
  const rtOpts = { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false };
  let posA = new THREE.WebGLRenderTarget(W, H, rtOpts), posB = posA.clone();
  const B = {
    uPrevPos: { value: null }, uPos: { value: null }, uBW: { value: W }, uBN: { value: N }, uBK: { value: 1 }, uBFlow: { value: 0 }, uBTime: { value: 0 },
    uBAxis: { value: new THREE.Vector3(0, 1, 0) }, uBA: { value: 0 }, uBOrigin: { value: new THREE.Vector3(0, 0, 1) }, uBKick: { value: 0 }, uBSize: { value: 1 }, uBFresh: { value: 1 },
    uBMelt: { value: 0 }, uBOrbit: { value: 1 },
  };
  const uniforms = { ...U, ...B };

  // ---- placement: march from outside inward along each ball's direction to the body's surface ----------------------------
  const placeMat = new THREE.ShaderMaterial({ uniforms, depthTest: false, depthWrite: false,
    vertexShader: 'void main() { gl_Position = vec4( position.xy, 0., 1. ); }',
    fragmentShader: prefix + /* glsl */`
  uniform sampler2D uPrevPos; uniform float uBW, uBN, uBK, uBFlow, uBTime, uBFresh; uniform vec3 uBAxis;
  vec3 fibDir( float i, float n ) { float y = 1. - 2. * ( i + .5 ) / n, r = sqrt( max( 0., 1. - y * y ) ), a = i * 2.39996323; return vec3( cos( a ) * r, y, sin( a ) * r ); }
  vec3 rotAbout( vec3 v, vec3 k, float a ) { return v * cos( a ) + cross( k, v ) * sin( a ) + k * dot( k, v ) * ( 1. - cos( a ) ); }
  void main() {
    vec2 px = floor( gl_FragCoord.xy ); float id = px.y * uBW + px.x;
    vec3 u = fibDir( id, uBN );
    u = normalize( u + ( fract( sin( vec3( id, id * 1.3, id * 1.7 ) * vec3( 12.9898, 78.233, 37.719 ) ) * 43758.5453 ) - .5 ) * 2.2 / sqrt( uBN ) );   // break the spiral's moire
    float lat = dot( u, uBAxis );
    u = rotAbout( u, uBAxis, uBFlow * ( 1. - lat * lat ) + .2 * sin( uBTime * .23 + lat * 4. ) );   // surface currents
    u = normalize( u + .035 * vec3( sin( uBTime * .41 + u.y * 7. ), sin( uBTime * .37 + u.z * 6. ), sin( uBTime * .33 + u.x * 8. ) ) );
    float t = 1.5; bool ok = false;
    for ( int i = 0; i < 48; i++ ) {
      float d = map( u * t );
      if ( d < .0018 ) { ok = true; break; }
      t -= max( d * clamp( .75 - uDisp * 3.2, .3, .75 ), .0015 );
      if ( t < .12 ) break;
    }
    vec4 prev = texelFetch( uPrevPos, ivec2( px ), 0 );
    vec3 tgt = u * t;
    vec3 pos = ( prev.w > .5 && ok && uBFresh < .5 ) ? mix( prev.xyz, tgt, uBK ) : tgt;
    gl_FragColor = vec4( pos, ok ? 1. : 0. );
  }` });
  const placeScene = new THREE.Scene(), placeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  placeScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), placeMat));

  // ---- drawing: instanced sphere impostors with the body's environment ------------------------------------------------
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]), 3));
  geo.setIndex([0, 1, 2, 2, 1, 3]);
  geo.instanceCount = N + NO;
  const camGLSL = /* glsl */`
    mat2 brot( float a ) { float c = cos( a ), s = sin( a ); return mat2( c, - s, s, c ); }
    void bodyCam( out vec3 ro, out vec3 uu, out vec3 vv, out vec3 ww ) {
      ro = vec3( 0., 0., 4.2 * uZoom ); ro.yz *= brot( uLook.y * .35 ); ro.xz *= brot( uLook.x * .55 );
      ww = normalize( - ro ); uu = normalize( cross( ww, vec3( 0., 1., 0. ) ) ); vv = cross( uu, ww );
    }`;
  const drawMat = new THREE.ShaderMaterial({ uniforms, depthTest: true, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
    uniform sampler2D uPos; uniform float uBW, uBN, uBA, uBKick, uBSize, uBTime, uBMelt, uBOrbit; uniform vec3 uBOrigin, uBAxis;
    uniform vec2 uRes; uniform vec2 uLook; uniform float uScale; uniform vec2 uShift; uniform float uZoom;
    varying vec2 vQ; varying vec3 vP; varying float vLp; varying float vSeed; varying vec3 vHome; varying float vKind; varying float vFront; varying float vSp; varying float vGain;
    const float HALO = 3.;
    ${camGLSL}
    float h1( float n ) { return fract( sin( n * 12.9898 ) * 43758.5453 ); }
    vec3 rotAbout( vec3 v, vec3 k, float a ) { return v * cos( a ) + cross( k, v ) * sin( a ) + k * dot( k, v ) * ( 1. - cos( a ) ); }
    void main() {
      int id = gl_InstanceID; bool orb = id >= int( uBN );   // the extra instances are the orbiting beads (rings around the song axis)
      int src = orb ? ( id * 7919 ) % int( uBN ) : id;
      ivec2 px = ivec2( src % int( uBW ), src / int( uBW ) );
      vec4 P = texelFetch( uPos, px, 0 );
      vec3 ro, uu, vv, ww; bodyCam( ro, uu, vv, ww );
      float seed = h1( float( id ) ), s2 = h1( float( id ) * 1.37 + 5.1 ), s3 = h1( float( id ) * 2.71 + 9.3 );
      vec3 p = P.xyz, n = normalize( p + 1e-5 );
      vec3 home = n;
      float ang = acos( clamp( dot( n, uBOrigin ), - 1., 1. ) ) / 3.14159265;
      vec3 cell = floor( n * 3.4 + 9. ); float cl = h1( cell.x * 7.1 + cell.y * 13.3 + cell.z * 29.7 );   // clusters: neighbours coalesce together
      float lp = smoothstep( ang * .55 + cl * .22, ang * .55 + cl * .22 + .45, uBA );   // the subdivision spreads as a wave from its origin
      float front = 4. * lp * ( 1. - lp );   // the wave front: beads that are changing
      // size hierarchy: a few big beads, a middle rank, many small ones
      float tier = seed < .02 ? 1.9 : seed < .14 ? 1.35 : .9;
      float spacing = 3.5449 / sqrt( uBN ) * length( P.xyz );   // sqrt(4 pi / N) radians at this distance
      float r = spacing * mix( 1.25, ( .42 + .12 * s2 ) * tier, lp );
      float kind = 0., lift = 0.;
      if ( orb ) {
        // a ring of orbiting beads: latitude bands about the song axis, each ring turning at its own pace and direction
        float rk = floor( s2 * 3. ); float a = ( rk - 1. ) * .42 + ( s3 - .5 ) * .03;
        vec3 q = n - dot( n, uBAxis ) * uBAxis; q = normalize( q + 1e-5 );
        float w = ( .22 + .12 * h1( rk + 3. ) ) * ( mod( rk, 2. ) < 1. ? 1. : - .8 );
        float R = 1.02 + .06 * rk + .035 * sin( uBTime * .7 + s3 * 20. );
        p = uBAxis * a + rotAbout( q, uBAxis, uBTime * w + seed * 6.28 ) * R * sqrt( max( 1. - a * a * .35, .3 ) );
        home = normalize( p );
        float o = smoothstep( .8, 1., uBA ) * uBOrbit;
        r = spacing * ( .5 + .22 * step( .96, s3 ) + .1 * s2 ) * o;
        kind = 1.; lp = o; front = 0.; s3 = rk * .5 + ( s3 - .5 ) * .12;   // each ring is its own colour
      } else {
        // some beads drift loose now and then, orbit the axis a while, and come back
        float per = 6. + 9. * s2, ph = fract( uBTime / per + s3 );
        float env = smoothstep( 0., .1, ph ) * ( 1. - smoothstep( .32, .46, ph ) ) * step( seed, .07 ) * smoothstep( .7, 1., uBA ) * uBOrbit;
        p = rotAbout( p, uBAxis, ph * 12. * env * ( s3 < .5 ? 1. : - 1. ) ) * ( 1. + ( .16 + .22 * s2 ) * env );
        lift = env; r *= 1. + .4 * env;
        // melting: beads at the front swell into their neighbours and sag, then the liquid takes over
        r *= 1. + .35 * front * uBMelt;
        p += ( vec3( 0., - 1., 0. ) * .05 + rotAbout( n, uBAxis, 1.2 ) * .02 ) * front * uBMelt * ( .4 + seed );
        p += n * uBKick * .03 * seed;   // a kick shakes the beads loose a little
      }
      r *= uBSize * step( .5, P.w ) * step( .002, uBA );
      vec3 rel = p - ro; float z = max( dot( rel, ww ), .5 );
      vec2 uv = vec2( dot( rel, uu ), dot( rel, vv ) ) * 1.6 / z * uScale + uShift;
      float rad = r * 1.6 / z * uScale * HALO;   // the quad holds the glow, the bead itself is its inner third
      // a light smaller than a pixel aliases into a square: at least ~3 px, its brightness spread over the area it gained
      float radMin = 3. / uRes.y; vGain = rad > 0. ? min( 1., ( rad * rad ) / ( radMin * radMin ) ) : 0.; rad = rad > 0. ? max( rad, radMin ) : 0.;
      vQ = position.xy; vP = p; vLp = lp; vSeed = seed; vHome = home; vKind = kind + lift; vFront = front; vSp = s3;
      gl_Position = vec4( ( uv.x + position.x * rad ) * 2. * uRes.y / uRes.x, ( uv.y + position.y * rad ) * 2., clamp( ( z - 2.5 ) / 3.5, 0., 1. ) * 2. - 1., 1. );
    }`,
    fragmentShader: prefix + camGLSL + /* glsl */`
    uniform float uBMelt, uBTime;
    varying vec2 vQ; varying vec3 vP; varying float vLp; varying float vSeed; varying vec3 vHome; varying float vKind; varying float vFront; varying float vSp; varying float vGain;
    void main() {
      float d2 = dot( vQ, vQ ); if ( d2 > 1. ) discard;
      vec3 ro, uu, vv, ww; bodyCam( ro, uu, vv, ww );
      vec3 rd = normalize( vP - ro );
      // hidden behind the core light
      float b = dot( ro, rd ), hc = b * b - dot( ro, ro ) + uCoreR * uCoreR;
      if ( hc > 0. && - b - sqrt( hc ) < length( vP - ro ) - .001 ) discard;
      vec4 mo = uMorphA > .01 ? textureLod( uMorph, vHome, 0. ) : vec4( .5, 0., .5, 1. );
      float ringed = step( 1., vKind ) + ( 1. - step( 1., vKind ) ) * clamp( vKind, 0., 1. ) * .6;
      // its colour: the tissue's stain, washed toward white-hot at the centre (nuclei warmer and brighter)
      vec3 spec = mix( uStainM, uStainN, vSp );
      vec3 tis = mo.b > .45 ? uStainN : mo.g > .45 ? uStainM : mix( uLight, uStainC * 4., .35 );
      vec3 hue = normalize( mix( mix( tis, spec, ringed ), uLight, .35 ) + 1e-3 ) * 1.2;
      // the automaton's cells (being/page/cellab.mjs): each bead takes the colour of the cell under it, live cells shine
      vec4 caB = uCaA > .01 ? caLook( normalize( vHome ) ) : vec4( 0., 0., 0., .35 );
      if ( uCaA > .01 ) {   // the body's own stain (shaders.mjs): the palette leaning to the being's hue
        vec3 pc = caB.rgb * caB.rgb; vec3 stain = mix( pc, uCaHueC * ( .25 + 1.3 * dot( pc, vec3( .3, .5, .2 ) ) ), uCaHue );
        hue = mix( hue, normalize( stain + 1e-3 ) * 1.2, .7 * min( uCaA, 1. ) );
      }
      float big = step( .86, vSeed ) + step( .98, vSeed );   // the size hierarchy is a brightness hierarchy now
      // twinkle: each light on its own slow clock, a few fast ones; the felt beat makes a share of them flare
      float tw = .62 + .38 * sin( uBTime * ( 1.3 + 4.7 * vSp ) + vSeed * 40. );
      tw *= 1. + uBeatPulse * 1.4 * step( .55, fract( vSeed * 13.7 + vHome.y * 2. ) );
      // the near side faces the viewer and is brighter; the far side glows through, dimmer
      float face = mix( .3, 1., smoothstep( -.35, .6, dot( vHome, - ww ) ) );
      float d = sqrt( d2 ) * 3.;   // in bead radii
      float edge = smoothstep( 1., .55, sqrt( d2 ) );   // the glow is gone before the quad ends: no discs
      float core = exp( - d * d * 9. ), glow = exp( - d * 3.2 ) * .1 * edge, halo = exp( - d * 1.2 ) * .012 * edge;
      float star = big * ( exp( - abs( vQ.x ) * 80. ) + exp( - abs( vQ.y ) * 80. ) ) * exp( - d * 1.1 ) * .35 * edge;
      // a long tail of brightness: most beads are faint embers, a few are stars (they add up where they crowd)
      float lum = .12 + .88 * pow( fract( vSeed * 7.31 + .17 ), 5. ) + .6 * big;
      float I = ( core * 1.5 + glow + halo + star ) * lum * tw * face * vLp * ( .55 + .45 * mo.r ) * .55 * vGain * 2.2;
      I *= 1. + .8 * mo.b * step( .45, mo.b );   // nuclei shine
      I *= mix( 1., .3 + 1.6 * caB.a, min( uCaA, 1. ) );   // resting cells dim, live ones flare
      // the wave front burns brighter while it melts back into the liquid
      I *= 1. + vFront * ( .6 + 1.4 * uBMelt );
      vec3 col = mix( hue, vec3( 1., .97, .92 ), core * .85 ) * I * ( .5 + .5 * uGlow ) * 1.1;
      gl_FragColor = vec4( col, 1. );
    }` });
  const mesh = new THREE.Mesh(geo, drawMat);
  mesh.frustumCulled = false; mesh.renderOrder = 1; mesh.visible = false;

  let fresh = true, lastA = 0;
  /** place the balls on the current surface (call every frame while visible) */
  function place(dt) {
    const da = B.uBA.value - lastA; lastA = B.uBA.value;   // melting (a falling) or growing (a rising)
    B.uBMelt.value += ((da < -1e-4 ? 1 : da > 1e-4 ? 0 : B.uBMelt.value) - B.uBMelt.value) * (1 - Math.exp(-Math.max(dt, 0) / 0.25));
    B.uPrevPos.value = posA.texture; B.uBFresh.value = fresh ? 1 : 0;
    B.uBK.value = 1 - Math.exp(-Math.max(dt, 0) / 0.06);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(posB); renderer.render(placeScene, placeCam); renderer.setRenderTarget(prev);
    const t = posA; posA = posB; posB = t;
    B.uPos.value = posA.texture; fresh = false;
  }
  return { mesh, place, uniforms: B, reset() { fresh = true; }, count: N + NO };
}
