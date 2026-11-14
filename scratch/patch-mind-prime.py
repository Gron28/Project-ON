import io
p='being/mind.mjs'; s=io.open(p,encoding='utf8').read()
a="  /** love / not-this from the listener"
assert a in s
s=s.replace(a,"""  /** a known song's tempo comes back before the first beat: the motor starts at the remembered pulse (folded near f0) */
  state.prime = (hz) => {
    if (!Number.isFinite(hz) || hz < 0.3 || hz > 5) return false;
    let f = hz; while (f < T.f0 / 1.42) f *= 2; while (f > T.f0 * 1.42) f /= 2;
    fM = f; return true;
  };
"""+a,1)
io.open(p,'w',encoding='utf8').write(s); print('ok')
