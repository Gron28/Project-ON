// the body shader before and after a change, on the same pinned state: every state in scratch/perf/states.json (the showcase's
// uniforms, scratch/body-states.cjs) plus forced layers (FORCED below), rendered with both shaders from one set of uniforms and
// the same textures (synthetic, seeded), compared pixel by pixel (float RGBA: max diff, PSNR, pixels off by > 1/255) and timed
// (ms per full render, synced by a pixel read). Writes scratch/perf/look/<state>.png (before | after | diff x DIFFK) and
// scratch/perf/ab.json. A: the body shader at BASE (git rev, default perf/visual-preserving); B: being/page/shaders.mjs.
// [SWIFT=1] [SIZE=px] [REPS=n] [ONLY=regex] [DIFFK=20] [NOSHOT=1] ./node_modules/.bin/electron scratch/body-ab.cjs
const { app, BrowserWindow } = require('electron'); const path = require('node:path'); const fs = require('node:fs'); const os = require('node:os');
const { execFileSync } = require('node:child_process');
const ROOT = path.join(__dirname, '..'), OUT = path.join(__dirname, 'perf'), LOOK = path.join(OUT, 'look');
if (process.env.SWIFT) { app.commandLine.appendSwitch('use-angle', 'swiftshader'); app.commandLine.appendSwitch('enable-unsafe-swiftshader'); }
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'on-ab-')));
const BASE = process.env.BASE || 'perf/visual-preserving';
// the page's defaults (being/index.html U) with a few lobes and cymatic modes, when no showcase states were captured
const V4 = (n, f) => ({ a: Array.from({ length: n }, (_, i) => f ? f(i) : [0, 0, 0, 0]) });
const DEFAULTS = { uRes: { v: [1, 1] }, uTime: 12.3, uLook: { v: [.1, -.05] }, uScale: 1.5, uShift: { v: [0, 0] }, uWide: .1,
  uL: V4(12, (i) => i < 4 ? [Math.cos(i * 1.7) * .3, Math.sin(i * 2.3) * .2, Math.sin(i * 1.7) * .2, .08] : [0, 0, 0, 0]), uD: V4(14), uT: V4(44), uTB: V4(4), uS: V4(5), uNoteC: { a: Array.from({ length: 12 }, (_, i) => [.5 + .4 * Math.cos(i), .5 + .4 * Math.cos(i + 2), .5 + .4 * Math.cos(i + 4)]) },
  uRimK: 1, uHaloK: 1, uThinK: 1, uGrain: 0, uFrac: 0, uIntr: 0, uDisp: .02, uSeed: .5, uSplit: 0, uRays: 0, uCool: 0, uCrisp: .3, uSpikeP: 3, uFlowS: 0,
  uNoteTint: .6, uLight: { c: [1, .92, .8] }, uCoreR: .2, uCoreI: .6, uGlow: .5, uK: .2, uChaos: .2, uVar: .05, uSkin: 'tex', uSkinA: 0, uZoom: 1, uEnv: 1, uTurbSpeed: 1, uTurbDetail: 1, uWob: 1,
  uShellR: .36, uRise: 0, uMaskR: .5, uImm: 0, uRiseSeed: { v: [.5, .5, .5, .5] }, uRW: { f: [0, 0, 0, 0, 0, 0, 0, 0] }, uEther: 0, uJour: 0, uPeak: 0, uPhen: { f: [0, 0, 0, 0, 0, 0, 0, 0] }, uCyA: 0, uCyN: 6, uCyPh: 0, uCyAx: { v: [0, 1, 0] },
  uPhenT: 3, uPhenK: 0, uPhenS: 1, uMarb: 0, uIllum: 0, uAbsorption: 0, uJFlow: 2, uJBars: 3.4, uJPal: 0, uThick: .085, uOpen: .2, uHalo: .3,
  uSpikes: 0, uSpikeF: 14, uFilm: 0, uMetal: { c: [.95, .95, .97] }, uRing: 9, uRingA: 0, uRing2: 9, uRing2A: 0, uSparks: 0, uMote: .04, uAwake: 1, uHat: .2, uKick: .3,
  uSH: { f: Array.from({ length: 21 }, (_, i) => .01 * Math.sin(i * 1.3)) }, uJc: { v: [-.2, .6, .2, -.2] }, uJw: 0, uNuc: 0, uNucRot: .3, uTissueC: { c: [.4, 1, .8] },
  uSongTex: 'tex', uSongGlow: 'tex', uSongAmt: 0, uSongRot: 0, uSongGene: 'tex', uDnaOff: { v: [.3, .1, .7] }, uTissue: 'tex', uTissueA: .5, uMorph: 'tex', uMorphA: 0, uMorphD: .03, uHide: 0,
  uStainM: { v: [.15, .88, 1] }, uStainN: { v: [.85, .3, 1] }, uStainC: { v: [.09, .15, .2] }, uStainO: { v: [1, .92, .25] }, uStainA: .6,
  uProp: 0, uAro: .5, uEcho: .2, uPWa: { v: [0, 0, 0, 0] }, uPWb: { v: [0, 0, 0, 0] }, uPWc: { v: [0, 0, 0, 0] }, uCast: { v: [.25, .25, .25, .25] },
  uMid: { a: [0, 0, 0, 0] }, uMw: { a: [1, 0, 0, 0] }, uMatMix: 0, uMatScale: 2.2, uWR: { a: [[0, 1, 0, .6], [.3, .95, 0, .7]] }, uWRA: 0, uSer: V4(48), uSerA: { a: [0, 0, 0] }, uSerB: V4(3),
  uGl: V4(6, () => [0, 0, .05, 0]), uGlR: { a: [0, 0, 0, 0, 0, 0] }, uGlisten: 0, uBeatPulse: .3, uRegP: { a: [0, 0, 0, 0, 0, 0, 0, 0] }, uRegA: 0,
  uCa: 'tex', uCaA: 0, uCaD: .03, uCaN: 128, uCaHueC: { c: [1, 1, 1] }, uCaHue: .45, uCv: 'tex', uCvA: 0 };
// layers forced on top of a showcase state (the plain metal one): each key is a uniform, arrays are written in place
const FORCED = {
  'metal': {},
  'mix-elements': { uMid: [7, 12, 13, 1], uMw: [.4, .3, .2, .1], uMatMix: .55 },
  'mix-stones-gems': { uMid: [20, 30, 25, 33], uMw: [.4, .3, .2, .1], uMatMix: .7 },
  'proposed': { uProp: 1, uPWa: [.3, .2, .3, .2], uPWb: [0, 0, .5, 0], uMid: [6, 9, 12, 7], uMw: [.4, .3, .2, .1], uMatMix: .5 },
  'morph': { uMorphA: 1, uMorphD: .05 },
  'skin': { uSkinA: 1 },
  'cellab': { uCaA: 1, uCaD: .04, uCvA: 1 },
  'surface-all': { uChaos: 1.2, uSpikes: .08, uGrain: 1, uFrac: .8, uIntr: .8, uCyA: .04, uRegA: .05, uRegP: [.3, -.2, .5, .1, -.4, .2, .0, .6], uSongAmt: .5, uIllum: .5, uMarb: .5, uJour: .6 },
  'limbs': { lobes: 1, drops: 1, sats: 1, tendrils: 1 },
  'rings-serpents': { uWRA: 1, serp: 1 },
  'rise': { uRise: 1, uRW: [.6, 0, 0, 0, .4, .3, 0, 0], uEther: .4 },
  'beads': { uHide: 1 },
  'nucleus': { uNuc: 1 },
  'phen': { uPhen: [0, 0, 0, 1, 0, 0, 1, 0], uPhenK: .7, uGlisten: 1 },
};
const PAGE = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000"><canvas id="c"></canvas>
<script type="importmap">{ "imports": { "three": "../../node_modules/three/build/three.module.js" } }</script>
<script type="module">
import * as THREE from 'three';
const A = await import('./shaders.before.mjs'), B = await import('../../being/page/shaders.mjs?' + Date.now());
const { bodyBound } = await import('../../being/page/body-bound.mjs');
const EXT = { shader: { decl: '', screen: '', bubbles: '' } }, DIM = { EXT, NOTES: 12, ND: 14, NT: 4, NS: 5, TP: 11 };
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c') }); renderer.autoClear = true;
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
function smooth(w, h, ch = 4, oct = 5, cube = false) {   // seeded smooth noise in [0,1], wraps in x
  const d = new Float32Array(w * h * 4), G = []; for (let o = 0; o < oct; o++) { const n = 4 << o, g = new Float32Array(n * n * ch); for (let i = 0; i < g.length; i++) g[i] = rnd(); G.push([n, g]); }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) { let s = 0, a = .5, t = 0;
    for (const [n, g] of G) { const fx = x / w * n, fy = y / h * (n - 1), ix = Math.floor(fx), iy = Math.floor(fy), ux = fx - ix, uy = fy - iy, cc = c % ch;
      const v = (i, j) => g[(((j % n) * n) + (i % n)) * ch + cc]; s += a * ((v(ix, iy) * (1 - ux) + v(ix + 1, iy) * ux) * (1 - uy) + (v(ix, iy + 1) * (1 - ux) + v(ix + 1, iy + 1) * ux) * uy); t += a; a *= .55; }
    d[(y * w + x) * 4 + c] = s / t; }
  return d;
}
const tex2 = (w, h, wrap) => { const t = new THREE.DataTexture(smooth(w, h), w, h, THREE.RGBAFormat, THREE.FloatType); t.wrapS = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping; t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true; return t; };
const W = ${+(process.env.SIZE || 384)}, H = W;
const cubeFaces = Array.from({ length: 6 }, () => { const t = new THREE.DataTexture(smooth(64, 64), 64, 64, THREE.RGBAFormat, THREE.FloatType); t.needsUpdate = true; return t; });
const cube = new THREE.CubeTexture(cubeFaces); cube.format = THREE.RGBAFormat; cube.type = THREE.FloatType; cube.generateMipmaps = true; cube.minFilter = THREE.LinearMipmapLinearFilter; cube.magFilter = THREE.LinearFilter; cube.needsUpdate = true;
const TEX = { uSkin: tex2(256, 128, true), uTissue: tex2(128, 64, true), uSongTex: tex2(48, 24, true), uSongGlow: tex2(48, 24, true), uSongGene: tex2(48, 24, true), uCa: tex2(384, 256, false), uCv: tex2(W >> 1, H >> 1, false), uMorph: cube };
const toVal = (k, x) => { if (x == null || x === 'tex') return TEX[k] || null; if (typeof x === 'number') return x;
  if (x.c) return new THREE.Color(...x.c); if (x.v) return x.v.length === 2 ? new THREE.Vector2(...x.v) : x.v.length === 3 ? new THREE.Vector3(...x.v) : new THREE.Vector4(...x.v);
  if (x.f) return Float32Array.from(x.f); if (x.a) return x.a.map((y) => typeof y === 'number' ? y : y.length === 3 ? new THREE.Vector3(...y) : new THREE.Vector4(...y)); };
const U = {}; const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const mk = (S) => new THREE.ShaderMaterial({ uniforms: U, depthTest: false, depthWrite: false, vertexShader: 'void main() { gl_Position = vec4( position.xy, 0., 1. ); }', fragmentShader: S.bodyFragment(DIM) });
const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); scene.add(mesh);
const MA = mk(A), MB = mk(B);
const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType }), px1 = new Float32Array(4);
const draw = (m) => { mesh.material = m; renderer.setRenderTarget(rt); renderer.render(scene, cam); };
const read = () => { const o = new Float32Array(W * H * 4); renderer.readRenderTargetPixels(rt, 0, 0, W, H, o); return o; };
function setState(base, force) {
  for (const k in U) delete U[k];
  for (const [k, x] of Object.entries(base)) U[k] = { value: toVal(k, x) };
  U.uRes.value = new THREE.Vector2(W, H); U.uBound = { value: 1.45 };
  for (const [k, v] of Object.entries(force || {})) {
    if (k === 'lobes') for (let i = 0; i < 12; i++) { const a = i * 2.4, r = .33; U.uL.value[i].set(Math.cos(a) * r, Math.sin(i * 1.3) * .25, Math.sin(a) * r * .6, i < 6 ? .07 + .01 * i : 0); }
    else if (k === 'drops') for (let i = 0; i < 14; i++) U.uD.value[i].set(Math.sin(i * 1.7) * .4, .45 - i * .06, Math.cos(i * 1.1) * .2, i < 5 ? .03 : 0);
    else if (k === 'sats') for (let i = 0; i < 5; i++) U.uS.value[i].set(Math.cos(i * 1.26) * .55, Math.sin(i * 2.1) * .3, Math.sin(i * 1.26) * .3, i < 3 ? .04 : 0);
    else if (k === 'tendrils') for (let i = 0; i < 4; i++) { const dir = new THREE.Vector3(Math.cos(i * 1.57 + .4), Math.sin(i * 1.1) * .6, Math.sin(i * 1.57 + .4)).normalize(); const ctr = new THREE.Vector3();
      for (let j = 0; j < 11; j++) { const s = .3 + j * .045, p = dir.clone().multiplyScalar(s).add(new THREE.Vector3(0, Math.sin(j * .7 + i) * .05, 0)); U.uT.value[11 * i + j].set(p.x, p.y, p.z, .035 * (1 - j / 12)); ctr.add(p); }
      ctr.multiplyScalar(1 / 11); U.uTB.value[i].set(ctr.x, ctr.y, ctr.z, .45); }
    else if (k === 'serp') { for (let s = 0; s < 2; s++) { for (let i = 0; i < 16; i++) { const a = i * .25 + s * 3, r = .62; U.uSer.value[s * 16 + i].set(Math.cos(a) * r, Math.sin(a * 2) * .15 + s * .1, Math.sin(a) * r, .025 * (1 - i / 18)); }
      U.uSerB.value[s].set(0, s * .1, 0, .8); U.uSerA.value[s] = 1; } }
    else if (Array.isArray(v)) { const t = U[k].value; if (t && t.fromArray && !Array.isArray(t)) t.fromArray(v); else if (ArrayBuffer.isView(t)) t.set(v); else U[k].value = v.slice(); }
    else U[k].value = v;
  }
}
function cmp(a, b) { let mx = 0, se = 0, n1 = 0, n2 = 0, at = 0;
  for (let i = 0; i < a.length; i++) { const x = Math.min(1, Math.max(0, a[i])), y = Math.min(1, Math.max(0, b[i])), d = Math.abs(x - y); if (d > mx) { mx = d; at = i >> 2; } se += d * d; }
  for (let i = 0; i < a.length; i += 4) { let m = 0; for (let c = 0; c < 4; c++) m = Math.max(m, Math.abs(Math.min(1, Math.max(0, a[i + c])) - Math.min(1, Math.max(0, b[i + c])))); if (m > 1.5 / 255) n1++; if (m > 4.5 / 255) n2++; }
  const mse = se / a.length; return { max: +mx.toFixed(4), maxAt: [at % W, Math.floor(at / W)], psnr: mse ? +(10 * Math.log10(1 / mse)).toFixed(1) : 99, off1: n1, off4: n2 }; }
function png(a, b, k) { const cv = document.createElement('canvas'); cv.width = W * 3; cv.height = H; const g = cv.getContext('2d'), im = g.createImageData(W * 3, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const s = ((H - 1 - y) * W + x) * 4;
    for (let c = 0; c < 3; c++) { const va = Math.min(1, Math.max(0, a[s + c])), vb = Math.min(1, Math.max(0, b[s + c]));
      im.data[(y * W * 3 + x) * 4 + c] = va * 255; im.data[(y * W * 3 + x + W) * 4 + c] = vb * 255; im.data[(y * W * 3 + x + 2 * W) * 4 + c] = Math.min(255, Math.abs(va - vb) * 255 * k); }
    for (let j = 0; j < 3; j++) im.data[(y * W * 3 + x + j * W) * 4 + 3] = 255; }
  g.putImageData(im, 0, 0); return cv.toDataURL('image/png').split(',')[1]; }
const time = (m, n) => { draw(m); renderer.readRenderTargetPixels(rt, 0, 0, 1, 1, px1); const t0 = performance.now(); for (let i = 0; i < n; i++) { draw(m); renderer.readRenderTargetPixels(rt, 0, 0, 1, 1, px1); } return (performance.now() - t0) / n; };
window.__ab = (base, force, o) => { setState(base, force); U.uBound.value = bodyBound(U); draw(MA); const a = read(); draw(MB); const b = read();
  const r = cmp(a, b); if (o.reps) { r.msA = +time(MA, o.reps).toFixed(2); r.msB = +time(MB, o.reps).toFixed(2); } if (o.shot) r.png = png(a, b, o.k); return r; };
window.__ready = true;
</script>`;
app.whenReady().then(async () => {
  fs.mkdirSync(LOOK, { recursive: true });
  const before = execFileSync('git', ['show', `${BASE}:being/page/shaders.mjs`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 })
    .replace("'../skin/lenia.mjs'", "'../../being/skin/lenia.mjs'").replace("'../cellab/gpu.mjs'", "'../../being/cellab/gpu.mjs'");
  fs.writeFileSync(path.join(OUT, 'shaders.before.mjs'), before); fs.writeFileSync(path.join(OUT, 'ab.html'), PAGE);
  const SF = path.join(OUT, 'states.json'), states = fs.existsSync(SF) ? JSON.parse(fs.readFileSync(SF, 'utf8')) : [];
  const plain = states.find((s) => /liquid metal|metal/i.test(s.caption) && !/beads/i.test(s.caption)) || { U: DEFAULTS };
  const cases = [...states.map((s) => ({ name: 's' + String(s.step).padStart(2, '0') + '-' + s.caption.replace(/[^a-z0-9]+/gi, '-').slice(0, 30).toLowerCase(), base: s.U })),
    ...Object.entries(FORCED).map(([n, f]) => ({ name: 'f-' + n, base: plain.U, force: f }))].filter((c) => !process.env.ONLY || new RegExp(process.env.ONLY).test(c.name));
  const w = new BrowserWindow({ show: true, x: -3000, y: 0, width: 200, height: 200, skipTaskbar: true, focusable: false, webPreferences: { contextIsolation: false, sandbox: false, backgroundThrottling: false } });
  w.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 3 || /error/i.test(e.message)) console.log('[page]', String(e.message).slice(0, 2000)); });
  await w.loadFile(path.join(OUT, 'ab.html'));
  for (let i = 0; i < 100 && !(await w.webContents.executeJavaScript('!!window.__ready')); i++) await new Promise((r) => setTimeout(r, 300));
  const reps = +(process.env.REPS ?? (process.env.SWIFT ? 1 : 20)), res = [];
  let sa = 0, sb = 0, worst = null;
  for (const c of cases) {
    const r = await w.webContents.executeJavaScript(`window.__ab(${JSON.stringify(c.base)}, ${JSON.stringify(c.force || null)}, { reps: ${reps}, shot: ${!process.env.NOSHOT}, k: ${+(process.env.DIFFK || 20)} })`);
    if (r.png) { fs.writeFileSync(path.join(LOOK, c.name + '.png'), Buffer.from(r.png, 'base64')); delete r.png; }
    res.push({ name: c.name, ...r }); sa += r.msA || 0; sb += r.msB || 0; if (!worst || r.psnr < worst.psnr) worst = { name: c.name, ...r };
    console.log(c.name.padEnd(42), `max ${r.max}  psnr ${r.psnr}  off>1 ${r.off1}  off>4 ${r.off4}`, reps ? `  ms ${r.msA} -> ${r.msB}` : '');
  }
  if (reps) console.log(`total ms ${sa.toFixed(1)} -> ${sb.toFixed(1)} (${(100 * sb / sa).toFixed(1)}%)`);
  console.log('worst', JSON.stringify(worst));
  fs.writeFileSync(path.join(OUT, 'ab.json'), JSON.stringify(res, null, 1));
  app.quit();
});
