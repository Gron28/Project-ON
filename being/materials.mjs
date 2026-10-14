// being/materials.mjs - what the being is made of, moment to moment. Pure module (no DOM), stepped once per frame.
//
// Seventeen materials compete for the body: the original six, the four elements and seven metals (each named after
// the body long paired with it: Saturn lead, Jupiter tin, Mars iron, Sun gold, Venus copper, Mercury quicksilver, Moon
// silver). Each has an affinity computed from the mind's state (arousal, valence, groove, dopamine, chills) and the
// analyzer's absolute character of the music (brightness, roughness, bass weight, density, ...), the way the original six
// already were. The elements are warm or cool, dry or wet: fire hot and driven, air bright and light, water slow and
// soft, earth heavy and dark. The metals: lead slow and grave, tin expansive and glad, iron hot and rough, gold the
// climax, copper sweet and consonant, quicksilver quick and intricate, silver dreamy and nocturnal.
//
// Dynamics: soft mutual inhibition (Lotka-Volterra competition with beta < 1, so two to four materials coexist) and
// habituation (a material that has been shown a while loses affinity and recovers in the background), with noise. At the
// music's moments (a section, the drop, chills) it changes faster. The four strongest are shown at once, each in its
// own territories on the body (the page's shader marbles them), and a material entering a slot only replaces one that
// has faded, so nothing pops.

export const MATERIALS = [
  'liquid metal', 'glass', 'velvet flesh', 'obsidian', 'iridescent', 'fluorescent',
  'fire', 'water', 'air', 'earth',
  'saturn · lead', 'jupiter · tin', 'mars · iron', 'sun · gold', 'venus · copper', 'mercury · quicksilver', 'moon · silver',
];
export const ELEMENT_ID = { Fire: 6, Water: 7, Air: 8, Earth: 9 };
export const PLANET_ID = { Saturn: 10, Jupiter: 11, Mars: 12, Sun: 13, Venus: 14, Mercury: 15, Moon: 16 };
export const N = MATERIALS.length;
export const SLOTS = 4;

const c01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const v = (x, d = 0.5) => (Number.isFinite(x) ? x : d);

/**
 * Each material's affinity for this moment.
 * @param {object} m   the mind (arousal 0..1, valence -1..1, groove, lock, energy, daPhasic, daAnticipation, daTonic, pulseHz, surprise)
 * @param {object} ch  the music's absolute character (0..1 each: loudness, noisiness, roughness, tonality, harmony,
 *                     regularity, density, intricacy, brightness, bassWeight, vocal, change, tempo)
 * @param {object} x   extras: { chill 0..1, familiarity 0..1 }
 */
export function affinities(m, ch = {}, x = {}) {
  const A = c01(v(m.arousal, 0.3)), V = Math.max(-1, Math.min(1, v(m.valence, 0))), G = c01(v(m.groove, 0)), L = c01(v(m.lock, 0));
  const Dp = Math.max(0, v(m.daPhasic, 0)), Da = c01(v(m.daAnticipation, 0)), E = c01(v(m.energy, 0.5));
  const chill = c01(v(x.chill, 0)), fam = c01(v(x.familiarity, 0.5));
  const k = (key) => c01(v(ch[key]));
  const bright = k('brightness'), rough = k('roughness'), bass = k('bassWeight'), dens = k('density'), intr = k('intricacy');
  const tonal = k('tonality'), harm = k('harmony'), reg = k('regularity'), loud = k('loudness'), noise = k('noisiness');
  const vocal = k('vocal'), change = k('change'), tempo = c01(v(m.pulseHz, 2) / 3.2) * 0.5 + k('tempo') * 0.5;
  const pos = Math.max(0, V), neg = Math.max(0, -V), calm = 1 - A;
  return [
    0.45 + 0.2 * G,                                                          // liquid metal: home
    0.45 * calm + 0.3 * pos + 0.3 * tonal,                                   // glass
    0.4 * pos + 0.35 * (1 - bright) + 0.2 * calm,                            // velvet flesh
    0.5 * neg + 0.35 * rough + 0.25 * bass,                                  // obsidian
    0.5 * chill + 0.3 * (1 - fam) + 0.3 * bright,                            // iridescent
    0.12 + 0.35 * A + 0.3 * G + 0.4 * Da,                                    // fluorescent
    0.8 * A * (0.1 + 0.65 * rough + 0.35 * noise + 0.2 * bright) + 0.2 * Dp * rough + 0.1 * E * A,   // fire: choleric, hot and dry: needs heat (harsh, noisy sound), not mere loudness
    0.55 * calm * (0.5 + 0.5 * tonal) + 0.3 * neg * calm + 0.25 * (1 - reg), // water: phlegmatic, cold and moist, flowing
    0.55 * bright * (1 - dens) + 0.3 * pos * (1 - bass) + 0.25 * vocal,      // air: sanguine, light, high, sparse
    0.6 * bass * (0.5 + 0.5 * reg) + 0.3 * dens * (1 - bright) + 0.2 * G,    // earth: melancholic, heavy, steady
    0.5 * (1 - tempo) * (1 - bright) + 0.35 * neg + 0.2 * bass * calm,       // Saturn: slow, dark, grave
    0.45 * harm * (0.5 + 0.5 * pos) + 0.3 * A * dens + 0.2 * pos,            // Jupiter: expansive, majestic, glad
    0.6 * rough * A + 0.35 * noise * A + 0.25 * neg * A,                     // Mars: hot, rough, aggressive
    0.55 * Dp + 0.5 * chill + 0.3 * pos * loud + 0.2 * bright * A,           // the Sun: the climax, radiance
    0.5 * pos * (0.4 + 0.6 * tonal) + 0.3 * harm + 0.25 * G * (1 - rough),   // Venus: sweet, consonant, sensual
    0.5 * intr + 0.4 * tempo * dens + 0.3 * change,                          // Mercury: quick, intricate, changeable
    0.5 * calm * (1 - bright) + 0.3 * vocal * calm + 0.25 * tonal * (1 - dens), // the Moon: dreamy, nocturnal, reflective
  ];
}

/** a material mix: step it with affinities; read the four shown materials and their weights */
export function createMaterials(rand = Math.random) {
  const x = new Float32Array(N), h = new Float32Array(N), shown = new Float32Array(N);
  x[0] = 1; shown[0] = 1;
  const slots = [0, -1, -1, -1];
  let fast = 0;   // > 0 for a few seconds after a moment
  const st = {
    x, h, shown, slots,
    /** the music's moments (a section, the drop, chills) open it to change for a few seconds */
    moment(strength = 1) { fast = Math.max(fast, Math.min(1, strength)); },
    /**
     * @param {number} dt seconds
     * @param {number[]} aff affinities (see affinities()), plus any outside leaning already added
     * @param {{ force?: number, dna?: number[] }} o force: one material only (lab); dna: the being's own small preferences
     */
    step(dt, aff, o = {}) {
      dt = Math.min(0.1, Math.max(0, dt || 0));
      fast = Math.max(0, fast - dt / 6);
      const tau = 7 - 5 * fast;   // seconds: slow between moments, quick at them
      let sum = 0; for (let i = 0; i < N; i++) sum += x[i];
      for (let i = 0; i < N; i++) {
        const a = aff[i] + (o.dna ? o.dna[i] || 0 : 0) - 0.6 * h[i];
        x[i] = Math.max(0, x[i] + (dt / tau) * (a - x[i] - 0.35 * (sum - x[i]) + 0.25 * (rand() - 0.5)));
        // habituation: builds while it leads (about a minute to tire), recovers in the background (a few minutes)
        h[i] = Math.min(0.8, Math.max(0, h[i] + dt * (shown[i] > 0.3 ? 0.02 * shown[i] : -0.004)));
      }
      // targets: the strongest few, sharpened (power) so a clear leader stays clear and weak ones fall away
      const order = Array.from({ length: N }, (_, i) => i).sort((a, b) => x[b] - x[a]);
      const target = new Float32Array(N);
      if (Number.isInteger(o.force) && o.force >= 0 && o.force < N) target[o.force] = 1;
      else {
        let t = 0; for (let r = 0; r < SLOTS; r++) { const i = order[r]; target[i] = Math.pow(Math.max(0, x[i]), 3); t += target[i]; }
        // when nothing is strongly wanted, what is left goes home to liquid metal (weak wants are not spread evenly)
        const floor = 0.125, d = Math.max(t, floor);
        for (let i = 0; i < N; i++) target[i] /= d;
        target[0] += Math.max(0, floor - t) / floor;
        for (let i = 0; i < N; i++) if (target[i] < 0.08) target[i] = 0;   // a trace is noise, not a feeling
      }
      // slots: an outsider that wants in replaces a slot whose material has faded; that fading is asked for here
      const inSlot = (i) => slots.includes(i);
      const wanting = order.filter((i) => target[i] > 0 && !inSlot(i));
      for (const i of wanting) {
        // a slot is free only once its material is truly gone: the shader mixes slots by relative weight, so a material at
        // 0.02 can still be plainly visible, and swapping it then changed the colour in one frame
        let free = slots.findIndex((s) => s < 0 || shown[s] < 0.0025);
        if (free < 0) {   // ask the weakest slot whose target is lower to fade out
          let weakest = -1; for (let s = 0; s < SLOTS; s++) if (target[slots[s]] < target[i] && (weakest < 0 || target[slots[s]] < target[slots[weakest]])) weakest = s;
          if (weakest >= 0) target[slots[weakest]] = 0;
          continue;
        }
        if (slots[free] >= 0) shown[slots[free]] = 0;
        slots[free] = i;
      }
      const k = 1 - Math.exp(-dt / (Number.isInteger(o.force) ? 0.4 : 2.2 - 1.4 * fast));
      const kOut = 1 - Math.exp(-dt / (Number.isInteger(o.force) ? 0.4 : 1.2 - 0.6 * fast));   // leaving: a little quicker, still a fade
      for (let i = 0; i < N; i++) { const to = inSlot(i) ? target[i] : 0; shown[i] += (to - shown[i]) * (to === 0 ? kOut : k); }
      if (slots.every((s) => s < 0 || shown[s] < 0.01)) { slots[0] = 0; shown[0] = Math.max(shown[0], 0.01); }   // never nothing
      return st;
    },
    /** the shader's inputs: ids and weights of the four slots (unused slots: id 0, weight 0) */
    uniforms() {
      const ids = slots.map((s) => (s < 0 ? 0 : s)), w = slots.map((s) => (s < 0 ? 0 : shown[s]));
      return { ids, w };
    },
    /** the material most present now */
    get lead() { let b = 0; for (let i = 1; i < N; i++) if (shown[i] > shown[b]) b = i; return b; },
    /** how many materials are clearly present (for the marbling) */
    get present() { let n = 0; for (let i = 0; i < N; i++) if (shown[i] > 0.12) n++; return n; },
  };
  return st;
}

// the light each material casts (its table colour, being/cosmos/tables.mjs, lifted so it can light): the original
// six keep the being's own light
export const MATERIAL_LIGHT = [null, null, null, null, null, null,
  [1, 0.42, 0.12], [0.2, 0.62, 1], [1, 0.97, 0.72], [0.78, 0.68, 0.3],
  [0.38, 0.28, 0.85], [0.85, 0.62, 0.8], [1, 0.22, 0.08], [1, 0.66, 0.2], [0.2, 1, 0.5], [1, 0.92, 0.3], [0.62, 0.76, 1]];
/** the light the shown materials cast together, and how strongly (0..0.6) it should colour the being's light */
export function materialLight(shown) {
  let w = 0; const rgb = [0, 0, 0];
  for (let i = 0; i < shown.length; i++) { const c = MATERIAL_LIGHT[i]; if (!c || !(shown[i] > 0)) continue; w += shown[i]; for (let k = 0; k < 3; k++) rgb[k] += c[k] * shown[i]; }
  return w > 1e-4 ? { rgb: rgb.map((x) => x / w), w: Math.min(0.6, 0.6 * w) } : null;
}
