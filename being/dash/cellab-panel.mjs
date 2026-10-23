// being/dash/cellab-panel.mjs - the dashboard's 'Living patterns (CelLab)' panel: the automaton on ON's surface and the one
// inside it (being/page/cellab.mjs, snap.cellab): which rules grow now and why (the mood), switches for each, a rule or
// 'auto' for each, the palette, and a moment to show them now (dev-cmd { k: 'cellab', ... }).
// Rules and palettes after CelLab / WebCA by Rudy Rucker and John Walker (fourmilab.ch/cellab), public domain.

export function install(CLB, { h, panel, fmt, cmd }) {
  let body = null, swS, swI, selS, selI, selP, kv, moodEl, credit, last = '';
  const send = (o) => cmd({ k: 'cellab', ...o });
  const opt = (v, t) => h('option', { value: v }, t);
  function build() {
    if (body) return;
    body = panel('cellab', 'Living patterns (CelLab)', true);
    swS = h('input', { type: 'checkbox', 'aria-label': 'Patterns on the surface', on: { change: () => send({ surface: swS.checked }) } });
    swI = h('input', { type: 'checkbox', 'aria-label': 'Patterns inside', on: { change: () => send({ inside: swI.checked }) } });
    selS = h('select', { 'aria-label': 'Surface rule', on: { change: () => send({ rule: selS.value }) } }, opt('auto', 'surface: auto'));
    selI = h('select', { 'aria-label': 'Inside rule', on: { change: () => send({ rule3d: selI.value }) } }, opt('auto', 'inside: auto'));
    selP = h('select', { 'aria-label': 'Palette', on: { change: () => send({ palette: selP.value }) } }, opt('auto', 'palette: the rule\'s own'));
    kv = h('div', { class: 'kv' }); moodEl = h('div', { class: 'sub2', style: 'margin-top:6px' });
    credit = h('div', { class: 'sub2', style: 'margin-top:8px;opacity:.75' });
    const row = (...k) => h('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:6px' }, ...k);
    body.append(
      row(h('label', { style: 'display:inline-flex;gap:6px;align-items:center' }, swS, 'On the surface'), selS,
        h('button', { class: 'chip', title: 'Surface it now for 10 s', on: { click: () => send({ show: 'surface' }) } }, 'show now')),
      row(h('label', { style: 'display:inline-flex;gap:6px;align-items:center' }, swI, 'Inside'), selI,
        h('button', { class: 'chip', title: 'Light the inside now for 10 s', on: { click: () => send({ show: 'inside' }) } }, 'show now')),
      row(selP, h('button', { class: 'chip', title: 'Drop seeds on both', on: { click: () => send({ seed: true }) } }, 'seed')),
      kv, moodEl, credit);
  }
  function feed(c) {
    if (!c) return;
    build();
    if (selS.options.length === 1) {
      selS.append(...c.rules.map(([id, n]) => opt(id, n))); selI.append(...c.rules3d.map(([id, n]) => opt(id, n)));
      selP.append(...c.palettes.map((p) => opt(p, p))); credit.textContent = c.credit;
    }
    if (document.activeElement !== selS) selS.value = c.surface.forced ? c.surface.rule : 'auto';
    if (document.activeElement !== selI) selI.value = c.inside.forced ? c.inside.rule : 'auto';
    if (document.activeElement !== selP) selP.value = c.palette;
    swS.checked = c.on.surface; swI.checked = c.on.inside;
    const key = JSON.stringify([c.surface.name, c.inside.name, c.mood, c.surface.a, c.inside.a, c.surface.lead, c.inside.gated]);
    if (key === last) return; last = key;
    kv.replaceChildren(...[
      [c.surface.name, 'surface rule'], [fmt(c.surface.a), 'shown'], [fmt(c.surface.lead), 'leads this surfacing'], [fmt(c.surface.steps, 1), 'steps / s'],
      [c.inside.name, 'inside rule'], [c.inside.gated ? 'off (light mode)' : fmt(c.inside.a), 'inside shown'], [fmt(c.surface.share), 'song share'], [c.known ? 'remembered' : 'new', 'this song'],
    ].map(([v, k]) => h('div', {}, h('b', { class: 'num' }, String(v)), h('small', {}, k))));
    moodEl.textContent = `mood: ${c.mood} · ` + Object.entries(c.moods).map(([m, s]) => `${m} ${fmt(s)}`).join(' · ') + ` · section ${c.section}`;
  }
  CLB.build = build; CLB.feed = feed;
}
