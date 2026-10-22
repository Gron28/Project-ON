// lab/prototypes/organism/view.mjs - the organism's nervous system in its body: every cell at its developed position
// (shape by kind, colour by area / kind / depth / sign), synapses as lines weighted by strength (weak ones fade, links
// between areas bundled through the areas' centres), firing as glow. Also replays development as a time-lapse.
// Reads the organism, never drives it.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { T, TYPE_NAMES, isReceptor, MILIEU_VARS } from '../../organism/develop.mjs';

const add = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false };
const PAL = [0xe8a33d, 0x3fb8d0, 0xd95f8f, 0x8fd16a, 0x9d7cf0, 0xf07a4a, 0x4fd6a0, 0xe0d050, 0x5f8ff0, 0xd08ad8, 0xa0c04a, 0xf0a0a0];
export const TYPE_COL = { [T.EAR]: 0xf0b048, [T.ONSET]: 0xffe070, [T.ROUGH]: 0xff6b6b, [T.SUB]: 0x4f9cff, [T.PROPRIO]: 0x8fd16a, [T.INTER]: 0xc9ced6, [T.INTERO]: 0xff8fb1, [T.MOD]: 0xc58cff, [T.MOTOR]: 0xff7a3d, [T.CHROM]: 0x3fd0c9 };
const I_COL = 0x5a7dff;
const c01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const communityColor = (c) => new THREE.Color(c < PAL.length ? PAL[c] : 0x59606a);
// geometry per kind: receptors are tetrahedra, interneurons spheres, interoceptors octahedra, modulators icosahedra,
// motors cubes, chromatophores discs
const KIND = (t) => (isReceptor(t) ? 0 : t === T.INTER ? 1 : t === T.INTERO ? 2 : t === T.MOD ? 3 : t === T.MOTOR ? 4 : 5);
const GEOS = [new THREE.TetrahedronGeometry(0.026), new THREE.SphereGeometry(0.017, 10, 8), new THREE.OctahedronGeometry(0.03), new THREE.IcosahedronGeometry(0.036), new THREE.BoxGeometry(0.036, 0.036, 0.036), new THREE.CylinderGeometry(0.034, 0.034, 0.008, 14)];

export function createView(host, tip) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.setClearColor(0x06080b);
  host.appendChild(renderer.domElement);
  const labels = new CSS2DRenderer(); labels.domElement.className = 'labels'; host.appendChild(labels.domElement);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1, 0.05, 50);
  camera.position.set(0.4, 0.5, 3.4);
  const controls = new OrbitControls(camera, labels.domElement); controls.enableDamping = true; controls.autoRotate = true; controls.autoRotateSpeed = 0.35;
  // the body: a faint shell and the nucleus
  const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), new THREE.MeshBasicMaterial({ color: 0x2a3644, opacity: 0.16, side: THREE.BackSide, ...add }));
  const rim = new THREE.Mesh(new THREE.SphereGeometry(1.002, 48, 32), new THREE.ShaderMaterial({ ...add, uniforms: {},
    vertexShader: 'varying float f; void main(){ vec3 n = normalize(normalMatrix * normal); vec4 p = modelViewMatrix * vec4(position,1.); f = pow(1. - abs(dot(n, normalize(-p.xyz))), 3.); gl_Position = projectionMatrix * p; }',
    fragmentShader: 'varying float f; void main(){ gl_FragColor = vec4(vec3(.25,.33,.42) * f, 1.); }' }));
  const nucleus = new THREE.Mesh(new THREE.SphereGeometry(0.12, 24, 16), new THREE.MeshBasicMaterial({ color: 0x1b2430, opacity: 0.6, transparent: true }));
  scene.add(shell, rim, nucleus);

  let org = null, meshes = [], where = null, base = [], member = null, depthArr = null, mode = 'community', edges = null, edgeInfo = null, labelObjs = [];
  let lapse = null, lapseObjs = [], threshold = 0.35, showEdges = true, dead = null;
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), SC = new THREE.Vector3(), P = new THREE.Vector3(), C = new THREE.Color(), UP = new THREE.Vector3(0, 1, 0);
  const halo = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ ...add }), 1024);
  halo.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(halo);

  function clear() {
    for (const m of meshes) { scene.remove(m); m.material.dispose(); m.dispose(); }
    meshes = []; if (edges) { scene.remove(edges); edges.geometry.dispose(); edges = null; }
    for (const o of labelObjs) { scene.remove(o); o.element.remove(); } labelObjs = [];
    clearLapse();
  }
  function setOrganism(o) {
    clear(); org = o; const d = o.dev, N = d.N;
    where = new Int32Array(2 * N); const counts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < N; i++) { const k = KIND(d.type[i]); where[2 * i] = k; where[2 * i + 1] = counts[k]++; }
    meshes = GEOS.map((g, k) => { const m = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial(), Math.max(1, counts[k])); m.count = counts[k]; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.userData.kind = k; scene.add(m); return m; });
    for (let i = 0; i < N; i++) placeCell(i, d.pos[3 * i], d.pos[3 * i + 1], d.pos[3 * i + 2], 1);
    meshes.forEach((m) => { m.instanceMatrix.needsUpdate = true; });
    base = Array.from({ length: N }, () => new THREE.Color());
    member = null; depthArr = null; dead = o.net.dead;
  }
  function placeCell(i, x, y, z, s) {
    const d = org.dev, k = where[2 * i];
    if (k === 5) { const p = new THREE.Vector3(x, y, z).normalize(); Q.setFromUnitVectors(UP, p); } else Q.identity();
    M4.compose(P.set(x, y, z), Q, SC.set(s, s, s)); meshes[k].setMatrixAt(where[2 * i + 1], M4);
    void d;
  }
  function colorOf(i) {
    const d = org.dev, t = d.type[i];
    if (mode === 'type') return C.set(t === T.INTER && d.isI[i] ? I_COL : TYPE_COL[t]);
    if (mode === 'ei') return C.set(isReceptor(t) ? 0xe8e6e0 : d.isI[i] ? I_COL : 0xf0a040);
    if (mode === 'depth') { const h = depthArr ? depthArr[i] : -1; return h < 0 ? C.set(0x3a4048) : C.setHSL(0.62 - 0.62 * Math.min(1, h / 6), 0.8, 0.55); }
    return member ? communityColor(member[i]) : C.set(TYPE_COL[t]);
  }
  function recolor() { if (!org) return; for (let i = 0; i < org.dev.N; i++) base[i].copy(colorOf(i)); if (edges) rebuildEdges(); }

  /** areas found by community detection, and depth from the senses */
  function setPartition(m, dep) {
    member = m; depthArr = dep; recolor(); rebuildEdges(); placeLabels();
  }
  function centroids() {
    const d = org.dev, cs = new Map();
    for (let i = 0; i < d.N; i++) { const c = member ? member[i] : 0; if (!cs.has(c)) cs.set(c, { x: 0, y: 0, z: 0, n: 0, types: new Array(10).fill(0) }); const o = cs.get(c); o.x += d.pos[3 * i]; o.y += d.pos[3 * i + 1]; o.z += d.pos[3 * i + 2]; o.n++; o.types[d.type[i]]++; }
    for (const o of cs.values()) { o.x /= o.n; o.y /= o.n; o.z /= o.n; }
    return cs;
  }
  function placeLabels() {
    for (const o of labelObjs) { scene.remove(o); o.element.remove(); } labelObjs = [];
    if (!member || lapse) return;
    const cs = centroids();
    [...cs.entries()].filter(([, o]) => o.n >= 12).sort((a, b) => b[1].n - a[1].n).slice(0, 8).forEach(([c, o]) => {
      const top = o.types.map((n, t) => [n, t]).filter(([n]) => n > 0).sort((a, b) => b[0] - a[0]).slice(0, 2).map(([n, t]) => `${TYPE_NAMES[t]} ${Math.round(100 * n / o.n)}%`).join(', ');
      const el = document.createElement('div'); el.className = 'area'; el.style.color = '#' + communityColor(c).getHexString();
      el.textContent = `area ${c + 1} · ${o.n} · ${top}`;
      const obj = new CSS2DObject(el), p = new THREE.Vector3(o.x, o.y, o.z), l = p.length();
      obj.position.copy(l > 0.05 ? p.multiplyScalar(1.12 / l) : p.set(0, 1.12, 0)); scene.add(obj); labelObjs.push(obj);
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), new THREE.MeshBasicMaterial({ color: communityColor(c) })); dot.position.set(o.x, o.y, o.z); scene.add(dot);
      const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(o.x, o.y, o.z), obj.position.clone().multiplyScalar(0.97)]), new THREE.LineBasicMaterial({ color: communityColor(c), transparent: true, opacity: 0.45 }));
      scene.add(ln); labelObjs.push(Object.assign(dot, { element: document.createElement('i') }), Object.assign(ln, { element: document.createElement('i') }));
    });
  }

  // ---- synapses: weighted lines; links between areas bend through both areas' centres (bundling) --------------------------
  function rebuildEdges() {
    if (edges) { scene.remove(edges); edges.geometry.dispose(); edges = null; }
    if (!org || !showEdges || lapse) return;
    const d = org.dev, e = org.net.edges(), cs = centroids(), pos = d.pos;
    const ws = Array.from(e.w).sort((a, b) => a - b), wRef = ws[Math.floor(0.95 * (ws.length - 1))] || 1, wMin = ws[Math.floor(threshold * (ws.length - 1))] || 0;
    const P0 = [], COL = [], PRE = [], AMP = [];
    const pushSeg = (a, b, pre, amp) => { P0.push(a[0], a[1], a[2], b[0], b[1], b[2]); PRE.push(pre, pre); AMP.push(amp, amp); };
    for (let k = 0; k < e.m; k++) {
      const w = e.w[k]; if (w < wMin) continue;
      const i = e.pre[k], j = e.post[k], a = [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]], b = [pos[3 * j], pos[3 * j + 1], pos[3 * j + 2]];
      const amp = c01(w / wRef) * (d.isI[i] ? 0.8 : 1);
      const ci = member ? member[i] : 0, cj = member ? member[j] : 0;
      if (ci === cj) { pushSeg(a, b, i, amp * 0.9); continue; }
      const A = cs.get(ci), B = cs.get(cj), c1 = [a[0] + 0.75 * (A.x - a[0]), a[1] + 0.75 * (A.y - a[1]), a[2] + 0.75 * (A.z - a[2])], c2 = [b[0] + 0.75 * (B.x - b[0]), b[1] + 0.75 * (B.y - b[1]), b[2] + 0.75 * (B.z - b[2])];
      let prev = a;
      for (let s = 1; s <= 6; s++) {
        const t = s / 6, u = 1 - t, q = [0, 1, 2].map((x) => u * u * u * a[x] + 3 * u * u * t * c1[x] + 3 * u * t * t * c2[x] + t * t * t * b[x]);
        pushSeg(prev, q, i, amp * 0.6); prev = q;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P0, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(P0.length), 3).setUsage(THREE.DynamicDrawUsage));
    edges = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, ...add }));
    edgeInfo = { pre: Int32Array.from(PRE), amp: Float32Array.from(AMP) };
    scene.add(edges);
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
    lapse = { t: 0, dur: seconds };
    // axons grow along their recorded paths
    const P0 = [], TT = [], TI = [];
    for (const a of d.axons) {
      const n = a.pts.length / 3, col = new THREE.Color(TYPE_COL[d.type[a.cell]]);
      for (let k = 1; k < n; k++) {
        for (const q of [k - 1, k]) { P0.push(a.pts[3 * q], a.pts[3 * q + 1], a.pts[3 * q + 2]); TT.push(a.t0 + (a.t1 - a.t0) * 0.9 * (k / (n - 1))); TI.push(col.r, col.g, col.b); }
      }
    }
    const ga = new THREE.BufferGeometry(); ga.setAttribute('position', new THREE.Float32BufferAttribute(P0, 3)); ga.setAttribute('t', new THREE.Float32BufferAttribute(TT, 1)); ga.setAttribute('tint', new THREE.Float32BufferAttribute(TI, 3));
    const ax = new THREE.LineSegments(ga, revealMat(0x334455, 0.22));
    // synapses appear when the growth cone passes a dendrite
    const S0 = [], ST = [], SI = [];
    for (let k = 0; k < d.syn.pre.length; k++) {
      const i = d.syn.pre[k], j = d.syn.post[k], c = new THREE.Color(d.isI[i] ? I_COL : 0xf0a040);
      S0.push(d.pos[3 * i], d.pos[3 * i + 1], d.pos[3 * i + 2], d.pos[3 * j], d.pos[3 * j + 1], d.pos[3 * j + 2]); ST.push(d.syn.t[k], d.syn.t[k]); SI.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    const gs = new THREE.BufferGeometry(); gs.setAttribute('position', new THREE.Float32BufferAttribute(S0, 3)); gs.setAttribute('t', new THREE.Float32BufferAttribute(ST, 1)); gs.setAttribute('tint', new THREE.Float32BufferAttribute(SI, 3));
    const sy = new THREE.LineSegments(gs, revealMat(0x000000, 0.12));
    lapseObjs = [ax, sy]; scene.add(ax, sy);
    if (edges) { scene.remove(edges); edges.geometry.dispose(); edges = null; }
    for (const o of labelObjs) { scene.remove(o); o.element.remove(); } labelObjs = [];
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
    meshes.forEach((m) => { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; });
    halo.count = 0;
    if (t >= 1 && (lapse.hold = (lapse.hold || 0) + dt) > 2) { const o = org; clearLapse(); setOrganism(o); setPartition(member, depthArr); }
  }

  // ---- per frame ------------------------------------------------------------------------------------------------------------
  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    if (renderer.domElement.width !== Math.round(w * renderer.getPixelRatio()) || renderer.domElement.height !== Math.round(h * renderer.getPixelRatio())) { renderer.setSize(w, h, false); renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px'; labels.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  }
  function frame(dt) {
    resize(); controls.update();
    if (org && lapse) lapseFrame(dt);
    else if (org) {
      const d = org.dev, rf = org.net.rf, N = d.N; let h = 0;
      for (let i = 0; i < N; i++) {
        const g = dead[i] ? 0 : c01(rf[i] / 25), c = base[i];
        meshes[where[2 * i]].setColorAt(where[2 * i + 1], C.copy(c).multiplyScalar(dead[i] ? 0.12 : 0.45 + 0.75 * g));
        if (g > 0.15 && h < 1024) { const s = 0.016 + 0.022 * g; M4.compose(P.set(d.pos[3 * i], d.pos[3 * i + 1], d.pos[3 * i + 2]), Q.identity(), SC.set(s, s, s)); halo.setMatrixAt(h, M4); halo.setColorAt(h, C.copy(c).multiplyScalar(0.16 * g)); h++; }
      }
      halo.count = h; halo.instanceMatrix.needsUpdate = true; if (halo.instanceColor) halo.instanceColor.needsUpdate = true;
      meshes.forEach((m) => { if (m.instanceColor) m.instanceColor.needsUpdate = true; });
      if (edges) {
        const col = edges.geometry.attributes.color.array, pre = edgeInfo.pre, amp = edgeInfo.amp;
        for (let v = 0; v < pre.length; v++) { const i = pre[v], g = dead[i] ? 0 : 0.25 + 0.75 * c01(rf[i] / 20), c = base[i], a = amp[v] * g * 0.5; col[3 * v] = c.r * a; col[3 * v + 1] = c.g * a; col[3 * v + 2] = c.b * a; }
        edges.geometry.attributes.color.needsUpdate = true;
      }
    }
    renderer.render(scene, camera); labels.render(scene, camera);
  }

  // ---- hover --------------------------------------------------------------------------------------------------------------
  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
  labels.domElement.addEventListener('pointermove', (ev) => {
    if (!org) return;
    const r = labels.domElement.getBoundingClientRect(); mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera); const hit = ray.intersectObjects(meshes, false)[0];
    if (!hit) { tip.hidden = true; return; }
    const k = hit.object.userData.kind, idx = hit.instanceId; let cell = -1;
    for (let i = 0; i < org.dev.N; i++) if (where[2 * i] === k && where[2 * i + 1] === idx) { cell = i; break; }
    if (cell < 0) return;
    const d = org.dev, t = d.type[cell], e = org.net.edges(); let kin = 0, kout = 0; for (let q = 0; q < e.m; q++) { if (e.pre[q] === cell) kout++; if (e.post[q] === cell) kin++; }
    let extra = '';
    if (t === T.EAR) extra = `\near unit ${d.extra[4 * cell]} (${Math.round(55 * 2 ** (d.extra[4 * cell] / 4))} Hz)`;
    if (t === T.INTERO) extra = `\nfeels ${MILIEU_VARS[d.extra[4 * cell]]} as ${d.extra[4 * cell + 1] ? 'deficit' : 'sufficiency'}`;
    if (t === T.PROPRIO) extra = `\nfires on ${d.extra[4 * cell] > 0 ? 'outward' : 'inward'} deformation here`;
    tip.textContent = `cell ${cell}: ${TYPE_NAMES[t]}${isReceptor(t) ? '' : d.isI[cell] ? ' (inhibitory)' : ' (excitatory)'}${extra}\narea ${member ? member[cell] + 1 : '-'} · depth ${depthArr ? depthArr[cell] : '-'} hops from the senses\nrate ${org.net.rf[cell].toFixed(1)} Hz now, ${org.net.rbar[cell].toFixed(1)} Hz over 5 s\n${kin} synapses in, ${kout} out${dead[cell] ? '\nLESIONED' : ''}`;
    tip.style.left = ev.clientX + 14 + 'px'; tip.style.top = ev.clientY + 10 + 'px'; tip.hidden = false;
  });
  labels.domElement.addEventListener('pointerleave', () => { tip.hidden = true; });

  return {
    setOrganism, setPartition, frame, startLapse, get lapsing() { return !!lapse; },
    setMode(m) { mode = m; recolor(); }, setThreshold(q) { threshold = q; rebuildEdges(); }, setEdges(on) { showEdges = on; rebuildEdges(); },
    rebuildEdges, controls, camera,
  };
}
