// the look passes' optimisations against the code they replace, on identical inputs (scratch/look-equiv.html).
// [SWIFT=1] [ONLY=lenia,morph,particles] ./node_modules/.bin/electron scratch/look-equiv.cjs   (base copies: scratch/perf/look-passes/base/)
const { app, BrowserWindow } = require('electron'); const path = require('node:path');
if (process.env.SWIFT) { app.commandLine.appendSwitch('use-angle', 'swiftshader'); app.commandLine.appendSwitch('enable-unsafe-swiftshader'); }
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: true, x: -3000, y: 0, width: 300, height: 300, skipTaskbar: true, focusable: false, webPreferences: { sandbox: false, backgroundThrottling: false } });
  w.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) console.log('[page]', String(e.message).slice(0, 400)); });
  await w.loadFile(path.join(__dirname, 'look-equiv.html'));
  const js = (s) => w.webContents.executeJavaScript(s);
  for (let i = 0; i < 50 && !(await js('!!window.ready')); i++) await new Promise((r) => setTimeout(r, 200));
  const only = (process.env.ONLY || 'lenia,morph,particles').split(',');
  try {
    if (only.includes('lenia')) console.log('lenia', JSON.stringify(await js('leniaEquiv()')));
    if (only.includes('lenia-short')) for (const n of [1, 5, 30, 120]) console.log('lenia ticks', n, JSON.stringify(await js(`leniaEquiv(['spots', 'waves'], ${n})`)));
    if (only.includes('lenia-self')) console.log('lenia base vs base', JSON.stringify(await js('window.__selfA = true; leniaEquiv()')));
    if (only.includes('morph')) console.log('morph', JSON.stringify(await js('morphEquiv()')));
    if (only.includes('particles')) console.log('particles', JSON.stringify(await js('particlesEquiv()')));
  } catch (e) { console.log('error', e.message); }
  app.quit();
});
