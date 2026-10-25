// Lab preload: the being's own preload plus a WebGL2 probe injected into the page's main world before any script runs.
// It logs ('[gl] ...' on the console) every shader link with its sources' sizes, and every WebGL call that blocks longer than
// GL_SLOW ms (default 40) - compile/link status queries, readPixels, query results - so a stall can be pinned on one program.
require('../being/preload.cjs');
const { webFrame, contextBridge } = require('electron'); const fs = require('node:fs'), path = require('node:path');
if (process.env.GL_DUMP) contextBridge.exposeInMainWorld('__labDump', (name, text) => { fs.mkdirSync(process.env.GL_DUMP, { recursive: true }); fs.writeFileSync(path.join(process.env.GL_DUMP, String(name).replace(/[^\w.-]/g, '_')), String(text)); });
const SLOW = +(process.env.GL_SLOW || 40);
webFrame.executeJavaScript(`(() => {
  const SLOW = ${SLOW}, P = WebGL2RenderingContext.prototype, now = () => performance.now(), ts = () => (now() / 1000).toFixed(2);
  const src = new WeakMap(), prog = new WeakMap(); let nProg = 0;
  const label = (p) => { const i = prog.get(p); return i ? 'prog#' + i.id + ' vs ' + i.vs + ' fs ' + i.fs : 'prog?'; };
  window.__glLog = []; const log = (m) => { window.__glLog.push(ts() + ' ' + m); console.log('[gl] ' + ts() + ' ' + m); };
  const ss = P.shaderSource; let nSh = 0; P.shaderSource = function (s, t) { src.set(s, t.length); if (window.__labDump && t.length > 20000) { const k = ++nSh; window.__labDump('shader' + k + '-' + t.length + '.glsl', t); s.__dumpK = k; } return ss.call(this, s, t); };
  const cs = P.compileShader; P.compileShader = function (s) { const r = cs.call(this, s); if (window.__labDump && s.__dumpK) { try { const x = this.getExtension('WEBGL_debug_shaders'); log('debug_shaders ' + !!x); if (x) window.__labDump('shader' + s.__dumpK + '.hlsl', x.getTranslatedShaderSource(s)); } catch (e) { log('dump failed ' + e.message); } } return r; };
  const lp = P.linkProgram; P.linkProgram = function (p) {
    const sh = this.getAttachedShaders(p) || [], len = sh.map((s) => src.get(s) || 0);
    const id = ++nProg; prog.set(p, { id, vs: len[0], fs: len[1], t: now(), first: true });
    const t = now(); lp.call(this, p); const d = now() - t; log('link prog#' + id + ' vs ' + len[0] + ' fs ' + len[1] + ' (' + d.toFixed(0) + ' ms in call)');
  };
  const gpp = P.getProgramParameter; P.getProgramParameter = function (p, k) {
    const i = prog.get(p); if (i && i.first) { i.first = false; log('first status query ' + label(p) + ' pname ' + k + ' (' + (now() - i.t).toFixed(0) + ' ms after link)'); }
    const t = now(), r = gpp.call(this, p, k), d = now() - t; if (d > SLOW) log('getProgramParameter ' + label(p) + ' pname ' + k + ' -> ' + r + ' blocked ' + d.toFixed(0) + ' ms'); return r;
  };
  for (const name of ['getShaderParameter', 'getProgramInfoLog', 'getShaderInfoLog', 'readPixels', 'getQueryParameter', 'getError', 'finish', 'clientWaitSync', 'getUniformLocation', 'getActiveUniform', 'useProgram', 'drawArrays', 'drawElements', 'texImage2D', 'texSubImage2D', 'getBufferSubData']) {
    const f = P[name]; if (!f) continue;
    P[name] = function (...a) { const t = now(), r = f.apply(this, a), d = now() - t; if (d > SLOW) log(name + (a[0] && prog.get(a[0]) ? ' ' + label(a[0]) : '') + ' blocked ' + d.toFixed(0) + ' ms'); return r; };
  }
  const gc = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (k, o) { const c = gc.call(this, k, o); if (/webgl/.test(k)) { log('context ' + k + ' ' + JSON.stringify(o || {})); this.addEventListener('webglcontextlost', () => log('CONTEXT LOST')); this.addEventListener('webglcontextrestored', () => log('context restored')); try { const d = c.getExtension('WEBGL_debug_renderer_info'); log('renderer ' + (d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : '?') + ' parallel ' + !!c.getExtension('KHR_parallel_shader_compile')); } catch {} } return c; };
  log('probe installed');
})(); 1`);
