// screenshots of lab/prototypes/material-proposals.html. SHOTS="mat:view:t,..." (view compare|journey, t = seconds into the music)
// -> scratch/prop-<mat>-<view>-<t>.png (the stage only)
const { app, BrowserWindow } = require('electron'); const path = require('node:path'); const fs = require('node:fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
process.on('unhandledRejection', (e) => { console.log('REJECT', (e && e.stack) || e); app.quit(); });
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: true, x: -3000, y: 0, width: 1400, height: 900, backgroundColor: '#000', skipTaskbar: true, focusable: false, webPreferences: { backgroundThrottling: false } });
  w.webContents.on('console-message', (e) => { if (/error|compile|uncaught/i.test(e.message)) console.log('[page]', e.message.slice(0, 600)); });
  await w.loadFile(path.join(__dirname, '..', 'lab', 'prototypes', 'material-proposals.html'));
  await sleep(1200);
  const err = await w.webContents.executeJavaScript(`(document.getElementById('err').hidden ? '' : document.getElementById('err').textContent)`);
  if (err) { console.log('ERROR', err); app.quit(); return; }
  for (const s of (process.env.SHOTS || '0:compare:6').split(',')) {
    const [m, view, t] = s.split(':');
    await w.webContents.executeJavaScript(`window.__proposal(${+m}, '${view}', ${+t})`); await sleep(+(process.env.DWELL || 2500));
    const r = await w.webContents.executeJavaScript(`(() => { const b = document.getElementById('stage').getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map(Math.round); })()`);
    fs.writeFileSync(path.join(__dirname, `prop-${m}-${view}-${t}.png`), (await w.webContents.capturePage({ x: r[0], y: r[1], width: r[2], height: r[3] })).toPNG());
    console.log('shot', s);
  }
  app.quit();
});
