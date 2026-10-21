// being/memory-store.cjs - where the being keeps its memories, under <userData>/being-memory/<seed>/:
//   <Artist>/<Album>/<Title> [hash].json + .png   one song: its skin map, what it knows about it, a picture of its skin
//   _general.json                                  its map of all music
//   _index.json                                    song key hash -> relative path (a song moves when its album is learned)
// Songs without album metadata go to <Artist>/Singles. Older flat <hash>.json files are moved into place when found.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const hashOf = (key) => crypto.createHash('sha1').update(String(key)).digest('hex').slice(0, 16);

/** a name that is safe as one path segment on Windows, macOS and Linux */
function segment(s, fallback) {
  let t = String(s || '').normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(t)) t = '_' + t;
  t = t.slice(0, 80).trim();
  return t || fallback;
}

/** relative path (no extension) for a song; the short hash keeps two songs with the same title apart */
function songPath(meta, hash) {
  const m = meta || {};
  const artist = segment(m.albumArtist || m.artist, 'Unknown artist');
  const album = segment(m.album, 'Singles');
  return path.join(artist, album, `${segment(m.title, 'Untitled')} [${hash.slice(0, 6)}]`);
}

function createStore(root) {
  const dir = (seed) => { const d = path.join(root, String(seed | 0)); fs.mkdirSync(d, { recursive: true }); return d; };
  const indexes = new Map();
  const index = (seed) => {
    if (!indexes.has(seed)) {
      let ix = {};
      try { ix = JSON.parse(fs.readFileSync(path.join(dir(seed), '_index.json'), 'utf8')) || {}; } catch {}
      indexes.set(seed, ix);
    }
    return indexes.get(seed);
  };
  const writeIndex = (seed) => fs.writeFileSync(path.join(dir(seed), '_index.json'), JSON.stringify(index(seed), null, 1));
  const move = (from, to) => {
    for (const ext of ['.json', '.png']) {
      if (!fs.existsSync(from + ext)) continue;
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(from + ext, to + ext);
    }
  };
  const pruneEmpty = (seed, rel) => {   // remove album and artist folders a move left empty
    const top = dir(seed);
    let d = path.dirname(path.join(top, rel));
    while (d.startsWith(top) && d !== top) {
      try { if (fs.readdirSync(d).length) break; fs.rmdirSync(d); } catch { break; }
      d = path.dirname(d);
    }
  };
  /** files a legacy flat <hash>.json into its artist/album folder; returns the new relative path */
  const migrate = (seed, h) => {
    const flat = path.join(dir(seed), h);
    let meta = null;
    try { meta = JSON.parse(fs.readFileSync(flat + '.json', 'utf8')).meta; } catch {}
    const rel = songPath(meta, h);
    move(flat, path.join(dir(seed), rel));
    index(seed)[h] = rel; writeIndex(seed);
    return rel;
  };
  /** where a song lives now (absolute, no extension), or null if it has never been saved */
  function locate(seed, key) {
    const h = hashOf(key), ix = index(seed);
    if (ix[h] && fs.existsSync(path.join(dir(seed), ix[h]) + '.json')) return path.join(dir(seed), ix[h]);
    if (fs.existsSync(path.join(dir(seed), h) + '.json')) return path.join(dir(seed), migrate(seed, h));
    return null;
  }
  function load(seed, key) {
    const f = key === '__general__' ? path.join(dir(seed), '_general') : locate(seed, key);
    if (!f) return null;
    try { return JSON.parse(fs.readFileSync(f + '.json', 'utf8')); } catch { return null; }
  }
  function save(seed, key, data, png) {
    let f;
    if (key === '__general__') f = path.join(dir(seed), '_general');
    else {
      const h = hashOf(key), ix = index(seed), rel = songPath(data && data.meta, h);
      if (ix[h] !== rel) {   // a new song, or its folder changed (album learned, title corrected): move what exists
        const oldRel = ix[h], old = locate(seed, key);
        if (old) { move(old, path.join(dir(seed), rel)); if (oldRel) pruneEmpty(seed, oldRel); }
        ix[h] = rel; writeIndex(seed);
      }
      f = path.join(dir(seed), rel);
      fs.mkdirSync(path.dirname(f), { recursive: true });
    }
    fs.writeFileSync(f + '.json', JSON.stringify(data));
    if (typeof png === 'string' && png.startsWith('data:image/png;base64,')) fs.writeFileSync(f + '.png', Buffer.from(png.slice(22), 'base64'));
    return true;
  }
  function list(seed) {
    for (const n of fs.readdirSync(dir(seed))) { const m = /^([0-9a-f]{16})\.json$/.exec(n); if (m) migrate(seed, m[1]); }
    return Object.values(index(seed)).map((rel) => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(dir(seed), rel) + '.json', 'utf8'));
        return { title: d.meta?.title, artist: d.meta?.artist, album: d.meta?.album, plays: d.meta?.plays, experience: d.meta?.experience };
      } catch { return null; }
    }).filter(Boolean);
  }
  return { dir, load, save, list };
}

function registerMemoryIpc(ipcMain, app) {
  const store = createStore(path.join(app.getPath('userData'), 'being-memory'));
  ipcMain.handle('memory-load', (e, seed, key) => { try { return store.load(seed, key); } catch { return null; } });
  ipcMain.handle('memory-save', (e, seed, key, data, png) => { try { return store.save(seed, key, data, png); } catch (err) { return { error: err.message }; } });
  ipcMain.handle('memory-index', (e, seed) => { try { return store.list(seed); } catch { return []; } });
  ipcMain.on('open-memories', (e, seed) => { try { store.list(seed); } catch {} require('electron').shell.openPath(store.dir(seed)); });   // tidies old flat files first
}

module.exports = { registerMemoryIpc, createStore, songPath, segment };
