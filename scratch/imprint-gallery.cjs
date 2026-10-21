// the song skin with element imprints pinned (lab): scratch/imp-<name>.png
const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('node:path'); const fs = require('node:fs');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(ipcMain, app);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SETS = { fire: [.55,0,0,0,0,0,0,0,0,0,0], water: [0,.55,0,0,0,0,0,0,0,0,0], earth: [0,0,0,.55,0,0,0,0,0,0,0], mix: [.3,.25,.1,.3,.15,0,.2,0,.1,.15,.2] };
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: true, x: -3000, y: 0, width: 600, height: 600, backgroundColor: '#000', skipTaskbar: true, focusable: false, webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  w.webContents.on('console-message', (e) => { if (/ERROR/.test(e.message)) console.log('[page]', e.message.slice(0, 400)); });
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '0', ui: '0', showcase: '1' } });
  await sleep(3500);
  await w.webContents.executeJavaScript("window.__showcase.go(2); window.__noBurst = true; window.__force = { uMorphA: 1.3, uSkinA: 0 }; window.__fractal(0)");
  for (const [name, v] of Object.entries(SETS)) {
    await w.webContents.executeJavaScript(`window.__imprint = ${JSON.stringify(v)}`); await sleep(2600);
    fs.writeFileSync(path.join(__dirname, `imp-${name}.png`), (await w.webContents.capturePage()).toPNG()); console.log(name);
  }
  app.quit();
});
