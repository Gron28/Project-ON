// The sky (being/cosmos/): positions against NASA JPL Horizons, the ecliptic points, hours, stations, tables, modes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as A from 'astronomy-engine';
import { skyAt, angles, temporalHours, ecliptic, sunStations, marchEquinox, skyLine } from '../being/cosmos/sky.mjs';
import { SEVEN, SECTORS, BODY } from '../being/cosmos/tables.mjs';

const FX = JSON.parse(fs.readFileSync(new URL('./fixtures-horizons-2026-10-13.json', import.meta.url)));
const sep = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

test('positions agree with JPL Horizons (longitude within 1.2 arcmin, horizon within 0.05°)', () => {
  const sky = skyAt(new Date(FX.at), FX.site);
  for (const h of FX.bodies) {
    const b = sky.bodies.find((x) => x.name === h.body);
    assert.ok(sep(b.lon, h.lon) < 0.02, `${h.body} longitude ${b.lon} vs ${h.lon}`);
    assert.ok(sep(b.az, h.az) < 0.05 || h.alt < -80, `${h.body} azimuth ${b.az} vs ${h.az}`);
    // above the horizon: refracted; below it: geometric (Horizons' refracted mode adds a flat 0.65° down there)
    const ref = h.altAirless > -1 ? h.alt : h.altAirless;
    assert.ok(Math.abs(b.alt - ref) < 0.05, `${h.body} altitude ${b.alt} vs ${ref}`);
  }
});

test('the first quarter falls where Horizons has the Moon 90° from the Sun (2026-10-18 16:13:19 UT, within 2 min)', () => {
  const sky = skyAt(new Date('2026-10-13T05:00:00Z'), FX.site), fq = sky.moon.next.find((q) => q.name === 'First Quarter');
  // Horizons at 16:13:19.5 UT: Sun 205.30316°, Moon 295.30800° (difference 90.0048°, about 34 s of lunar motion)
  assert.ok(Math.abs(Date.parse(fq.at) - Date.parse('2026-10-18T16:13:19.5Z')) < 120000, fq.at);
});

test('the rising point of the ecliptic is on the eastern horizon, the culminating point on the meridian', () => {
  for (const [lat, lon, iso] of [[-34.6, -58.38, '2026-10-13T05:00:00Z'], [51.5, 0, '2026-03-20T12:00:00Z'], [10, 100, '2027-07-01T22:30:00Z']]) {
    const time = A.MakeTime(new Date(iso)), ang = angles(time, lat, lon), e = ang.obliquity * Math.PI / 180;
    const radec = (l) => { const r = l * Math.PI / 180; return { ra: Math.atan2(Math.sin(r) * Math.cos(e), Math.cos(r)) * 12 / Math.PI, dec: Math.asin(Math.sin(r) * Math.sin(e)) * 180 / Math.PI }; };
    const obs = new A.Observer(lat, lon, 0), a = radec(ang.rising), hA = A.Horizon(time, obs, (a.ra + 24) % 24, a.dec, null);
    assert.ok(Math.abs(hA.altitude) < 0.05, `rising point altitude ${hA.altitude}`);
    assert.ok(hA.azimuth > 0 && hA.azimuth < 180, `rising point in the east: ${hA.azimuth}`);
    const m = radec(ang.culminating), ha = (((A.SiderealTime(time) + lon / 15 - m.ra) % 24) + 36) % 24 - 12;
    assert.ok(Math.abs(ha) < 0.001, `culminating point hour angle ${ha}`);
  }
});

test('temporal hours: 24 contiguous hours from sunrise, the weekday’s body first, then the seven in turn', () => {
  const ph = temporalHours(A.MakeTime(new Date('2026-10-13T05:00:00Z')), -34.6037, -58.3816);
  assert.equal(ph.dayBody, 'Moon');   // the night of Monday 12 October (local) still belongs to Monday
  assert.equal(ph.hours[0].body, 'Moon');
  for (let k = 1; k < 24; k++) {
    assert.equal(ph.hours[k].from, ph.hours[k - 1].to);
    assert.equal(SEVEN.indexOf(ph.hours[k].body), (SEVEN.indexOf(ph.hours[k - 1].body) + 1) % 7);
  }
  assert.equal(ph.hour.n, 20); assert.equal(ph.hour.body, 'Venus');
  // sunrise and sunset agree with Open-Meteo for Buenos Aires (09:15 and 22:05 UT on 12 October 2026) within 2 minutes
  assert.ok(Math.abs(Date.parse(ph.sunrise) - Date.parse('2026-10-12T09:15:00Z')) < 120000, ph.sunrise);
  assert.ok(Math.abs(Date.parse(ph.sunset) - Date.parse('2026-10-12T22:05:00Z')) < 120000, ph.sunset);
});

test('the Sun\'s stations, the March equinox, sectors and the plain line', () => {
  const t = A.MakeTime(new Date('2026-10-13T05:00:00Z')), st = sunStations(t, -34.6037, -58.3816);
  assert.equal(st.last.name, 'midnight'); assert.equal(st.next.name, 'sunrise');
  assert.ok(Math.abs(Date.parse(st.next.at) - Date.parse('2026-10-13T09:14:00Z')) < 120000, st.next.at);   // Horizons: 09:14 UT
  // the 2026 March equinox: 2026-03-20 14:46 UT (USNO); before it, the 2025 one
  assert.ok(Math.abs(Date.parse(marchEquinox(t)) - Date.parse('2026-03-20T14:46:00Z')) < 120000);
  assert.ok(marchEquinox(A.MakeTime(new Date('2026-03-19T00:00:00Z'))).startsWith('2025-03-20'));
  assert.equal(SECTORS.length, 12); assert.deepEqual(SECTORS.map((x) => x.quick), [true, false, true, false, true, false, true, false, true, false, true, false]);
  assert.deepEqual(ecliptic(359.999), { lon: 359.999, sector: 0, deg: 0, min: 0 });   // rounded to the arcminute, carried over
  const sky = skyAt(new Date('2026-10-13T05:00:00Z'), FX.site);
  assert.deepEqual(sky.bodies.map((b) => b.glyph).join(''), '☉☽☿♀♂♃♄♅♆♇');
  assert.equal(sky.bodies[0].constellation, 'Virgo');   // the Sun at 200° stands in Virgo until 31 October (IAU boundaries)
  assert.match(skyLine(sky), /^Sun 19\d\.\d° in Virgo · Moon \d+\.\d° in \w+$/);
  for (const p of Object.values(BODY)) assert.ok(p.metal && p.color[1].startsWith('#'));
});

import { alignTargets, alignEvents } from '../being/cosmos/align.mjs';
import { createMonitor, chiUpper, scaleColor, trialsFromBytes, band } from '../being/cosmos/rng.mjs';
import { METAL_RGB } from '../being/cosmos/tables.mjs';

test('modes: off does nothing; the hour of Venus lends emerald light and copper; the ecliptic stains and leans', () => {
  const sky = skyAt(new Date(FX.at), FX.site), c = { sky };
  const none = alignTargets(c, {});
  assert.equal(none.light, null); assert.equal(none.metal, null); assert.equal(none.flow, 1);
  const h = alignTargets(c, { hours: true });
  assert.deepEqual(h.metal.rgb, METAL_RGB.copper);
  assert.ok(h.light.rgb[1] > h.light.rgb[0], 'emerald leans green');
  const hv = alignTargets(c, { heavens: true });
  assert.ok(hv.stains && hv.mat.some((x) => x > 0));
  const prev = {};
  assert.deepEqual(alignEvents(prev, { sky, space: { flareAt: 'a', flare: 'M1' } }, { space: true }), []);   // the first look only remembers the last flare
  assert.deepEqual(alignEvents(prev, { sky, space: { flareAt: 'b', flare: 'X2' } }, { space: true }).map((e) => e.kind), ['flare']);
});

test('the randomness monitor: chi-square tail, colour scale, bands, and an index that is uniform under randomness', () => {
  assert.ok(Math.abs(chiUpper(3600, 3600) - 0.5) < 0.01);
  assert.ok(chiUpper(4000, 3600) < 0.001 && chiUpper(3200, 3600) > 0.999);
  assert.deepEqual(scaleColor(0.5).map((x) => +x.toFixed(2)), [0.39, 0.98, 0.39]);   // the ordinary green
  assert.deepEqual([null, 0.01, 0.07, 0.2, 0.5, 0.92, 0.99].map(band), [0, 1, 2, 3, 4, 5, 6]);
  let seed = 12345; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed >>> 24; };
  let low = 0, high = 0; const N = 200;
  for (let r = 0; r < N; r++) { const e = createMonitor(); e.add(trialsFromBytes(Uint8Array.from({ length: 25 * 3600 }, rnd)), 'local'); const i = e.read().index; if (i < 0.05) low++; if (i > 0.95) high++; }
  assert.ok(low / N < 0.12 && high / N < 0.12, `tails ${low / N} ${high / N}`);
  const e = createMonitor(); e.add([100, 100], 'quantum'); assert.equal(e.read().index, null); assert.equal(e.read().quantumShare, 1);
});

// the day's arcs: the Sun over Buenos Aires on 2026-10-13 rises and sets where JPL Horizons has it (09:14 and 22:07 UT,
// true visual horizon, to the minute), culminates near solar noon, and its altitude curve passes through the horizon there
test('day arcs: Sun rise and set agree with JPL Horizons, the curve crosses the horizon at them', async () => {
  const { dayArcs } = await import('../being/cosmos/sky.mjs');
  const a = dayArcs(new Date('2026-10-13T18:00:00Z'), { lat: -34.6037, lon: -58.3816 });
  const sun = a.bodies.find((b) => b.name === 'Sun');
  const mins = (iso, hm) => Math.abs((Date.parse(iso) - Date.parse(`2026-10-13T${hm}:00Z`)) / 60000);
  assert.ok(mins(sun.rise, '09:14') <= 1.5, `rise ${sun.rise}`);
  assert.ok(mins(sun.set, '22:07') <= 1.5, `set ${sun.set}`);
  assert.ok(sun.transitAlt > 60 && sun.transitAlt < 70, `noon altitude ${sun.transitAlt}`);
  assert.equal(a.bodies.length, 10); assert.equal(sun.samples.length, 145);
  assert.ok(Math.max(...sun.samples) > 60 && Math.min(...sun.samples) < -40, 'a full day: high at noon, deep at midnight');
});
