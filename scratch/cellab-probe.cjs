// the CelLab automata on ON (being/page/cellab.mjs): screenshots of each surface rule surfaced and each inside rule lit, on
// the real page with a song playing, plus GPU time per pass (window.__gpuStats) with the layers off and on.
// WAV=<abs 48 kHz mono wav> [SWIFT=1 (SwiftShader)] [ONLY=hodge,scroll3d] [DWELL=ms] [SIZE=px] ./node_modules/.bin/electron scratch/cellab-shots.cjs
// writes scratch/cellab/<rule>.png and prints the stats
const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('node:path'); const fs = require('node:fs'); const os = require('node:os');
const ROOT = path.join(__dirname, '..'), OUT = path.join(__dirname, 'cellab');
if (process.env.SWIFT) { app.commandLine.appendSwitch('use-angle', 'swiftshader'); app.commandLine.appendSwitch('enable-unsafe-swiftshader'); }
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'on-cellab-')));   // never the real memories
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(ipcMain, app);
ipcMain.on('ml-get', (e) => { e.returnValue = null; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SURF = ['rug', 'pond', 'hodge', 'zhabo', 'rainzha', 'brain', 'faders', 'life', 'perfume', 'venus'], INSIDE = ['rug3d', 'scroll3d', 'brain3d', 'life3d'];
app.on('child-process-gone', (e, d) => console.log('[gone]', d.type, d.reason, d.exitCode));
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  console.log('gpu', JSON.stringify((await app.getGPUInfo('basic')).gpuDevice?.map((g) => g.deviceString || g.vendorId)));
  const S = +(process.env.SIZE || 520);
  const w = new BrowserWindow({ show: true, x: -3000, y: 0, width: S, height: S, backgroundColor: '#000', skipTaskbar: true, focusable: false, webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  w.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 3 || /cellab|uncaught/i.test(e.message)) console.log('[page]', String(e.message).slice(0, 400)); });
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '0', ui: '0' } });
  w.webContents.send('track', { key: 'cellab-lab|synth', title: 'synth', artist: 'lab', app: 'lab' });
  const mono = (() => { const d = fs.readFileSync(process.env.WAV).subarray(44); return new Int16Array(d.buffer, d.byteOffset, d.length >> 1); })();
  let pos = 0; const t0 = Date.now();
  const tm = setInterval(() => { const want = Math.floor((Date.now() - t0) / 1000 * 48000); while (pos + 960 <= want) { const b = Buffer.alloc(3840); for (let i = 0; i < 960; i++) { const v = mono[(pos + i) % mono.length]; b.writeInt16LE(v, i * 4); b.writeInt16LE(v, i * 4 + 2); } w.webContents.send('pcm', b); pos += 960; } }, 20);
  const js = (s) => w.webContents.executeJavaScript(s);
  await sleep(+(process.env.WARM || 9000));
  console.log('warm', await js('JSON.stringify({ frameMs: window.__being().frameMs, ca: !!window.__cellab })'));
  await js(`window.__noBurst = true; window.__gpuT = true; window.__gpuStats(); ${process.env.SWIFT ? 'window.__cellab.pin(true); Object.assign(window.__qual, { auto: false, res: 1 });' : ''} 1`);   // SwiftShader runs ~1 frame a second: no easing
  const shot = async (name) => fs.writeFileSync(path.join(OUT, name + '.png'), (await w.webContents.capturePage()).toPNG());
  for (const on of [false, true]) {
    await js(`window.__cellab.set({ surface: ${on} }); window.__beads(); 1`); await sleep(45000);
    console.log('beads', on, JSON.stringify(await js('[window.__cellab.stats(), window.__beadInfo ? window.__beadInfo() : null]')));
    await shot('beads-ca-' + on); await js('window.__beads(); 1'); await sleep(8000);
  }
  clearInterval(tm); app.quit();
});
