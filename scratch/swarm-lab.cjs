// burst the being into its swarm and photograph the life cycle: burst, formed, gather, whole again; plus a jet
const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('node:path'); const fs = require('node:fs');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(ipcMain, app);
const PLAN = (process.env.PLAN || 'jet@3,shot@3.4,burst@6,shot@7,shot@9,shot@13,shot@20,gather@21,shot@22.5,shot@25').split(',').map((x) => { const [a, t] = x.split('@'); return { a, t: +t }; });
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: true, x: -3000, y: 0, width: 900, height: 900, backgroundColor: '#000', skipTaskbar: true, focusable: false, webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  w.webContents.on('console-message', (e) => { const m = e.message || ''; if (/rror|swarm|WebGPU|warn/i.test(m) && !/brain/.test(m)) console.log('[page]', m.slice(0, 500)); });
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '1' } });
  w.webContents.send('look', { light: 'being', finish: 'chrome', fx: { spikes: true, rings: true, film: false, sparks: true }, lobes: 'being', offset: 40, hud: false, tune: {} });
  const wav = fs.readFileSync(process.env.WAV).subarray(44), mono = new Int16Array(wav.buffer, wav.byteOffset, wav.length >> 1);
  let pos = 0; const t0 = Date.now();
  setInterval(() => { const want = Math.floor((Date.now() - t0) / 1000 * 48000); while (pos < want && pos + 960 <= mono.length) { const b = Buffer.alloc(3840); for (let i = 0; i < 960; i++) { b.writeInt16LE(mono[pos + i], i * 4); b.writeInt16LE(mono[pos + i], i * 4 + 2); } w.webContents.send('pcm', b); pos += 960; } }, 20);
  if (process.env.CHAR) { await new Promise((r) => setTimeout(r, 1500)); await w.webContents.executeJavaScript(`window.__morphForce(${process.env.CHAR}, ${process.env.SEED || 5}, 1); 1`); }
  const start = Date.now(); let k = 0;
  for (const step of PLAN) {
    const wait = step.t * 1000 - (Date.now() - start); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (step.a === 'shot') { const img = await w.webContents.capturePage(); fs.writeFileSync(path.join(__dirname, `swarm-${process.env.TAG || ''}${String(k).padStart(2, '0')}-${step.t}.png`), img.toPNG()); k++; console.log('shot', step.t, await w.webContents.executeJavaScript('JSON.stringify(window.__swarmInfo())')); }
    else if (false) { fs.writeFileSync(path.join(__dirname, `swarm-${String(k++).padStart(2, '0')}-${step.t}.png`), (await w.webContents.capturePage()).toPNG()); console.log('shot', step.t, await w.webContents.executeJavaScript('JSON.stringify(window.__swarmInfo())')); }
    else console.log(step.a, step.t, await w.webContents.executeJavaScript(step.a === 'burst' && process.env.ORG ? `window.__burst(${process.env.ORG}, ${process.env.SEED || 5})` : `window.__${step.a}()`));
  }
  app.quit();
});
