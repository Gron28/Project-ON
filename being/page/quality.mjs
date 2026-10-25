// being/page/quality.mjs - how much the page draws: the governor ('auto' in Settings) and the body's upscale
//
// The governor (pure, no DOM, tests/quality.test.mjs) watches the time between frames against the display's own interval,
// which it learns (the lower envelope of the intervals), so it works on 60 Hz and on fast displays alike. A frame counts as
// late only when it missed the display's interval while the page's own work (the CPU) was not what held it, so a busy main
// thread never blurs the picture. Sustained lateness steps down a ladder, cheapest-to-see first:
//   1. on a fast display (> ~83 Hz), the body is drawn every other refresh (the aura's trails are compensated, as asleep)
//   2. the song's skin is baked every 3rd frame instead of every 2nd while it shows
//   3. the body's resolution, in 0.1 steps down to 0.5 (upscaled by the pass below, the window itself stays sharp)
// It climbs back in the opposite order after a stretch of on-time frames. A climb that is undone soon after waits twice as
// long before the next try (up to ~1 minute), so it does not flicker between two steps.
export const LADDER = { kMin: .5, kDown: .1, kUp: .05, slowMs: 2000, warmS: 5, probeMs: 8000, probeMax: 64000 };

export function createGovernor() {
  return { res: 1, auto: true, hz: 0, k: 1, cap: 0, bake: 2, slow: 0, fast: 0, last: 0, iv: 16.7, wait: LADDER.probeMs, upAt: -1e9, steps: 0 };
}

/** one frame: ft = ms since the last frame, cpu = ms the page's own work took last frame, now = ms, t = the page's clock (s).
 *  Returns 'res' when the resolution changed (the caller resizes), 'step' for another rung, or ''. */
export function governorStep(Q, ft, cpu, now, t) {
  if (!Q.auto) {   // sharp / light: the slider's resolution, everything else as designed
    const changed = Q.k !== Q.res; Q.k = Q.res; Q.cap = 0; Q.bake = 2; Q.slow = Q.fast = 0;
    return changed ? 'res' : '';
  }
  if (!(ft > 0) || ft >= 1000 || t < LADDER.warmS) return '';   // hidden windows, start-up (shaders compile, models load)
  // the display's interval: its refresh rate when the main process knows it (Q.hz), else learned: follows a shorter frame quickly
  // and a longer one very slowly (minutes), so a page that runs slow for a while is not taken for a slow display
  if (Q.hz > 20) Q.iv = 1000 / Q.hz;
  else { Q.iv += (ft - Q.iv) * (ft < Q.iv ? .2 : .0002); Q.iv = Math.min(34, Math.max(4, Q.iv)); }
  const cpuBound = cpu > ft * .5;   // the page's own work filled the frame: a smaller picture would not help
  const late = ft > Math.max(Q.iv * 1.45, 12) && !cpuBound, onTime = ft < Q.iv * 1.25;
  if (late) { Q.slow += ft; Q.fast = Math.max(0, Q.fast - 1000); }
  else { Q.slow = Math.max(0, Q.slow - ft); if (onTime) Q.fast += ft; }
  if (Q.slow > LADDER.slowMs) {
    Q.slow = 0; Q.fast = 0;
    if (now - Q.upAt < 6000) Q.wait = Math.min(LADDER.probeMax, Q.wait * 2);   // the last climb did not hold
    if (!Q.cap && Q.iv < 12) { Q.cap = 1; Q.steps++; return 'step'; }
    if (Q.bake < 3) { Q.bake = 3; Q.steps++; return 'step'; }
    if (Q.k > LADDER.kMin) { Q.k = Math.max(LADDER.kMin, +(Q.k - LADDER.kDown).toFixed(3)); Q.steps++; return 'res'; }
    return '';
  }
  if (Q.fast > Q.wait) {
    Q.fast = 0;
    if (now - Q.upAt > 30000) Q.wait = LADDER.probeMs;   // the last climb held: back to the normal pace
    if (Q.k < Q.res) { Q.k = Math.min(Q.res, +(Q.k + LADDER.kUp).toFixed(3)); Q.upAt = now; return 'res'; }
    if (Q.bake > 2) { Q.bake = 2; Q.upAt = now; return 'step'; }
    if (Q.cap) { Q.cap = 0; Q.upAt = now; return 'step'; }
  }
  if (Q.k > Q.res) { Q.k = Q.res; return 'res'; }
  return '';
}

/* the body's upscale: Catmull-Rom (sharper than the bilinear stretch a smaller canvas gets) clamped to the four nearest
   source texels (no ringing at the metal's edges), then a little contrast-adaptive sharpening (after AMD's CAS) that
   restores the detail lost to the lower resolution without halos. Premultiplied alpha in and out. */
export const UPSCALE_FRAG = /* glsl */`precision highp float; varying vec2 vUv; uniform sampler2D uSrc; uniform vec2 uSrcSize; uniform float uSharp;
  vec4 at( vec2 tc ) { return texture2D( uSrc, tc / uSrcSize ); }
  void main() {
    vec2 sp = vUv * uSrcSize, tc = floor( sp - .5 ) + .5, f = sp - tc;
    vec2 w0 = f * ( -.5 + f * ( 1. - .5 * f ) ), w1 = 1. + f * f * ( -2.5 + 1.5 * f ), w2 = f * ( .5 + f * ( 2. - 1.5 * f ) ), w3 = f * f * ( -.5 + .5 * f );
    vec2 w12 = w1 + w2, t0 = tc - 1., t3 = tc + 2., t12 = tc + w2 / w12;
    vec4 c = ( at( vec2( t12.x, t0.y ) ) * w12.x * w0.y )
           + ( at( vec2( t0.x, t12.y ) ) * w0.x * w12.y + at( t12 ) * w12.x * w12.y + at( vec2( t3.x, t12.y ) ) * w3.x * w12.y )
           + ( at( vec2( t12.x, t3.y ) ) * w12.x * w3.y );
    c /= w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;   // the four corner taps dropped (they weigh < 1%)
    vec4 a = at( tc ), b = at( tc + vec2( 1., 0. ) ), d = at( tc + vec2( 0., 1. ) ), e = at( tc + 1. );
    vec4 mn = min( min( a, b ), min( d, e ) ), mx = max( max( a, b ), max( d, e ) );
    c = clamp( c, mn, mx );
    if ( uSharp > 0. ) {   // CAS: sharpen less where the neighbourhood already spans the full range
      vec4 blur = ( a + b + d + e ) * .25;
      vec3 amp = sqrt( clamp( min( mn.rgb, 1. - mx.rgb ) / max( mx.rgb, 1e-4 ), 0., 1. ) );
      c.rgb += ( c.rgb - blur.rgb ) * amp * uSharp;
      c = clamp( c, mn, mx );
    }
    gl_FragColor = vec4( min( c.rgb, vec3( c.a ) ), c.a );
  }`;

export function createUpscale(THREE, renderer) {
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const UU = { uSrc: { value: null }, uSrcSize: { value: new THREE.Vector2(1, 1) }, uSharp: { value: .35 } };
  const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: UU, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }', fragmentShader: UPSCALE_FRAG })));
  return {
    rt, uniforms: UU,
    setSize(w, h) { if (rt.width !== w || rt.height !== h) rt.setSize(w, h); },
    /** src (a render target) -> this pass's target at its own size; returns the texture to show */
    render(src) {
      UU.uSrc.value = src.texture; UU.uSrcSize.value.set(src.width, src.height);
      const prev = renderer.getRenderTarget(); renderer.setRenderTarget(rt); renderer.render(scene, cam); renderer.setRenderTarget(prev);
      return rt.texture;
    },
  };
}
