const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('node:path'); const fs = require('node:fs');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(ipcMain, app);
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: true, x: -3000, y: 0, width: 500, height: 500, backgroundColor: '#000', skipTaskbar: true, focusable: false, webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  w.webContents.on('console-message', (e) => { const m = e.message || ''; if (/rror/i.test(m) && !/brain|disk/.test(m)) console.log('[page]', m.slice(0, 300)); });
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '1' } });
  const wav = fs.readFileSync(process.env.WAV).subarray(44), mono = new Int16Array(wav.buffer, wav.byteOffset, wav.length >> 1);
  let pos = 0; const t0 = Date.now();
  setInterval(() => { const want = Math.floor((Date.now() - t0) / 1000 * 48000); while (pos < want && pos + 960 <= mono.length) { const b = Buffer.alloc(3840); for (let i = 0; i < 960; i++) { b.writeInt16LE(mono[pos + i], i * 4); b.writeInt16LE(mono[pos + i], i * 4 + 2); } w.webContents.send('pcm', b); pos += 960; } }, 20);
  const measure = () => w.webContents.executeJavaScript(`new Promise(res => { const xs = [], sh = [], t0 = performance.now(); const f = () => { xs.push(+window.__probeU('uScale')); sh.push(+window.__probeU('uShellR')); if (performance.now() - t0 < 6000) requestAnimationFrame(f); else { let d = 0, ds = 0; for (let i = 1; i < xs.length; i++) { d += Math.abs(xs[i] - xs[i - 1]); ds += Math.abs(sh[i] - sh[i - 1]); } res({ scaleMotion: +(d / xs.length * 1000).toFixed(2), shellMotion: +(ds / sh.length * 1000).toFixed(2), mat: window.__rest ? null : null }); } }; requestAnimationFrame(f); })`);
  await new Promise((r) => setTimeout(r, 8000));
  console.log('bounce on ', JSON.stringify(await measure()));
  w.webContents.send('bounce', false); await new Promise((r) => setTimeout(r, 1000));
  console.log('bounce off', JSON.stringify(await measure()));
  app.quit();
});
