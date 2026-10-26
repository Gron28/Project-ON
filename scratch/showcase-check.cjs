// jump through every showcase step off-screen: a screenshot each (scratch/show-NN.png) and any page errors
//   ./node_modules/.bin/electron scratch/showcase-check.cjs [--user-data-dir=<dir>]   (DWELL=ms per step, default 2500)
const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('node:path'); const fs = require('node:fs');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(ipcMain, app);
require('electron').ipcMain.handle('page-schema', () => []);   // the preload asks main for the tuning schema
require('electron').ipcMain.on('ml-get', (e) => { e.returnValue = null; });   // the page reads its model settings synchronously at start
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: true, x: -3000, y: 0, width: 640, height: 640, backgroundColor: '#000', skipTaskbar: true, focusable: false, webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  w.webContents.on('console-message', (e) => { if (/error|uncaught|showcase step/i.test(e.message)) console.log('[page]', e.message.slice(0, 400)); });
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '0', ui: '0', showcase: '1' } });
  await sleep(3000);
  const steps = await w.webContents.executeJavaScript('window.__showcase.steps');
  for (let i = 0; i < steps.length; i++) {
    await w.webContents.executeJavaScript(`window.__showcase.go(${i})`);
    await sleep(+(process.env.DWELL || 2500));
    fs.writeFileSync(path.join(__dirname, `show-${String(i).padStart(2, '0')}.png`), (await w.webContents.capturePage()).toPNG());
    console.log(i, steps[i]);
  }
  app.quit();
});
