// being/atomic.cjs - write a file whole or not at all: a crash mid-write leaves the old file, never a torn one.
// Written beside the target (same volume), then renamed over it, as setup/core.mjs does for ready.json.
const fs = require('node:fs');

// On Windows the rename fails while anything holds the target open (antivirus, the search indexer, cloud sync): it is
// retried briefly, and if the file stays locked it is written in place, as before, rather than not saved at all.
const LOCKED = new Set(['EPERM', 'EBUSY', 'EACCES']);
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function writeFileAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  try { fs.writeFileSync(tmp, data); }
  catch (e) { try { fs.unlinkSync(tmp); } catch {} throw e; }
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return; }
    catch (e) {
      if (LOCKED.has(e.code) && i < 4) { pause(15 * (i + 1)); continue; }
      try { fs.unlinkSync(tmp); } catch {}
      if (LOCKED.has(e.code) && !isDir(file)) { fs.writeFileSync(file, data); return; }
      throw e;
    }
  }
}
const isDir = (f) => { try { return fs.statSync(f).isDirectory(); } catch { return false; } };

module.exports = { writeFileAtomic };
