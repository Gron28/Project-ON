// screenshots of chosen showcase steps (STEPS=26,27,30 DWELL=ms): scratch/show-NN.png
const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('node:path'); const fs = require('node:fs');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(ipcMain, app);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: true, x: -3000, y: 0, width: 640, height: 640, backgroundColor: '#000', skipTaskbar: true, focusable: false, webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  w.webContents.on('console-message', (e) => { if (/error|uncaught/i.test(e.message)) console.log('[page]', e.message.slice(0, 400)); });
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '0', ui: '0', showcase: '1' } });
  await sleep(3000);
  // FIND=<regex> picks the steps whose caption matches (instead of STEPS)
  const caps = await w.webContents.executeJavaScript('window.__showcase.steps');
  const list = process.env.FIND ? caps.map((c, i) => (new RegExp(process.env.FIND, 'i').test(c) ? i : -1)).filter((i) => i >= 0) : (process.env.STEPS || '26').split(',').map(Number);
  for (const i of list) {
    await w.webContents.executeJavaScript(`window.__showcase.go(${i})`); if (process.env.PRE) await w.webContents.executeJavaScript(process.env.PRE); await sleep(+(process.env.DWELL || 4000));   // PRE: page code run before the shots
    // FRAMES=n GAP=ms: a short sequence instead of one picture (show-NN-k.png)
    const nF = +(process.env.FRAMES || 1);
    for (let k = 0; k < nF; k++) { fs.writeFileSync(path.join(__dirname, `show-${String(i).padStart(2, '0')}${nF > 1 ? '-' + k : ''}.png`), (await w.webContents.capturePage()).toPNG()); if (k < nF - 1) await sleep(+(process.env.GAP || 400)); }
    console.log('step', i, caps[i], process.env.EVAL ? await w.webContents.executeJavaScript(process.env.EVAL) : '');
  }
  app.quit();
});
