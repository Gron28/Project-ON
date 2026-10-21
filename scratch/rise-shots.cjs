// the rising forms in the real page: one screenshot per form (hold) -> scratch/rise-<form>-<e>.png. ONLY=4,5 E=0,.85 DWELL=ms
const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('node:path'); const fs = require('node:fs');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(ipcMain, app);
ipcMain.on('ml-get', (e) => { e.returnValue = null; });   // the page reads its model settings synchronously at start
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NAMES = ['bloom', 'crystal', 'foam', 'sponge', 'julia', 'geometry', 'coral', 'lattice'];
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 600, height: 600, backgroundColor: '#000', skipTaskbar: true, focusable: false, webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false, offscreen: true } }); w.webContents.setFrameRate(60);
  w.webContents.on('console-message', (e) => { if (/error|ERROR|THREE/.test(e.message)) console.log('[page]', e.message.slice(0, 1500)); });
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '0', ui: '0', showcase: '1' } });
  for (let i = 0; i < 60 && !(await w.webContents.executeJavaScript('!!window.__showcase')); i++) await sleep(500);   // the showcase's music loads async
  console.log('showcase', await w.webContents.executeJavaScript('!!window.__showcase'));
  await w.webContents.executeJavaScript("window.__showcase && window.__showcase.go(2); window.__noBurst = true; setTimeout(() => dispatchEvent(new KeyboardEvent('keydown', { key: ' ' })), 2500)"); await sleep(3000);   // a groove, then the tour paused so nothing else changes
  // MIXES: ';'-separated lists of 8 weights (bloom crystal foam sponge julia geometry coral lattice); otherwise one form each (ONLY)
  const mixes = process.env.MIXES ? process.env.MIXES.split(';').map((m) => m.split(',').map(Number)) : (process.env.ONLY || '0,1,2,3,4,5,6,7').split(',').map((k) => NAMES.map((_, i) => (i === +k ? 1 : 0)));
  for (const [mi, mix] of mixes.entries()) for (const e of (process.env.E || '0,.85').split(',').map(Number)) {
    await w.webContents.executeJavaScript(`window.__rise({ mode: 'hold', t: 1, e: ${e} }); window.__riseMix = ${JSON.stringify(mix)}; window.__force = { uRise: ${process.env.K || 1}, uEther: ${e}, uAwake: 1 }`);   // pinned: with no music it would be asleep, and asleep it stays in its sphere
    await sleep(+(process.env.DWELL || 6000));
    const name = mix.map((x, i) => (x > 0 ? NAMES[i] + (x < 1 ? x : '') : '')).filter(Boolean).join('+');
    fs.writeFileSync(path.join(__dirname, `rise-${process.env.MIXES ? 'mix' + mi : name}-${e}.png`), (await w.webContents.capturePage()).toPNG()); console.log(mi, name, e, JSON.stringify((await w.webContents.executeJavaScript('window.__rise()')).mix));
  }
  app.quit();
});
