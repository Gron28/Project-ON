// E07 latency: feed a kick track in real time, log when each kick's samples arrived and when the body showed it.
// Reports, per 10 s window: reactive hit delay (kick arrival -> visible kick) and pulse asynchrony (beat wrap - kick arrival).
const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('node:path'); const fs = require('node:fs');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(ipcMain, app);
const WAV = process.env.WAV || path.join(__dirname, 'clicks120.wav'), PERIOD = +(process.env.PERIOD || 0.5), FIRST = 1.0, CHUNK = +(process.env.CHUNK || 480);
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: true, x: -3000, y: 0, width: 700, height: 700, backgroundColor: '#000', skipTaskbar: true, focusable: false, webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  w.webContents.on('console-message', (e) => { const m = e.message || ''; if (/error|Error/.test(m)) console.log('[page]', m.slice(0, 200)); });
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '1' } });
  if (process.env.DIALS) await w.webContents.executeJavaScript(`localStorage.setItem('being-dials', ${JSON.stringify(process.env.DIALS)}); location.reload()`).catch(() => {});
  await new Promise((r) => setTimeout(r, 2500));
  await w.webContents.executeJavaScript('window.__latLog = []; window.__frameLog = []; window.__evLog = []; 1');
  const wav = fs.readFileSync(WAV).subarray(44), mono = new Int16Array(wav.buffer, wav.byteOffset, wav.length >> 1);
  let pos = 0; const t0 = Date.now(), DUR = +(process.env.DUR || 60);
  await new Promise((done) => {
    const iv = setInterval(() => {
      const want = Math.min(mono.length, Math.floor((Date.now() - t0) / 1000 * 48000));
      while (pos + CHUNK <= want) { const b = Buffer.alloc(CHUNK * 4); for (let i = 0; i < CHUNK; i++) { b.writeInt16LE(mono[pos + i], i * 4); b.writeInt16LE(mono[pos + i], i * 4 + 2); } w.webContents.send('pcm', b); pos += CHUNK; }
      if (pos + CHUNK > mono.length || Date.now() - t0 > DUR * 1000) { clearInterval(iv); done(); }
    }, 5);
  });
  const { lat, fr, ev, extra } = await w.webContents.executeJavaScript('({ lat: window.__latLog, fr: window.__frameLog, ev: window.__evLog, extra: window.__timingInfo ? window.__timingInfo() : null })');
  // received count at log start (the page had silence fed before) : the first kick is FIRST s into the track
  const base = lat[1] - CHUNK;   // samples received before the first track chunk
  const arrive = (s) => { for (let i = 0; i < lat.length; i += 3) if (lat[i + 1] >= s) return lat[i] - (lat[i + 1] - s) / 48; return null; };
  const kicks = []; for (let n = 0; ; n++) { const s = base + Math.round((FIRST + n * PERIOD) * 48000); const a = arrive(s); if (a === null) break; kicks.push(a); }
  const F = []; for (let i = 0; i + 4 < fr.length; i += 5) F.push({ t: fr[i], kick: fr[i + 1], pulse: fr[i + 2], ph: fr[i + 3] });
  // values logged at frame i were computed (and shown) at frame i-1
  const shown = F.slice(1).map((f, i) => ({ t: F[i].t, kick: f.kick, pulse: f.pulse, ph: f.ph }));
  // seen = frame time + display latency (1.5 frames + 4 ms); heard = arrival - capture (15 ms) + speaker delay (30 ms)
  const frameMs0 = (shown[shown.length - 1].t - shown[0].t) / shown.length, DISP = 1.5 * frameMs0 + 4, HEARD = -15 + 30;
  const hitDelay = [], async = [];
  const rises = []; for (let i = 1; i < shown.length; i++) if (shown[i].kick > 0.5 && shown[i - 1].kick <= 0.5) rises.push(shown[i].t + DISP);
  const wraps = []; for (let i = 1; i < shown.length; i++) if (shown[i - 1].ph > 0.7 && shown[i].ph < 0.3) wraps.push(shown[i].t + DISP);
  for (const a0 of kicks) {
    const a = a0 + HEARD;
    let b = null; for (const r of rises) { const d = r - a; if (Math.abs(d) < 200 && (b === null || Math.abs(d) < Math.abs(b))) b = d; } if (b !== null) hitDelay.push({ a: a0, d: b });
    let w = null; for (const r of wraps) { const d = r - a; if (Math.abs(d) < PERIOD * 500 && (w === null || Math.abs(d) < Math.abs(w))) w = d; } if (w !== null) async.push({ a: a0, d: w });
  }
  const t00 = kicks[0], win = (arr, lo, hi) => arr.filter((x) => x.a - t00 >= lo * 1000 && x.a - t00 < hi * 1000).map((x) => x.d);
  const st = (v) => { if (!v.length) return '   -   '; const s = v.slice().sort((a, b) => a - b); const med = s[s.length >> 1]; const sd = Math.sqrt(v.reduce((q, x) => q + (x - med) ** 2, 0) / v.length); return `${med.toFixed(0).padStart(5)} ±${sd.toFixed(0).padStart(3)} (${v.length})`; };
  const frameMs = (shown[shown.length - 1].t - shown[0].t) / shown.length;
  console.log(`frame ${frameMs.toFixed(1)} ms · kicks ${kicks.length}`);
  console.log('seen minus heard, ms (negative = early)'); console.log('window   kick flash          beat pulse');
  for (let lo = 0; lo < DUR; lo += 10) console.log(`${String(lo).padStart(3)}-${String(lo + 10).padEnd(3)}  ${st(win(hitDelay, lo, lo + 10)).padEnd(18)}  ${st(win(async, lo, lo + 10))}`);
  { // analyzer stamps vs truth: true kick index in the analyzer timeline
    const anIdx = (sIdx) => { for (let i = 0; i < lat.length; i += 3) if (lat[i + 1] >= sIdx) return lat[i + 2] - (lat[i + 1] - sIdx); return null; };
    const truth = []; for (let n = 0; n < kicks.length; n++) truth.push(anIdx(base + Math.round((FIRST + n * PERIOD) * 48000)) / 48);
    for (const type of ['kick', 'beat']) { const d = []; for (let i = 0; i < ev.length; i += 2) if (ev[i] === type) { const t = ev[i + 1] * 1000; let b = null; for (const x of truth) { const q = t - x; if (b === null || Math.abs(q) < Math.abs(b)) b = q; } if (b !== null && Math.abs(b) < 150) d.push(b); }
      console.log(type + ' stamp minus truth ms:', st(d)); }
  }
  if (extra) console.log('timing', JSON.stringify(extra));
  fs.writeFileSync(path.join(__dirname, 'latency-last.json'), JSON.stringify({ kicks, hitDelay, async, frameMs }));
  app.quit();
});
