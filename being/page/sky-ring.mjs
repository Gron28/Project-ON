// being/page/sky-ring.mjs - the sky ring round ON (right-click Sky), and the Sun's four stations marked, said and sounded
import { SECTORS } from '../cosmos/tables.mjs';

export function createSkyRing({ COS, lex, say, cosmosEvent }) {
  const hhmm = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const untilText = (iso) => { const m = Math.max(0, (Date.parse(iso) - Date.now()) / 60000); return m >= 60 ? `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')} min` : `${Math.round(m)} min`; };
  // the sky around it, oriented to the real horizon: the ecliptic's rising point at nine o'clock, so the upper half is the
  // sky above you; twelve coloured 30° sectors, the bodies where they stand (the Sun and Moon large and labelled), and a
  // short line below: the Moon's phase and the Sun's next station. Text has a floor in screen pixels, so it stays legible
  // at every window size. The local words add their own reading (LEX.enrich).
  function drawSkyRing() {
    const LEX = lex();
    const el = document.getElementById('skyring'), plain = COS.data && COS.data.sky, sky = plain && LEX.enrich(plain);
    el.classList.toggle('on', COS.ring && !!sky);
    if (!COS.ring || !sky) return;
    const u = 100 / Math.max(120, el.getBoundingClientRect().width || 400), px = (n, min) => Math.max(min * u, n);   // svg units per pixel; a size never below `min` px
    const rise = sky.rising.lon, P = (lon, r) => { const a = Math.PI + (lon - rise) * Math.PI / 180; return [r * Math.cos(a), -r * Math.sin(a)]; };
    const arc = (l0, l1, r0, r1) => { const [a, b] = P(l0, r1), [c2, d] = P(l1, r1), [e2, f] = P(l1, r0), [g, h] = P(l0, r0); return `M${a},${b} A${r1},${r1} 0 0 0 ${c2},${d} L${e2},${f} A${r0},${r0} 0 0 1 ${g},${h}Z`; };
    const T = (x, y, size, fill, op, text, extra = '') => `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-size="${size.toFixed(2)}" fill="${fill}" fill-opacity="${op}" text-anchor="middle" dominant-baseline="central"${extra}>${text}</text>`;
    let svg = '';
    sky.sectors.forEach((sg, i) => {
      const a = sg.quick ? .55 : .28, up = sg.above ? 1 : .55;
      svg += `<path d="${arc(i * 30 + .4, i * 30 + 29.6, 44.4, 46.6)}" fill="${SECTORS[i].color}" fill-opacity="${(a * up).toFixed(2)}"/>`;
      if (sky.signs) { const [x, y] = P(i * 30 + 15, 48.4); svg += T(x, y, px(2.3, 11), '#fff', (.3 + .5 * a * up).toFixed(2), `${sky.signs[i].glyph}︎`); }
    });
    { const [x0, y0] = P(rise, 43.4), [x1, y1] = P(rise + 180, 43.4); svg += `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="#fff" stroke-opacity=".14" stroke-width="${px(.15, 1)}"/>`; }   // the horizon
    // the bodies: spread glyphs that would overlap, keep a tick at the true longitude
    const gap = Math.max(5.5, px(2.6, 15) * 2.1);
    const items = sky.bodies.map((b) => ({ b, at: b.lon })).sort((x, y) => x.at - y.at);
    for (let pass = 0; pass < 5; pass++) for (let i = 0; i < items.length; i++) { const n = items[(i + 1) % items.length]; const d = ((n.at - items[i].at) + 360) % 360; if (d < gap && items.length > 1) { const push = (gap - d) / 2; items[i].at -= push; n.at += push; } }
    for (const { b, at } of items) {
      const lum = b.name === 'Sun' || b.name === 'Moon', col = b.name === 'Sun' ? '#ffcf4a' : b.name === 'Moon' ? '#e4eaf4' : '#fff';
      const [tx, ty] = P(b.lon, 44.2), [tx2, ty2] = P(b.lon, 42.4), [x, y] = P(at, lum ? 39.2 : 40.2);
      svg += `<line x1="${tx}" y1="${ty}" x2="${tx2}" y2="${ty2}" stroke="${col}" stroke-opacity="${lum ? .95 : b.up ? .7 : .35}" stroke-width="${px(lum ? .35 : .2, lum ? 2 : 1)}"/>`;
      svg += T(x, y, lum ? px(4, 22) : px(2.4, 14), col, lum ? (b.up ? 1 : .8) : b.up ? .85 : .45, `${b.glyph}︎${b.retrograde && !lum ? '<tspan font-size="60%">r</tspan>' : ''}`);
      if (lum) { const [lx, ly] = P(at, 39.2 - px(3.4, 19)), label = sky.signs ? `${b.deg}° ${b.signGlyph}︎` : b.constellation;
        svg += T(lx, ly, px(1.9, 12), col, .92, label, ' font-weight="600"'); }
    }
    // the short line: Moon phase, and the Sun's next station (gold in its last quarter hour)
    const m = sky.moon, st = sky.stations && sky.stations.next, near = st && Date.parse(st.at) - Date.now() < 15 * 60e3;
    const fs = px(1.9, 13), y0 = 34 - fs * 1.2;
    if (m) svg += T(0, y0, fs, '#e4eaf4', .8, `☽︎ ${m.name} · ${Math.round(100 * m.illumination)}%`);
    if (st) svg += T(0, y0 + fs * 1.35, fs, near ? '#ffcf4a' : '#fff', near ? 1 : .72, LEX.t('station.next', { station: LEX.t('station.' + st.name), in: untilText(st.at), time: hhmm(st.at) }));
    el.innerHTML = svg;
  }
  // the Sun's four stations (sunrise, noon, sunset, midnight), whatever the modes: it marks each one, says so, and sounds
  const STATION = { last: null };
  function softTone(f, len = .9) {   // a soft sine tone through its own small audio context
    try { const ac = STATION.ac || (STATION.ac = new AudioContext()), o = ac.createOscillator(), g = ac.createGain(), t0 = ac.currentTime;
      o.frequency.value = f; o.type = 'sine'; g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(.07, t0 + .06); g.gain.exponentialRampToValueAtTime(.0001, t0 + len);
      o.connect(g).connect(ac.destination); o.start(t0); o.stop(t0 + len + .1); } catch {}
  }
  function stationFrame() {
    const LEX = lex();
    const r = COS.data && COS.data.sky && COS.data.sky.stations; if (!r || !r.last) return;
    if (STATION.last && r.last.at !== STATION.last && Date.now() - Date.parse(r.last.at) < 5 * 60e3) {
      const name = LEX.t('station.' + r.last.name), text = LEX.t('station.now', { station: name, time: hhmm(r.last.at) });
      say(text, 9000); cosmosEvent({ kind: 'station', text });
      softTone(392, 1.4); setTimeout(() => softTone(523, 1.8), 420);   // a soft rising fifth
    }
    STATION.last = r.last.at;
  }
  setInterval(() => { stationFrame(); if (COS.ring) drawSkyRing(); }, 20000);   // the countdown moves even between sky updates
  addEventListener('resize', () => { if (COS.ring) drawSkyRing(); });
  return { drawSkyRing, stationFrame };
}
