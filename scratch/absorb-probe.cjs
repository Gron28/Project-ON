// streams a wav into ON as captured audio and logs, every 5 s, everything absorption and the journey are made of. WAV=<path> SECS=150
const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('node:path'); const fs = require('node:fs');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(ipcMain, app);
ipcMain.on('ml-get', (e) => { e.returnValue = null; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 400, height: 400, backgroundColor: '#000', webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false, offscreen: true } });
  w.webContents.setFrameRate(60);
  w.webContents.on('console-message', (e) => { const m = e.message || ''; if (/Uncaught|rror:/.test(m)) console.log('[page]', m.slice(0, 300)); });
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '0' } });
  await sleep(2500);
  await w.webContents.executeJavaScript("window.__journey({ mode: 'auto' }); window.__rise({ mode: 'auto' })");   // this test profile may hold another mode from earlier runs
  w.webContents.send('source', 'test track'); w.webContents.send('track', { key: 'probe|steady', title: 'steady', artist: 'probe' });
  const wav = fs.readFileSync(process.env.WAV), mono = new Int16Array(wav.buffer, wav.byteOffset + 44, (wav.length - 44) >> 1);
  let pos = 0; const CH = 960, t0 = Date.now(), SECS = +(process.env.SECS || 150);
  const timer = setInterval(() => { const want = Math.floor((Date.now() - t0) / 1000 * 48000);
    while (pos < want && pos + CH <= mono.length) { const b = Buffer.alloc(CH * 4); for (let i = 0; i < CH; i++) { b.writeInt16LE(mono[pos + i], i * 4); b.writeInt16LE(mono[pos + i], i * 4 + 2); } w.webContents.send('pcm', b); pos += CH; } }, 20);
  for (let s = 5; s <= SECS; s += 5) {
    await sleep(5000);
    const r = await w.webContents.executeJavaScript(`(() => { const b = window.__being(), m = b.mind, j = window.__journey(), f = window.__flourish.state();
      return { lock: m.lock, groove: m.groove, absorb: j.absorbed, absorption: j.absorption, ch: b.character ? { reg: b.character.regularity, change: b.character.change } : null, journey: j.journey, mode: j.mode, sleep: b.sleep ?? null, keys: Object.keys(b).join(',') }; })()`).catch((e) => ({ err: e.message }));
    const f = (x) => (typeof x === 'number' ? x.toFixed(2) : x);
    console.log(`${String(s).padStart(4)}s  lock ${f(r.lock)}  groove ${f(r.groove)}  absorb ${f(r.absorb)}  absorption ${f(r.absorption)}  journey ${f(r.journey)}  [${r.mode}]${s === 5 ? '  keys: ' + r.keys : ''}${r.ch ? '  reg ' + f(r.ch.reg) + ' change ' + f(r.ch.change) : ''}${r.err ? ' ' + r.err : ''}`);
  }
  clearInterval(timer); app.quit();
});
