// affect calibration: stream a wav through the real page (fresh profile each run, so no memory carries over), sample its
// feeling against the genre / mood model twice a second, write scratch/affect/<name>.jsonl and <name>.svg.
//   WAV=<abs path, 16-bit pcm, any channels, 48 kHz> [SECS=<max seconds>] ./node_modules/.bin/electron scratch/affect-lab.cjs
const { app, BrowserWindow } = require('electron'); const path = require('node:path'); const fs = require('node:fs'); const os = require('node:os');
const ROOT = path.join(__dirname, '..'), OUT = path.join(__dirname, 'affect');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'affect-lab-')));
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(require('electron').ipcMain, app);

function readWav(file) {   // walks the chunks (parecord writes a LIST chunk), mixes to mono
  const b = fs.readFileSync(file); let p = 12, ch = 1, rate = 48000, bits = 16, data = null;
  while (p + 8 <= b.length) {
    const id = b.toString('ascii', p, p + 4), n = b.readUInt32LE(p + 4);
    if (id === 'fmt ') { ch = b.readUInt16LE(p + 10); rate = b.readUInt32LE(p + 12); bits = b.readUInt16LE(p + 22); }
    if (id === 'data') { data = b.subarray(p + 8, Math.min(b.length, p + 8 + (n || b.length))); break; }
    p += 8 + n + (n & 1);
  }
  if (!data || bits !== 16) throw new Error('need 16-bit pcm wav: ' + file);
  if (rate !== 48000) throw new Error('need 48 kHz, got ' + rate);
  const s = new Int16Array(data.buffer, data.byteOffset, data.length >> 1), n = Math.floor(s.length / ch), mono = new Int16Array(n);
  for (let i = 0; i < n; i++) { let a = 0; for (let c = 0; c < ch; c++) a += s[i * ch + c]; mono[i] = a / ch; }
  return mono;
}

app.whenReady().then(async () => {
  const name = path.basename(process.env.WAV).replace(/\.wav$/i, '');
  const mono = readWav(process.env.WAV), secs = Math.min(mono.length / 48000, Number(process.env.SECS) || 1e9);
  fs.mkdirSync(OUT, { recursive: true });
  const w = new BrowserWindow({ show: true, x: -3000, y: 0, skipTaskbar: true, focusable: false, width: 600, height: 600, backgroundColor: '#000', webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  w.webContents.on('console-message', (e) => { const m = e.message || ''; if (/error|Error|NaN/.test(m) && !/Security|Policy/.test(m)) console.log('[page]', m.slice(0, 200)); });
  await w.loadFile(path.join(ROOT, 'being', 'index.html'), { query: { local: '1' } });
  w.webContents.send('source', 'affect lab');
  if (process.env.JUMPS) await w.webContents.executeJavaScript('window.__jumpWatch = true');
  setTimeout(() => w.webContents.send('track', { key: 'lab|' + name, title: name, artist: 'lab' }), 1500);
  const rows = []; let pos = 0, nextS = 1; const CH = 960, t0 = Date.now(); let busy = false;
  const timer = setInterval(async () => {
    const want = Math.floor((Date.now() - t0) / 1000 * 48000);
    while (pos < want && pos + CH <= mono.length) { const b = Buffer.alloc(CH * 4); for (let i = 0; i < CH; i++) { b.writeInt16LE(mono[pos + i], i * 4); b.writeInt16LE(mono[pos + i], i * 4 + 2); } w.webContents.send('pcm', b); pos += CH; }
    const sec = (Date.now() - t0) / 1000;
    if (busy || sec < nextS) return;
    busy = true; nextS += 0.5;
    try { const r = await w.webContents.executeJavaScript('({ ...window.__affect(), rh: window.__rhythm ? window.__rhythm() : null, vox: window.__vox ? window.__vox() : null })'); r.t = +sec.toFixed(2); rows.push(r); } catch (e) { console.log('sample failed', e.message); }
    busy = false;
    if (sec >= secs + 1) {
      clearInterval(timer);
      fs.writeFileSync(path.join(OUT, name + '.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
      fs.writeFileSync(path.join(OUT, name + '.svg'), plot(name, rows));
      if (process.env.JUMPS) { const j = await w.webContents.executeJavaScript('window.__jumps || []'); fs.writeFileSync(path.join(OUT, name + '.jumps.json'), JSON.stringify(j)); console.log('jumps', j.length); }
      console.log(summary(name, rows)); app.quit();
    }
  }, 20);
});

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
function summary(name, rows) {
  const r = rows.filter((x) => x.t > 15), ml = r.filter((x) => x.ml), mats = {};
  for (const x of r) for (const [m, wt] of x.mat) mats[m] = (mats[m] || 0) + wt / r.length;
  const top = Object.entries(mats).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m, v]) => m + ' ' + v.toFixed(2)).join(', ');
  const f = (k, src = r) => mean(src.map(k)).toFixed(2);
  return `${name}\n  arousal ${f((x) => x.A)}  valence ${f((x) => x.V)}  music A ${f((x) => x.mA)} V ${f((x) => x.mV)}  body intensity ${f((x) => x.Sint)}  maxim ${f((x) => x.maxim)}  loudness ${f((x) => x.ch.loudness)}\n  model: relaxed ${f((x) => x.ml.relaxed, ml)} aggressive ${f((x) => x.ml.aggressive, ml)} happy ${f((x) => x.ml.happy, ml)} sad ${f((x) => x.ml.sad, ml)} engaging ${f((x) => x.ml.engaging, ml)}\n  materials: ${top}`;
}
function plot(name, rows) {   // one svg: the mind and the body above, the model's reading below
  const W = 1000, H = 420, T = rows.length ? rows[rows.length - 1].t : 1, X = (t) => 40 + (t / T) * (W - 60);
  const line = (get, y0, h, col, lo = 0, hi = 1) => '<polyline fill="none" stroke="' + col + '" stroke-width="1.6" points="' + rows.filter((r) => Number.isFinite(get(r))).map((r) => X(r.t).toFixed(1) + ',' + (y0 + h - ((get(r) - lo) / (hi - lo)) * h).toFixed(1)).join(' ') + '"/>';
  const key = (items, y) => items.map(([lab, col], i) => `<text x="${50 + i * 140}" y="${y}" fill="${col}" font-size="12">${lab}</text>`).join('');
  const top = [['arousal', '#ff5050', (r) => r.A], ['valence (-1..1)', '#50d0ff', (r) => (r.V + 1) / 2], ['body intensity', '#ffffff', (r) => r.Sint], ['maximalism', '#ffcc33', (r) => r.maxim], ['music arousal', '#ff9de0', (r) => r.hasM > .05 ? r.mA : NaN]];
  const bot = [['relaxed', '#7cf08a', (r) => r.ml && r.ml.relaxed], ['aggressive', '#ff7a30', (r) => r.ml && r.ml.aggressive], ['happy', '#ffe060', (r) => r.ml && r.ml.happy], ['sad', '#8f8fff', (r) => r.ml && r.ml.sad], ['engaging', '#e070ff', (r) => r.ml && r.ml.engaging]];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="sans-serif"><rect width="100%" height="100%" fill="#111"/>
<text x="40" y="18" fill="#ddd" font-size="14">${name.replace(/[<&]/g, '')}</text>
<rect x="40" y="40" width="${W - 60}" height="150" fill="none" stroke="#333"/><rect x="40" y="240" width="${W - 60}" height="150" fill="none" stroke="#333"/>
${top.map(([, c, g]) => line(g, 40, 150, c)).join('')}${bot.map(([, c, g]) => line(g, 240, 150, c)).join('')}
${key(top.map(([l, c]) => [l, c]), 34)}${key(bot.map(([l, c]) => ['model ' + l, c]), 234)}
<text x="40" y="410" fill="#777" font-size="11">0 s</text><text x="${W - 60}" y="410" fill="#777" font-size="11">${T.toFixed(0)} s</text></svg>`;
}
