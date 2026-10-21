'use strict';
// The pointer position straight from the X server (QueryPointer on the root window), for Linux X11 sessions.
// Chromium's screen.getCursorScreenPoint() on X11 only moves while one of its own windows receives mouse events, and the
// pet window ignores them until the cursor is over the creature, so it never learns the cursor arrived. A tiny X11
// client over the local socket (no dependency): connect with the session's MIT-MAGIC-COOKIE-1 if one exists, then poll.
const net = require('node:net'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');

function cookie(display) {   // the session's Xauthority entry for this display, if any
  try {
    const b = fs.readFileSync(process.env.XAUTHORITY || path.join(os.homedir(), '.Xauthority')), host = os.hostname();
    let o = 0;
    const str = () => { const n = b.readUInt16BE(o); o += 2; const s = b.subarray(o, o + n); o += n; return s; };
    let wild = null;
    while (o < b.length) {
      const family = b.readUInt16BE(o); o += 2;
      const addr = str().toString(), num = str().toString(), name = str().toString(), data = str();
      if (name !== 'MIT-MAGIC-COOKIE-1' || (num && num !== display)) continue;
      if (family === 256 && addr === host) return data;   // FamilyLocal
      if (family === 65535 || family === 256) wild = wild || data;
    }
    return wild;
  } catch { return null; }
}

/** -> { get(): {x, y} | null (physical pixels), rate(ms), close() } or null when there is no local X display */
function createPointer(ms = 50) {
  const m = /^:(\d+)(?:\.\d+)?$/.exec(process.env.DISPLAY || '');
  if (!m) return null;
  const sock = net.createConnection(`/tmp/.X11-unix/X${m[1]}`);
  const auth = cookie(m[1]), name = Buffer.from(auth ? 'MIT-MAGIC-COOKIE-1' : ''), data = auth || Buffer.alloc(0);
  const pad = (n) => (4 - (n % 4)) % 4;
  const setup = Buffer.alloc(12 + name.length + pad(name.length) + data.length + pad(data.length));
  setup.write('l', 0); setup.writeUInt16LE(11, 2); setup.writeUInt16LE(0, 4); setup.writeUInt16LE(name.length, 6); setup.writeUInt16LE(data.length, 8);
  name.copy(setup, 12); data.copy(setup, 12 + name.length + pad(name.length));
  sock.write(setup);
  let buf = Buffer.alloc(0), root = 0, pos = null, timer = null, every = ms, pending = false, dead = false;
  const query = () => { if (root && !pending && !dead) { const q = Buffer.alloc(8); q[0] = 38; q.writeUInt16LE(2, 2); q.writeUInt32LE(root, 4); pending = true; sock.write(q); } };
  const close = () => { dead = true; clearInterval(timer); sock.destroy(); };
  sock.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    if (!root) {   // the connection setup reply
      if (buf.length < 8) return;
      const total = 8 + 4 * buf.readUInt16LE(6);
      if (buf.length < total) return;
      if (buf[0] !== 1) { close(); return; }   // refused (no access)
      const vendor = buf.readUInt16LE(24), formats = buf[29];
      root = buf.readUInt32LE(40 + vendor + pad(vendor) + 8 * formats);
      buf = buf.subarray(total);
      query(); timer = setInterval(query, every);
    }
    while (buf.length >= 32) {   // replies, errors and events are 32 bytes (replies may carry more)
      const len = buf[0] === 1 ? 32 + 4 * buf.readUInt32LE(4) : 32;
      if (buf.length < len) return;
      if (buf[0] === 1) { pos = { x: buf.readInt16LE(16), y: buf.readInt16LE(18) }; pending = false; }
      else if (buf[0] === 0) pending = false;
      buf = buf.subarray(len);
    }
  });
  sock.on('error', close); sock.on('close', () => { dead = true; clearInterval(timer); });
  return {
    get: () => (dead ? null : pos),
    rate(n) { if (n === every || dead) return; every = n; if (timer) { clearInterval(timer); timer = setInterval(query, every); } },
    close,
  };
}
module.exports = { createPointer };
