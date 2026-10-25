// the body shader's uniforms at every showcase step, for scratch/body-ab.cjs: each step's numbers, vectors and arrays
// (textures by name only). Writes scratch/perf/states.json. [SWIFT=1] [DWELL=ms] ./node_modules/.bin/electron scratch/body-states.cjs
const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('node:path'); const fs = require('node:fs'); const os = require('node:os');
const ROOT = path.join(__dirname, '..'), OUT = path.join(__dirname, 'perf');
if (process.env.SWIFT) { app.commandLine.appendSwitch('use-angle', 'swiftshader'); app.commandLine.appendSwitch('enable-unsafe-swiftshader'); }
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'on-states-')));
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(ipcMain, app);
ipcMain.on('ml-get', (e) => { e.returnValue = null; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GRAB = `(() => { const U = window.__being().U, o = {};
  for (const [k, v] of Object.entries(U)) { const x = v.value;
    if (x == null || x.isTexture) o[k] = x == null ? null : 'tex';
    else if (typeof x === 'number') o[k] = x;
    else if (x.isColor) o[k] = { c: [x.r, x.g, x.b] };
    else if (x.toArray && !Array.isArray(x)) o[k] = { v: x.toArray() };
    else if (ArrayBuffer.isView(x)) o[k] = { f: Array.from(x) };
    else if (Array.isArray(x)) o[k] = { a: x.map((y) => typeof y === 'number' ? y : y.isColor ? [y.r, y.g, y.b] : y.toArray()) };
  }
  return o; })()`;
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const w = new BrowserWindow({ show: true, x: -3000, y: 0, width: 560, height: 560, backgroundColor: '#000', skipTaskbar: true, focusable: false, webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  w.webContents.on('console-message', (e) => { if (/error|uncaught/i.test(e.message)) console.log('[page]', String(e.message).slice(0, 300)); });
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '0', ui: '0', showcase: '1' } });
  await sleep(+(process.env.WARM || 4000)); console.log('loaded');
  const caps = await w.webContents.executeJavaScript('window.__showcase.steps');
  const out = [];
  for (let i = 0; i < caps.length; i++) {
    await w.webContents.executeJavaScript(`window.__showcase.go(${i})`); await sleep(+(process.env.DWELL || 3500));
    out.push({ step: i, caption: caps[i], U: await w.webContents.executeJavaScript(GRAB) });
    console.log(i, caps[i]); fs.writeFileSync(path.join(OUT, 'states.json'), JSON.stringify(out));
  }
  fs.writeFileSync(path.join(OUT, 'states.json'), JSON.stringify(out));
  app.quit();
});
