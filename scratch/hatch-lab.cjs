const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('node:path'); const fs = require('node:fs');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(ipcMain, app);
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: true, x: -3000, y: 0, width: 520, height: 520, backgroundColor: '#000', skipTaskbar: true, focusable: false, webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  w.webContents.on('console-message', (e) => { const m = e.message || ''; if (/rror|hatch|warn/i.test(m) && !/brain|disk/.test(m)) console.log('[page]', m.slice(0, 300)); });
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '1', ui: '0' } });
  const wav = fs.readFileSync(process.env.WAV).subarray(44), mono = new Int16Array(wav.buffer, wav.byteOffset, wav.length >> 1);
  let pos = 0; const t0 = Date.now();
  setInterval(() => { const want = Math.floor((Date.now() - t0) / 1000 * 48000); while (pos < want && pos + 960 <= mono.length) { const b = Buffer.alloc(3840); for (let i = 0; i < 960; i++) { b.writeInt16LE(mono[pos + i], i * 4); b.writeInt16LE(mono[pos + i], i * 4 + 2); } w.webContents.send('pcm', b); pos += 960; } }, 20);
  const shot = async (name) => fs.writeFileSync(path.join(__dirname, `hatch-${name}.png`), (await w.webContents.capturePage()).toPNG());
  await new Promise((r) => setTimeout(r, 6000));
  await shot('0'); w.webContents.send('new-seed'); const h0 = Date.now();
  for (const at of [500, 1200, 1700, 2500, 3500, 5000]) { await new Promise((r) => setTimeout(r, at - (Date.now() - h0))); await shot(String(at)); }
  // a forced skin change: frames right after and 1 s later
  await w.webContents.executeJavaScript(`window.__morphForce({ intricacy: .9, change: .9, regularity: .1 }, 77, 1); 1`);
  await new Promise((r) => setTimeout(r, 250)); await shot('f0'); await new Promise((r) => setTimeout(r, 700)); await shot('f1'); await new Promise((r) => setTimeout(r, 1500)); await shot('f2');
  app.quit();
});
