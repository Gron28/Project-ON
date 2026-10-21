// headless check of per-app capture: list apps, capture Spotify for 4 s, report chunk count and peak
const { app } = require('electron');
app.whenReady().then(async () => {
  const { loadCapture } = require('../native/capture.cjs'); const lb = loadCapture();
  const wins = lb.getVisibleWindows().filter(w => w.title); console.log('windows', wins.map(w => w.processName + ':' + w.title.slice(0, 30)).join(' | '));
  const sp = wins.find(w => /spotify/i.test(w.processName)); if (!sp) { console.log('no spotify'); app.quit(); return; }
  let n = 0, bytes = 0, peak = 0;
  lb.startLoopbackCapture(sp.processId, (c) => { n++; bytes += c.length; const v = new Int16Array(c.buffer, c.byteOffset, c.byteLength >> 1); for (let i = 0; i < v.length; i += 7) peak = Math.max(peak, Math.abs(v[i])); }, () => console.log('ended'));
  await new Promise(r => setTimeout(r, 4000)); lb.stopLoopbackCapture();
  console.log(JSON.stringify({ chunks: n, seconds: bytes / 4 / 48000, peak: peak / 32768 })); app.quit();
});
