// GPU time per pass (window.__gpuStats) and frame rate on the real GPU, vsync off, with the resolution governor pinned, in several
// states: groove, CelLab surface + inside, beads, asleep.
// [WAV=<abs 48 kHz mono wav>] [SIZE=700] [RES=1] [RES2=0.7] [LABEL=baseline] [WARM=8000] [SECS=3]
//   timeout 120 ./node_modules/.bin/electron.cmd scratch/perf-baseline.cjs   -> prints a table and writes scratch/perf/<LABEL>.json
// Like main.cjs, it runs ANGLE on the OpenGL driver: on ANGLE's default D3D11 backend the body shader takes minutes to
// compile (FXC) and the GPU process is killed (exit_code=2), which froze this harness before.
const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('node:path'); const fs = require('node:fs'); const os = require('node:os');

const ROOT = path.join(__dirname, '..');
if (process.platform === 'win32') app.commandLine.appendSwitch('use-angle', process.env.ENTITY_ANGLE || 'gl');
app.commandLine.appendSwitch('disable-gpu-vsync'); app.commandLine.appendSwitch('disable-frame-rate-limit');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'on-perf-')));
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(ipcMain, app);
ipcMain.on('ml-get', (e) => { e.returnValue = null; });
ipcMain.handle('page-schema', () => []);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t00 = Date.now(), T = () => ((Date.now() - t00) / 1000).toFixed(1);
app.on('child-process-gone', (e, d) => console.log('[gone]', T(), d.type, d.reason, d.exitCode));
app.whenReady().then(async () => {
  const S = +(process.env.SIZE || 700), SECS = +(process.env.SECS || 3) * 1000;
  const w = new BrowserWindow({ show: true, x: +(process.env.X ?? 0), y: 0, width: S, height: S, useContentSize: true, backgroundColor: '#000', skipTaskbar: true, focusable: false, webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  w.webContents.on('console-message', (e) => { if (e.level === 'error' || /uncaught/i.test(e.message)) console.log('[page]', T(), String(e.message).slice(0, 160)); });
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '0', ui: '0' } });
  const js = (s) => w.webContents.executeJavaScript(s);
  const t1 = Date.now(); await js('new Promise((r) => { const f = () => (window.__being && window.__gpuStats ? r(1) : setTimeout(f, 50)); f(); })');
  const gl = await js('(() => { const c = document.querySelector("canvas"), g = c.getContext("webgl2"), d = g.getExtension("WEBGL_debug_renderer_info"); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : "?"; })()');
  console.log('loaded', T(), 's, page ready in', Date.now() - t1, 'ms |', gl);
  w.webContents.send('track', { key: 'perf-lab|synth', title: 'synth', artist: 'lab', app: 'lab' });
  const mono = (() => { const d = fs.readFileSync(process.env.WAV || 'C:/Users/felip/Desktop/Project-ON-main/scratch/synth-120.wav').subarray(44); return new Int16Array(d.buffer, d.byteOffset, d.length >> 1); })();
  let pos = 0, play = true, t0 = Date.now();
  const tm = setInterval(() => { const want = Math.floor((Date.now() - t0) / 1000 * 48000); while (pos + 960 <= want) { const b = Buffer.alloc(3840); if (play) for (let i = 0; i < 960; i++) { const v = mono[(pos + i) % mono.length]; b.writeInt16LE(v, i * 4); b.writeInt16LE(v, i * 4 + 2); } w.webContents.send('pcm', b); pos += 960; } }, 20);
  await js('window.__noBurst = true; window.__fc = 0; (function f(){ window.__fc++; requestAnimationFrame(f); })(); 1');
  await sleep(+(process.env.WARM || 8000));
  const out = { gpu: gl, size: S, states: {} };
  const measure = async (label, setup, settle = 2000) => {
    await js(setup + '; 1'); await sleep(settle);
    await js('window.__gpuT = true; window.__gpuStats(); window.__fc = 0; window.__fc0 = performance.now(); 1'); await sleep(SECS);
    const s = await js('({ g: window.__gpuStats(), fps: window.__fc / ((performance.now() - window.__fc0) / 1000), frameMs: window.__being().frameMs, buf: [document.querySelector("canvas").width, document.querySelector("canvas").height], dpr: devicePixelRatio, k: window.__qual.k })');
    await js('window.__gpuT = false; 1');
    out.states[label] = s; const tot = Object.values(s.g).reduce((a, v) => a + v.median, 0);
    console.log(label.padEnd(26), ('fps ' + s.fps.toFixed(0)).padEnd(8), ('gpu ' + tot.toFixed(2) + ' ms').padEnd(14), Object.entries(s.g).sort((a, b) => b[1].median - a[1].median).map(([k, v]) => `${k} ${v.median}/${v.p90}`).join(' | '));
  };
  for (const RES of [+(process.env.RES || 1), +(process.env.RES2 || 0)].filter(Boolean)) {
    await js(`Object.assign(window.__qual, { auto: false, res: ${RES}, k: ${RES} }); dispatchEvent(new Event("resize")); 1`);
    const b = await js('[document.querySelector("canvas").width, document.querySelector("canvas").height, devicePixelRatio]');
    console.log(`\nRES ${RES}: drawing buffer ${b[0]}x${b[1]}, devicePixelRatio ${b[2]}, window ${S}x${S}`);
    play = true; await measure(`groove @${RES}`, 'window.__cellab.pin(false)', 1500);
    await measure(`cellab surface+inside @${RES}`, "window.__cellab.pin(true); window.__cellab.show('surface', 60); window.__cellab.show('inside', 60)");
    await measure(`beads @${RES}`, "window.__cellab.pin(false); window.__cellab.show('surface', 0); window.__cellab.show('inside', 0); window.__beads()", 2500);
    await js('window.__beads(); 1'); play = false;
    await measure(`asleep @${RES}`, '', 6000);
    play = true; await sleep(1500);
  }
  fs.mkdirSync(path.join(__dirname, 'perf'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'perf', (process.env.LABEL || 'baseline') + '.json'), JSON.stringify(out, null, 1));
  clearInterval(tm); console.log('done', T()); app.exit(0);
});
setTimeout(() => { console.log('watchdog: giving up'); app.exit(3); }, +(process.env.LIMIT || 110) * 1000);
