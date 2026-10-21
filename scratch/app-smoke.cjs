// the whole app (main.cjs) in a throwaway profile: opens the being in a window and the dashboard, then reports the page's and the
// dashboard's errors, the dashboard's panels, the Look group's rows, the experimental switches and the right-click menu.
// XDG_CONFIG_HOME=$(mktemp -d) ENTITY_MULTI=1 ./node_modules/.bin/electron scratch/app-smoke.cjs   (SECS=20, EVAL='page expression')
const { app, BrowserWindow, Menu } = require('electron');
const errors = []; let out0 = null;
app.on('web-contents-created', (e, wc) => wc.on('console-message', (ev, lvl, msg) => { const level = ev.level ?? lvl, m = ev.message ?? msg; if (level === 'error' || level === 3 || level === 'warning' && /Uncaught|Error/.test(m)) errors.push(`${wc.getURL().split('/').pop().split('?')[0]}: ${String(m).slice(0, 240)}`); }));
let menu = null; const build = Menu.buildFromTemplate; Menu.buildFromTemplate = (t) => { if (!menu || t.length >= menu.length) menu = t; return build.call(Menu, t); };
process.env.ENTITY_WINDOW = '1'; process.argv.push('--dashboard');
require('../main.cjs');
app.whenReady().then(() => setTimeout(async () => {
  const wins = BrowserWindow.getAllWindows(), dash = wins.find((w) => /dashboard/.test(w.webContents.getURL())), page = wins.find((w) => /being\/index/.test(w.webContents.getURL()));
  if (dash) out0 = await dash.webContents.executeJavaScript(`new Promise((r) => setTimeout(() => r(JSON.stringify({ S: !!S, frozen, built, sections: document.querySelectorAll("#live section").length, live: !!document.querySelector("#live"), empty: !!document.querySelector("#empty") })), 3000))`).catch((e) => e.message);
  const out = { out0, windows: wins.map((w) => w.webContents.getURL().split('/').pop().split('?')[0]) };
  if (dash) Object.assign(out, await dash.webContents.executeJavaScript(`(async () => { const errs = []; addEventListener('error', (e) => errs.push(e.message + ' @' + e.lineno + ' ' + (e.filename || '').split('/').pop())); addEventListener('unhandledrejection', (e) => errs.push('rejection ' + (e.reason && e.reason.message))); let got = 0; dash.onSnap(() => got++); await new Promise((r) => setTimeout(r, 2500));
    return { panels: [...document.querySelectorAll('#live section h2')].map((x) => x.textContent), look: document.querySelector('#look').children.length,
      experimental: [...document.querySelectorAll('#experimental .row label')].map((x) => x.textContent), tree: !!document.querySelector('#live canvas') && typeof P.treeC !== 'undefined',
      record: P.recBody ? P.recBody.children.length : null, snap: !!S, built, got, errs }; })()`));
  if (page) out.page = await page.webContents.executeJavaScript(`Object.keys(window).filter((k) => k.startsWith('__')).length`);   // how many lab hooks the page has (the local folder adds some)
  if (page && process.env.EVAL) out.eval = await page.webContents.executeJavaScript(process.env.EVAL).catch((e) => 'threw: ' + e.message);   // EVAL: a page expression to report
  out.menu = (menu || []).map((i) => i.label || (i.type === 'separator' ? '—' : '?'));
  console.log(JSON.stringify(out, null, 1)); console.log('errors', errors.length); errors.slice(0, 20).forEach((e) => console.log('  !', e));
  app.exit(0);
}, +(process.env.SECS || 20) * 1000));
