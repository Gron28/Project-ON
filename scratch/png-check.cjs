const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('node:path'); const fs = require('node:fs');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(ipcMain, app);
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: true, x: -3000, y: 0, width: 600, height: 600, backgroundColor: '#000', skipTaskbar: true, focusable: false, webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  w.webContents.on('console-message', (e) => { const m = e.message || ''; if (/rror/.test(m) && !/brain/.test(m)) console.log('[page]', m.slice(0, 300)); });
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '1' } });
  await new Promise((r) => setTimeout(r, 2000));
  for (const [i, c] of [{ tonality: .95, harmony: .9, intricacy: .8, regularity: .9 }, { intricacy: .95, change: .9, tonality: .9, harmony: .9, regularity: .8 }, { noisiness: .9, intricacy: .8, change: .8 }].entries()) {
    await w.webContents.executeJavaScript(`window.__morphForce(${JSON.stringify(c)}, ${40 + i}, 1); 1`);
    await new Promise((r) => setTimeout(r, 1500));
    const url = await w.webContents.executeJavaScript('window.__songPng()');
    fs.writeFileSync(path.join(__dirname, `memory-png-${i}.png`), Buffer.from(url.slice(22), 'base64'));
    console.log('png', i, url.length);
  }
  app.quit();
});
