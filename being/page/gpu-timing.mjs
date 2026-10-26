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

/* the governor's GPU sense: the page's own GPU time per drawn frame (one timer query around it, read back frames later, never
   waited on), eased. ms stays NaN where timer queries are missing or disjoint (then the governor never climbs above the
   designed picture), and it pauses while the lab's per-pass timing runs (queries of one kind cannot nest). */
export function createFrameTimer(renderer) {
  const gl = renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const FT = { ms: NaN, q: [], open: null };
  return {
    FT,
    begin() { if (!ext || window.__gpuT || FT.open || FT.q.length > 4) return; FT.open = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, FT.open); },
    end() { if (!FT.open) return; gl.endQuery(ext.TIME_ELAPSED_EXT); FT.q.push(FT.open); FT.open = null; },
    poll() {
      if (!ext || !FT.q.length) return FT.ms;
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      while (FT.q.length && gl.getQueryParameter(FT.q[0], gl.QUERY_RESULT_AVAILABLE)) {
        const q = FT.q.shift(), ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; gl.deleteQuery(q);
        if (!disjoint && ms > 0 && ms < 1000) FT.ms = Number.isFinite(FT.ms) ? FT.ms + (ms - FT.ms) * .1 : ms;
      }
      return FT.ms;
    },
  };
}
