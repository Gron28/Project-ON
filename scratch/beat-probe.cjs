// what beat does the body show on real music: felt tempo vs tracker, predicted vs heard hits per second
const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('node:path'); const fs = require('node:fs');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(ipcMain, app);
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: true, x: -3000, y: 0, width: 600, height: 600, backgroundColor: '#000', skipTaskbar: true, focusable: false, webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '1' } });
  const wav = fs.readFileSync(process.env.WAV).subarray(44), mono = new Int16Array(wav.buffer, wav.byteOffset, wav.length >> 1);
  let pos = 0; const t0 = Date.now();
  setInterval(() => { const want = Math.floor((Date.now() - t0) / 1000 * 48000); while (pos < want && pos + 960 <= mono.length) { const b = Buffer.alloc(3840); for (let i = 0; i < 960; i++) { b.writeInt16LE(mono[pos + i], i * 4); b.writeInt16LE(mono[pos + i], i * 4 + 2); } w.webContents.send('pcm', b); pos += 960; } }, 20);
  for (let k = 1; k <= 8; k++) {
    await w.webContents.executeJavaScript("window.__hc = { pkick: 0, psnare: 0, phat: 0, hkick: 0, hsnare: 0, hhat: 0 }; 1");
    await new Promise((r) => setTimeout(r, 5000));
    const o = await w.webContents.executeJavaScript("({ hc: window.__hc, t: window.__timingInfo() })");
    const r = (x) => (x / 5).toFixed(1);
    console.log(`${k * 5}s feel ${o.t.bpm} bpm lock ${o.t.lock} gate ${o.t.gate} | per s: predicted k${r(o.hc.pkick)} s${r(o.hc.psnare)} h${r(o.hc.phat)} | heard k${r(o.hc.hkick)} s${r(o.hc.hsnare)} h${r(o.hc.hhat)}`);
  }
  app.quit();
});
