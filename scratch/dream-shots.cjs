// headless: stream digital silence into the being and screenshot its dream (the tissue's slow up and down states while asleep).
//   ./node_modules/.bin/electron.cmd scratch/dream-shots.cjs        -> scratch/dream-<s>s.png and a line per shot from window.__dream()
// SHOTS=14,22,30,38 (seconds); the being falls asleep ~5 s after the silence starts.
const { app, BrowserWindow } = require('electron'); const path = require('node:path'); const fs = require('node:fs');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(require('electron').ipcMain, app);
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: true, x: -3000, y: 0, skipTaskbar: true, focusable: false, width: 700, height: 700, backgroundColor: '#000', webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '0', ui: '0' } });
  w.webContents.send('look', { light: 'being', finish: 'chrome', fx: { spikes: true, rings: true, film: false, sparks: true }, lobes: 'being', offset: 40, hud: false, tune: {} });
  w.webContents.send('source', 'silence');
  const shots = (process.env.SHOTS || '14,22,30,38').split(',').map(Number); let si = 0, pos = 0, busy = false; const CH = 960, t0 = Date.now(), zero = Buffer.alloc(CH * 4);
  const timer = setInterval(async () => {
    if (busy) return;
    const want = Math.floor((Date.now() - t0) / 1000 * 48000);
    while (pos < want) { w.webContents.send('pcm', zero); pos += CH; }
    const sec = (Date.now() - t0) / 1000;
    if (si < shots.length && sec >= shots[si]) {
      busy = true;
      const img = await w.webContents.capturePage(); fs.writeFileSync(path.join(__dirname, `dream-${shots[si]}s.png`), img.toPNG());
      console.log(`t=${shots[si]}s`, JSON.stringify(await w.webContents.executeJavaScript('window.__dream()'))); si++;
      if (si === shots.length) { clearInterval(timer); app.quit(); }
      busy = false;
    }
  }, 20);
});
