// main.cjs - Electron shell.
//   default            the being (being/index.html) as a desktop pet: frameless, transparent, always on top, clicks pass
//                      through except over the creature, no UI. A tray icon and right-click open the menu and dashboard.
//   ENTITY_WINDOW=1    or settings.pet = false: an ordinary window with the dials (for development)
//   ENTITY_PAGE=fly    the earlier fly-connectome + MilkDrop experiment (renderer/index.html)
// Audio: one app via Windows per-process loopback (checksum-verified native addon in native/), or all system audio.
// On Linux both come from PulseAudio / PipeWire through parec (native/capture-linux.cjs), sent to the page as 'pcm'.
const { app, BrowserWindow, session, desktopCapturer, ipcMain, dialog, globalShortcut, Menu, Tray, nativeImage, screen, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { writeFileAtomic } = require('./being/atomic.cjs');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Windows: ANGLE's default D3D11 backend spends minutes compiling the ray-marched body shader (and can crash the renderer);
// the native OpenGL driver compiles it at once. ENTITY_ANGLE overrides (d3d11, vulkan, ...).
if (process.platform === 'win32') app.commandLine.appendSwitch('use-angle', process.env.ENTITY_ANGLE || 'gl');
const PAGE = process.env.ENTITY_PAGE === 'fly' ? 'fly' : 'being';

// --showcase: a separate test instance (its own profile, so the real being's memories are never touched), an ordinary
// window, no audio capture: the page plays a silent synthetic tour of every state (being/showcase.mjs)
const SHOWCASE = process.argv.includes('--showcase');
// ON (ὄν, 'being'): the app's name. Its profile used to be <appData>/entity-alive; it moves once, whole (memories,
// settings, localStorage), to <appData>/on-being, so the same being wakes up under its new name.
app.setName('ON');
{ const appData = app.getPath('appData'), to = path.join(appData, 'on-being');
  for (const sfx of ['', '-showcase']) { const from = path.join(appData, 'entity-alive' + sfx);
    try { if (fs.existsSync(from) && !fs.existsSync(to + sfx)) fs.renameSync(from, to + sfx); } catch (e) { console.warn('profile move failed:', e.message); } }
  app.setPath('userData', fs.existsSync(to) || !fs.existsSync(path.join(appData, 'entity-alive')) ? to : path.join(appData, 'entity-alive')); }
if (SHOWCASE) app.setPath('userData', app.getPath('userData') + '-showcase');
// ---- settings (window form, size, place); the being's own state lives in the page ----------------------------------
const SETTINGS = path.join(app.getPath('userData'), 'being-settings.json');
const SIZES = { Small: 380, Medium: 520, Large: 720 };
const COSMOS_MODES = ['hours', 'heavens', 'moon', 'rng', 'space'];   // labels: being/lexicon.mjs 'mode.<key>'
const COSMOS_DEFAULT = () => ({ modes: Object.fromEntries(COSMOS_MODES.map((k) => [k, false])), ring: false, place: { lat: -34.6037, lon: -58.3816, elevation: 25, name: 'Buenos Aires' } });
const settings = { pet: true, size: SIZES.Medium, x: null, y: null, top: true, onboarded: false, bounce: true, quality: 1, adaptive: true, pix: 1, lev: 0, dith: 0, ml: { style: true, feel: true, world: true, beat: true }, cosmos: COSMOS_DEFAULT() };
try { Object.assign(settings, JSON.parse(fs.readFileSync(SETTINGS, 'utf8'))); } catch {}
settings.ml = { style: true, feel: true, world: true, beat: true, ...(settings.ml || {}) };   // the local models, layer by layer
settings.cosmos = { ...COSMOS_DEFAULT(), ...(settings.cosmos || {}) };
settings.organism = { watch: false, drive: false, strength: .6, genome: 'best', ...(settings.organism || {}) };   // the lab organism, watched in the dashboard; drive (experimental) lets it move the being, strength (0..1) how much it leads
if (!(Number.isFinite(settings.organism.strength) && settings.organism.strength >= 0 && settings.organism.strength <= 1)) settings.organism.strength = .6;
delete settings.driver; delete settings.blobs;   // experimental drivers that were tried and removed
// the local folder's main-process side (being/local/main.cjs, not part of the repository): experimental features of its own,
// menu entries, dashboard keys and the page's 'ext:' channels. Without it there is none of that.
const LOCAL = (() => { try { return require('./being/local/main.cjs'); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') console.error('[local]', e); return null; } })();
// experimental features, each on its own (dashboard, "Experimental"): off by default; anyone already using one keeps it
const EXPERIMENTAL = ['sky', ...((LOCAL && LOCAL.EXPERIMENTAL) || [])];
{
  const had = settings.experimental || {}, c = settings.cosmos;
  settings.experimental = { sky: had.sky ?? !!(c.ring || Object.values(c.modes || {}).some(Boolean)), ...(LOCAL && LOCAL.experimentalDefaults ? LOCAL.experimentalDefaults(settings, had) : {}) };
}
const experimental = (k) => !!settings.experimental[k];
const knownModes = () => { settings.cosmos.modes = Object.fromEntries(COSMOS_MODES.map((k) => [k, !!(settings.cosmos.modes || {})[k]])); };   // known modes only, once the lexicon has renamed old keys
if (process.env.ENTITY_WINDOW === '1' || SHOWCASE) settings.pet = false;
if (SHOWCASE) settings.onboarded = true;
const save = () => { try { writeFileAtomic(SETTINGS, JSON.stringify(settings, null, 1)); } catch {} };
// ---- the words it shows (being/lexicon.mjs): plain, or the local set when present (settings.lexicon) ------------------
let LEXM = null;
const lexMode = () => (LEXM && LEXM.hasLocal ? settings.lexicon || 'local' : 'plain');
const L = (key, vars) => (LEXM ? LEXM.lexicon(lexMode()).t(key, vars) : key);
const lexReady = import('./being/lexicon.mjs').then((m) => {
  LEXM = m;
  // settings saved under older names (the local set lists them): { 'old.path': 'new.path' }
  for (const [from, to] of Object.entries(m.renamed || {})) {
    const get = (o, ks) => ks.reduce((a, k) => (a == null ? a : a[k]), o), f = from.split('.'), t = to.split('.');
    const v = get(settings, f); if (v === undefined) continue;
    const parent = get(settings, t.slice(0, -1)); if (parent && parent[t.at(-1)] === undefined) parent[t.at(-1)] = v;
    delete get(settings, f.slice(0, -1))[f.at(-1)];
  }
  knownModes(); EXTM?.lexReady?.(); refreshTray?.();
}).catch((e) => { console.error('[lexicon]', e); knownModes(); });
function setLexicon(mode) { settings.lexicon = mode; save(); refreshTray(); sendCosmos(); send('lexicon', lexMode()); }

let loopback = null, captureError = '';
try { loopback = require('./native/capture.cjs').loadCapture(); } catch (e) { captureError = e.message; }
loopback?.setOwn?.(() => app.getAppMetrics().map((m) => m.pid));   // Linux: never offer or capture its own voice
if (process.platform === 'win32' && Number(require('node:os').release().split('.')[2]) < 20348) { loopback = null; captureError = 'Per-app capture needs Windows build 20348+ (Windows 11).'; }
let capturing = null, capturingName = ''; // pid, app name
const { startMediaMonitor, selectSession } = require('./media/media.cjs');
let systemOn = false;
let win = null, tray = null, dash = null, settingsWin = null, skyWin = null;
const ICON = path.join(__dirname, '.setup', 'being.png');
const iconImage = () => (fs.existsSync(ICON) ? nativeImage.createFromPath(ICON) : null);
const page = () => (win && !win.isDestroyed() ? win.webContents : null);
const send = (ch, v) => { const wc = page(); if (wc) wc.send(ch, v); };
// the local folder's hooks (null without it)
let EXTM = null;
try { EXTM = LOCAL && LOCAL.install ? LOCAL.install({ app, ipcMain, settings, save, send, refreshTray: () => refreshTray(), L, lexMode, cosmos: () => cosmos, LEXM: () => LEXM }) : null; } catch (e) { console.error('[local]', e); }

function apps() {
  if (!loopback) return [];
  try {
    const seen = new Set();
    const own = new Set(app.getAppMetrics().map((m) => m.pid));   // its own voice plays from a child process
    return loopback.getVisibleWindows()
      .filter((w) => w.title && !own.has(w.processId) && !seen.has(w.processId) && seen.add(w.processId))
      .map((w) => ({ pid: w.processId, name: w.processName.replace(/\.exe$/i, ''), title: w.title }));
  } catch { return []; }
}
function stopApp() { if (capturing !== null || sysCapture) { try { loopback.stopLoopbackCapture(); } catch {} capturing = null; sysCapture = false; } }
function startApp(wc, pid, name) {
  stopApp(); trackKey = '';
  if (systemOn) { wc.send('system', false); systemOn = false; }
  try {
    loopback.startLoopbackCapture(pid, (chunk) => { if (capturing === pid && !wc.isDestroyed()) wc.send('pcm', chunk); }, () => { if (capturing === pid) { capturing = null; if (!wc.isDestroyed()) wc.send('source', null); } });
    capturing = pid; capturingName = name;
    wc.send('source', name);
    return { ok: true };
  } catch (err) { return { error: err.message }; }
}
// Linux: the default output's monitor through parec, as pcm (Chromium has no loopback audio for getDisplayMedia there)
let sysCapture = false;
function startSystem(wc) {
  stopApp(); trackKey = ''; systemOn = true;
  if (loopback?.startSystemCapture) {
    try {
      loopback.startSystemCapture((chunk) => { if (sysCapture && !wc.isDestroyed()) wc.send('pcm', chunk); }, () => { sysCapture = false; systemOn = false; if (!wc.isDestroyed()) wc.send('source', null); });
      sysCapture = true;
    } catch (err) { console.error('[system audio]', err.message); }
  } else wc.send('system', true);
  wc.send('source', 'All system audio');
}
// the source chosen by hand is remembered and picked again at launch (when that app is running): { app: name } | { system: true }
const remember = (s) => { settings.source = s; save(); };
const sourceName = () => (capturing !== null ? capturingName : systemOn ? 'All system audio' : 'nothing');

const LOOK = (hud) => ({ light: 'being', finish: 'chrome', fx: { spikes: true, rings: true, film: false, sparks: true }, lobes: 'being', offset: 40, hud, tune: {} });

function createWindow() {
  const pet = PAGE === 'being' && settings.pet;
  const wa = screen.getPrimaryDisplay().workArea, s = settings.size;
  // the saved place only counts while its centre is on a connected screen (a monitor may have been unplugged since)
  const onScreen = Number.isFinite(settings.x) && Number.isFinite(settings.y) && screen.getAllDisplays().some(({ workArea: d }) => {
    const cx = settings.x + s / 2, cy = settings.y + s / 2; return cx >= d.x && cx < d.x + d.width && cy >= d.y && cy < d.y + d.height; });
  win = new BrowserWindow(pet ? {
    width: s, height: s, x: onScreen ? settings.x : wa.x + wa.width - s - 40, y: onScreen ? settings.y : wa.y + wa.height - s - 20,
    transparent: true, frame: false, resizable: false, maximizable: false, hasShadow: false, skipTaskbar: true,
    alwaysOnTop: settings.top, backgroundColor: '#00000000', title: 'ON', icon: iconImage() || undefined,
    webPreferences: { preload: path.join(__dirname, 'being/preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  } : {
    width: PAGE === 'being' ? 900 : 1280, height: PAGE === 'being' ? 900 : 800, minWidth: 400, minHeight: 400, backgroundColor: '#000000',
    title: SHOWCASE ? 'ON · showcase' : PAGE === 'being' ? 'ON' : 'Entity Alive', autoHideMenuBar: true, icon: iconImage() || undefined,
    webPreferences: { preload: path.join(__dirname, PAGE === 'being' ? 'being/preload.cjs' : 'preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  if (pet) {
    win.setIgnoreMouseEvents(true, { forward: true });   // clicks pass through until the cursor is over the creature
    win.on('moved', () => { send('quality', quality()); if (immersive) return; const b = win.getBounds(); settings.x = b.x; settings.y = b.y; save(); });   // (another display may refresh at another rate)
  }
  // "system audio": answer getDisplayMedia with the screen plus Windows loopback audio, no picker
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((s) => callback({ video: s[0], audio: 'loopback' })).catch(() => callback({}));
  }, { useSystemPicker: false });
  if (PAGE === 'being') {
    win.loadFile(path.join(__dirname, 'being', 'index.html'), { query: SHOWCASE ? { local: '0', ui: '0', showcase: '1' } : pet ? { local: '0', ui: '0' } : { local: '1', ui: '1' } });
    win.webContents.once('did-finish-load', () => {
      const wc = win.webContents;
      wc.send('look', LOOK(false));
      sendMotion();
      wc.send('ml', settings.ml);
      wc.send('retro', { pix: settings.pix, lev: settings.lev, dith: settings.dith });
      wc.send('quality', quality());
      EXTM?.pageLoaded?.(wc);
      if (process.env.BEING_READY_FILE) { try { fs.writeFileSync(process.env.BEING_READY_FILE, 'ready'); } catch {} }
      if (!settings.onboarded && settings.pet) setTimeout(openSettings, 1200);   // first run: one small card
      if (dash && !dash.isDestroyed()) wc.send('dev', true);
      sendCosmos();
      sendOrganism();
      // prefer a running Spotify (per-app capture does not depend on the default output device), else all system audio
      if (SHOWCASE) return;   // it hears only the showcase's own silent music
      const want = settings.source, sp = (want && want.app && apps().find((a) => a.name === want.app)) || (!(want && want.system) && apps().find((a) => /spotify/i.test(a.name)));
      if (process.env.ENTITY_LOG) console.log('[capture]', sp ? `app ${sp.name} (${sp.pid})` : 'system audio', '| apps:', apps().map((a) => a.name).join(', ') || 'none', captureError ? '| ' + captureError : '');
      if (sp) startApp(wc, sp.pid, sp.name); else startSystem(wc);
      watchMedia(wc);
    });
  } else {
    win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  }
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());   // nothing in the page may replace it
  win.on('closed', () => { stopApp(); win = null; });
  if (process.env.ENTITY_DEVTOOLS) win.webContents.openDevTools({ mode: 'detach' });
  if (process.env.ENTITY_LOG) win.webContents.on('console-message', (e) => console.log('[page]', e.level, e.message, e.sourceId ? path.basename(e.sourceId) + ':' + e.lineNumber : ''));
  win.webContents.on('render-process-gone', (e, d) => console.error('[renderer gone]', d.reason));
  if (pet) startCursor();
}
function recreate() {   // the new window first, so the app never sees all windows closed
  const old = win; if (old && !old.isDestroyed()) { old.removeAllListeners('closed'); stopApp(); }
  createWindow(); refreshTray();
  if (old && !old.isDestroyed()) old.destroy();
}

// ---- the pet: the page says when the cursor is over the creature; it can be dragged; it follows the cursor ----------
let cursorT = null, dragT = null;
// Linux X11: Chromium's cursor point only moves while its own window gets mouse events, and the pet ignores them until
// the cursor is over it, so read the pointer from the X server (native/x11-pointer.cjs); elsewhere Electron's is right
const xPointer = process.platform === 'linux' && !process.env.WAYLAND_DISPLAY ? require('./native/x11-pointer.cjs').createPointer(50) : null;
function cursorPoint() {
  const p = xPointer && xPointer.get();
  if (!p) return screen.getCursorScreenPoint();
  const k = screen.getPrimaryDisplay().scaleFactor || 1;   // X11 pixels -> DIP (one scale for the whole X screen)
  return { x: Math.round(p.x / k), y: Math.round(p.y / k) };
}
function startCursor() {
  clearInterval(cursorT);
  cursorT = setInterval(() => {
    if (!win || win.isDestroyed()) return;
    const p = cursorPoint(), b = win.getBounds();
    win.webContents.send('cursor', { x: p.x - b.x, y: p.y - b.y, w: b.width, h: b.height });
  }, 50);
}
// full screen (black): ON alone on a black screen, its light free to spread across it; Escape, the menu or the dashboard leave
let immersive = null;   // the window's bounds from before, while it is on
function setImmersive(on) {
  if (!win || win.isDestroyed() || PAGE !== 'being') return false;
  if (on && !immersive) {
    immersive = win.getBounds();
    if (settings.pet) { const d = screen.getDisplayMatching(immersive).bounds; win.setResizable(true); win.setIgnoreMouseEvents(false); win.setAlwaysOnTop(true, 'screen-saver'); win.setBounds(d); }
    else win.setFullScreen(true);
    win.focus();
  } else if (!on && immersive) {
    const b = immersive; immersive = null;
    if (settings.pet) { win.setBounds(b); win.setResizable(false); win.setAlwaysOnTop(settings.top); win.setIgnoreMouseEvents(true, { forward: true }); }
    else win.setFullScreen(false);
  }
  win.webContents.send('immersive', !!immersive);
  return !!immersive;
}
ipcMain.on('immersive', (e, v) => { if (BrowserWindow.fromWebContents(e.sender) === win) setImmersive(!!v); });
ipcMain.on('hit', (e, over) => { const w = BrowserWindow.fromWebContents(e.sender); if (immersive) return; if (w && w === win && settings.pet && !dragT) w.setIgnoreMouseEvents(!over, { forward: true }); });
ipcMain.on('drag', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender); if (!w || w !== win || !settings.pet || immersive) return;
  const c = cursorPoint(), b = w.getBounds(), off = { x: c.x - b.x, y: c.y - b.y };
  clearInterval(dragT); xPointer?.rate(8);
  // setBounds with the size every step: on scaled displays setPosition alone rounds the size up and the window creeps bigger
  dragT = setInterval(() => { if (!win || win.isDestroyed()) return clearInterval(dragT); const p = cursorPoint(); win.setBounds({ x: p.x - off.x, y: p.y - off.y, width: settings.size, height: settings.size }); }, 8);
});
ipcMain.on('drag-end', () => { clearInterval(dragT); dragT = null; xPointer?.rate(50); if (win && !win.isDestroyed()) { const b = win.getBounds(); if (settings.pet && (b.width !== settings.size || b.height !== settings.size)) win.setBounds({ x: b.x, y: b.y, width: settings.size, height: settings.size }); settings.x = b.x; settings.y = b.y; save(); } });

// ---- what is playing: Windows media sessions (title, artist), matched to the captured app ----------------------------
let stopMedia = null, trackKey = '', trackInfo = null;
function watchMedia(wc) {
  stopMedia?.();
  stopMedia = startMediaMonitor(({ sessions }) => {
    if (wc.isDestroyed()) return;
    const src = capturing !== null ? { kind: 'app', name: capturingName } : systemOn ? { kind: 'system' } : null;
    const sel = selectSession(sessions, src);
    const key = sel && sel.key ? sel.key : '';
    if (key && key !== trackKey) { trackKey = key; trackInfo = { key, title: sel.title, artist: sel.artist, album: sel.album, albumArtist: sel.albumArtist, app: sel.provider }; wc.send('track', trackInfo); }
  });
}

// ---- the being's memory of songs: one file per song (being/memory-store.cjs) -----------------------------------
require('./being/memory-store.cjs').registerMemoryIpc(ipcMain, app);

// ---- menus: right-click on the being, and the tray -------------------------------------------------------------
function listenItems(wc) {
  return [
    ...apps().map((a) => ({ label: `${a.name}: ${a.title.slice(0, 50)}`, type: 'radio', checked: capturing === a.pid, click: () => { remember({ app: a.name }); startApp(wc, a.pid, a.name); } })),
    ...(loopback ? [] : [{ label: `Per-app capture unavailable: ${captureError}`, enabled: false }]),
    { label: 'All system audio', type: 'radio', checked: systemOn, click: () => { remember({ system: true }); startSystem(wc); } },
  ];
}
function menuTemplate() {
  const wc = page();
  return [
    { label: 'Listen to', enabled: !!wc, submenu: wc ? listenItems(wc) : [] },
    { type: 'separator' },
    { label: 'Turn to beads / melt', click: () => send('burst') },
    { label: 'Grow a new form', click: () => send('reseed') },
    ...experimentalItems(),
    { type: 'separator' },
    { label: 'Settings', click: openSettings },
    { label: 'Dashboard', click: openDashboard },
    { label: 'Size', submenu: Object.entries(SIZES).map(([k, v]) => ({ label: k, type: 'radio', checked: settings.size === v, click: () => setSize(v) })) },
    { label: 'Always on top', type: 'checkbox', checked: settings.top, click: (i) => { settings.top = i.checked; save(); if (win) win.setAlwaysOnTop(i.checked); } },
    { label: 'Show in a window', type: 'checkbox', checked: !settings.pet, click: (i) => { settings.pet = !i.checked; save(); recreate(); } },
    { label: 'Full screen (black)', type: 'checkbox', checked: !!immersive, accelerator: 'Escape', registerAccelerator: false, click: (i) => setImmersive(i.checked) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ];
}
// the experimental features appear in the menu only while switched on (dashboard, "Experimental")
function experimentalItems() {
  const out = [];
  if (experimental('sky')) out.push({ label: L('menu.sky'), submenu: [
      ...COSMOS_MODES.map((k) => ({ label: L('mode.' + k), type: 'checkbox', checked: !!settings.cosmos.modes[k], click: (i) => setCosmos('mode', { k, v: i.checked }) })),
      { type: 'separator' },
      { label: 'All of them', click: () => setCosmos('all', true) },
      { label: 'None', click: () => setCosmos('all', false) },
      { type: 'separator' },
      { label: L('menu.ring'), type: 'checkbox', checked: !!settings.cosmos.ring, click: (i) => setCosmos('ring', i.checked) },
      { label: L('menu.chart'), click: openSky },
      ...(LEXM && LEXM.hasLocal ? [{ type: 'separator' }, { label: L('menu.names'), type: 'checkbox', checked: lexMode() === 'local', click: (i) => setLexicon(i.checked ? 'local' : 'plain') }] : []),
  ] });
  if (EXTM && EXTM.menuItems) out.push(...EXTM.menuItems());
  return out.length ? [{ type: 'separator' }, ...out] : out;
}
function setExperimental(k, on) {
  if (!EXPERIMENTAL.includes(k)) return false;
  settings.experimental[k] = !!on;
  if (!on) {   // switching one off leaves nothing of it running or drawn
    if (k === 'sky') { setCosmos('all', false); setCosmos('ring', false); if (skyWin && !skyWin.isDestroyed()) skyWin.close(); }
    EXTM?.experimentalOff?.(k);
  }
  save(); refreshTray(); return true;
}
// motion: "Calm" (Settings) stills the dance, the beat pulse and the glints; "Bounce to the beat" (dashboard) is the finer switch
function sendMotion() { send('bounce', settings.bounce !== false && !settings.calm); send('calm', !!settings.calm); }
// the lab organism (lab/organism/watch.mjs, run in being/worker.mjs on the being's own ear; it drives nothing unless
// settings.organism.drive is on, which implies watch): the evolved best genome is read here, since the sandboxed page
// cannot; without it the worker grows one from a seed
function organismState() {
  const o = { watch: !!settings.organism.watch, drive: !!(settings.organism.watch && settings.organism.drive), strength: settings.organism.strength, genome: null, seed: 1, label: '' };
  if (!o.watch) return o;
  try {
    const b = JSON.parse(fs.readFileSync(path.join(__dirname, 'lab', 'results', 'organism-best.json'), 'utf8'));
    if (Array.isArray(b.genome) && b.genome.length >= 20 && b.genome.length <= 64 && b.genome.every((x) => typeof x === 'number' && x >= 0 && x <= 1)) {
      o.genome = b.genome; o.seed = Number.isInteger(b.seed) && b.seed > 0 ? b.seed : 1;
      o.label = `best (gen ${b.gen ?? '?'}, fitness ${Number.isFinite(b.fitness) ? b.fitness.toFixed(3) : '?'})`;
    }
  } catch {}
  return o;
}
const sendOrganism = () => send('organism', organismState());
function setSize(v) {
  settings.size = v; save();
  if (win && !win.isDestroyed() && settings.pet) { const b = win.getBounds(); win.setBounds({ x: Math.round(b.x + (b.width - v) / 2), y: Math.round(b.y + (b.height - v) / 2), width: v, height: v }); }
}
ipcMain.on('menu', (e) => Menu.buildFromTemplate(menuTemplate()).popup({ window: BrowserWindow.fromWebContents(e.sender) }));
ipcMain.on('capture-stopped', () => { systemOn = false; });
function refreshTray() { if (tray && !tray.isDestroyed()) tray.setContextMenu(Menu.buildFromTemplate(menuTemplate())); }
function createTray() {
  const px = Buffer.alloc(16 * 16 * 4);   // a small bright orb (BGRA)
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const d = Math.hypot(x - 7.5, y - 7.5), o = (y * 16 + x) * 4, a = d < 6.5 ? 255 : d < 7.5 ? 120 : 0, w = Math.max(0, 1 - d / 7);
    px[o] = 255; px[o + 1] = 200 + 55 * w; px[o + 2] = 120 + 135 * w; px[o + 3] = a;
  }
  const drawn = iconImage();
  tray = new Tray(drawn ? drawn.resize({ width: 16, height: 16 }) : nativeImage.createFromBitmap(px, { width: 16, height: 16 }));
  tray.setToolTip('ON');
  tray.on('click', openSettings);
  tray.on('right-click', refreshTray);
  refreshTray();
}

// ---- the settings card: first run, and "Settings" (being/settings.html) --------------------------------------------
const STARTUP = process.platform === 'linux'
  ? path.join(process.env.XDG_CONFIG_HOME || path.join(app.getPath('home'), '.config'), 'autostart', 'being.desktop')
  : path.join(process.env.APPDATA || app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'ON.lnk');
if (process.platform === 'win32') { try { const old = path.join(path.dirname(STARTUP), 'Being.lnk'); if (fs.existsSync(old)) { if (fs.existsSync(STARTUP)) fs.rmSync(old, { force: true }); else fs.renameSync(old, STARTUP); } } catch {} }   // the name before it was called ON
const STARTUP_LABEL = process.platform === 'linux' ? 'Start on login' : 'Start with Windows';
// Linux: an XDG autostart entry (the same launcher setup.sh puts in the applications menu)
function linuxStartup() {
  const q = (s) => '"' + String(s).replace(/(["`$\\])/g, '\\\\$1') + '"';   // desktop-entry quoting: \\" \\` \\$ \\\\
  fs.mkdirSync(path.dirname(STARTUP), { recursive: true });
  fs.writeFileSync(STARTUP, ['[Desktop Entry]', 'Type=Application', 'Name=ON', 'Comment=A living music visualizer',
    `Exec=${q(process.execPath)} ${q(__dirname)}`, `Path=${__dirname}`, `Icon=${path.join(__dirname, '.setup', 'being.png')}`,
    'Terminal=false', 'X-GNOME-Autostart-enabled=true', ''].join('\n'));
  return true;
}
function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); return; }
  const b = win && !win.isDestroyed() ? win.getBounds() : screen.getPrimaryDisplay().workArea, W = 320, H = 500;
  const wa = screen.getDisplayMatching(b).workArea;
  const x = Math.max(wa.x, Math.min(wa.x + wa.width - W, b.x - W - 10 > wa.x ? b.x - W - 10 : b.x + b.width + 10)), y = Math.max(wa.y, Math.min(wa.y + wa.height - H, b.y + (b.height - H) / 2));
  settingsWin = new BrowserWindow({ width: W, height: H, x: Math.round(x), y: Math.round(y), frame: false, resizable: false, maximizable: false, minimizable: false, transparent: true, backgroundColor: '#00000000',
    alwaysOnTop: true, skipTaskbar: true, title: 'ON', icon: iconImage() || undefined, webPreferences: { preload: path.join(__dirname, 'being', 'settings-preload.cjs'), contextIsolation: true, sandbox: true } });
  settingsWin.loadFile(path.join(__dirname, 'being', 'settings.html'));
  settingsWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  settingsWin.webContents.on('will-navigate', (e) => e.preventDefault());
  settingsWin.on('blur', () => { if (settings.onboarded && settingsWin && !settingsWin.isDestroyed()) settingsWin.close(); });
  settingsWin.on('closed', () => { settingsWin = null; if (!settings.onboarded) { settings.onboarded = true; save(); } });
}
const fromSettings = (e) => settingsWin && !settingsWin.isDestroyed() && e.sender === settingsWin.webContents;
// render cost in one choice: auto lowers the resolution itself when frames run long
const PERFORMANCE = { auto: { quality: 1, adaptive: true }, sharp: { quality: 1, adaptive: false }, light: { quality: .6, adaptive: false } };
// what the page's governor needs: the resolution ceiling, whether it adapts, and the refresh rate of the display it is on
const quality = () => { let hz = 0; try { if (win && !win.isDestroyed()) hz = screen.getDisplayMatching(win.getBounds()).displayFrequency || 0; } catch {} return { res: settings.quality, auto: settings.adaptive, hz }; };
const performanceNow = () => (settings.adaptive !== false ? 'auto' : (settings.quality ?? 1) >= .9 ? 'sharp' : 'light');
function setRetro(key, value) {   // the pixelated / PS1 look (dashboard, Look)
  if (!['pix', 'lev', 'dith'].includes(key) || !Number.isFinite(value)) return false;
  settings[key] = key === 'pix' ? Math.min(24, Math.max(1, Math.round(value))) : key === 'lev' ? (value >= 2 ? Math.min(64, Math.round(value)) : 0) : Math.min(1, Math.max(0, value));
  save(); send('retro', { pix: settings.pix, lev: settings.lev, dith: settings.dith }); return true;
}
ipcMain.on('ml-get', (e) => { e.returnValue = settings.ml; });
ipcMain.on('has-local', (e) => { e.returnValue = fs.existsSync(path.join(__dirname, 'being', 'local', 'page.mjs')); });   // the sandboxed preload has no fs
ipcMain.handle('settings-get', (e) => fromSettings(e) ? { settings, performance: performanceNow(), startup: fs.existsSync(STARTUP), startupLabel: STARTUP_LABEL, sources: [['system', 'All system audio'], ...apps().map((a) => [String(a.pid), a.name])], current: capturing !== null ? String(capturing) : systemOn ? 'system' : '' } : null);
ipcMain.handle('settings-set', (e, key, value) => {
  if (!fromSettings(e)) return false;
  if (key === 'source') { const wc = page(); if (!wc) return false; if (value === 'system') { remember({ system: true }); startSystem(wc); } else { const a = apps().find((x) => String(x.pid) === String(value)); if (a) { remember({ app: a.name }); startApp(wc, a.pid, a.name); } } return true; }
  if (key === 'size' && Object.values(SIZES).includes(value)) { setSize(value); return true; }
  if (key === 'calm' && typeof value === 'boolean') { settings.calm = value; save(); sendMotion(); return true; }
  if (key === 'reset') {   // every setting back to its default; the window's place, the form (pet / window) and the memories stay
    dialog.showMessageBox({ type: 'question', buttons: ['Reset', 'Cancel'], defaultId: 1, cancelId: 1, title: 'ON', message: 'Reset all settings to their defaults?', detail: 'Memories are kept. ON restarts.' }).then((r) => {
      if (r.response !== 0) return;
      const keep = { pet: settings.pet, x: settings.x, y: settings.y, onboarded: true };
      for (const k of Object.keys(settings)) delete settings[k];
      Object.assign(settings, keep); save(); app.relaunch(); app.exit(0);
    });
    return true;
  }
  if (key === 'top' && typeof value === 'boolean') { settings.top = value; save(); if (win) win.setAlwaysOnTop(value); return true; }
  if (key === 'startup' && typeof value === 'boolean') {
    if (value && process.platform === 'linux') { try { return linuxStartup(); } catch { return false; } }
    if (value) { const exe = process.execPath, ico = path.join(__dirname, '.setup', 'being.ico'); fs.mkdirSync(path.dirname(STARTUP), { recursive: true }); return shell.writeShortcutLink(STARTUP, { target: exe, args: `"${__dirname}"`, cwd: __dirname, icon: fs.existsSync(ico) ? ico : exe, iconIndex: 0, description: 'ON' }); }
    try { fs.rmSync(STARTUP, { force: true }); } catch {} return true;
  }
  if (key === 'performance' && PERFORMANCE[value]) { const p = PERFORMANCE[value]; settings.quality = p.quality; settings.adaptive = p.adaptive; save(); send('quality', quality()); return true; }
  if (key === 'ml:all' && typeof value === 'boolean') { for (const k of Object.keys(settings.ml)) settings.ml[k] = value; save(); send('ml', settings.ml); return true;   // the four local models together
  }
  if (typeof key === 'string' && key.startsWith('ml:') && typeof value === 'boolean' && Object.hasOwn(settings.ml, key.slice(3))) {
    settings.ml[key.slice(3)] = value; save(); send('ml', settings.ml); return true;
  }
  if (key === 'dashboard') { openDashboard(); return true; }
  if (key === 'done') { settings.onboarded = true; save(); settingsWin.close(); return true; }
  return false;
});

// ---- the dashboard: live view of everything inside, and every control (being/dashboard.html) ---------------------
function openDashboard() {
  if (dash && !dash.isDestroyed()) { dash.show(); dash.focus(); return; }
  dash = new BrowserWindow({ width: 1480, height: 940, minWidth: 1000, minHeight: 640, title: 'ON · dashboard', backgroundColor: '#0a0b10', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'being', 'dashboard-preload.cjs'), contextIsolation: true, sandbox: true } });
  dash.loadFile(path.join(__dirname, 'being', 'dashboard.html'));
  dash.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  dash.webContents.on('will-navigate', (e) => e.preventDefault());
  dash.webContents.once('did-finish-load', () => send('dev', true));
  dash.on('closed', () => { dash = null; send('dev', false); });   // the being stops reporting when nobody is looking
  for (const [ev, hidden] of [['minimize', true], ['hide', true], ['restore', false], ['show', false]]) dash.on(ev, () => send('dev-pause', hidden));   // ...or when the window is minimized
  if (process.env.ENTITY_LOG) dash.webContents.on('console-message', (e) => console.log('[dash]', e.message));
}
const fromDash = (e) => dash && !dash.isDestroyed() && e.sender === dash.webContents;
ipcMain.on('dev-snap', (e, snap) => { if (dash && !dash.isDestroyed() && page() && e.sender === page()) dash.webContents.send('snap', { ...snap, app: { source: sourceName(), track: trackInfo, settings } }); });
ipcMain.on('dev-cmd', (e, cmd) => { if (fromDash(e)) send('dev-cmd', cmd); });
ipcMain.handle('dash-schema', (e) => (fromDash(e) ? require('./being/tune.cjs').TUNE : null));
ipcMain.handle('page-schema', (e) => (e.sender === page() ? require('./being/tune.cjs').TUNE : null));
ipcMain.handle('dash-app', (e, key, value) => {
  if (!fromDash(e)) return null;
  if (key === 'bounce') { if (typeof value === 'boolean') { settings.bounce = value; save(); sendMotion(); } return settings.bounce !== false; }
  if (key === 'immersive') { if (typeof value === 'boolean') return setImmersive(value); return !!immersive; }
  if (key === 'lexicon') {   // the words: { mode, hasLocal }; a value 'plain' | 'local' switches
    if (value === 'plain' || value === 'local') setLexicon(value);
    return { mode: lexMode(), hasLocal: !!(LEXM && LEXM.hasLocal) };
  }
  if (key === 'experimental') {   // { k, on } switches one experimental feature; always answers with all of them
    if (value && typeof value.k === 'string') setExperimental(value.k, value.on);
    return { ...settings.experimental };
  }
  if (key === 'cosmos' && value) {   // the sky's modes from the dashboard: { k: 'mode'|'all'|'ring'|'chart', v }
    if (value.k === 'chart') { openSky(); return true; }
    const r = setCosmos(value.k, value.v);
    return { ok: r, modes: { ...settings.cosmos.modes }, ring: settings.cosmos.ring, labels: COSMOS_MODES.map((m) => [m, L('mode.' + m)]), ringLabel: L('menu.ring') };
  }
  if (key === 'retro') { if (value) setRetro(value.k, value.v); return { pix: settings.pix || 1, lev: settings.lev || 0, dith: settings.dith || 0 }; }
  if (key === 'action' && value === 'showcase') { openShowcase(); return true; }
  if (key === 'organism') {   // { watch?, drive?, strength? }: drive on turns watch on, watch off turns drive off; always answers with all three
    const o = settings.organism, was = `${!!o.watch}/${!!o.drive}/${o.strength}`;
    if (value && typeof value.watch === 'boolean') { o.watch = value.watch; if (!o.watch) o.drive = false; }
    if (value && typeof value.drive === 'boolean') { o.drive = value.drive; if (o.drive) o.watch = true; }
    if (value && Number.isFinite(value.strength)) o.strength = Math.round(Math.min(1, Math.max(0, value.strength)) * 100) / 100;
    if (`${!!o.watch}/${!!o.drive}/${o.strength}` !== was) { save(); sendOrganism(); }
    return { watch: !!o.watch, drive: !!(o.watch && o.drive), strength: o.strength };
  }
  if (EXTM && EXTM.dashApp) { const r = EXTM.dashApp(key, value); if (r !== undefined) return r; }
  if (key === 'action' && ['feedback+', 'feedback-', 'burst', 'reseed', 'new-seed', 'open-memories'].includes(value)) { if (value === 'feedback+') send('feedback', 1); else if (value === 'feedback-') send('feedback', -1); else send(value); return true; }
  return false;
});

// ---- the sky: positions, hours, Moon, space weather, the randomness monitor (being/cosmos/service.mjs) -----------------
let cosmos = null;
const cosmosPayload = () => ({ ...(cosmos ? cosmos.state() : {}), modes: settings.cosmos.modes, ring: settings.cosmos.ring, place: settings.cosmos.place, lex: lexMode() });
function sendCosmos() {
  const p = cosmosPayload(); send('cosmos', p);
  if (skyWin && !skyWin.isDestroyed()) skyWin.webContents.send('cosmos', p);
}
function startCosmos() {
  import('./being/cosmos/service.mjs').then(({ createCosmos }) => {
    const sky = () => !!(skyWin && !skyWin.isDestroyed()), m = () => settings.cosmos.modes;
    cosmos = createCosmos({ dir: app.getPath('userData'), place: () => settings.cosmos.place, onUpdate: sendCosmos,
      wants: () => ({ space: m().space || sky(), rng: m().rng || sky() }) });
  }).catch((e) => console.error('[cosmos]', e));
}
function setCosmos(key, value) {
  const c = settings.cosmos;
  if (!experimental('sky') && value) return false;   // while the sky is off it can only be switched off
  if (key === 'mode' && value && Object.hasOwn(c.modes, value.k)) c.modes[value.k] = !!value.v;
  else if (key === 'all') for (const k in c.modes) c.modes[k] = !!value;
  else if (key === 'ring') c.ring = !!value;
  else if (key === 'place' && value && Number.isFinite(+value.lat) && Number.isFinite(+value.lon) && Math.abs(+value.lat) <= 90 && Math.abs(+value.lon) <= 180) {
    c.place = { lat: +value.lat, lon: +value.lon, elevation: Number.isFinite(+value.elevation) ? +value.elevation : 0, name: String(value.name || '').slice(0, 60) };
    cosmos?.moved();
  } else return false;
  save(); sendCosmos(); refreshTray(); return true;
}
function openSky() {
  if (!experimental('sky')) return;
  if (skyWin && !skyWin.isDestroyed()) { skyWin.show(); skyWin.focus(); return; }
  skyWin = new BrowserWindow({ width: 1280, height: 900, minWidth: 900, minHeight: 640, title: 'ON · the sky', backgroundColor: '#07080c', autoHideMenuBar: true, icon: iconImage() || undefined,
    webPreferences: { preload: path.join(__dirname, 'being', 'sky-preload.cjs'), contextIsolation: true, sandbox: true } });
  skyWin.loadFile(path.join(__dirname, 'being', 'sky.html'));
  skyWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  skyWin.webContents.on('will-navigate', (e) => e.preventDefault());
  skyWin.webContents.once('did-finish-load', () => { cosmos?.refresh(); sendCosmos(); });
  skyWin.on('closed', () => { skyWin = null; });
}
const fromSky = (e) => skyWin && !skyWin.isDestroyed() && e.sender === skyWin.webContents;
ipcMain.handle('sky-get', (e) => (fromSky(e) ? { cosmos: cosmosPayload(), labels: COSMOS_MODES.map((k) => [k, L('mode.' + k)]), ring: L('menu.ring') } : null));
ipcMain.handle('sky-set', (e, key, value) => (fromSky(e) ? setCosmos(key, value) : false));

function openShowcase() {   // a separate process with its own profile (being/showcase.mjs)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawn(process.execPath, [__dirname, '--showcase'], { cwd: __dirname, detached: true, stdio: 'ignore', env });
  child.unref();
}

// ---- the fly page's IPC (unchanged) ------------------------------------------------------------------------------
ipcMain.handle('pick-audio-file', async (e) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    title: 'Play an audio file', properties: ['openFile'], filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus', 'webm'] }],
  });
  return canceled ? null : filePaths[0];
});
ipcMain.handle('list-apps', () => (loopback ? { apps: apps() } : { error: captureError || 'Per-app capture unavailable on this platform.', apps: [] }));
ipcMain.handle('start-app', (e, pid) => (loopback ? startApp(e.sender, pid, String(pid)) : { error: captureError }));
ipcMain.handle('stop-app', () => { stopApp(); return { ok: true }; });

// one being at a time: a second launch opens the dashboard of the first
if (!process.env.ENTITY_MULTI && PAGE === 'being' && !app.requestSingleInstanceLock({ readyFile: process.env.BEING_READY_FILE || null })) app.exit(0);
app.on('second-instance', (_e, argv, _cwd, data) => {
  if (argv.includes('--dashboard')) openDashboard(); else if (argv.includes('--sky')) openSky(); else openSettings();
  // the launcher (setup/core.mjs) waits for a ready file: the running instance answers for the second launch
  const f = data && data.readyFile;
  if (f && path.dirname(f) === path.join(__dirname, '.setup') && /^launch-\d+-\d+\.ready$/.test(path.basename(f))) { try { fs.writeFileSync(f, 'running'); } catch {} }
});
// a way to the menu without right-clicking the pet (it is click-through, and a mouse is not for everyone): Ctrl+Alt+O opens it at the pointer
const MENU_KEY = 'CommandOrControl+Alt+O';
app.on('will-quit', () => globalShortcut.unregisterAll());
app.whenReady().then(() => { createWindow(); if (PAGE === 'being') { if (!SHOWCASE) { createTray(); EXTM?.ready?.(); try { globalShortcut.register(MENU_KEY, () => Menu.buildFromTemplate(menuTemplate()).popup()); } catch {} } if (PAGE === 'being') startCosmos(); } if (process.argv.includes('--dashboard')) openDashboard(); if (process.argv.includes('--sky')) openSky(); });
// lab: ENTITY_SHOT=<dir> saves the dashboard and the being after a while and quits (scratch/ harnesses)
if (process.env.ENTITY_SHOT) app.whenReady().then(() => setTimeout(async () => {
  try { if (skyWin && !skyWin.isDestroyed()) { await skyWin.webContents.executeJavaScript(`scrollTo(0, ${+process.env.ENTITY_SHOT_SCROLL || 0})`); await new Promise((r) => setTimeout(r, 300)); }
    if (skyWin && !skyWin.isDestroyed()) fs.writeFileSync(path.join(process.env.ENTITY_SHOT, 'shot-sky.png'), (await skyWin.webContents.capturePage()).toPNG());
    if (dash) fs.writeFileSync(path.join(process.env.ENTITY_SHOT, 'shot-dashboard.png'), (await dash.webContents.capturePage()).toPNG()); if (win) fs.writeFileSync(path.join(process.env.ENTITY_SHOT, 'shot-being.png'), (await win.webContents.capturePage()).toPNG()); } catch (e) { console.error(e); }
  app.quit();
}, +(process.env.ENTITY_SHOT_MS || 14000)));
app.on('window-all-closed', () => { if (!win) { stopApp(); stopMedia?.(); xPointer?.close(); cosmos?.stop(); app.quit(); } });
