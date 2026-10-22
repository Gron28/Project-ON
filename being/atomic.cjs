// being/atomic.cjs - write a file whole or not at all: a crash mid-write leaves the old file, never a torn one.
// Written beside the target (same volume), then renamed over it, as setup/core.mjs does for ready.json.
const fs = require('node:fs');

function writeFileAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  try { fs.writeFileSync(tmp, data); fs.renameSync(tmp, file); }
  catch (e) { try { fs.unlinkSync(tmp); } catch {} throw e; }
}

module.exports = { writeFileAtomic };
