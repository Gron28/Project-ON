// paced breathing mode off-screen: short timings, one capture per phase -> scratch/breathe-<phase>.png
const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('node:path'); const fs = require('node:fs');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(ipcMain, app);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: true, x: -3000, y: 0, width: 560, height: 560, backgroundColor: '#000', skipTaskbar: true, focusable: false, webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  w.webContents.on('console-message', (e) => { if (/ERROR|Uncaught/.test(e.message)) console.log('[page]', e.message.slice(0, 300), 'line', e.lineNumber); });
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '0', ui: '0', showcase: '1' } });
  await sleep(4000);
  await w.webContents.executeJavaScript("window.__showcase.go(14); window.__breathe({ on: true, cues: false, cfg: { out: 3, in: 3, hold: 3 } })");
  const t0 = Date.now();
  for (const [name, at] of [['ready', 2.5], ['out-left', 5.6], ['in-left', 8.6], ['hold', 11.6], ['out-right', 14.6]]) {
    await sleep(Math.max(0, at * 1000 - (Date.now() - t0)));
    const st = await w.webContents.executeJavaScript('JSON.stringify(window.__breathe())');
    fs.writeFileSync(path.join(__dirname, `breathe-${name}.png`), (await w.webContents.capturePage()).toPNG()); console.log(name, st);
  }
  app.quit();
});
