// being/page/quality-lab.mjs - lab: the same frame drawn several ways, inside one task (nothing moves between them), so
// the governor's choices can be compared with the full-resolution picture and timed. window.__qualLab; inert until called.
//   compare({ ks, sharp }) -> per k: PSNR and edge energy of today's stretch ('old': the whole canvas smaller, stretched
//                            bilinearly) and of the upscaled body ('new'), against k = 1; plus PNG strips [full | old | new]
//   time({ ks, disc, n })  -> ms per body pass (gl.finish), per k, quad vs disc
export function installQualityLab(ctx) {
  const { THREE, renderer, U, CO, QUAL, UP, resize, scene, camera, coScene } = ctx;
  const gl = renderer.getContext();
  const base = () => Math.min(devicePixelRatio, 1.5) * ctx.T.res;
  const read = (w, h) => { const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
  const sceneRT = () => ctx.sceneRT;
  function drawNew(k) {   // what the page now draws at body resolution k
    QUAL.k = k; resize();
    renderer.setRenderTarget(sceneRT()); renderer.render(scene, camera);
    CO.uScene.value = QUAL.up ? UP.render(sceneRT()) : sceneRT().texture;
    renderer.setRenderTarget(null); renderer.render(coScene, camera);
    return read(CO.uRes.value.x, CO.uRes.value.y);
  }
  function drawOld(k, W, H) {   // what it drew before: the whole canvas at k, stretched by the browser (bilinear)
    QUAL.k = 1; resize();
    renderer.setPixelRatio(base() * k); renderer.setSize(innerWidth, innerHeight, false);
    const v = new THREE.Vector2(); renderer.getDrawingBufferSize(v); const w = v.x, h = v.y;
    U.uRes.value.set(w, h); ctx.sceneRT.setSize(w, h); CO.uRes.value.set(w, h);
    renderer.setRenderTarget(sceneRT()); renderer.render(scene, camera);
    CO.uScene.value = sceneRT().texture; renderer.setRenderTarget(null); renderer.render(coScene, camera);
    const s = read(w, h), out = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const sx = Math.min(w - 1, Math.max(0, (x + .5) * w / W - .5)), sy = Math.min(h - 1, Math.max(0, (y + .5) * h / H - .5));
      const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = sx - x0, fy = sy - y0;
      for (let c = 0; c < 4; c++) {
        const a = s[(y0 * w + x0) * 4 + c], b = s[(y0 * w + x1) * 4 + c], d = s[(y1 * w + x0) * 4 + c], e = s[(y1 * w + x1) * 4 + c];
        out[(y * W + x) * 4 + c] = Math.round((a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy);
      }
    }
    return out;
  }
  const luma = (p, i) => .2126 * p[i] + .7152 * p[i + 1] + .0722 * p[i + 2];
  function edge(p, W, H) { let s = 0; for (let y = 1; y < H; y++) for (let x = 1; x < W; x++) { const i = (y * W + x) * 4; s += Math.abs(luma(p, i) - luma(p, i - 4)) + Math.abs(luma(p, i) - luma(p, i - 4 * W)); } return s / (W * H); }
  function psnr(a, b) { let s = 0, n = 0; for (let i = 0; i < a.length; i++) { if ((i & 3) === 3 && a[i] === 0 && b[i] === 0) continue; const d = a[i] - b[i]; s += d * d; n++; } const m = s / Math.max(1, n); return m === 0 ? Infinity : 10 * Math.log10(255 * 255 / m); }
  function png(list, W, H) {   // a strip of images side by side, flipped right way up, on black
    const c = document.createElement('canvas'); c.width = W * list.length; c.height = H; const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
    list.forEach((p, j) => { const id = g.createImageData(W, H); for (let y = 0; y < H; y++) id.data.set(p.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
      const t = document.createElement('canvas'); t.width = W; t.height = H; t.getContext('2d').putImageData(id, 0, 0); g.drawImage(t, j * W, 0); });
    return c.toDataURL('image/png');
  }
  function compare({ ks = [.5, .6, .7, .8], sharp = null, pngs = true } = {}) {
    const k0 = QUAL.k, fbAmt = CO.uFbAmt.value, s0 = UP.uniforms.uSharp.value;
    if (sharp != null) UP.uniforms.uSharp.value = sharp;
    CO.uFbAmt.value = 0;   // the aura is a feedback of earlier frames: left out so every picture is the same frame
    try {
      const ref = drawNew(1), W = CO.uRes.value.x, H = CO.uRes.value.y, e0 = edge(ref, W, H), out = { W, H, edgeRef: +e0.toFixed(3), ks: {} };
      for (const k of ks) {
        const nw = drawNew(k), od = drawOld(k, W, H);
        out.ks[k] = { old: { psnr: +psnr(ref, od).toFixed(2), edge: +(edge(od, W, H) / e0).toFixed(3) }, new: { psnr: +psnr(ref, nw).toFixed(2), edge: +(edge(nw, W, H) / e0).toFixed(3) } };
        if (pngs) out.ks[k].png = png([ref, od, nw], W, H);
      }
      return out;
    } finally { CO.uFbAmt.value = fbAmt; UP.uniforms.uSharp.value = s0; QUAL.k = k0; resize(); }
  }
  function discCheck() {   // the disc against the whole window: the body pass's pixels must be identical
    const k0 = QUAL.k; QUAL.k = 1; resize();
    const W = U.uRes.value.x, H = U.uRes.value.y, rt = ctx.sceneRT, rd = () => { const px = new Uint16Array(W * H * 4); renderer.readRenderTargetPixels(rt, 0, 0, W, H, px); return px; };
    renderer.setRenderTarget(rt); U.uDisc.value = 0; renderer.render(scene, camera); const a = rd();
    U.uDisc.value = 1; renderer.render(scene, camera); const b = rd(); renderer.setRenderTarget(null);
    let diff = 0, lit = 0; for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) diff++; if ((i & 3) === 3 && a[i]) lit++; }
    QUAL.k = k0; resize(); return { pixels: W * H, differing: diff, litPixels: lit };
  }
  const sync = (rt) => { renderer.readRenderTargetPixels(rt, 0, 0, 1, 1, new Uint16Array(4)); };   // waits for the GPU
  function time({ ks = [1, .7, .5], discs = [0, 1], n = 6 } = {}) {
    const k0 = QUAL.k, out = {};
    try {
      for (const k of ks) for (const d of discs) {
        QUAL.k = k; resize(); U.uDisc.value = d; renderer.setRenderTarget(ctx.sceneRT);
        renderer.render(scene, camera); sync(ctx.sceneRT);   // warm, and wait
        const t0 = performance.now();
        for (let i = 0; i < n; i++) { renderer.setRenderTarget(ctx.sceneRT); renderer.render(scene, camera); sync(ctx.sceneRT); }
        const body = (performance.now() - t0) / n;
        let up = 0;
        if (QUAL.up) { const t1 = performance.now(); for (let i = 0; i < n; i++) { UP.render(ctx.sceneRT); sync(UP.rt); } up = (performance.now() - t1) / n; }
        out[`k${k} ${d ? 'disc' : 'quad'}`] = { body: +body.toFixed(2), upscale: +up.toFixed(2), res: [U.uRes.value.x, U.uRes.value.y] };
      }
      return out;
    } finally { U.uDisc.value = 1; renderer.setRenderTarget(null); QUAL.k = k0; resize(); }
  }
  window.__qualLab = { compare, discCheck, time };
}
