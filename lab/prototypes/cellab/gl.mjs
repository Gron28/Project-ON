// lab/prototypes/cellab/gl.mjs - small WebGL2 helpers for the CelLab gallery: programs, integer and float render targets,
// a fullscreen triangle, and a GPU frame timer (EXT_disjoint_timer_query_webgl2 when the browser exposes it).

export function compile(gl, vsSrc, fsSrc, name = 'program') {
  const mk = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      const lines = src.split('\n').map((l, i) => `${i + 1}: ${l}`);
      const m = /0:(\d+)/.exec(log || ''); const at = m ? +m[1] : 0;
      throw new Error(`${name}: ${log}\n${lines.slice(Math.max(0, at - 4), at + 2).join('\n')}`);
    }
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vsSrc)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fsSrc));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`${name}: ${gl.getProgramInfoLog(p)}`);
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); const key = info.name.replace(/\[0\]$/, ''); u[key] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

export const VS = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

export function fullscreen(gl) {
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  return () => { gl.bindVertexArray(vao); gl.drawArrays(gl.TRIANGLES, 0, 3); };
}

// a texture with a framebuffer; kind 'u32' (R32UI), 'u32x4' (RGBA32UI), 'f16' (RGBA16F, linear), 'rgba8' (linear)
export function target(gl, w, h, kind) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  const F = {
    u32: [gl.R32UI, gl.RED_INTEGER, gl.UNSIGNED_INT, gl.NEAREST],
    u32x4: [gl.RGBA32UI, gl.RGBA_INTEGER, gl.UNSIGNED_INT, gl.NEAREST],
    f16: [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR],
    rgba8: [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR],
  }[kind];
  gl.texImage2D(gl.TEXTURE_2D, 0, F[0], w, h, 0, F[1], F[2], null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, F[3]); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, F[3]);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`framebuffer ${kind} ${w}x${h} incomplete: 0x${st.toString(16)}`);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { t, fb, w, h, kind };
}

export function bindTex(gl, unit, tex, target = gl.TEXTURE_2D) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(target, tex); return unit; }

// GPU time of everything between begin() and end(), read a few frames later; null when unsupported
export function gpuTimer(gl) {
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) return { ok: false, begin() {}, end() {}, ms: null };
  const pending = []; let active = null; const o = { ok: true, ms: null, samples: [] };
  o.begin = () => {
    while (pending.length) {
      const q = pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      pending.shift();
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) { const v = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; o.samples.push(v); if (o.samples.length > 120) o.samples.shift(); o.ms = o.ms == null ? v : o.ms * 0.9 + v * 0.1; }
      gl.deleteQuery(q);
    }
    if (pending.length > 4) return;
    active = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, active);
  };
  o.end = () => { if (!active) return; gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(active); active = null; };
  return o;
}

// rotation matrix (column-major mat3) from yaw, pitch
export function rotYX(yaw, pitch) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  // R = Rx(pitch) * Ry(yaw)
  return new Float32Array([cy, sp * sy, -cp * sy, 0, cp, sp, sy, -sp * cy, cp * cy]);
}
