// the look passes (morph bake, beads, CelLab, particles, aura): per-pass cost and before/after pictures of the same state.
// [SWIFT=1] [WAV=<abs 48 kHz mono wav>] [SIZE=px] [MODE=probe|cost|seq] [OUT=dir] [STEPS=js;js] ./node_modules/.bin/electron scratch/look-passes.cjs
//   probe: timer-query support and a first __gpuStats. cost: per-pass ms (timer queries, or synced wall time on SwiftShader via
//   window.__gpuT = 'sync') in several states. seq: a fixed-seed frame sequence (Math.random and the clock pinned) written as
//   PNGs to OUT, for scratch/look-diff.mjs to compare between two builds.
const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('node:path'); const fs = require('node:fs'); const os = require('node:os');
const ROOT = path.join(__dirname, '..');
if (process.env.SWIFT) { app.commandLine.appendSwitch('use-angle', 'swiftshader'); app.commandLine.appendSwitch('enable-unsafe-swiftshader'); }
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'on-look-')));
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(ipcMain, app);
ipcMain.on('ml-get', (e) => { e.returnValue = null; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MODE = process.env.MODE || 'probe';
app.on('child-process-gone', (e, d) => console.log('[gone]', d.type, d.reason, d.exitCode));
app.whenReady().then(async () => {
  const S = +(process.env.SIZE || 480);
  const w = new BrowserWindow({ show: true, x: -3000, y: 0, width: S, height: S, backgroundColor: '#000', skipTaskbar: true, focusable: false, webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  w.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 3 || /uncaught/i.test(e.message)) console.log('[page]', String(e.message).slice(0, 300)); });
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '0', ui: '0', test: '1' } });
  w.webContents.send('track', { key: 'look-lab|synth', title: 'synth', artist: 'lab', app: 'lab' });
  const mono = (() => { const d = fs.readFileSync(process.env.WAV || path.join(ROOT, '..', '..', '..', 'scratch', 'synth-120.wav')).subarray(44); return new Int16Array(d.buffer, d.byteOffset, d.length >> 1); })();
  let pos = 0; const t0 = Date.now();
  const tm = setInterval(() => { const want = Math.floor((Date.now() - t0) / 1000 * 48000); while (pos + 960 <= want) { const b = Buffer.alloc(3840); for (let i = 0; i < 960; i++) { const v = mono[(pos + i) % mono.length]; b.writeInt16LE(v, i * 4); b.writeInt16LE(v, i * 4 + 2); } w.webContents.send('pcm', b); pos += 960; } }, 20);
  const js = (s) => w.webContents.executeJavaScript(s);
  await sleep(+(process.env.WARM || 8000));
  await js(`window.__noBurst = true; ${process.env.SWIFT ? 'window.__cellab && window.__cellab.pin(true); Object.assign(window.__qual, { auto: false, res: 1, k: 1 }); dispatchEvent(new Event("resize"));' : ''} 1`);
  if (MODE === 'probe') {
    console.log(await js(`(() => { const c = document.querySelector('canvas'), gl = c.getContext('webgl2'); return JSON.stringify({ ext: !!gl.getExtension('EXT_disjoint_timer_query_webgl2'), w: c.width, h: c.height, renderer: gl.getParameter(gl.RENDERER), frameMs: window.__being().frameMs }); })()`));
    await js(`window.__gpuT = true; window.__gpuStats(); 1`); await sleep(6000);
    console.log(JSON.stringify(await js('window.__gpuStats()')));
  }
  if (MODE === 'cost') {
    const sync = process.env.SWIFT ? "'sync'" : 'true', dwell = +(process.env.DWELL || 8000);
    const measure = async (label, setup) => {
      await js(setup + '; 1'); await sleep(+(process.env.SETTLE || 4000));
      await js(`window.__gpuT = ${sync}; window.__gpuStats(); window.__fc = 0; 1`); await sleep(dwell);
      const s = await js('({ g: window.__gpuStats(), frameMs: window.__being().frameMs, morphA: window.__being().U.uMorphA.value })');
      console.log(label.padEnd(22), 'morphA', s.morphA.toFixed(3), Object.entries(s.g).sort((a, b) => b[1].median - a[1].median).map(([k, v]) => `${k} ${v.median}/${v.p90} n${v.n}`).join(' | '));
    };
    for (const st of (process.env.STATES || 'groove,skin,beads').split(',')) {
      if (st === 'groove') await measure('groove', '');
      if (st === 'skin') await measure('skin shown', "window.__cellab.set({ surface: false }); window.__force = { uMorphA: 1 }");
      if (st === 'beads') await measure('beads', "window.__force = null; window.__beads()");
      if (st === 'cellab') await measure('cellab', "window.__force = null; window.__cellab.set({ surface: true, inside: true }); window.__cellab.show('surface', 60); window.__cellab.show('inside', 60)");
    }
  }
  clearInterval(tm); app.quit();
});
