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
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), SC = new THREE.Vector3(), POS = new THREE.Vector3(), C = new THREE.Color();

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

  // ---- ear: a cochlea. A coiled duct (2.1 turns, apex and low notes inside, base and high notes outside) holding the
  // basilar membrane as a ribbon that bulges where the sound lands, and the 28 Hopf units standing on it ------------------
  const EAR_C = V3(-6.4, 0.6, 0);
  const coil = (u) => { const ang = -u * 2.1 * TAU + 1.2, r = 0.3 + 1.25 * u; return [ang, r, (1 - u) * 0.9 - 0.45]; };   // u: 0 apex .. 1 base
  const coilAt = (u, out = V3(0, 0, 0)) => { const [ang, r, z] = coil(u); return out.set(EAR_C.x + r * Math.cos(ang), EAR_C.y + r * Math.sin(ang), EAR_C.z + z); };
  const earU = (k) => k / (NE - 1);
  const earPos = [], earHue = [];
  for (let k = 0; k < NE; k++) { earPos.push(coilAt(earU(k))); earHue.push(new THREE.Color().setHSL(0.02 + 0.72 * earU(k), 0.85, 0.55)); }
  // the duct: a glassy tube that widens from apex to base
  {
    const curve = new THREE.CatmullRomCurve3(Array.from({ length: 160 }, (_, i) => coilAt(i / 159)));
    const SEG = 220, RAD = 10, geo = new THREE.TubeGeometry(curve, SEG, 1, RAD), pos = geo.attributes.position, c = V3(0, 0, 0), v = V3(0, 0, 0);
    for (let i = 0; i <= SEG; i++) {
      curve.getPointAt(i / SEG, c); const w = 0.07 + 0.11 * (i / SEG);
      for (let j = 0; j <= RAD; j++) { const n = i * (RAD + 1) + j; v.fromBufferAttribute(pos, n).sub(c).multiplyScalar(w).add(c); pos.setXYZ(n, v.x, v.y, v.z); }
    }
    geo.computeVertexNormals();
    scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x2a3a4c, opacity: 0.22, ...add, side: THREE.DoubleSide })));
  }
  // the basilar membrane: a ribbon along the duct, its height the units' amplitude (interpolated between units), with a
  // ripple running from the base inward (the real wave runs at the unit's own frequency, far too fast to see)
  const NR = 240, ribPos = new Float32Array(NR * 2 * 3), ribCol = new Float32Array(NR * 2 * 3), ribBase = [], ribSide = [], ribUp = [];
  for (let i = 0; i < NR; i++) {
    const u = i / (NR - 1), p = coilAt(u), [ang] = coil(u), w = 0.05 + 0.08 * u;
    ribBase.push(p); ribSide.push(V3(Math.cos(ang), Math.sin(ang), 0).multiplyScalar(w)); ribUp.push(V3(0, 0, 1));
  }
  const ribIdx = []; for (let i = 0; i < NR - 1; i++) { const a = 2 * i; ribIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const ribGeo = new THREE.BufferGeometry(); ribGeo.setIndex(ribIdx);
  ribGeo.setAttribute('position', new THREE.BufferAttribute(ribPos, 3).setUsage(THREE.DynamicDrawUsage));
  ribGeo.setAttribute('color', new THREE.BufferAttribute(ribCol, 3).setUsage(THREE.DynamicDrawUsage));
  const ribbon = new THREE.Mesh(ribGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, ...add }));
  scene.add(ribbon);
  const ribHue = Array.from({ length: NR }, (_, i) => new THREE.Color().setHSL(0.02 + 0.72 * (i / (NR - 1)), 0.85, 0.55));
  // the units: a bead each, standing on the membrane; warm when it hums by itself (mu > 0), cold when tired
  const earDots = new THREE.InstancedMesh(SPH, new THREE.MeshBasicMaterial(), NE), earHum = new THREE.InstancedMesh(SPH_LO, new THREE.MeshBasicMaterial({ ...add }), NE);
  scene.add(earDots, earHum); label('ear: a cochlea of 28 Hopf units', V3(-6.4, 2.3, 0));
  label('low notes', coilAt(0).add(V3(0, -0.28, 0.2)), 'sub'); label('high notes', coilAt(1).add(V3(0.2, -0.3, 0)), 'sub');
  hover.push({ obj: earDots, info: (i) => { const f = sim.earFrame, mu = f ? f.mu[i] : 0; return `ear unit ${i}: ${EAR_CF[i].toFixed(0)} Hz\namplitude ${(f ? f.amp[i] : 0).toFixed(4)} (its own hum settles at ${DELTA})\nmu ${mu.toFixed(4)}: ${mu > 0 ? 'humming by itself (silence lets it drift up)' : 'held below its own hum (loud sound tires it)'}\nits fibre feeds rows of the tissue (high notes top)`; } });
  hover.push({ obj: ribbon, info: () => `basilar membrane: each unit's amplitude, interpolated along the duct\nthe ripple only shows the direction of the wave (base to apex), not its speed` });
  // its fibres: each unit projects onto its own rows of the tissue (tonotopy), lit by the drive it sends (worker.mjs formula)
  const FS = 24, fibPos = new Float32Array(NE * FS * 2 * 3), fibCol = new Float32Array(NE * FS * 2 * 3), fibCurves = [];
  const fibGeo = new THREE.BufferGeometry();
  fibGeo.setAttribute('position', new THREE.BufferAttribute(fibPos, 3)); fibGeo.setAttribute('color', new THREE.BufferAttribute(fibCol, 3).setUsage(THREE.DynamicDrawUsage));
  const fibres = new THREE.LineSegments(fibGeo, new THREE.LineBasicMaterial({ vertexColors: true, ...add }));
  scene.add(fibres);
  const nRough = nucleus(V3(-4.2, -2.5, 0.9), 0xe66767, 'roughness / alarm (ear 30-150 Hz envelope)', () => `rough ${(sim.earFrame ? sim.earFrame.rough : 0).toFixed(3)} -> mind x2.5 clamped: ${c01((sim.earFrame ? sim.earFrame.rough : 0) * 2.5).toFixed(2)}`);
  const nStartle = nucleus(V3(-2.7, -2.7, 0.9), 0xffffff, 'startle nucleus (mind.mjs)', () => `startle ${sim.mind.startle.toFixed(2)}\nhabituation ${sim.mind.habituation.toFixed(2)} (1 = fresh, falls x0.7 per startle, recovers ~30 s)\nring: how ready it is to flinch`);
  const nSub = nucleus(V3(-1.2, -2.85, 0.9), 0x3987e5, 'body ear: sub-bass (ear.mjs sub)', () => `sub ${(sim.earFrame ? sim.earFrame.sub : 0).toFixed(3)} -> physics`);
  label('brainstem', V3(-2.7, -3.55, 0.9));
  const habRing = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.02, 6, 64), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  habRing.position.copy(nStartle.pos); scene.add(habRing);

  // ---- tissue: the 128 x 64 sheet of excitable cells, one vertex each, tilted back like a cortex seen from above. A cell
  // that fires rises and burns white, its wake cools to teal, and where activity keeps returning a violet memory stays.
  // Rows are tonotopic: each ear unit feeds its own band (high notes at the top), so sound visibly enters from the left. ---
  const TIS_C = V3(-2.4, 0.55, -0.6), SW = 3.6, SH = 1.9;
  const texData = new Uint8Array(TW * TH * 4), tisTex = new THREE.DataTexture(texData, TW, TH, THREE.RGBAFormat);
  tisTex.magFilter = tisTex.minFilter = THREE.LinearFilter; tisTex.needsUpdate = true;
  const tisMat = new THREE.ShaderMaterial({
    uniforms: { uT: { value: tisTex }, uW: { value: SW / 2 } }, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform sampler2D uT; uniform float uW; varying vec4 vT; varying float vEdge;
      void main(){ vT = texture2D(uT, vec2(uv.x, 1. - uv.y)); float tr = max(0., vT.r - .3) / .7;
        vec3 p = position; float e = p.x / uW; p.z -= .3 * e * e;          // a shallow cup: the middle comes forward
        p.z += .2 * vT.g + .06 * tr;                                       // firing cells rise, their wake settles
        vEdge = min(min(uv.x, 1. - uv.x) * 40., min(uv.y, 1. - uv.y) * 20.);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.); gl_PointSize = 1.; }`,
    fragmentShader: `varying vec4 vT; varying float vEdge;
      void main(){ float tr = max(0., vT.r - .3) / .7;
        vec3 c = vec3(.025, .04, .06) + vT.b * vec3(.4, .22, .7) * .35 + tr * vec3(.05, .55, .65) + vT.g * vec3(1., .95, .85) * 1.6;
        gl_FragColor = vec4(c * min(1., .35 + vEdge), 1.); }`,
  });
  const tisMesh = new THREE.Mesh(new THREE.PlaneGeometry(SW, SH, TW - 1, TH - 1), tisMat);
  tisMesh.position.copy(TIS_C); tisMesh.rotation.x = -0.42; scene.add(tisMesh); tisMesh.updateMatrixWorld();
  const sheetAt = (x01, y01, out = V3(0, 0, 0)) => { const x = (x01 - 0.5) * SW, e = x / (SW / 2); return tisMesh.localToWorld(out.set(x, (0.5 - y01) * SH, -0.3 * e * e)); };   // y01: 0 top row
  label('nervous tissue: 8192 excitable cells', sheetAt(0.5, 0).add(V3(0, 0.35, 0)));
  label('high notes', sheetAt(1, 0.08).add(V3(0.45, 0, 0)), 'sub'); label('low notes', sheetAt(1, 0.92).add(V3(0.42, 0, 0)), 'sub');
  hover.push({ obj: tisMesh, info: (_, hit) => {
    const t = sim.tissueStats, uv = hit && hit.uv, x = uv ? Math.min(TW - 1, (uv.x * TW) | 0) : 0, y = uv ? Math.min(TH - 1, ((1 - uv.y) * TH) | 0) : 0, j = (y * TW + x) * 4;
    const unit = Math.min(NE - 1, ((1 - (y + 0.5) / TH) * NE) | 0);
    return `tissue (Kinouchi sheet, rate homeostasis)\ncell ${x}, ${y}: fed by ear unit ${unit} (${EAR_CF[unit].toFixed(0)} Hz)\n  firing ${(texData[j + 1] / 255).toFixed(2)}, wake ${Math.max(0, (texData[j] / 255 - 0.3) / 0.7).toFixed(2)}, memory ${(texData[j + 2] / 255).toFixed(2)}\nactivity ${(t.act * 1000).toFixed(2)} per mille (set point ${(sim.P.tissue.target * 1000).toFixed(1)})\ncoupling sigma ${t.sigma.toFixed(3)}, branching ${t.branching.toFixed(2)} (1 = critical)\ncoherence ${(t.coherence || 0).toFixed(2)} -> mind\nwhite: firing now; teal: its wake; violet: where activity keeps returning`;
  } });
  // where the fibres land: unit k's rows on the left edge of the sheet (tissue.mjs rowUnit)
  for (let k = 0; k < NE; k++) {
    let y0 = TH, y1 = -1; for (let y = 0; y < TH; y++) if (Math.min(NE - 1, ((1 - (y + 0.5) / TH) * NE) | 0) === k) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const end = sheetAt(0.004, y1 < 0 ? 1 - earU(k) : (y0 + y1 + 1) / 2 / TH), a = earPos[k];
    const mid = a.clone().lerp(end, 0.5).add(V3(0, 0, 0.5 + 0.25 * Math.sin(k)));
    fibCurves.push(new THREE.QuadraticBezierCurve3(a, mid, end));
  }
  for (let k = 0; k < NE; k++) for (let s = 0; s < FS; s++) {
    const p = fibCurves[k].getPoint(s / FS), q = fibCurves[k].getPoint((s + 1) / FS), o = (k * FS + s) * 6;
    fibPos.set([p.x, p.y, p.z, q.x, q.y, q.z], o);
  }
  fibGeo.attributes.position.needsUpdate = true;
  // the edge of criticality: a dial under the sheet. Left: input dies out (deaf); middle: each spike causes one more
  // (critical, the widest dynamic range); right: activity feeds itself (runaway). The needle is the measured branching.
  const GA_C = V3(-2.4, -1.35, 0.35), GA_R = 0.55, NG = 33;
  const gArc = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), NG); scene.add(gArc);
  const brToAng = (b) => Math.PI * (1 - c01((b - 0.5) / 1.0));   // branching 0.5 .. 1.5 over the half circle
  for (let i = 0; i < NG; i++) {
    const f = i / (NG - 1), a = Math.PI * (1 - f), col = new THREE.Color().setHSL(f < 0.5 ? 0.6 - 0.28 * f * 2 : 0.32 - 0.32 * (f - 0.5) * 2, 0.7, 0.45);
    M4.compose(V3(GA_C.x + GA_R * Math.cos(a), GA_C.y + GA_R * Math.sin(a), GA_C.z), Q.setFromAxisAngle(V3(0, 0, 1), a), SC.set(0.03, 0.09, 0.03));
    gArc.setMatrixAt(i, M4); gArc.setColorAt(i, col);
  }
  Q.identity();
  const gNeedle = new THREE.Mesh(new THREE.BoxGeometry(0.025, GA_R * 0.9, 0.025), new THREE.MeshBasicMaterial({ color: 0xffffff })); scene.add(gNeedle);
  const gSet = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.16, 0.018), new THREE.MeshBasicMaterial({ color: 0x9085e9 })); scene.add(gSet);
  label('deaf', V3(GA_C.x - GA_R - 0.25, GA_C.y + 0.02, GA_C.z), 'sub'); label('critical', V3(GA_C.x, GA_C.y + GA_R + 0.18, GA_C.z), 'sub'); label('runaway', V3(GA_C.x + GA_R + 0.35, GA_C.y + 0.02, GA_C.z), 'sub');
  hover.push({ obj: gArc, info: () => { const t = sim.tissueStats; return `edge of criticality (Kinouchi & Copelli 2006: widest dynamic range at 1)\nwhite needle: measured branching ${t.branching.toFixed(2)} (spikes caused per spike)\nviolet tick: coupling sigma ${t.sigma.toFixed(2)}, which homeostasis tunes to hold activity at its set point\nloud music drives the sheet, so homeostasis lowers sigma; silence lets it rise toward reverberation`; } });

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
  const RED = new THREE.Color(0x5a2020), TUBE = new THREE.Color(0x24303c), WHITE = new THREE.Color(1, 1, 1), VIOLET = new THREE.Color(0x9085e9), HEART = new THREE.Color(0xe34948);
  const GREEN = new THREE.Color(0x7bf0a0), PINK = new THREE.Color(0xff5fa8);
  const facing = new THREE.Quaternion();
  const put = (mesh, i, p, s, q = Q) => { M4.compose(p, q, SC.setScalar(s)); mesh.setMatrixAt(i, M4); };
  const WARM = new THREE.Color(0xffb36b), COLD = new THREE.Color(0x6b8cff);
  const earA = new Float32Array(NE), fibA = new Float32Array(NE), fibPh = Float32Array.from({ length: NE }, (_, k) => (k * 0.37) % 1);
  let wallT = 0, ripT = 0, gBr = 1;

  function frame(dtWall, playing) {
    wallT += dtWall;
    const m = sim.mind, e = sim.earFrame;
    // ear: unit amplitudes (log, 0 at its own hum level), eased so the membrane moves like tissue, not like a meter
    for (let k = 0; k < NE; k++) {
      const a = e ? c01(Math.log1p(e.amp[k] / DELTA) / 4) : 0;
      earA[k] += (a - earA[k]) * (1 - Math.exp(-dtWall / (a > earA[k] ? 0.03 : 0.25)));
    }
    if (playing) ripT += dtWall;
    for (let i = 0; i < NR; i++) {
      const u = i / (NR - 1), f = u * (NE - 1), k0 = Math.min(NE - 2, f | 0), w = f - k0, a = earA[k0] * (1 - w) + earA[k0 + 1] * w;
      const h = 0.32 * a * (0.75 + 0.25 * Math.sin(ripT * 9 + u * 26));   // the ripple runs from the base (u = 1) inward
      const b = ribBase[i], sd = ribSide[i], o = i * 6;
      ribPos[o] = b.x - sd.x; ribPos[o + 1] = b.y - sd.y; ribPos[o + 2] = b.z + h;
      ribPos[o + 3] = b.x + sd.x; ribPos[o + 4] = b.y + sd.y; ribPos[o + 5] = b.z + h;
      C.copy(ribHue[i]).multiplyScalar(0.06 + 0.94 * a);
      ribCol[o] = ribCol[o + 3] = C.r; ribCol[o + 1] = ribCol[o + 4] = C.g; ribCol[o + 2] = ribCol[o + 5] = C.b;
    }
    ribGeo.attributes.position.needsUpdate = ribGeo.attributes.color.needsUpdate = true; ribGeo.computeBoundingSphere();
    for (let k = 0; k < NE; k++) {
      const a = earA[k], mu = e ? e.mu[k] : -0.05, hum = c01(mu / 0.04);   // above 0 it oscillates by itself
      POS.copy(earPos[k]); POS.z += 0.32 * a * (0.75 + 0.25 * Math.sin(ripT * 9 + earU(k) * 26)) + 0.04;
      put(earDots, k, POS, 0.045 + 0.08 * a);
      earDots.setColorAt(k, C.copy(earHue[k]).lerp(mu > 0 ? WARM : COLD, 0.45 * c01(Math.abs(mu) / 0.04)).multiplyScalar(0.3 + 0.7 * a));
      put(earHum, k, POS, (0.08 + 0.16 * hum) * (1 + 0.2 * Math.sin(wallT * (3 + k * 0.37))));
      earHum.setColorAt(k, C.copy(WARM).multiplyScalar(0.35 * hum));
    }
    earDots.instanceMatrix.needsUpdate = earHum.instanceMatrix.needsUpdate = true; earDots.instanceColor.needsUpdate = earHum.instanceColor.needsUpdate = true;
    // fibres: the drive each unit sends into the tissue (worker.mjs: 0.012 * max(0, log1p(env / DELTA) - 0.8)), a pulse running along
    const cutET = sim.cut.earTissue;
    for (let k = 0; k < NE; k++) {
      const d = e ? c01((Math.log1p(e.amp[k] / DELTA) - 0.8) / 2.5) : 0;
      fibA[k] += (d - fibA[k]) * (1 - Math.exp(-dtWall / 0.12));
      if (playing) fibPh[k] = (fibPh[k] + dtWall * (0.4 + 1.6 * fibA[k])) % 1;
      for (let s = 0; s < FS; s++) {
        const dd = ((s / FS - fibPh[k] + 1.5) % 1) - 0.5, pulse = Math.exp(-dd * dd * 120), o = (k * FS + s) * 6;
        if (cutET) C.copy(RED).multiplyScalar(0.6); else C.copy(earHue[k]).multiplyScalar(0.025 + fibA[k] * (0.25 + 0.75 * pulse));
        fibCol[o] = fibCol[o + 3] = C.r; fibCol[o + 1] = fibCol[o + 4] = C.g; fibCol[o + 2] = fibCol[o + 5] = C.b;
      }
    }
    fibGeo.attributes.color.needsUpdate = true;
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
    const ts = sim.tissueStats;
    gBr += (ts.branching - gBr) * (1 - Math.exp(-dtWall / 0.3));
    const na0 = brToAng(gBr), ns = brToAng(ts.sigma);
    gNeedle.position.set(GA_C.x + 0.45 * GA_R * Math.cos(na0), GA_C.y + 0.45 * GA_R * Math.sin(na0), GA_C.z + 0.01); gNeedle.rotation.z = na0 - Math.PI / 2;
    gSet.position.set(GA_C.x + (GA_R + 0.1) * Math.cos(ns), GA_C.y + (GA_R + 0.1) * Math.sin(ns), GA_C.z); gSet.rotation.z = ns - Math.PI / 2;
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
    hoverHit = hit ? { h: hover.find((x) => x.obj === hit.object), id: hit.instanceId, hit, x: ev.clientX, y: ev.clientY } : null;
  });
  labels.domElement.addEventListener('pointerleave', () => { hoverHit = null; });
  labels.domElement.addEventListener('click', () => { if (hoverHit && hoverHit.h.obj === body) sim.poke(); });
  setInterval(() => {
    if (!hoverHit) { tip.hidden = true; return; }
    tip.hidden = false; tip.textContent = hoverHit.h.info(hoverHit.id, hoverHit.hit);
    tip.style.left = hoverHit.x + 14 + 'px'; tip.style.top = hoverHit.y + 12 + 'px';
  }, 100);
  return { frame, renderer };
}
