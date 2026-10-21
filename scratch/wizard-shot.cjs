const { app, BrowserWindow } = require('electron'); const fs = require('fs'); const path = require('path');
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 460, height: 560, backgroundColor: '#0d0d0d', webPreferences: { offscreen: true } });
  w.webContents.on('console-message', (e) => console.log('[wiz]', e.message));
  await w.loadURL(process.env.URL); await new Promise((r) => setTimeout(r, 1500));
  fs.writeFileSync(path.join(__dirname, 'wizard.png'), (await w.webContents.capturePage()).toPNG()); app.quit();
});
