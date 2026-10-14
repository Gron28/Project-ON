import io
p = 'being/index.html'
s = io.open(p, encoding='utf8').read()
io.open('scratch/index.before-10.html', 'w', encoding='utf8').write(s)
def rep(a, b, n=1):
    global s
    assert a in s, ('missing', a[:110])
    s = s.replace(a, b, n)

# ---- imports: beads in, swarm out ------------------------------------------------------------------------------------------
rep("""import { organismFor, validOrganism } from './organism.mjs';
import { createSwarm } from './swarm-gpu.mjs';""", "import { createBeads } from './beads.mjs';")

# ---- the scene render target needs depth (beads are sorted by depth) -------------------------------------------------------
rep("const sceneRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });", "const sceneRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true });")

# ---- the body: when it is all beads, the shell is not marched (the core still shines through the gaps) --------------------
rep("    col *= 1. - uHide; alpha *= 1. - uHide;   // burst into a swarm: the body is gone\n", "")
rep("    if ( hb > 0. ) {\n      t = max( - bb - sqrt( hb ), 0. );", "    if ( hb > 0. && uHide < .5 ) {   // beads: the liquid shell is gone, the core still shines\n      t = max( - bb - sqrt( hb ), 0. );")
rep("    if ( hit ) {\n      vec3 p = ro + rd * t, n = normalAt( p ), v = - rd;", "    if ( hit ) {\n      vec3 p = ro + rd * t, n = normalAt( p ), v = - rd;\n      float hideK = 1. - smoothstep( 0., .5, uHide );")
rep("      alpha = 1.;\n    } else if ( tCore < 1e8 ) {", "      alpha = 1.; col *= hideK; alpha *= hideK;\n    } else if ( tCore < 1e8 ) {")

# ---- replace the swarm block with beads -------------------------------------------------------------------------------------
start = s.index("const swCanvas = document.createElement('canvas');")
end = s.index("function beingBody(dt, t) {", start)
s = s[:start] + """const beads = createBeads(THREE, renderer, { bodyFragment: scene.children[0].material.fragmentShader, U });
scene.add(beads.mesh);
// the bead material: the same shape made of shining balls (beads.mjs); the pressure organ turns it on and off
const BEAD = { on: false, a: 0, flow: 0, t: 0 };
function randomDir() { const z = Math.random() * 2 - 1, a = Math.random() * 6.2832, r = Math.sqrt(1 - z * z); return new THREE.Vector3(r * Math.cos(a), z, r * Math.sin(a)); }
function beadsOn(why) {
  if (BEAD.on) return;
  BEAD.on = true; beads.reset();
  beads.uniforms.uBOrigin.value.copy(randomDir()); beads.uniforms.uBAxis.value.fromArray(MORPH.cur.axis);
  blog.unshift('it turns to beads'); say(why === 'you asked' ? 'it turns to beads' : 'under pressure, it turns to beads');
}
function beadsOff() { if (!BEAD.on) return; BEAD.on = false; blog.unshift('it melts back'); }
function pressureTick(dt) {
  const evs = pressure.step(dt, { arousal: mind.arousal, aHome: mind.traits.aHome, anticipation: mind.daAnticipation, groove: mind.groove, energy: mind.energy, drop: !!B.dropNow, loud: S.awake });
  B.dropNow = false;
  for (const e of evs) { if (e.type === 'burst') beadsOn('pressure'); else if (e.type === 'gather') beadsOff(); }
  // subdividing takes ~1.8 s (a wave across the body), melting ~1.3 s
  BEAD.a = BEAD.on ? Math.min(1, BEAD.a + dt / 1.8) : Math.max(0, BEAD.a - dt / 1.3);
  U.uHide.value = c01((BEAD.a - .06) / .2);   // the liquid fades while the beads are still big and touching
  beads.mesh.visible = BEAD.a > .001;
  beads.uniforms.uBA.value = BEAD.a;
}
function beadsFrame(dt) {
  if (!beads.mesh.visible) return;
  BEAD.flow += dt * (.05 + .25 * mind.arousal); BEAD.t += dt;
  const B2u = beads.uniforms; B2u.uBFlow.value = BEAD.flow; B2u.uBTime.value = BEAD.t; B2u.uBKick.value = V.kick * .8;
  beads.place(dt);
}
window.__beads = () => { if (BEAD.on) { pressure.gather(); beadsOff(); } else { pressure.burst(); beadsOn('you asked'); } return BEAD.on; };   // lab hook
pet.onBurst(() => window.__beads());   // menu: turn to beads, or melt back
window.__beadInfo = () => ({ on: BEAD.on, a: +BEAD.a.toFixed(2), hide: +U.uHide.value.toFixed(2), pressure: +pressure.pressure.toFixed(2), state: pressure.state });

/* ---------- restraint: one style at a time ----------
   Every expressive layer still computes what it wants, but within each kind only one leads at a time (mutual inhibition
   with hysteresis): one surface (the song's grown skin, the living Lenia skin, spikes, turbulence, grain, facets or
   ripples), one kind of appendage (note lobes, tendrils, satellites, drops), one inner light (nucleus or tissue). The
   others are held down to the maximalism level M, which is low most of the time and opens only at peaks: a drop, chills,
   a climax of arousal and groove. Ornaments (rings, sparks, rays, halo, film) live only at M. The values the layers
   computed are restored each frame before they update, so restraint never feeds back into their own dynamics. */
const REST = { M: .15, win: { surf: 'morph', app: 'lobes', inner: 'nuc' }, cand: {}, candT: {}, g: {}, saved: new Map(), sal: {} };
const LAYERS = {
  surf: { morph: ['uMorphA', 1.0, .35], skin: ['uSkinA', .8, 0], spikes: ['uSpikes', .08, 0], chaos: ['uChaos', 1, 0], grain: ['uGrain', .8, 0], frac: ['uFrac', .8, 0], intr: ['uIntr', .8, 0] },
  app: { lobes: ['uL', .35, .15], tendrils: ['uT', .12, 0], sats: ['uS', .25, 0], drops: ['uD', .15, 0] },
  inner: { nuc: ['uNuc', .7, .1], tissue: ['uTissueA', .6, 0] },
};
const ORNAMENTS = ['uRingA', 'uRing2A', 'uSparks', 'uRays', 'uHalo', 'uFilm'];
function restRestore() {   // give every layer back the value it computed itself
  for (const [k, v] of REST.saved) { const u = U[k].value; if (Array.isArray(u)) u.forEach((x, i) => { x.w = v[i]; }); else U[k].value = v; }
  REST.saved.clear();
}
function salienceOf(key, ref) {
  const u = U[key].value;
  if (!Array.isArray(u)) return Math.max(0, u) / ref;
  let sum = 0; for (let i = key === 'uT' ? 1 : 0; i < u.length; i += key === 'uT' ? 3 : 1) sum += Math.max(0, u[i].w); return sum / ref;
}
function restApply(dt) {
  // M: the room for more than one style; a peak opens it fast, it closes slowly
  const climax = c01((mind.arousal - .8) / .15) * c01(mind.groove * 1.6);
  const peak = Math.max(S.drop, B.chill * .9, climax);
  const want = BEAD.a > .01 ? .05 : .15 + .85 * peak;
  REST.M += (want - REST.M) * (1 - Math.exp(-dt / (want > REST.M ? .25 : 3)));
  for (const [group, layers] of Object.entries(LAYERS)) {
    let best = null, bestS = -1;
    for (const [name, [key, ref, bias]] of Object.entries(layers)) { const v = salienceOf(key, ref) + bias; REST.sal[name] = v; if (v > bestS) { bestS = v; best = name; } }
    const cur = REST.win[group];
    if (best !== cur && bestS > REST.sal[cur] * 1.35 + .05) {   // a challenger must clearly lead for 1.2 s
      if (REST.cand[group] !== best) { REST.cand[group] = best; REST.candT[group] = 0; }
      REST.candT[group] += dt;
      if (REST.candT[group] > 1.2) { REST.win[group] = best; REST.cand[group] = null; }
    } else REST.cand[group] = null;
    for (const [name, [key]] of Object.entries(layers)) {
      const target = name === REST.win[group] ? 1 : REST.M;
      const g = REST.g[name] = (REST.g[name] ?? 1) + (target - (REST.g[name] ?? 1)) * (1 - Math.exp(-dt / .6));
      const u = U[key].value;
      if (Array.isArray(u)) { REST.saved.set(key, u.map(x => x.w)); u.forEach(x => { x.w *= g; }); }
      else { REST.saved.set(key, u); U[key].value = u * g; }
    }
  }
  const og = Math.max(0, (REST.M - .15) / .85);
  for (const key of ORNAMENTS) { REST.saved.set(key, U[key].value); U[key].value *= og; }
}
window.__rest = () => ({ M: +REST.M.toFixed(2), win: { ...REST.win }, g: Object.fromEntries(Object.entries(REST.g).map(([k, v]) => [k, +v.toFixed(2)])) });
""" + s[end:]
# remove the swarm lab hooks and organism helpers left before the replaced block
start = s.index("const SW = {") if "const SW = {" in s else -1
assert start < 0, 'SW block should have been inside the replaced region'

# ---- frame wiring ---------------------------------------------------------------------------------------------------------------
rep("  const f0 = performance.now(); frames++;", "  const f0 = performance.now(); frames++;\n  restRestore();")
rep("  gpuPoll();\n  if (S.awake > .05 || ++skip % 3 === 0) gpuTime('body', renderBeing);\n  swarmFrame(dt);",
    "  restApply(dt);\n  beadsFrame(dt);\n  gpuPoll();\n  if (S.awake > .05 || ++skip % 3 === 0) gpuTime('body', renderBeing);")
rep("  if (pressure.gather() && swarm) swarm.gather();", "  if (pressure.gather()) beadsOff();")
rep("${pressure.state === 'swarm' ? ' (swarm)' : ''}", "${BEAD.on ? ' (beads)' : ''}")
io.open(p, 'w', encoding='utf8').write(s)
print('patched', len(s))
