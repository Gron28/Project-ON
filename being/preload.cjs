// The bridge the original entity page expects (window.pet), for the being sketch. Only what the being uses is real;
// the rest of the original desktop-pet API (history, tray, mind LLM, dev window) is inert here.
const { contextBridge, ipcRenderer } = require('electron');
const { TUNE } = require('./tune.cjs');
const on = (ch, fn) => ipcRenderer.on(ch, (e, v) => fn(v));
const noop = () => {};
contextBridge.exposeInMainWorld('pet', {
  onPcm: (fn) => on('pcm', fn),            // Uint8Array: 48 kHz stereo int16 from the chosen app
  onSystem: (fn) => on('system', fn),      // true: start "All system audio", false: stop it
  onSource: (fn) => on('source', fn),
  onLook: (fn) => on('look', fn),
  onReseed: (fn) => on('reseed', fn),
  onBurst: (fn) => on('burst', fn),
  onBounce: (fn) => on('bounce', fn),             // true: it bounces to the beat; false: it stays still
  onRetro: (fn) => on('retro', fn),               // { pix: block size in px (1 off), lev: levels a channel (0 off), dith: 0..1 }: the pixelated / PS1 look
  mlLayers: () => { try { return ipcRenderer.sendSync('ml-get'); } catch { return null; } },   // which local models run: { style, feel, world, beat }, read once at start
  onMl: (fn) => on('ml', fn),
  onQuality: (fn) => on('quality', fn),           // { res: 0.4..1, auto }: render resolution scale, and whether it lowers itself when frames run long
  onPractice: (fn) => on('practice', fn),          // { work: { start, ms } | null, body: { start, ms, rounds } | null }: the practices running now
  onPracticeDone: (fn) => on('practice-done', fn),  // 'work' | 'body': one just completed
  onRecord: (fn) => on('record', fn),               // { last, n }: an entry was added to the record
  breatheDone: (s) => ipcRenderer.send('breathe-done', s),
  listenTick: (sec) => ipcRenderer.send('listen-tick', sec),
  recordGet: () => ipcRenderer.invoke('record-get'),
  onBreathe: (fn) => on('breathe', fn),           // { on, paused, level, cues, custom, cfg: { out, in, hold } }: paced breathing
  onLexicon: (fn) => on('lexicon', fn),           // 'plain' | 'local': the words it shows (being/lexicon.mjs)
  onNewSeed: (fn) => on('new-seed', fn),
  onFeedback: (fn) => on('feedback', fn),
  onTrack: (fn) => on('track', fn),                 // { key, title, artist, app }: the song that is playing
  onCosmos: (fn) => on('cosmos', fn),               // { modes, ring, sky, space, rng, lex }: the sky and its feeds (being/cosmos/)
  onOpenMemories: (fn) => on('open-memories', fn),
  openMemories: (seed) => ipcRenderer.send('open-memories', seed),
  memoryLoad: (seed, key) => ipcRenderer.invoke('memory-load', seed, key),
  memorySave: (seed, key, data, png) => ipcRenderer.invoke('memory-save', seed, key, data, png),
  memoryIndex: (seed) => ipcRenderer.invoke('memory-index', seed),
  menu: () => ipcRenderer.send('menu'),
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
  onDev: (fn) => on('dev', fn),
  onDevPause: (fn) => on('dev-pause', fn),          // true while the dashboard is minimized or hidden: no snapshots
  onCalm: (fn) => on('calm', fn),                   // true: no glints or stars (with the bounce off, from main.cjs)
  devSnap: (snap) => ipcRenderer.send('dev-snap', snap),
  onDevCmd: (fn) => on('dev-cmd', fn),
  // inert parts of the original API
  onHistoryBoundary: noop, historySample: noop, onRng: noop, onCalibrate: noop, setOffset: noop,
  mlSave: noop, onMlReset: noop, onTitle: noop, onTrackBoundary: noop,
  think: noop, onMind: noop, onMindStatus: noop, rated: noop, onSnap: noop, snap: noop,
});
