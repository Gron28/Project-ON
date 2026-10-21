// being/cosmos/align.mjs - how the sky modes lend the body something. Pure module (no DOM).
//
// An artistic mapping, not a measurement: each mode lends the body something it already has (its light, its metal, its
// stains, what it is made of, how fast its time runs, its inner light, its film) and never touches the mind, which
// still only hears the music. All modes are off by default; each is a weight the page eases toward.
//   hours    the temporal hour's body (being/cosmos/tables.mjs) lends its material (being/materials.mjs), its colour as
//            light and its metal (lead, tin, iron, gold, copper, quicksilver, silver); the day's body tempers it in its
//            second colour. At the Sun's four stations it marks the moment (a star and a surfacing).
//   heavens  the materials of the sectors the seven bodies stand in, in their proportions, become its materials; the
//            sectors of the Sun, the Moon and the rising point stain its skin (membrane, nucleus, cytoplasm); quick or
//            slow sectors quicken or slow its time.
//   moon     its inner light waxes and wanes with the Moon's illuminated fraction, and it turns to silver as she fills
//   rng      the randomness monitor (being/cosmos/rng.mjs) colours its light, more strongly as the index leaves the
//            ordinary range (below 0.10 or above 0.90)
//   space    the planetary K index brings aurora into its light and film; a solar flare (GOES X-ray jump to M or X) flashes;
//            solar wind speed quickens its time
import { BODY, SECTORS, METAL_RGB, hexRgb } from './tables.mjs';
import { ELEMENT_ID, PLANET_ID, SECTOR_ID, N as N_MAT } from '../materials.mjs';

export const MODES = ['hours', 'heavens', 'moon', 'rng', 'space'];
const mix = (a, b, u) => a.map((v, i) => v + (b[i] - v) * u);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const AURORA = [0.25, 1, 0.65];

/**
 * @param {object} c   the cosmos broadcast: { sky, space, rng }
 * @param {object} on  enabled modes: { hours, heavens, ... }
 * @returns targets: { light: {rgb, w} | null, metal: {rgb, w} | null, stains: {mem, nuc, cyto, w} | null,
 *   mat: number[29] (affinity added to each material, being/materials.mjs), flow, core, glow, env, film, reasons: string[] }
 */
export function alignTargets(c, on) {
  const t = { light: null, metal: null, stains: null, mat: new Array(N_MAT).fill(0), flow: 1, core: 1, glow: 1, env: 1, film: 0, reasons: [] };
  const lights = [];
  const sky = c && c.sky;
  if (on.hours && sky && sky.hours) {
    const h = BODY[sky.hours.hour.body], d = BODY[sky.hours.dayBody];
    lights.push({ rgb: mix(hexRgb(h.color[1]), hexRgb(d.color2[1]), 0.3), w: 0.8 });
    t.metal = { rgb: METAL_RGB[h.metal], w: 0.85 };
    t.mat[PLANET_ID[sky.hours.hour.body]] += 0.55; t.mat[PLANET_ID[sky.hours.dayBody]] += 0.2;   // made of the hour's body, a little of the day's
    t.reasons.push(`${h.metal} hour (${sky.hours.hour.body}): ${h.color[0]} light`);
  }
  if (on.heavens && sky) {
    const sun = sky.bodies.find((b) => b.name === 'Sun'), moon = sky.bodies.find((b) => b.name === 'Moon');
    t.stains = { mem: hexRgb(SECTORS[sun.sector].color), nuc: hexRgb(SECTORS[moon.sector].color), cyto: hexRgb(SECTORS[sky.rising.sector].color), w: 0.7 };
    const bal = sky.balance, els = ['Fire', 'Water', 'Air', 'Earth'], total = els.reduce((a, e) => a + bal[e], 0) || 1;
    const top = els.reduce((a, e) => (bal[e] > bal[a] ? e : a), 'Fire');
    for (const e of els) t.mat[ELEMENT_ID[e]] += 0.65 * bal[e] / total;   // the elemental materials in the proportions of the sky
    t.mat[SECTOR_ID[sun.sector]] += 0.45;
    t.mat[SECTOR_ID[moon.sector]] += 0.35;
    t.mat[SECTOR_ID[sky.rising.sector]] += 0.25;
    t.flow *= 1 + 0.25 * ((bal.quick - bal.slow) / Math.max(1, bal.quick + bal.slow));
    t.reasons.push(`Sun ${sun.lon.toFixed(0)}°, Moon ${moon.lon.toFixed(0)}°; ${top.toLowerCase()} leads, ${bal.quick >= bal.slow ? 'quick' : 'slow'}`);
  }

  if (on.moon && sky && sky.moon) {
    const f = sky.moon.illumination;
    t.core *= 0.55 + 0.9 * f; t.glow *= 0.85 + 0.3 * f;
    t.mat[PLANET_ID.Moon] += 0.45 * f;   // the fuller the Moon, the more of it is silver
    if (f > 0.97) lights.push({ rgb: hexRgb(BODY.Moon.color2[1]), w: 0.35 });
    t.reasons.push(`${sky.moon.name}, ${Math.round(100 * f)}% lit`);
  }
  if (on.rng && c.rng && Number.isFinite(c.rng.index)) {
    const x = c.rng.index, extreme = clamp01(Math.max(0.1 - x, x - 0.9) / 0.1);
    lights.push({ rgb: c.rng.rgb, w: 0.3 + 0.6 * extreme });
    t.reasons.push(`randomness ${Math.round(100 * x)}%`);
  }
  if (on.space && c.space) {
    const s = c.space, kp = s.kp ?? 0, storm = clamp01((kp - 3) / 5);
    if (storm > 0) lights.push({ rgb: AURORA, w: 0.6 * storm });
    t.film = Math.max(t.film, 0.7 * storm);
    if (Number.isFinite(s.windSpeed)) t.flow *= 1 + clamp01((s.windSpeed - 400) / 600) * 0.3;
    t.reasons.push(`Kp ${kp}${s.flare ? `, ${s.flare} flare` : ''}`);
  }
  if (lights.length) {
    // weighted blend; the strongest wins most, and the total weight is how much it overrides the being's own light
    const sw = lights.reduce((a, l) => a + l.w, 0);
    const rgb = lights.reduce((a, l) => a.map((v, i) => v + l.rgb[i] * l.w / sw), [0, 0, 0]);
    t.light = { rgb, w: Math.min(0.9, Math.max(...lights.map((l) => l.w))) };
  }
  return t;
}

/** discrete moments to answer: solar flares, as { kind, text } since the last check (the Sun's stations: the page's stationFrame) */
export function alignEvents(prev, c, on) {
  const ev = [];
  const f = c && c.space && c.space.flareAt;
  if (on.space && f && prev.flare !== f) { if (prev.flare) ev.push({ kind: 'flare', text: `a ${c.space.flare} solar flare` }); prev.flare = f; }
  return ev;
}
