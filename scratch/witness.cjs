// the witness: renders ON off-screen and checks that each lab feature actually changes what is on the screen. For each one it takes
// a frame with the feature off, another a moment later (how much ON changes by itself: the music, the dance), then one with the
// feature on; the feature passes only if it changed the picture clearly more than ON changes by itself. It catches code that claims
// an effect the screen never shows (a swallowed branch, a weight that never reaches the shader, a layer hidden behind another).
// Limits: a fine line barely shifts these measures, so features marked 'eye' are reported but not failed: check them by
// eye (SAVE=1 writes the off and on frames to scratch/). Timing noise is real: a borderline result is rerun once before it fails.
// ./node_modules/.bin/electron scratch/witness.cjs   (ONLY=rise:bloom,mark to test a few; SAVE=1; exits 1 if any fails)
const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('node:path');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(ipcMain, app);
ipcMain.on('ml-get', (e) => { e.returnValue = null; });   // the page reads its model settings synchronously at start
ipcMain.handle('page-schema', () => []);   // the preload asks main for the tuning schema
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FORMS = ['bloom', 'crystal', 'foam', 'sponge', 'julia', 'geometry', 'coral', 'lattice'];
const mix = (i) => JSON.stringify(FORMS.map((_, k) => (k === i ? 1 : 0)));
const OFF_ALL = "window.__rise({ mode: 'off' }); window.__riseMix = null; window.__force = {}; window.__journey({ mode: 'off' }); window.__rite?.(false); window.__breathe?.({ on: false }); window.__showcase.api.devCommand({ k: 'material', v: 6 })";
// [name, how to switch it on, how long it needs to show itself (ms)]
const FEATURES = [
  ...FORMS.map((f, i) => [`rise:${f}`, `window.__rise({ mode: 'hold', t: .8, e: 0 }); window.__riseMix = ${mix(i)}; window.__force = { uRise: .8 }`, 3500]),
  ['rise:ether', `window.__rise({ mode: 'hold', t: .8, e: .85 }); window.__riseMix = ${mix(5)}; window.__force = { uRise: .8, uEther: .85 }`, 3500],
  ['journey:deep', "window.__journey({ mode: 'hold', j: 1, t: 1, p: 1 })", 6000],
  ['absorbed-flow', "window.__journey({ mode: 'hold', j: 0, t: 1, p: 0 })", 7000],
  ['material:sun', "window.__showcase.api.devCommand({ k: 'material', v: 13 })", 6000],
  ['material:silver', "window.__showcase.api.devCommand({ k: 'material', v: 16 })", 6000],
  ...(() => { try { return require(path.join(ROOT, 'being', 'local', 'witness.cjs')); } catch { return []; } })(),   // the local folder's own features
];
// what a frame looks like, in terms ON's own motion hardly changes (it dances, turns and pulses, so pixels move all the time):
// how its brightness is spread (16 bins), its light from the centre outward (10 rings), its colour, and how much fine structure it
// has; averaged over a few frames. Distance between two such descriptions, roughly 0..100.
function describe(frames) {
  const d = new Float64Array(16 + 10 + 3 + 1);
  for (const { px, W, H } of frames) {
    let n = 0; const ring = new Float64Array(10), rn = new Float64Array(10), rgb = [0, 0, 0]; let edge = 0;
    for (let y = 1; y < H - 1; y += 2) for (let x = 1; x < W - 1; x += 2) {
      const dx = x - W / 2, dy = y - H / 2, rr = Math.sqrt(dx * dx + dy * dy) / (H * .48); if (rr >= 1) continue;
      const i = (y * W + x) * 4, L = (.3 * px[i + 2] + .59 * px[i + 1] + .11 * px[i]) / 255, Lr = (.3 * px[i + 6] + .59 * px[i + 5] + .11 * px[i + 4]) / 255, Ld = (.3 * px[i + W * 4 + 2] + .59 * px[i + W * 4 + 1] + .11 * px[i + W * 4]) / 255;
      d[Math.min(15, L * 16 | 0)]++; const k = rr * 10 | 0; ring[k] += L; rn[k]++; rgb[0] += px[i + 2] / 255; rgb[1] += px[i + 1] / 255; rgb[2] += px[i] / 255; edge += Math.abs(L - Lr) + Math.abs(L - Ld); n++;
    }
    for (let k = 0; k < 16; k++) d[k] = d[k];   // counts, normalised below
    for (let k = 0; k < 10; k++) d[16 + k] += rn[k] ? ring[k] / rn[k] : 0;
    for (let k = 0; k < 3; k++) d[26 + k] += rgb[k] / n; d[29] += edge / n; d.n = (d.n || 0) + n;
  }
  const F = frames.length; let hs = 0; for (let k = 0; k < 16; k++) hs += d[k]; for (let k = 0; k < 16; k++) d[k] /= hs; for (let k = 16; k < 30; k++) d[k] /= F;
  return d;
}
function dist(a, b) {
  let h = 0, r = 0, c = 0; for (let k = 0; k < 16; k++) h += Math.abs(a[k] - b[k]); for (let k = 16; k < 26; k++) r += Math.abs(a[k] - b[k]); for (let k = 26; k < 29; k++) c += Math.abs(a[k] - b[k]);
  return 100 * (h / 2 + r / 10 + c / 3 + Math.abs(a[29] - b[29]) * 4) / 4;
}
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 480, height: 480, backgroundColor: '#000', webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false, offscreen: true } });
  w.webContents.setFrameRate(60);
  const errors = []; w.webContents.on('console-message', (e) => { const m = e.message || ''; if (/Uncaught|ERROR|rror:/.test(m)) errors.push(m.slice(0, 300)); });
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '0', showcase: '1' } });
  for (let i = 0; i < 60 && !(await w.webContents.executeJavaScript('!!window.__showcase')); i++) await sleep(500);
  const js = (s) => w.webContents.executeJavaScript(s);
  await js("window.__showcase.go(2); window.__noBurst = true; setTimeout(() => dispatchEvent(new KeyboardEvent('keydown', { key: ' ' })), 2500)"); await sleep(6000);   // a groove, then the tour paused
  let saveAs = null; const frame = async () => { const im = await w.webContents.capturePage(); const sz = im.getSize(); if (saveAs) { require('node:fs').writeFileSync(path.join(__dirname, saveAs), im.toPNG()); saveAs = null; } return { px: im.toBitmap(), W: sz.width, H: sz.height }; };
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  let fails = 0;
  for (const [name, on, ms, kind] of FEATURES) {
    if (only && !only.includes(name)) continue;
    const take = async (n) => { const f = []; for (let i = 0; i < n; i++) { f.push(await frame()); await sleep(450); } return describe(f); };
    await js(OFF_ALL); await sleep(3500);
    const a = await take(4); await sleep(Math.max(0, ms - 1800)); if (process.env.SAVE) saveAs = `witness-${name.replace(':', '-')}-off.png`; const b = await take(4);
    if (process.env.SAVE) saveAs = `witness-${name.replace(':', '-')}-off.png`;
    await sleep(0);
    await js(on); await sleep(ms); if (process.env.SAVE) saveAs = `witness-${name.replace(':', '-')}-on.png`; const c = await take(4);
    let self = dist(a, b), effect = dist(b, c), ok = effect > Math.max(1.5, self * 2.5);
    if (!ok && effect > self * 1.2 && !kind) {   // borderline: once more, from the start
      await js(OFF_ALL); await sleep(3500); const a2 = await take(4); await sleep(Math.max(0, ms - 1800)); const b2 = await take(4); await js(on); await sleep(ms); const c2 = await take(4);
      self = dist(a2, b2); effect = dist(b2, c2); ok = effect > Math.max(1.5, self * 2.5);
    }
    const tag = ok ? 'pass' : kind === 'eye' ? 'eye ' : 'FAIL'; if (tag === 'FAIL') fails++;
    console.log(`${tag}  ${name.padEnd(16)} changed ${effect.toFixed(1).padStart(5)}  (by itself ${self.toFixed(1)})`);
  }
  await js(OFF_ALL);
  if (errors.length) { fails++; console.log('FAIL  page errors:\n  ' + errors.slice(0, 5).join('\n  ')); }
  console.log(fails ? `${fails} failed` : 'all seen'); app.exit(fails ? 1 : 0);
});
