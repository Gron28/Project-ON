// headless smoke run of the real app: boots the renderer with a synthetic audio file, waits, captures a frame and the HUD state.
const { app, BrowserWindow, session, desktopCapturer, ipcMain } = require('electron');
const path = require('node:path'); const fs = require('node:fs');
const ROOT = path.join(__dirname, '..');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { preload: path.join(ROOT, 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  session.defaultSession.setDisplayMediaRequestHandler((req, cb) => desktopCapturer.getSources({ types: ['screen'] }).then((s) => cb({ video: s[0], audio: 'loopback' })).catch(() => cb({})), { useSystemPicker: false });
  ipcMain.handle('pick-audio-file', () => process.env.SMOKE_AUDIO || null);
  w.webContents.on('console-message', (e) => { const m = e.message || ''; if (!/Security|Policy|risks|electronjs|packaged|^$|^\s/.test(m)) console.log('[page]', m.slice(0, 300), e.sourceId || '', e.lineNumber || e.line || ''); });
  await w.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  const waitMs = +(process.env.SMOKE_MS || 15000);
  await new Promise((r) => setTimeout(r, 4000));
  if (process.env.SMOKE_AUDIO) await w.webContents.executeJavaScript(`document.querySelector('#src').value='file'; document.querySelector('#src').dispatchEvent(new Event('change'))`);
  await new Promise((r) => setTimeout(r, waitMs));
  const lum = await w.webContents.executeJavaScript(`(() => { const c = document.createElement('canvas'); c.width = 64; c.height = 36; const x = c.getContext('2d'); const out = {}; for (const id of ['bc', 'view']) { x.drawImage(document.getElementById(id), 0, 0, 64, 36); const d = x.getImageData(0, 0, 64, 36).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; out[id] = (s / (d.length / 4) / 3).toFixed(1); } return JSON.stringify(out); })()`);
  console.log('mean luminance', lum);
  const hud = await w.webContents.executeJavaScript(`document.querySelector('#hud').innerText`);
  console.log(hud);
  const bcPng = await w.webContents.executeJavaScript(`document.getElementById('bc').toDataURL('image/png')`);
  fs.writeFileSync(path.join(__dirname, 'smoke-bc.png'), Buffer.from(bcPng.split(',')[1], 'base64'));
  const img = await w.webContents.capturePage(); fs.writeFileSync(path.join(__dirname, 'smoke.png'), img.toPNG());
  app.quit();
});
