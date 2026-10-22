// lab/prototypes/organism/body.mjs - the organism's body as it would be seen: the physics body (being/physics.mjs:
// displacement, the five l=2 surface modes, spin) with its skin coloured by the chromatophores, each pigment cell
// spreading its colour over the skin around it as it expands. Reads the organism, never drives it.

import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export function createBody(host) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio)); host.appendChild(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20); camera.position.set(0, 0, 4.6);
  const geo = mergeVertices(new THREE.IcosahedronGeometry(1, 5).deleteAttribute('normal').deleteAttribute('uv')), n = geo.attributes.position.count;   // indexed: smooth normals
  const unit = Float32Array.from(geo.attributes.position.array); for (let i = 0; i < n; i++) { const l = Math.hypot(unit[3 * i], unit[3 * i + 1], unit[3 * i + 2]); unit[3 * i] /= l; unit[3 * i + 1] /= l; unit[3 * i + 2] /= l; }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(3 * n), 3));
  const mat = new THREE.ShaderMaterial({
    vertexShader: 'attribute vec3 color; varying vec3 c; varying vec3 nn; varying vec3 vp; void main(){ c = color; nn = normalize(normalMatrix * normal); vec4 p = modelViewMatrix * vec4(position,1.); vp = p.xyz; gl_Position = projectionMatrix * p; }',
    fragmentShader: 'varying vec3 c; varying vec3 nn; varying vec3 vp; void main(){ vec3 v = normalize(-vp), l = normalize(vec3(.4,.7,.6)); float d = max(0., dot(nn, l)), s = pow(max(0., dot(reflect(-l, nn), v)), 30.), f = pow(1. - max(0., dot(nn, v)), 2.5);\n gl_FragColor = vec4(c * (.35 + .75 * d) + vec3(.9,.95,1.) * (.35 * s + .12 * f), 1.); }',
  });
  const mesh = new THREE.Mesh(geo, mat); scene.add(mesh);
  let org = null, near = null, hueCol = [];
  const K = 4;
  function setOrganism(o) {
    org = o; const d = o.dev, ch = o.C.chrom, m = ch.length;
    const cu = Array.from(ch, (i) => { const l = Math.hypot(d.pos[3 * i], d.pos[3 * i + 1], d.pos[3 * i + 2]); return [d.pos[3 * i] / l, d.pos[3 * i + 1] / l, d.pos[3 * i + 2] / l]; });
    hueCol = Array.from(ch, (i) => new THREE.Color().setHSL((0.55 + 0.8 * d.extra[4 * i]) % 1, 0.85, 0.55));
    near = { idx: new Int16Array(n * K), w: new Float32Array(n * K) };
    for (let v = 0; v < n; v++) {
      const ds = cu.map((u, k) => [Math.acos(Math.max(-1, Math.min(1, u[0] * unit[3 * v] + u[1] * unit[3 * v + 1] + u[2] * unit[3 * v + 2]))), k]).sort((a, b) => a[0] - b[0]).slice(0, K);
      ds.forEach(([a, k], j) => { near.idx[v * K + j] = k; near.w[v * K + j] = Math.exp(-(a * a) / 0.12); });
    }
    void m;
  }
  const rot = new THREE.Quaternion(), dq = new THREE.Quaternion(), ax = new THREE.Vector3();
  function frame(dt) {
    const w = host.clientWidth, h = host.clientHeight;
    if (renderer.domElement.width !== Math.round(w * renderer.getPixelRatio())) { renderer.setSize(w, h, false); renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px'; camera.aspect = w / h; camera.updateProjectionMatrix(); }
    if (!org) return;
    const ph = org.phys, md = ph.modes, ex = org.act, ch = org.C.chrom, pos = geo.attributes.position.array, col = geo.attributes.color.array;
    for (let v = 0; v < n; v++) {
      const x = unit[3 * v], y = unit[3 * v + 1], z = unit[3 * v + 2];
      const def = md[0] * x * y + md[1] * y * z + md[2] * 0.5 * (2 * z * z - x * x - y * y) + md[3] * x * z + md[4] * 0.5 * (x * x - y * y);
      const r = 1 + 0.35 * def; pos[3 * v] = x * r + 0.35 * ph.pos[0]; pos[3 * v + 1] = y * r + 0.35 * ph.pos[1]; pos[3 * v + 2] = z * r + 0.35 * ph.pos[2];
      let cr = 0, cg = 0, cb = 0;
      for (let j = 0; j < K; j++) { const k = near.idx[v * K + j], a = near.w[v * K + j] * ex[ch[k]] * 8, c = hueCol[k]; cr += a * c.r; cg += a * c.g; cb += a * c.b; }
      col[3 * v] = 0.07 + 0.9 * (1 - Math.exp(-cr)); col[3 * v + 1] = 0.08 + 0.9 * (1 - Math.exp(-cg)); col[3 * v + 2] = 0.095 + 0.9 * (1 - Math.exp(-cb));   // pigment saturates
    }
    geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true; geo.computeVertexNormals();
    const om = ph.omega, wl = Math.hypot(om[0], om[1], om[2]);
    if (wl > 1e-5) { dq.setFromAxisAngle(ax.set(om[0] / wl, om[1] / wl, om[2] / wl), wl * dt); rot.premultiply(dq); mesh.quaternion.copy(rot); }
    renderer.render(scene, camera);
  }
  return { setOrganism, frame };
}
