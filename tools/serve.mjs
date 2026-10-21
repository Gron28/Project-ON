// tools/serve.mjs - simple HTTP server for viewing ON over Tailscale / local network
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = parseInt(process.env.PORT || '4242', 10);

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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(reqUrl.pathname);

  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(LANDING_PAGE);
    return;
  }

  const filePath = path.join(ROOT, pathname.replace(/^\//, ''));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
});
