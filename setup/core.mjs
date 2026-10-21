// setup/core.mjs - installs Being into its own folder: no administrator access, nothing written outside the folder
// except the shortcuts the person chooses. Steps: checks, packages (npm ci, scripts off), Electron (its own checksum
// verification), the native capture addon, the icon, shortcuts, a fingerprinted ready marker.
import fs from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { writeIcons } from './icon.mjs';

export const STEPS = [['check', 'Checking'], ['packages', 'Packages'], ['electron', 'Runtime'], ['capture', 'Audio'], ['shortcuts', 'Shortcuts']];

/** what this machine can do, before anything is installed */
export function capabilities() {
  const build = process.platform === 'win32' ? Number(os.release().split('.')[2]) || 0 : 0;
  return {
    platform: process.platform, arch: process.arch, build,
    supported: process.platform === 'win32' && process.arch === 'x64',
    perApp: process.platform === 'win32' && build >= 20348,   // per-app loopback needs Windows 11 / Server 2022; system audio works everywhere
  };
}
/** a short, actionable sentence for a failed step (log text in, message out) */
export function explain(log = '', fallback = 'A step failed. See details.') {
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up|getaddrinfo/i.test(log)) return 'No connection. Check the internet and try again.';
  if (/EBUSY|EPERM|EACCES|resource busy/i.test(log)) return 'A file is in use. Close ON and try again.';
  if (/ENOSPC/i.test(log)) return 'Not enough disk space.';
  if (/EINTEGRITY|checksum|sha\d+ /i.test(log)) return 'A download was damaged. Try again.';
  return fallback;
}
const fingerprint = async (root) => createHash('sha256').update(await fs.readFile(path.join(root, 'package.json'))).update(await fs.readFile(path.join(root, 'package-lock.json'))).digest('hex');

/** Windows shortcuts through the shell's own COM object (no extra tools) */
export function shortcut(lnk, { target, args = '', cwd, icon, description = 'ON' }) {
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const ps = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut(${q(lnk)});$s.TargetPath=${q(target)};$s.Arguments=${q(args)};$s.WorkingDirectory=${q(cwd)};$s.IconLocation=${q(icon)};$s.Description=${q(description)};$s.Save()`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  if (r.status !== 0) throw new Error('Could not create a shortcut: ' + (r.stderr || r.stdout || '').trim().slice(0, 300));
}
let desktopDir;   // the real Desktop (it moves when OneDrive backs it up), from the user's shell folders
function desktop() {
  if (desktopDir) return desktopDir;
  desktopDir = path.join(os.homedir(), 'Desktop');
  if (process.platform === 'win32') {
    const r = spawnSync('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders', '/v', 'Desktop'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    const m = /Desktop\s+REG_(?:EXPAND_)?SZ\s+(.+)/.exec(r.stdout || '');
    if (m) desktopDir = m[1].trim().replace(/%([^%]+)%/g, (x, v) => process.env[v] || x);
  }
  return desktopDir;
}
export const LNK = 'ON.lnk', OLD_LNK = 'Being.lnk';   // the name the shortcuts had before they were called ON
export const shortcutPaths = (name = LNK) => {
  const only = process.env.BEING_SHORTCUTS_DIR;   // tests: keep every shortcut inside one folder
  if (only) return { desktop: path.join(only, 'desktop', name), start: path.join(only, 'start', name), startup: path.join(only, 'startup', name) };
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return { desktop: path.join(desktop(), name), start: path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', name), startup: path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', name) };
};

export class Installer {
  constructor(root, update = () => {}) {
    this.root = root; this.update = update; this.busy = false; this.child = null;
    this.state = { phase: 'welcome', step: null, done: [], progress: 0, message: '', logs: [], caps: capabilities() };
  }
  emit(patch) { Object.assign(this.state, patch); this.update(this.state); }
  log(text) { this.state.logs.push(String(text).replace(/\x1b\[[0-9;]*m/g, '').trimEnd().slice(-1600)); this.state.logs = this.state.logs.slice(-120); this.update(this.state); }
  step(id, progress) { if (this.state.step && !this.state.done.includes(this.state.step)) this.state.done.push(this.state.step); this.emit({ phase: 'installing', step: id, progress }); }
  electronExe() { return path.join(this.root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron'); }
  async ready() {
    try {
      const m = JSON.parse(await fs.readFile(path.join(this.root, '.setup', 'ready.json'), 'utf8'));
      if (m.fingerprint !== await fingerprint(this.root) || m.platform !== process.platform || m.arch !== process.arch) return false;
      await fs.access(this.electronExe());
      createRequire(path.join(this.root, 'package.json'))(path.join(this.root, 'native', 'capture.cjs'));
      return true;
    } catch { return false; }
  }
  run(args, timeout = 900000) {
    return new Promise((resolve, reject) => {
      const env = { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ''}` };
      const child = spawn(process.execPath, args, { cwd: this.root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      this.child = child;
      child.stdout.on('data', (x) => this.log(x)); child.stderr.on('data', (x) => this.log(x));
      const timer = setTimeout(() => { child.kill(); reject(new Error('A step took too long. Check the connection and try again.')); }, timeout);
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.on('exit', (code) => { clearTimeout(timer); this.child = null; code === 0 ? resolve() : reject(new Error(explain(this.state.logs.join('\n'), `${(STEPS.find(([id]) => id === this.state.step) || [0, 'Setup'])[1]} failed. See details.`))); });
    });
  }
  /** create the chosen shortcuts, remove the others */
  async shortcuts(opts) {
    const icons = await writeIcons(this.root);
    const p = shortcutPaths(), target = this.electronExe(), sc = { target, args: `"${this.root.replace(/[\\/]$/, '')}"`, cwd: this.root, icon: icons.ico };
    const old = shortcutPaths(OLD_LNK);
    for (const k of ['desktop', 'start', 'startup']) {
      if (opts[k]) { await fs.mkdir(path.dirname(p[k]), { recursive: true }); shortcut(p[k], sc); }
      else await fs.rm(p[k], { force: true });
      await fs.rm(old[k], { force: true });   // the shortcut it made before it was called ON
    }
  }
  /** @param options { desktop, start, startup } shortcuts to create; { force } reinstalls even when ready */
  async install(options = {}) {
    if (this.busy) return; this.busy = true;
    const opts = { desktop: true, start: true, startup: false, ...options };
    try {
      if (opts.force) await fs.rm(path.join(this.root, '.setup', 'ready.json'), { force: true });
      this.emit({ done: [], logs: [] });
      this.step('check', 0.02);
      const caps = this.state.caps;
      if (!caps.supported) throw new Error('ON needs Windows 10 or 11 on x64.');
      const disk = await fs.statfs(this.root);
      if (Number(disk.bavail) * Number(disk.bsize) < 800 * 1024 ** 2) throw new Error('Free at least 800 MB on this drive.');
      if (!(await this.ready())) {
        const npm = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
        await fs.access(npm);
        await fs.mkdir(path.join(this.root, '.setup'), { recursive: true });
        await fs.rm(path.join(this.root, '.setup', 'ready.json'), { force: true });
        this.step('packages', 0.1);
        await this.run([npm, 'ci', '--ignore-scripts', '--omit=optional', '--include=dev', '--no-audit', '--no-fund']);
        this.step('electron', 0.55);
        await this.run([path.join(this.root, 'node_modules', 'electron', 'install.js')]);
        this.step('capture', 0.85);
        await this.run(['-e', "require('./native/capture.cjs').loadCapture(); console.log('capture ok')"]);
      }
      this.step('shortcuts', 0.92);
      let note = '';
      try { if (opts.shortcuts !== false) await this.shortcuts(opts); } catch (e) { note = 'No shortcut was made. Use Launch.cmd.'; this.log(e.message); }
      const marker = { fingerprint: await fingerprint(this.root), platform: process.platform, arch: process.arch, completed: new Date().toISOString() };
      const dest = path.join(this.root, '.setup', 'ready.json');
      await fs.writeFile(dest + '.tmp', JSON.stringify(marker)); await fs.rename(dest + '.tmp', dest);
      this.state.done = STEPS.map(([id]) => id);
      this.emit({ phase: 'ready', step: null, progress: 1, message: note });
    } catch (error) { this.emit({ phase: 'error', message: error.message }); }
    finally { this.busy = false; }
  }
  /** start the app, detached, and wait until its window has loaded */
  async launch() {
    if (!(await this.ready())) throw new Error('Not installed yet.');
    const readyFile = path.join(this.root, '.setup', `launch-${process.pid}-${Date.now()}.ready`), logFile = path.join(this.root, '.setup', 'launch.log');
    const fd = openSync(logFile, 'w');
    const env = { ...process.env, BEING_READY_FILE: readyFile }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(this.electronExe(), [this.root], { cwd: this.root, detached: true, stdio: ['ignore', fd, fd], windowsHide: true, env });
    closeSync(fd);
    // a copy that finds Being already running exits at once; the running one answers with the ready file
    let failed = null, handoff = false, exitAt = 0; child.once('error', (e) => { failed = e; }); child.once('exit', (c) => { failed = new Error(`ON closed while starting (${c}).`); handoff = c === 0; exitAt = Date.now(); });
    const until = Date.now() + 30000;
    while (Date.now() < until) {
      try { await fs.access(readyFile); child.unref(); await fs.rm(readyFile, { force: true }); return; } catch {}
      if (failed && (!handoff || Date.now() - exitAt > 6000)) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    child.kill(); await fs.rm(readyFile, { force: true });
    if (handoff) throw new Error('ON is already running.');
    throw new Error((failed ? failed.message : 'ON did not open within 30 seconds.') + ' See .setup/launch.log.');
  }
}
