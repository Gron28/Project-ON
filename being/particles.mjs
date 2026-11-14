// being/particles.mjs - what the body sheds: seven kinds of particle, each given off by the materials that own it.
// The body has a nucleus and a radius, no up or down, so every particle moves along the radius or round the body:
//   (petals are retired: they broke the illusion as sprites)
//   embers (fire, Mars, the Sun) stream out of the nucleus and cool (white-gold, orange, crimson, gone) · bubbles (water,
//   the Moon) rise from inside to the skin and pop · wind motes (air) circle the body in curling eddies · dust (earth,
//   Saturn) falls inward and settles on the skin · star-dust (the Sun, the Moon, Mercury, every glint) twinkles in four
//   points at the skin · petals (Venus) drift outward, turning · sparks (fire and Mars at the drop and on the kick) fly from
//   where the body was struck.
// Each is drawn as a soft capsule from where it was to where it is (motion blur: fast ones streak, slow ones are points),
// never smaller than ~2.5 px (its light spread over the area it gained, so nothing aliases into a square), and shaded as
// what it is, not as a flat dot: bubbles a soap-thin film with interference colours that wobbles and snaps into a ring of
// droplets when it pops; metal droplets a small mirror of a studio sky; dust grains lit from one side; embers and sparks
// hot at the head and cooling along the streak; star-dust four diffraction spikes, longer in red than in blue. Far in front
// of or behind the body a particle is out of focus: a soft lens disc with a brighter rim. The last NL slots are lines, not
// particles: the lightning's channels (lines(), from being/lightning.mjs). One instanced draw in the body's scene through
// the body's camera, added in light.
export const KINDS = ['ember', 'bubble', 'wind', 'dust', 'stardust', 'petal', 'spark', 'trail', 'orb', 'gather', 'bolt'];   // trail: the light a singing voice traces (trace()); gather: droplets and beads drawn in from outside (gather()), thrown back out by scatter()
const K = Object.fromEntries(KINDS.map((k, i) => [k, i]));
const MAXP = 1600, NL = 384, MAX = MAXP + NL;   // particles, then line slots
const LIFE = [[1.2, 2.4], [2.4, 4.5], [1.6, 2.8], [5, 8], [0.6, 1.4], [3, 5], [0.25, 0.5], [1.2, 2.2], [1.5, 3], [6, 9], [1, 1]];
const SIZE = [[0.005, 0.01], [0.01, 0.075], [0.004, 0.007], [0.004, 0.008], [0.009, 0.02], [0.024, 0.04], [0.004, 0.006], [0.006, 0.013], [0.003, 0.007], [0.004, 0.011], [0, 0]];
const STREAK = [0.09, 0, 0.14, 0, 0, 0, 0.05, 0.12, 0.025, 0.06, 0];   // seconds of motion each kind smears over

export function createParticles(THREE, U) {
  const pos = new Float32Array(MAX * 3), vel = new Float32Array(MAX * 3), kind = new Float32Array(MAX), age = new Float32Array(MAX).fill(1e9),
    life = new Float32Array(MAX).fill(1), size = new Float32Array(MAX), seed = new Float32Array(MAX), fade = new Float32Array(MAX), heat = new Float32Array(MAX);
  // per instance: position + size, velocity * streak time + kind, seed / fade / heat
  const iA = new Float32Array(MAX * 4), iB = new Float32Array(MAX * 4), iC = new Float32Array(MAX * 4);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]), 3));
  geo.setIndex([0, 1, 2, 2, 1, 3]);
  const aA = new THREE.InstancedBufferAttribute(iA, 4).setUsage(THREE.DynamicDrawUsage), aB = new THREE.InstancedBufferAttribute(iB, 4).setUsage(THREE.DynamicDrawUsage), aC = new THREE.InstancedBufferAttribute(iC, 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aA', aA); geo.setAttribute('aB', aB); geo.setAttribute('aC', aC);
  geo.instanceCount = MAX;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uRes: U.uRes, uPxK: U.uPxK || { value: 1 }, uLook: U.uLook, uZoom: U.uZoom, uScale: U.uScale, uShift: U.uShift, uShellR: U.uShellR, uTime: U.uTime, uLight: U.uLight, uAwake: U.uAwake, uGatherC: U.uGatherC || { value: new THREE.Color(1, .92, .8) }, uBoltC: U.uBoltC || { value: new THREE.Color(.45, .52, 1) } },
    transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
    vertexShader: /* glsl */`
      uniform vec2 uRes, uLook, uShift; uniform float uZoom, uScale, uShellR, uPxK;
      attribute vec4 aA, aB, aC;   // pos.xyz size | smear.xyz kind | seed fade heat -
      varying vec2 vQ, vBody; varying float vLen, vKind, vSeed, vFade, vHeat, vGain, vBok;
      mat2 rot( float a ) { float c = cos( a ), s = sin( a ); return mat2( c, - s, s, c ); }
      vec3 proj( vec3 p, vec3 ro, vec3 uu, vec3 vv, vec3 ww ) { vec3 v = p - ro; float z = max( dot( v, ww ), .05 ); return vec3( vec2( dot( v, uu ), dot( v, vv ) ) * 1.6 / z * uScale + uShift, z ); }
      void main() {
        if ( aA.w <= 0. ) { gl_Position = vec4( 2., 2., 2., 1. ); return; }   // a dead slot (size 0, fade 0) would add exactly nothing: no fragments for it
        vec3 ro = vec3( 0., 0., 4.2 * uZoom ); ro.yz *= rot( uLook.y * .35 ); ro.xz *= rot( uLook.x * .55 );   // the body's camera
        vec3 ww = normalize( - ro ), uu = normalize( cross( ww, vec3( 0., 1., 0. ) ) ), vv = cross( uu, ww );
        vec3 a = proj( aA.xyz, ro, uu, vv, ww ), b = proj( aA.xyz - aB.xyz, ro, uu, vv, ww );   // now, and where it was a moment ago
        vec2 asp = vec2( uRes.y / uRes.x, 1. ) * 2.;   // screen units -> clip
        float px = uPxK / uRes.y;   // one window pixel in screen units (the screen is 1 unit tall here, see asp; uPxK: the body drawn above the window's resolution)
        float w = aA.w * 1.6 / a.z * uScale;   // the particle's radius on screen
        float bolt = step( 9.5, aB.w );
        float wMin = ( 1.25 + .75 * bolt ) * px; vGain = bolt > .5 ? 1. : w > 0. ? min( 1., ( w * w ) / ( wMin * wMin ) ) : 0.; w = max( w, wMin );   // a lightning channel is never thinner than ~2 px and never dimmed for it
        // depth of field: focused on the body; nearer or farther, the light spreads into a lens disc (energy kept, with a floor)
        float coc = abs( a.z - 4.2 * uZoom ) * .006 * ( 1. - bolt ), w2 = sqrt( w * w + coc * coc );
        vBok = clamp( coc / w2 * 1.2 - .2, 0., 1. ); vGain *= max( .3, ( w * w ) / ( w2 * w2 ) ); w = w2;
        vec2 d = a.xy - b.xy; float L = length( d ); vec2 dir = L > 1e-6 ? d / L : vec2( 1., 0. ), nrm = vec2( - dir.y, dir.x );
        float halo = 3. + 3. * bolt;   // the quad holds the glow (a lightning channel's is wider)
        vec2 c = ( a.xy + b.xy ) * .5 + dir * position.x * ( L * .5 + w * halo ) + nrm * position.y * w * halo;
        gl_Position = vec4( c * asp, 0., 1. );
        vQ = vec2( position.x * ( L * .5 + w * halo ) / w, position.y * halo );   // in particle radii, along and across the streak
        vLen = L * .5 / w;
        vec2 tb = proj( vec3( 0. ), ro, uu, vv, ww ).xy - a.xy; vBody = dot( tb, tb ) > 1e-10 ? normalize( vec2( dot( tb, dir ), dot( tb, nrm ) ) ) : vec2( 0. );   // which way the body is, in the sprite's own axes
        vKind = aB.w; vSeed = aC.x; vHeat = aC.z;
        // behind the body and within its outline: mostly hidden
        float behind = step( 0., dot( aA.xyz, ww ) ) * step( length( aA.xyz - ww * dot( aA.xyz, ww ) ), uShellR * 1.05 );
        vFade = aC.y * ( 1. - .85 * behind ) * ( bolt > .5 ? 1. : L > 1e-6 ? min( 1., 2.5 / ( 1. + vLen ) ) + .25 : 1. );   // a long streak spreads its light (a channel is lit along its length)
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uAwake; uniform vec3 uLight, uGatherC, uBoltC;
      varying vec2 vQ, vBody; varying float vLen, vKind, vSeed, vFade, vHeat, vGain, vBok;
      const vec3 KEY = vec3( -.47, .64, .61 );   // the key light, upper left and in front
      vec3 blackbody( float h ) { return vec3( smoothstep( .05, .45, h ) * 1.6, smoothstep( .3, .85, h ) * 1.1, smoothstep( .7, 1.2, h ) * .9 ); }
      vec3 ball( vec2 q ) { return vec3( q, sqrt( max( 0., 1. - dot( q, q ) ) ) ); }   // the normal of a small sphere seen at q (in its radii)
      vec3 sky( vec3 r ) { return mix( vec3( .04, .04, .06 ), vec3( 1. ), smoothstep( -.15, .45, r.y ) ) + vec3( .8 ) * exp( - pow( ( r.y - .05 ) * 9., 2. ) ); }   // a studio sky: dark floor, bright above, a hot horizon
      void main() {
        // distance to the streak's segment, in particle radii
        float x = max( abs( vQ.x ) - vLen, 0. ), d = length( vec2( x, vQ.y ) ), k = vKind;
        if ( d > ( k > 9.5 ? 6. : 3. ) ) discard;
        float along = vLen > .01 ? clamp( vQ.x / vLen * .5 + .5, 0., 1. ) : 1.;   // 0 at a streak's tail, 1 at its head (where it is now)
        vec2 q = vec2( sign( vQ.x ) * x, vQ.y );   // the capsule's own coordinates: a sphere at rest, stretched by its motion
        float edge = smoothstep( 3., 2., d ), core = exp( - d * d * 2.2 ), glow = exp( - d * 1.7 ) * .28 * edge;
        // out of focus: a soft lens disc with a brighter rim
        float disc = smoothstep( 1.05, .85, d ) * ( .55 + .45 * smoothstep( .55, 1., d ) );
        core = mix( core, disc * .8, vBok ); glow *= 1. - .7 * vBok;
        vec3 c = vec3( 0. );
        if ( k > 9.5 ) {   // lightning: a white-hot thread in a sheath and a wide glow of its colour (uBoltC: the nucleus's light, leaning to the mood), flickering
          float ch = exp( - d * d * 5. ), hot = exp( - d * d * 14. ), fl = .8 + .2 * sin( uTime * 120. + vSeed * 50. );   // a thin white-hot thread in an electric violet-blue sheath: blue reads even over the warm metal
          c = ( uBoltC * ch * 3. + vec3( 1. ) * hot * 2.4 + uBoltC * .75 * exp( - d * .9 ) * 1.1 * smoothstep( 6., 4., d ) ) * fl;
        }
        else if ( k > 8.5 ) {   // gather: a droplet of liquid metal in the colour it is given, the sky round it reflected; a flash as it is taken in (heat)
          vec3 n = ball( q ), r = reflect( vec3( 0., 0., -1. ), n );
          float m = smoothstep( 1., .86, d ), fr = .35 + .65 * pow( 1. - n.z, 2. ), hl = pow( max( dot( r, KEY ), 0. ), 40. );
          c = ( sky( r ) * mix( uGatherC, vec3( 1. ), .35 ) * fr * .9 + vec3( 1. ) * hl * 1.4 ) * m + uGatherC * glow * .6
            + mix( uGatherC, vec3( 1. ), .5 ) * vHeat * ( core * 2. + glow * 3. );
        }
        else if ( k > 7.5 ) c = mix( vec3( 1., .91, .45 ), vec3( 1. ), core * .8 ) * ( core * 1.5 + glow * .9 ) * ( .7 + .3 * sin( uTime * 7. + vSeed * 40. ) );   // orb: a tiny pale-yellow light
        else if ( k > 6.5 ) c = mix( mix( uLight, vec3( .85, .9, 1. ), .5 ), vec3( 1. ), core * .7 ) * ( core * 1.2 + glow * 1.4 ) * ( .7 + .3 * sin( uTime * 3. + vSeed * 20. ) );   // trail: a soft breathing light
        else if ( k > 5.5 ) c = blackbody( .45 + .8 * along ) * ( exp( - d * d * 4. ) * 2.2 + glow * 1.1 ) * ( .35 + .65 * along );   // spark: a white-hot head, its streak cooling to orange and red
        else if ( k > 4.5 ) {   // petal: an oval, turning, lit from within
          float a = vSeed * 9. + uTime * 1.5; vec2 p = mat2( cos( a ), - sin( a ), sin( a ), cos( a ) ) * vQ;
          float m = smoothstep( 1.1, .8, length( p * vec2( 1., 2.2 ) ) );
          c = mix( vec3( .35, .85, .55 ), vec3( 1., .55, .72 ), step( .5, fract( vSeed * 13. ) ) ) * ( m * .75 + glow * .3 );
        }
        else if ( k > 3.5 ) {   // star-dust: a point with four diffraction spikes, turned by its seed, each longer in red than in blue, twinkling
          float a = vSeed * 6.2832; vec2 p = mat2( cos( a ), - sin( a ), sin( a ), cos( a ) ) * vQ;
          float tw = .55 + .45 * sin( uTime * 9. + vSeed * 70. ), ax = abs( p.x ), ay = abs( p.y );
          vec3 L = vec3( .8, .95, 1.12 );   // falloff along the spike: red reaches furthest
          vec3 sp = exp( - ax * 9. ) * exp( - ay * L ) + exp( - ay * 9. ) * exp( - ax * L );
          c = ( mix( vec3( 1., .96, .86 ), uLight, .25 ) * ( core * 1.6 + glow ) + sp * edge * .95 ) * tw;
        }
        else if ( k > 2.5 ) {   // dust: tiny grains with a lit face and a dark one; the seed-gold ones glint now and then
          float m = smoothstep( 1., .8, d ), lam = max( dot( ball( q ), KEY ), 0. ), gold = step( .7, vSeed );
          float gl = gold * pow( max( 0., sin( uTime * 2.3 + vSeed * 90. ) ), 30. );
          c = mix( vec3( .55, .42, .24 ), vec3( 1., .86, .2 ), gold ) * ( m * ( .25 + .95 * lam ) + glow * .3 ) + vec3( 1., .9, .6 ) * gl * ( core * 2. + glow * 2. );
        }
        else if ( k > 1.5 ) c = vec3( .9, .95, 1. ) * ( core * .7 + glow * .6 ) * ( .25 + .75 * along );   // wind: a pale streak, thinning to nothing at its tail
        else if ( k > .5 ) {   // bubble: a soap film, clear inside. Each its own: its outline wobbles, its film drains (thin, then black,
          // at the top) in swirling bands that drift, the interference colour set by the film's thickness and the angle it is seen at,
          // a window reflected upper left, and the side facing the body lit by the body's own light
          float pop = vHeat > 0. ? 1. - vHeat : 0., ang = atan( vQ.y, vQ.x ), sd = vSeed * 6.2832;
          vec2 b = vQ * ( 1. + .055 * sin( ang * 2. + uTime * 3.1 + sd * 5. ) + .03 * sin( ang * 3. - uTime * 4.7 + sd * 2. ) );
          float rb = length( b ), inside = smoothstep( 1., .965, rb ) * ( 1. - pop );
          vec3 n = ball( b ), r = reflect( vec3( 0., 0., -1. ), n );
          float sp = uTime * .25 * ( vSeed - .5 ) + rb * 1.7 + sd; vec2 w = mat2( cos( sp ), - sin( sp ), sin( sp ), cos( sp ) ) * b;
          float th = .3 + .5 * ( .5 - .5 * b.y ) + .13 * sin( w.x * 5.3 + uTime * .7 + sd * 7. ) * sin( w.y * 4.1 - uTime * .5 ) + .06 * sin( w.x * 13. - w.y * 9. + sd );   // film thickness
          float opd = th * ( 2.4 + 1.2 * n.z );   // the optical path: thicker film and straighter view, higher orders
          vec3 film = ( .5 + .5 * cos( 6.2832 * opd * vec3( 1., 1.19, 1.42 ) ) ) * smoothstep( .1, .24, th );   // red, green, blue interfere apart; the thinnest film goes black
          float fres = .2 + .8 * pow( 1. - n.z, 3. );   // the colour bands show across the whole face, strongest toward the rim
          vec2 wq = abs( r.xy - vec2( -.45, .42 ) ) - vec2( .13, .09 ); float win = smoothstep( .09, 0., length( max( wq, 0. ) ) ) * step( 0., r.z );   // a soft window
          float win2 = .35 * smoothstep( .1, 0., length( r.xy - vec2( .4, -.48 ) ) - .05 );
          float glowSide = pow( max( dot( normalize( vec3( vBody, .35 ) ), n ), 0. ), 2. );
          c = ( film * fres * 1.5 + vec3( 1. ) * ( win * 1.5 + win2 ) + uLight * glowSide * fres * 1.4 ) * inside;
          c += film * smoothstep( .9, .995, rb ) * smoothstep( 1.03, .995, rb ) * .45 * ( 1. - pop );   // the rim, where the film is seen edge on
          // the pop: the film snaps back into a ring of flying droplets
          float ring = exp( - pow( ( rb - ( 1. + 1.3 * pop ) ) * 7., 2. ) ) * step( .5, fract( ang * 1.114 + vSeed * 3. ) );
          c += mix( vec3( .7, .9, 1. ), film, .4 ) * ring * pop * ( 1. - pop ) * 4.;
        }
        else {   // ember: hot at its head, cooling along its tail, flickering
          float fl = .75 + .25 * sin( uTime * 23. + vSeed * 91. );
          c = blackbody( vHeat * mix( .6, 1.08, along ) ) * ( core * 1.5 + glow ) * fl;
        }
        float f = vFade * vGain * ( .3 + .7 * uAwake );
        gl_FragColor = vec4( c * f, clamp( max( c.r, max( c.g, c.b ) ) * f, 0., 1. ) );
      }`,
  });
  const points = new THREE.Mesh(geo, mat);   // (named points for the page: it is one instanced draw of streaked sprites)
  points.frustumCulled = false; points.renderOrder = 10;
  let cursor = 0, strike = [0, 0, 1], F = null, frame = 0, lineBuf = null, lineN = 0;
  const settled = new Uint8Array(MAX), out = new Uint8Array(MAX);   // out: a gathered drop thrown back out when it lets go
  let G = 0;   // how far the gathering has come (0..1): the pull grows with it   // dust resting on the skin: its direction is kept in vel, it is re-placed as the shape changes
  // three hot spots that wander slowly round the body: shedding comes in places, not evenly from everywhere
  const hot = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(() => { const z = Math.random() * 2 - 1, a = Math.random() * 6.28, q = Math.sqrt(1 - z * z); return { d: [Math.cos(a) * q, z, Math.sin(a) * q], w: [(Math.random() - .5), (Math.random() - .5), (Math.random() - .5)] }; });
  const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const acc = new Float32Array(KINDS.length);   // fractional emission carried between frames
  const rdir = () => { const z = Math.random() * 2 - 1, a = Math.random() * 6.2832, s = Math.sqrt(1 - z * z); return [Math.cos(a) * s, z, Math.sin(a) * s]; };

  /** where a particle of kind k leaves from: a direction, then the real surface point and its outward normal */
  function origin(k, shellR, burst) {
    let d;
    if (k === K.spark && burst) d = norm3([strike[0] + (Math.random() - .5) * .9, strike[1] + (Math.random() - .5) * .9, strike[2] + (Math.random() - .5) * .9]);
    else if (k === K.dust) d = rdir();
    else if (k === K.bubble) { const r = rdir(); d = norm3([r[0], r[1], r[2] * .3]); }   // mostly round the outline (as the window sees it), not over the body's face
    else {   // near a hot spot; for fire and sparks, of three candidates the one that sticks out furthest (flame leaves from tips)
      const h = hot[(Math.random() * 3) | 0].d, tries = k === K.ember || k === K.spark ? 3 : 1; let best = null, br = -1;
      for (let n = 0; n < tries; n++) { const r = rdir(), c = norm3([h[0] + r[0] * .8, h[1] + r[1] * .8, h[2] + r[2] * .8]); const sp = F ? F.surface(c[0], c[1], c[2]) : c.map((v) => v * shellR); const rr = Math.hypot(...sp); if (rr > br) { br = rr; best = [c, sp]; } }
      const [c, sp] = best; return { d: c, s: sp, n: F ? F.normal(sp[0], sp[1], sp[2]) : c };
    }
    const sp = F ? F.surface(d[0], d[1], d[2]) : d.map((v) => v * shellR);
    return { d, s: sp, n: F ? F.normal(sp[0], sp[1], sp[2]) : d };
  }
  function emit(k, n, shellR, burst = 0) {
    for (let j = 0; j < n; j++) {
      const i = cursor, J = i * 3; cursor = (cursor + 1) % MAXP;
      const o = origin(k, shellR, burst), [nx, ny, nz] = o.n, R = shellR; let floater = 0;
      let p = [o.s[0] + nx * R * .015, o.s[1] + ny * R * .015, o.s[2] + nz * R * .015], v = [0, 0, 0];
      if (k === K.ember) { const sp = R * (0.5 + 0.9 * Math.random()); v = [nx * sp, ny * sp, nz * sp]; }   // straight out of the skin
      else if (k === K.spark) { const sp = R * (2.5 + 2.5 * Math.random()) * (1 + burst); v = [nx * sp, ny * sp, nz * sp]; }
      else if (k === K.stardust) { p = [o.s[0] + nx * R * .03, o.s[1] + ny * R * .03, o.s[2] + nz * R * .03]; }
      else if (k === K.wind) { const off = R * (.15 + .3 * Math.random()), ax = norm3([.2, 1, .1]), t = norm3([ny * ax[2] - nz * ax[1], nz * ax[0] - nx * ax[2], nx * ax[1] - ny * ax[0]]), sp = R * (.6 + .6 * Math.random()) * (Math.random() < .5 ? 1 : -1);
        p = [o.s[0] + nx * off, o.s[1] + ny * off, o.s[2] + nz * off]; v = [t[0] * sp, t[1] * sp, t[2] * sp]; heat[i] = off; }   // round the body, a set distance off the skin
      else if (k === K.orb) { const off = R * (.08 + .5 * Math.random()), ax = norm3([Math.random() - .5, 1, Math.random() - .5]), t = norm3([ny * ax[2] - nz * ax[1], nz * ax[0] - nx * ax[2], nx * ax[1] - ny * ax[0]]), sp = R * (1.3 + 1.4 * Math.random()) * (Math.random() < .5 ? 1 : -1);
        p = [o.s[0] + nx * off, o.s[1] + ny * off, o.s[2] + nz * off]; v = [t[0] * sp, t[1] * sp, t[2] * sp]; heat[i] = off; }   // tiny lights orbiting fast
      else if (k === K.dust) { const r = Math.hypot(...o.s) * (1.5 + .5 * Math.random()), sp = -R * (.15 + .15 * Math.random()); p = [o.d[0] * r, o.d[1] * r, o.d[2] * r]; v = [o.d[0] * sp, o.d[1] * sp, o.d[2] * sp]; }   // falls inward onto it
      else if (k === K.bubble) { floater = 1; const sp = R * (.3 + .35 * Math.random()), off = R * (.04 + .1 * Math.random()); p = [o.s[0] + nx * off, o.s[1] + ny * off, o.s[2] + nz * off]; v = [nx * sp, ny * sp, nz * sp]; }   // leaves the skin and floats off
      else if (k === K.petal) { const sp = R * .2; v = [nx * sp, ny * sp, nz * sp]; }
      else if (k === K.gather) {   // from a shell well outside the body, already turning a little round it, so the cloud spirals in
        const r = Math.hypot(...o.s) * (2.2 + 1.2 * Math.random()), ax = rdir(), t = norm3([o.d[1] * ax[2] - o.d[2] * ax[1], o.d[2] * ax[0] - o.d[0] * ax[2], o.d[0] * ax[1] - o.d[1] * ax[0]]), sp = R * (.25 + .35 * Math.random()), si = -R * (.1 + .25 * G);
        p = [o.d[0] * r, o.d[1] * r, o.d[2] * r]; v = [t[0] * sp + o.d[0] * si, t[1] * sp + o.d[1] * si, t[2] * sp + o.d[2] * si]; }
      pos[J] = p[0]; pos[J + 1] = p[1]; pos[J + 2] = p[2]; vel[J] = v[0]; vel[J + 1] = v[1]; vel[J + 2] = v[2];
      kind[i] = k; age[i] = 0; seed[i] = Math.random(); settled[i] = out[i] = 0; if (k !== K.wind && k !== K.orb) heat[i] = k === K.ember ? 0.9 + 0.3 * Math.random() : 0;
      if (floater) out[i] = 1;   // (for bubbles, out marks one floating away outside)
      life[i] = LIFE[k][0] + (LIFE[k][1] - LIFE[k][0]) * Math.random();
      size[i] = (SIZE[k][0] + (SIZE[k][1] - SIZE[k][0]) * (k === K.bubble ? Math.random() ** 2.2 : Math.random())) * shellR / 0.36;   // bubbles: many small, a few large
    }
  }

  return {
    points, KINDS,
    /** the voice trace: n lights left at a point (where the trace is now), drifting slowly, so its path stays a while as a trail */
    trace(x, y, z, n, shellR) {
      for (let j = 0; j < n; j++) {
        const i = cursor, J = i * 3; cursor = (cursor + 1) % MAXP;
        const jt = shellR * .03; pos[J] = x + (Math.random() - .5) * jt; pos[J + 1] = y + (Math.random() - .5) * jt; pos[J + 2] = z + (Math.random() - .5) * jt;
        const l = Math.hypot(x, y, z) || 1, sp = shellR * .04; vel[J] = x / l * sp; vel[J + 1] = y / l * sp; vel[J + 2] = z / l * sp;
        kind[i] = K.trail; age[i] = 0; seed[i] = Math.random(); settled[i] = out[i] = 0; heat[i] = 0;
        life[i] = LIFE[K.trail][0] + (LIFE[K.trail][1] - LIFE[K.trail][0]) * Math.random();
        size[i] = (SIZE[K.trail][0] + (SIZE[K.trail][1] - SIZE[K.trail][0]) * Math.random()) * shellR / 0.36;
      }
    },
    /** a burst of one kind now (glints, drops, kicks); sparks fly from a fresh strike point */
    burst(kindName, n, shellR) { const k = K[kindName]; if (k === undefined) return; if (k === K.spark) strike = rdir(); emit(k, n, shellR, 1); },
    /** the lightning's lit channels this frame: buf holds n segments of 9 floats (a xyz, b xyz, width, brightness, depth) */
    lines(buf, n) { lineBuf = buf; lineN = buf ? Math.max(0, Math.min(NL, n | 0)) : 0; },
    /** droplets drawn in from outside: n now, with the charge g (0..1) setting how hard they are pulled */
    gather(n, shellR, g) { G = Math.max(0, Math.min(1, g)); emit(K.gather, n, shellR); },
    /** the release: every drop still on its way in is thrown back out, a shock of light */
    scatter(shellR) {
      for (let i = 0; i < MAXP; i++) if (kind[i] === K.gather && age[i] < life[i] && !out[i]) {
        const J = i * 3, r = Math.hypot(pos[J], pos[J + 1], pos[J + 2]) || 1e-6, sp = shellR * (2 + 2.5 * Math.random());
        out[i] = 1; heat[i] = .6; vel[J] = pos[J] / r * sp; vel[J + 1] = pos[J + 1] / r * sp; vel[J + 2] = pos[J + 2] / r * sp; age[i] = Math.max(age[i], life[i] - 1.4);
      }
    },
    /** @param {number} dt seconds; @param {number[]} rates particles per second for each kind; @param {number} shellR */
    step(dt, rates, shellR, t, o = {}) {
      dt = Math.min(0.1, Math.max(0, dt || 0)); F = o.field || null; frame++;
      const beat = o.beat || 0, kick = o.kick || 0, aro = o.arousal ?? .4;
      for (const h of hot) { h.d = norm3([h.d[0] + h.w[0] * dt * .35, h.d[1] + h.w[1] * dt * .35, h.d[2] + h.w[2] * dt * .35]); if (Math.random() < dt * .2) h.w = [(Math.random() - .5), (Math.random() - .5), (Math.random() - .5)]; }
      // the music sets how much it sheds, moment to moment: embers surge on the beat and kick, glimmers on the beat, wind with arousal
      const mod = [.35 + 1.4 * beat + .8 * kick, .6 + .8 * beat, .5 + .9 * aro, .7 + .5 * aro, .45 + 1.3 * beat, 1, 1, 1, .6 + .8 * aro, 1, 0];
      for (let k = 0; k < KINDS.length; k++) { acc[k] += (rates[k] || 0) * mod[k] * dt; const n = Math.floor(acc[k]); if (n > 0) { acc[k] -= n; emit(k, Math.min(n, 40), shellR); } }
      let live = 0;
      for (let i = 0; i < MAXP; i++) {
        const J = i * 3, A = i * 4;
        if (age[i] >= life[i]) { iC[A + 1] = 0; iA[A + 3] = 0; continue; }
        live++;
        age[i] += dt; const u = Math.min(1, age[i] / life[i]), k = kind[i];
        const px = pos[J], py = pos[J + 1], pz = pos[J + 2], r = Math.hypot(px, py, pz) || 1e-6, nx = px / r, ny = py / r, nz = pz / r;
        // a gentle curl of eddies (divergence-free enough to look like air), different per particle
        const s = seed[i] * 40, cx = Math.sin(py * 9 + t * 1.3 + s) - Math.sin(pz * 8 - t * 1.1), cy = Math.sin(pz * 9 + t * 1.2 + s) - Math.sin(px * 8 + t), cz = Math.sin(px * 9 - t * 1.4 + s) - Math.sin(py * 8 + t * .9);
        if (k === K.ember) { const d = Math.exp(-dt * 1.2); vel[J] = vel[J] * d + cx * .06 * shellR * dt * 10; vel[J + 1] = vel[J + 1] * d + cy * .06 * shellR * dt * 10; vel[J + 2] = vel[J + 2] * d + cz * .06 * shellR * dt * 10; heat[i] = Math.max(0, heat[i] - dt * (0.45 + 0.4 * seed[i])); }
        else if (k === K.bubble) {   // floating off the skin, it pops at the end of its life (or if it drifts back into the body); the pop takes ~0.22 s (heat 1 -> 0)
          if (heat[i] > 0) heat[i] = Math.max(1e-4, heat[i] - dt / .22);
          else if (age[i] > life[i] - .22 || (F && age[i] > .3 && F.dist(px, py, pz) < 0)) { heat[i] = 1; age[i] = Math.max(age[i], life[i] - .22); vel[J] = vel[J + 1] = vel[J + 2] = 0; }
          else if (out[i]) { const d = Math.exp(-dt * .35); vel[J] = vel[J] * d + (cx * .05 + nx * .06) * shellR * dt; vel[J + 1] = vel[J + 1] * d + (cy * .05 + ny * .04) * shellR * dt; vel[J + 2] = vel[J + 2] * d + (cz * .05 + nz * .04) * shellR * dt; }   // drifting on the eddies, buoyed outward
        }
        else if (k === K.wind || k === K.orb) {   // eddies (and orbiting lights) round the body, held at their distance from the real skin (heat keeps that distance)
          const off = (F ? F.dist(px, py, pz) : r - shellR) - heat[i];
          vel[J] += (cx * .25 * shellR - nx * off * 6) * dt; vel[J + 1] += (cy * .25 * shellR - ny * off * 6) * dt; vel[J + 2] += (cz * .25 * shellR - nz * off * 6) * dt;
        }
        else if (k === K.dust) {   // falls until it meets the real skin, then rests there and moves with it as the shape changes
          if (!settled[i]) { if ((F ? F.dist(px, py, pz) : r - shellR) < shellR * .012) { settled[i] = 1; vel[J] = nx; vel[J + 1] = ny; vel[J + 2] = nz; } else { vel[J] += cx * .02 * shellR * dt; vel[J + 2] += cz * .02 * shellR * dt; } }
          if (settled[i]) { if (F && (i + frame) % 3 === 0) { const sp = F.surface(vel[J], vel[J + 1], vel[J + 2], r * 1.15); pos[J] = sp[0]; pos[J + 1] = sp[1]; pos[J + 2] = sp[2]; } }
        }
        else if (k === K.petal) { const d = Math.exp(-dt * .3); vel[J] = vel[J] * d + cx * .05 * shellR * dt; vel[J + 1] = vel[J + 1] * d + cy * .05 * shellR * dt; vel[J + 2] = vel[J + 2] * d + cz * .05 * shellR * dt; }
        else if (k === K.spark) { const d = Math.exp(-dt * 4.5); vel[J] *= d; vel[J + 1] *= d; vel[J + 2] *= d; }
        else if (k === K.gather) {
          if (out[i]) { const d = Math.exp(-dt * 1.2); vel[J] *= d; vel[J + 1] *= d; vel[J + 2] *= d; heat[i] = Math.max(0, heat[i] - dt * .6); }
          else {   // pulled to the nucleus (harder near it, and on the beat), spiralling in; taken in where it meets the real skin, with a flash
            const q = r / shellR, a = shellR * (.5 + 2.2 * G) * (1 + 1.5 * beat) / Math.max(.6, q * q), d = Math.exp(-dt * .5);
            vel[J] = vel[J] * d - nx * a * dt + cx * .03 * shellR * dt; vel[J + 1] = vel[J + 1] * d - ny * a * dt + cy * .03 * shellR * dt; vel[J + 2] = vel[J + 2] * d - nz * a * dt + cz * .03 * shellR * dt;
            if (heat[i] === 0 && (F ? F.dist(px, py, pz) : r - shellR) < shellR * .03) { heat[i] = 1; age[i] = Math.max(age[i], life[i] - .2); vel[J] = vel[J + 1] = vel[J + 2] = 0; }
          }
        }
        else { const d = Math.exp(-dt * 1.5); vel[J] *= d; vel[J + 1] *= d; vel[J + 2] *= d; }
        if (!settled[i]) { pos[J] += vel[J] * dt; pos[J + 1] += vel[J + 1] * dt; pos[J + 2] += vel[J + 2] * dt; }
        fade[i] = k === K.gather ? Math.min(1, u / 0.12) * (out[i] ? Math.min(1, (life[i] - age[i]) / 1.4) : (.45 + .55 * Math.max(0, Math.min(1, 1.6 - .5 * r / shellR))) * (.7 + .6 * G))   // brighter as it nears, and as the charge grows
          : Math.min(1, u / 0.08) * Math.pow(1 - u, k === K.spark ? 0.8 : 1.4) * (k === K.ember ? 0.35 + 0.65 * Math.min(1, heat[i] * 1.6) : 1);
        const st = STREAK[k];
        iA[A] = pos[J]; iA[A + 1] = pos[J + 1]; iA[A + 2] = pos[J + 2]; iA[A + 3] = size[i];
        iB[A] = settled[i] ? 0 : vel[J] * st; iB[A + 1] = settled[i] ? 0 : vel[J + 1] * st; iB[A + 2] = settled[i] ? 0 : vel[J + 2] * st; iB[A + 3] = k;
        iC[A] = seed[i]; iC[A + 1] = fade[i]; iC[A + 2] = heat[i];
      }
      for (let j = 0; j < NL; j++) {   // the lightning's channels: each a streak from its start (b) to its end (a), not moving
        const A = (MAXP + j) * 4;
        if (j >= lineN) { if (iA[A + 3] === 0) break; iA[A + 3] = 0; iC[A + 1] = 0; continue; }   // filled in order, so the rest are already empty
        const o = j * 9, L = lineBuf;
        iA[A] = L[o + 3]; iA[A + 1] = L[o + 4]; iA[A + 2] = L[o + 5]; iA[A + 3] = L[o + 6];
        iB[A] = L[o + 3] - L[o]; iB[A + 1] = L[o + 4] - L[o + 1]; iB[A + 2] = L[o + 5] - L[o + 2]; iB[A + 3] = K.bolt;
        iC[A] = (j * .618) % 1; iC[A + 1] = L[o + 7]; iC[A + 2] = L[o + 8]; live++;
      }
      points.visible = live > 0;   // nothing alive: no draw (it would add nothing)
      if (live > 0) aA.needsUpdate = aB.needsUpdate = aC.needsUpdate = true;   // nothing to upload while it is not drawn
      return live;
    },
  };
}
