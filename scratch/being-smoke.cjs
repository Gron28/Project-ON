// headless: load the being page, stream a wav into it as per-app PCM, screenshot at a few moments, print its inner life
const { app, BrowserWindow } = require('electron'); const path = require('node:path'); const fs = require('node:fs');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(require('electron').ipcMain, app);
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: true, x: -3000, y: 0, skipTaskbar: true, focusable: false, width: 900, height: 900, backgroundColor: '#000', webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  w.webContents.on('console-message', (e) => { const m = e.message || ''; if (!/Security|Policy|risks|electronjs|packaged|^\s*$/.test(m)) console.log('[page]', m.slice(0, 240), e.sourceId ? path.basename(e.sourceId) + ':' + (e.lineNumber || '') : ''); });
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '1' } });
  w.webContents.send('look', { light: 'being', finish: 'chrome', fx: { spikes: true, rings: true, film: false, sparks: true }, lobes: 'being', offset: 40, hud: true, tune: {} });
  w.webContents.send('source', 'test track');
  setTimeout(() => w.webContents.send('track', { key: process.env.TRACK || 'smoke|test song', title: process.env.TRACK || 'test song', artist: 'lab' }), 1500);
  const wav = fs.readFileSync(process.env.WAV); const data = wav.subarray(44); // 16-bit mono 48k from ffmpeg
  const mono = new Int16Array(data.buffer, data.byteOffset, data.length >> 1);
  let pos = 0; const CH = 960;
  const shots = (process.env.SHOTS || '4,12,20').split(',').map(Number); let si = 0;
  const t0 = Date.now();
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    const want = Math.floor((Date.now() - t0) / 1000 * 48000);
    while (pos < want && pos + CH <= mono.length) { const b = Buffer.alloc(CH * 4); for (let i = 0; i < CH; i++) { b.writeInt16LE(mono[pos + i], i * 4); b.writeInt16LE(mono[pos + i], i * 4 + 2); } w.webContents.send('pcm', b); pos += CH; }
    const sec = (Date.now() - t0) / 1000;
    if (si < shots.length && sec >= shots[si]) {
      busy = true;
      if (process.env.FORCE) { await w.webContents.executeJavaScript(`window.__force = ${process.env.FORCE}`); await new Promise(r => setTimeout(r, 400)); }
      const img = await w.webContents.capturePage(); fs.writeFileSync(path.join(__dirname, `being-${shots[si]}s.png`), img.toPNG());
      const txt = await w.webContents.executeJavaScript(`document.querySelector('#being').innerText.split(String.fromCharCode(10)).join(' | ')`);
      console.log(`t=${shots[si]}s`, txt); si++;
      if (process.env.PNG) { const u = await w.webContents.executeJavaScript('(function(){ try { return window.__songPng(); } catch (e) { return "error: " + e.message; } })()');
        console.log('png', u.startsWith('data:') ? 'ok ' + u.length : u); if (u.startsWith('data:image/png')) fs.writeFileSync(path.join(__dirname, 'memory-unwrap.png'), Buffer.from(u.slice(22), 'base64')); }
      const dbg = await w.webContents.executeJavaScript(`(() => { const b = window.__being(); const m = b.mind; const bad = Object.entries(b.U).filter(([k, v]) => { const x = v.value; return typeof x === 'number' ? !Number.isFinite(x) : x && x.isVector2 ? !Number.isFinite(x.x + x.y) : false; }).map(([k]) => k);
        return JSON.stringify({ A: m.arousal, V: m.valence, E: m.energy, F: m.surprise, dF: m.dF, daPh: m.daPhasic, daAnt: m.daAnticipation, daTon: m.daTonic, groove: m.groove, lock: m.lock, mood: m.mood, int: b.intensity, intAbs: b.intensityAbs, rough: b.earFrame && b.earFrame.rough, level: b.earFrame && b.earFrame.level, nanUniforms: bad, scale: b.U.uScale.value, awake: b.S.awake, frameMs: b.frameMs, nuc: b.U.uNuc.value, thick: b.U.uThick.value, feel: m.feeling(), songAmt: b.U.uSongAmt.value }); })()`);
      console.log('   ', dbg);
      if (si === shots.length) { clearInterval(timer); app.quit(); }
      busy = false;
    }
  }, 20);
});
