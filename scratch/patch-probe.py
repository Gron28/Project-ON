import io
p='being/index.html'; s=io.open(p,encoding='utf8').read()
a="const pushIn = f => { an.push(f); feedBeing(f); if (brain) brain.push(f); lastIn = performance.now(); received += f.length;"
assert a in s
s=s.replace(a, a+"\n  if (window.__latLog) window.__latLog.push(performance.now(), received);   // lab: when each sample arrived", 1)
a="renderer.setAnimationLoop(ts => {\n  const f0 = performance.now(); frames++;"
assert a in s
s=s.replace(a, a+"\n  if (window.__frameLog) window.__frameLog.push(f0, V.kick, U.uBeatPulse.value, mind.pulsePhase, received);   // lab: what was shown when (previous frame's values)", 1)
io.open(p,'w',encoding='utf8').write(s); print('ok')
