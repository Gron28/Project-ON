// contact sheets of lab/prototypes/fractal-body.html: rows are forms, columns (rise:ether) -> OUT (default scratch/fbody-<forms>.png)
// FORMS=0,1,2,3 COLS=0:0,.5:0,1:0,1:.6,1:1 TILE=260 TIME=12
const { app, BrowserWindow } = require('electron'); const path = require('node:path'); const fs = require('node:fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const forms = process.env.FORMS || '0,1,2,3', cols = process.env.COLS || '0:0,.5:0,1:0,1:.6,1:1', tile = +(process.env.TILE || 260);
  const w = new BrowserWindow({ show: true, x: -4000, y: 0, width: tile * cols.split(',').length, height: tile * forms.split(',').length, useContentSize: true, backgroundColor: '#000', skipTaskbar: true, focusable: false, webPreferences: { zoomFactor: 1 } });
  w.webContents.on('console-message', (e) => console.log('[page]', e.message.slice(0, 800)));
  await w.loadFile(path.join(__dirname, '..', 'lab', 'prototypes', 'fractal-body.html'), { query: { sheet: '1', forms, cols, time: process.env.TIME || '12' } });
  for (let i = 0; i < 200 && !(await w.webContents.executeJavaScript('!!window.__done')); i++) await sleep(100);
  await sleep(300);
  const out = process.env.OUT || path.join(__dirname, `fbody-${forms.replace(/,/g, '')}.png`);
  fs.writeFileSync(out, (await w.webContents.capturePage()).toPNG()); console.log('wrote', out);
  app.quit();
});
