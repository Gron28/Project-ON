// one screenshot per glitch style (always on, not reactive) at AMT (default .35,.8) -> scratch/glitch-<style>-<amt>.png
//   ./node_modules/.bin/electron scratch/glitch-gallery.cjs   (ONLY=split,tear ...)
const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('node:path'); const fs = require('node:fs');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(ipcMain, app); ipcMain.on('ml-get', (e) => { e.returnValue = null; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: true, x: -3000, y: 0, width: 600, height: 600, backgroundColor: '#000', skipTaskbar: true, focusable: false, webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  w.webContents.on('console-message', (e) => { if (process.env.ALL || /error|ERROR|warn|THREE/i.test(e.message)) console.log('[page]', e.message.slice(0, 500)); });
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '0', ui: '0', showcase: '1' } });   // the silent showcase music keeps it awake
  for (let i = 0; i < 40 && !(await w.webContents.executeJavaScript('!!window.__showcase')); i++) await sleep(500);
  await w.webContents.executeJavaScript('window.__showcase.go(2); window.__noBurst = true');
  await sleep(2500);
  const shot = async (name) => fs.writeFileSync(path.join(__dirname, name), (await w.webContents.capturePage()).toPNG());
  await shot('glitch-none.png');
  const styles = (process.env.ONLY || 'split,tear,mosh,sort,crt,corrupt').split(','), amts = (process.env.AMT || '.35,.8').split(',').map(Number);
  for (const s of styles) for (const a of amts) {
    await w.webContents.executeJavaScript(`window.__glitch(${JSON.stringify({ style: s, amt: a, react: false })})`); await sleep(900);
    await shot(`glitch-${s}-${a}.png`); console.log(s, a);
  }
  await w.webContents.executeJavaScript(`window.__glitch({ style: 'off', react: true })`);   // leave the profile as it was
  app.quit();
});
