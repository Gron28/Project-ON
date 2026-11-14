import io
p = 'being/index.html'
s = io.open(p, encoding='utf8').read()
def rep(a, b):
    global s
    assert a in s, ('missing', a[:90])
    s = s.replace(a, b, 1)

# ---- uniforms ------------------------------------------------------------------------------------------------
rep("  uSparks: { value: 0 }, uMote: { value: .04 }, uAwake: { value: 0 }, uHat: { value: 0 }, uKick: { value: 0 }\n};",
"""  uSparks: { value: 0 }, uMote: { value: .04 }, uAwake: { value: 0 }, uHat: { value: 0 }, uKick: { value: 0 },
  // the being's additions: cymatic spherical-harmonic modes (l = 2..4), the Julia nucleus, its tissue colour
  uSH: { value: new Float32Array(21) }, uJc: { value: new THREE.Vector4(-.2, .6, .2, -.2) }, uJw: { value: 0 }, uNuc: { value: 0 }, uNucRot: { value: 0 },
  uTissueC: { value: new THREE.Color(.4, 1, .8) }
};""")
rep("  uniform float uSparks; uniform float uMote; uniform float uAwake; uniform float uHat; uniform float uKick;",
"""  uniform float uSparks; uniform float uMote; uniform float uAwake; uniform float uHat; uniform float uKick;
  uniform float uSH[ 21 ]; uniform vec4 uJc; uniform float uJw; uniform float uNuc; uniform float uNucRot; uniform vec3 uTissueC;
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
  }""")
# cymatics: the ear sculpts the shell (only near the surface, inside the clamped displacement)
rep("      if ( uSkinA > .01 ) { vec3 sn = normalize( p ), sk = skinSample( uSkin, sn ); disp +=",
    "      disp += shDisp( normalize( p ) ) * smoothstep( .3, 0., d );\n      if ( uSkinA > .01 ) { vec3 sn = normalize( p ), sk = skinSample( uSkin, sn ); disp +=")
# tissue flashes glow in the being's own (Brainbow) colour
rep("        col = mix( col, col * ( .5 + .5 * ( 1. - sk.r ) ), .5 * min( uSkinA, 1. ) ) + uLight * sk.g * .55 * uSkinA * uGlow;",
    "        col = mix( col, col * ( .5 + .5 * ( 1. - sk.r ) ), .5 * min( uSkinA, 1. ) ) + mix( uLight, uTissueC, .75 ) * sk.g * .75 * uSkinA * ( .35 + uGlow );")
# the core is a living nucleus: march the Julia set inside the core sphere, fall back to light where it is not
rep("""    } else if ( tCore < 1e8 ) {
      vec3 p = ro + rd * tCore;
      float mu = max( dot( normalize( p ), - rd ), 0. );
      col = mix( uLight * 1.6, vec3( 1. ), pow( mu, 2. ) ) * ( .7 + uCoreI + uGlow + uKick * 2. );
      alpha = 1.;
    }""", """    } else if ( tCore < 1e8 ) {
      vec3 p0 = ro + rd * tCore;
      float mu = max( dot( normalize( p0 ), - rd ), 0. );
      vec3 lightCol = mix( uLight * 1.6, vec3( 1. ), pow( mu, 2. ) ) * ( .7 + uCoreI + uGlow + uKick * 2. );
      col = lightCol; alpha = 1.;
      if ( uNuc > .01 ) {
        // nucleus space: the core sphere maps to |q| < 1.35, slowly turning with the felt pulse
        float S = uCoreR / 1.35; mat2 rn = rot( uNucRot );
        float t = 0., trap = 1., hitN = 0.; vec3 q = p0;
        float tMax = 2. * uCoreR;
        for ( int i = 0; i < 48; i++ ) {
          q = p0 + rd * t; vec3 lq = q / S; lq.xz *= rn;
          float dj = julia( lq, trap ) * S;
          if ( dj < .0006 ) { hitN = 1.; break; }
          t += max( dj * .9, .0004 ); if ( t > tMax ) break;
        }
        if ( hitN > .5 ) {
          vec2 e = vec2( .002, 0. ); float tr;
          vec3 lq = q / S; lq.xz *= rn;
          vec3 nn = normalize( vec3( julia( lq + e.xyy, tr ) - julia( lq - e.xyy, tr ), julia( lq + e.yxy, tr ) - julia( lq - e.yxy, tr ), julia( lq + e.yyx, tr ) - julia( lq - e.yyx, tr ) ) );
          float rim = pow( 1. - max( dot( nn, - rd ), 0. ), 2. );
          vec3 body = mix( uTissueC, uLight, clamp( trap * .7, 0., 1. ) ) * ( .45 + .55 * max( dot( nn, normalize( vec3( .3, .8, .5 ) ) ), 0. ) );
          col = mix( lightCol * .35, body * ( 1.3 + uCoreI ) + rim * uLight * 1.5, uNuc );
        } else col = lightCol * mix( 1., .35, uNuc );   // the light dims around the nucleus so its form reads
      }
    }""")

# ---- feedback aura: the creature renders into a target, a feedback buffer warps and decays its echoes (MilkDrop's
# iterated image map), then both are composited to the screen ----------------------------------------------------------
rep("const resize = () => { renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5) * T.res); renderer.setSize(innerWidth, innerHeight, false); renderer.getDrawingBufferSize(U.uRes.value); };",
"""/* ---------- feedback aura: an iterated image map around the creature (decay x warp of the previous frame + its glow) ---------- */
const sceneRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
let fbA = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false }), fbB = fbA.clone();
const FB = { uPrev: { value: null }, uScene: { value: null }, uZoom: { value: 1.006 }, uRot: { value: 0 }, uDecay: { value: .94 }, uGain: { value: .2 }, uTint: { value: new THREE.Color(1, 1, 1) }, uTime: { value: 0 }, uAspect: { value: 1 }, uWarp: { value: .002 } };
const fbScene = new THREE.Scene(); fbScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: FB, depthTest: false, depthWrite: false,
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
  fragmentShader: `precision highp float; varying vec2 vUv; uniform sampler2D uPrev, uScene; uniform float uZoom, uRot, uDecay, uGain, uTime, uAspect, uWarp; uniform vec3 uTint;
    void main(){
      vec2 c = (vUv - .5) * vec2(uAspect, 1.);
      float r = length(c);
      c /= uZoom;                                                       // sample nearer the centre: echoes flow outward
      float a = uRot * (1. + .6 * r); c = mat2(cos(a), -sin(a), sin(a), cos(a)) * c;
      c += uWarp * vec2(sin(c.y * 9. + uTime * .7), cos(c.x * 9. - uTime * .6));
      vec2 uv = c / vec2(uAspect, 1.) + .5;
      vec3 prev = texture2D(uPrev, uv).rgb * uDecay * uTint;
      vec4 sc = texture2D(uScene, vUv);
      vec3 emit = max(sc.rgb - .08, 0.) * uGain * (1. - .5 * sc.a);
      gl_FragColor = vec4(max(prev - .002, 0.) + emit, 1.);
    }` })));
const CO = { uFb: { value: null }, uScene: { value: null }, uFbAmt: { value: 1 } };
const coScene = new THREE.Scene(); coScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: CO, depthTest: false, depthWrite: false, transparent: true,
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
  fragmentShader: `precision highp float; varying vec2 vUv; uniform sampler2D uFb, uScene; uniform float uFbAmt;
    void main(){ vec4 sc = texture2D(uScene, vUv); vec3 fb = texture2D(uFb, vUv).rgb * uFbAmt; vec3 col = sc.rgb + fb * (1. - sc.a); float a = max(sc.a, clamp(max(fb.r, max(fb.g, fb.b)) * 1.5, 0., 1.)); gl_FragColor = vec4(col, a); }` })));
function renderBeing() {
  renderer.setRenderTarget(sceneRT); renderer.render(scene, camera);
  FB.uPrev.value = fbA.texture; FB.uScene.value = sceneRT.texture;
  renderer.setRenderTarget(fbB); renderer.render(fbScene, camera);
  const t = fbA; fbA = fbB; fbB = t;
  CO.uFb.value = fbA.texture; CO.uScene.value = sceneRT.texture;
  renderer.setRenderTarget(null); renderer.render(coScene, camera);
}
const resize = () => { renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5) * T.res); renderer.setSize(innerWidth, innerHeight, false); renderer.getDrawingBufferSize(U.uRes.value);
  const w = U.uRes.value.x, h = U.uRes.value.y; sceneRT.setSize(w, h); fbA.setSize(w >> 1, h >> 1); fbB.setSize(w >> 1, h >> 1); FB.uAspect.value = w / h; };""")
rep("  if (S.awake > .05 || ++skip % 3 === 0) renderer.render(scene, camera);", "  if (S.awake > .05 || ++skip % 3 === 0) renderBeing();")

# ---- drive the new organs from the being, every frame ---------------------------------------------------------------
rep("  if (look.hud && f0 - beingHudT > 66) { beingHudT = f0; drawBeing(); }", """  if (look.hud && f0 - beingHudT > 66) { beingHudT = f0; drawBeing(); }""")
rep("  U.uTime.value = time; U.uAwake.value = S.awake;", """  U.uTime.value = time; U.uAwake.value = S.awake;
  beingBody(dt, t);""")
rep("/* ---------- loop ---------- */", """/* ---------- the being's body organs: cymatics, nucleus, sway, bristling, aura ---------- */
const GENOME = { sh: [], cBase: new THREE.Vector4(), cMix: [] };
function growGenome(seed) {   // a per-being (and per-form) arrangement of its vibration modes and nucleus
  let a = seed >>> 0; const r = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  GENOME.sh = [5, 7, 9].map(n => { const v = Array.from({ length: n }, () => r() * 2 - 1); const l = Math.hypot(...v) || 1; return v.map(x => x / l); });
  // nucleus constants near the boundary of the quaternion Mandelbrot set, where Julia sets are most intricate
  const base = [[-.2, .6, .2, -.2], [-.291, -.399, .339, .437], [-.137, -.630, -.475, -.046], [-.445, .339, -.0889, -.562], [.185, .478, .125, -.392]][(r() * 5) | 0];
  GENOME.cBase.set(base[0], base[1], base[2], base[3]);
  GENOME.cMix = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => (r() * 2 - 1) * .09));
  const th = (mind.traits.hue + .33 + r() * .34) % 1; U.uTissueC.value.setHSL(th, .85, .6);
}
const B2 = { sy: 0, vy: 0, sx: 0, lastSub: 0, cs: new THREE.Vector4(), shAmp: [0, 0, 0] };
function beingBody(dt, t) {
  if (!GENOME.sh.length) growGenome(SEED);
  const e = earFrame, m = mind;
  // cymatics: ear energy in three tonotopic bands excites degrees l = 2, 3, 4; modes breathe on subdivisions of the felt pulse
  const bands = [[0, 10], [10, 19], [19, 28]];
  let o = 0;
  bands.forEach(([a, b], li) => {
    let E = 0; if (e) for (let k = a; k < b; k++) E += Math.log1p(e.amp[k] / .015); E /= (b - a);
    const target = Math.min(.05, .012 * Math.max(0, E - .7)) * (.4 + .9 * m.arousal) * S.awake;
    B2.shAmp[li] += (target - B2.shAmp[li]) * (1 - Math.exp(-dt / .12));
    const osc = .65 + .35 * Math.cos(2 * Math.PI * m.pulsePhase * (1 << li) + li);
    const g = GENOME.sh[li];
    for (let j = 0; j < g.length; j++) U.uSH.value[o + j] = g[j] * B2.shAmp[li] * osc;
    o += g.length;
  });
  // the nucleus: its 4D constant drifts with arousal, valence, groove and anticipation, through its own genome mixing
  const st = [m.arousal - .5, m.valence, m.groove - .3, m.daAnticipation - .2];
  for (let i = 0; i < 4; i++) { let v = GENOME.cBase.getComponent(i); for (let j = 0; j < 4; j++) v += GENOME.cMix[i][j] * st[j]; B2.cs.setComponent(i, B2.cs.getComponent(i) + (v - B2.cs.getComponent(i)) * (1 - Math.exp(-dt / 1.5))); }
  U.uJc.value.copy(B2.cs); U.uJw.value = .15 * Math.sin(t * .07) + .2 * c01(tissueStats.act * 80) - .1;
  U.uNuc.value += ((.55 + .45 * c01(1 - m.arousal + B.chill)) - U.uNuc.value) * (1 - Math.exp(-dt / 2));
  U.uNucRot.value += dt * (.15 + .5 * m.lock) * (m.valence >= 0 ? 1 : -1);
  // the shell opens when it rests, dreams or shivers, so the nucleus shows
  const quiet = c01(S.quiet / 4);
  U.uThick.value *= THREE.MathUtils.clamp(1 - .45 * quiet - .35 * B.chill + .15 * m.arousal, .35, 1.15);
  U.uOpen.value = Math.max(U.uOpen.value, .5 * quiet + .6 * B.chill);
  // the body ear: sub-bass pushes the whole body down and it bounces back (a damped spring, vestibular-like)
  const sub = e ? Math.min(1, e.sub * 6) : 0, push = Math.max(0, sub - B2.lastSub) * 2.5; B2.lastSub += (sub - B2.lastSub) * .3;
  B2.vy += (-90 * B2.sy - 9 * B2.vy) * dt - push * .9; B2.sy += B2.vy * dt;
  B2.sx += (sub * .015 * Math.sin(Math.PI * (m.pulseCount + m.pulsePhase)) - B2.sx) * (1 - Math.exp(-dt / .2));   // heavy bass sways it on the felt pulse
  U.uShift.value.x += B2.sx; U.uShift.value.y += THREE.MathUtils.clamp(B2.sy, -.06, .06);
  // roughness makes it bristle (an aversive sound; Arnal 2015)
  const rough = e ? c01(e.rough * 2.5) : 0;
  if (look.fx.spikes) U.uSpikes.value += .07 * rough * S.awake;
  // aura: echoes flow outward faster when startled or aroused, swirl with the pulse; long trails when calm or dreaming
  FB.uZoom.value = 1.004 + .02 * B.flinch + .008 * m.arousal + .006 * m.daAnticipation;
  FB.uRot.value = .006 * Math.sin(2 * Math.PI * m.pulsePhase) * (.3 + m.lock) + .002 * m.valence;
  FB.uDecay.value = THREE.MathUtils.clamp(.975 - .06 * m.arousal + .015 * quiet, .88, .975);
  FB.uGain.value = .12 + .25 * m.groove + .3 * B.chill + .2 * B.flinch;
  FB.uWarp.value = .0015 + .004 * c01(tissueStats.act * 60);
  FB.uTime.value = t; FB.uTint.value.copy(U.uLight.value).lerp(new THREE.Color(1, 1, 1), .7);
}
/* ---------- loop ---------- */""")
# a new form also re-grows its vibration modes and nucleus
rep("    } else if (e.type === 'reform') { reseed(true);", "    } else if (e.type === 'reform') { reseed(true); growGenome((SEED + (performance.now() | 0)) >>> 0);")
io.open(p, 'w', encoding='utf8').write(s)
print('patched', len(s))
