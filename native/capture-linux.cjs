'use strict';
// Linux capture through PulseAudio / PipeWire (pipewire-pulse): no native addon, only pactl and parec (pulseaudio-utils).
// Same API as the Windows addon (getVisibleWindows, startLoopbackCapture, stopLoopbackCapture), plus startSystemCapture
// for the default output's monitor and setOwn (its own processes, never offered). Chunks are 48 kHz stereo s16le, cut
// to whole frames, as the page expects.
//   apps:      identified by name, not pid ('spotify', 'firefox'): Flatpak apps report pids from their own namespace,
//              and players drop their stream when paused. Listed: apps with a stream now, plus MPRIS players (playerctl)
//              that are open but silent, so Spotify can be chosen before it plays.
//   one app:   parec --monitor-stream=<sink input>, the app's own stream only, followed as the app opens new streams and
//              waited for while it is silent
//   system:    parec -d @DEFAULT_MONITOR@, everything the default output plays
const { spawn, execFileSync } = require('node:child_process');

const HIDE = /speech-dispatcher|^pulsesink$/i;   // background streams nobody listens to
const key = (n) => String(n || '').toLowerCase().replace(/\.instance.*$/, '').replace(/\.exe$/, '').trim();
let own = () => new Set([process.pid]);
const FORMAT = ['--format=s16le', '--rate=48000', '--channels=2', '--raw', '--latency-msec=20'];

function sinkInputs() {
  const out = execFileSync('pactl', ['-f', 'json', 'list', 'sink-inputs'], { encoding: 'utf8', timeout: 2000, maxBuffer: 4 << 20 });
  return JSON.parse(out).map((s) => {
    const p = s.properties || {};
    const name = p['application.name'] || p['application.process.binary'] || 'app', app = p['pipewire.access.portal.app_id'] || '';
    return { index: s.index, pid: Number(p['application.process.id']) || 0, name, title: p['media.name'] || '', corked: !!s.corked,
      keys: new Set([key(name), key(p['application.process.binary']), key(app), key(app.split('.').pop())].filter(Boolean)) };
  }).filter((s) => !HIDE.test(s.name) && !own().has(s.pid));
}
function players() {   // open MPRIS players: { key, status, title }
  try {
    const out = execFileSync('playerctl', ['--all-players', 'metadata', '--format', '{{playerName}}\x1f{{status}}\x1f{{artist}}\x1f{{title}}'],
      { encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim().split('\n').map((l) => l.split('\x1f')).filter((f) => f.length === 4 && f[0])
      .map(([n, status, artist, title]) => ({ key: key(n), status, title: [artist, title].filter(Boolean).join(' – ') }));
  } catch { return []; }
}
const nice = (k) => k.charAt(0).toUpperCase() + k.slice(1);

let cur = null;   // { proc, timer, stream, stopped }
function record(args, onChunk, onExit) {
  const proc = spawn('parec', [...FORMAT, ...args], { stdio: ['ignore', 'pipe', 'ignore'] });
  let rest = null;
  proc.stdout.on('data', (b) => {
    if (rest) { b = Buffer.concat([rest, b]); rest = null; }
    const n = b.length & ~3;
    if (n < b.length) rest = b.subarray(n);
    if (n) onChunk(new Uint8Array(b.buffer, b.byteOffset, n));
  });
  proc.on('error', onExit); proc.on('exit', onExit);
  return proc;
}

function stopLoopbackCapture() {
  if (!cur) return;
  cur.stopped = true; clearInterval(cur.timer);
  try { cur.proc?.kill(); } catch {}
  cur = null;
}

function startLoopbackCapture(id, onChunk) {   // id: an app key from getVisibleWindows
  stopLoopbackCapture();
  const k = key(id), c = cur = { proc: null, timer: null, stream: null, stopped: false };
  const pick = () => { const s = sinkInputs().filter((x) => x.keys.has(k)); return s.find((x) => !x.corked) || s[0] || null; };
  const follow = () => {
    if (c.stopped) return;
    let s = null; try { s = pick(); } catch {}
    if (!s) return;   // silent or paused (players drop their stream): wait for it
    if (c.stream === s.index && c.proc) return;
    try { c.proc?.kill(); } catch {}
    c.stream = s.index;
    const proc = c.proc = record([`--monitor-stream=${s.index}`], (ch) => { if (!c.stopped && c.proc === proc) onChunk(ch); }, () => { if (c.proc === proc) c.proc = null; });
  };
  follow();
  c.timer = setInterval(follow, 1000);
}

function startSystemCapture(onChunk, onEnd) {
  stopLoopbackCapture();
  const c = cur = { proc: null, timer: null, stream: 'system', stopped: false };
  let fails = 0;
  const run = () => {
    if (c.stopped) return;
    const proc = c.proc = record(['-d', '@DEFAULT_MONITOR@'], (ch) => { fails = 0; if (!c.stopped) onChunk(ch); }, () => {
      if (c.stopped || c.proc !== proc) return;
      c.proc = null;
      if (++fails > 5) { stopLoopbackCapture(); onEnd?.(); } else setTimeout(run, 500 * fails);   // the default output changed or the server restarted
    });
  };
  run();
}

/** apps to listen to: streams now, then open players; { processId: app key, processName, title } */
function getVisibleWindows() {
  const apps = [];
  for (const s of sinkInputs()) {
    const a = apps.find((x) => [...s.keys].some((k) => x.keys.has(k)));
    if (a) { s.keys.forEach((k) => a.keys.add(k)); if (!s.corked) a.rank = 0; }
    else apps.push({ processId: key(s.name), processName: s.name, title: s.corked ? 'paused' : 'playing', rank: s.corked ? 1 : 0, keys: new Set(s.keys) });
  }
  for (const p of players()) {
    const label = p.title ? p.title + (p.status === 'Playing' ? '' : ` (${p.status.toLowerCase()})`) : p.status.toLowerCase();
    const a = apps.find((x) => x.keys.has(p.key));
    if (a) a.title = label;
    else apps.push({ processId: p.key, processName: nice(p.key), title: label, rank: p.status === 'Playing' ? 0 : 2, keys: new Set([p.key]) });
  }
  return apps.sort((a, b) => a.rank - b.rank || a.processName.localeCompare(b.processName)).map(({ processId, processName, title }) => ({ processId, processName, title }));
}

function loadLinuxCapture() {
  try { execFileSync('pactl', ['info'], { timeout: 2000, stdio: 'ignore' }); } catch { throw new Error('pactl not found or no PulseAudio/PipeWire server (install pulseaudio-utils).'); }
  try { execFileSync('parec', ['--version'], { timeout: 2000, stdio: 'ignore' }); } catch { throw new Error('parec not found (install pulseaudio-utils).'); }
  return { getVisibleWindows, startLoopbackCapture, stopLoopbackCapture, startSystemCapture, setOwn: (fn) => { own = () => new Set([process.pid, ...fn()]); } };
}
module.exports = { loadLinuxCapture };
