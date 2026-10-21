// the showcase's rising / absorption / journey steps in the real page -> scratch/journey-<step>.png. FIND=regex over captions, DWELL=ms
const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('node:path'); const fs = require('node:fs');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(ipcMain, app);
ipcMain.on('ml-get', (e) => { e.returnValue = null; });   // the page reads its model settings synchronously at start
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 700, height: 700, backgroundColor: '#000', webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false, offscreen: true } });
  w.webContents.setFrameRate(60);
  w.webContents.on('console-message', (e) => { const m = e.message || ''; if (/rror|showcase|Uncaught|THREE/.test(m) && !/\[showcase\]/.test(m)) console.log('[page]', m.slice(0, 1500)); });
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '0', showcase: '1' } });
  for (let i = 0; i < 60 && !(await w.webContents.executeJavaScript('!!window.__showcase')); i++) await sleep(500);
  const caps = await w.webContents.executeJavaScript('window.__showcase ? window.__showcase.steps : null');
  if (!caps) { console.log('no showcase'); app.quit(); return; }
  await w.webContents.executeJavaScript('window.__showcase.go(2)'); await sleep(8000);   // a groove first, so it is awake and locked
  if (process.env.SEQ) {   // SEQ='<caption regex>' EVERY=s N=frames: a sequence through one step
    const i = caps.findIndex((c) => new RegExp(process.env.SEQ).test(c));
    await w.webContents.executeJavaScript(`window.__showcase.go(${i})`);
    for (let k = 0; k < +(process.env.N || 8); k++) {
      await sleep(+(process.env.EVERY || 6) * 1000);
      fs.writeFileSync(path.join(__dirname, `seq-${String(k).padStart(2, '0')}.png`), (await w.webContents.capturePage()).toPNG());
      console.log(k, JSON.stringify(await w.webContents.executeJavaScript('[window.__rise().k, window.__being().U.uRise.value, window.__rise().mix]')));
    }
    app.quit(); return;
  }
  const re = new RegExp(process.env.FIND || 'rising|absorption|journey|everything at once');
  for (const [i, c] of caps.entries()) if (re.test(c)) {
    await w.webContents.executeJavaScript(`window.__showcase.go(${i})`); await sleep(+(process.env.DWELL || 7000));
    const fps = await w.webContents.executeJavaScript('new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else r(n); }; requestAnimationFrame(f); })');
    fs.writeFileSync(path.join(__dirname, `journey-${String(i).padStart(2, '0')}.png`), (await w.webContents.capturePage()).toPNG());
    console.log(i, c.slice(0, 70), 'fps', fps, JSON.stringify(await w.webContents.executeJavaScript('[window.__rise().k, window.__being().U.uRise.value, window.__rise().mix]')));
  }
  app.quit();
});
