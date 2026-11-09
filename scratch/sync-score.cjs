// scratch/sync-score.cjs - does ON move with the music? Streams a wav into the being page (public build, no local folder) in
// real time and logs every frame what it heard and what it showed (uniforms that move the body, timing, gates, the
// mirror and clock, and pixel statistics of the drawn frame). scratch/sync-score-analyze.cjs turns the logs into metrics.
// usage: REPO=<repo> WAV=<abs .wav, 48 kHz mono> OUT=<abs .jsonl> DUR=<s> START=<s> MIRROR=1|0 ./node_modules/.bin/electron scratch/sync-score.cjs
// (MIRROR=0: the movement as before being/mirror.mjs, for A/B.) Only one ON runs at a time unless ENTITY_MULTI=1.
const { app, BrowserWindow, ipcMain, protocol, net } = require('electron'); const path = require('node:path'); const fs = require('node:fs'); const url = require('node:url');
const ROOT = process.env.REPO, OUT = process.env.OUT, DUR = +(process.env.DUR || 80), START = +(process.env.START || 0);
app.setPath('userData', path.join(path.dirname(OUT), 'profile-' + path.basename(OUT, '.jsonl')));
app.commandLine.appendSwitch('disable-renderer-backgrounding'); app.commandLine.appendSwitch('disable-background-timer-throttling');
require(path.join(ROOT, 'being', 'memory-store.cjs')).registerMemoryIpc(ipcMain, app);
ipcMain.handle('page-schema', () => require(path.join(ROOT, 'being', 'tune.cjs')).TUNE);
ipcMain.on('ml-get', (e) => { e.returnValue = { style: true, feel: true, world: true, beat: true }; });
ipcMain.on('has-local', (e) => { e.returnValue = false; });
const INDEX = path.join(ROOT, 'being', 'index.html');
const HOOK = `window.__lab = () => ({ SHOW, MOT, REST, MORPH, SLEEP, an, BEAT, S, mind, U, RHY, REG, LATM, BEAD, V, B, timing, MIRROR, MIR, CLK });\n`;
app.whenReady().then(async () => {
  protocol.handle('file', async (req) => {
    const p = url.fileURLToPath(req.url);
    if (p === INDEX) { let s = fs.readFileSync(INDEX, 'utf8'); const a = 'renderer.setAnimationLoop(ts => {'; if (!s.includes(a)) throw new Error('anchor');
      s = s.replace(a, HOOK + a).replace('window.pet?.hasLocal ?? true', 'false'); return new Response(s, { headers: { 'content-type': 'text/html' } }); }
    return net.fetch(req.url, { bypassCustomProtocolHandlers: true });
  });
  const w = new BrowserWindow({ show: true, x: -3000, y: 0, skipTaskbar: true, focusable: false, width: 520, height: 520, backgroundColor: '#000', webPreferences: { preload: path.join(ROOT, 'being', 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  w.webContents.on('console-message', (e) => { const m = e.message || ''; if (/error|Error|fail/.test(m) && !/Security|Policy/.test(m)) console.log('[page]', m.slice(0, 200)); });
  w.webContents.on('render-process-gone', (e, d) => { console.log('gone', d); app.exit(2); });
  await w.loadFile(INDEX, { query: { local: '0', ui: '0' } });
  const wc = w.webContents;
  wc.send('look', { light: 'being', finish: 'chrome', fx: { spikes: true, rings: true, film: false, sparks: true }, lobes: 'being', offset: 40, hud: false, tune: {} });
  wc.send('bounce', true); wc.send('calm', false); wc.send('ml', { style: true, feel: true, world: true, beat: true }); wc.send('quality', { res: 1, auto: true, hz: 60 });
  wc.send('source', 'test track');
  await new Promise((r) => setTimeout(r, 4000));
  const mir = await wc.executeJavaScript(`window.__mirror ? window.__mirror(${process.env.MIRROR !== '0'}).on : 'missing'`); console.log('mirror', mir);   // page settles, models load, silence first (it falls asleep)
  const name = path.basename(process.env.WAV, '.wav');
  wc.send('track', { key: 'lab|' + name, title: name, artist: 'lab' });
  await wc.executeJavaScript(`(() => {
    const L = window.__lab; window.__rows = []; const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d', { willReadFrequently: true });
    const gl = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
    let prev = null, n = 0;
    const tick = () => { requestAnimationFrame(tick); n++;
      const o = L(), U = o.U, m = o.mind, st = o.an.state, r = { t: o.an.total / 48000, now: performance.now(),
        sc: U.uScale.value, sx: U.uShift.value.x, sy: U.uShift.value.y, shell: U.uShellR.value, kick: U.uKick.value, spk: U.uSpikes.value, chaos: U.uChaos.value, regA: U.uRegA.value,
        reg: Array.from(U.uRegP.value).reduce((a, v) => a + Math.abs(v), 0), coreR: U.uCoreR.value, coreI: U.uCoreI.value, halo: U.uHalo.value, morphA: U.uMorphA.value, skinA: U.uSkinA.value, caA: U.uCaA.value,
        bp: U.uBeatPulse ? U.uBeatPulse.value : 0, ph: o.SHOW.phase, cnt: o.SHOW.count, gate: o.SHOW.gate, lock: m.lock, hz: m.pulseHz, groove: m.groove, A: m.arousal, Vl: m.valence, da: m.daPhasic,
        M: o.REST.M, show: o.MORPH.show, z: o.SLEEP.z, D: o.MOT.D, awake: o.S.awake, grid: o.S.grid, X: o.S.xc, abpm: st.beat.bpm, aph: st.beat.phase, aconf: st.beat.confidence, lvl: st.level, drop: o.S.drop, bead: o.BEAD.a || 0,
        hor: o.LATM.horizon, rhy: o.RHY.aligned ? 1 : 0, Vk: o.V.kick, mir: o.MIRROR.on ? 1 : 0, trust: o.CLK.trust, csrc: o.CLK.beat.source, cbpm: o.CLK.beat.bpm, msize: o.MIR.out.size, surge: o.MIR.out.surge };
      if (n % 2 === 0 && gl) { try { g.drawImage(gl, 0, 0, 128, 128); const d = g.getImageData(0, 0, 128, 128).data, cur = new Float32Array(16384); let s = 0, df = 0, area = 0, cx = 0, cy = 0;
        let a15 = 0, a30 = 0, a50 = 0; for (let i = 0; i < 16384; i++) { const y = (d[i*4] * .3 + d[i*4+1] * .59 + d[i*4+2] * .11) / 255; cur[i] = y; s += y; if (y > .15) a15++; if (y > .3) a30++; if (y > .5) a50++; if (y > .06) { area++; cx += i % 128; cy += (i / 128) | 0; } if (prev) df += Math.abs(y - prev[i]); }
        r.lum = s / 16384; r.area = area / 16384; r.a15 = a15 / 16384; r.a30 = a30 / 16384; r.a50 = a50 / 16384; r.cx = area ? cx / area / 128 : .5; r.cy = area ? cy / area / 128 : .5; r.diff = prev ? df / 16384 : null; prev = cur; } catch (e) { r.err = String(e); } }
      window.__rows.push(r); };
    requestAnimationFrame(tick); return 1; })()`);
  const wav = fs.readFileSync(process.env.WAV); let off = 12; while (wav.toString('ascii', off, off + 4) !== 'data') off += 8 + wav.readUInt32LE(off + 4); const data = wav.subarray(off + 8);
  const mono = new Int16Array(data.buffer, data.byteOffset, data.length >> 1);
  let pos = Math.round(START * 48000); const end = Math.min(mono.length, pos + Math.round(DUR * 48000)), p0 = pos;
  const fd = fs.openSync(OUT, 'w'); const t0 = Date.now(); let done = false;
  const feed = setInterval(() => {
    const want = p0 + Math.floor((Date.now() - t0) / 1000 * 48000);
    while (pos < want && pos + 960 <= end) { const b = Buffer.alloc(3840); for (let i = 0; i < 960; i++) { b.writeInt16LE(mono[pos + i], i * 4); b.writeInt16LE(mono[pos + i], i * 4 + 2); } wc.send('pcm', b); pos += 960; }
    if (process.env.FORCESQ && !globalThis.__fs && pos > end - (+process.env.FORCESQ) * 48000) { globalThis.__fs = 1; wc.executeJavaScript("setInterval(() => { window.__force = { uScale: (Math.floor(performance.now() / 500) % 2) ? 1.08 : .92 }; }, 10)"); }
    if (pos + 960 > end) done = true;
  }, 10);
  // the page's analyser counts samples from launch, including the silence it made itself before the song: mark the song's start
  const t0audio = await wc.executeJavaScript('window.__lab().an.total / 48000');
  fs.writeSync(fd, JSON.stringify({ meta: { wav: process.env.WAV, start: START, dur: DUR, t0audio } }) + '\n');
  const pull = async () => { const rows = await wc.executeJavaScript('(() => { const r = window.__rows; window.__rows = []; return r; })()'); for (const r of rows) fs.writeSync(fd, JSON.stringify(r) + '\n'); };
  const iv = setInterval(async () => { await pull(); if (done) { clearInterval(iv); clearInterval(feed); await new Promise((r) => setTimeout(r, 300)); await pull(); fs.closeSync(fd); app.quit(); } }, 2000);
});
