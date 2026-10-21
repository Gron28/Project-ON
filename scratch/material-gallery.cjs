// render the being in each of its 17 materials (forced), then let them mix freely on music; one crop per shot
//   WAV=<abs 48 kHz mono 16-bit wav> ./node_modules/.bin/electron scratch/material-gallery.cjs [--user-data-dir=<dir>]
//   writes scratch/mat-NN-<name>.png and scratch/mat-free-K.png (MIX=0 skips the free run)
const { app, BrowserWindow } = require('electron'); const path = require('node:path'); const fs = require('node:fs');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(require('electron').ipcMain, app);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const { MATERIALS } = await import(path.join(ROOT, 'being', 'materials.mjs'));
  const w = new BrowserWindow({ show: true, x: -3000, y: 0, width: 640, height: 640, backgroundColor: '#000', skipTaskbar: true, focusable: false, webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  w.webContents.on('console-message', (e) => { if (/error/i.test(e.message)) console.log('[page]', e.message); });
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '1', ui: '0', prop: process.env.PROP || '0' } });   // PROP=1: the proposed materials
  w.webContents.send('look', { light: 'being', finish: 'chrome', fx: { spikes: true, rings: true, film: false, sparks: true }, lobes: 'being', offset: 40, hud: false, tune: {} });
  const wav = fs.readFileSync(process.env.WAV).subarray(44), mono = new Int16Array(wav.buffer, wav.byteOffset, wav.length >> 1);
  let pos = 0; const t0 = Date.now();
  const feeder = setInterval(() => { const want = Math.floor((Date.now() - t0) / 1000 * 48000); while (pos + 960 <= mono.length && pos < want) { const b = Buffer.alloc(3840); for (let i = 0; i < 960; i++) { b.writeInt16LE(mono[pos + i], i * 4); b.writeInt16LE(mono[pos + i], i * 4 + 2); } w.webContents.send('pcm', b); pos += 960; } if (pos + 960 > mono.length) pos = 0; }, 20);
  await w.webContents.executeJavaScript('window.__noBurst = true');   // keep the body whole for the portraits
  await sleep(5000);
  const shot = async (name) => fs.writeFileSync(path.join(__dirname, name), (await w.webContents.capturePage()).toPNG());
  const only = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : MATERIALS.map((_, i) => i);
  for (const i of only) {
    w.webContents.send('dev-cmd', { k: 'material', v: i });
    await sleep(2200);
    await shot(`${process.env.PROP === "1" ? "prop-" : ""}mat-${String(i).padStart(2, "0")}-${MATERIALS[i].replace(/[^a-z]+/g, '-')}.png`);
    console.log('material', i, MATERIALS[i], process.env.PROP === '1' ? await w.webContents.executeJavaScript('(() => { const b = window.__being(); return JSON.stringify({ aro: +b.U.uAro.value.toFixed(2), mindA: +b.mind.arousal.toFixed(2), prop: b.U.uProp.value, pwa: b.U.uPWa.value.toArray().map((x) => +x.toFixed(2)), shell: +b.U.uShellR.value.toFixed(3) }); })()') : '');
  }
  w.webContents.send('dev-cmd', { k: 'material', v: -1 });
  if (process.env.MIX !== '0') for (let k = 0; k < 8; k++) {
    await sleep(6000);
    const info = await w.webContents.executeJavaScript(`(() => { const b = window.__behave(); return b.MAT.m.slots.filter((s) => s >= 0).map((s) => (${JSON.stringify(MATERIALS)})[s] + ' ' + b.MAT.m.shown[s].toFixed(2)).join(' | ') + ' · mix ' + b.U.uMatMix.value.toFixed(2); })()`);
    await shot(`mat-free-${k}.png`); console.log('free', k, info);
  }
  await w.webContents.executeJavaScript('window.__gpuT = true').catch(() => null); await sleep(4000);
  const gpu = await w.webContents.executeJavaScript('window.__gpuStats ? JSON.stringify(window.__gpuStats()) : null').catch(() => null);
  if (gpu) console.log('gpu', gpu);
  clearInterval(feeder); app.quit();
});
