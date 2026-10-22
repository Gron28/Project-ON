// being/page/immersive.mjs - full screen: ON smaller on black, its light free to open across the screen at strong moments
export function createImmersive(ctx) {
  const { U, CO, FB, FX, EXT, c01 } = ctx;
  const IMM = { on: false, k: 0, spread: 0, idle: 0 };
  window.pet?.onImmersive?.((v) => { IMM.on = !!v; });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && IMM.on) window.pet?.immersive?.(false); });
  addEventListener('mousemove', () => { IMM.idle = 0; document.body.style.cursor = ''; });
  window.__immersive = (v) => { IMM.on = !!v; return IMM.on; };   // lab: the page side only
  function immersiveFrame(dt) {
    const { JS, B, PHEN, RS, REST, SLEEP } = ctx;
    IMM.k += ((IMM.on ? 1 : 0) - IMM.k) * (1 - Math.exp(-dt / .8));
    const want = IMM.on ? Math.max(JS.t || 0, JS.j || 0, JS.peak || 0, B.chill || 0, PHEN.w[0] || 0, RS.k || 0, EXT.spread, c01((REST.M - .6) / .3)) * (1 - SLEEP.z) : 0;
    IMM.spread += (want - IMM.spread) * (1 - Math.exp(-dt / (want > IMM.spread ? 3 : 7)));
    const R = .5 + IMM.k * (.35 + 2.6 * IMM.spread);
    U.uMaskR.value = CO.uMaskR.value = R; U.uImm.value = CO.uImm.value = IMM.k;
    if (IMM.k > .01) { U.uScale.value *= 1 - .4 * IMM.k;
      if (FX.aura) { const k = IMM.spread * IMM.k; FB.uGain.value = Math.min(.5, FB.uGain.value + .1 * k); FB.uZoom.value += .014 * k; FB.uDecay.value = Math.max(FB.uDecay.value, .962 + .019 * k); FB.uGain.value *= 1 - .25 * k * (PHEN.w[0] || 0); } }   // (the sun already floods with its shafts: its echo stays leaner)   // opened, its echoes travel and last long enough to cross the screen
    if (IMM.on && (IMM.idle += dt) > 2.5) document.body.style.cursor = 'none';   // the pointer hides while still
  }
  return { IMM, immersiveFrame };
}
