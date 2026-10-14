// being/lexicon.mjs - the words ON shows, in one place. The plain set is here; a local set (being/local/lexicon.mjs,
// not part of the repository) can name the same things differently and add readings of the sky (its enrich()).
// When the local set is present a switch chooses between them (settings.lexicon: 'plain' | 'local').
//   t(key, vars)   the word for a key, '{name}' filled from vars
//   enrich(sky)    the sky as the chosen set reads it (plain: unchanged)
export const PLAIN = {
  'menu.sky': 'Sky', 'menu.ring': 'Show the sky around it', 'menu.chart': 'Sky chart…', 'menu.names': 'Original names',
  'mode.hours': 'Temporal hours (the hour’s metal and colour)', 'mode.heavens': 'Where the Sun and Moon stand', 'mode.moon': 'Moon phase',
  'mode.rng': 'Randomness monitor (quantum random numbers)', 'mode.space': 'Space weather (Sun, Kp, flares)',
  'menu.breathe': 'Paced breathing', 'menu.work': 'Work cycle (3 h)', 'menu.work.on': 'Work cycle: stop · {left} min left',
  'menu.body': 'Body activation (5 rounds)', 'menu.body.on': 'Body activation: stop',
  'station.sunrise': 'Sunrise', 'station.noon': 'Solar noon', 'station.sunset': 'Sunset', 'station.midnight': 'Solar midnight',
  'station.now': '{station} · {time}', 'station.next': '{station} in {in}',
  'cal.work': 'Work', 'cal.body': 'Body', 'cal.breath': 'Breath', 'cal.listen': 'Listening',
  'panel.breathe': 'Paced breathing', 'panel.sky': 'Sky',
  'sky.stationTitle': 'Next station of the Sun', 'sky.hourTitle': 'Temporal hour', 'sky.hoursTitle': 'Temporal hours',
  'sky.day': '{glyph} {body}’s day ({metal})', 'sky.pairsTitle': 'Angles between them',
  'sky.wheelTitle': 'The ecliptic, oriented to your horizon',
  'sky.wheelSrc': 'The Sun’s yearly path in 30° sectors from the March equinox point, turned so the point rising in the east is at the left: the upper half is the sky above you. Lines join bodies 60°, 90°, 120° or 180° apart.',
  'sky.hoursSrc': 'Day and night each split into twelve unequal hours, as sundials kept them. Each hour carries one of the seven bodies in turn (slowest to fastest: ♄ ♃ ♂ ☉ ♀ ☿ ☽), starting each day with the one the weekday is named after; the “hours” sky mode lends ON that body’s metal and colour.',
  'rng.0': 'gathering', 'rng.1': 'significantly large variance', 'rng.2': 'strongly increased variance', 'rng.3': 'slightly increased variance',
  'rng.4': 'ordinary variance, as chance expects', 'rng.5': 'small variance', 'rng.6': 'significantly small variance',
};

let LOCAL = null;
try { LOCAL = await import('./local/lexicon.mjs'); } catch {}
export const hasLocal = !!LOCAL;
export const renamed = (LOCAL && LOCAL.RENAMED) || {};   // settings saved under the local set's older names: { 'old.path': 'new.path' }

const fill = (s, v) => (typeof s === 'function' ? s(v || {}) : v ? s.replace(/\{(\w+)\}/g, (m, k) => (v[k] ?? m)) : s);   // a local word may be a function of vars
/** the words for a mode ('plain' or 'local'; 'local' falls back to plain when there is no local set) */
export function lexicon(mode = 'plain') {
  const local = mode === 'local' && LOCAL;
  return {
    mode: local ? 'local' : 'plain', hasLocal,
    t: (key, vars) => fill((local ? LOCAL.WORDS[key] : undefined) ?? PLAIN[key] ?? key, vars),
    enrich: (sky) => (local && sky ? LOCAL.enrich(sky) : sky),
    line: (sky) => (local ? LOCAL.dateLine(sky) : null),
  };
}
