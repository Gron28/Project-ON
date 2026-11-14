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
  const dwell = +(process.env.DWELL || (process.env.SWIFT ? 40000 : 5000)), only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  // the layers off: the baseline cost
  await js(`window.__cellab.set({ surface: false, inside: false }); 1`); await sleep(3000); await js('window.__gpuStats(); 1'); await sleep(3000);
  console.log('off', JSON.stringify(await js('window.__gpuStats()')), await js('window.__being().frameMs'));
  await shot('off');
  await js(`window.__cellab.set({ surface: true, inside: false }); 1`);
  for (const r of SURF) {
    if (only && !only.includes(r)) continue;
    await js(`window.__cellab.set({ rule: '${r}' }); window.__cellab.show('surface', 60); window.__gpuStats(); 1`); await sleep(dwell);
    await shot('surface-' + r);
    console.log(r, JSON.stringify(await js('[window.__cellab.stats(), window.__gpuStats(), window.__rest().win.surf]')));
  }
  await js(`window.__cellab.set({ rule: 'auto', surface: false, inside: true }); 1`);
  for (const r of INSIDE) {
    if (only && !only.includes(r)) continue;
    await js(`window.__cellab.set({ rule3d: '${r}' }); window.__cellab.show('inside', 60); window.__gpuStats(); 1`); await sleep(dwell);
    await shot('inside-' + r);
    console.log(r, JSON.stringify(await js('[window.__cellab.stats(), window.__gpuStats(), window.__rest().win.inner, window.__cellab.probeInside()]')));
    if (process.env.BEADS) { await js('window.__beads(); 1'); await sleep(process.env.SWIFT ? 50000 : 3500); await shot('inside-' + r + '-beads'); await js('window.__beads(); 1'); await sleep(2000); }
    if (process.env.BEADS === 'compare') { await js(`window.__cellab.set({ inside: false }); window.__beads(); 1`); await sleep(process.env.SWIFT ? 50000 : 3500); await shot('inside-' + r + '-beads-off'); await js('window.__beads(); window.__cellab.set({ inside: true }); 1'); await sleep(2000); }
  }
  // both together, as a peak would show them
  if (!only) { await js(`window.__cellab.set({ rule3d: 'auto', surface: true, inside: true }); window.__cellab.show('surface', 60); window.__cellab.show('inside', 60); window.__gpuStats(); 1`); await sleep(dwell); await shot('both');
    console.log('both', JSON.stringify(await js('[window.__cellab.snap().surface.name, window.__cellab.snap().inside.name, window.__gpuStats()]'))); }
  await js(`window.__cellab.set({ rule: 'auto', rule3d: 'auto', surface: true, inside: true }); 1`);   // leave the profile's settings as found
  clearInterval(tm); app.quit();
});
