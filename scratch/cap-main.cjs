const { app, BrowserWindow, session, desktopCapturer } = require('electron'); const path = require('path');
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  session.defaultSession.setDisplayMediaRequestHandler((req, cb) => desktopCapturer.getSources({ types: ['screen'] }).then((s) => { console.log('sources', s.length); cb({ video: s[0], audio: 'loopback' }); }).catch((e) => { console.log('handler error', e.message); cb({}); }), { useSystemPicker: false });
  await w.loadFile(path.join(__dirname, 'blank.html'));
  const r = await w.webContents.executeJavaScript(`(async () => {
    const out = {};
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
      out.tracks = stream.getTracks().map(t => t.kind + ':' + t.label + ':' + t.readyState);
      stream.getVideoTracks().forEach(t => t.stop());
      const ctx = new AudioContext({ sampleRate: 48000 }); await ctx.resume();
      const src = ctx.createMediaStreamSource(stream); const an = ctx.createAnalyser(); an.fftSize = 2048; src.connect(an);
      const g = ctx.createGain(); g.gain.value = 0; an.connect(g); g.connect(ctx.destination);
      const buf = new Float32Array(2048); const peaks = [];
      for (let i = 0; i < 15; i++) { await new Promise(r => setTimeout(r, 200)); an.getFloatTimeDomainData(buf); let p = 0; for (const x of buf) p = Math.max(p, Math.abs(x)); peaks.push(+p.toFixed(3)); }
      out.peaks = peaks; out.ctxState = ctx.state;
      const devs = await navigator.mediaDevices.enumerateDevices(); out.outputs = devs.filter(d => d.kind === 'audiooutput').map(d => d.label);
    } catch (e) { out.error = String(e); }
    return JSON.stringify(out);
  })()`);
  console.log(r); app.quit();
});
