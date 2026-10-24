// GPU time per pass (window.__gpuStats) and frame rate on the real GPU, vsync off, governor off at full resolution, in several states.
// [WAV=<abs 48 kHz mono wav>] [SIZE=px] [LABEL=name] ./node_modules/.bin/electron scratch/perf-baseline.cjs  -> prints and appends scratch/perf/<LABEL>.json
const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('node:path'); const fs = require('node:fs'); const os = require('node:os');

const ROOT = path.join(__dirname, '..');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'on-perf-')));
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(ipcMain, app);
ipcMain.on('ml-get', (e) => { e.returnValue = null; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t00 = Date.now(); app.on('child-process-gone', (e, d) => console.log('[gone]', ((Date.now() - t00) / 1000).toFixed(1), d.type, d.reason, d.exitCode)); app.whenReady().then(async () => {
  console.log('gpu', JSON.stringify((await app.getGPUInfo('basic')).gpuDevice?.map((g) => g.deviceString || g.vendorId)));
  const S = +(process.env.SIZE || 800);
  const w = new BrowserWindow({ show: true, x: +(process.env.X ?? -3000), y: 0, width: S, height: S, backgroundColor: '#000', skipTaskbar: true, focusable: false, webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  w.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 3 || /uncaught/i.test(e.message)) console.log('[page]', ((Date.now() - t00) / 1000).toFixed(1), String(e.message).slice(0, 80)); });
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '0', ui: '0' } });
  console.log('loaded', ((Date.now() - t00) / 1000).toFixed(1)); if (process.env.NOBURST) await w.webContents.executeJavaScript('window.__noBurst = true; 1'); w.webContents.on('console-message', (e) => { if (/burst|bead/i.test(e.message)) console.log('[page]', ((Date.now() - t00) / 1000).toFixed(1), e.message.slice(0, 120)); }); w.webContents.send('track', { key: 'perf-lab|synth', title: 'synth', artist: 'lab', app: 'lab' });
  const mono = (() => { const d = fs.readFileSync(process.env.WAV || path.join(__dirname, 'synth-120.wav')).subarray(44); return new Int16Array(d.buffer, d.byteOffset, d.length >> 1); })();
  let pos = 0; const t0 = Date.now();
  const tm = setInterval(() => { const want = Math.floor((Date.now() - t0) / 1000 * 48000); while (pos + 960 <= want) { const b = Buffer.alloc(3840); for (let i = 0; i < 960; i++) { const v = mono[(pos + i) % mono.length]; b.writeInt16LE(v, i * 4); b.writeInt16LE(v, i * 4 + 2); } w.webContents.send('pcm', b); pos += 960; } }, 20);
  const js = (s) => w.webContents.executeJavaScript(s);
  await sleep(+(process.env.WARM || 10000));
  console.log('slept', ((Date.now() - t0) / 1000).toFixed(1)); const RES = +(process.env.RES || 0); await js('window.__noBurst = true; ' + (RES ? 'Object.assign(window.__qual, { auto: false, res: ' + RES + ', k: ' + RES + ' }); dispatchEvent(new Event("resize"));' : '') + ' window.__fc = 0; (function f(){ window.__fc++; requestAnimationFrame(f); })(); 1');
  console.log('warm', ((Date.now() - t0) / 1000).toFixed(1)); const out = {};
  const measure = async (label, setup) => {
    await js(setup + '; 1'); await sleep(2500);
    await js('window.__gpuT = true; window.__gpuStats(); window.__fc = 0; 1'); await sleep(4000);
    const s = await js('({ g: window.__gpuStats(), fps: window.__fc / 4, frameMs: window.__being().frameMs })');
    out[label] = s;
    console.log(label.padEnd(24), 'fps', s.fps.toFixed(0), Object.entries(s.g).sort((a, b) => b[1].median - a[1].median).map(([k, v]) => `${k} ${v.median}/${v.p90}`).join(' | '));
  };
  await measure('groove', '');
  await measure('cellab surface+inside', "window.__cellab.show('surface', 60); window.__cellab.show('inside', 60)");
  await measure('beads', 'window.__beads()');
  await measure('beads off', 'window.__beads()');
  fs.mkdirSync(path.join(__dirname, 'perf'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'perf', (process.env.LABEL || 'baseline') + '.json'), JSON.stringify(out, null, 1));
  clearInterval(tm); app.quit();
});
