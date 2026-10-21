// the same form for three different songs (three seeds) -> scratch/songform-<form>-<n>.png
const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('node:path'); const fs = require('node:fs');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(ipcMain, app);
ipcMain.on('ml-get', (e) => { e.returnValue = null; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FORMS = ['bloom', 'crystal', 'foam', 'sponge', 'julia', 'geometry', 'coral', 'lattice'];
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 480, height: 480, backgroundColor: '#000', webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false, offscreen: true } });
  w.webContents.setFrameRate(60);
  w.webContents.on('console-message', (e) => { const m = e.message || ''; if (/rror|Uncaught/.test(m)) console.log('[page]', m.slice(0, 900)); });
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '0', showcase: '1' } });
  for (let i = 0; i < 60 && !(await w.webContents.executeJavaScript('!!window.__showcase')); i++) await sleep(500);
  const js = (s) => w.webContents.executeJavaScript(s);
  await js("window.__showcase.go(2); window.__noBurst = true; setTimeout(() => { dispatchEvent(new KeyboardEvent('keydown', { key: ' ' })); window.__showcase.api.devCommand({ k: 'material', v: 0 }); }, 2500)"); await sleep(5000);
  const seeds = [[.1, .2, .3, .8], [.55, .9, .1, .4], [.9, .5, .7, .1]];
  for (const f of (process.env.ONLY || 'bloom,crystal,julia,coral').split(',')) for (const [n, sd] of seeds.entries()) {
    const i = FORMS.indexOf(f), mix = FORMS.map((_, k) => (k === i ? 1 : 0));
    await js(`window.__rise({ mode: 'hold', t: .8, e: 0 }); window.__riseMix = ${JSON.stringify(mix)}; window.__force = { uRise: .8, uRiseSeed: ${JSON.stringify(sd)} }`); await sleep(3000);
    const im = await w.webContents.capturePage(); fs.writeFileSync(path.join(__dirname, `songform-${f}-${n}.png`), im.toPNG());
  }
  app.quit();
});
