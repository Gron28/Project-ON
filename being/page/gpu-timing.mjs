// being/page/gpu-timing.mjs - lab: GPU time per pass (EXT_disjoint_timer_query_webgl2), only while window.__gpuT is set
export function createGpuTiming(renderer) {
  const GT = { ext: null, q: [], res: {} };
  function gpuTime(label, fn) {
    if (!window.__gpuT) return fn();
    const gl = renderer.getContext();
    if (window.__gpuT === 'sync') {   // wall time between two pixel reads (SwiftShader has no usable timer queries)
      const px = new Uint8Array(4), sync = () => { const fb = gl.getParameter(gl.FRAMEBUFFER_BINDING); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); };
      sync(); const t0 = performance.now(); fn(); sync(); (GT.res[label] = GT.res[label] || []).push(performance.now() - t0); return;
    }
    GT.ext = GT.ext || gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!GT.ext) { window.__gpuT = false; console.warn('no GPU timer queries'); return fn(); }
    const q = gl.createQuery(); gl.beginQuery(GT.ext.TIME_ELAPSED_EXT, q); fn(); gl.endQuery(GT.ext.TIME_ELAPSED_EXT); GT.q.push([label, q]);
  }
  function gpuPoll() {
    if (!GT.q.length) return; const gl = renderer.getContext();
    GT.q = GT.q.filter(([label, q]) => { if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return true; (GT.res[label] = GT.res[label] || []).push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q); return false; });
  }
  window.__gpuStats = () => { const o = {}; for (const [k, v] of Object.entries(GT.res)) { const s = v.slice().sort((a, b) => a - b); o[k] = { median: +s[s.length >> 1].toFixed(2), p90: +s[Math.floor(s.length * .9)].toFixed(2), n: s.length }; } GT.res = {}; return o; };
  return { GT, gpuTime, gpuPoll };
}
