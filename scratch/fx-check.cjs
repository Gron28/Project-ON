// headless: do the new effects render? Streams a wav into the being page (as being-smoke.cjs), puts water and quicksilver on
// the body (bubbles, mercury splits), keeps firing bolts (out of the skin, across it, between balls), and at each shot saves a
// screenshot and prints the lightning readout (window.__arcs()) and the particles' state. Shader errors show as [page] lines.
// WAV=<abs 48 kHz mono wav> SHOTS=8,14,20 [MODE=natural|bubbles] [SIZE=480] electron --use-angle=gl scratch/fx-check.cjs
// MODE natural: nothing forced (what the app does by itself); bubbles: only bubbles shed; default: everything forced
const { app, BrowserWindow } = require('electron'); const path = require('node:path'); const fs = require('node:fs');
app.commandLine.appendSwitch('use-angle', 'gl');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(require('electron').ipcMain, app);
require('electron').ipcMain.handle('page-schema', () => []);
require('electron').ipcMain.on('ml-get', (e) => { e.returnValue = null; });
const MODE = process.env.MODE || 'all', SZ = +process.env.SIZE || 900;
const SETUP = MODE === 'natural' ? (process.env.PRE || `'natural'`) : MODE === 'bubbles' ? `(() => { window.__fxT = setInterval(() => window.__fx('bubble', 5), 140); return 'bubbles'; })()` : `(() => {
  window.__matSlots = { ids: [7, 15, 12, 0], w: [.45, .3, .25, 0] };   // water (bubbles), quicksilver (splits), iron (electric)
  clearInterval(window.__fxT); let k = 0;
  window.__fxT = setInterval(() => { window.__bolt(k % 3 === 0 ? 'out' : 'arc'); if (k % 2 === 0) window.__fx('bubble', 6); if (k % 4 === 0) { window.__fx('gather', 10); window.__fx('dust', 8); window.__fx('stardust', 4); window.__fx('spark', 8); window.__fx('ember', 8); } if (k % 7 === 0) window.__fx('split'); k++; }, 140);
  return 'ok';
})()`;
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: true, x: -3000, y: 0, skipTaskbar: true, focusable: false, width: SZ, height: SZ, backgroundColor: '#000', webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  w.webContents.on('console-message', (e) => { const m = e.message || ''; if (!/Security|Policy|risks|electronjs|packaged|^\s*$/.test(m)) console.log('[page]', m.slice(0, 400), e.sourceId ? path.basename(e.sourceId) + ':' + (e.lineNumber || '') : ''); });
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '1', ...(process.env.PET ? { ui: '0' } : {}) } });
  w.webContents.send('look', { light: 'being', finish: 'chrome', fx: { spikes: true, rings: true, film: false, sparks: true }, lobes: 'being', offset: 40, hud: true, tune: {} });
  w.webContents.send('source', 'test track');
  if (process.env.MAT) { w.webContents.send('dev', true); setTimeout(() => w.webContents.send('dev-cmd', { k: 'material', v: +process.env.MAT }), 2000); }   // MAT=<id>: one material (11: Jupiter, tin)
  if (process.env.BOUNCE === '0') w.webContents.send('bounce', false);   // as with 'Bounce to the beat' off
  setTimeout(() => w.webContents.send('track', { key: 'fx|check', title: 'fx check', artist: 'lab' }), 1500);
  const wav = fs.readFileSync(process.env.WAV); const data = wav.subarray(44);
  const mono = new Int16Array(data.buffer, data.byteOffset, data.length >> 1);
  let pos = 0, setup = false; const CH = 960;
  const shots = (process.env.SHOTS || '8,14,20').split(',').map(Number); let si = 0;
  const t0 = Date.now(); let busy = false; const watch = { last: -1, n: 0 };
  const timer = setInterval(async () => {
    if (busy) return;
    const want = Math.floor((Date.now() - t0) / 1000 * 48000);
    while (pos < want) { if (pos + CH > mono.length) pos = 0; const b = Buffer.alloc(CH * 4); for (let i = 0; i < CH; i++) { b.writeInt16LE(mono[pos + i], i * 4); b.writeInt16LE(mono[pos + i], i * 4 + 2); } w.webContents.send('pcm', b); pos += CH; }
    const sec = (Date.now() - t0) / 1000;
    if (!setup && sec > 4) { setup = true; busy = true; console.log('setup', await w.webContents.executeJavaScript(SETUP).catch((e) => 'error ' + e.message)); busy = false; return; }
    if (process.env.STRIKES && setup && sec > 8) {   // STRIKES=n: instead of fixed times, a frame ~70 ms after each of the next n strikes a hit makes
      busy = true;
      const h = await w.webContents.executeJavaScript('window.__arcs().hits');
      if (watch.last >= 0 && h > watch.last) { await new Promise((r) => setTimeout(r, 70)); const img = await w.webContents.capturePage(); fs.writeFileSync(path.join(__dirname, `fx-strike-${++watch.n}.png`), img.toPNG()); console.log('strike', watch.n, 'at', sec.toFixed(1)); }
      watch.last = h; busy = false;
      if (watch.n >= +process.env.STRIKES || sec > 60) { clearInterval(timer); app.quit(); }
      return;
    }
    if (si < shots.length && sec >= shots[si]) {
      busy = true;
      const img = await w.webContents.capturePage(); fs.writeFileSync(path.join(__dirname, `fx-${shots[si]}s.png`), img.toPNG());
      const info = await w.webContents.executeJavaScript(`JSON.stringify({ arcs: window.__arcs(), life: window.__life(), drops: window.__being().U.uD.value.filter((d) => d.w > .012).length, sats: window.__being().U.uS.value.filter((d) => d.w > .012).length })`).catch((e) => 'error ' + e.message);
      console.log(`t=${shots[si]}s`, info); if (process.env.EVAL) console.log('   eval', await w.webContents.executeJavaScript(process.env.EVAL).catch((e) => 'error ' + e.message)); si++;
      if (si === shots.length) { clearInterval(timer); app.quit(); }
      busy = false;
    }
  }, 20);
});
