// open the being with nothing playing; measure how fast its size and beat pulse oscillate
const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('node:path'); const fs = require('node:fs');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(ipcMain, app);
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: true, x: -3000, y: 0, width: 600, height: 600, backgroundColor: '#000', skipTaskbar: true, focusable: false, webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  w.webContents.on('console-message', (e) => { const m = e.message || ''; if (/rror/i.test(m) && !/brain/.test(m)) console.log('[page]', m.slice(0, 300)); });
  await w.loadFile(path.join(ROOT, 'being', process.env.PAGE || 'index.html'), { query: { local: '1' } });
  await new Promise((r) => setTimeout(r, +(process.env.WAIT || 15) * 1000));
  const r = await w.webContents.executeJavaScript(`new Promise(res => { const xs = [], ps = [], t0 = performance.now(); const f = () => { xs.push(+window.__probeU('uScale')); ps.push(+window.__probeU('uBeatPulse')); if (performance.now() - t0 < 10000) requestAnimationFrame(f); else res({ xs, ps, ms: performance.now() - t0, sleep: window.__probeSleep ? window.__probeSleep() : null }); }; requestAnimationFrame(f); })`);
  const m = r.xs.reduce((a, b) => a + b, 0) / r.xs.length; let zc = 0; for (let i = 1; i < r.xs.length; i++) if ((r.xs[i - 1] - m) * (r.xs[i] - m) < 0) zc++;
  const amp = Math.max(...r.xs) - Math.min(...r.xs), pmax = Math.max(...r.ps);
  console.log(`size ${m.toFixed(3)} swing ${amp.toFixed(4)} oscillates ${(zc / 2 / (r.ms / 1000)).toFixed(2)} Hz | beat pulse max ${pmax.toFixed(3)}`);
  fs.writeFileSync(path.join(__dirname, 'idle-' + (process.env.PAGE || 'now') + '.png'), (await w.webContents.capturePage()).toPNG());
  app.quit();
});
