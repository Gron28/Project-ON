// lab/prototypes/nervous-system/scene.mjs - the 3D view of the nervous system: organs laid out from sound (left) to body (right),
// axons between them carrying pulses whose speed and brightness follow the activity they carry. Reads the sim, never drives it.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { NE, EAR_CF, DELTA } from '../../../being/ear.mjs';
import { TW, TH } from '../../../being/tissue.mjs';
import { REGION_DIRS, NREG } from '../../../being/kuramoto.mjs';
import { TYPES } from '../../../being/timing.mjs';

const c01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const TAU = Math.PI * 2;
const DRUM = { kick: 0xd95926, snare: 0x199e70, hat: 0xc98500 };
const add = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false };

export function createScene(host, sim, tip) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.setClearColor(0x07090c);
  host.appendChild(renderer.domElement);
  const labels = new CSS2DRenderer(); labels.domElement.className = 'labels'; host.appendChild(labels.domElement);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x07090c, 18, 34);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0.3, 0.9, 13.6);
  const controls = new OrbitControls(camera, labels.domElement);
  controls.target.set(-0.7, 0.3, 0); controls.enableDamping = true; controls.update();
  const hover = [];                                              // { obj, info(instanceId) }
  const label = (text, pos, cls = 'grp') => { const d = document.createElement('div'); d.className = cls; d.textContent = text; const o = new CSS2DObject(d); o.position.copy(pos); scene.add(o); return d; };
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

  // ---- a nucleus: a core and an additive halo -------------------------------------------------------------------------
  const SPH = new THREE.SphereGeometry(1, 24, 16), SPH_LO = new THREE.SphereGeometry(1, 12, 8);
  function nucleus(pos, color, name, info, r = 0.22) {
    const core = new THREE.Mesh(SPH, new THREE.MeshBasicMaterial({ color })), halo = new THREE.Mesh(SPH_LO, new THREE.MeshBasicMaterial({ color, opacity: 0.2, ...add }));
    core.position.copy(pos); halo.position.copy(pos); core.scale.setScalar(r); halo.scale.setScalar(r * 2);
    scene.add(core, halo); hover.push({ obj: core, info: () => name + '\n' + info() });
    const base = new THREE.Color(color), tmp = new THREE.Color();
    return {
      core, halo, pos,
      set(v, glow = v, col = null) {   // v: size 0..1, glow: halo 0..1
        const c = col || base; core.scale.setScalar(r * (0.6 + 0.9 * c01(v)));
        core.material.color.copy(tmp.copy(c).multiplyScalar(0.35 + 0.65 * c01(glow)));
        halo.scale.setScalar(r * (1.3 + 1.5 * c01(glow))); halo.material.color.copy(c); halo.material.opacity = 0.05 + 0.3 * c01(glow);
      },
    };
  }

  // ---- axons with travelling pulses ------------------------------------------------------------------------------------
  const axons = [], PPA = 5;
  function axon(a, b, lift, act, lesion, color = 0x9fd8ff) {
    const mid = a.clone().add(b).multiplyScalar(0.5).add(lift);
    const curve = new THREE.CatmullRomCurve3([a, a.clone().lerp(mid, 0.6), mid, b.clone().lerp(mid, 0.6), b]);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.014, 5), new THREE.MeshBasicMaterial({ color: 0x24303c }));
    scene.add(tube);
    axons.push({ curve, tube, act, lesion, color: new THREE.Color(color), u: Array.from({ length: PPA }, (_, i) => i / PPA), a: 0 });
  }
  const pulses = new THREE.InstancedMesh(SPH_LO, new THREE.MeshBasicMaterial({ ...add }), 256);
  pulses.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(pulses);

  // ---- sound in, analyzer ----------------------------------------------------------------------------------------------
  const P_IN = V3(-8.6, 0.3, 0), P_AN = V3(-7.2, -2.9, 0.4);
  const nIn = nucleus(P_IN, 0xe8e6e0, 'sound in', () => `level ${(sim.earFrame ? sim.earFrame.level : 0).toFixed(3)} (after the input trim)`, 0.2);
  const nAn = nucleus(P_AN, 0x8a93a6, 'analyzer (being/analysis.mjs, a page organ, not the being\'s own)', () => { const b = sim.an.state.beat; return `beat tracker ${b.bpm.toFixed(0)} bpm, confidence ${b.confidence.toFixed(2)}\nbuild-up tension ${sim.an.state.structure.tension.toFixed(2)}\nfeeds drum events to timing, beat and tension to the mind`; }, 0.2);
  label('sound in', V3(-8.6, 0.85, 0)); label('analyzer (page)', V3(-7.2, -3.55, 0.4));

  // ---- ear: 28 Hopf units on a spiral (the base, high frequencies, outside; the apex, low, inside) -----------------------
  const EAR_C = V3(-6.4, 0.6, 0);
  const earDots = new THREE.InstancedMesh(SPH, new THREE.MeshBasicMaterial(), NE), earHum = new THREE.InstancedMesh(SPH_LO, new THREE.MeshBasicMaterial({ ...add }), NE);
  const earPos = [], earHue = [];
  for (let k = 0; k < NE; k++) {
    const u = k / (NE - 1), ang = -u * 2.1 * TAU + 1.2, r = 0.3 + 1.25 * u;
    earPos.push(V3(EAR_C.x + r * Math.cos(ang), EAR_C.y + r * Math.sin(ang), EAR_C.z + (1 - u) * 0.9 - 0.45));
    earHue.push(new THREE.Color().setHSL(0.02 + 0.72 * u, 0.85, 0.55));
  }
  scene.add(earDots, earHum); label('ear: 28 Hopf units', V3(-6.4, 2.3, 0));
  hover.push({ obj: earDots, info: (i) => { const f = sim.earFrame; return `ear unit ${i}: ${EAR_CF[i].toFixed(0)} Hz\namplitude ${(f ? f.amp[i] : 0).toFixed(4)} (its own hum settles at ${DELTA})\nmu ${(f ? f.mu[i] : 0).toFixed(4)} (> 0: it hums by itself; < 0: tired)`; } });
  const nRough = nucleus(V3(-4.2, -2.5, 0.9), 0xe66767, 'roughness / alarm (ear 30-150 Hz envelope)', () => `rough ${(sim.earFrame ? sim.earFrame.rough : 0).toFixed(3)} -> mind x2.5 clamped: ${c01((sim.earFrame ? sim.earFrame.rough : 0) * 2.5).toFixed(2)}`);
  const nStartle = nucleus(V3(-2.7, -2.7, 0.9), 0xffffff, 'startle nucleus (mind.mjs)', () => `startle ${sim.mind.startle.toFixed(2)}\nhabituation ${sim.mind.habituation.toFixed(2)} (1 = fresh, falls x0.7 per startle, recovers ~30 s)\nring: how ready it is to flinch`);
  const nSub = nucleus(V3(-1.2, -2.85, 0.9), 0x3987e5, 'body ear: sub-bass (ear.mjs sub)', () => `sub ${(sim.earFrame ? sim.earFrame.sub : 0).toFixed(3)} -> physics`);
  label('brainstem', V3(-2.7, -3.55, 0.9));
  const habRing = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.02, 6, 64), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  habRing.position.copy(nStartle.pos); scene.add(habRing);

  // ---- tissue: the 128x64 sheet as a membrane wrapped round (it wraps in x); high frequencies at the top -----------------
  const TIS_C = V3(-2.5, 0.6, -0.9);
  const texData = new Uint8Array(TW * TH * 4), tisTex = new THREE.DataTexture(texData, TW, TH, THREE.RGBAFormat);
  tisTex.wrapS = THREE.RepeatWrapping; tisTex.magFilter = tisTex.minFilter = THREE.LinearFilter; tisTex.needsUpdate = true;
  const tisMat = new THREE.ShaderMaterial({
    uniforms: { uT: { value: tisTex } }, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'varying vec2 vUv; varying float vF; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.); vec3 n = normalize(normalMatrix * normal); vF = abs(n.z); gl_Position = projectionMatrix * mv; }',
    fragmentShader: `uniform sampler2D uT; varying vec2 vUv; varying float vF;
      void main(){ vec4 t = texture2D(uT, vec2(vUv.x, 1. - vUv.y)); float tr = max(0., t.r - .3) / .7;
        vec3 c = vec3(.02, .035, .05) + tr * vec3(.05, .55, .65) + t.g * vec3(.9, 1., .95) * 1.8 + t.b * vec3(.35, .2, .6) * .2;
        gl_FragColor = vec4(c * (.45 + .55 * vF), 1.); }`,
  });
  const tisMesh = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.45, 2.1, 96, 1, true, -0.6 * Math.PI, 1.2 * Math.PI), tisMat);
  tisMesh.position.copy(TIS_C); tisMesh.rotation.x = 0.3; scene.add(tisMesh);
  label('nervous tissue 128 x 64', V3(-2.5, 2.05, -0.9));
  hover.push({ obj: tisMesh, info: () => { const t = sim.tissueStats; return `tissue (Kinouchi sheet, rate homeostasis)\nactivity ${(t.act * 1000).toFixed(2)} per mille (set point ${(sim.P.tissue.target * 1000).toFixed(1)})\ncoupling sigma ${t.sigma.toFixed(3)}, branching ${t.branching.toFixed(2)} (1 = critical)\ncoherence ${(t.coherence || 0).toFixed(2)} -> mind\nbright: firing now; teal: recent trace; violet: slow memory`; } });

  // ---- motor: 8 regions x 6 oscillators, the felt pulse (heart), the resonance bank ------------------------------------
  const MOT_C = V3(2.3, 0.4, 0);
  const regPos = REGION_DIRS.map((d) => V3(MOT_C.x + d[0] * 1.55, MOT_C.y + d[1] * 1.3, MOT_C.z + d[2] * 1.55));
  const regRings = new THREE.InstancedMesh(new THREE.TorusGeometry(0.3, 0.018, 6, 40), new THREE.MeshBasicMaterial(), NREG);
  const oscDots = new THREE.InstancedMesh(SPH_LO, new THREE.MeshBasicMaterial(), NREG * 6);
  scene.add(regRings, oscDots);
  hover.push({ obj: regRings, info: (g) => { const R = sim.mind.regions; return `body region ${g} (cube corner ${REGION_DIRS[g].map((v) => (v > 0 ? '+' : '-')).join('')})\ncoherence ${R.coh[g].toFixed(2)}\nphase vs the pulse ${(R.phase[g] * 360).toFixed(0)} deg\nholds the cross pulse ${R.cross[g].toFixed(2)}\ndots: 6 oscillators drawn from the region's mean phase and coherence\n(Lorentzian quantiles; mind.mjs keeps the single phases internal)`; } });
  const heart = nucleus(MOT_C, 0xe34948, 'felt pulse (mind motor oscillator)', () => { const m = sim.mind; return `${(m.pulseHz * 60).toFixed(1)} bpm (own tempo ${(m.traits.f0 * 60).toFixed(0)})\nlock ${m.lock.toFixed(2)}, order ${m.order.toFixed(2)}, cross pulse ${m.crossPulse.toFixed(2)}\ngroove ${m.groove.toFixed(2)}, syncopation ${m.sync.toFixed(2)} (likes ${m.traits.sStar.toFixed(2)})`; }, 0.3);
  const lockHalo = new THREE.Mesh(SPH_LO, new THREE.MeshBasicMaterial({ color: 0xe34948, opacity: 0, ...add })); lockHalo.position.copy(MOT_C); lockHalo.scale.setScalar(2.4); scene.add(lockHalo);
  const NRB = 49, bank = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), NRB); scene.add(bank);
  hover.push({ obj: bank, info: (i) => `resonance bank: ${(sim.mind.resonanceHz[i] * 60).toFixed(0)} bpm (${sim.mind.resonanceHz[i].toFixed(2)} Hz)\namplitude ${sim.mind.resonance[i].toFixed(3)}\ncritical Hopf oscillators driven by onsets; the strongest forces the motor population` });
  label('motor population + felt pulse', V3(2.3, 2.45, 0)); label('resonance bank 30-480 bpm', V3(2.3, -1.55, 1.2), 'sub');

  // ---- timing: a circular sequencer, 16 slots x kick / snare / hat ---------------------------------------------------
  const SEQ_C = V3(2.3, -3.25, 0.6), seqR = [0.7, 0.95, 1.2];
  const slots = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 48);
  const heard = new THREE.InstancedMesh(SPH_LO, new THREE.MeshBasicMaterial({ ...add }), 48);
  const predM = new THREE.InstancedMesh(new THREE.TorusGeometry(1, 0.15, 4, 16), new THREE.MeshBasicMaterial({ ...add }), 48);
  scene.add(slots, heard, predM);
  const slotAt = (ty, s, r = seqR[ty]) => { const a = Math.PI / 2 - (s / 16) * TAU; return V3(SEQ_C.x + r * Math.cos(a), SEQ_C.y + r * Math.sin(a) * 0.8, SEQ_C.z + r * Math.sin(a) * 0.4); };
  const needle = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.25, 0.02), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  scene.add(needle); label('timing grid (16 slots)', V3(2.3, -4.55, 0.6));
  hover.push({ obj: slots, info: (i) => { const ty = TYPES[(i / 16) | 0], s = i % 16, t = sim.timing; return `${ty}, slot ${s}: p(hit) ${t.grid[ty][s].toFixed(2)}\nring: predicted now; dot: heard (green expected, pink surprise)\ntiming error ${t.errorMs.toFixed(0)} ms, predicts ${(100 * t.predicted).toFixed(0)}% of hits, readiness ${t.readiness.toFixed(2)}`; } });

  // ---- mind: nuclei of feeling, on an arc above -------------------------------------------------------------------------
  const MIND = [
    ['arousal', 0xd95926, (m) => [m.arousal], (m) => `arousal ${m.arousal.toFixed(2)} (home ${m.traits.aHome.toFixed(2)})`],
    ['valence', 0x3987e5, (m) => [Math.abs(m.valence), m.valence], (m) => `valence ${m.valence.toFixed(2)} (home ${m.traits.vHome.toFixed(2)})\nblue negative, amber positive`],
    ['mood', 0x9085e9, (m) => [Math.abs(m.mood) * 3, m.mood], (m) => `mood ${m.mood.toFixed(3)} (integrates prediction errors over ~3 min)`],
    ['energy', 0x008300, (m) => [m.energy], (m) => `energy ${m.energy.toFixed(2)} (drains with dancing, recovers in calm)`],
    ['anticipation', 0xc98500, (m) => [m.daAnticipation], (m) => `dopamine, anticipatory ${m.daAnticipation.toFixed(2)} (build-up x value)`],
    ['dopamine', 0xeda100, (m) => [Math.abs(m.daPhasic), m.daPhasic], (m) => `dopamine, phasic ${m.daPhasic.toFixed(2)} (reward prediction error per grid slot)`],
    ['tonic DA', 0xb38a3a, (m) => [Math.abs(m.daTonic) * 2, m.daTonic], (m) => `dopamine, tonic ${m.daTonic.toFixed(2)} (~30 s average of hedonic value)`],
    ['surprise', 0xd55181, (m) => [m.surprise / 2], (m) => `surprise F ${m.surprise.toFixed(2)} bits (smoothed); IC ${m.IC.toFixed(2)}; dF/dt ${m.dF.toFixed(2)}\nharmonic surprise ${m.harmonicSurprise.toFixed(2)}`],
    ['uncertainty', 0xe87ba4, (m) => [m.entropy], (m) => `entropy of the slot ${m.entropy.toFixed(2)} bits; harmonic ${m.harmonicEntropy.toFixed(2)}`],
    ['bored', 0x9a9a9a, (m) => [m.bored], (m) => `bored ${m.bored.toFixed(2)} (> 0.7 grows a new form)`],
    ['confused', 0x7a8a9a, (m) => [m.confused], (m) => `confused ${m.confused.toFixed(2)}`],
    ['contagion', 0x5aa0a0, (m) => [m.contagion], (m) => `contagion ${m.contagion.toFixed(2)} (trust in the ML mood reading; no models in this lab, so 0)`],
  ];
  const mindN = MIND.map(([name, col, , info], i) => {
    const u = i / (MIND.length - 1), p = V3(-4.6 + 11 * u, 3.5 + 0.5 * Math.sin(Math.PI * u), -0.6 - 0.6 * Math.sin(Math.PI * u));
    label(name, V3(p.x, p.y + (i % 2 ? 0.5 : -0.5), p.z), 'nuc');
    return nucleus(p, col, name, () => info(sim.mind), 0.2);
  });
  label('mind', V3(0.9, 4.75, -1.2));
  const feelEl = label('', V3(0.9, 5.25, -1.2), 'feel');
  const amber = new THREE.Color(0xeda100), blue = new THREE.Color(0x3987e5), signed = (v) => (v >= 0 ? amber : blue);

  // ---- body: a jelly with five l = 2 surface modes, an inner fluid, a centre of mass -------------------------------------
  const BODY_C = V3(6.6, -0.5, 0);
  const bodyU = { uM: { value: new Float32Array(5) }, uSq: { value: 0 }, uStrain: { value: 0 } };
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.95, 64, 40), new THREE.ShaderMaterial({
    uniforms: bodyU, transparent: true, depthWrite: false,
    vertexShader: `uniform float uM[5]; uniform float uSq; varying float vF;
      void main(){ vec3 n = normalize(position); float x = n.x, y = n.y, z = n.z;
        float d = uM[0]*x*y + uM[1]*y*z + uM[2]*(2.*z*z - x*x - y*y)*.5 + uM[3]*x*z + uM[4]*(x*x - y*y)*.5;
        vec3 p = position * (1. + .45 * d); p.y *= 1. + uSq; p.xz *= 1. / sqrt(max(.3, 1. + uSq));
        vec4 mv = modelViewMatrix * vec4(p, 1.); vF = 1. - abs(normalize(normalMatrix * normal).z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uStrain; varying float vF;
      void main(){ vec3 c = mix(vec3(.25, .75, .85), vec3(1., .55, .35), uStrain); gl_FragColor = vec4(c * (.25 + 1.1 * vF * vF), .25 + .6 * vF); }`,
  }));
  body.position.copy(BODY_C); scene.add(body);
  const core = new THREE.Mesh(SPH, new THREE.MeshBasicMaterial({ color: 0xe0f4ff })); core.scale.setScalar(0.2); scene.add(core);
  hover.push({ obj: body, info: () => { const p = sim.phys; return `body (physics.mjs)\nposition ${Array.from(p.pos, (v) => v.toFixed(2)).join(', ')}\nslosh ${p.sloshAmp.toFixed(2)}, squash ${p.squash.toFixed(2)}\nmodes ${Array.from(p.modes, (v) => v.toFixed(2)).join(' ')}\nstrain ${p.strain.toFixed(2)}, jolt ${p.jolt.toFixed(2)} -> mind (proprioception)\nclick: poke it`; } });
  label('body (physics)', V3(6.6, 1.0, 0));
  const nPress = nucleus(V3(6.0, -2.75, 0.4), 0xff8a3d, 'pressure organ (pressure.mjs)', () => { const p = sim.pressure; return `pressure ${p.pressure.toFixed(2)} (charge ${p.charge.toFixed(2)} / tension ${p.tension.toFixed(2)})\nstate ${p.state}, bursts ${p.bursts}\nbursts into beads at 1 held 1.5 s, or a drop above 0.6`; });
  const nMax = nucleus(V3(7.3, -2.75, 0.4), 0xffffff, 'restraint M (restraint.mjs)', () => `maximalism M ${sim.S.M.toFixed(2)} (room for more than one layer; opens at drops, chills, climax)\nclimax ${sim.maxim.climax.toFixed(2)}, fatigue ${sim.maxim.fatigue.toFixed(2)}`, 0.16);
  label('pressure', V3(6.0, -3.3, 0.4), 'nuc'); label('restraint', V3(7.3, -3.3, 0.4), 'nuc');

  // ---- the wiring (what the page connects) ------------------------------------------------------------------------------
  const ef = () => sim.earFrame, lvl = () => c01(Math.log10(1 + (ef() ? ef().level : 0) * 30) / 1.49);
  const L = sim.cut;
  axon(P_IN, earPos[NE - 1], V3(0, 0.6, 0.3), lvl, () => false);
  axon(P_IN, P_AN, V3(-0.4, -0.3, 0.3), lvl, () => false, 0xb0b8c8);
  axon(EAR_C, TIS_C, V3(0, 0.7, 0.5), () => c01(sim.tissueStats.act * 120), () => L.earTissue);
  axon(EAR_C, nStartle.pos, V3(0, -0.4, 0.6), () => c01((ef() ? ef().onset : 0) * 2 + sim.mind.startle), () => L.onsets);
  axon(EAR_C, nRough.pos, V3(-0.3, -0.3, 0.4), () => c01((ef() ? ef().rough : 0) * 2.5), () => L.rough, 0xe66767);
  axon(EAR_C, nSub.pos, V3(0, -1.0, 0.9), () => c01((ef() ? ef().sub : 0) * 6), () => false, 0x3987e5);
  axon(nSub.pos, BODY_C, V3(0, -1.3, 0.8), () => c01((ef() ? ef().sub : 0) * 6), () => false, 0x3987e5);
  axon(EAR_C, MOT_C, V3(0, 1.9, 1.2), () => c01((ef() ? ef().onset : 0) * 3 + sim.mind.lock * 0.3), () => L.onsets);
  axon(nStartle.pos, TIS_C, V3(0.3, 0.2, 0.5), () => sim.mind.startle, () => L.startle, 0xffffff);
  axon(nStartle.pos, BODY_C, V3(0, -1.8, 1.4), () => sim.S.flinch || 0, () => L.startle, 0xffffff);
  axon(P_AN, SEQ_C, V3(0, -1.2, 0.8), () => c01(sim.S.V ? sim.S.V.kick + sim.S.V.snare + sim.S.V.hat : 0), () => false, 0xb0b8c8);
  axon(P_AN, MOT_C, V3(0, -0.6, 1.4), () => (L.tracker ? 0 : sim.P.rhythm * sim.an.state.beat.confidence), () => L.tracker, 0xb0b8c8);
  axon(SEQ_C, TIS_C, V3(-0.6, -0.8, -0.8), () => (sim.S.gate || 0), () => L.feedback, 0x199e70);
  axon(SEQ_C, mindN[5].pos, V3(1.6, 0.4, -1.5), () => sim.timing.predicted * sim.timing.readiness, () => L.predicted, 0x199e70);
  axon(TIS_C, mindN[1].pos, V3(-0.5, 0.6, -0.4), () => sim.tissueStats.coherence || 0, () => L.tissueMind);
  axon(nStartle.pos, mindN[0].pos, V3(-1.6, 1.2, 0.6), () => sim.mind.startle, () => L.onsets, 0xffffff);
  axon(nRough.pos, mindN[1].pos, V3(-1.6, 1.0, 0.8), () => c01((ef() ? ef().rough : 0) * 2.5), () => L.rough, 0xe66767);
  axon(MOT_C, mindN[5].pos, V3(0.2, 0.5, 0.2), () => sim.mind.groove, () => false);
  axon(P_AN, mindN[4].pos, V3(-2.5, 1.0, 1.6), () => (L.tension ? 0 : sim.an.state.structure.tension), () => L.tension, 0xb0b8c8);
  axon(mindN[0].pos, BODY_C, V3(1.2, 0.2, 0.6), () => sim.mind.arousal, () => false, 0xd95926);
  axon(MOT_C, BODY_C, V3(0, 0.2, 0.9), () => sim.mind.lock * sim.mind.groove + sim.mind.lock * 0.3, () => false, 0xe34948);
  axon(BODY_C, mindN[0].pos, V3(0.8, 0.6, -0.6), () => sim.phys.strain, () => L.proprio, 0x5ad0e0);
  axon(mindN[4].pos, nPress.pos, V3(2.3, -1.0, 1.4), () => (L.anticipation ? 0 : sim.mind.daAnticipation), () => L.anticipation, 0xc98500);
  pulses.count = Math.min(256, axons.length * PPA);

  // ---- per frame ---------------------------------------------------------------------------------------------------------
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), SC = new THREE.Vector3(), POS = new THREE.Vector3(), C = new THREE.Color();
  const RED = new THREE.Color(0x5a2020), TUBE = new THREE.Color(0x24303c), WHITE = new THREE.Color(1, 1, 1), VIOLET = new THREE.Color(0x9085e9), HEART = new THREE.Color(0xe34948);
  const GREEN = new THREE.Color(0x7bf0a0), PINK = new THREE.Color(0xff5fa8);
  const facing = new THREE.Quaternion();
  const put = (mesh, i, p, s, q = Q) => { M4.compose(p, q, SC.setScalar(s)); mesh.setMatrixAt(i, M4); };
  let wallT = 0;

  function frame(dtWall, playing) {
    wallT += dtWall;
    const m = sim.mind, e = sim.earFrame;
    // ear
    for (let k = 0; k < NE; k++) {
      const a = e ? Math.log1p(e.amp[k] / DELTA) / 4 : 0, mu = e ? e.mu[k] : -0.05;
      put(earDots, k, earPos[k], 0.06 + 0.13 * c01(a));
      earDots.setColorAt(k, C.copy(earHue[k]).multiplyScalar(0.18 + 0.82 * c01(a)));
      const hum = c01(mu / 0.04);   // above 0 it oscillates by itself: a shimmer that breathes at its own rate
      put(earHum, k, earPos[k], (0.12 + 0.2 * hum) * (1 + 0.15 * Math.sin(wallT * (3 + k * 0.37))));
      earHum.setColorAt(k, C.copy(earHue[k]).multiplyScalar(0.05 + 0.5 * hum + 0.25 * c01(a)));
    }
    earDots.instanceMatrix.needsUpdate = earHum.instanceMatrix.needsUpdate = true; earDots.instanceColor.needsUpdate = earHum.instanceColor.needsUpdate = true;
    nIn.set(lvl(), lvl());
    nAn.set(sim.an.state.beat.confidence, sim.an.state.beat.confidence);
    // brainstem
    const rough = c01((e ? e.rough : 0) * 2.5);
    nRough.set(rough, rough); nRough.core.position.copy(nRough.pos).addScalar((Math.random() - 0.5) * 0.05 * rough);
    nStartle.set(0.3 + 0.7 * m.startle, m.startle);
    habRing.scale.setScalar(0.4 + 0.6 * m.habituation); habRing.material.color.setScalar(0.15 + 0.7 * m.habituation);
    nSub.set(c01((e ? e.sub : 0) * 6), c01((e ? e.sub : 0) * 6));
    // tissue
    if (sim.tex) { texData.set(sim.tex); tisTex.needsUpdate = true; }
    // motor
    const R = m.regions, ph = m.pulsePhase;
    facing.copy(camera.quaternion);
    for (let g = 0; g < NREG; g++) {
      put(regRings, g, regPos[g], 1, facing);
      regRings.setColorAt(g, C.copy(WHITE).lerp(VIOLET, c01(R.cross[g] * 2)).multiplyScalar(0.12 + 0.88 * R.coh[g]));
      const gam = -Math.log(Math.max(0.02, R.coh[g])), th = Math.tanh(gam / 2), mean = TAU * (ph + R.phase[g]);
      for (let k = 0; k < 6; k++) {
        const a = mean + 2 * Math.atan(th * Math.tan(Math.PI * ((k + 0.5) / 6 - 0.5)));
        POS.set(0.3 * Math.cos(a), 0.3 * Math.sin(a), 0).applyQuaternion(facing).add(regPos[g]);
        put(oscDots, g * 6 + k, POS, 0.055);
        oscDots.setColorAt(g * 6 + k, C.copy(HEART).lerp(WHITE, 0.5).lerp(VIOLET, c01(R.cross[g] * 2)));
      }
    }
    regRings.instanceMatrix.needsUpdate = oscDots.instanceMatrix.needsUpdate = true; regRings.instanceColor.needsUpdate = oscDots.instanceColor.needsUpdate = true;
    const beat = Math.pow(1 - ph, 4);
    heart.set(0.35 + 0.65 * beat * (0.3 + 0.7 * m.lock), 0.2 + 0.8 * beat * m.lock);
    lockHalo.material.opacity = 0.04 * m.lock;
    let rmax = 1e-6; for (let i = 0; i < NRB; i++) rmax = Math.max(rmax, m.resonance[i]);
    const felt = Math.round(12 * Math.log2(m.pulseHz / 0.5));
    for (let i = 0; i < NRB; i++) {
      const a = Math.PI * (1.15 + 0.7 * i / (NRB - 1)), h = 0.04 + 0.6 * m.resonance[i] / rmax;
      POS.set(MOT_C.x + 2.15 * Math.cos(a), MOT_C.y + 1.4 * Math.sin(a) + h / 2, MOT_C.z + 1.0);
      M4.compose(POS, Q, SC.set(0.05, h, 0.05)); bank.setMatrixAt(i, M4);
      bank.setColorAt(i, i === felt ? HEART : C.setHSL(0.58, 0.55, 0.12 + 0.5 * m.resonance[i] / rmax));
    }
    bank.instanceMatrix.needsUpdate = true; bank.instanceColor.needsUpdate = true;
    // timing
    const t = sim.timing, now = sim.an.total / 48000;
    for (let ty = 0; ty < 3; ty++) for (let s = 0; s < 16; s++) {
      const i = ty * 16 + s, p = t.grid[TYPES[ty]][s], at = slotAt(ty, s);
      put(slots, i, at, 0.07 + 0.12 * p); slots.setColorAt(i, C.set(DRUM[TYPES[ty]]).multiplyScalar(0.12 + 0.88 * p));
      let pr = 0, hd = 0, ex = 0;
      for (const q of sim.preds) if (q.type === TYPES[ty] && q.slot === s) pr = Math.max(pr, c01(1 - (now - q.t) / 0.3));
      for (const q of sim.hits) if (q.type === TYPES[ty] && q.slot === s) { const v = c01(1 - (now - q.t) / 0.4); if (v > hd) { hd = v; ex = q.expected; } }
      put(predM, i, at, 0.11 * pr, facing); predM.setColorAt(i, C.copy(WHITE).multiplyScalar(pr));
      put(heard, i, slotAt(ty, s, seqR[ty] + 0.12), 0.05 * hd); heard.setColorAt(i, C.copy(ex > 0.5 ? GREEN : PINK).multiplyScalar(hd));
    }
    for (const mm of [slots, heard, predM]) { mm.instanceMatrix.needsUpdate = true; mm.instanceColor.needsUpdate = true; }
    const na = Math.PI / 2 - ((((sim.S.slot || 0) % 16) + 16) % 16) / 16 * TAU;
    needle.position.set(SEQ_C.x + 0.65 * Math.cos(na), SEQ_C.y + 0.65 * Math.sin(na) * 0.8, SEQ_C.z + 0.65 * Math.sin(na) * 0.4);
    needle.lookAt(SEQ_C); needle.rotateX(Math.PI / 2); needle.material.color.setScalar(0.2 + 0.8 * (sim.S.gate || 0));
    // mind
    MIND.forEach(([, , val], i) => { const [v, s] = val(m); mindN[i].set(v, v, s === undefined ? null : signed(s)); });
    feelEl.textContent = m.feeling();
    // body
    const p = sim.phys;
    body.position.set(BODY_C.x + p.pos[0] * 0.8, BODY_C.y + p.pos[1] * 0.8, BODY_C.z + p.pos[2] * 0.8);
    for (let k = 0; k < 5; k++) bodyU.uM.value[k] = p.modes[k];
    bodyU.uSq.value = p.squash; bodyU.uStrain.value = p.strain;
    body.rotation.y += p.omega[1] * dtWall * 0.5 + dtWall * 0.05; body.rotation.x += p.omega[0] * dtWall * 0.5;
    core.position.set(body.position.x + p.slosh[0] * 0.45, body.position.y + p.slosh[1] * 0.45, body.position.z + p.slosh[2] * 0.45);
    nPress.set(c01(sim.pressure.pressure), c01(sim.pressure.pressure), sim.pressure.state === 'swarm' ? VIOLET : null);
    nMax.set(sim.S.M || 0, sim.S.M || 0);
    // axons
    let j = 0;
    for (const ax of axons) {
      const les = ax.lesion(), a = les ? 0 : c01(ax.act() || 0);
      ax.a += (a - ax.a) * (1 - Math.exp(-dtWall / 0.15));
      ax.tube.material.color.copy(les ? RED : C.copy(TUBE).lerp(ax.color, 0.25 * ax.a));
      for (let k = 0; k < PPA; k++) {
        if (playing) ax.u[k] = (ax.u[k] + dtWall * (0.08 + 0.9 * ax.a)) % 1;
        ax.curve.getPointAt(ax.u[k], POS);
        put(pulses, j, POS, les ? 0 : 0.035 + 0.05 * ax.a);
        pulses.setColorAt(j, C.copy(ax.color).multiplyScalar(0.08 + 0.92 * ax.a)); j++;
      }
    }
    pulses.instanceMatrix.needsUpdate = true; pulses.instanceColor.needsUpdate = true;
    controls.update();
    renderer.render(scene, camera); labels.render(scene, camera);
  }

  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    renderer.setSize(w, h); labels.setSize(w, h); camera.aspect = w / h;
    const tf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), d = Math.max(8.7 / (tf * camera.aspect), 5.3 / tf);   // fit ~17.4 x 10.6 units
    camera.position.sub(controls.target).setLength(d).add(controls.target); camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(host); resize();

  // hover: what an organ is and what it holds now
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2(); let hoverHit = null;
  labels.domElement.addEventListener('pointermove', (ev) => {
    const r = labels.domElement.getBoundingClientRect();
    ptr.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(hover.map((h) => h.obj), false)[0];
    hoverHit = hit ? { h: hover.find((x) => x.obj === hit.object), id: hit.instanceId, x: ev.clientX, y: ev.clientY } : null;
  });
  labels.domElement.addEventListener('pointerleave', () => { hoverHit = null; });
  labels.domElement.addEventListener('click', () => { if (hoverHit && hoverHit.h.obj === body) sim.poke(); });
  setInterval(() => {
    if (!hoverHit) { tip.hidden = true; return; }
    tip.hidden = false; tip.textContent = hoverHit.h.info(hoverHit.id);
    tip.style.left = hoverHit.x + 14 + 'px'; tip.style.top = hoverHit.y + 12 + 'px';
  }, 100);
  return { frame, renderer };
}
