// the governor's choices on the same frame (being/page/quality-lab.mjs, window.__qualLab): the body drawn as a disc vs the
// whole window (must be identical), today's stretched lower resolution vs the upscaled body, against full resolution, and
// the body pass timed per resolution. Writes scratch/perf/look-gov/<state>-k<k>.png ([full | old | new]) and summary.json.
// [WAV=<abs 48 kHz mono wav>] [SWIFT=1] [SIZE=px] [KS=.5,.6,.7,.8] [SHARP=.35] ./node_modules/.bin/electron scratch/look-gov.cjs
const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('node:path'); const fs = require('node:fs'); const os = require('node:os');
const ROOT = path.join(__dirname, '..'), OUT = path.join(__dirname, 'perf', 'look-gov');
if (process.env.SWIFT) { app.commandLine.appendSwitch('use-angle', 'swiftshader'); app.commandLine.appendSwitch('enable-unsafe-swiftshader'); }
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'on-lookgov-')));
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(ipcMain, app);
ipcMain.on('ml-get', (e) => { e.returnValue = null; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.on('child-process-gone', (e, d) => console.log('[gone]', d.type, d.reason, d.exitCode));
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  console.log('gpu', JSON.stringify((await app.getGPUInfo('basic')).gpuDevice?.map((g) => g.deviceString || g.vendorId)));
  const S = +(process.env.SIZE || 520);
  const w = new BrowserWindow({ show: true, x: -3000, y: 0, width: S, height: S, backgroundColor: '#000', skipTaskbar: true, focusable: false, webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  w.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 3 || /uncaught/i.test(e.message)) console.log('[page]', String(e.message).slice(0, 300)); });
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '0', ui: '0' } });
  w.webContents.send('track', { key: 'lookgov-lab|synth', title: 'synth', artist: 'lab', app: 'lab' });
  const mono = (() => { const d = fs.readFileSync(process.env.WAV || path.join(__dirname, 'synth-120.wav')).subarray(44); return new Int16Array(d.buffer, d.byteOffset, d.length >> 1); })();
  let pos = 0; const t0 = Date.now();
  const tm = setInterval(() => { const want = Math.floor((Date.now() - t0) / 1000 * 48000); while (pos + 960 <= want) { const b = Buffer.alloc(3840); for (let i = 0; i < 960; i++) { const v = mono[(pos + i) % mono.length]; b.writeInt16LE(v, i * 4); b.writeInt16LE(v, i * 4 + 2); } w.webContents.send('pcm', b); pos += 960; } }, 20);
  const js = (s) => w.webContents.executeJavaScript(s);
  await js('window.__noBurst = true; Object.assign(window.__qual, { auto: false, res: 1 }); 1');
  await sleep(+(process.env.WARM || 12000));
  const ks = (process.env.KS || '.5,.6,.7,.8').split(',').map(Number), sharp = process.env.SHARP ? +process.env.SHARP : null;
  const summary = {};
  const run = async (state, setup, settle) => {
    await js(setup + '; 1'); await sleep(settle);
    const disc = await js('window.__qualLab.discCheck()');
    const cmp = await js(`window.__qualLab.compare({ ks: ${JSON.stringify(ks)}, sharp: ${sharp} })`);
    const time = process.env.NOTIME ? null : await js(`window.__qualLab.time({ ks: [1, .7, .5], n: ${process.env.SWIFT ? 2 : 20} })`);
    for (const [k, v] of Object.entries(cmp.ks)) { fs.writeFileSync(path.join(OUT, `${state}-k${k}.png`), Buffer.from(v.png.split(',')[1], 'base64')); delete v.png; }
    summary[state] = { disc, cmp, time };
    console.log(state, JSON.stringify(summary[state]));
  };
  await run('groove', '', 500);
  await run('skin', "window.__morphForce({}, 12345, 1); window.__force = { uMorphA: 1.1 }", process.env.SWIFT ? 15000 : 3000);
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
  clearInterval(tm); app.quit();
});
