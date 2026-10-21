export const ARCHETYPES = ['flowing', 'pulse', 'static', 'fractured', 'intricate', 'drift', 'heavy', 'ethereal', 'swarm', 'crystalline', 'molten', 'void']
export const PATTERNS = ['cells', 'coral', 'worms', 'spots', 'waves', 'static', 'none']

/* The analysis decides what is plausible, the model chooses among it and adds the creative layer.
   A 0.5B model cannot judge music reliably on its own (it called rap "drift"), but it is good at picking
   among sensible options and at colour and words. Each archetype gets a score from the measured character
   and moods; the grammar only allows the best few, so every answer is sensible and a dislike can exclude the
   previous choice outright. */
const v = (x, d = .5) => (Number.isFinite(x) ? x : d)
export function rankArchetypes(c = {}) {
  const k = c.character || {}, m = Object.fromEntries(c.moods || []), u = v(c.unknown, 0), nov = v(c.species?.novelty, 0)
  const L = v(k.loudness), N = v(k.noisiness), R = v(k.roughness), T = v(k.tonality), H = v(k.harmony), G = v(k.regularity)
  const D = v(k.density), I = v(k.intricacy), B = v(k.brightness), W = v(k.bassWeight), V = Math.max(v(k.vocal, 0), v(c.voice, 0) * .8), C = v(k.change)
  const calm = 1 - L * .6 - D * .4, agg = v(m.aggressive, R)
  const s = {
    flowing: T * .5 + (1 - N) * .3 + (1 - G) * .2 + H * .2 - R * .4,
    pulse: G * .7 + v(c.dance, G) * .4 + D * .2 - (1 - L) * .2,
    static: N * .8 + D * .2 - T * .3,
    fractured: R * .7 + agg * .4 + C * .2 - T * .2,
    intricate: I * .5 + H * .4 + D * .3 + C * .2,
    drift: calm * .6 + (1 - G) * .3 + (1 - D) * .3 - R * .3,
    heavy: W * .7 + L * .3 + G * .1 - B * .3,
    ethereal: V * .4 + B * .3 + (1 - W) * .3 + T * .2 - R * .3,
    swarm: D * .6 + N * .3 + C * .3 + (1 - G) * .2,
    crystalline: T * .5 + B * .4 + (1 - N) * .3 - W * .2,
    molten: (1 - B) * .4 + W * .3 + T * .2 + (1 - D) * .2 + calm * .2,
    void: (1 - L) * .7 + (1 - D) * .3 - V * .2
  }
  // experimental music: widen the field, so stranger forms come into reach
  if (u + nov > .8) { s.swarm += .15; s.fractured += .1; s.void += .1; s.crystalline += .1 }
  return Object.entries(s).sort((a, b) => b[1] - a[1])   // [[name, score], ...], best first
}
export function rankPatterns(c = {}) {
  const k = c.character || {}
  const N = v(k.noisiness), R = v(k.roughness), T = v(k.tonality), G = v(k.regularity), D = v(k.density), I = v(k.intricacy), L = v(k.loudness)
  const s = { cells: G * .5 + D * .3, coral: I * .5 + T * .3, worms: I * .4 + (1 - G) * .3 + R * .2, spots: G * .3 + (1 - D) * .3 + T * .2, waves: T * .5 + (1 - D) * .3, static: N * .8 + R * .2, none: (1 - L) * .6 }
  return Object.entries(s).sort((a, b) => b[1] - a[1])   // [[name, score], ...], best first
}
// the options the grammar allows for this call: the best few, minus the previous ones after a dislike
export function options(c = {}) {
  const disliked = c.feedback?.recent === 'dislike', p = c.previous || {}
  // the options close to the best score (at least 2, at most n): a clearly rhythmic track cannot wander to a weak third choice
  const pick = (ranked, prev, n) => {
    const list = disliked && prev ? ranked.filter(e => e[0] !== prev) : ranked, best = list[0][1]
    return list.filter((e, i) => i < 2 || (i < n && e[1] > best - .12)).map(e => e[0])
  }
  return { archetypes: pick(rankArchetypes(c), p.archetype, 3), patterns: pick(rankPatterns(c), p.skin?.pattern, 3) }
}

// words, not numbers: a tiny model picks meaningful words well but defaults to the first number it is offered
export const ENERGY = ['much calmer', 'calmer', 'as it is', 'wilder', 'much wilder']
export const COLOURS = { violet: .78, indigo: .68, blue: .6, cyan: .5, teal: .45, green: .33, gold: .14, amber: .09, orange: .06, red: 0, crimson: .97, magenta: .87, silver: .6 }
export const WARMTH = ['icy', 'cool', 'neutral', 'warm', 'burning']
export const CHAOS = ['serene', 'restless', 'turbulent', 'violent']
export function schemaFor(opt) {
  return {
    type: 'object',
    properties: {
      archetype: { enum: opt.archetypes }, pattern: { enum: opt.patterns },
      energy: { enum: ENERGY }, colour: { enum: Object.keys(COLOURS) }, warmth: { enum: WARMTH }, chaos: { enum: CHAOS }
    }
  }
}

export const SYSTEM = `You are the inner mind of an etheric astral alien: liquid metal drifting around a core of light. You feel the music and choose how to manifest. Reply with JSON only.
Choose archetype and pattern from the allowed values, energy compared with the music (much calmer .. much wilder), a colour, warmth (icy .. burning) and chaos (serene .. violent) that fit the music. Strange or experimental music deserves strange choices.`

const r = x => (Number.isFinite(x) ? Math.round(x * 10) / 10 : 0)
export function buildUserPrompt(c = {}, opt = options(c)) {
  const lines = []
  if (c.title) lines.push(`Playing: ${String(c.title).slice(0, 70)}`)
  const top = (a, n) => (a || []).slice(0, n).map(([l, p]) => `${String(l).split('---').pop()} ${r(p)}`).join(', ')
  if (c.styles?.length) lines.push(`Sounds like: ${top(c.styles, 3)}`)
  if (c.moods?.length) lines.push(`Mood: ${top(c.moods, 3)}`)
  if (c.character) {
    const k = c.character, w = []
    const say = (x, hi, lo) => { if (x > .65) w.push(hi); else if (x < .3 && lo) w.push(lo) }
    say(k.loudness, 'loud', 'quiet'); say(k.noisiness, 'noisy'); say(k.roughness, 'harsh'); say(k.tonality, 'melodic', 'atonal')
    say(k.harmony, 'rich harmony'); say(k.regularity, 'steady beat', 'free rhythm'); say(k.density, 'dense', 'sparse')
    say(k.intricacy, 'intricate'); say(k.brightness, 'bright', 'dark'); say(k.bassWeight, 'heavy bass'); say(k.vocal, 'vocal')
    if ((c.unknown || 0) > .5 || (c.species?.novelty || 0) > .6) w.push('strange, unclassifiable')
    if (w.length) lines.push(`Feels: ${w.join(', ')}`)
  }
  const f = c.feedback
  if (f?.recent === 'dislike') lines.push('The listener disliked your last choice: change clearly.')
  else if (f?.recent === 'like') lines.push('The listener loved your last choice: keep its spirit.')
  lines.push(`Allowed archetypes: ${opt.archetypes.join(', ')}. Allowed patterns: ${opt.patterns.join(', ')}.`)
  return lines.join('\n')
}

const idx = (list, x, d) => { const i = list.indexOf(x); return i < 0 ? d : i / (list.length - 1) }   // a word to 0..1 along its list
// the renderer's decision shape (kept from before), filled from the compact answer
export function sanitize(d, opt) {
  const ch = idx(CHAOS, d.chaos, .3), en = idx(ENERGY, d.energy, .5) * 2 - 1
  return {
    archetype: (opt?.archetypes || ARCHETYPES).includes(d.archetype) ? d.archetype : (opt?.archetypes?.[0] || 'drift'),
    energy: en,
    palette: { hue: COLOURS[d.colour] ?? .6, saturation: d.colour === 'silver' ? .15 : .55 + ch * .35, warmth: idx(WARMTH, d.warmth, .5) * 2 - 1 },
    skin: { pattern: PATTERNS.includes(d.pattern) ? d.pattern : (opt?.patterns?.[0] || 'none'), growth: .35 + (en + 1) * .3, speed: .3 + ch * .6, contrast: .4 + ch * .5 },
    motion: { orbit: .3 + (en + 1) * .25, turbulence: ch, gravity: .5, chaos: ch }
  }
}

export function seedFor(c = {}) {
  const key = c.title || (c.genres?.[0]?.[0] ?? '') + (c.styles?.[0]?.[0] ?? '')
  let h = 2166136261
  for (const ch of String(key)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) }
  return (h >>> 0) % 2147483647
}
