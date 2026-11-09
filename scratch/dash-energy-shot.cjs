// scratch/dash-energy-shot.cjs - streams a wav into the being page with the dashboard open, then screenshots the dashboard's
// "Intensity and ON" graph (the music's intensity against ON's size over the song).
// usage: WAV=<abs 48 kHz mono wav> OUT=<abs .png> DUR=<s> ENTITY_MULTI=1 ./node_modules/.bin/electron scratch/dash-energy-shot.cjs
const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('node:path'); const fs = require('node:fs');
const ROOT = path.join(__dirname, '..'), OUT = process.env.OUT, DUR = +(process.env.DUR || 40);
app.setPath('userData', path.join(path.dirname(OUT), 'profile-dash'));
app.commandLine.appendSwitch('disable-renderer-backgrounding'); app.commandLine.appendSwitch('disable-background-timer-throttling');
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(ipcMain, app);
const TUNE = require(path.join(ROOT, 'being', 'tune.cjs')).TUNE;
ipcMain.handle('page-schema', () => TUNE); ipcMain.handle('dash-schema', () => TUNE); ipcMain.handle('dash-app', () => null);
ipcMain.on('ml-get', (e) => { e.returnValue = { style: true, feel: true, world: true, beat: true }; });
ipcMain.on('has-local', (e) => { e.returnValue = false; });
let dash = null;
ipcMain.on('dev-snap', (e, snap) => { if (dash && !dash.isDestroyed()) dash.webContents.send('snap', { ...snap, app: { source: 'test', track: { title: 'test' }, settings: {} } }); });
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: true, x: -3000, y: 0, width: 520, height: 520, skipTaskbar: true, focusable: false, backgroundColor: '#000', webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '0', ui: '0' } });
  dash = new BrowserWindow({ show: true, x: -3000, y: 600, width: 1300, height: 1000, skipTaskbar: true, focusable: false, webPreferences: { preload: path.join(ROOT, 'being', 'dashboard-preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  dash.webContents.on('console-message', (e) => { const m = e.message || ''; if (/error|Error/.test(m)) console.log('[dash]', m.slice(0, 300)); });
  await dash.loadFile(path.join(ROOT, 'being', 'dashboard.html'));
  const wc = w.webContents;
  wc.send('bounce', true); wc.send('ml', { style: true, feel: true, world: true, beat: true }); wc.send('quality', { res: 1, auto: true, hz: 60 }); wc.send('source', 'test');
  await new Promise((r) => setTimeout(r, 4000));
  wc.send('dev', true); wc.send('track', { key: 'lab|' + path.basename(process.env.WAV), title: path.basename(process.env.WAV, '.wav'), artist: 'lab' });
  const wav = fs.readFileSync(process.env.WAV); let off = 12; while (wav.toString('ascii', off, off + 4) !== 'data') off += 8 + wav.readUInt32LE(off + 4);
  const data = wav.subarray(off + 8), mono = new Int16Array(data.buffer, data.byteOffset, data.length >> 1);
  let pos = 0; const end = Math.min(mono.length, DUR * 48000), t0 = Date.now();
  await new Promise((done) => { const iv = setInterval(() => { const want = Math.floor((Date.now() - t0) / 1000 * 48000);
    while (pos < want && pos + 960 <= end) { const b = Buffer.alloc(3840); for (let i = 0; i < 960; i++) { b.writeInt16LE(mono[pos + i], i * 4); b.writeInt16LE(mono[pos + i], i * 4 + 2); } wc.send('pcm', b); pos += 960; }
    if (pos + 960 > end) { clearInterval(iv); done(); } }, 10); });
  await dash.webContents.executeJavaScript(`document.querySelector('[data-panel="energy"]')?.scrollIntoView()`);
  await new Promise((r) => setTimeout(r, 500));
  const r = await dash.webContents.executeJavaScript(`(() => { const b = document.querySelector('[data-panel="energy"]').getBoundingClientRect(); return { x: Math.floor(b.x), y: Math.floor(b.y), width: Math.ceil(b.width), height: Math.ceil(b.height) }; })()`);
  fs.writeFileSync(OUT, (await dash.webContents.capturePage(r)).toPNG()); console.log('wrote', OUT, r); app.quit();
});
