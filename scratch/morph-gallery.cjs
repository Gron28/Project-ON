// render the being with six song characters' skin species, same music, one crop each
const { app, BrowserWindow } = require('electron'); const path = require('node:path'); const fs = require('node:fs');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(require('electron').ipcMain, app);
const SONGS = {
  quartet: { loudness: .3, noisiness: .1, roughness: .05, tonality: .9, harmony: .8, regularity: .3, density: .3, intricacy: .6, brightness: .5, bassWeight: .2, vocal: 0 },
  rap: { loudness: .8, noisiness: .4, roughness: .3, tonality: .4, harmony: .2, regularity: .9, density: .7, intricacy: .3, bassWeight: .9, vocal: .9 },
  noise: { loudness: .9, noisiness: .95, roughness: .9, tonality: .05, harmony: .1, regularity: .2, density: .9, intricacy: .7, vocal: 0 },
  ballad: { loudness: .4, noisiness: .15, roughness: .1, tonality: .8, harmony: .6, regularity: .5, density: .3, intricacy: .3, vocal: .9 },
  techno: { loudness: .85, noisiness: .3, roughness: .2, tonality: .3, harmony: .2, regularity: .95, density: .6, intricacy: .4, bassWeight: .8, vocal: .1 },
  ambient: { loudness: .2, noisiness: .3, roughness: .1, tonality: .6, harmony: .7, regularity: .1, density: .15, intricacy: .5, bassWeight: .3, vocal: 0 },
};
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: true, x: -3000, y: 0, width: 900, height: 900, backgroundColor: '#000', skipTaskbar: true, focusable: false, webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '1' } });
  w.webContents.send('look', { light: 'being', finish: 'chrome', fx: { spikes: true, rings: true, film: false, sparks: true }, lobes: 'being', offset: 40, hud: false, tune: {} });
  const wav = fs.readFileSync(process.env.WAV).subarray(44), mono = new Int16Array(wav.buffer, wav.byteOffset, wav.length >> 1);
  let pos = 0; const t0 = Date.now();
  const feeder = setInterval(() => { const want = Math.floor((Date.now() - t0) / 1000 * 48000); while (pos < want && pos + 960 <= mono.length) { const b = Buffer.alloc(3840); for (let i = 0; i < 960; i++) { b.writeInt16LE(mono[pos + i], i * 4); b.writeInt16LE(mono[pos + i], i * 4 + 2); } w.webContents.send('pcm', b); pos += 960; } }, 20);
  await new Promise((r) => setTimeout(r, 4000));
  let i = 0;
  for (const [name, c] of Object.entries(SONGS)) {
    const fam = await w.webContents.executeJavaScript(`window.__morphForce(${JSON.stringify(c)}, ${1000 + i * 7919}, 1)`);
    await new Promise((r) => setTimeout(r, 200)); const info = await w.webContents.executeJavaScript('JSON.stringify(window.__morph())');
    await new Promise((r) => setTimeout(r, 6000));
    fs.writeFileSync(path.join(__dirname, `morph-${name}.png`), (await w.webContents.capturePage()).toPNG());
    console.log(name, fam, info); i++;
  }
  clearInterval(feeder); app.quit();
});
