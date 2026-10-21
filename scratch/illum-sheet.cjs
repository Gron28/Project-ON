// contact sheet of lab/prototypes/absorption.html: rows forms, columns depths -> scratch/absorption-sheet.png. FORMS=0,1 DEPTHS=0,.5,1 TILE=300 TIME=7.3
const { app, BrowserWindow } = require('electron'); const path = require('node:path'); const fs = require('node:fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const forms = process.env.FORMS || '0,1,2,3,4,5,6', depths = process.env.DEPTHS || '0,.5,1', tile = +(process.env.TILE || 300);
  const w = new BrowserWindow({ show: true, x: -4000, y: 0, width: tile * 4, height: tile * forms.split(',').length, useContentSize: true, backgroundColor: '#000', skipTaskbar: true, focusable: false });
  w.webContents.on('console-message', (e) => { if (/rror/.test(e.message)) console.log('[page]', e.message.slice(0, 800)); });
  await w.loadFile(path.join(__dirname, '..', 'lab', 'prototypes', 'illuminated.html'), { query: { sheet: '1', forms, js: process.env.JS || '0,.4,.7,1', pal: process.env.PAL || '0', time: process.env.TIME || '7.3' } });
  for (let i = 0; i < 100 && !(await w.webContents.executeJavaScript('!!window.__done')); i++) await sleep(100);
  await sleep(300);
  const out = process.env.OUT || path.join(__dirname, 'illum-sheet.png');
  fs.writeFileSync(out, (await w.webContents.capturePage()).toPNG()); console.log('wrote', out);
  app.quit();
});
