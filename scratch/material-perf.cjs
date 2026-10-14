// GPU time of the body pass: plain metal vs four heavy materials marbled, with rings and serpent (vsync off)
//   WAV=<abs wav> W=520 ./node_modules/.bin/electron scratch/material-perf.cjs [--user-data-dir=<dir>]
const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('node:path'); const fs = require('node:fs');
app.commandLine.appendSwitch('disable-gpu-vsync'); app.commandLine.appendSwitch('disable-frame-rate-limit');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(ipcMain, app);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const W = +(process.env.W || 520);
  const w = new BrowserWindow({ show: true, x: -3000, y: 0, width: W, height: W, backgroundColor: '#000', skipTaskbar: true, focusable: false, webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '1', ui: '0' } });
  const wav = fs.readFileSync(process.env.WAV).subarray(44), mono = new Int16Array(wav.buffer, wav.byteOffset, wav.length >> 1);
  let pos = 0; const t0 = Date.now();
  setInterval(() => { const want = Math.floor((Date.now() - t0) / 1000 * 48000); while (pos + 960 <= mono.length && pos < want) { const b = Buffer.alloc(3840); for (let i = 0; i < 960; i++) { b.writeInt16LE(mono[pos + i], i * 4); b.writeInt16LE(mono[pos + i], i * 4 + 2); } w.webContents.send('pcm', b); pos += 960; } if (pos + 960 > mono.length) pos = 0; }, 20);
  const js = (c) => w.webContents.executeJavaScript(c);
  await js('window.__noBurst = true'); await sleep(3000);
  const measure = async (label, code) => {
    await js(code); await sleep(2500);
    await js('window.__gpuT = true; window.__gpuStats(); 1'); await sleep(3000);
    console.log(label.padEnd(44), await js('JSON.stringify(window.__gpuStats())'));
  };
  await measure('metal only', "window.__matSlots = { ids: [0,0,0,0], w: [1,0,0,0] }; window.__flourish.force({ ring: 0, ser: 0 })");
  await measure('fire+water+sun+moon marbled', "window.__matSlots = { ids: [6,7,13,16], w: [.25,.25,.25,.25] }; window.__behave().U.uMatMix.value = 1");
  await measure('same + rings + serpent', "window.__flourish.force({ ring: 1, ser: 1 })");
  await measure('same, soft blend (uMatMix 0)', "window.__behave().U.uMatMix.value = 0");
  app.quit();
});
