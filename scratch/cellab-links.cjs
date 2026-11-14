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
  // the correspondences (being/page/cellab.mjs header): material -> rule and palette, hits, moments, beads, particles
  const pin = process.env.SWIFT ? 'window.__cellab.pin(true);' : '';
  const dwell = +(process.env.DWELL || (process.env.SWIFT ? 30000 : 5000));
  const q = async (label) => console.log(label, JSON.stringify(await js(`(() => { const s = window.__cellab.snap(); return { mood: s.mood, lead: s.lead, surface: [s.surface.name, s.surface.a, s.surface.palette], inside: [s.inside.name, s.inside.a, s.inside.palette], gains: window.__cellab.gains().map((x) => +x.toFixed(2)), seeds: [window.__cellab.CA.seeds2.length, window.__cellab.CA.seeds3.length], bloom: +window.__cellab.CA.bloom.toFixed(2) }; })()`)));
  for (const [name, ids, w] of [['fire', [6, 0, 9, 7], [0.7, 0.2, 0.05, 0.05]], ['water', [7, 0, 6, 8], [0.7, 0.2, 0.05, 0.05]], ['earth', [9, 10, 0, 7], [0.6, 0.3, 0.1, 0]]]) {
    await js(`window.__matSlots = { ids: ${JSON.stringify(ids)}, w: ${JSON.stringify(w)} }; window.__cellab.set({ rule: 'auto', palette: 'auto' }); ${pin} 1`);
    await sleep(1500);
    await js(`window.__cellab.show('surface', 60); 1`); await sleep(dwell);
    await q(name); await shot('links-' + name);
    await js(`window.__cellab.CA.showS = 0; window.__cellab.set({ surface: false }); 1`); for (let i = 0; i < 6; i++) { await sleep(500); console.log('poll', JSON.stringify(await js(`(() => { const s = window.__cellab.D.st; return [s.leadId, s.leadNew, s.known, s.rule, +window.__cellab.stats().a, +window.__cellab.CA.v.toFixed(3), window.__cellab.CA.on.surface]; })()`))); } await js(`window.__cellab.set({ surface: true }); 1`); console.log("hidden", JSON.stringify(await js(`(() => { const s = window.__cellab.D.st, C = window.__cellab.CA; return { leadId: s.leadId, leadNew: s.leadNew, known: s.known, rule: s.rule, force: s.force, mood: s.mood, a: window.__cellab.stats(), lead: C.lead, frame: window.__being().frameMs }; })()`)));
  }
  await js(`window.__cellab.hit('kick', 1, true); window.__cellab.hit('snare', 1, false); 1`); await q('hits');
  await js(`document.querySelector('#fb .love').click(); 1`); await sleep(300); await q('love');
  await js(`window.__cellab.moment('startle', 0.9); 1`); await q('startle');
  const v2 = await js('window.__cellab.D.st.v2'); await js(`document.querySelector('#fb .no').click(); 1`); await sleep(300);
  console.log('not-this renews', v2, '->', await js('window.__cellab.D.st.v2'));
  await js(`window.__beads(); 1`); await sleep(process.env.SWIFT ? 40000 : 4000); await q('beads'); await shot('links-beads');
  await js(`window.__beads(); window.__matSlots = undefined; 1`); await sleep(1500);
  clearInterval(tm); app.quit();
});
