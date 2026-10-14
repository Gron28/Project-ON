// being/swarm-gpu.mjs - the swarm the body bursts into, on WebGPU (compute + render) in its own transparent canvas laid
// over the WebGL body. Particle life in 3D with a body plan (organism.mjs): grid binning by counting sort, 27-cell
// neighbour search (cost follows neighbours, not particles; lab/research/particles.md measured 32k at ~1.3 ms on this
// GPU), a stiff collision core, Mohr's force for the species matrix, radial springs and swirl for the body plan.
// Each particle is drawn as a small metal ball: a camera-facing quad shaded as a sphere with the blob's own environment
// (env() ported from the body shader), tinted by its species, with a soft additive glow for glowing species.
// Modes: 'organism' (the burst: the body becomes a cell of thousands of balls) and 'jets' (a few hundred balls thrown
// from the surface that fall back and fade, before a burst).

import { hsl, anchorsAt } from './organism.mjs';

const SIM_WGSL = /* wgsl */`
struct Part { pos: vec4f, vel: vec4f };
struct Sim { a: vec4f, b: vec4f, c: vec4f, d: vec4f, e: vec4f };
// a: n, g, S, dt   b: rmax, beta, force, friction factor   c: axis xyz, gather   d: pulse, time, half box, collision   e: mode, speed, life, -
@group(0) @binding(0) var<uniform> u: Sim;
@group(0) @binding(1) var<storage, read_write> pin: array<Part>;
@group(0) @binding(2) var<storage, read_write> pout: array<Part>;
@group(0) @binding(3) var<storage, read_write> cnt: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> start: array<u32>;
@group(0) @binding(5) var<storage, read_write> rank: array<u32>;
@group(0) @binding(6) var<storage, read> mat: array<f32, 64>;
@group(0) @binding(7) var<storage, read> sp: array<vec4f, 24>;   // per species: (r, k, swirl, size), (rgb, glow), (anchor xyz, flatten)
fn G() -> i32 { return i32(u.a.y); }
fn cellOf(p: vec3f) -> vec3i { return clamp(vec3i(floor((p + vec3f(u.d.z)) / u.b.x)), vec3i(0), vec3i(G() - 1)); }
fn idx(c: vec3i) -> u32 { let g = G(); return u32(c.x + g * (c.y + g * c.z)); }
@compute @workgroup_size(256) fn clear(@builtin(global_invocation_id) id: vec3u) { let g = u32(G()); if (id.x < g * g * g) { atomicStore(&cnt[id.x], 0u); } }
@compute @workgroup_size(128) fn count(@builtin(global_invocation_id) id: vec3u) { let i = id.x; if (i >= u32(u.a.x)) { return; } rank[i] = atomicAdd(&cnt[idx(cellOf(pin[i].pos.xyz))], 1u); }
var<workgroup> part: array<u32, 256>;
@compute @workgroup_size(256) fn scan(@builtin(local_invocation_id) lid: vec3u) {
  let g = u32(G()); let C = g * g * g; let per = (C + 255u) / 256u; let b = lid.x * per;
  var s = 0u; for (var k = 0u; k < per; k++) { if (b + k < C) { s += atomicLoad(&cnt[b + k]); } }
  part[lid.x] = s; workgroupBarrier();
  if (lid.x == 0u) { var acc = 0u; for (var k = 0u; k < 256u; k++) { let v = part[k]; part[k] = acc; acc += v; } }
  workgroupBarrier();
  var acc = part[lid.x]; for (var k = 0u; k < per; k++) { if (b + k < C) { start[b + k] = acc; acc += atomicLoad(&cnt[b + k]); } }
}
@compute @workgroup_size(128) fn scatter(@builtin(global_invocation_id) id: vec3u) { let i = id.x; if (i >= u32(u.a.x)) { return; } let p = pin[i]; pout[start[idx(cellOf(p.pos.xyz))] + rank[i]] = p; }
// Mohr's particle-life force on r in units of rmax, with a stiff collision core
fn F(r: f32, a: f32) -> f32 {
  let b = u.b.y; var c = 0.0;
  if (r < 0.25) { c = -u.d.w * (1.0 - r / 0.25); }
  if (r < b) { return c + r / b - 1.0; }
  if (r < 1.0) { return a * (1.0 - abs(2.0 * r - 1.0 - b) / (1.0 - b)); }
  return 0.0;
}
@compute @workgroup_size(128) fn force(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x; if (i >= u32(u.a.x)) { return; }
  let me = pout[i]; let s = u32(me.pos.w); let S = u32(u.a.z); let dt = u.a.w * u.e.y;
  let p = me.pos.xyz; let R = max(length(p), 1e-4); let rad = p / R;
  let plan = sp[3u * s]; let anc = sp[3u * s + 2u]; let gather = u.c.w;
  var f = vec3f(0.0);
  if (u.e.x < 0.5) {   // organism: neighbours
    let c = cellOf(p); let g = G();
    for (var z = -1; z <= 1; z++) { for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
      let cc = c + vec3i(x, y, z);
      if (any(cc < vec3i(0)) || any(cc >= vec3i(g))) { continue; }
      let ci = idx(cc); let s0 = start[ci]; let s1 = s0 + atomicLoad(&cnt[ci]);
      for (var j = s0; j < s1; j++) {
        if (j == i) { continue; }
        let o = pout[j]; let d = o.pos.xyz - p; let r = length(d) / u.b.x;
        if (r > 0.0001 && r < 1.0) { f += d / (r * u.b.x) * F(r, mat[s * S + u32(o.pos.w)]); }
      }
    } } }
    f *= u.b.x * u.b.z;
    // body plan: a spring to distance r from this species' anchor (the centre, or an organelle's own centre), rings
    // flattened onto the song's equator, a swirl about the song's axis; everything to the centre while gathering
    let ax = normalize(u.c.xyz);
    let A = anc.xyz * (1.0 - gather); let dA = p - A; let RA = max(length(dA), 1e-4);
    let tgt = plan.x * (1.0 - gather);
    f += -(dA / RA) * (RA - tgt) * plan.y * (1.0 + 6.0 * gather);
    if (anc.w > 0.0) { f += -ax * dot(p, ax) * anc.w * (1.0 - gather); }
    f += cross(ax, p) * plan.z * (1.0 - gather);
    f += rad * u.d.x * select(0.15, 1.0, plan.x > 0.3);   // the felt beat breathes it outward
  } else {   // jets: thrown out, pulled back, no neighbours
    f = -p * 3.0 * (1.0 + 2.0 * gather);
  }
  let fric = select(u.b.w, exp2(-u.a.w / 0.9), u.e.x > 0.5);   // jets fly almost freely; the organism is viscous
  var v = me.vel.xyz * pow(fric, u.e.y) + f * dt;
  let vmax = 2.0; let vl = length(v); if (vl > vmax) { v *= vmax / vl; }
  var q = p + v * dt;
  let h = u.d.z * 0.98; q = clamp(q, vec3f(-h), vec3f(h));
  pin[i] = Part(vec4f(q, me.pos.w), vec4f(v, me.vel.w + u.a.w));
}`;

const DRAW_WGSL = /* wgsl */`
struct Part { pos: vec4f, vel: vec4f };
struct Cam { ro: vec4f, uu: vec4f, vv: vec4f, ww: vec4f, scr: vec4f, shift: vec4f, light: vec4f, envp: vec4f };
// scr: res.x, res.y, scale, wide   shift: x, y, ball size, fade   light: rgb, glow   envp: crisp, env, core radius, jet life
struct Sim { a: vec4f, b: vec4f, c: vec4f, d: vec4f, e: vec4f };
@group(0) @binding(0) var<uniform> cam: Cam;
@group(0) @binding(1) var<storage, read> P: array<Part>;
@group(0) @binding(2) var<storage, read> sp: array<vec4f, 24>;
@group(0) @binding(3) var<uniform> sim: Sim;
struct VO { @builtin(position) pos: vec4f, @location(0) q: vec2f, @location(1) wp: vec3f, @location(2) col: vec4f, @location(3) a: f32, @location(4) z: f32 };
const HALO = 2.4;
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO {
  var corners = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let pt = P[ii]; let s = u32(pt.pos.w);
  var p = pt.pos.xyz; p.x *= 1.0 + cam.scr.w;
  let rel = p - cam.ro.xyz; let z = max(dot(rel, cam.ww.xyz), 0.5);
  let uv = vec2f(dot(rel, cam.uu.xyz), dot(rel, cam.vv.xyz)) * 1.6 / z * cam.scr.z + cam.shift.xy;
  var a = cam.shift.w;
  if (sim.e.x > 0.5) { a *= clamp(1.0 - pt.vel.w / cam.envp.w, 0.0, 1.0); }   // jets fade as they fall back
  let rad = cam.shift.z * sp[3u * s].w * 1.6 / z * cam.scr.z * (0.6 + 0.4 * a);
  let q = corners[vi] * HALO;
  var o: VO;
  o.pos = vec4f((uv.x + q.x * rad) * 2.0 * cam.scr.y / cam.scr.x, (uv.y + q.y * rad) * 2.0, clamp((z - 1.0) / 8.0, 0.0, 1.0), 1.0);
  o.q = q; o.wp = p; o.col = sp[3u * s + 1u]; o.a = a; o.z = clamp((z - 1.0) / 8.0, 0.0, 1.0);
  return o;
}
fn ss(e0: f32, e1: f32, x: f32) -> f32 { let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
fn env(r: vec3f, p: vec3f) -> vec3f {   // the body shader's env(), so the balls reflect the same world
  let L = cam.light.rgb; let crisp = cam.envp.x;
  var sky = mix(vec3f(0.02, 0.02, 0.035), vec3f(0.22, 0.22, 0.28), ss(-0.7, 1.0, r.y)) + L * 0.3 * ss(-0.2, 1.0, r.y);
  let cw = 1.0 - 0.55 * crisp;
  sky += vec3f(1.0) * ss(0.08 * cw, 0.0, abs(r.y - 0.5)) * (0.85 + 0.4 * crisp) + vec3f(0.8) * ss(0.05 * cw, 0.0, abs(r.x + 0.62)) * ss(-0.2, 0.4, r.y) * (0.5 + 0.3 * crisp);
  sky += L * ss(0.1, 0.0, abs(r.y + 0.35)) * 0.35;
  let toCore = normalize(-p + vec3f(1e-5)); let k = max(dot(r, toCore), 0.0); let size = clamp(cam.envp.z * 1.6 / max(length(p), 0.05), 0.05, 0.99);
  return sky * cam.envp.y + L * (ss(1.0 - size * size * 1.6, 1.0, k) * 5.0 + pow(k, 4.0) * 0.8) * cam.light.w;
}
struct FO { @location(0) c: vec4f, @builtin(frag_depth) depth: f32 };
@fragment fn fs(i: VO) -> FO {
  let d2 = dot(i.q, i.q); var o: FO;
  if (d2 > 1.0) {   // outside the ball: a soft additive glow (alpha 0 adds light under premultiplied blending)
    let g = exp(-(d2 - 1.0) * 1.2) * i.col.w * i.a * 0.32;
    if (g < 0.003) { discard; }
    o.c = vec4f(i.col.rgb * g, 0.0); o.depth = 0.9999; return o;
  }
  let nz = sqrt(1.0 - d2);
  let n = normalize(cam.uu.xyz * i.q.x + cam.vv.xyz * i.q.y - cam.ww.xyz * nz);
  let rd = normalize(i.wp - cam.ro.xyz); let r = reflect(rd, n);
  let ndv = max(dot(n, -rd), 0.0); let fres = pow(1.0 - ndv, 5.0);
  let f0 = mix(vec3f(0.62, 0.64, 0.7), i.col.rgb, 0.85);   // metal, strongly tinted by its species
  let dif = max(dot(n, normalize(-i.wp + vec3f(1e-5))), 0.0);
  var c = env(r, i.wp) * mix(f0, vec3f(1.0), fres) * 0.75 + cam.light.rgb * f0 * dif * cam.light.w * 0.5 + i.col.rgb * (0.25 + i.col.w * 0.6) * (0.55 + 0.45 * nz);
  o.c = vec4f(c * i.a, i.a); o.depth = i.z; return o;
}`;

export async function createSwarm(canvas, { maxN = 16384, half = 1.6 } = {}) {
  if (!navigator.gpu) return null;
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  device.lost.then((e) => console.warn('swarm: GPU device lost', e.message));
  let errors = 0;
  device.onuncapturederror = (e) => { if (errors++ < 3) console.error('swarm GPU error:', e.error.message); };
  const ctx = canvas.getContext('webgpu'), format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'premultiplied' });
  const GMAX = 48, CMAX = GMAX ** 3;
  const B = (size, usage) => device.createBuffer({ size, usage });
  const ST = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
  const pin = B(maxN * 32, ST), pout = B(maxN * 32, ST), cnt = B(CMAX * 4, ST), start = B(CMAX * 4, ST), rank = B(maxN * 4, ST);
  const mat = B(64 * 4, ST), spb = B(24 * 16, ST);
  const SPd = new Float32Array(96), ANC = [];
  const simU = B(80, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST), camU = B(128, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  const simMod = device.createShaderModule({ code: SIM_WGSL }), drawMod = device.createShaderModule({ code: DRAW_WGSL });
  for (const [name, m] of [['sim', simMod], ['draw', drawMod]]) { const info = await m.getCompilationInfo(); for (const msg of info.messages) if (msg.type === 'error') { console.error('swarm', name, msg.lineNum, msg.message); return null; } }
  const simLayout = device.createBindGroupLayout({ entries: [0, 1, 2, 3, 4, 5, 6, 7].map((b) => ({ binding: b, visibility: GPUShaderStage.COMPUTE, buffer: { type: b === 0 ? 'uniform' : b >= 6 ? 'read-only-storage' : 'storage' } })) });
  const simBG = device.createBindGroup({ layout: simLayout, entries: [simU, pin, pout, cnt, start, rank, mat, spb].map((buffer, binding) => ({ binding, resource: { buffer } })) });
  const simPL = device.createPipelineLayout({ bindGroupLayouts: [simLayout] });
  const cp = (entryPoint) => device.createComputePipeline({ layout: simPL, compute: { module: simMod, entryPoint } });
  const P = { clear: cp('clear'), count: cp('count'), scan: cp('scan'), scatter: cp('scatter'), force: cp('force') };
  const drawLayout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }] });
  const drawBG = device.createBindGroup({ layout: drawLayout, entries: [camU, pin, spb, simU].map((buffer, binding) => ({ binding, resource: { buffer } })) });
  const draw = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [drawLayout] }),
    vertex: { module: drawMod, entryPoint: 'vs' },
    fragment: { module: drawMod, entryPoint: 'fs', targets: [{ format, blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
  });
  let depthTex = null;
  const S = { active: false, mode: 'organism', n: 0, org: null, gather: 0, fade: 0, time: 0, g: 32, rmax: 0.08, life: 1.8, cleared: true, simMs: 0 };
  const simData = new Float32Array(20), camData = new Float32Array(32);

  function upload(org) {
    const M = new Float32Array(64);
    for (let i = 0; i < org.S; i++) for (let j = 0; j < org.S; j++) M[i * org.S + j] = org.M[i][j];
    SPd.fill(0);
    org.species.forEach((s, i) => { const c = hsl(s.hue, s.sat, s.role === 'core' ? 0.62 : 0.58); SPd.set([s.r, s.k, s.swirl, s.size], 12 * i); SPd.set([c[0], c[1], c[2], s.glow], 12 * i + 4); SPd[12 * i + 11] = s.flat || 0; });
    device.queue.writeBuffer(mat, 0, M); updateAnchors(org, 0);
  }
  function updateAnchors(org, t) {   // organelles drift on their orbits
    anchorsAt(org, t, ANC);
    for (let i = 0; i < org.S; i++) SPd.set(ANC[i], 12 * i + 8);
    device.queue.writeBuffer(spb, 0, SPd);
  }
  /** the body bursts: n balls spread through a sphere of radius r0 (the body), thrown outward by `burst` */
  function burst(org, { n = maxN, r0 = 0.4, speed = 0.9, seed = 1 } = {}) {
    n = Math.min(maxN, n); let a = seed >>> 0; const rnd = () => ((a = (Math.imul(a, 1664525) + 1013904223) >>> 0) / 4294967296);
    const D = new Float32Array(n * 8); let k = 0;
    org.species.forEach((s, si) => { const m = si === org.species.length - 1 ? n - k : Math.round(s.share * n); for (let c = 0; c < m && k < n; c++, k++) {
      let x, y, z; do { x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1; } while (x * x + y * y + z * z > 1);
      const rr = Math.cbrt(rnd()) * r0, l = Math.hypot(x, y, z) || 1; x = x / l * rr; y = y / l * rr; z = z / l * rr;
      const v = speed * (0.4 + rnd()) * (rr / r0);
      D.set([x, y, z, si, x / (rr || 1) * v, y / (rr || 1) * v, z / (rr || 1) * v, 0], k * 8);
    } });
    device.queue.writeBuffer(pin, 0, D);
    upload(org);
    S.org = org; S.n = n; S.mode = 'organism'; S.active = true; S.gather = 0; S.fade = 0; S.rmax = org.rmax; S.g = Math.min(GMAX, Math.ceil((2 * half) / org.rmax));
  }
  /** a few hundred balls thrown from the surface in one direction (a Rayleigh jet), falling back and fading */
  function jets(org, { n = 600, r0 = 0.4, dir = [0, 1, 0], speed = 1.9, seed = 1 } = {}) {
    if (S.active && S.mode === 'organism') return;
    n = Math.min(maxN, n); let a = seed >>> 0; const rnd = () => ((a = (Math.imul(a, 1664525) + 1013904223) >>> 0) / 4294967296);
    const D = new Float32Array(n * 8), l = Math.hypot(...dir) || 1, d = dir.map((x) => x / l);
    for (let k = 0; k < n; k++) {
      const jx = d[0] + (rnd() - 0.5) * 0.5, jy = d[1] + (rnd() - 0.5) * 0.5, jz = d[2] + (rnd() - 0.5) * 0.5, jl = Math.hypot(jx, jy, jz);
      const v = speed * (0.5 + rnd());
      D.set([jx / jl * r0, jy / jl * r0, jz / jl * r0, k % org.S, jx / jl * v, jy / jl * v, jz / jl * v, -rnd() * 0.25], k * 8);
    }
    device.queue.writeBuffer(pin, 0, D); upload(org);
    S.org = org; S.n = n; S.mode = 'jets'; S.active = true; S.gather = 0; S.fade = 1; S.rmax = org.rmax; S.g = 8; S.time = 0;
  }
  function gather() { if (S.active) S.gatherTo = 1; }

  /**
   * one frame: simulate and draw (if active)
   * @param cam { ro, uu, vv, ww (arrays), res [w,h], scale, wide, shift [x,y], light [r,g,b], glow, crisp, env, coreR }
   * @param music { pulse (0..1 felt beat), speed }
   * @returns { done } when a gather has finished (the body should be whole again)
   */
  function frame(dt, cam, music = {}) {
    const w = Math.max(1, Math.round(cam.res[0])), h = Math.max(1, Math.round(cam.res[1]));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    if (!depthTex || depthTex.width !== w || depthTex.height !== h) { if (depthTex) depthTex.destroy(); depthTex = device.createTexture({ size: [w, h], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT }); }
    if (!S.active) {
      if (!S.cleared) { const e = device.createCommandEncoder(); e.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', clearValue: [0, 0, 0, 0], storeOp: 'store' }] }).end(); device.queue.submit([e.finish()]); S.cleared = true; }
      return { done: false };
    }
    S.cleared = false; S.time += dt;
    let done = false;
    if (S.mode === 'organism') {
      S.fade = Math.min(1, S.fade + dt / 0.35);
      if (S.gatherTo) { S.gather = Math.min(1, S.gather + dt / 2.2); if (S.gather >= 1) { S.fade -= dt / 0.45; if (S.fade <= 0) { S.active = false; S.gatherTo = 0; done = true; } } }
    } else if (S.time > S.life + 0.3) { S.active = false; done = true; }
    const o = S.org, sdt = Math.min(dt, 1 / 30);
    if (S.mode === 'organism') updateAnchors(o, S.time);
    simData.set([S.n, S.g, o.S, sdt, o.rmax, o.beta, o.force, Math.pow(0.5, sdt / o.friction), o.axis[0], o.axis[1], o.axis[2], S.gather, music.pulse || 0, S.time, half, 4, S.mode === 'jets' ? 1 : 0, music.speed || 1, S.life, 0]);
    device.queue.writeBuffer(simU, 0, simData);
    camData.set([...cam.ro, 0, ...cam.uu, 0, ...cam.vv, 0, ...cam.ww, 0, w, h, cam.scale, cam.wide, cam.shift[0], cam.shift[1], o.ball, Math.max(0, S.fade), ...cam.light, cam.glow, cam.crisp, cam.env, cam.coreR, S.life]);
    device.queue.writeBuffer(camU, 0, camData);
    const e = device.createCommandEncoder();
    if (!done) {
      const c = e.beginComputePass(); c.setBindGroup(0, simBG);
      const C = S.g ** 3, wg = Math.ceil(S.n / 128);
      if (S.mode === 'organism') { c.setPipeline(P.clear); c.dispatchWorkgroups(Math.ceil(C / 256)); c.setPipeline(P.count); c.dispatchWorkgroups(wg); c.setPipeline(P.scan); c.dispatchWorkgroups(1); }
      c.setPipeline(P.scatter); if (S.mode === 'organism') c.dispatchWorkgroups(wg);
      if (S.mode === 'jets') { c.end(); e.copyBufferToBuffer(pin, 0, pout, 0, S.n * 32); const c2 = e.beginComputePass(); c2.setBindGroup(0, simBG); c2.setPipeline(P.force); c2.dispatchWorkgroups(wg); c2.end(); }
      else { c.setPipeline(P.force); c.dispatchWorkgroups(wg); c.end(); }
    }
    const r = e.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', clearValue: [0, 0, 0, 0], storeOp: 'store' }], depthStencilAttachment: { view: depthTex.createView(), depthLoadOp: 'clear', depthClearValue: 1, depthStoreOp: 'discard' } });
    if (!done) { r.setPipeline(draw); r.setBindGroup(0, drawBG); r.draw(6, S.n); }
    r.end();
    device.queue.submit([e.finish()]);
    return { done };
  }
  return { burst, jets, gather, frame, state: S, get active() { return S.active; }, get mode() { return S.mode; } };
}
