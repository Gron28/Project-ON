// lab: the being on the real GPU (ANGLE as main.cjs picks it) with a wav, screenshots and a read-back of every half-float target
// (NaN, Inf, negative, > 4) every few seconds. WAV=<abs path> [ENTITY_ANGLE=gl|d3d11|vulkan] [SECS=40] [EVERY=4] [OUT=dir]
const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('node:path'); const fs = require('node:fs');
if (process.platform === 'win32') app.commandLine.appendSwitch('use-angle', process.env.ENTITY_ANGLE || 'gl');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(ipcMain, app);
ipcMain.handle('page-schema', () => []);
ipcMain.on('ml-get', (e) => { e.returnValue = null; });
const OUT = process.env.OUT || path.join(__dirname, 'nan-probe'); fs.mkdirSync(OUT, { recursive: true });
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: true, x: 40, y: 40, width: 720, height: 720, backgroundColor: '#000', webPreferences: { preload: path.join(__dirname, 'nan-probe-preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  w.webContents.on('console-message', (e) => { const m = e.message || ''; if (/error|warn|being:/i.test(m) && !/Security|Policy/.test(m)) console.log('[page]', m.slice(0, 200)); });
  await w.loadFile(path.join(ROOT, 'being', 'index.html'));
  if (process.env.EVAL0) await w.webContents.executeJavaScript(process.env.EVAL0);   // lab: run once the page is up
  w.webContents.send('source', 'test track');
  setTimeout(() => w.webContents.send('track', { key: 'probe|test song', title: 'test song', artist: 'lab' }), 1500);
  const wav = fs.readFileSync(process.env.WAV); const mono = new Int16Array(wav.buffer, wav.byteOffset + 44, (wav.length - 44) >> 1);
  let pos = 0; const CH = 960, t0 = Date.now(), SECS = +(process.env.SECS || 40), EVERY = +(process.env.EVERY || 4); let next = EVERY, busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    const want = Math.floor((Date.now() - t0) / 1000 * 48000);
    const mute = (process.env.MUTE || '').split('-').map(Number), sil = mute.length === 2 && (Date.now() - t0) / 1000 >= mute[0] && (Date.now() - t0) / 1000 < mute[1];   // MUTE=20-35: silence (it falls asleep)
    if (sil) pos = want;
    while (pos < want) { const b = Buffer.alloc(CH * 4); for (let i = 0; i < CH; i++) { const v = mono[(pos + i) % mono.length]; b.writeInt16LE(v, i * 4); b.writeInt16LE(v, i * 4 + 2); } w.webContents.send('pcm', b); pos += CH; }
    const sec = (Date.now() - t0) / 1000; if (sec < next) return;
    busy = true; next += EVERY;
    try {
      const img = await w.webContents.capturePage(); fs.writeFileSync(path.join(OUT, `t${Math.round(sec)}.png`), img.toPNG());
      const r = await w.webContents.executeJavaScript(`(() => { const b = window.__being(); return JSON.stringify({ rts: window.__glProbe ? window.__glProbe() : 'no probe', gpu: window.__bodyStall?.().gpu, body: window.__bodyInfo?.().drawn, variants: window.__bodyInfo?.().variants, gapMax: Math.round(window.__gapMax || 0), _r: (window.__gapMax = 0), cellab: window.__cellab?.stats?.() && { in: +(b.U.uCvA?.value || 0).toFixed(2), ca: +(b.U.uCaA?.value || 0).toFixed(2) } }); })()`);
      console.log(`t=${Math.round(sec)}s`, r);
    } catch (e) { console.log('probe error', e.message); }
    busy = false;
    if (sec > SECS) {
      clearInterval(timer);
      // STEPS='[{},{"uMorphA":0}]': each a set of pinned uniforms (window.__force), shot after 0.5 s, on top of BASE
      const base = JSON.parse(process.env.BASE || '{}');
      for (const [i, f] of JSON.parse(process.env.STEPS || '[]').entries()) {
        await w.webContents.executeJavaScript(`window.__force = ${JSON.stringify({ ...base, ...f })}`);
        await new Promise((r) => setTimeout(r, 500));
        fs.writeFileSync(path.join(OUT, `step${i}.png`), (await w.webContents.capturePage()).toPNG());
        console.log('step', i, JSON.stringify(f));
      }
      if (process.env.MIPS) for (const lv of [1, 4]) console.log('mips', lv, await w.webContents.executeJavaScript(`JSON.stringify(window.__mipProbe(${lv}))`));
      if (process.env.PROF) {   // a 6 s CPU profile of the page: functions by self time
        const d = w.webContents.debugger; d.attach('1.3'); await d.sendCommand('Profiler.enable'); await d.sendCommand('Profiler.start');
        await new Promise((r) => setTimeout(r, 6000)); const { profile } = await d.sendCommand('Profiler.stop'); d.detach();
        const dt = {}; const by = new Map(profile.nodes.map((n) => [n.id, n])); const td = profile.timeDeltas; let tot = 0;
        profile.samples.forEach((id, i) => { const n = by.get(id), f = n.callFrame, k = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`; dt[k] = (dt[k] || 0) + (td[i] || 0); tot += td[i] || 0; });
        console.log('prof total ms', Math.round(tot / 1000)); for (const [k, v] of Object.entries(dt).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log('prof', (v / 1000).toFixed(0).padStart(6), k);
      }
      if (process.env.AB) {   // AB='{"uCvA":0}': the same frame at k = 1 with and without these uniforms (one task)
        const r = JSON.parse(await w.webContents.executeJavaScript(`(() => { const U = window.__being().U, f = ${process.env.AB}, keep = {}; window.__force = null;
          const a = window.__qualLab.compare({ ks: [1] }); for (const k in f) { keep[k] = U[k].value; U[k].value = f[k]; }
          const b = window.__qualLab.compare({ ks: [1] }); for (const k in keep) U[k].value = keep[k];
          return JSON.stringify({ a: a.ks['1'].png, b: b.ks['1'].png, vals: keep }); })()`));
        fs.writeFileSync(path.join(OUT, 'ab-a.png'), Buffer.from(r.a.slice(22), 'base64')); fs.writeFileSync(path.join(OUT, 'ab-b.png'), Buffer.from(r.b.slice(22), 'base64'));
        console.log('ab', JSON.stringify(r.vals));
      }
      if (process.env.TIME) console.log('time', await w.webContents.executeJavaScript(`JSON.stringify(window.__qualLab.time({ ks: [1, .5], discs: [1], n: 12 }))`));
      if (process.env.CMP) {   // the same frame at k = 1 and upscaled (being/page/quality-lab.mjs), aura left out
        const all = JSON.parse(await w.webContents.executeJavaScript(`JSON.stringify([0, 1, 2].map((mode) => window.__qualLab.compare({ ks: [.5], mode })))`));   // one task: the same frame each way
        all.forEach((r, mode) => { const v = r.ks['0.5']; console.log('qual mode', mode, JSON.stringify({ old: v.old, new: v.new })); fs.writeFileSync(path.join(OUT, `cmp-m${mode}.png`), Buffer.from(v.png.slice(22), 'base64')); });
        console.log('QUAL', await w.webContents.executeJavaScript('JSON.stringify(window.__qual)'));
      }
      if (process.env.FACE) fs.writeFileSync(path.join(OUT, 'face.json'), await w.webContents.executeJavaScript('JSON.stringify([0,1,2,3,4,5].map((f) => window.__cubeFace(f)))'));
      console.log('gl', await w.webContents.executeJavaScript('JSON.stringify(window.__glInfo())'));
      app.quit();
    }
  }, 20);
});
