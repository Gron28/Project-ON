// Lab: load the being on the real GPU with the WebGL probe (scratch/gl-probe-preload.cjs) and report shader links, blocking GL
// calls, GPU-process exits and whether the page's main thread answers, for DUR seconds.
// [DUR=60] [SIZE=700] [SWIFT=1] [ENTITY_ANGLE=gl|d3d11] [UD=userData dir] [GL_DUMP=dir: big shaders and their translation] [WAV=...] timeout 120 ./node_modules/.bin/electron.cmd scratch/gl-probe.cjs
const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('node:path'); const fs = require('node:fs'); const os = require('node:os');
const ROOT = path.join(__dirname, '..');
if (!process.env.SWIFT && process.platform === 'win32') app.commandLine.appendSwitch('use-angle', process.env.ENTITY_ANGLE || 'gl');   // ENTITY_ANGLE=d3d11 reproduces the minutes-long FXC compile
if (process.env.SWIFT) { app.commandLine.appendSwitch('use-angle', 'swiftshader'); app.commandLine.appendSwitch('enable-unsafe-swiftshader'); }
app.setPath('userData', process.env.UD || fs.mkdtempSync(path.join(os.tmpdir(), 'on-probe-')));
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(ipcMain, app);
ipcMain.on('ml-get', (e) => { e.returnValue = null; });
const t00 = Date.now(), T = () => ((Date.now() - t00) / 1000).toFixed(1);
app.on('child-process-gone', (e, d) => console.log('[gone]', T(), d.type, d.reason, d.exitCode));
app.on('gpu-info-update', () => console.log('[gpu-info-update]', T()));
app.whenReady().then(async () => {
  const info = await app.getGPUInfo('basic'); console.log('gpu', JSON.stringify(info.gpuDevice?.map((g) => ({ s: g.deviceString, active: g.active }))));
  console.log('features', JSON.stringify(app.getGPUFeatureStatus()));
  const S = +(process.env.SIZE || 700);
  const w = new BrowserWindow({ show: true, x: +(process.env.X ?? 0), y: 0, width: S, height: S, backgroundColor: '#000', webPreferences: { preload: path.join(__dirname, 'gl-probe-preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  w.webContents.on('console-message', (e) => { const m = String(e.message); if (/^\[gl\]/.test(m) || e.level === 'error' || e.level === 'warning') console.log('[page]', T(), e.level, m.slice(0, 200)); });
  w.webContents.on('render-process-gone', (e, d) => console.log('[renderer gone]', T(), JSON.stringify(d)));
  w.webContents.on('unresponsive', () => console.log('[unresponsive]', T())); w.webContents.on('responsive', () => console.log('[responsive]', T()));
  console.log('loading', T());
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '0', ui: process.env.UI || '0' } });
  console.log('loaded', T()); w.webContents.send('track', { key: 'perf-lab|synth', title: 'synth', artist: 'lab', app: 'lab' });
  const mono = (() => { const d = fs.readFileSync(process.env.WAV || 'C:/Users/felip/Desktop/Project-ON-main/scratch/synth-120.wav').subarray(44); return new Int16Array(d.buffer, d.byteOffset, d.length >> 1); })();
  let pos = 0; const t0 = Date.now();
  setInterval(() => { const want = Math.floor((Date.now() - t0) / 1000 * 48000); while (pos + 960 <= want) { const b = Buffer.alloc(3840); for (let i = 0; i < 960; i++) { const v = mono[(pos + i) % mono.length]; b.writeInt16LE(v, i * 4); b.writeInt16LE(v, i * 4 + 2); } w.webContents.send('pcm', b); pos += 960; } }, 20);
  // heartbeat: does the page's main thread answer, and how many frames has it drawn
  let busy = false;
  setInterval(async () => {
    if (busy) { console.log('[hb]', T(), 'page still has not answered'); return; }
    busy = true; const t = Date.now();
    try { const r = await w.webContents.executeJavaScript('(() => { const b = window.__being && window.__being(); return { f: window.__hbF = (window.__hbF || 0), fm: b && b.frameMs, q: window.__qual && { res: window.__qual.res, k: window.__qual.k }, bw: document.querySelector("canvas") && document.querySelector("canvas").width, dpr: devicePixelRatio }; })()'); console.log('[hb]', T(), 'answered in', Date.now() - t, 'ms', JSON.stringify(r)); } catch (err) { console.log('[hb]', T(), 'error', err.message); }
    busy = false;
  }, 3000);
  setTimeout(() => { console.log('done', T()); app.quit(); }, +(process.env.DUR || 60) * 1000);
});
