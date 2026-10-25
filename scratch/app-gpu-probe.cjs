// Lab: the whole app (main.cjs) with its own switches (ANGLE on OpenGL, sandboxed page), watched for SECS seconds: GPU backend and
// feature status, child processes that die, the paths by which it quits (app.quit / app.exit / the single-instance lock), and
// whether the being's page answers and how fast it draws.
// [ENTITY_MULTI=1] [SECS=90] timeout 150 ./node_modules/.bin/electron.cmd scratch/app-gpu-probe.cjs
const { app, BrowserWindow } = require('electron');
const t00 = Date.now(), T = () => ((Date.now() - t00) / 1000).toFixed(1);
for (const k of ['quit', 'exit', 'relaunch']) { const f = app[k].bind(app); app[k] = (...a) => { console.log(`[app.${k}]`, T(), JSON.stringify(a), new Error().stack.split('\n').slice(2, 4).map((s) => s.trim()).join(' <- ')); return f(...a); }; }
const lock = app.requestSingleInstanceLock.bind(app); app.requestSingleInstanceLock = (...a) => { const r = lock(...a); console.log('[single-instance lock]', T(), r ? 'got it' : 'HELD BY ANOTHER INSTANCE -> main.cjs exits 0'); return r; };
app.on('child-process-gone', (e, d) => console.log('[gone]', T(), d.type, d.reason, d.exitCode));
app.on('will-quit', () => console.log('[will-quit]', T()));
process.env.ENTITY_WINDOW = process.env.ENTITY_WINDOW || '1';
require('../main.cjs');
app.whenReady().then(async () => {
  console.log('switch use-angle =', app.commandLine.getSwitchValue('use-angle'), '| userData', app.getPath('userData'));
  setTimeout(async () => {
    console.log('features', JSON.stringify(app.getGPUFeatureStatus()));
    try { const g = await app.getGPUInfo('complete'); console.log('gl', g.auxAttributes?.glRenderer, '|', g.auxAttributes?.glImplementationParts || ''); } catch (e) { console.log('gpuinfo', e.message); }
  }, 8000);
  let busy = false;
  setInterval(async () => {
    const page = BrowserWindow.getAllWindows().find((w) => /being\/index/.test(w.webContents.getURL())); if (!page) return;
    if (busy) { console.log('[hb]', T(), 'page has not answered'); return; } busy = true; const t = Date.now();
    try { const r = await page.webContents.executeJavaScript('(() => { const b = window.__being && window.__being(); const c = document.querySelector("canvas"); const gl = c && (c.getContext("webgl2")); const d = gl && gl.getExtension("WEBGL_debug_renderer_info"); return { fm: b && +(+b.frameMs).toFixed(1), q: window.__qual && { res: window.__qual.res, auto: window.__qual.auto }, buf: c && c.width + "x" + c.height, dpr: devicePixelRatio, gpu: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : "?" }; })()'); console.log('[hb]', T(), Date.now() - t, 'ms', JSON.stringify(r)); } catch (e) { console.log('[hb]', T(), 'error', e.message); }
    busy = false;
  }, 5000);
  setTimeout(() => { console.log('done', T()); app.exit(0); }, +(process.env.SECS || 90) * 1000);
});
