// lab: records every framebuffer with a half-float colour attachment, so nan-probe.cjs can read them back for NaN / Inf / huge values
require('electron').webFrame.executeJavaScript(`(() => {
  const get = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (kind, o) {
    const gl = get.call(this, kind, o);
    if (gl && kind === 'webgl2' && !gl.__probe) {
      const tex = new Map(), fbs = new Map(); let curTex = null, curFb = null;
      const bt = gl.bindTexture.bind(gl), ti = gl.texImage2D.bind(gl), ts = gl.texStorage2D.bind(gl), bf = gl.bindFramebuffer.bind(gl), ft = gl.framebufferTexture2D.bind(gl);
      gl.bindTexture = (t, x) => { if (t === gl.TEXTURE_2D) curTex = x; return bt(t, x); };
      gl.texImage2D = (...a) => { if (a[0] === gl.TEXTURE_2D && curTex && a.length >= 9) tex.set(curTex, { fmt: a[2], w: a[3], h: a[4] }); return ti(...a); };
      gl.texStorage2D = (...a) => { if (a[0] === gl.TEXTURE_2D && curTex) tex.set(curTex, { fmt: a[2], w: a[3], h: a[4] }); return ts(...a); };
      gl.bindFramebuffer = (t, f) => { curFb = f; return bf(t, f); };
      gl.framebufferTexture2D = (t, att, tt, x, l) => { if (att === gl.COLOR_ATTACHMENT0 && curFb) fbs.set(curFb, x); return ft(t, att, tt, x, l); };
      gl.__probe = () => {
        const out = []; const prev = gl.getParameter(gl.FRAMEBUFFER_BINDING);
        for (const [fb, t] of fbs) {
          const d = tex.get(t); if (!d || d.fmt !== gl.RGBA16F || d.w < 8) continue;
          bf(gl.FRAMEBUFFER, fb); const px = new Float32Array(d.w * d.h * 4);
          try { gl.readPixels(0, 0, d.w, d.h, gl.RGBA, gl.FLOAT, px); } catch (e) { continue; }
          let nan = 0, inf = 0, neg = 0, big = 0, max = 0;
          for (let i = 0; i < px.length; i++) { const v = px[i]; if (v !== v) nan++; else if (!isFinite(v)) inf++; else { if (v < -1e-3) neg++; if (v > 4) big++; if (v > max) max = v; } }
          out.push({ w: d.w, h: d.h, nan, inf, neg, big, max: +max.toFixed(2) });
        }
        bf(gl.FRAMEBUFFER, prev); return out;
      };
      window.__glProbe = gl.__probe;
      // the cube maps whose mip chain is generated: level 1 against a 2x2 box of level 0, per face (mean and max abs error)
      const cubes = new Set(); let curCube = null; const gm = gl.generateMipmap.bind(gl), bt2 = gl.bindTexture;
      gl.bindTexture = (t, x) => { if (t === gl.TEXTURE_CUBE_MAP) curCube = x; return bt2(t, x); };
      gl.generateMipmap = (t) => { if (t === gl.TEXTURE_CUBE_MAP && curCube) cubes.add(curCube); return gm(t); };
      window.__mipProbe = (lv = 1) => {
        const prev = gl.getParameter(gl.FRAMEBUFFER_BINDING), fb = gl.createFramebuffer(), out = [];
        bf(gl.FRAMEBUFFER, fb);
        const rd = (c, f, l, n) => { ft(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, c, l); const px = new Float32Array(n * n * 4); gl.readPixels(0, 0, n, n, gl.RGBA, gl.FLOAT, px); return px; };
        for (const c of cubes) {
          bt2(gl.TEXTURE_CUBE_MAP, c); const N = 384;
          for (let f = 0; f < 6; f++) {
            let a = rd(c, f, 0, N), n = N;
            for (let l = 1; l <= lv; l++) { const m = n >> 1, b = new Float32Array(m * m * 4); for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) for (let k = 0; k < 4; k++) b[(y * m + x) * 4 + k] = .25 * (a[((2 * y) * n + 2 * x) * 4 + k] + a[((2 * y) * n + 2 * x + 1) * 4 + k] + a[((2 * y + 1) * n + 2 * x) * 4 + k] + a[((2 * y + 1) * n + 2 * x + 1) * 4 + k]); a = b; n = m; }
            const g = rd(c, f, lv, n); let s = 0, mx = 0, rng = 0; for (let i = 0; i < g.length; i += 4) { const d = Math.abs(g[i] - a[i]); s += d; if (d > mx) mx = d; rng = Math.max(rng, Math.abs(a[i] - .5)); }
            out.push({ face: f, lv, n, meanErr: +(s / (n * n)).toFixed(4), maxErr: +mx.toFixed(3), spread: +rng.toFixed(3) });
          }
        }
        bt2(gl.TEXTURE_CUBE_MAP, null); bf(gl.FRAMEBUFFER, prev); gl.deleteFramebuffer(fb); return out;
      };
      window.__cubeFace = (f = 0) => {   // level 0 of the first generated cube map, red channel as grey, 384x384 (row-major from the bottom)
        const c = [...cubes][0]; if (!c) return null; const prev = gl.getParameter(gl.FRAMEBUFFER_BINDING), fb = gl.createFramebuffer(); bf(gl.FRAMEBUFFER, fb);
        ft(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, c, 0); const px = new Float32Array(384 * 384 * 4); gl.readPixels(0, 0, 384, 384, gl.RGBA, gl.FLOAT, px);
        bf(gl.FRAMEBUFFER, prev); gl.deleteFramebuffer(fb); return Array.from({ length: 384 * 384 }, (_, i) => Math.max(0, Math.min(255, Math.round(px[i * 4] * 255))));
      };
      window.__glInfo = () => ({ parallel: !!gl.getExtension('KHR_parallel_shader_compile'), floatLinear: !!gl.getExtension('OES_texture_float_linear') });
    }
    return gl;
  };
})()`);
require('../being/preload.cjs');
