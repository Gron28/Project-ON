// the page's fingerprint: every shader it compiles (comments and spacing stripped), its uniforms and their values after a few
// seconds of a song, so a refactor can be checked to leave what ON draws unchanged. Writes OUT (default scratch/fingerprint.json).
// WAV=<48 kHz mono wav> OUT=... ./node_modules/.bin/electron scratch/fingerprint.cjs
const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('node:path'); const fs = require('node:fs');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(ipcMain, app);
ipcMain.on('ml-get', (e) => { e.returnValue = null; });
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ').trim();
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: true, x: -3000, y: 0, width: 700, height: 700, backgroundColor: '#000', webPreferences: { preload: path.join(__dirname, 'fingerprint-preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  const errs = [];
  w.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) errs.push(String(e.message).slice(0, 300)); });
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '1' } });
  const mono = (() => { const d = fs.readFileSync(process.env.WAV).subarray(44); return new Int16Array(d.buffer, d.byteOffset, d.length >> 1); })();
  let pos = 0; const t0 = Date.now();
  const tm = setInterval(() => { const want = Math.floor((Date.now() - t0) / 1000 * 48000); while (pos < want && pos + 960 <= mono.length) { const b = Buffer.alloc(3840); for (let i = 0; i < 960; i++) { b.writeInt16LE(mono[pos + i], i * 4); b.writeInt16LE(mono[pos + i], i * 4 + 2); } w.webContents.send('pcm', b); pos += 960; } }, 20);
  await new Promise((r) => setTimeout(r, +(process.env.SECS || 8) * 1000));
  const got = await w.webContents.executeJavaScript(`(() => { const b = window.__being(); const U = {}; for (const [k, v] of Object.entries(b.U)) { const x = v.value;
    U[k] = x == null ? null : typeof x === 'number' ? 'n' : x.isVector2 ? 'v2' : x.isVector3 ? 'v3' : x.isVector4 ? 'v4' : x.isColor ? 'c' : x.isTexture ? 'tex' : ArrayBuffer.isView(x) ? 'f' + x.length : Array.isArray(x) ? 'a' + x.length : typeof x; }
    return { shaders: [...new Set(window.__shaders)], U, frameMs: b.frameMs }; })()`);
  clearInterval(tm);
  const shaders = got.shaders.map(strip).sort();
  const out = { shaders, U: got.U, errors: errs, frameMs: got.frameMs };
  fs.writeFileSync(process.env.OUT || path.join(__dirname, 'fingerprint.json'), JSON.stringify(out, null, 1));
  console.log(`shaders ${shaders.length}, uniforms ${Object.keys(got.U).length}, errors ${errs.length}, frameMs ${got.frameMs}`); errs.slice(0, 10).forEach((e) => console.log('  !', e));
  app.quit();
});
