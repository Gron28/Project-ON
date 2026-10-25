// being/page/body-bound.mjs - a sphere (world units, round the nucleus) outside which the body shader's map() cannot reach its
// hit distance, from the uniforms that place each part; 1.45 (the march's own sphere) when a part is unbounded (rise, ether).
// Pure. Outside every part's extent E, each smin can lower the distance by at most its largest k, the wobble by .016 uWob,
// the displacement by its clamp .12; the proposed materials' .6 scale divides that margin.
const len = (v) => Math.hypot(v.x, v.y, v.z);
export function bodyBound(U) {
  const v = (k) => U[k].value, OUT = 1.45;
  if (v('uRise') > .001 || v('uEther') > .01) return OUT;
  const R = v('uShellR'), prop = v('uProp') > .5;
  let pr = 0;
  if (prop) { const a = v('uPWa'), b = v('uPWb'), aro = Math.abs(v('uAro')), bp = Math.abs(v('uBeatPulse')), kick = Math.abs(v('uKick')), echo = Math.abs(v('uEcho'));
    pr = R * (Math.abs(a.x) * .55 * (.05 + .12 * aro + .06 * bp) + Math.abs(a.y) * .035 * aro * aro + Math.abs(a.z) * (.145 + .003 + .007 * aro + .028 * echo) + Math.abs(a.w) * .23 + Math.abs(b.z) * (.03 + .05 * aro + .16 * kick)); }
  let E = R + pr + v('uThick') + 2 * Math.abs(v('uVar')), k = 0;
  const K = v('uK');
  for (const c of v('uL')) if (c.w > .001) { E = Math.max(E, len(c) + c.w); k = Math.max(k, K); }
  for (const c of v('uD')) if (c.w > .001) { E = Math.max(E, len(c) + c.w * 1.5); k = Math.max(k, K * .8); }
  for (const c of v('uS')) if (c.w > .001) { E = Math.max(E, len(c) + c.w); k = Math.max(k, K * .7); }
  const T = v('uT'), TB = v('uTB'), TP = T.length / TB.length;
  TB.forEach((b, i) => { if (T[TP * i + 1].w > .002) { E = Math.max(E, len(b) + b.w); k = Math.max(k, Math.min(K * .9, .09)); } });
  if (v('uWRA') > .01) for (const r of v('uWR')) { if (Math.abs(len(r) - 1) > .01) return OUT; E = Math.max(E, Math.abs(r.w) + 3 * .042 * v('uWRA') + .01); k = Math.max(k, .07); }
  const SA = v('uSerA'), SB = v('uSerB');
  if (Math.max(...SA) > .01) SA.forEach((a, s) => { if (a > .01) { E = Math.max(E, Math.min(Math.sqrt(2.2), len(SB[s]) + SB[s].w + .2)); k = Math.max(k, .06); } });
  const m = (k + .016 * Math.abs(v('uWob')) + .12 + .004) / (prop ? .6 : 1);
  const Rb = (E + m) * (1 + Math.max(0, v('uWide')));
  return Number.isFinite(Rb) ? Math.min(OUT, Rb) : OUT;
}
