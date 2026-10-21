// full screen (black), the page side, on a wide window: at rest, absorbed, the sun, a peak -> scratch/imm-N.png
const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('node:path'); const fs = require('node:fs');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(ipcMain, app);
ipcMain.on('ml-get', (e) => { e.returnValue = null; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 960, height: 540, backgroundColor: '#000', webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false, offscreen: true } });
  w.webContents.setFrameRate(60);
  w.webContents.on('console-message', (e) => { const m = e.message || ''; if (/Uncaught|rror:/.test(m)) console.log('[page]', m.slice(0, 600)); });
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '0', showcase: '1' } });
  for (let i = 0; i < 60 && !(await w.webContents.executeJavaScript('!!window.__showcase')); i++) await sleep(500);
  const js = (s) => w.webContents.executeJavaScript(s);
  await js("window.__showcase.go(2); window.__noBurst = true; setTimeout(() => { dispatchEvent(new KeyboardEvent('keydown', { key: ' ' })); window.__showcase.api.devCommand({ k: 'material', v: 0 }); window.__journey({ mode: 'off' }); window.__rise({ mode: 'off' }); window.__immersive(true); }, 2500)");
  const shot = async (n) => fs.writeFileSync(path.join(__dirname, `imm-${n}.png`), (await w.webContents.capturePage()).toPNG());
  await sleep(9000); await shot('0-rest');
  await js("window.__journey({ mode: 'hold', j: 0, t: 1, p: 0 })"); await sleep(9000); await shot('1-absorbed'); console.log('absorbed', await js("(() => { const b = window.__being(); return JSON.stringify({ R: b.U.uMaskR.value, zoom: b.FB.uZoom.value, decay: b.FB.uDecay.value, gain: b.FB.uGain.value, flow: b.FB.uFlow.value }); })()"));
  await js("window.__journey({ mode: 'off' }); window.__showcase.api.devCommand({ k: 'material', v: 13 })"); await sleep(9000); await shot('2-sun');
  await js("window.__journey({ mode: 'hold', j: 1, t: 1, p: 1 }); window.__showcase.api.devCommand({ k: 'material', v: 16 })"); await sleep(9000); await shot('3-peak');
  await js("window.__journey({ mode: 'off' }); window.__immersive(false)"); await sleep(5000); await shot('4-back');
  app.quit();
});
