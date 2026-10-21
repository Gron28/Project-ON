// the fingerprint's preload: records every shader source in the page's own world, then the page's real preload
const { webFrame } = require('electron');
webFrame.executeJavaScript(`(() => { const S = window.__shaders = []; for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) { const f = C.prototype.shaderSource;
  C.prototype.shaderSource = function (sh, src) { S.push(src); return f.call(this, sh, src); }; } })()`);
require('../being/preload.cjs');
