// play a song, then stop (nothing playing), and watch what the skin does in silence
const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('node:path'); const fs = require('node:fs');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(ipcMain, app);
const PLAY = +(process.env.PLAY || 25), SHOTS = (process.env.SHOTS || '20,35,60,90,120').split(',').map(Number);
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: true, x: -3000, y: 0, width: 800, height: 800, backgroundColor: '#000', skipTaskbar: true, focusable: false, webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  w.webContents.on('console-message', (e) => { const m = e.message || ''; if (/rror/i.test(m) && !/brain/.test(m)) console.log('[page]', m.slice(0, 300)); });
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '1' } });
  w.webContents.send('look', { light: 'being', finish: 'chrome', fx: { spikes: true, rings: true, film: false, sparks: true }, lobes: 'being', offset: 40, hud: false, tune: {} });
  w.webContents.send('track', { key: 'lab|silence-test|x', title: 'silence test', artist: 'lab', app: 'lab' });
  const wav = fs.readFileSync(process.env.WAV).subarray(44), mono = new Int16Array(wav.buffer, wav.byteOffset, wav.length >> 1);
  let pos = 0; const t0 = Date.now();
  const iv = setInterval(() => { if (Date.now() - t0 > PLAY * 1000) return; const want = Math.floor((Date.now() - t0) / 1000 * 48000); while (pos < want && pos + 960 <= mono.length) { const b = Buffer.alloc(3840); for (let i = 0; i < 960; i++) { b.writeInt16LE(mono[pos + i], i * 4); b.writeInt16LE(mono[pos + i], i * 4 + 2); } w.webContents.send('pcm', b); pos += 960; } }, 20);
  await w.webContents.executeJavaScript(`window.__secs = 0; 1`);
  for (const at of SHOTS) {
    const wait = at * 1000 - (Date.now() - t0); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    fs.writeFileSync(path.join(__dirname, `silence-${at}.png`), (await w.webContents.capturePage()).toPNG());
    console.log(at, await w.webContents.executeJavaScript(`JSON.stringify({ morph: window.__morph(), rest: window.__rest(), skinA: +window.__probeU('uSkinA'), morphA: +window.__probeU('uMorphA'), tissueA: +window.__probeU('uTissueA'), grain: +window.__probeU('uGrain'), chaos: +window.__probeU('uChaos'), frac: +window.__probeU('uFrac'), intr: +window.__probeU('uIntr'), W0: window.__probeW() })`));
  }
  clearInterval(iv); app.quit();
});
