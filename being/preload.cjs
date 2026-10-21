// The bridge the original entity page expects (window.pet), for the being sketch. Only what the being uses is real;
// the rest of the original desktop-pet API (history, tray, mind LLM, dev window) is inert here.
const { contextBridge, ipcRenderer } = require('electron');
const { TUNE } = require('./tune.cjs');
const on = (ch, fn) => ipcRenderer.on(ch, (e, v) => fn(v));
// state channels: main may send them before the page has registered its listener (its module is still loading), so the latest
// value is kept from the start and handed to the listener when it arrives
const STATE = ['system', 'source', 'look', 'bounce', 'retro', 'ml', 'quality', 'lexicon', 'track', 'cosmos', 'immersive', 'dev', 'dev-pause', 'calm'];
const latest = new Map();
for (const ch of STATE) ipcRenderer.on(ch, (e, v) => latest.set(ch, v));
const onState = (ch, fn) => { if (latest.has(ch)) queueMicrotask(() => fn(latest.get(ch))); return on(ch, fn); };
const noop = () => {};
contextBridge.exposeInMainWorld('pet', {
  onPcm: (fn) => on('pcm', fn),            // Uint8Array: 48 kHz stereo int16 from the chosen app
  onSystem: (fn) => onState('system', fn),      // true: start "All system audio", false: stop it
  onSource: (fn) => onState('source', fn),
  onLook: (fn) => onState('look', fn),
  onReseed: (fn) => on('reseed', fn),
  onBurst: (fn) => on('burst', fn),
  onBounce: (fn) => onState('bounce', fn),             // true: it bounces to the beat; false: it stays still
  onRetro: (fn) => onState('retro', fn),               // { pix: block size in px (1 off), lev: levels a channel (0 off), dith: 0..1 }: the pixelated / PS1 look
  mlLayers: () => { try { return ipcRenderer.sendSync('ml-get'); } catch { return null; } },   // which local models run: { style, feel, world, beat }, read once at start
  onMl: (fn) => onState('ml', fn),
  onQuality: (fn) => onState('quality', fn),           // { res: 0.4..1, auto }: render resolution scale, and whether it lowers itself when frames run long
  // the local folder's own channels (being/local/page.mjs <-> being/local/main.cjs), each prefixed 'ext:'
  ext: { on: (ch, fn) => on('ext:' + String(ch), fn), send: (ch, v) => ipcRenderer.send('ext:' + String(ch), v) },
  hasLocal: (() => { try { return require('node:fs').existsSync(require('node:path').join(__dirname, 'local', 'page.mjs')); } catch { return false; } })(),   // whether the page should look for being/local/page.mjs
  onLexicon: (fn) => onState('lexicon', fn),           // 'plain' | 'local': the words it shows (being/lexicon.mjs)
  onNewSeed: (fn) => on('new-seed', fn),
  onFeedback: (fn) => on('feedback', fn),
  onTrack: (fn) => onState('track', fn),                 // { key, title, artist, app }: the song that is playing
  onCosmos: (fn) => onState('cosmos', fn),               // { modes, ring, sky, space, rng, lex }: the sky and its feeds (being/cosmos/)
  onOpenMemories: (fn) => on('open-memories', fn),
  openMemories: (seed) => ipcRenderer.send('open-memories', seed),
  memoryLoad: (seed, key) => ipcRenderer.invoke('memory-load', seed, key),
  memorySave: (seed, key, data, png) => ipcRenderer.invoke('memory-save', seed, key, data, png),
  memoryIndex: (seed) => ipcRenderer.invoke('memory-index', seed),
  menu: () => ipcRenderer.send('menu'),
  onImmersive: (fn) => onState('immersive', fn),        // true: full screen (black), its light free to spread; false: back in its window
  immersive: (v) => ipcRenderer.send('immersive', !!v),
  settings: () => ipcRenderer.send('menu'),
  captureStopped: () => ipcRenderer.send('capture-stopped'),
  tuneSchema: () => Promise.resolve(TUNE),
  mlLoad: () => Promise.resolve({}),
  // the pet window: cursor position (look and hit-testing), click-through while not over the creature, dragging
  onCursor: (fn) => on('cursor', fn),
  hit: (over) => ipcRenderer.send('hit', !!over),
  drag: () => ipcRenderer.send('drag'),
  dragEnd: () => ipcRenderer.send('drag-end'),
  // the dashboard: is anyone looking, what the being reports, what the dashboard changes
  onDev: (fn) => onState('dev', fn),
  onDevPause: (fn) => onState('dev-pause', fn),          // true while the dashboard is minimized or hidden: no snapshots
  onCalm: (fn) => onState('calm', fn),                   // true: no glints or stars (with the bounce off, from main.cjs)
  devSnap: (snap) => ipcRenderer.send('dev-snap', snap),
  onDevCmd: (fn) => on('dev-cmd', fn),
  // inert parts of the original API
  onHistoryBoundary: noop, historySample: noop, onRng: noop, onCalibrate: noop, setOffset: noop,
  mlSave: noop, onMlReset: noop, onTitle: noop, onTrackBoundary: noop,
  think: noop, onMind: noop, onMindStatus: noop, rated: noop, onSnap: noop, snap: noop,
});
