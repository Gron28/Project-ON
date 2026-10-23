// being/page/cellab.mjs - the CelLab automata as part of ON's body (rules and palettes after CelLab / WebCA by Rudy Rucker
// and John Walker, https://www.fourmilab.ch/cellab/, public domain).
//
// Surface: the 'automaton' family of the living skin. It surfaces with the song's skin (MORPH.show, at moments only) and
// leads the surfacings the director gives it (the song's share); otherwise it lives faintly under the grown form. The body
// takes its height as relief (uCaA, uCaD), its pattern for the materials' shading, and its palette as a stain blended with
// the being's hue (uCaHue, uCaHueC) over whatever material is there. It joins restraint's surface kind ('cellab').
// Inside: the 3D automaton, ray-marched inside the shell at half resolution (cvRT) and seen where the inside shows (thin
// metal, holes, bead gaps, air) and as a soft glow; only at peaks (restraint M), the drop and chills (uCvA). Restraint's
// inner-light kind ('cavol'). Off in the light performance mode.
// Growth is seeded on the felt beats where the sound lands on the song map (as the Lenia skin is), plus raindrops; sleep
// freezes it. Lab: window.__cellab.

import { createCellabGPU, volumeFragment } from '../cellab/gpu.mjs';
import { createCellabDirector } from '../cellab/director.mjs';
import { RULES_2D, RULES_3D, INDEX_2D, INDEX_3D, rule2d, rule3d, CREDIT, moodScores } from '../cellab/rules.mjs';
import { PALETTES, paletteRGBA, isGradient, gradientRGBA, GRADIENTS } from '../cellab/palettes.mjs';

export const CELLAB_N = 96, CELLAB_G = 48;   // 96 cells a face: on a body ~150-400 px across, a CelLab front is a few pixels wide, so its forms read
const KEY = 'on-cellab';

export function createCellab(ctx) {
  const { THREE, renderer, U, SEED, keyHash, MW, MH, gpuTime, c01, sm } = ctx;
  const gl = renderer.getContext();
  const gpu = createCellabGPU(gl, { N: CELLAB_N, G: CELLAB_G });
  const surf = gpu.surface(); renderer.resetState();
  const D = createCellabDirector({ seed: SEED });
  const caTex = new THREE.ExternalTexture(surf.texture);
  U.uCa.value = caTex; U.uCaN.value = CELLAB_N;
  const CA = {
    on: { surface: true, inside: true }, palette: 'auto', key: null, sec: -1, beat: null, shown: false, lead: 0, leadT: 0,
    wantS: 0, wantV: 0, v: 0, acc2: 0, acc3: 0, seeds2: [], seeds3: [], v2: -1, v3: -1, pal2: null, pal3: null, fade2: 0, fade3: 0,
    showS: 0, showV: 0, drop: 0, vol: null, volMat: null, volScene: null, volIdle: 1e9, perfOK: true, steps2: 0, steps3: 0, keep: 0.35,
  };
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s) { CA.on.surface = s.surface !== false; CA.on.inside = s.inside !== false; if (typeof s.palette === 'string') CA.palette = s.palette; D.force('surface', s.rule); D.force('inside', s.rule3d); } } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ surface: CA.on.surface, inside: CA.on.inside, palette: CA.palette, rule: D.st.force, rule3d: D.st.force3d })); } catch {} };
  const palName = (meta) => (CA.palette === 'auto' || !(CA.palette in PALETTES || isGradient(CA.palette)) ? meta.palette : CA.palette);
  const palOf = (name) => (isGradient(name) ? [gradientRGBA(name), 1] : [paletteRGBA(name), 0]);
  const hueC = new THREE.Color(), tmpC = new THREE.Color();

  // the inside: its sim and the half-resolution pass, made the first time it is wanted
  function ensureVolume() {
    if (CA.vol) return CA.vol;
    CA.vol = gpu.volume(); renderer.resetState();
    const VU = { uVol: { value: new THREE.ExternalTexture(CA.vol.texture) }, uRes: U.uRes, uShift: U.uShift, uScale: U.uScale, uLook: U.uLook, uZoom: U.uZoom, uWide: U.uWide,
      uShellR: U.uShellR, uCoreR: U.uCoreR, uTime: U.uTime, uDensity: { value: 14 }, uGlowV: { value: 1.6 }, uSteps: { value: 40 }, uHueC: U.uCaHueC, uHue: U.uCaHue };
    CA.volMat = new THREE.ShaderMaterial({ uniforms: VU, depthTest: false, depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }', fragmentShader: volumeFragment(CELLAB_G) });
    CA.volScene = new THREE.Scene(); CA.volScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), CA.volMat));
    CA.volCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    CA.cvRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    U.uCv.value = CA.cvRT.texture;
    return CA.vol;
  }
  const bmuDir = () => {
    const b = ctx.MEM.song ? ctx.MEM.song.bmu : -1; if (!(b >= 0)) return null;
    const u = ((b % MW) + 0.5) / MW, v = (((b / MW) | 0) + 0.5) / MH, a = (u - 0.5) * 2 * Math.PI, l = (v - 0.5) * Math.PI;   // the Lenia skin's own mapping (skinUV)
    return [Math.cos(a) * Math.cos(l), Math.sin(l), Math.sin(a) * Math.cos(l)];
  };
  const push = (list, seeds) => { list.push(...seeds); if (list.length > 8) list.splice(0, list.length - 8); };

  /** per frame, before restraint: what it wants to show, how fast it runs, its seeds */
  function frame(dt) {
    const { mind, MEM, MORPH, SKIN, SLEEP, REST, S, SHOW, an, QUAL, B } = ctx;
    const char = an.state.character || null, arousal = mind.arousal;
    // the song: its remembered automaton, or one chosen now and remembered once it knows the song a little
    if (MEM.meta && MEM.key !== CA.key) { CA.key = MEM.key; D.song(MEM.meta.cellab, keyHash(MEM.key), char); CA.sec = -1; }
    if (MEM.meta && MEM.song && !MEM.meta.cellab && MEM.song.experience > 20) MEM.meta.cellab = D.remember();
    D.feel(dt, arousal, char, U.uCaA.value > 0.05 || CA.v > 0.05);
    const sec = an.state.structure ? an.state.structure.section | 0 : 0;
    if (CA.sec >= 0 && sec !== CA.sec) D.section();
    CA.sec = sec;
    // each surfacing of the song's skin belongs to the automaton or to the grown form
    if (!CA.shown && MORPH.show > 0.08) { CA.shown = true; D.surfacing(); }
    else if (CA.shown && MORPH.show < 0.03) CA.shown = false;
    CA.showS = Math.max(0, CA.showS - dt); CA.showV = Math.max(0, CA.showV - dt);
    const leadT = CA.showS > 0 ? 1 : D.st.lead ? 1 : 0;
    CA.lead += (leadT - CA.lead) * (CA.pin ? 1 : 1 - Math.exp(-dt / 0.8));   // CA.pin (lab, slow renderers): no easing
    const awake = 1 - SLEEP.z;
    CA.wantS = CA.on.surface ? Math.max(MORPH.show * (0.18 + 0.82 * CA.lead), CA.showS > 0 ? 1 : 0) * awake : 0;
    U.uCaA.value += (CA.wantS - U.uCaA.value) * (CA.pin ? 1 : 1 - Math.exp(-dt / (CA.wantS > U.uCaA.value ? 0.6 : 1.2)));
    if (U.uCaA.value < 1e-3 && CA.wantS === 0) U.uCaA.value = 0;
    U.uCaD.value = rule2d(D.surfaceRule).relief * 0.8;
    // its colour: the rule's palette, leaning to the being's own hue (its light) and a little to its metal
    hueC.copy(U.uLight.value); const mx = Math.max(hueC.r, hueC.g, hueC.b, 1e-3); hueC.multiplyScalar(1 / mx).lerp(tmpC.copy(U.uMetal.value), 0.25);
    U.uCaHueC.value.copy(hueC);
    // the inside: at peaks only (restraint's M), the drop and chills; not in the light performance mode
    CA.perfOK = !(QUAL.auto === false && QUAL.res < 0.9) && QUAL.k >= 0.7;
    if (S.drop > 0.9 && CA.drop <= 0.9) { push(CA.seeds2, D.burstSeeds('surface', 1)); push(CA.seeds3, D.burstSeeds('inside', 1)); }   // the drop rains seeds
    CA.drop = S.drop;
    const peak = Math.max(c01((REST.M - 0.3) / 0.5), sm(0.85, 1, S.drop), 0.8 * sm(0.6, 1, B.chill), CA.showV > 0 ? 1 : 0);
    CA.wantV = CA.on.inside && CA.perfOK ? peak * awake : 0;
    CA.v += (CA.wantV - CA.v) * (CA.pin ? 1 : 1 - Math.exp(-dt / (CA.wantV > CA.v ? 0.6 : 2.5)));
    if (CA.v < 1e-3 && CA.wantV === 0) CA.v = 0;
    U.uCvA.value = CA.v;
    if (CA.v > 0.001) U.uThick.value *= 1 - 0.4 * CA.v;   // lit from inside, the metal thins into windows (the wobble opens them where it is thinnest)
    // pace and seeds: growth follows the felt beat (seeded where the sound lands), frozen in sleep
    const ff = CA.pin ? 4 : 1;   // lab (CA.pin): slow renderers fast-forward the automata
    if (CA.on.surface) CA.acc2 = Math.min(4 * ff, CA.acc2 + D.rate('surface', arousal, SLEEP.z) * dt * ff);
    const volLive = CA.v > 0.002 || CA.wantV > 0;
    if (volLive) CA.acc3 = Math.min(3 * ff, CA.acc3 + D.rate('inside', arousal, SLEEP.z) * dt * ff);
    if (SHOW.count !== CA.beat) {
      const fresh = CA.beat !== null; CA.beat = SHOW.count;
      if (fresh && mind.lock > 0.3 && S.awake > 0.3 && awake > 0.5) {
        if (CA.on.surface) push(CA.seeds2, D.beatSeeds('surface', arousal, bmuDir()));
        if (volLive) push(CA.seeds3, D.beatSeeds('inside', arousal));
      }
    }
  }

  function applySurface() {
    const meta = rule2d(D.surfaceRule), pn = palName(meta);
    const fresh = CA.v2 !== D.st.v2;
    if (fresh || CA.pal2 !== pn) { const [rgba, mode] = palOf(pn); surf.setPalette(rgba, mode); CA.pal2 = pn; }
    if (fresh) { CA.v2 = D.st.v2; surf.step({ rule: INDEX_2D[meta.id], init: true, dens: meta.dens }); CA.fade2 = 1; CA.pre2 = 120; }   // a fresh soup is pre-rolled (8 steps a frame) so it surfaces already grown
    return meta;
  }
  function applyInside() {
    const meta = rule3d(D.insideRule), pn = palName(meta), vol = CA.vol;
    const fresh = CA.v3 !== D.st.v3 || CA.volIdle > 6;
    if (fresh || CA.pal3 !== pn) { const [rgba, mode] = palOf(pn); vol.setPalette(rgba, mode); CA.pal3 = pn; }
    if (fresh) { CA.v3 = D.st.v3; vol.setParams(meta.params); vol.step({ rule: INDEX_3D[meta.id], init: true, dens: meta.dens }); CA.fade3 = 1; CA.pre3 = 30; }
    CA.volIdle = 0;
    return meta;
  }

  /** right before the body is drawn (after restraint): the GPU steps, looks and the inside's pass */
  function render(dt) {
    const surfOn = CA.on.surface && (U.uCaA.value > 0.002 || CA.acc2 >= 1 || CA.pre2 > 0);
    const volOn = CA.on.inside && CA.perfOK && U.uCvA.value > 0.002;
    if (!volOn) CA.volIdle += dt;
    if ((!surfOn && !volOn) || gl.isContextLost()) return;
    const keepF = (base) => Math.pow(base, dt * 60);
    if (surfOn) gpuTime('cellab', () => {
      gpu.begin();
      const meta = applySurface(), rule = INDEX_2D[meta.id];
      const pre = Math.min(8, CA.pre2 || 0); CA.pre2 = (CA.pre2 || 0) - pre;
      let n = Math.min(CA.pin ? 16 : 4, Math.floor(CA.acc2)); CA.acc2 -= n; n += pre;
      for (let i = 0; i < n; i++) { surf.step({ rule, seeds: i === 0 ? CA.seeds2 : [], dens: 0.8 }); if (i === 0) CA.seeds2 = []; CA.steps2++; }
      if (U.uCaA.value > 0.002) {
        CA.fade2 = Math.max(0, CA.fade2 - dt / 1.2);
        const gas = rule >= 8, keep = Math.max(keepF(CA.keep), gas ? keepF(0.6) : 0, 0.97 * CA.fade2);
        surf.look({ rule, keep, blur: gas ? 1 : 0.7 });
        caTex.sourceTexture = surf.texture;
      }
      gpu.end(); renderer.resetState();
    });
    if (volOn && !CA.volFail) gpuTime('cellab-in', () => {
      let vol;
      try { vol = ensureVolume(); } catch (e) { CA.volFail = true; CA.vol = null; renderer.resetState(); console.error('cellab inside:', e && e.message); return; }   // the inside stays dark; ON goes on
      gpu.begin();
      const meta = applyInside(), rule = INDEX_3D[meta.id];
      const pre = Math.min(4, CA.pre3 || 0); CA.pre3 = (CA.pre3 || 0) - pre;
      let n = Math.min(CA.pin ? 12 : 3, Math.floor(CA.acc3)); CA.acc3 -= n; n += pre;
      for (let i = 0; i < n; i++) { vol.step({ rule, seeds: i === 0 ? CA.seeds3 : [], dens: 0.8 }); if (i === 0) CA.seeds3 = []; CA.steps3++; }
      CA.fade3 = Math.max(0, CA.fade3 - dt / 1.2);
      vol.look({ rule, keep: Math.max(keepF(CA.keep), 0.97 * CA.fade3) });
      gpu.end(); renderer.resetState();
      CA.volMat.uniforms.uVol.value.sourceTexture = vol.texture;
      const w = Math.max(1, U.uRes.value.x >> 1), h = Math.max(1, U.uRes.value.y >> 1);
      if (CA.cvRT.width !== w || CA.cvRT.height !== h) CA.cvRT.setSize(w, h);
      renderer.setRenderTarget(CA.cvRT); renderer.render(CA.volScene, CA.volCam); renderer.setRenderTarget(null);
    });
  }

  /** dash-app / dev-cmd { k: 'cellab', surface, inside, rule, rule3d, palette, show } */
  function command(c) {
    if (typeof c.surface === 'boolean') CA.on.surface = c.surface;
    if (typeof c.inside === 'boolean') CA.on.inside = c.inside;
    if ('rule' in c) D.force('surface', c.rule === 'auto' ? null : c.rule);
    if ('rule3d' in c) D.force('inside', c.rule3d === 'auto' ? null : c.rule3d);
    if (typeof c.palette === 'string') CA.palette = c.palette === 'auto' || c.palette in PALETTES || isGradient(c.palette) ? c.palette : 'auto';
    if (c.show === 'surface') { CA.showS = Number.isFinite(c.secs) ? c.secs : 10; ctx.skinFlush(1, 'a living pattern'); }
    if (c.show === 'inside') CA.showV = Number.isFinite(c.secs) ? c.secs : 10;
    if (c.seed) { push(CA.seeds2, D.burstSeeds('surface', 1)); push(CA.seeds3, D.burstSeeds('inside', 1)); }
    save();
  }
  const num = (x, d = 3) => (Number.isFinite(x) ? +x.toFixed(d) : 0);
  function snap() {
    const r2 = rule2d(D.surfaceRule), r3 = rule3d(D.insideRule);
    return {
      on: { ...CA.on }, palette: CA.palette, mood: D.st.mood, moods: Object.fromEntries(Object.entries(moodScores(ctx.mind.arousal, ctx.an.state.character)).map(([k, v]) => [k, num(v)])),
      surface: { rule: r2.id, name: r2.name, tag: r2.tag, forced: !!D.st.force, a: num(U.uCaA.value), lead: num(CA.lead), share: num(D.st.share), steps: num(D.rate('surface', ctx.mind.arousal, ctx.SLEEP.z), 1), palette: CA.pal2 || r2.palette },
      inside: { rule: r3.id, name: r3.name, forced: !!D.st.force3d, a: num(U.uCvA.value), want: num(CA.wantV), gated: !CA.perfOK, steps: num(D.rate('inside', ctx.mind.arousal, ctx.SLEEP.z), 1), palette: CA.pal3 || r3.palette },
      known: D.st.known, section: D.st.section, rules: RULES_2D.map((r) => [r.id, r.name]), rules3d: RULES_3D.map((r) => [r.id, r.name]), palettes: [...GRADIENTS, ...Object.keys(PALETTES)], credit: CREDIT,
    };
  }
  window.__cellab = {
    CA, D, snap, set: (o) => { command(o || {}); return snap(); }, show: (which = 'surface', secs = 10) => command({ show: which, secs }),
    pin: (v = true) => { CA.pin = !!v; return CA.pin; },
    probeInside: () => {   // lab: the inside pass's brightest light and opacity (half-float readback)
      if (!CA.cvRT) return null; const w = CA.cvRT.width, h = CA.cvRT.height, px = new Uint16Array(w * h * 4);
      renderer.readRenderTargetPixels(CA.cvRT, 0, 0, w, h, px); let L = 0, A = 0; const f = THREE.DataUtils.fromHalfFloat;
      for (let i = 0; i < px.length; i += 4) { L = Math.max(L, f(px[i]) + f(px[i + 1]) + f(px[i + 2])); A = Math.max(A, f(px[i + 3])); }
      return { L: +L.toFixed(3), A: +A.toFixed(3), w, h };
    },
    stats: () => ({ steps2: CA.steps2, steps3: CA.steps3, a: num(U.uCaA.value), v: num(U.uCvA.value), lead: num(CA.lead) }),
    readState: () => { const s = surf.readState(); renderer.resetState(); return s; },
  };
  return { CA, D, frame, render, command, snap, get lead() { return CA.lead; } };
}
