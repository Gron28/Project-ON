import io
p = 'being/index.html'
s = io.open(p, encoding='utf8').read()
io.open('scratch/index.before-9.html', 'w', encoding='utf8').write(s)
def rep(a, b, n=1):
    global s
    assert a in s, ('missing', a[:110])
    s = s.replace(a, b, n)

rep("import { createMorph } from './morph-gl.mjs';", """import { createMorph } from './morph-gl.mjs';
import { createPressure } from './pressure.mjs';
import { organismFor, validOrganism } from './organism.mjs';
import { createSwarm } from './swarm-gpu.mjs';""")

# ---- the blob can hide while it is a swarm -------------------------------------------------------------------------------
rep("uMorph: { value: null }, uMorphA: { value: 0 }, uMorphD: { value: .03 },", "uMorph: { value: null }, uMorphA: { value: 0 }, uMorphD: { value: .03 }, uHide: { value: 0 },")
rep("uniform samplerCube uMorph; uniform float uMorphA; uniform float uMorphD;", "uniform samplerCube uMorph; uniform float uMorphA; uniform float uMorphD; uniform float uHide;")
rep("    gl_FragColor = vec4( min( col, vec3( alpha ) ), alpha );", "    col *= 1. - uHide; alpha *= 1. - uHide;   // burst into a swarm: the body is gone\n    gl_FragColor = vec4( min( col, vec3( alpha ) ), alpha );")
rep("      case 'drop':\n", "      case 'drop':\n        B.dropNow = true;\n")

# ---- pressure organ + swarm ---------------------------------------------------------------------------------------------------
rep("function beingBody(dt, t) {", """/* ---------- bursting: the pressure organ (pressure.mjs) and the swarm (organism.mjs, swarm-gpu.mjs) ----------
   The organ reads the broadcast state (arousal, anticipation, groove, fatigue) and decides by itself: small jets near
   its limit, a burst into a particle organism at the limit (or at a drop while pressured), gathering back after. */
const pressure = createPressure();
try { pressure.restore(JSON.parse(localStorage.getItem('being-pressure-' + SEED) || 'null')); } catch {}
setInterval(() => { try { localStorage.setItem('being-pressure-' + SEED, JSON.stringify(pressure.serialize())); } catch {} }, 20000);
const swCanvas = document.createElement('canvas');
Object.assign(swCanvas.style, { position: 'fixed', left: '0', top: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '1', cursor: 'default' });
cv.after(swCanvas);
let swarm = null;
createSwarm(swCanvas).then(sw => { swarm = sw; if (!sw) console.warn('being: no WebGPU, it cannot burst into a swarm'); }).catch(e => console.warn('swarm:', e.message));
const SW = { hide: 0, org: null, cam: { ro: [0, 0, 0], uu: [0, 0, 0], vv: [0, 0, 0], ww: [0, 0, 0], res: [1, 1], scale: 1, wide: 0, shift: [0, 0], light: [1, 1, 1], glow: .5, crisp: 0, env: 1, coreR: .2 } };
function songOrganism() {
  if (MEM.meta && validOrganism(MEM.meta.organism)) return MEM.meta.organism;
  const o = organismFor(charOf(MEM.meta && MEM.meta.char), MEM.key ? keyHash(MEM.key) : SEED, SEED, mind.traits.hue);
  if (MEM.meta) MEM.meta.organism = o;
  return o;
}
function randomDir() { const z = Math.random() * 2 - 1, a = Math.random() * 6.2832, r = Math.sqrt(1 - z * z); return [r * Math.cos(a), z, r * Math.sin(a)]; }
function burstNow(why) {
  SW.org = songOrganism();
  if (swarm) swarm.burst(SW.org, { r0: U.uShellR.value + .06, seed: (Date.now() & 0xffff) + 1 });
  skinFlush(1, why || 'it bursts'); B.chill = Math.max(B.chill, .6);
  blog.unshift('it bursts into a swarm'); say('it bursts into a swarm');
}
function pressureTick(dt) {
  const evs = pressure.step(dt, { arousal: mind.arousal, aHome: mind.traits.aHome, anticipation: mind.daAnticipation, groove: mind.groove, energy: mind.energy, drop: !!B.dropNow, loud: S.awake });
  B.dropNow = false;
  for (const e of evs) {
    if (e.type === 'jet') { if (swarm && !swarm.active) swarm.jets(songOrganism(), { n: Math.round(250 + 550 * e.amount), r0: U.uShellR.value + .03, dir: randomDir(), seed: (Date.now() & 0xffff) + 3 }); blog.unshift('sheds a jet'); for (let k = 0; k < 4; k++) spawnDrop(.04); }
    else if (e.type === 'burst') burstNow('it bursts');
    else if (e.type === 'gather') { if (swarm) swarm.gather(); blog.unshift('it gathers itself'); }
  }
  // the body fades out as the swarm appears, and back in once the swarm has gathered at the centre
  const wantHide = swarm && swarm.active && swarm.mode === 'organism' && !(swarm.state.gatherTo && swarm.state.gather >= 1) ? 1 : 0;
  SW.hide += (wantHide - SW.hide) * (1 - Math.exp(-dt / (wantHide ? .12 : .35)));
  U.uHide.value = SW.hide < .002 ? 0 : SW.hide;
}
function swarmFrame(dt) {
  if (!swarm) return;
  const c = SW.cam, z = 4.2 * U.uZoom.value, ly = U.uLook.value.y * .35, lx = U.uLook.value.x * .55;
  // the body shader's camera: ro.yz *= rot(ly); ro.xz *= rot(lx)  (GLSL v * mat2(c,-s,s,c))
  let x = 0, y = 0, zz = z; { const cs = Math.cos(ly), sn = Math.sin(ly); const ny = y * cs - zz * sn, nz = y * sn + zz * cs; y = ny; zz = nz; }
  { const cs = Math.cos(lx), sn = Math.sin(lx); const nx = x * cs - zz * sn, nz = x * sn + zz * cs; x = nx; zz = nz; }
  c.ro[0] = x; c.ro[1] = y; c.ro[2] = zz;
  const wl = Math.hypot(x, y, zz); c.ww[0] = -x / wl; c.ww[1] = -y / wl; c.ww[2] = -zz / wl;
  let ux = -c.ww[2], uz = c.ww[0]; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;   // cross(ww, up)
  c.uu[0] = ux; c.uu[1] = 0; c.uu[2] = uz;
  c.vv[0] = c.uu[1] * c.ww[2] - c.uu[2] * c.ww[1]; c.vv[1] = c.uu[2] * c.ww[0] - c.uu[0] * c.ww[2]; c.vv[2] = c.uu[0] * c.ww[1] - c.uu[1] * c.ww[0];
  c.res[0] = U.uRes.value.x; c.res[1] = U.uRes.value.y; c.scale = U.uScale.value; c.wide = U.uWide.value; c.shift[0] = U.uShift.value.x; c.shift[1] = U.uShift.value.y;
  c.light[0] = U.uLight.value.r; c.light[1] = U.uLight.value.g; c.light[2] = U.uLight.value.b; c.glow = U.uGlow.value; c.crisp = U.uCrisp.value; c.env = U.uEnv.value; c.coreR = U.uCoreR.value;
  const pulse = Math.pow(Math.max(0, 1 - SHOW.phase), 4) * mind.lock * .5 + V.kick * .35;
  swarm.frame(dt, c, { pulse, speed: .8 + .9 * mind.arousal });
}
window.__burst = () => { if (!pressure.burst()) return false; burstNow('lab'); return true; };   // lab hooks
window.__gather = () => { pressure.gather(); if (swarm) swarm.gather(); return true; };
window.__jet = (a = 1) => { if (swarm) swarm.jets(songOrganism(), { n: Math.round(250 + 550 * a), r0: U.uShellR.value + .03, dir: randomDir(), seed: 9 }); return !!swarm; };
window.__swarmInfo = () => ({ ready: !!swarm, active: swarm ? swarm.active : false, mode: swarm ? swarm.mode : null, gather: swarm ? +swarm.state.gather.toFixed(2) : 0, hide: +SW.hide.toFixed(2), pressure: +pressure.pressure.toFixed(2), charge: +pressure.charge.toFixed(2), tension: +pressure.tension.toFixed(2), state: pressure.state, species: SW.org ? SW.org.species.map(s => s.role).join(',') : null });
function beingBody(dt, t) {""")
rep("    morphTick(dt, t);", "    morphTick(dt, t);\n    pressureTick(dt);")
rep("  if (S.awake > .05 || ++skip % 3 === 0) gpuTime('body', renderBeing);", "  if (S.awake > .05 || ++skip % 3 === 0) gpuTime('body', renderBeing);\n  swarmFrame(dt);")
# a new song: the swarm gathers (it is the previous song's organism)
rep("  MORPH.song = null; MORPH.evolved = null; MORPH.floor = 0; MORPH.sec = 0; MORPH.cellN = 0;", "  MORPH.song = null; MORPH.evolved = null; MORPH.floor = 0; MORPH.sec = 0; MORPH.cellN = 0;\n  if (pressure.gather() && swarm) swarm.gather();")
# the panel shows the pressure
rep(" · timing ±${timing.errorMs.toFixed(0)} ms", " · pressure ${Math.round(100 * pressure.pressure)}%${pressure.state === 'swarm' ? ' (swarm)' : ''} · timing ±${timing.errorMs.toFixed(0)} ms")
io.open(p, 'w', encoding='utf8').write(s)
print('patched', len(s))
