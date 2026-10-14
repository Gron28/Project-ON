// shakiness: mean |second difference| per frame of size and position (jerkiness), and how much slow motion there is
const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('node:path'); const fs = require('node:fs');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(ipcMain, app);
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: true, x: -3000, y: 0, width: 500, height: 500, backgroundColor: '#000', skipTaskbar: true, focusable: false, webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  w.webContents.on('console-message', (e) => { const m = e.message || ''; if (/rror/i.test(m) && !/brain|disk/.test(m)) console.log('[page]', m.slice(0, 300)); });
  await w.loadFile(path.join(ROOT, 'being', process.env.PAGE || 'index.html'), { query: { local: '1' } });
  await w.webContents.executeJavaScript("if (!window.__probeU) window.__probeU = () => 0; 1");
  const wav = fs.readFileSync(process.env.WAV).subarray(44), mono = new Int16Array(wav.buffer, wav.byteOffset, wav.length >> 1);
  let pos = 0; const t0 = Date.now();
  setInterval(() => { const want = Math.floor((Date.now() - t0) / 1000 * 48000); while (pos < want && pos + 960 <= mono.length) { const b = Buffer.alloc(3840); for (let i = 0; i < 960; i++) { b.writeInt16LE(mono[pos + i], i * 4); b.writeInt16LE(mono[pos + i], i * 4 + 2); } w.webContents.send('pcm', b); pos += 960; } }, 20);
  await new Promise((r) => setTimeout(r, 12000));
  const r = await w.webContents.executeJavaScript(`new Promise(res => { const s = [], x = [], y = [], sh = [], t0 = performance.now(); const f = () => { s.push(+window.__probeU('uScale')); sh.push(+window.__probeU('uShellR')); const v = window.__probeShift ? window.__probeShift() : [0, 0]; x.push(v[0]); y.push(v[1]); if (performance.now() - t0 < 10000) requestAnimationFrame(f); else { const j = (a) => { let d = 0; for (let i = 2; i < a.length; i++) d += Math.abs(a[i] - 2 * a[i - 1] + a[i - 2]); return +(d / a.length * 1e4).toFixed(2); }; const m = (a) => { let d = 0; for (let i = 1; i < a.length; i++) d += Math.abs(a[i] - a[i - 1]); return +(d / a.length * 1e3).toFixed(2); }; res({ jerk: { scale: j(s), shell: j(sh), x: j(x), y: j(y) }, motion: { scale: m(s), x: m(x), y: m(y) } }); } }; requestAnimationFrame(f); })`);
  console.log((process.env.PAGE || 'now').padEnd(26), JSON.stringify(r));
  app.quit();
});
