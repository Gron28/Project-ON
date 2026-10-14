// voice lab: learn a song for a while, keep a moment, go silent, hover, and watch the voice go hum -> babble -> replay
const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('node:path'); const fs = require('node:fs');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(ipcMain, app);
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: true, x: -3000, y: 0, width: 600, height: 600, backgroundColor: '#000', skipTaskbar: true, focusable: false, webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  w.webContents.on('console-message', (e) => { const m = e.message || ''; if (/rror|voice|warn/i.test(m) && !/brain/.test(m)) console.log('[page]', m.slice(0, 300)); });
  await w.loadFile(path.join(ROOT, 'being', process.env.PAGE || 'index.html'), { query: { local: '1' } });
  w.webContents.send('track', { key: 'lab|voice-test|x', title: 'voice test', artist: 'lab', app: 'lab' });
  const wav = fs.readFileSync(process.env.WAV).subarray(44), mono = new Int16Array(wav.buffer, wav.byteOffset, wav.length >> 1);
  let pos = 0; const t0 = Date.now(), PLAY = +(process.env.PLAY || 25);
  setInterval(() => { if (Date.now() - t0 > PLAY * 1000) return; const want = Math.floor((Date.now() - t0) / 1000 * 48000); while (pos < want && pos + 960 <= mono.length) { const b = Buffer.alloc(3840); for (let i = 0; i < 960; i++) { b.writeInt16LE(mono[pos + i], i * 4); b.writeInt16LE(mono[pos + i], i * 4 + 2); } w.webContents.send('pcm', b); pos += 960; } }, 20);
  const at = (s) => new Promise((r) => setTimeout(r, Math.max(0, s * 1000 - (Date.now() - t0))));
  await at(12); console.log('keep', await w.webContents.executeJavaScript('window.__voiceKeep("lab"), JSON.stringify(window.__voice())'));
  await at(PLAY + 6); console.log('silence', await w.webContents.executeJavaScript('JSON.stringify(window.__voice())'));
  // hover alone must not sing; then press the sing button
  const hover = setInterval(() => w.webContents.sendInputEvent({ type: 'mouseMove', x: 300, y: 300 }), 100);
  await at(PLAY + 8); console.log('hover only', await w.webContents.executeJavaScript('JSON.stringify(window.__voice())'));
  console.log('press', await w.webContents.executeJavaScript("document.querySelector('#fb .sing').click(), document.querySelector('#fb .sing').className"));
  for (const s of [1, 2.5, 5, 9, 12, 16]) { await at(PLAY + 8 + s); console.log('hover', s, await w.webContents.executeJavaScript('JSON.stringify(window.__voice())')); }
  console.log('press again', await w.webContents.executeJavaScript("document.querySelector('#fb .sing').click(), JSON.stringify(window.__voice())"));
  clearInterval(hover);
  await at(PLAY + 8 + 22); console.log('after', await w.webContents.executeJavaScript('JSON.stringify(window.__voice())'));
  app.quit();
});
