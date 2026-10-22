// lab/prototypes/organism/view.mjs - the organism's nervous system, three ways, morphing smoothly between them:
//   Anatomy  every cell at its developed position in the body sphere (shape by kind, colour by area / kind / depth / sign),
//            faint radial shells (skin -> nucleus), the nucleus, the hearing field on the skin, synapses weighted by
//            strength (weak ones fade, links between areas bundled through the areas' centres).
//   Live     the same body, dark, with activity flowing: cells glow as they fire, every spike sends sparks along its
//            strongest synapses (so signals visibly run from the senses inward to the nucleus and out to the effectors),
//            and the modulatory cells' release spreads from the nucleus as a soft wave.
//   Diagram  a live 3D schematic: each functional group (groups.mjs) collapsed into a block, laid out from the senses
//            (outer ring above) through the areas to the nucleus (centre) and out to the effectors (ring below); tubes are
//            the summed weights between groups, their moving pulses the summed activity; each block has a readout.
// Also replays development as a time-lapse. Reads the organism, never drives it. ON's dashboard shows a remote organism
// through the same view (being/dash/organism-proxy.mjs): one with takeSpikes() reports its spikes instead of rate jumps.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { T, TYPE_NAMES, isReceptor, MILIEU_VARS } from '../../organism/develop.mjs';
import { buildGroups, diagramPositions, groupLinks } from './groups.mjs';

const add = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false };
const PAL = [0xe8a33d, 0x3fb8d0, 0xd95f8f, 0x8fd16a, 0x9d7cf0, 0xf07a4a, 0x4fd6a0, 0xe0d050, 0x5f8ff0, 0xd08ad8, 0xa0c04a, 0xf0a0a0];
export const TYPE_COL = { [T.EAR]: 0xf0b048, [T.ONSET]: 0xffe070, [T.ROUGH]: 0xff6b6b, [T.SUB]: 0x4f9cff, [T.PROPRIO]: 0x8fd16a, [T.INTER]: 0xc9ced6, [T.INTERO]: 0xff8fb1, [T.MOD]: 0xc58cff, [T.MOTOR]: 0xff7a3d, [T.CHROM]: 0x3fd0c9 };
const I_COL = 0x5a7dff;
const c01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ease = (x) => x * x * (3 - 2 * x);
export const communityColor = (c) => new THREE.Color(c < PAL.length ? PAL[c] : 0x59606a);
const KIND = (t) => (isReceptor(t) ? 0 : t === T.INTER ? 1 : t === T.INTERO ? 2 : t === T.MOD ? 3 : t === T.MOTOR ? 4 : 5);
const GEOS = [new THREE.TetrahedronGeometry(0.026), new THREE.SphereGeometry(0.017, 10, 8), new THREE.OctahedronGeometry(0.03), new THREE.IcosahedronGeometry(0.036), new THREE.BoxGeometry(0.036, 0.036, 0.036), new THREE.CylinderGeometry(0.034, 0.034, 0.008, 14)];
const RF_DEC = Math.exp(-0.004 / 0.1), RF_JUMP = (1 - RF_DEC) * 250;   // network.mjs fast rate: decay per step, jump per spike
const N_EARF = 64, N_SPARK = 3000, N_WAVE = 5;

// a rim-lit (fresnel) sphere: faint shells, group blocks, modulator waves
const rimMat = (color, a = 1, pow = 3) => new THREE.ShaderMaterial({ ...add, uniforms: { uC: { value: new THREE.Color(color) }, uA: { value: a }, uP: { value: pow } },
  vertexShader: 'varying float f; uniform float uP; void main(){ vec3 n = normalize(normalMatrix * normal); vec4 p = modelViewMatrix * vec4(position,1.); f = pow(1. - abs(dot(n, normalize(-p.xyz))), uP); gl_Position = projectionMatrix * p; }',
  fragmentShader: 'varying float f; uniform vec3 uC; uniform float uA; void main(){ gl_FragColor = vec4(uC * f * uA, 1.); }' });

export function createView(host, tip) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.setClearColor(0x06080b);
  host.appendChild(renderer.domElement);
  const labels = new CSS2DRenderer(); labels.domElement.className = 'labels'; host.appendChild(labels.domElement);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1, 0.05, 50);
  camera.position.set(0.4, 0.5, 3.4);
  const controls = new OrbitControls(camera, labels.domElement); controls.enableDamping = true; controls.autoRotate = true; controls.autoRotateSpeed = 0.35;

  // ---- the body: skin with its hearing field, radial shells, the nucleus ------------------------------------------------
  const skinMat = new THREE.ShaderMaterial({ ...add, side: THREE.DoubleSide,
    uniforms: { uEar: { value: Array.from({ length: N_EARF }, () => new THREE.Vector3()) }, uN: { value: 0 }, uA: { value: 1 }, uHear: { value: 1 } },
    vertexShader: 'varying vec3 u; varying float f; void main(){ u = normalize(position); vec3 n = normalize(normalMatrix * normal); vec4 p = modelViewMatrix * vec4(position,1.); f = pow(1. - abs(dot(n, normalize(-p.xyz))), 3.); gl_Position = projectionMatrix * p; }',
    fragmentShader: `uniform vec3 uEar[${N_EARF}]; uniform int uN; uniform float uA, uHear; varying vec3 u; varying float f;
      void main(){ float s = 0.; for (int k = 0; k < ${N_EARF}; k++) { if (k >= uN) break; s += exp(-(1. - dot(u, uEar[k])) / .022); }
        float e = 1. - exp(-1.2 * s); vec3 c = vec3(.25,.33,.42) * f + vec3(1.,.72,.25) * e * (.22 + .5 * f) * uHear;
        gl_FragColor = vec4(c * uA, 1.); }` });
  const skin = new THREE.Mesh(new THREE.SphereGeometry(1.0, 64, 40), skinMat);
  const shells = [0.3, 0.45, 0.6, 0.75].map((r) => { const s = new THREE.Mesh(new THREE.SphereGeometry(r, 40, 24), rimMat(0x2c3a4a, 0.5, 4)); return s; });
  const nucleus = new THREE.Mesh(new THREE.SphereGeometry(0.12, 32, 20), rimMat(0xc58cff, 0.55, 1.6));
  const nucCore = new THREE.Mesh(new THREE.SphereGeometry(0.06, 20, 14), new THREE.MeshBasicMaterial({ color: 0x2a2140, ...add }));
  scene.add(skin, ...shells, nucleus, nucCore);
  const waves = Array.from({ length: N_WAVE }, () => { const w = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), rimMat(0xb37cff, 0, 2)); w.visible = false; w.userData = { t: 1, a: 0 }; scene.add(w); return w; });

  let org = null, meshes = [], where = null, base = [], member = null, depthArr = null, colorMode = 'community', edges = null, edgeInfo = null, areaLabels = [];
  let lapse = null, lapseObjs = [], threshold = 0.35, showEdges = true, dead = null;
  let G = null, anat = null, diag = null, cur = null, links = [], bundles = [], blocks = [], strong = null, rfPrev = null, tPrev = 0, spk = null;
  let mode = 'anatomy', m = 0, live = 0, moved = true, tAnim = 0, modAcc = 0, lastWave = 0, sampleT = 0;
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), SC = new THREE.Vector3(), P = new THREE.Vector3(), C = new THREE.Color(), C2 = new THREE.Color(), UP = new THREE.Vector3(0, 1, 0);
  const halo = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ ...add }), 1024);
  halo.instanceMatrix.setUsage(THREE.DynamicDrawUsage); halo.frustumCulled = false; scene.add(halo);

  // sparks: signals running along synapses
  const sp = { from: new Int32Array(N_SPARK), to: new Int32Array(N_SPARK), t: new Float32Array(N_SPARK).fill(1), dur: new Float32Array(N_SPARK).fill(1), a: new Float32Array(N_SPARK), next: 0 };
  const spGeo = new THREE.BufferGeometry();
  spGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(3 * N_SPARK), 3).setUsage(THREE.DynamicDrawUsage));
  spGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(3 * N_SPARK), 3).setUsage(THREE.DynamicDrawUsage));
  const sparks = new THREE.Points(spGeo, new THREE.ShaderMaterial({ ...add, uniforms: { uS: { value: renderer.getPixelRatio() } },
    vertexShader: 'attribute vec3 color; varying vec3 c; uniform float uS; void main(){ c = color; vec4 p = modelViewMatrix * vec4(position,1.); gl_PointSize = uS * 34. / -p.z; gl_Position = projectionMatrix * p; }',
    fragmentShader: 'varying vec3 c; void main(){ vec2 q = gl_PointCoord - .5; float r = dot(q, q) * 4.; if (r > 1.) discard; gl_FragColor = vec4(c * pow(1. - r, 2.), 1.); }' }));
  sparks.frustumCulled = false; scene.add(sparks);
  const spCol = Array.from({ length: N_SPARK }, () => new THREE.Color());

  function clear() {
    for (const mm of meshes) { scene.remove(mm); mm.material.dispose(); mm.dispose(); }
    meshes = []; if (edges) { scene.remove(edges); edges.geometry.dispose(); edges = null; }
    clearAreaLabels(); clearDiagram(); clearLapse();
    sp.t.fill(1);
  }
  function setOrganism(o) {
    clear(); org = o; const d = o.dev, N = d.N;
    where = new Int32Array(2 * N); const counts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < N; i++) { const k = KIND(d.type[i]); where[2 * i] = k; where[2 * i + 1] = counts[k]++; }
    meshes = GEOS.map((g, k) => { const mm = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial(), Math.max(1, counts[k])); mm.count = counts[k]; mm.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mm.userData.kind = k; mm.frustumCulled = false; scene.add(mm); return mm; });
    anat = Float32Array.from(d.pos); cur = Float32Array.from(d.pos); diag = Float32Array.from(d.pos);
    base = Array.from({ length: N }, () => new THREE.Color());
    member = null; depthArr = null; dead = o.net.dead; G = null; moved = true;
    rfPrev = Float32Array.from(o.net.rf); spk = new Float32Array(N); tPrev = o.time;
    // the hearing field on the skin: every ear, onset and roughness receptor's direction
    const dirs = []; for (let i = 0; i < N && dirs.length < N_EARF; i++) if (d.type[i] <= T.ROUGH) { const l = Math.hypot(d.pos[3 * i], d.pos[3 * i + 1], d.pos[3 * i + 2]) || 1; dirs.push([d.pos[3 * i] / l, d.pos[3 * i + 1] / l, d.pos[3 * i + 2] / l]); }
    dirs.forEach((u, k) => skinMat.uniforms.uEar.value[k].set(...u)); skinMat.uniforms.uN.value = dirs.length;
    placeAll(); recolor();
  }
  function placeCell(i, x, y, z, s) {
    const k = where[2 * i];
    if (k === 5) { P.set(org.dev.pos[3 * i], org.dev.pos[3 * i + 1], org.dev.pos[3 * i + 2]).normalize(); Q.setFromUnitVectors(UP, P); } else Q.identity();
    M4.compose(P.set(x, y, z), Q, SC.set(s, s, s)); meshes[k].setMatrixAt(where[2 * i + 1], M4);
  }
  function placeAll() {
    const N = org.dev.N, k = ease(m);
    for (let i = 0; i < N; i++) {
      for (let a = 0; a < 3; a++) cur[3 * i + a] = anat[3 * i + a] + k * (diag[3 * i + a] - anat[3 * i + a]);
      placeCell(i, cur[3 * i], cur[3 * i + 1], cur[3 * i + 2], 1 - 0.4 * k);
    }
    meshes.forEach((mm) => { mm.instanceMatrix.needsUpdate = true; mm.boundingSphere = null; });
  }
  function colorOf(i) {
    const d = org.dev, t = d.type[i];
    if (colorMode === 'type') return C.set(t === T.INTER && d.isI[i] ? I_COL : TYPE_COL[t]);
    if (colorMode === 'ei') return C.set(isReceptor(t) ? 0xe8e6e0 : d.isI[i] ? I_COL : 0xf0a040);
    if (colorMode === 'depth') { const h = depthArr ? depthArr[i] : -1; return h < 0 ? C.set(0x3a4048) : C.setHSL(0.62 - 0.62 * Math.min(1, h / 6), 0.8, 0.55); }
    return member ? communityColor(member[i]) : C.set(TYPE_COL[t]);
  }
  function recolor() { if (!org) return; for (let i = 0; i < org.dev.N; i++) base[i].copy(colorOf(i)); if (edges) rebuildEdges(); }

  /** areas found by community detection, and depth from the senses */
  function setPartition(mem, dep) {
    member = mem; depthArr = dep; recolor(); rebuildEdges(); placeAreaLabels(); buildDiagram(); moved = true;
  }
  function centroids() {
    const d = org.dev, cs = new Map();
    for (let i = 0; i < d.N; i++) { const c = member ? member[i] : 0; if (!cs.has(c)) cs.set(c, { x: 0, y: 0, z: 0, n: 0, types: new Array(10).fill(0) }); const o = cs.get(c); o.x += d.pos[3 * i]; o.y += d.pos[3 * i + 1]; o.z += d.pos[3 * i + 2]; o.n++; o.types[d.type[i]]++; }
    for (const o of cs.values()) { o.x /= o.n; o.y /= o.n; o.z /= o.n; }
    return cs;
  }
  function clearAreaLabels() { for (const o of areaLabels) { scene.remove(o); if (o.element) o.element.remove(); if (o.geometry) o.geometry.dispose(); } areaLabels = []; }
  function placeAreaLabels() {
    clearAreaLabels();
    if (!member || lapse) return;
    const cs = centroids();
    [...cs.entries()].filter(([, o]) => o.n >= 12).sort((a, b) => b[1].n - a[1].n).slice(0, 8).forEach(([c, o]) => {
      const top = o.types.map((n, t) => [n, t]).filter(([n]) => n > 0).sort((a, b) => b[0] - a[0]).slice(0, 2).map(([n, t]) => `${TYPE_NAMES[t]} ${Math.round(100 * n / o.n)}%`).join(', ');
      const el = document.createElement('div'); el.className = 'area'; el.style.color = '#' + communityColor(c).getHexString();
      el.textContent = `area ${c + 1} · ${o.n} · ${top}`;
      const obj = new CSS2DObject(el), p = new THREE.Vector3(o.x, o.y, o.z), l = p.length();
      obj.position.copy(l > 0.05 ? p.multiplyScalar(1.12 / l) : p.set(0, 1.12, 0)); scene.add(obj); areaLabels.push(obj);
      const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(o.x, o.y, o.z), obj.position.clone().multiplyScalar(0.97)]), new THREE.LineBasicMaterial({ color: communityColor(c), transparent: true, opacity: 0.35 }));
      scene.add(ln); areaLabels.push(ln);
    });
  }

  // ---- synapses (Anatomy, Live): weighted lines; links between areas bend through both areas' centres -------------------
  function rebuildEdges() {
    if (edges) { scene.remove(edges); edges.geometry.dispose(); edges = null; }
    if (!org || lapse) return;
    const d = org.dev, e = org.net.edges(), cs = centroids(), pos = d.pos, N = d.N;
    const ws = Array.from(e.w).sort((a, b) => a - b), wRef = ws[Math.floor(0.95 * (ws.length - 1))] || 1, wMin = ws[Math.floor(threshold * (ws.length - 1))] || 0;
    // strongest outgoing synapses per cell (the paths sparks take): up to 3, above the 60th percentile
    const wPath = ws[Math.floor(0.6 * (ws.length - 1))] || 0, best = Array.from({ length: N }, () => []);
    for (let k = 0; k < e.m; k++) if (e.w[k] >= wPath && !dead[e.post[k]]) best[e.pre[k]].push([e.w[k], e.post[k]]);
    strong = best.map((l) => l.sort((a, b) => b[0] - a[0]).slice(0, 3).map(([w, j]) => [j, c01(w / wRef)]));
    if (!showEdges) return;
    const P0 = [], PRE = [], AMP = [];
    const pushSeg = (a, b, pre, amp) => { P0.push(a[0], a[1], a[2], b[0], b[1], b[2]); PRE.push(pre, pre); AMP.push(amp, amp); };
    for (let k = 0; k < e.m; k++) {
      const w = e.w[k]; if (w < wMin) continue;
      const i = e.pre[k], j = e.post[k], a = [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]], b = [pos[3 * j], pos[3 * j + 1], pos[3 * j + 2]];
      const q = c01(w / wRef), amp = q * q * (d.isI[i] ? 0.8 : 1);       // squared: weak synapses recede
      const ci = member ? member[i] : 0, cj = member ? member[j] : 0;
      if (ci === cj) { pushSeg(a, b, i, amp * 0.9); continue; }
      const A = cs.get(ci), B = cs.get(cj), c1 = [a[0] + 0.75 * (A.x - a[0]), a[1] + 0.75 * (A.y - a[1]), a[2] + 0.75 * (A.z - a[2])], c2 = [b[0] + 0.75 * (B.x - b[0]), b[1] + 0.75 * (B.y - b[1]), b[2] + 0.75 * (B.z - b[2])];
      let prev = a;
      for (let s = 1; s <= 6; s++) {
        const t = s / 6, u = 1 - t, q2 = [0, 1, 2].map((x) => u * u * u * a[x] + 3 * u * u * t * c1[x] + 3 * u * t * t * c2[x] + t * t * t * b[x]);
        pushSeg(prev, q2, i, amp * 0.6); prev = q2;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P0, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(P0.length), 3).setUsage(THREE.DynamicDrawUsage));
    edges = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, ...add }));
    edgeInfo = { pre: Int32Array.from(PRE), amp: Float32Array.from(AMP) };
    scene.add(edges);
  }

  // ---- the diagram: group blocks, bundled tubes with flowing pulses, readouts ---------------------------------------------
  const tubeMat = (col) => new THREE.ShaderMaterial({ ...add, uniforms: { uC: { value: new THREE.Color(col) }, uA: { value: 0 }, uF: { value: 0 }, uW: { value: 0 }, uT: { value: 0 }, uR: { value: 3 } },
    vertexShader: 'varying vec2 v; void main(){ v = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: `uniform vec3 uC; uniform float uA, uF, uW, uT, uR; varying vec2 v;
      void main(){ float p = fract(v.x * uR - uT); float pulse = smoothstep(0., .75, p) * (1. - smoothstep(.75, .82, p));
        float end = smoothstep(0., .04, v.x) * smoothstep(1., .96, v.x);
        gl_FragColor = vec4(uC * (.05 + .16 * uW + 1.4 * uF * pulse * pulse) * uA * end, 1.); }` });
  function clearDiagram() {
    for (const b of bundles) { scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); }
    for (const b of blocks) { scene.remove(b.mesh, b.label); b.mesh.geometry.dispose(); b.mesh.material.dispose(); b.label.element.remove(); }
    bundles = []; blocks = []; links = [];
  }
  function buildDiagram() {
    clearDiagram(); if (!org) return;
    G = buildGroups(org, member, depthArr, (c) => communityColor(c).getHex(), TYPE_COL);
    diag = diagramPositions(org, G);
    for (const g of G.groups) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(g.rb + 0.02, 32, 20), rimMat(g.col, 0, 2.2)); mesh.position.set(...g.p); mesh.userData.group = g.id;
      const el = document.createElement('div'); el.className = 'gl';
      el.innerHTML = `<b style="color:#${new THREE.Color(g.col).getHexString()}">${g.name}</b> <span class="n">${g.cells.length}</span> <canvas width="72" height="16"></canvas> <span class="hz"></span><div class="ln"></div>`;
      const label = new CSS2DObject(el); label.position.set(g.p[0], g.p[1] - g.rb - 0.05, g.p[2]); label.center.set(0.5, 0);
      scene.add(mesh, label);
      blocks.push({ g, mesh, label, el, cv: el.querySelector('canvas'), hz: el.querySelector('.hz'), ln: el.querySelector('.ln'), hist: new Float32Array(60), n: 0, act: 0 });
    }
    const e = org.net.edges(); links = groupLinks(G, e);
    const wMax = links.length ? links[0].w : 1, keep = links.filter((l) => l.w >= 0.04 * wMax).slice(0, 40);
    const A = new THREE.Vector3(), B = new THREE.Vector3(), D = new THREE.Vector3(), O = new THREE.Vector3(), M = new THREE.Vector3();
    for (const l of keep) {
      const ga = G.groups[l.a], gb = G.groups[l.b];
      A.set(...ga.p); B.set(...gb.p); D.subVectors(B, A); const len = D.length(); D.normalize();
      O.crossVectors(D, UP); if (O.lengthSq() < 1e-4) O.set(1, 0, 0); O.normalize().multiplyScalar(0.035);   // A->B and B->A run side by side
      const a = A.clone().addScaledVector(D, ga.rb).add(O), b = B.clone().addScaledVector(D, -gb.rb).add(O);
      M.addVectors(a, b).multiplyScalar(0.5); const ctrl = M.clone().multiplyScalar(0.55).addScaledVector(O, 2);   // bend toward the centre: bundles
      const curve = new THREE.QuadraticBezierCurve3(a, ctrl, b), q = Math.sqrt(l.w / wMax);
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.003 + 0.013 * q, 6, false), tubeMat(ga.col));
      mesh.material.uniforms.uW.value = q; mesh.material.uniforms.uR.value = Math.max(1, Math.round(len / 0.35));
      scene.add(mesh); bundles.push({ l, mesh, f: 0 });
    }
    moved = true;
  }

  // ---- time-lapse of development ---------------------------------------------------------------------------------------------
  function revealMat(color, opacity) {
    return new THREE.ShaderMaterial({ ...add, uniforms: { uT: { value: 0 }, uC: { value: new THREE.Color(color) }, uA: { value: opacity } },
      vertexShader: 'attribute float t; attribute vec3 tint; varying float v; varying vec3 c; uniform float uT; void main(){ v = smoothstep(t, t + .015, uT); c = tint; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
      fragmentShader: 'uniform vec3 uC; uniform float uA; varying float v; varying vec3 c; void main(){ if (v <= 0.) discard; gl_FragColor = vec4((uC * .4 + c) * uA * v, 1.); }' });
  }
  function clearLapse() { for (const o of lapseObjs) { scene.remove(o); o.geometry.dispose(); o.material.dispose(); } lapseObjs = []; lapse = null; }
  function startLapse(seconds = 16) {
    if (!org) return; clearLapse(); const d = org.dev;
    lapse = { t: 0, dur: seconds, mode }; setMode('anatomy'); m = 0; live = 0;
    const P0 = [], TT = [], TI = [];
    for (const a of d.axons) {
      const n = a.pts.length / 3, col = new THREE.Color(TYPE_COL[d.type[a.cell]]);
      for (let k = 1; k < n; k++) for (const q of [k - 1, k]) { P0.push(a.pts[3 * q], a.pts[3 * q + 1], a.pts[3 * q + 2]); TT.push(a.t0 + (a.t1 - a.t0) * 0.9 * (k / (n - 1))); TI.push(col.r, col.g, col.b); }
    }
    const ga = new THREE.BufferGeometry(); ga.setAttribute('position', new THREE.Float32BufferAttribute(P0, 3)); ga.setAttribute('t', new THREE.Float32BufferAttribute(TT, 1)); ga.setAttribute('tint', new THREE.Float32BufferAttribute(TI, 3));
    const ax = new THREE.LineSegments(ga, revealMat(0x334455, 0.22));
    const S0 = [], ST = [], SI = [];
    for (let k = 0; k < d.syn.pre.length; k++) {
      const i = d.syn.pre[k], j = d.syn.post[k], c = new THREE.Color(d.isI[i] ? I_COL : 0xf0a040);
      S0.push(d.pos[3 * i], d.pos[3 * i + 1], d.pos[3 * i + 2], d.pos[3 * j], d.pos[3 * j + 1], d.pos[3 * j + 2]); ST.push(d.syn.t[k], d.syn.t[k]); SI.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    const gs = new THREE.BufferGeometry(); gs.setAttribute('position', new THREE.Float32BufferAttribute(S0, 3)); gs.setAttribute('t', new THREE.Float32BufferAttribute(ST, 1)); gs.setAttribute('tint', new THREE.Float32BufferAttribute(SI, 3));
    const sy = new THREE.LineSegments(gs, revealMat(0x000000, 0.12));
    lapseObjs = [ax, sy]; scene.add(ax, sy);
    if (edges) { scene.remove(edges); edges.geometry.dispose(); edges = null; }
    clearAreaLabels(); sp.t.fill(1);
  }
  function lapseFrame(dt) {
    lapse.t = Math.min(1, lapse.t + dt / lapse.dur); const t = lapse.t, d = org.dev;
    for (const o of lapseObjs) o.material.uniforms.uT.value = t;
    for (let i = 0; i < d.N; i++) {
      const born = d.born[i], vis = t >= born, mig = c01((t - born) / 0.12), s = vis ? 0.4 + 0.6 * mig : 0;
      const bx = d.birthPos[3 * i], by = d.birthPos[3 * i + 1], bz = d.birthPos[3 * i + 2];
      placeCell(i, bx + mig * (d.pos[3 * i] - bx), by + mig * (d.pos[3 * i + 1] - by), bz + mig * (d.pos[3 * i + 2] - bz), s);
      meshes[where[2 * i]].setColorAt(where[2 * i + 1], C.set(d.type[i] === T.INTER && d.isI[i] ? I_COL : TYPE_COL[d.type[i]]).multiplyScalar(vis ? 0.5 + 0.5 * (1 - mig) + 0.3 : 0));
    }
    meshes.forEach((mm) => { mm.instanceMatrix.needsUpdate = true; if (mm.instanceColor) mm.instanceColor.needsUpdate = true; });
    halo.count = 0; sparks.visible = false;
    for (const b of blocks) { b.mesh.visible = false; b.label.visible = false; } for (const b of bundles) b.mesh.visible = false;
    if (t >= 1 && (lapse.hold = (lapse.hold || 0) + dt) > 2) { const back = lapse.mode; clearLapse(); placeAll(); rebuildEdges(); placeAreaLabels(); setMode(back); moved = true; }
  }

  // ---- per frame ------------------------------------------------------------------------------------------------------------
  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    if (renderer.domElement.width !== Math.round(w * renderer.getPixelRatio()) || renderer.domElement.height !== Math.round(h * renderer.getPixelRatio())) { renderer.setSize(w, h, false); renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px'; labels.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  }
  /** spikes per cell since the last frame, read from the fast rate's jumps (the page steps many network ticks per frame) */
  function spikesSince() {
    if (org.takeSpikes) { tPrev = org.time; return org.takeSpikes(spk); }   // a remote organism (being/dash/organism-proxy.mjs) reports spikes
    const rf = org.net.rf, N = org.dev.N, n = Math.max(0, Math.round((org.time - tPrev) / 0.004)); tPrev = org.time;
    if (!n) { spk.fill(0); return 0; }
    const dk = RF_DEC ** n, per = RF_JUMP * RF_DEC ** (n / 2); let tot = 0;
    for (let i = 0; i < N; i++) { const x = (rf[i] - rfPrev[i] * dk) / per; const k = x > 0.5 ? Math.round(x) : x > 0.15 && Math.random() < x ? 1 : 0; spk[i] = k; tot += k; rfPrev[i] = rf[i]; }
    return tot;
  }
  function spawnSparks() {
    if (!strong || live < 0.05) return;
    const N = org.dev.N, ty = org.dev.type;
    for (let i = 0; i < N; i++) {
      if (!spk[i] || dead[i]) continue;
      for (const [j, q] of strong[i]) {
        if (Math.random() > Math.min(1, spk[i] * (0.25 + 0.75 * q))) continue;
        const s = sp.next; sp.next = (s + 1) % N_SPARK;
        sp.from[s] = i; sp.to[s] = j; sp.t[s] = 0; sp.dur[s] = 0.35 + 0.25 * Math.random(); sp.a[s] = 0.35 + 0.65 * q;
        spCol[s].copy(isReceptor(ty[i]) ? C2.set(TYPE_COL[ty[i]]) : org.dev.isI[i] ? C2.set(I_COL) : base[i]);
      }
    }
  }
  function sparkFrame(dt) {
    const pos = spGeo.attributes.position.array, col = spGeo.attributes.color.array, L = live * (1 - ease(m));
    for (let s = 0; s < N_SPARK; s++) {
      let t = sp.t[s];
      if (t >= 1) { col[3 * s] = col[3 * s + 1] = col[3 * s + 2] = 0; continue; }
      t = Math.min(1, t + dt / sp.dur[s]); sp.t[s] = t;
      const i = sp.from[s], j = sp.to[s], u = ease(t), a = sp.a[s] * L * Math.sin(Math.PI * t) * 1.3, c = spCol[s];
      pos[3 * s] = cur[3 * i] + u * (cur[3 * j] - cur[3 * i]); pos[3 * s + 1] = cur[3 * i + 1] + u * (cur[3 * j + 1] - cur[3 * i + 1]); pos[3 * s + 2] = cur[3 * i + 2] + u * (cur[3 * j + 2] - cur[3 * i + 2]);
      col[3 * s] = c.r * a; col[3 * s + 1] = c.g * a; col[3 * s + 2] = c.b * a;
    }
    spGeo.attributes.position.needsUpdate = true; spGeo.attributes.color.needsUpdate = true; sparks.visible = L > 0.01;
  }
  function waveFrame(dt, modSpikes) {
    // modulatory release spreads from the nucleus (volume transmission): a wave per burst of modulatory spikes
    modAcc = modAcc * Math.exp(-dt / 0.4) + modSpikes; lastWave += dt;
    if (live > 0.05 && modAcc > 1.5 && lastWave > 0.35) {
      const w = waves.find((x) => x.userData.t >= 1) || waves[0]; w.userData.t = 0; w.userData.a = Math.min(1, 0.3 + 0.15 * modAcc); modAcc = 0; lastWave = 0;
    }
    for (const w of waves) {
      const u = w.userData; if (u.t >= 1) { w.visible = false; continue; }
      u.t = Math.min(1, u.t + dt / 1.8); const r = 0.12 + 0.9 * Math.sqrt(u.t);
      w.scale.setScalar(r); w.visible = true; w.material.uniforms.uA.value = 0.55 * u.a * (1 - u.t) ** 1.5 * live * (1 - ease(m));
    }
  }
  let readState = null;
  // the group's essential-variable link, short, with the variable's live value
  const linkVal = (g, s) => {
    if (!s) return g.link;
    const f = (x) => (x < 0 ? '−' : '') + Math.abs(x).toFixed(2);
    if (g.kind === 'sense') return g.key === 'proprio' ? `strain ${f(s.strain)}` : `→ need ${f(s.need)}`;
    if (g.kind === 'area') return `costs energy ${f(s.energy)}`;
    if (g.key === 'intero') return g.link;
    if (g.key === 'mod') return `RPE ${f(s.rpe ?? 0)}`;
    if (g.key === 'motor') return `brace ${f(s.brace ?? 0)} → integrity ${f(s.integrity)}`;
    return `costs energy ${f(s.energy)}`;
  };
  function diagramFrame(dt) {
    const k = ease(m), rf = org.net.rf;
    for (const b of bundles) {
      const l = b.l; let s = 0; for (let q = 0; q < l.pre.length; q++) s += l.wk[q] * rf[l.pre[q]];
      const f = c01(s / (l.w * 8 + 1e-6)); b.f += (1 - Math.exp(-dt / 0.15)) * (f - b.f);
      const u = b.mesh.material.uniforms; u.uA.value = k; u.uF.value = b.f; u.uT.value = tAnim * (0.6 + 1.4 * b.f); b.mesh.visible = k > 0.01;
    }
    sampleT += dt; const doSample = sampleT > 0.15; if (doSample) sampleT = 0;
    for (const b of blocks) {
      let s = 0; for (const i of b.g.cells) s += rf[i]; s /= b.g.cells.length; b.act += (1 - Math.exp(-dt / 0.2)) * (s - b.act);
      b.mesh.material.uniforms.uA.value = k * (0.35 + 0.9 * c01(b.act / 12)); b.mesh.visible = k > 0.01;
      // labels of blocks behind the centre recede, so the front ones read
      P.set(...b.g.p).applyMatrix4(camera.matrixWorldInverse); const front = P.z > -camera.position.length() + 0.05;
      b.label.visible = k > 0.35; b.el.style.opacity = c01((k - 0.35) / 0.4) * (front ? 1 : 0.28);
      if (doSample && b.label.visible) {
        b.hist[b.n++ % 60] = s; b.hz.textContent = s.toFixed(1) + ' Hz'; b.ln.textContent = linkVal(b.g, readState);
        const g2 = b.cv.getContext('2d'), mx = Math.max(4, ...b.hist); g2.clearRect(0, 0, 72, 16); g2.strokeStyle = '#' + new THREE.Color(b.g.col).getHexString(); g2.lineWidth = 1.5; g2.beginPath();
        for (let q = 0; q < 60; q++) { const v = b.hist[(b.n + q) % 60], x = (72 * q) / 59, y = 15 - 13 * (v / mx); if (q) g2.lineTo(x, y); else g2.moveTo(x, y); }
        g2.stroke();
      }
    }
  }
  function frame(dt) {
    resize(); controls.update(); tAnim += dt;
    if (org && lapse) { lapseFrame(dt); renderer.render(scene, camera); labels.render(scene, camera); return; }
    if (org) {
      readState = org.state();
      const mT = mode === 'diagram' ? 1 : 0, lT = mode === 'live' ? 1 : 0, rate = dt / 0.9;
      if (m !== mT) { m = mT > m ? Math.min(mT, m + rate) : Math.max(mT, m - rate); moved = true; }
      live += (lT > live ? 1 : -1) * Math.min(Math.abs(lT - live), dt / 0.6);
      if (moved) { placeAll(); moved = m !== mT; }
      const d = org.dev, rf = org.net.rf, N = d.N, k = ease(m), A = 1 - k; let h = 0;
      spikesSince(); let modSp = 0; for (const i of org.C.mod) modSp += spk[i];
      // cells: base colour (blended to the group's colour in the diagram), brightness by firing; Live is darker at rest
      for (let i = 0; i < N; i++) {
        const g = dead[i] ? 0 : c01(rf[i] / 25), c = C.copy(base[i]);
        if (k > 0 && G && G.of[i] >= 0) c.lerp(C2.set(G.groups[G.of[i]].col), k);
        const br = dead[i] ? 0.12 : (0.45 + 0.75 * g) * (1 - live) + (0.14 + 1.0 * g) * live;
        meshes[where[2 * i]].setColorAt(where[2 * i + 1], c.multiplyScalar(br));
        if (g > 0.12 && h < 1024) { const s = (0.016 + 0.022 * g) * (1 + 0.3 * live - 0.4 * k); M4.compose(P.set(cur[3 * i], cur[3 * i + 1], cur[3 * i + 2]), Q.identity(), SC.set(s, s, s)); halo.setMatrixAt(h, M4); halo.setColorAt(h, C.copy(base[i]).multiplyScalar((0.16 + 0.04 * live) * g)); h++; }
      }
      halo.count = h; halo.instanceMatrix.needsUpdate = true; if (halo.instanceColor) halo.instanceColor.needsUpdate = true;
      meshes.forEach((mm) => { if (mm.instanceColor) mm.instanceColor.needsUpdate = true; });
      if (edges) {
        const ea = A * A * (1 - 0.7 * live); edges.visible = ea > 0.01;
        if (edges.visible) {
          const col = edges.geometry.attributes.color.array, pre = edgeInfo.pre, amp = edgeInfo.amp;
          for (let v = 0; v < pre.length; v++) { const i = pre[v], g = dead[i] ? 0 : 0.25 + 0.75 * c01(rf[i] / 20), c = base[i], a = amp[v] * g * 0.5 * ea; col[3 * v] = c.r * a; col[3 * v + 1] = c.g * a; col[3 * v + 2] = c.b * a; }
          edges.geometry.attributes.color.needsUpdate = true;
        }
      }
      // the body: skin and hearing field, radial shells, nucleus (glows with the modulator in Live)
      skinMat.uniforms.uA.value = A * (1 - 0.35 * live); skinMat.uniforms.uHear.value = 1 - 0.5 * live; skin.visible = A > 0.01;
      shells.forEach((s, q) => { s.material.uniforms.uA.value = A * (0.5 - 0.25 * live) * (0.7 + 0.1 * q); s.visible = A > 0.01; });
      const modLvl = c01((readState.arousal || 0) * 4);
      nucleus.material.uniforms.uA.value = A * (0.55 + live * (0.4 + 1.2 * modLvl)); nucleus.visible = A > 0.01;
      nucCore.material.color.setRGB(0.16 + 0.5 * live * modLvl, 0.13 + 0.25 * live * modLvl, 0.25 + 0.6 * live * modLvl); nucCore.visible = A > 0.01;
      for (const o of areaLabels) { o.visible = A * (1 - live) > 0.5; }
      spawnSparks(); sparkFrame(dt); waveFrame(dt, modSp);
      if (G) diagramFrame(dt);
    }
    renderer.render(scene, camera); labels.render(scene, camera);
  }

  function setMode(md) { if (!['anatomy', 'live', 'diagram'].includes(md)) return; mode = md; controls.autoRotateSpeed = md === 'diagram' ? 0.2 : 0.35; }

  // ---- hover: a cell, or (in the diagram) a group --------------------------------------------------------------------------
  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
  labels.domElement.addEventListener('pointermove', (ev) => {
    if (!org || lapse) return;
    const r = labels.domElement.getBoundingClientRect(); mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera); const hit = ray.intersectObjects(meshes, false)[0];
    const show = (txt) => { tip.textContent = txt; tip.style.left = ev.clientX + 14 + 'px'; tip.style.top = ev.clientY + 10 + 'px'; tip.hidden = false; };
    if (!hit) {
      if (m > 0.5 && G) {
        const bh = ray.intersectObjects(blocks.map((b) => b.mesh), false)[0];
        if (bh) {
          const g = G.groups[bh.object.userData.group], inn = links.filter((l) => l.b === g.id).slice(0, 3), out = links.filter((l) => l.a === g.id).slice(0, 3);
          let s = 0; for (const i of g.cells) s += org.net.rf[i];
          return show(`${g.name}: ${g.cells.length} cells, ${(s / g.cells.length).toFixed(1)} Hz now${Number.isFinite(g.hops) ? `, ${g.hops.toFixed(1)} hops from the senses` : ''}\n${linkVal(g, readState)}\nstrongest in:  ${inn.map((l) => `${G.groups[l.a].name} ${l.w.toFixed(1)}`).join(' · ') || '-'}\nstrongest out: ${out.map((l) => `${G.groups[l.b].name} ${l.w.toFixed(1)}`).join(' · ') || '-'}`);
        }
      }
      tip.hidden = true; return;
    }
    const kk = hit.object.userData.kind, idx = hit.instanceId; let cell = -1;
    for (let i = 0; i < org.dev.N; i++) if (where[2 * i] === kk && where[2 * i + 1] === idx) { cell = i; break; }
    if (cell < 0) return;
    const d = org.dev, t = d.type[cell], e = org.net.edges(); let kin = 0, kout = 0; for (let q = 0; q < e.m; q++) { if (e.pre[q] === cell) kout++; if (e.post[q] === cell) kin++; }
    let extra = '';
    if (t === T.EAR) extra = `\near unit ${d.extra[4 * cell]} (${Math.round(55 * 2 ** (d.extra[4 * cell] / 4))} Hz)`;
    if (t === T.INTERO) extra = `\nfeels ${MILIEU_VARS[d.extra[4 * cell]]} as ${d.extra[4 * cell + 1] ? 'deficit' : 'sufficiency'}`;
    if (t === T.PROPRIO) extra = `\nfires on ${d.extra[4 * cell] > 0 ? 'outward' : 'inward'} deformation here`;
    if (d.osc && d.osc[2 * cell] > 0) extra += `\nresonator, natural ${d.osc[2 * cell].toFixed(2)} Hz`;
    const rr = Math.hypot(d.pos[3 * cell], d.pos[3 * cell + 1], d.pos[3 * cell + 2]);
    show(`cell ${cell}: ${TYPE_NAMES[t]}${isReceptor(t) ? '' : d.isI[cell] ? ' (inhibitory)' : ' (excitatory)'}${extra}\narea ${member ? member[cell] + 1 : '-'} · ${G && G.of[cell] >= 0 ? G.groups[G.of[cell]].name + ' · ' : ''}depth ${depthArr ? depthArr[cell] : '-'} hops · radius ${rr.toFixed(2)}\nrate ${org.net.rf[cell].toFixed(1)} Hz now, ${org.net.rbar[cell].toFixed(1)} Hz over 5 s\n${kin} synapses in, ${kout} out${dead[cell] ? '\nLESIONED' : ''}`);
  });
  labels.domElement.addEventListener('pointerleave', () => { tip.hidden = true; });

  return {
    setOrganism, setPartition, frame, startLapse, get lapsing() { return !!lapse; },
    setMode, get mode() { return mode; }, get morph() { return m; },
    setColorBy(c) { colorMode = c; recolor(); }, setThreshold(q) { threshold = q; rebuildEdges(); }, setEdges(on) { showEdges = on; rebuildEdges(); },
    rebuildEdges, controls, camera, get groups() { return G; }, get links() { return links; },
  };
}
