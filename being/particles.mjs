// being/particles.mjs - what the body sheds: seven kinds of particle, each given off by the materials that own it.
// The body has a nucleus and a radius, no up or down, so every particle moves along the radius or round the body:
//   (bubbles are drawn in the water itself, mBubbles in the page; petals are retired: both broke the illusion as sprites)
//   embers (fire, Mars, the Sun) stream out of the nucleus and cool (white-gold, orange, crimson, gone) · bubbles (water,
//   the Moon) rise from inside to the skin and pop · wind motes (air) circle the body in curling eddies · dust (earth,
//   Saturn) falls inward and settles on the skin · star-dust (the Sun, the Moon, Mercury, every glint) twinkles in four
//   points at the skin · petals (Venus) drift outward, turning · sparks (fire and Mars at the drop and on the kick) fly from
//   where the body was struck.
// Each is drawn as a soft capsule from where it was to where it is (motion blur: fast ones streak, slow ones are points),
// a white-hot core in a glow, never smaller than ~2.5 px (its light spread over the area it gained, so nothing aliases into
// a square). One instanced draw in the body's scene through the body's camera, added in light.
export const KINDS = ['ember', 'bubble', 'wind', 'dust', 'stardust', 'petal', 'spark', 'trail', 'orb', 'gather'];   // trail: the light a singing voice traces (trace()); gather: droplets and beads drawn in from outside (gather()), thrown back out by scatter()
const K = Object.fromEntries(KINDS.map((k, i) => [k, i]));
const MAX = 1600;
const LIFE = [[1.2, 2.4], [2.4, 4], [1.6, 2.8], [5, 8], [0.6, 1.4], [3, 5], [0.25, 0.5], [1.2, 2.2], [1.5, 3], [6, 9]];
const SIZE = [[0.005, 0.01], [0.01, 0.024], [0.004, 0.007], [0.004, 0.008], [0.009, 0.02], [0.024, 0.04], [0.004, 0.006], [0.006, 0.013], [0.003, 0.007], [0.004, 0.011]];
const STREAK = [0.09, 0, 0.14, 0, 0, 0, 0.05, 0.12, 0.025, 0.06];   // seconds of motion each kind smears over

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
    uniforms: { uRes: U.uRes, uLook: U.uLook, uZoom: U.uZoom, uScale: U.uScale, uShift: U.uShift, uShellR: U.uShellR, uTime: U.uTime, uLight: U.uLight, uAwake: U.uAwake, uGatherC: U.uGatherC || { value: new THREE.Color(1, .92, .8) } },
    transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
    vertexShader: /* glsl */`
      uniform vec2 uRes, uLook, uShift; uniform float uZoom, uScale, uShellR;
      attribute vec4 aA, aB, aC;   // pos.xyz size | smear.xyz kind | seed fade heat -
      varying vec2 vQ; varying float vLen, vKind, vSeed, vFade, vHeat, vGain;
      mat2 rot( float a ) { float c = cos( a ), s = sin( a ); return mat2( c, - s, s, c ); }
      vec3 proj( vec3 p, vec3 ro, vec3 uu, vec3 vv, vec3 ww ) { vec3 v = p - ro; float z = max( dot( v, ww ), .05 ); return vec3( vec2( dot( v, uu ), dot( v, vv ) ) * 1.6 / z * uScale + uShift, z ); }
      void main() {
        vec3 ro = vec3( 0., 0., 4.2 * uZoom ); ro.yz *= rot( uLook.y * .35 ); ro.xz *= rot( uLook.x * .55 );   // the body's camera
        vec3 ww = normalize( - ro ), uu = normalize( cross( ww, vec3( 0., 1., 0. ) ) ), vv = cross( uu, ww );
        vec3 a = proj( aA.xyz, ro, uu, vv, ww ), b = proj( aA.xyz - aB.xyz, ro, uu, vv, ww );   // now, and where it was a moment ago
        vec2 asp = vec2( uRes.y / uRes.x, 1. ) * 2.;   // screen units -> clip
        float px = 1. / uRes.y;   // one pixel in screen units (the screen is 1 unit tall here, see asp)
        float w = aA.w * 1.6 / a.z * uScale;   // the particle's radius on screen
        float wMin = 1.25 * px; vGain = w > 0. ? min( 1., ( w * w ) / ( wMin * wMin ) ) : 0.; w = max( w, wMin );
        vec2 d = a.xy - b.xy; float L = length( d ); vec2 dir = L > 1e-6 ? d / L : vec2( 1., 0. ), nrm = vec2( - dir.y, dir.x );
        float halo = 3.;   // the quad holds the glow
        vec2 c = ( a.xy + b.xy ) * .5 + dir * position.x * ( L * .5 + w * halo ) + nrm * position.y * w * halo;
        gl_Position = vec4( c * asp, 0., 1. );
        vQ = vec2( position.x * ( L * .5 + w * halo ) / w, position.y * halo );   // in particle radii, along and across the streak
        vLen = L * .5 / w;
        vKind = aB.w; vSeed = aC.x; vHeat = aC.z;
        // behind the body and within its outline: mostly hidden
        float behind = step( 0., dot( aA.xyz, ww ) ) * step( length( aA.xyz - ww * dot( aA.xyz, ww ) ), uShellR * 1.05 );
        vFade = aC.y * ( 1. - .85 * behind ) * ( L > 1e-6 ? min( 1., 2.5 / ( 1. + vLen ) ) + .25 : 1. );   // a long streak spreads its light
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uAwake; uniform vec3 uLight, uGatherC;
      varying vec2 vQ; varying float vLen, vKind, vSeed, vFade, vHeat, vGain;
      vec3 blackbody( float h ) { return vec3( smoothstep( .05, .45, h ) * 1.6, smoothstep( .3, .85, h ) * 1.1, smoothstep( .7, 1.2, h ) * .9 ); }
      void main() {
        // distance to the streak's segment, in particle radii
        float x = max( abs( vQ.x ) - vLen, 0. ), d = length( vec2( x, vQ.y ) ), k = vKind;
        if ( d > 3. ) discard;
        float edge = smoothstep( 3., 2., d ), core = exp( - d * d * 2.2 ), glow = exp( - d * 1.7 ) * .28 * edge;
        vec3 c = vec3( 0. );
        if ( k < .5 ) c = blackbody( vHeat ) * ( core * 1.4 + glow );   // ember: its heat falls as it streams out
        else if ( k < 1.5 ) {   // bubble: a bright rim, a highlight, clear inside; a flash as it pops (heat = popping)
          float rim = smoothstep( .25, 0., abs( d - .9 ) ), hl = exp( - dot( vQ - vec2( -.35, .35 ), vQ - vec2( -.35, .35 ) ) * 18. );
          c = vec3( .55, .85, 1. ) * rim * .5 + vec3( 1. ) * hl * .7 + vec3( .7, .95, 1. ) * vHeat * ( core + glow * 2. );
        }
        else if ( k < 2.5 ) c = vec3( .9, .95, 1. ) * ( core * .7 + glow * .6 );   // wind: a pale streak
        else if ( k < 3.5 ) c = mix( vec3( .55, .42, .24 ), vec3( 1., .86, .2 ), step( .7, vSeed ) ) * ( core * .8 + glow * .3 );   // dust; some seed-gold
        else if ( k < 4.5 ) {   // star-dust: four points, twinkling
          float tw = .5 + .5 * sin( uTime * 9. + vSeed * 70. );
          float star = ( exp( - abs( vQ.x ) * 7. ) * exp( - abs( vQ.y ) * .9 ) + exp( - abs( vQ.y ) * 7. ) * exp( - abs( vQ.x ) * .9 ) ) * edge;
          c = mix( vec3( 1., .96, .86 ), uLight, .25 ) * ( core * 1.5 + star * .9 + glow ) * tw;
        } else if ( k < 5.5 ) {   // petal: an oval, turning, lit from within
          float a = vSeed * 9. + uTime * 1.5; vec2 p = mat2( cos( a ), - sin( a ), sin( a ), cos( a ) ) * vQ;
          float m = smoothstep( 1.1, .8, length( p * vec2( 1., 2.2 ) ) );
          c = mix( vec3( .35, .85, .55 ), vec3( 1., .55, .72 ), step( .5, fract( vSeed * 13. ) ) ) * ( m * .75 + glow * .3 );
        } else if ( k < 6.5 ) c = mix( vec3( 1., .55, .2 ), vec3( 1., .95, .8 ), core ) * ( core * 2. + glow * 1.2 );   // spark: white-hot streak in orange
        else if ( k > 8.5 ) {   // gather: a droplet or a bead, in the colour it is given (uGatherC), a highlight on its outer side; a flash as it is taken in (heat)
          float hl = exp( - dot( vQ - vec2( -.3, .3 ), vQ - vec2( -.3, .3 ) ) * 14. );
          c = mix( uGatherC, vec3( 1. ), core * .55 ) * ( core * 1.3 + glow * .8 ) + vec3( 1. ) * hl * .5 * step( .5, vSeed ) + mix( uGatherC, vec3( 1. ), .5 ) * vHeat * ( core * 2. + glow * 3. );
        }
        else if ( k > 7.5 ) c = mix( vec3( 1., .91, .45 ), vec3( 1. ), core * .8 ) * ( core * 1.5 + glow * .9 ) * ( .7 + .3 * sin( uTime * 7. + vSeed * 40. ) );   // orb: a tiny pale-yellow light
        else c = mix( mix( uLight, vec3( .85, .9, 1. ), .5 ), vec3( 1. ), core * .7 ) * ( core * 1.2 + glow * 1.4 ) * ( .7 + .3 * sin( uTime * 3. + vSeed * 20. ) );   // trail: a soft breathing light
        float f = vFade * vGain * ( .3 + .7 * uAwake );
        gl_FragColor = vec4( c * f, clamp( max( c.r, max( c.g, c.b ) ) * f, 0., 1. ) );
      }`,
  });
  const points = new THREE.Mesh(geo, mat);   // (named points for the page: it is one instanced draw of streaked sprites)
  points.frustumCulled = false; points.renderOrder = 10;
  let cursor = 0, strike = [0, 0, 1], F = null, frame = 0;
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
    else if (k === K.dust || k === K.bubble) d = rdir();
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
      const i = cursor, J = i * 3; cursor = (cursor + 1) % MAX;
      const o = origin(k, shellR, burst), [nx, ny, nz] = o.n, R = shellR;
      let p = [o.s[0] + nx * R * .015, o.s[1] + ny * R * .015, o.s[2] + nz * R * .015], v = [0, 0, 0];
      if (k === K.ember) { const sp = R * (0.5 + 0.9 * Math.random()); v = [nx * sp, ny * sp, nz * sp]; }   // straight out of the skin
      else if (k === K.spark) { const sp = R * (2.5 + 2.5 * Math.random()) * (1 + burst); v = [nx * sp, ny * sp, nz * sp]; }
      else if (k === K.stardust) { p = [o.s[0] + nx * R * .03, o.s[1] + ny * R * .03, o.s[2] + nz * R * .03]; }
      else if (k === K.wind) { const off = R * (.15 + .3 * Math.random()), ax = norm3([.2, 1, .1]), t = norm3([ny * ax[2] - nz * ax[1], nz * ax[0] - nx * ax[2], nx * ax[1] - ny * ax[0]]), sp = R * (.6 + .6 * Math.random()) * (Math.random() < .5 ? 1 : -1);
        p = [o.s[0] + nx * off, o.s[1] + ny * off, o.s[2] + nz * off]; v = [t[0] * sp, t[1] * sp, t[2] * sp]; heat[i] = off; }   // round the body, a set distance off the skin
      else if (k === K.orb) { const off = R * (.08 + .5 * Math.random()), ax = norm3([Math.random() - .5, 1, Math.random() - .5]), t = norm3([ny * ax[2] - nz * ax[1], nz * ax[0] - nx * ax[2], nx * ax[1] - ny * ax[0]]), sp = R * (1.3 + 1.4 * Math.random()) * (Math.random() < .5 ? 1 : -1);
        p = [o.s[0] + nx * off, o.s[1] + ny * off, o.s[2] + nz * off]; v = [t[0] * sp, t[1] * sp, t[2] * sp]; heat[i] = off; }   // tiny lights orbiting fast
      else if (k === K.dust) { const r = Math.hypot(...o.s) * (1.5 + .5 * Math.random()), sp = -R * (.15 + .15 * Math.random()); p = [o.d[0] * r, o.d[1] * r, o.d[2] * r]; v = [o.d[0] * sp, o.d[1] * sp, o.d[2] * sp]; }   // falls inward onto it
      else if (k === K.bubble) { const r = R * (.3 + .4 * Math.random()), sp = R * .2; p = [o.d[0] * r, o.d[1] * r, o.d[2] * r]; v = [o.d[0] * sp, o.d[1] * sp, o.d[2] * sp]; }
      else if (k === K.petal) { const sp = R * .2; v = [nx * sp, ny * sp, nz * sp]; }
      else if (k === K.gather) {   // from a shell well outside the body, already turning a little round it, so the cloud spirals in
        const r = Math.hypot(...o.s) * (2.2 + 1.2 * Math.random()), ax = rdir(), t = norm3([o.d[1] * ax[2] - o.d[2] * ax[1], o.d[2] * ax[0] - o.d[0] * ax[2], o.d[0] * ax[1] - o.d[1] * ax[0]]), sp = R * (.25 + .35 * Math.random()), si = -R * (.1 + .25 * G);
        p = [o.d[0] * r, o.d[1] * r, o.d[2] * r]; v = [t[0] * sp + o.d[0] * si, t[1] * sp + o.d[1] * si, t[2] * sp + o.d[2] * si]; }
      pos[J] = p[0]; pos[J + 1] = p[1]; pos[J + 2] = p[2]; vel[J] = v[0]; vel[J + 1] = v[1]; vel[J + 2] = v[2];
      kind[i] = k; age[i] = 0; seed[i] = Math.random(); settled[i] = out[i] = 0; if (k !== K.wind && k !== K.orb) heat[i] = k === K.ember ? 0.9 + 0.3 * Math.random() : 0;
      life[i] = LIFE[k][0] + (LIFE[k][1] - LIFE[k][0]) * Math.random();
      size[i] = (SIZE[k][0] + (SIZE[k][1] - SIZE[k][0]) * Math.random()) * shellR / 0.36;
    }
  }

  return {
    points, KINDS,
    /** the voice trace: n lights left at a point (where the trace is now), drifting slowly, so its path stays a while as a trail */
    trace(x, y, z, n, shellR) {
      for (let j = 0; j < n; j++) {
        const i = cursor, J = i * 3; cursor = (cursor + 1) % MAX;
        const jt = shellR * .03; pos[J] = x + (Math.random() - .5) * jt; pos[J + 1] = y + (Math.random() - .5) * jt; pos[J + 2] = z + (Math.random() - .5) * jt;
        const l = Math.hypot(x, y, z) || 1, sp = shellR * .04; vel[J] = x / l * sp; vel[J + 1] = y / l * sp; vel[J + 2] = z / l * sp;
        kind[i] = K.trail; age[i] = 0; seed[i] = Math.random(); settled[i] = out[i] = 0; heat[i] = 0;
        life[i] = LIFE[K.trail][0] + (LIFE[K.trail][1] - LIFE[K.trail][0]) * Math.random();
        size[i] = (SIZE[K.trail][0] + (SIZE[K.trail][1] - SIZE[K.trail][0]) * Math.random()) * shellR / 0.36;
      }
    },
    /** a burst of one kind now (glints, drops, kicks); sparks fly from a fresh strike point */
    burst(kindName, n, shellR) { const k = K[kindName]; if (k === undefined) return; if (k === K.spark) strike = rdir(); emit(k, n, shellR, 1); },
    /** droplets drawn in from outside: n now, with the charge g (0..1) setting how hard they are pulled */
    gather(n, shellR, g) { G = Math.max(0, Math.min(1, g)); emit(K.gather, n, shellR); },
    /** the release: every drop still on its way in is thrown back out, a shock of light */
    scatter(shellR) {
      for (let i = 0; i < MAX; i++) if (kind[i] === K.gather && age[i] < life[i] && !out[i]) {
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
      const mod = [.35 + 1.4 * beat + .8 * kick, 1, .5 + .9 * aro, .7 + .5 * aro, .45 + 1.3 * beat, 1, 1, 1, .6 + .8 * aro, 1];
      for (let k = 0; k < KINDS.length; k++) { acc[k] += (rates[k] || 0) * mod[k] * dt; const n = Math.floor(acc[k]); if (n > 0) { acc[k] -= n; emit(k, Math.min(n, 40), shellR); } }
      let live = 0;
      for (let i = 0; i < MAX; i++) {
        const J = i * 3, A = i * 4;
        if (age[i] >= life[i]) { iC[A + 1] = 0; iA[A + 3] = 0; continue; }
        live++;
        age[i] += dt; const u = Math.min(1, age[i] / life[i]), k = kind[i];
        const px = pos[J], py = pos[J + 1], pz = pos[J + 2], r = Math.hypot(px, py, pz) || 1e-6, nx = px / r, ny = py / r, nz = pz / r;
        // a gentle curl of eddies (divergence-free enough to look like air), different per particle
        const s = seed[i] * 40, cx = Math.sin(py * 9 + t * 1.3 + s) - Math.sin(pz * 8 - t * 1.1), cy = Math.sin(pz * 9 + t * 1.2 + s) - Math.sin(px * 8 + t), cz = Math.sin(px * 9 - t * 1.4 + s) - Math.sin(py * 8 + t * .9);
        if (k === K.ember) { const d = Math.exp(-dt * 1.2); vel[J] = vel[J] * d + cx * .06 * shellR * dt * 10; vel[J + 1] = vel[J + 1] * d + cy * .06 * shellR * dt * 10; vel[J + 2] = vel[J + 2] * d + cz * .06 * shellR * dt * 10; heat[i] = Math.max(0, heat[i] - dt * (0.45 + 0.4 * seed[i])); }
        else if (k === K.bubble) { if (r > shellR * 0.97 && heat[i] === 0) { heat[i] = 1; age[i] = Math.max(age[i], life[i] - 0.18); vel[J] = vel[J + 1] = vel[J + 2] = 0; } }   // at the skin it pops
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
      aA.needsUpdate = aB.needsUpdate = aC.needsUpdate = true;
      return live;
    },
  };
}
