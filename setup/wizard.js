// setup/wizard.js - three states: install, installing, done (or error). Short words only.
const token = document.body.dataset.token;
const $ = (id) => document.getElementById(id);
const get = async (p) => (await fetch(`${p}?token=${token}`)).json();
const post = async (p, body = {}) => { const r = await fetch(`${p}?token=${token}`, { method: 'POST', headers: { 'x-token': token, 'content-type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json(); if (j.error) throw new Error(j.error); return j; };
let phase = '', stepsDrawn = false;

function show(id) { for (const s of ['welcome', 'installing', 'error']) $(s).hidden = s !== id; }
function render(s) {
  if (!stepsDrawn && s.steps) { $('steps').replaceChildren(...s.steps.map(([id, label]) => Object.assign(document.createElement('li'), { id: 'st-' + id, textContent: label }))); stepsDrawn = true; }
  for (const [id] of s.steps || []) { const li = $('st-' + id); li.className = s.done.includes(id) ? 'done' : s.step === id ? 'now' : ''; }
  $('fill').style.width = Math.round(s.progress * 100) + '%';
  $('logs').textContent = s.logs.join('\n'); $('details').hidden = !s.logs.length;
  if (s.phase === phase) return;
  phase = s.phase; $('note').hidden = true;
  const P = $('primary'), Q = $('secondary');
  P.disabled = false; Q.hidden = true;
  if (s.phase === 'welcome') {
    show('welcome'); P.textContent = 'Install'; $('meta').hidden = false; $('lead').textContent = 'A living music visualizer for your desktop.';
    if (!s.caps.supported) { show('error'); $('errmsg').textContent = 'Being needs Windows 10 or 11 on x64.'; P.disabled = true; }
    else if (!s.caps.perApp) $('meta').textContent = 'About 350 MB · no administrator access · listens to all system audio on this Windows version';
  } else if (s.phase === 'installed') {
    show('welcome'); $('lead').textContent = 'Installed.'; $('meta').hidden = true; P.textContent = 'Open';
    Q.hidden = false; Q.textContent = 'Repair';
    $('desktop').checked = s.has.desktop; $('startup').checked = s.has.startup;
  } else if (s.phase === 'installing') { show('installing'); P.textContent = 'Installing…'; P.disabled = true; $('lead').textContent = 'Setting up.'; }
  else if (s.phase === 'ready') { show('installing'); $('lead').textContent = 'Ready.'; P.textContent = 'Open'; Q.hidden = false; Q.textContent = 'Close'; $('note').hidden = !s.message; $('note').textContent = s.message; }
  else if (s.phase === 'error') { show('error'); $('errmsg').textContent = s.message; $('lead').textContent = 'Setup stopped.'; P.textContent = 'Try again'; Q.hidden = false; Q.textContent = 'Close'; $('details').open = true; }
}
const opts = (extra) => ({ desktop: $('desktop').checked, startup: $('startup').checked, ...extra });
const note = (text) => { $('note').textContent = text; $('note').hidden = !text; };
async function primary() {
  const P = $('primary'), label = P.textContent;
  try {
    if (phase === 'welcome' || phase === 'error') await post('/install', opts());
    else if (phase === 'installed' || phase === 'ready') { note(''); P.disabled = true; P.textContent = 'Opening…'; await post('/launch'); P.textContent = 'Opened'; setTimeout(() => window.close(), 600); }
  } catch (e) { P.disabled = false; P.textContent = label; note(e.message); }
}
async function secondary() {
  if (phase === 'installed') await post('/install', opts({ force: true }));
  else { await post('/close'); window.close(); }
}
for (const id of ['desktop', 'startup']) $(id).addEventListener('change', async () => { if (phase === 'installed') try { await post('/shortcuts', opts()); } catch (e) { note(e.message); } });
$('primary').addEventListener('click', primary);
$('secondary').addEventListener('click', secondary);
(async function poll() { try { render(await get('/status')); } catch {} setTimeout(poll, 400); })();
