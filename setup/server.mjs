// setup/server.mjs - the setup wizard: a private local page (random token, localhost only, strict CSP) shown in a small
// app window (Microsoft Edge app mode, else the default browser). It exits when the wizard is closed or Being launches.
//   --launch        start Being if installed (else show the wizard)
//   --install-only  install without a window (console output)
import http from 'node:http';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Installer, STEPS, shortcutPaths } from './core.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const token = randomBytes(24).toString('hex');
const installer = new Installer(root);
const quit = (code = 0) => { installer.child?.kill(); server?.close(); process.exit(code); };

if (process.argv.includes('--install-only')) {
  installer.update = (s) => process.stdout.write(`\r${(s.step || s.phase).padEnd(10)} ${Math.round(s.progress * 100)}%   `);
  await installer.install({ shortcuts: !process.argv.includes('--no-shortcuts') });
  console.log(installer.state.phase === 'ready' ? '\nInstalled.' : `\n${installer.state.message}`);
  process.exit(installer.state.phase === 'ready' ? 0 : 1);
}
if (process.argv.includes('--launch') && await installer.ready()) {
  try { await installer.launch(); process.exit(0); } catch (e) { console.error(e.message); }
}
if (installer.state.phase === 'welcome' && await installer.ready()) installer.emit({ phase: 'installed' });

let origin, lastSeen = Date.now(), server;
const files = { '/wizard.css': 'text/css', '/wizard.js': 'text/javascript', '/icon.png': 'image/png' };
server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'");
  const url = new URL(req.url, origin);
  if (req.headers.host !== new URL(origin).host || url.searchParams.get('token') !== token) { res.writeHead(403); res.end(); return; }
  lastSeen = Date.now();
  try {
    if (req.method === 'GET' && url.pathname === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end((await fs.readFile(path.join(root, 'setup', 'wizard.html'), 'utf8')).replaceAll('__TOKEN__', token)); }
    else if (req.method === 'GET' && files[url.pathname]) {
      const file = url.pathname === '/icon.png' ? path.join(root, '.setup', 'being.png') : path.join(root, 'setup', url.pathname.slice(1));
      if (url.pathname === '/icon.png' && !existsSync(file)) await (await import('./icon.mjs')).writeIcons(root);
      res.setHeader('Content-Type', files[url.pathname]); res.end(await fs.readFile(file));
    } else if (req.method === 'GET' && url.pathname === '/status') {
      const sp = shortcutPaths();
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ...installer.state, steps: STEPS, has: { desktop: existsSync(sp.desktop), startup: existsSync(sp.startup) } }));
    } else if (req.method === 'POST' && req.headers.origin === origin && req.headers['x-token'] === token) {
      const body = await new Promise((r) => { let b = ''; req.on('data', (x) => { b += x; if (b.length > 4096) req.destroy(); }); req.on('end', () => r(b)); });
      const opts = (() => { try { return JSON.parse(body || '{}'); } catch { return {}; } })();
      if (url.pathname === '/install') { installer.install({ desktop: !!opts.desktop, start: true, startup: !!opts.startup, force: !!opts.force }); res.end('{}'); }
      else if (url.pathname === '/shortcuts') { await installer.shortcuts({ desktop: !!opts.desktop, start: true, startup: !!opts.startup }); res.end('{}'); }
      else if (url.pathname === '/launch') { await installer.launch(); res.end('{}'); setTimeout(() => quit(0), 800); }
      else if (url.pathname === '/close') { res.end('{}'); setTimeout(() => quit(0), 200); }
      else { res.writeHead(404); res.end(); }
    } else { res.writeHead(403); res.end(); }
  } catch (error) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: error.message })); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
origin = `http://127.0.0.1:${server.address().port}`;
const url = `${origin}/?token=${token}`;
console.log(`ON setup is open in a window. If it did not appear, open:\n${url}\n`);
if (!process.argv.includes('--no-open')) {
  // an app window (no browser chrome) when Edge is there; otherwise the default browser
  const pf = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
  const edge = pf.map((d) => path.join(d, 'Microsoft', 'Edge', 'Application', 'msedge.exe')).find((p) => existsSync(p));
  const child = edge
    ? spawn(edge, [`--app=${url}`, '--window-size=460,560', `--user-data-dir=${path.join(root, '.setup', 'wizard-profile')}`, '--no-first-run'], { detached: true, stdio: 'ignore' })
    : spawn('cmd.exe', ['/d', '/c', 'start', '', url], { windowsHide: true, stdio: 'ignore' });
  child.on('error', () => {}); child.unref();
}
// the wizard polls while it is open; when it has been gone for a while (window closed), setup ends
setInterval(() => { if (!installer.busy && Date.now() - lastSeen > 20000) quit(0); }, 2000);
process.on('SIGINT', () => quit(0));
