// tools/serve.mjs - simple HTTP server for viewing ON in a browser over Tailscale / local network.
//   HOST=<tailscale ip> node tools/serve.mjs      (PORT defaults to 4242, HOST to 127.0.0.1: this machine only)
// Serves only being/ (never being/local/), lab/prototypes/, lab/organism/ and lab/results/organism-*, and the three.js (build, examples/jsm) and onnxruntime-web builds the
// pages import; anything else is 404.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = parseInt(process.env.PORT || '4242', 10);
const HOST = process.env.HOST || '127.0.0.1';
// what may be served: prefixes of the path relative to the root ('/' separated); DENY wins over ALLOW
const ALLOW = ['being/', 'lab/prototypes/', 'lab/organism/', 'lab/results/organism-', 'node_modules/three/build/', 'node_modules/three/examples/jsm/', 'node_modules/onnxruntime-web/dist/'];
const DENY = ['being/local/'];

// the absolute file for a URL path under root, or null when it is refused (bad encoding, NUL, outside root, not allowed)
export function resolveSafe(root, urlPath) {
  let p; try { p = decodeURIComponent(String(urlPath)); } catch { return null; }
  if (p.includes('\0')) return null;
  const abs = path.resolve(root, p.replace(/^[\\/]+/, ''));
  const rel = path.relative(root, abs);
  if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return null;
  const r = rel.split(path.sep).join('/');
  // Windows reaches the same file by other names: NTFS streams ('local::$INDEX_ALLOCATION'), trailing dots and spaces
  // ('local.'), short names ('LOCAL~1'); none is needed here, so refuse them all
  if (/[:~]/.test(r) || r.split('/').some((s) => /[. ]$/.test(s))) return null;
  if (!allowed(process.platform === 'win32' ? r.toLowerCase() : r)) return null;   // Windows paths ignore case
  // and a link or junction may lead elsewhere: check where the file really is
  let real; try { real = fs.realpathSync.native(abs); } catch { return abs; }   // not there: a 404 anyway
  const rr = path.relative(fs.realpathSync.native(root), real);
  if (!rr || rr === '..' || rr.startsWith('..' + path.sep) || path.isAbsolute(rr)) return null;
  const rs = rr.split(path.sep).join('/');
  return allowed(process.platform === 'win32' ? rs.toLowerCase() : rs) ? abs : null;
}
const allowed = (r) => !DENY.some((d) => r.startsWith(d)) && ALLOW.some((a) => r.startsWith(a));

const MIMES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.cjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
};

const LANDING_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ON · Tailscale Network Portal</title>
<style>
  :root {
    --bg: #0b0a09;
    --card: #151310;
    --border: #292420;
    --ink: #eee8de;
    --ink2: #a99f92;
    --accent: #d8b56a;
  }
  body {
    margin: 0;
    padding: 32px 20px;
    background: var(--bg);
    color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    display: flex;
    justify-content: center;
  }
  .wrap {
    max-width: 680px;
    width: 100%;
  }
  h1 {
    font-size: 28px;
    font-weight: 700;
    margin: 0 0 8px;
    color: var(--accent);
    letter-spacing: 0.04em;
  }
  p.sub {
    color: var(--ink2);
    margin: 0 0 28px;
    font-size: 15px;
    line-height: 1.5;
  }
  .grid {
    display: grid;
    gap: 16px;
  }
  .card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 20px;
    text-decoration: none;
    color: inherit;
    transition: all 0.2s ease;
    display: block;
  }
  .card:hover {
    border-color: var(--accent);
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(0,0,0,0.4);
  }
  .card h2 {
    margin: 0 0 6px;
    font-size: 18px;
    color: #fff;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .card p {
    margin: 0;
    color: var(--ink2);
    font-size: 13.5px;
    line-height: 1.45;
  }
  .badge {
    display: inline-block;
    padding: 3px 8px;
    border-radius: 99px;
    background: rgba(216, 181, 106, 0.15);
    color: var(--accent);
    font-size: 11px;
    font-weight: 600;
    margin-bottom: 8px;
  }
</style>
</head>
<body>
<div class="wrap">
  <div class="badge">TAILSCALE LINK</div>
  <h1>ON · Music Visualizer & Living Entity</h1>
  <p class="sub">Select an interface below to view the visualizer and materials from your other machine.</p>

  <div class="grid">
    <a class="card" href="/being/index.html?showcase=1">
      <h2>✦ Living Entity Showcase (Browser Run)</h2>
      <p>The full living creature running in your web browser with procedural sound synthesis, 3D physics, real-time material flows, and automated tour across emotional states.</p>
    </a>

    <a class="card" href="/being/dashboard.html">
      <h2>✦ Interactive Dashboard</h2>
      <p>Developer dashboard with live readouts of the ear, the mind and the materials, and real-time audio analysis.</p>
    </a>
  </div>
</div>
</body>
</html>`;

const server = http.createServer((req, res) => {
  console.log(new Date().toLocaleTimeString(), req.method, req.url);
  const reqUrl = new URL(req.url, 'http://localhost');
  const pathname = reqUrl.pathname;

  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(LANDING_PAGE);
    return;
  }

  const filePath = resolveSafe(ROOT, pathname);
  if (!filePath) {   // refused paths look like missing ones
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found: ' + pathname);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIMES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

// listen only when run directly, so tests can import resolveSafe
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) server.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});
