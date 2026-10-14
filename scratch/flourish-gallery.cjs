// the being's flourishes on music: rings, serpent, glints/star, glistening, and each material's particles
//   WAV=<abs 48 kHz mono wav> ./node_modules/.bin/electron scratch/flourish-gallery.cjs [--user-data-dir=<dir>]
const { app, BrowserWindow } = require('electron'); const path = require('node:path'); const fs = require('node:fs');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(require('electron').ipcMain, app);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: true, x: -3000, y: 0, width: 640, height: 640, backgroundColor: '#000', skipTaskbar: true, focusable: false, webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  w.webContents.on('console-message', (e) => { if (/error|uncaught/i.test(e.message)) console.log('[page]', e.message.slice(0, 600)); });
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '1', ui: '0' } });
  w.webContents.send('look', { light: 'being', finish: 'chrome', fx: { spikes: true, rings: true, film: false, sparks: true }, lobes: 'being', offset: 40, hud: false, tune: {} });
  const wav = fs.readFileSync(process.env.WAV).subarray(44), mono = new Int16Array(wav.buffer, wav.byteOffset, wav.length >> 1);
  let pos = 0; const t0 = Date.now();
  const feeder = setInterval(() => { const want = Math.floor((Date.now() - t0) / 1000 * 48000); while (pos + 960 <= mono.length && pos < want) { const b = Buffer.alloc(3840); for (let i = 0; i < 960; i++) { b.writeInt16LE(mono[pos + i], i * 4); b.writeInt16LE(mono[pos + i], i * 4 + 2); } w.webContents.send('pcm', b); pos += 960; } if (pos + 960 > mono.length) pos = 0; }, 20);
  const js = (c) => w.webContents.executeJavaScript(c);
  await js('window.__noBurst = true'); await sleep(5000);
  const shot = async (name) => { fs.writeFileSync(path.join(__dirname, name), (await w.webContents.capturePage()).toPNG()); console.log(name, await js('JSON.stringify(window.__flourish.state())')); };
  const mat = (v) => w.webContents.send('dev-cmd', { k: 'material', v });
  mat(0); await js('window.__flourish.force({ ring: 1, ser: 0 })'); await sleep(4500); await shot('flo-rings.png');
  await js('window.__flourish.force({ ring: 0, ser: 1 })'); await sleep(3500); await shot('flo-serpent.png');
  await js('window.__flourish.force({ ring: 1, ser: 1 })'); await sleep(3500); await shot('flo-both.png');
  await js('window.__flourish.force({ ring: 0, ser: 0 })');
  await js("window.__flourish.glint('star', 1)"); await sleep(250); await shot('flo-star.png');
  await sleep(1500); await js("window.__flourish.glint('glisten', 1)"); await sleep(300); await shot('flo-glisten.png');
  for (const [v, n] of [[6, 'fire'], [7, 'water'], [14, 'venus'], [8, 'air'], [13, 'sun']]) { mat(v); await sleep(3500); await shot(`flo-particles-${n}.png`); }
  mat(-1); await js('window.__flourish.force({ ring: undefined, ser: undefined })');
  clearInterval(feeder); app.quit();
});
