// Lab: on a GPU that links on its own thread (BODY.stall), the body's shared elements variant: water and fire pinned, music,
// silence until it sleeps (the variant compiles), music again. Run twice with the same UD to see it come back warm.
// UD=<dir> timeout 120 ./node_modules/.bin/electron.cmd scratch/elements-probe.cjs
const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('node:path'); const fs = require('node:fs'); const os = require('node:os');
const ROOT = path.join(__dirname, '..');
if (process.platform === 'win32') app.commandLine.appendSwitch('use-angle', 'gl');
app.setPath('userData', process.env.UD || fs.mkdtempSync(path.join(os.tmpdir(), 'on-el-')));
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(ipcMain, app);
ipcMain.on('ml-get', (e) => { e.returnValue = null; });
const t00 = Date.now(), T = () => ((Date.now() - t00) / 1000).toFixed(1);
app.on('child-process-gone', (e, d) => console.log('[gone]', T(), d.type, d.reason, d.exitCode));
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: true, x: 0, y: 0, width: 600, height: 600, backgroundColor: '#000', webPreferences: { preload: path.join(__dirname, 'gl-probe-preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  w.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 'warning' || e.level === 3 || e.level === 2) console.log('[page]', T(), String(e.message).slice(0, 200)); });
  w.webContents.on('render-process-gone', (e, d) => console.log('[renderer gone]', T(), JSON.stringify(d)));
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '0', ui: '0' } });
  w.webContents.send('track', { key: 'el|synth', title: 'synth', artist: 'lab', app: 'lab' });
  await w.webContents.executeJavaScript('window.__proposals && window.__proposals(true); window.__matSlots = { ids: [7, 6, 0, 0], w: [.6, .4, 0, 0] }; window.__fc = 0; (function f() { window.__fc++; requestAnimationFrame(f); })(); 1');
  const mono = (() => { const d = fs.readFileSync(process.env.WAV || path.join(__dirname, 'synth-120.wav')).subarray(44); return new Int16Array(d.buffer, d.byteOffset, d.length >> 1); })();
  const quiet = (s) => s >= 15 && s < 45;   // music, then silence long enough to sleep and compile, then music
  let pos = 0; const t0 = Date.now();
  setInterval(() => { const want = Math.floor((Date.now() - t0) / 1000 * 48000); while (pos + 960 <= want) { const q = quiet(pos / 48000), b = Buffer.alloc(3840); if (!q) for (let i = 0; i < 960; i++) { const v = mono[(pos + i) % mono.length]; b.writeInt16LE(v, i * 4); b.writeInt16LE(v, i * 4 + 2); } w.webContents.send('pcm', b); pos += 960; } }, 20);
  let busy = false;
  setInterval(async () => { if (busy) { console.log(T(), 'page busy'); return; } busy = true; const t = Date.now();
    try { const r = await w.webContents.executeJavaScript('JSON.stringify({ info: window.__bodyInfo(), fc: window.__fc, fm: +window.__being().frameMs.toFixed(1), q: window.__qual && { k: window.__qual.k, res: window.__qual.res, gpu: window.__qual.gpu && +window.__qual.gpu.toFixed(1) } })'); console.log(T(), `(${Date.now() - t} ms)`, r); } catch (err) { console.log(T(), 'error', err.message); }
    busy = false; }, 2500);
  setTimeout(() => app.quit(), +(process.env.DUR || 60) * 1000);
});
