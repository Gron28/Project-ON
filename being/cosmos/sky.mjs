// being/cosmos/sky.mjs - the sky over the observer, now. Pure module (no DOM), so node --test can check it.
//
// Positions come from astronomy-engine (Don Cross, MIT): VSOP87 planets, a truncated ELP lunar theory, IAU 2000B nutation,
// aberration and light time; quoted accuracy about 1 arcminute against JPL Horizons (checked in tests/cosmos.test.mjs).
//   ecliptic     geocentric apparent longitude on the true ecliptic of date, from the March equinox point, also read as
//                twelve 30° sectors (being/cosmos/tables.mjs); the constellation each body is actually in (IAU boundaries)
//   horizon      topocentric altitude/azimuth from the observer's latitude and longitude, refracted near and above the horizon
//   points       the ecliptic's rising point (where it crosses the eastern horizon) and its culminating point (on the
//                meridian), from apparent sidereal time and the mean obliquity (nutation in obliquity, < 10", is left out)
//   moon         phase angle (Moon minus Sun in longitude), illuminated fraction, the next quarters
//   hours        temporal hours: day and night each split into 12 unequal hours between sunrise and sunset (upper limb,
//                refraction), as sundials kept them; each hour carries one of the seven bodies in turn (tables.mjs SEVEN),
//                the first hour of the day the one the weekday is named after
//   stations     the Sun's four daily stations: sunrise, solar noon, sunset, solar midnight
//   equinox      the last March equinox
import * as A from 'astronomy-engine';
import { SEVEN, WEEKDAY_BODY, BODY, SECTORS } from './tables.mjs';

const BODIES = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'];
const GLYPH = { Sun: '☉', Moon: '☽', Mercury: '☿', Venus: '♀', Mars: '♂', Jupiter: '♃', Saturn: '♄', Uranus: '♅', Neptune: '♆', Pluto: '♇', Node: '☊' };
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const norm = (x) => ((x % 360) + 360) % 360;
const DAY = 86400000;

/** ecliptic longitude -> { lon, sector, deg, min } (degrees and arcminutes within the 30° sector, rounded to the arcminute) */
export function ecliptic(lon) {
  const l = norm(lon), am = Math.round(l * 60) % 21600, i = Math.floor(am / 1800), deg = Math.floor((am % 1800) / 60), min = am % 60;
  return { lon: l, sector: i, deg, min };
}

// geocentric apparent longitude on the true ecliptic of date
function eclLon(body, time) {
  if (body === 'Sun') return A.SunPosition(time).elon;
  if (body === 'Moon') return A.EclipticGeoMoon(time).lon;
  return A.Ecliptic(A.GeoVector(A.Body[body], time, true)).elon;
}
// mean obliquity of the ecliptic, IAU 2006 (degrees)
function obliquity(time) {
  const T = time.tt / 36525;
  return (84381.406 - 46.836769 * T - 0.0001831 * T * T + 0.0020034 * T ** 3) / 3600;
}
// the mean lunar node (Meeus 47.7)
function meanNode(time) {
  const T = time.tt / 36525;
  return norm(125.0445479 - 1934.1362891 * T + 0.0020754 * T * T + T ** 3 / 467441);
}

/** the ecliptic's rising and culminating points (longitudes) for apparent sidereal time and the observer */
export function angles(time, lat, lon) {
  const ramc = norm(A.SiderealTime(time) * 15 + lon) * D2R, e = obliquity(time) * D2R, f = lat * D2R;
  const mc = norm(Math.atan2(Math.sin(ramc), Math.cos(ramc) * Math.cos(e)) * R2D);
  let asc = norm(Math.atan2(-Math.cos(ramc), Math.sin(e) * Math.tan(f) + Math.cos(e) * Math.sin(ramc)) * R2D);
  // of the two points where the ecliptic meets the horizon, take the one rising (in the east)
  const ra = Math.atan2(Math.sin(asc * D2R) * Math.cos(e), Math.cos(asc * D2R)), ha = ramc - ra;
  if (Math.sin(ha) > 0) asc = norm(asc + 180);
  return { rising: asc, culminating: mc, ramc: ramc * R2D, obliquity: e * R2D };
}

// pairs of bodies near a whole-number division of the circle apart in longitude (0°, 60°, 90°, 120°, 180°), within an orb
const ANGLES = [[0, 8], [60, 5], [90, 7], [120, 7], [180, 8]];
function separations(bodies) {
  const out = [];
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
    const a = bodies[i], b = bodies[j], sep = Math.abs(((a.lon - b.lon + 540) % 360) - 180);
    const lum = (a.name === 'Sun' || a.name === 'Moon' || b.name === 'Sun' || b.name === 'Moon') ? 2 : 0;
    for (const [angle, orb] of ANGLES) {
      const off = Math.abs(sep - angle);
      if (off <= orb + lum) {
        // applying when the separation is moving toward the exact angle
        const later = Math.abs(((a.lon + a.speed / 24 - b.lon - b.speed / 24 + 540) % 360) - 180);
        out.push({ a: a.name, b: b.name, angle, sep: +sep.toFixed(2), orb: +off.toFixed(2), closing: Math.abs(later - angle) < off });
      }
    }
  }
  return out.sort((x, y) => x.orb - y.orb);
}

const QUARTERS = ['New Moon', 'First Quarter', 'Full Moon', 'Last Quarter'];
function moon(time) {
  const phase = A.MoonPhase(time), ill = A.Illumination(A.Body.Moon, time);
  let mq = A.SearchMoonQuarter(time);
  const next = []; for (let i = 0; i < 4; i++) { next.push({ name: QUARTERS[mq.quarter], at: mq.time.date.toISOString() }); mq = A.NextMoonQuarter(mq); }
  // a named quarter when within 12 hours of it, otherwise the waxing/waning shape
  const nearest = Math.round(phase / 90) % 4, off = Math.abs(((phase - nearest * 90 + 540) % 360) - 180) / 12.19;   // ~12.19°/day
  const name = off < 0.5 ? QUARTERS[nearest] : phase < 90 ? 'Waxing Crescent' : phase < 180 ? 'Waxing Gibbous' : phase < 270 ? 'Waning Gibbous' : 'Waning Crescent';
  return { phase: +phase.toFixed(2), illumination: +ill.phase_fraction.toFixed(4), age: +(phase / 360 * 29.530589).toFixed(2), waxing: phase < 180, name, next };
}

// sunrise and sunset around a time: the last sunrise at or before it, the sunset after that, the sunrise after that
function sunDay(time, obs) {
  let rise = A.SearchRiseSet(A.Body.Sun, obs, +1, time.AddDays(-1.5), 2);
  let guard = 0;
  for (;;) {
    const nxt = rise && A.SearchRiseSet(A.Body.Sun, obs, +1, rise.AddDays(0.01), 2);
    if (!nxt || nxt.ut > time.ut || ++guard > 3) break;
    rise = nxt;
  }
  if (!rise || rise.ut > time.ut) return null;   // polar day or night
  const set = A.SearchRiseSet(A.Body.Sun, obs, -1, rise, 2), next = set && A.SearchRiseSet(A.Body.Sun, obs, +1, set, 2);
  return set && next ? { rise, set, next } : null;
}

/** the temporal hour now (and the 24 hours of this day), from sunrise and sunset at the observer */
export function temporalHours(time, lat, lon) {
  const obs = new A.Observer(lat, lon, 0), d = sunDay(time, obs);
  if (!d) return null;
  // the day begins at sunrise; its weekday is the local date at that sunrise (local mean solar time)
  const weekday = new Date(d.rise.date.getTime() + (lon / 15) * 3600000).getUTCDay();
  const dayBody = WEEKDAY_BODY[weekday], start = SEVEN.indexOf(dayBody);
  const dayLen = (d.set.ut - d.rise.ut) / 12, nightLen = (d.next.ut - d.set.ut) / 12;
  const hours = Array.from({ length: 24 }, (_, k) => {
    const from = k < 12 ? d.rise.ut + k * dayLen : d.set.ut + (k - 12) * nightLen, len = k < 12 ? dayLen : nightLen;
    return { n: k + 1, day: k < 12, body: SEVEN[(start + k) % 7], from: new A.AstroTime(from).date.toISOString(), to: new A.AstroTime(from + len).date.toISOString() };
  });
  const now = time.ut, k = now < d.set.ut ? Math.floor((now - d.rise.ut) / dayLen) : 12 + Math.floor((now - d.set.ut) / nightLen);
  const h = hours[Math.max(0, Math.min(23, k))];
  const from = Date.parse(h.from), to = Date.parse(h.to), t = time.date.getTime();
  return { weekday, dayBody, hour: h, progress: +((t - from) / (to - from)).toFixed(4), hours,
    sunrise: d.rise.date.toISOString(), sunset: d.set.date.toISOString(), nextSunrise: d.next.date.toISOString(),
    dayHourMinutes: +(dayLen * 1440).toFixed(1), nightHourMinutes: +(nightLen * 1440).toFixed(1) };
}

/** the Sun's four stations (sunrise, solar noon, sunset, solar midnight): the last and the next */
export function sunStations(time, lat, lon) {
  const obs = new A.Observer(lat, lon, 0), start = time.AddDays(-1.05), ev = [];
  const push = (name, t) => { if (t) ev.push({ name, at: t.date.toISOString(), ut: t.ut }); };
  for (let s = start, i = 0; i < 3; i++, s = s.AddDays(1)) {
    push('sunrise', A.SearchRiseSet(A.Body.Sun, obs, +1, s, 1));
    push('noon', A.SearchHourAngle(A.Body.Sun, obs, 0, s).time);
    push('sunset', A.SearchRiseSet(A.Body.Sun, obs, -1, s, 1));
    push('midnight', A.SearchHourAngle(A.Body.Sun, obs, 12, s).time);
  }
  const uniq = [...new Map(ev.map((e) => [e.name + Math.round(e.ut * 24), e])).values()].sort((a, b) => a.ut - b.ut);
  const last = [...uniq].reverse().find((e) => e.ut <= time.ut), next = uniq.find((e) => e.ut > time.ut);
  const clean = (e) => e && { name: e.name, at: e.at };
  return { last: clean(last), next: clean(next) };
}

/** the last March equinox at or before a time */
export function marchEquinox(time) {
  const y = time.date.getUTCFullYear(), find = (yy) => A.SearchSunLongitude(0, A.MakeTime(new Date(Date.UTC(yy, 2, 15))), 15);
  let eq = find(y); if (!eq || eq.ut > time.ut) eq = find(y - 1);
  return eq ? eq.date.toISOString() : null;
}

/**
 * The whole sky for a moment and a place.
 * @param {Date} date
 * @param {{lat:number, lon:number, elevation?:number}} place
 */
export function skyAt(date, place) {
  const time = A.MakeTime(date), { lat, lon } = place, obs = new A.Observer(lat, lon, place.elevation || 0);
  const ang = angles(time, lat, lon);
  const bodies = BODIES.map((name) => {
    const l = eclLon(name, time), l1 = eclLon(name, time.AddDays(0.5)), l0 = eclLon(name, time.AddDays(-0.5));
    const speed = ((l1 - l0 + 540) % 360) - 180;   // degrees per day
    const eq = A.Equator(A.Body[name], time, obs, true, true);
    // refraction only near and above the horizon: astronomy-engine's 'normal' model tapers it down to -90°, lifting a
    // body 40° below the horizon by ~0.3°, which no atmosphere does (Horizons applies none there either)
    let hor = A.Horizon(time, obs, eq.ra, eq.dec, null);
    if (hor.altitude > -1) hor = A.Horizon(time, obs, eq.ra, eq.dec, 'normal');
    const z = ecliptic(l);
    let rise = null, set = null;
    try { rise = A.SearchRiseSet(A.Body[name], obs, +1, time, 1.1)?.date.toISOString() ?? null; set = A.SearchRiseSet(A.Body[name], obs, -1, time, 1.1)?.date.toISOString() ?? null; } catch {}
    return { name, glyph: GLYPH[name], ...z, lon: +l.toFixed(4), speed: +speed.toFixed(4), retrograde: speed < 0,
      constellation: A.Constellation(eq.ra, eq.dec).name, alt: +hor.altitude.toFixed(2), az: +hor.azimuth.toFixed(2), up: hor.altitude > (name === 'Sun' || name === 'Moon' ? -0.83 : -0.57),
      ra: +eq.ra.toFixed(4), dec: +eq.dec.toFixed(3), dist: +eq.dist.toFixed(5), rise, set };
  });
  const nodeLon = meanNode(time), node = { name: 'Node', glyph: GLYPH.Node, ...ecliptic(nodeLon), lon: +nodeLon.toFixed(4) };   // the Moon's ascending node (mean)
  // which sectors are above the horizon now: the half of the ecliptic from the setting point through the culminating point to the rising point
  const above = SECTORS.map((_, i) => norm(i * 30 + 15 - ang.rising) >= 180);
  const seven = bodies.filter((b) => BODY[b.name]);
  // what the 'ecliptic' mode reads: materials and pace of the sectors the seven bodies stand in (the Sun and Moon double),
  // and of the rising sector (double)
  const balance = { Fire: 0, Earth: 0, Air: 0, Water: 0, quick: 0, slow: 0 };
  const add = (i, w) => { const s = SECTORS[i]; balance[s.element] += w; balance[s.quick ? 'quick' : 'slow'] += w; };
  for (const b of seven) add(b.sector, b.name === 'Sun' || b.name === 'Moon' ? 2 : 1);
  add(Math.floor(ang.rising / 30), 2);
  return {
    at: time.date.toISOString(), place: { lat, lon, elevation: place.elevation || 0, name: place.name || '' },
    bodies, node, rising: ecliptic(ang.rising), culminating: ecliptic(ang.culminating),
    obliquity: +ang.obliquity.toFixed(5),
    sectors: SECTORS.map((s, i) => ({ index: i, element: s.element, quick: s.quick, above: above[i], occupied: bodies.filter((b) => b.sector === i).map((b) => b.name) })),
    separations: separations(seven.concat(bodies.filter((b) => !BODY[b.name]))), balance,
    moon: moon(time), hours: temporalHours(time, lat, lon), stations: sunStations(time, lat, lon), equinox: marchEquinox(time),
  };
}

/** a plain line for the moment: Sun 200.7° in Virgo · Moon 240.0° in Libra */
export function skyLine(sky) {
  const b = (n) => sky.bodies.find((x) => x.name === n);
  return ['Sun', 'Moon'].map((n) => `${n} ${b(n).lon.toFixed(1)}° in ${b(n).constellation}`).join(' · ');
}

/**
 * The day's arcs (like a weather app's sun chart, for every body): over the observer's local day (midnight to midnight
 * on this machine's clock) each body's altitude every `step` minutes, its rise, culmination and set, and where it is now
 * (altitude and azimuth, refracted). Times are ISO strings; a body that does not rise or set that day has null there.
 */
export function dayArcs(date, place, step = 10) {
  const obs = new A.Observer(place.lat, place.lon, place.elevation || 0);
  const d0 = new Date(date); d0.setHours(0, 0, 0, 0); const day0 = d0.getTime(), t0 = A.MakeTime(d0);
  const names = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'];
  return { day0: d0.toISOString(), step, bodies: names.map((name) => {
    const body = A.Body[name];
    const hor = (t) => { const tt = A.MakeTime(new Date(t)), eq = A.Equator(body, tt, obs, true, true); return A.Horizon(tt, obs, eq.ra, eq.dec, 'normal'); };
    const samples = []; for (let m = 0; m <= 1440; m += step) samples.push(+hor(day0 + m * 60e3).altitude.toFixed(2));
    const iso = (t) => (t ? t.date.toISOString() : null), within = (t) => (t && t.date.getTime() - day0 < 864e5 ? t : null);
    const rise = within(A.SearchRiseSet(body, obs, +1, t0, 1)), set = within(A.SearchRiseSet(body, obs, -1, t0, 1));
    let tr = null; try { tr = A.SearchHourAngle(body, obs, 0, t0, +1); } catch {}
    const now = hor(date.getTime());
    return { name, samples, rise: iso(rise), set: iso(set), transit: tr && tr.time.date.getTime() - day0 < 864e5 ? tr.time.date.toISOString() : null,
      transitAlt: tr ? +tr.hor.altitude.toFixed(1) : null, alt: +now.altitude.toFixed(1), az: +now.azimuth.toFixed(1) };
  }) };
}
