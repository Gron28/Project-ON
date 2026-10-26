// being/page/quality.mjs - how much the page draws: the governor ('auto' in Settings) and the body's upscale / downscale
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
// Above the designed picture there are rich rungs, climbed only when the page's own GPU time is measured (Q.gpu, ms per drawn
// frame from a timer query; unknown = never) and the next rung is predicted to stay under half the display's interval:
//   R1. the song's skin is baked every frame (Q.bake 1)
//   R2. the body is drawn above the window's resolution, in 0.25 steps up to 2x, and filtered down (supersampling: the metal's
//       highlights and thin edges stop crawling); the CelLab inside, drawn at half the body's size, sharpens with it
// They are the first thing given back: all at once when frames run late or the GPU time passes the interval, a step at a time
// when it stays over ~80% of the interval for a second.
export const LADDER = { kMin: .5, kDown: .1, kUp: .05, slowMs: 2000, warmS: 5, probeMs: 8000, probeMax: 64000, kMax: 2, kRich: .25, richBudget: .5, heavy: .8, heavyMs: 1000 };

export function createGovernor() {
  return { res: 1, auto: true, hz: 0, k: 1, cap: 0, bake: 2, slow: 0, fast: 0, last: 0, iv: 16.7, prev: 16.7, gpu: NaN, heavy: 0, wait: LADDER.probeMs, upAt: -1e9, steps: 0 };
}

/** one frame: ft = ms since the last frame, cpu = ms the page's own work took last frame, now = ms, t = the page's clock (s).
 *  Returns 'res' when the resolution changed (the caller resizes), 'step' for another rung, or ''. */
export function governorStep(Q, ft, cpu, now, t) {
  if (!Q.auto) {   // sharp / light: the slider's resolution, everything else as designed
    const changed = Q.k !== Q.res; Q.k = Q.res; Q.cap = 0; Q.bake = 2; Q.slow = Q.fast = 0;
    return changed ? 'res' : '';
  }
  if (!(ft > 0) || ft >= 1000 || t < LADDER.warmS) return '';   // hidden windows, start-up (shaders compile, models load)
  // the display's interval: its refresh rate when the main process knows it (Q.hz), else learned: follows a shorter frame
  // within a few dozen frames and a longer one very slowly (minutes), so a page that runs slow for a while is not taken for a
  // slow display. A short frame right after a late one is the compositor catching up, not a faster display, and teaches
  // nothing (on Linux X11 the rate is unknown, and following those frames once took a 60 Hz display for ~110 Hz)
  if (Q.hz > 20) Q.iv = 1000 / Q.hz;
  else if (!(ft < Q.iv && Q.prev > Q.iv * 1.25)) { Q.iv += (ft - Q.iv) * (ft < Q.iv ? .05 : .0002); Q.iv = Math.min(34, Math.max(4, Q.iv)); }
  Q.prev = ft;
  const cpuBound = cpu > ft * .5;   // the page's own work filled the frame: a smaller picture would not help
  const late = ft > Math.max(Q.iv * 1.45, 12) && !cpuBound, onTime = ft < Q.iv * 1.25;
  if (late) { Q.slow += ft; Q.fast = Math.max(0, Q.fast - 1000); }
  else { Q.slow = Math.max(0, Q.slow - ft); if (onTime) Q.fast += ft; }
  // the rich rungs: given back at once when frames run late or the GPU time passes the whole interval (a costly material just
  // arrived: it would stutter for the second lateness takes to add up), a step at a time when the GPU nears the interval
  if (Q.k > 1 || Q.bake < 2) {
    Q.heavy = Q.gpu > Q.iv * LADDER.heavy ? Q.heavy + ft : Math.max(0, Q.heavy - ft);
    if (Q.slow > LADDER.slowMs * .5 || (Q.k > 1 && Q.gpu > Q.iv)) { Q.slow = 0; Q.fast = 0; Q.heavy = 0; Q.wait = Math.min(LADDER.probeMax, Q.wait * 2); Q.bake = 2; if (Q.k > 1) { Q.k = 1; Q.steps++; return 'res'; } Q.steps++; return 'step'; }
    if (Q.heavy > LADDER.heavyMs) {
      Q.heavy = 0; Q.fast = 0; Q.wait = Math.min(LADDER.probeMax, Q.wait * 2); Q.steps++;
      if (Q.k > 1) { Q.k = Math.max(1, +(Q.k - LADDER.kRich).toFixed(3)); return 'res'; }
      Q.bake = 2; return 'step';
    }
  }
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
    // rich: only at the full designed picture, with the GPU's own time known, when the next rung is predicted to fit
    // (the whole frame's GPU time scaled by the body's pixel count: an overestimate, as only the body grows)
    if (Q.res >= 1 && Q.gpu > 0) {
      const budget = Q.iv * LADDER.richBudget;
      if (Q.bake === 2 && Q.gpu < budget) { Q.bake = 1; Q.upAt = now; return 'step'; }
      const k2 = +(Math.max(1, Q.k) + LADDER.kRich).toFixed(3);
      if (Q.bake === 1 && k2 <= LADDER.kMax && Q.gpu * (k2 / Math.max(1, Q.k)) ** 2 < budget) { Q.k = k2; Q.upAt = now; return 'res'; }
    }
  }
  const top = Q.res >= 1 ? LADDER.kMax : Q.res;   // a lowered slider is a ceiling for everything
  if (Q.k > top) { Q.k = top; return 'res'; }
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

/* the body drawn above the window's resolution (the rich rungs), filtered down: four bilinear taps a quarter of the footprint
   from the centre. At 2x each tap lands on one source texel, so it is the exact 2x2 average; between 1x and 2x it is a small
   tent. Premultiplied alpha in and out. */
export const DOWNSCALE_FRAG = /* glsl */`precision highp float; varying vec2 vUv; uniform sampler2D uSrc; uniform vec2 uSrcSize, uDstSize;
  void main() {
    vec2 o = .25 / uDstSize;   // a quarter of a window pixel, in texture coordinates
    gl_FragColor = .25 * ( texture2D( uSrc, vUv + vec2( -o.x, -o.y ) ) + texture2D( uSrc, vUv + vec2( o.x, -o.y ) )
                         + texture2D( uSrc, vUv + vec2( -o.x, o.y ) ) + texture2D( uSrc, vUv + vec2( o.x, o.y ) ) );
  }`;

export function createUpscale(THREE, renderer) {
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const UU = { uSrc: { value: null }, uSrcSize: { value: new THREE.Vector2(1, 1) }, uSharp: { value: .35 }, uDstSize: { value: new THREE.Vector2(1, 1) } };
  const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }';
  const up = new THREE.ShaderMaterial({ uniforms: UU, depthTest: false, depthWrite: false, vertexShader: VS, fragmentShader: UPSCALE_FRAG });
  const down = new THREE.ShaderMaterial({ uniforms: UU, depthTest: false, depthWrite: false, vertexShader: VS, fragmentShader: DOWNSCALE_FRAG });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), up); scene.add(quad);
  return {
    rt, uniforms: UU,
    setSize(w, h) { if (rt.width !== w || rt.height !== h) rt.setSize(w, h); },
    /** src (a render target) -> this pass's target at its own size, up or down; returns the texture to show */
    render(src) {
      UU.uSrc.value = src.texture; UU.uSrcSize.value.set(src.width, src.height); UU.uDstSize.value.set(rt.width, rt.height);
      quad.material = src.width > rt.width ? down : up;
      const prev = renderer.getRenderTarget(); renderer.setRenderTarget(rt); renderer.render(scene, cam); renderer.setRenderTarget(prev);
      return rt.texture;
    },
  };
}
