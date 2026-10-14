const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('node:path'); const fs = require('node:fs');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(ipcMain, app);
const PLAN = (process.env.PLAN || 'shot@6,beads@8,shot@8.5,shot@9.2,shot@11,shot@14,beads@15,shot@15.6,shot@17').split(',').map((x) => { const [a, t] = x.split('@'); return { a, t: +t }; });
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: true, x: -3000, y: 0, width: 900, height: 900, backgroundColor: '#000', skipTaskbar: true, focusable: false, webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  w.webContents.on('console-message', (e) => { const m = e.message || ''; if (/rror|warn/i.test(m) && !/brain/.test(m)) console.log('[page]', m.slice(0, 700)); });
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '1' } });
  w.webContents.send('look', { light: 'being', finish: 'chrome', fx: { spikes: true, rings: true, film: false, sparks: true }, lobes: 'being', offset: 40, hud: false, tune: {} });
  const wav = fs.readFileSync(process.env.WAV).subarray(44), mono = new Int16Array(wav.buffer, wav.byteOffset, wav.length >> 1);
  let pos = 0; const t0 = Date.now();
  setInterval(() => { const want = Math.floor((Date.now() - t0) / 1000 * 48000); while (pos < want && pos + 960 <= mono.length) { const b = Buffer.alloc(3840); for (let i = 0; i < 960; i++) { b.writeInt16LE(mono[pos + i], i * 4); b.writeInt16LE(mono[pos + i], i * 4 + 2); } w.webContents.send('pcm', b); pos += 960; } }, 20);
  if (process.env.CHAR) { await new Promise((r) => setTimeout(r, 1500)); await w.webContents.executeJavaScript(`window.__morphForce(${process.env.CHAR}, ${process.env.SEED || 5}, 1); 1`); }
  const start = Date.now(); let k = 0;
  for (const step of PLAN) {
    const wait = step.t * 1000 - (Date.now() - start); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (step.a === 'shot') { fs.writeFileSync(path.join(__dirname, `beads-${process.env.TAG || ''}${String(k++).padStart(2, '0')}.png`), (await w.webContents.capturePage()).toPNG()); console.log('shot', step.t, await w.webContents.executeJavaScript('JSON.stringify({ b: window.__beadInfo(), r: window.__rest() })')); }
    else console.log(step.a, step.t, await w.webContents.executeJavaScript(`window.__${step.a}()`));
  }
  app.quit();
});
