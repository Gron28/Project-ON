// one screenshot per fractal kind on the body's skin (ONLY=0,3,...) -> scratch/frac-NN.png
const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('node:path'); const fs = require('node:fs');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(ipcMain, app);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: true, x: -3000, y: 0, width: 600, height: 600, backgroundColor: '#000', skipTaskbar: true, focusable: false, webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  w.webContents.on('console-message', (e) => { if (/error|ERROR/.test(e.message)) console.log('[page]', e.message.slice(0, 500)); });
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '0', ui: '0', showcase: '1' } });   // the silent showcase music keeps it awake
  await sleep(3500);
  await w.webContents.executeJavaScript('window.__showcase.go(2); window.__noBurst = true; window.__force = { uMorphA: 1.2, uSkinA: 0 }');
  for (const k of (process.env.ONLY || '0,1,2,3,4,5,6,7,8,9,10,11,12,13,14').split(',').map(Number)) {
    const info = await w.webContents.executeJavaScript(`window.__fractal(${k})`); await sleep(+(process.env.DWELL || 3200));
    fs.writeFileSync(path.join(__dirname, `frac-${String(k).padStart(2, '0')}.png`), (await w.webContents.capturePage()).toPNG()); console.log(k, info);
  }
  app.quit();
});
