// frame cost with and without the morph bake, vsync off so the frame rate shows the cost
const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('node:path'); const fs = require('node:fs');
app.commandLine.appendSwitch('disable-gpu-vsync'); app.commandLine.appendSwitch('disable-frame-rate-limit');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(ipcMain, app);
app.whenReady().then(async () => {
  const W = +(process.env.W || 800);
  const w = new BrowserWindow({ show: true, x: -3000, y: 0, width: W, height: W, backgroundColor: '#000', skipTaskbar: true, focusable: false, webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  w.webContents.on('console-message', (e) => { const m = e.message || ''; if (/rror/.test(m) && !/brain/.test(m)) console.log('[page]', m.slice(0, 300)); });
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '1' } });
  const wav = fs.readFileSync(process.env.WAV).subarray(44), mono = new Int16Array(wav.buffer, wav.byteOffset, wav.length >> 1);
  let pos = 0; const t0 = Date.now();
  setInterval(() => { const want = Math.floor((Date.now() - t0) / 1000 * 48000); while (pos < want && pos + 960 <= mono.length) { const b = Buffer.alloc(3840); for (let i = 0; i < 960; i++) { b.writeInt16LE(mono[pos + i], i * 4); b.writeInt16LE(mono[pos + i], i * 4 + 2); } w.webContents.send('pcm', b); pos += 960; } }, 20);
  await new Promise((r) => setTimeout(r, 3000));
  const measure = async (label, js) => {
    await w.webContents.executeJavaScript(js);
    await new Promise((r) => setTimeout(r, 1500));
    await w.webContents.executeJavaScript('window.__gpuT = true; window.__gpuStats(); 1');
    await new Promise((r) => setTimeout(r, 2500));
    console.log(label.padEnd(36), await w.webContents.executeJavaScript('JSON.stringify(window.__gpuStats())'));
  };
  await measure('morph cells+pollen, bake on', `window.__noBake = false; window.__morphForce(${JSON.stringify({ regularity: .9, density: .7, brightness: .7, roughness: .7, bassWeight: .8 })}, 7, 1)`);
  await measure('same, bake off', 'window.__noBake = true');
  await measure('morph cppn-heavy, bake on', `window.__noBake = false; window.__morphForce(${JSON.stringify({ intricacy: .95, change: .9, regularity: .05, tonality: .2, harmony: .2 })}, 11, 1)`);
  await measure('cppn-heavy, bake off (frozen skin)', 'window.__noBake = true');
  await measure('cppn-heavy, no morph at all', 'window.__noBake = true; window.__morphA0 = true');
  await measure('morph lace+attractor, bake on', 'window.__morphA0 = false; window.__noBake = false');
  await measure('morph lace+attractor, bake on', `window.__morphForce(${JSON.stringify({ tonality: .95, harmony: .9, noisiness: .05, intricacy: .8 })}, 1007, 1)`);
  await measure('same, bake off', 'window.__noBake = true');
  console.log('info', await w.webContents.executeJavaScript('JSON.stringify(window.__morph())'));
  app.quit();
});
