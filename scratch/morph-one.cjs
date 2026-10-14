// render one song character with the grown skin, optionally with uniforms forced (FORCE='{"uSkinA":0}'), crop the body
const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('node:path'); const fs = require('node:fs');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(ipcMain, app);
const CHAR = JSON.parse(process.env.CHAR), SEED = +(process.env.SEED || 1), OUT = process.env.OUT || 'one';
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: true, x: -3000, y: 0, width: 900, height: 900, backgroundColor: '#000', skipTaskbar: true, focusable: false, webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  w.webContents.on('console-message', (e) => { const m = e.message || ''; if (/rror/.test(m) && !/brain/.test(m)) console.log('[page]', m.slice(0, 400)); });
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '1' } });
  w.webContents.send('look', { light: 'being', finish: 'chrome', fx: { spikes: false, rings: false, film: false, sparks: false }, lobes: 'being', offset: 40, hud: false, tune: {} });
  const wav = fs.readFileSync(process.env.WAV).subarray(44), mono = new Int16Array(wav.buffer, wav.byteOffset, wav.length >> 1);
  let pos = 0; const t0 = Date.now();
  setInterval(() => { const want = Math.floor((Date.now() - t0) / 1000 * 48000); while (pos < want && pos + 960 <= mono.length) { const b = Buffer.alloc(3840); for (let i = 0; i < 960; i++) { b.writeInt16LE(mono[pos + i], i * 4); b.writeInt16LE(mono[pos + i], i * 4 + 2); } w.webContents.send('pcm', b); pos += 960; } }, 20);
  await new Promise((r) => setTimeout(r, 2500));
  console.log(await w.webContents.executeJavaScript(`window.__morphForce(${JSON.stringify(CHAR)}, ${SEED}, 1)`));
  if (process.env.FORCE) await w.webContents.executeJavaScript(`window.__force = ${process.env.FORCE}; 1`);
  for (const at of (process.env.SHOTS || '5').split(',').map(Number)) {
    await new Promise((r) => setTimeout(r, at * 1000));
    fs.writeFileSync(path.join(__dirname, `${OUT}-${at}.png`), (await w.webContents.capturePage()).toPNG());
  }
  console.log(await w.webContents.executeJavaScript('JSON.stringify(window.__morph())'));
  app.quit();
});
