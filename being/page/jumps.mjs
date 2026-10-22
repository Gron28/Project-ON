// being/page/jumps.mjs - lab: __jumpWatch = true records every uniform component that moves by more than a fifth of its recent range in one
// frame (window.__jumps: { t, name, from, to }), to find what changes without an animation
export function createJumpScan(U) {
  const JW = { last: new Map(), range: new Map() };
  function jumpScan() {
    const t = performance.now() / 1000, out = window.__jumps || (window.__jumps = []);
    const visit = (name, x) => {
      const r = JW.range.get(name) || { lo: x, hi: x }; r.lo += (x - r.lo) * .002; r.hi += (x - r.hi) * .002; r.lo = Math.min(r.lo, x); r.hi = Math.max(r.hi, x); JW.range.set(name, r);
      const p = JW.last.get(name); JW.last.set(name, x);
      if (p !== undefined && Math.abs(x - p) > Math.max(.2 * (r.hi - r.lo), .05) && out.length < 5000) out.push({ t: +t.toFixed(2), name, from: +p.toFixed(3), to: +x.toFixed(3) });
    };
    for (const k in U) {
      const v = U[k].value;
      if (typeof v === 'number') visit(k, v);
      else if (v && v.isColor) { visit(k + '.r', v.r); visit(k + '.g', v.g); visit(k + '.b', v.b); }
      else if (v && (v.isVector2 || v.isVector3 || v.isVector4)) for (const c of ['x', 'y', 'z', 'w']) { if (v[c] !== undefined) visit(k + '.' + c, v[c]); }
      else if (Array.isArray(v) || ArrayBuffer.isView(v)) for (let i = 0; i < Math.min(v.length, 8); i++) { const e = v[i]; if (typeof e === 'number') visit(k + '[' + i + ']', e); }
    }
  }
  return jumpScan;
}
