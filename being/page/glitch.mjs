// being/page/glitch.mjs - glitch artifacts (lab): style, amount and reactive envelope for the composite pass, window.__glitch
export function createGlitch(ctx) {
  const { CO, c01 } = ctx;
  const GLX_STYLES = ['off', 'split', 'tear', 'mosh', 'sort', 'crt', 'corrupt', 'cycle'];
  const GLX = (() => { const d = { style: 'off', amt: .6, react: true }; try { return { ...d, ...JSON.parse(localStorage.getItem('on-glitch') || '{}') }; } catch { return d; } })();
  const GLS = { hit: 0, env: 0, hold: 0, cur: 1, swapT: 0 };
  function glitchHit(s) {
    if (GLX.style === 'off') return;
    if (GLX.style === 'cycle' && s > GLS.hit + .2) GLS.cur = 1 + (Math.random() * 6 | 0);
    GLS.hit = Math.max(GLS.hit, s); GLS.hold = 0;
  }
  function glitchFrame(dt, t) {
    const { B, mind, SLEEP } = ctx;
    const i = GLX_STYLES.indexOf(GLX.style);
    if (i <= 0) { CO.uGA.value = 0; return; }
    GLS.hit *= Math.exp(-dt / .2);
    const want = GLX.react ? Math.min(1, Math.max(GLS.hit, B.flinch, .4 * c01(mind.surprise - 1))) : 1;
    GLS.env += (want - GLS.env) * (1 - Math.exp(-dt / (want > GLS.env ? .02 : .25)));
    if ((GLS.hold -= dt) <= 0) { GLS.hold = .04 + Math.random() * .14; CO.uGT.value = Math.random() * 100; }   // a glitch frame: the pattern holds, then jumps
    if (GLX.style === 'cycle' && !GLX.react && (GLS.swapT -= dt) <= 0) { GLS.swapT = 1.5 + Math.random() * 2.5; GLS.cur = 1 + (Math.random() * 6 | 0); }
    CO.uGS.value = i === 7 ? GLS.cur : i;
    CO.uGA.value = Math.max(0, Math.min(1, GLX.amt)) * GLS.env * (1 - SLEEP.z);
    CO.uGTm.value = t;
  }
  window.__glitch = (o) => {
    if (o && typeof o === 'object') {
      if (GLX_STYLES.includes(o.style)) GLX.style = o.style;
      if (Number.isFinite(o.amt)) GLX.amt = Math.max(0, Math.min(1, o.amt));
      if (typeof o.react === 'boolean') GLX.react = o.react;
      try { localStorage.setItem('on-glitch', JSON.stringify(GLX)); } catch {}
    }
    return { ...GLX, styles: GLX_STYLES };
  };
  return { GLX, glitchHit, glitchFrame };
}
