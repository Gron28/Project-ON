// being/materials.mjs - what the being is made of, moment to moment. Pure module (no DOM), stepped once per frame.
//
// Thirty-nine materials compete for the body: the original six, the four elements, seven metals (each named after
// the body long paired with it: Saturn lead, Jupiter tin, Mars iron, Sun gold, Venus copper, Mercury quicksilver, Moon
// silver), twelve stones (one per 30° sector of the sky and one per pitch class) and ten gems that light up where the
// stones and metals they are kin to are strong together. Each has an affinity computed from the mind's state (arousal, valence, groove, dopamine, chills) and the
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
  'cinnabar', 'terracotta', 'tourmaline', 'amber', 'heliodor', 'peridot', 'jade', 'malachite', 'lazuli', 'basalt', 'amethyst', 'selenite',
  'diamond', 'star sapphire', 'crimson sea', 'royal amethyst', 'ruby iron', 'rose gold', 'emerald amber', 'opal lattice', 'violet quartz',
  'fourfold earth',
];
export const ELEMENT_ID = { Fire: 6, Water: 7, Air: 8, Earth: 9 };
export const PLANET_ID = { Saturn: 10, Jupiter: 11, Mars: 12, Sun: 13, Venus: 14, Mercury: 15, Moon: 16 };
export const SECTOR_ID = [17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28];   // the stones, one per 30° sector of the sky (being/cosmos/tables.mjs)
export const GEM_ID = [29, 30, 31, 32, 33, 34, 35, 36, 37, 38];
export const N = MATERIALS.length;
export const SLOTS = 4;

// each gem's kin: the stones, metals and elements whose strength together lights it (the gem at GEM_ID[i] has KIN[i])
const KIN = [[8, 15, 16], [8, 14, 17, 18], [15, 14, 19, 20], [18, 21, 22, 11], [20, 21, 23, 7], [16, 17, 19, 22, 23, 24, 25, 26],
  [11, 24, 12, 27, 28], [7, 26, 12, 13, 6], [25, 27, 13, 10, 9], [28, 6, 10, 9]];

const c01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const v = (x, d = 0.5) => (Number.isFinite(x) ? x : d);

/**
 * The four casts of the light, as weights summing to 1: [radiant (the core glows through), reflective (the room in the
 * surface), sharp (more contrast), flecked (gold flecks)], from the mind and the music's character.
 */
export function lightCast(m = {}, ch = {}, x = {}) {
  const A = c01(v(m.arousal, 0.3)), G = c01(v(m.groove, 0)), Dp = Math.max(0, v(m.daPhasic, 0)), chill = c01(v(x.chill, 0));
  const k = (key) => c01(v(ch[key]));
  const bright = k('brightness'), rough = k('roughness'), bass = k('bassWeight'), dens = k('density'), intr = k('intricacy');
  const tonal = k('tonality'), harm = k('harmony'), reg = k('regularity'), change = k('change'), calm = 1 - A;
  const w0 = 0.15 + 0.55 * A * (0.4 + 0.6 * bright) + 0.45 * Dp + 0.45 * chill;         // radiant: aroused, bright, a peak
  const w1 = 0.15 + 0.55 * calm * (0.5 + 0.5 * tonal) + 0.35 * harm * (1 - rough);       // reflective: calm, tonal, consonant
  const w2 = 0.15 + 0.5 * intr + 0.4 * reg * G + 0.3 * change;                           // sharp: intricate, regular, changing
  const w3 = 0.15 + 0.55 * bass * (0.5 + 0.5 * dens) + 0.35 * G * (1 - bright) + 0.2 * rough; // flecked: heavy, dense, dark
  const sum = w0 + w1 + w2 + w3 || 1;
  return [w0 / sum, w1 / sum, w2 / sum, w3 / sum];
}

/**
 * Each material's affinity for this moment.
 * @param {object} m   the mind (arousal 0..1, valence -1..1, groove, lock, energy, daPhasic, daAnticipation, daTonic, pulseHz, surprise, pitch)
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
  const P = m && m.pitch;
  const pc = (i) => (P && Number.isFinite(P[i]) ? c01(P[i]) : 0);
  let pSum = 0; if (P) for (let i = 0; i < 12; i++) pSum += pc(i);
  const pGate = c01(pSum * 0.7);   // how strongly the pitch classes are sounding now
  const base = [
    0.45 + 0.2 * G,                                                          // 0 liquid metal: home
    0.45 * calm + 0.3 * pos + 0.3 * tonal,                                   // 1 glass
    0.4 * pos + 0.35 * (1 - bright) + 0.2 * calm,                            // 2 velvet flesh
    0.5 * neg + 0.35 * rough + 0.25 * bass,                                  // 3 obsidian
    0.5 * chill + 0.3 * (1 - fam) + 0.3 * bright,                            // 4 iridescent
    0.12 + 0.35 * A + 0.3 * G + 0.4 * Da,                                    // 5 fluorescent
    0.8 * A * (0.1 + 0.65 * rough + 0.35 * noise + 0.2 * bright) + 0.2 * Dp * rough + 0.1 * E * A,   // 6 fire
    0.55 * calm * (0.5 + 0.5 * tonal) + 0.3 * neg * calm + 0.25 * (1 - reg), // 7 water
    0.55 * bright * (1 - dens) + 0.3 * pos * (1 - bass) + 0.25 * vocal,      // 8 air
    0.6 * bass * (0.5 + 0.5 * reg) + 0.3 * dens * (1 - bright) + 0.2 * G,    // 9 earth
    0.5 * (1 - tempo) * (1 - bright) + 0.35 * neg + 0.2 * bass * calm,       // 10 Saturn · lead
    0.45 * harm * (0.5 + 0.5 * pos) + 0.3 * A * dens + 0.2 * pos,            // 11 Jupiter · tin
    0.6 * rough * A + 0.35 * noise * A + 0.25 * neg * A,                     // 12 Mars · iron
    0.55 * Dp + 0.5 * chill + 0.3 * pos * loud + 0.2 * bright * A,           // 13 Sun · gold
    0.5 * pos * (0.4 + 0.6 * tonal) + 0.3 * harm + 0.25 * G * (1 - rough),   // 14 Venus · copper
    0.5 * intr + 0.4 * tempo * dens + 0.3 * change,                          // 15 Mercury · quicksilver
    0.5 * calm * (1 - bright) + 0.3 * vocal * calm + 0.25 * tonal * (1 - dens), // 16 Moon · silver
    // 17..28: the twelve stones, each tuned to one pitch class (0=C .. 11=B) and a temperament
    pc(0) * (0.55 + 0.45 * A * (0.5 + 0.5 * rough)) + 0.12 * A * loud,       // 17 cinnabar (C): hot, commanding
    pc(1) * (0.55 + 0.45 * bass * reg) + 0.12 * bass * harm,                 // 18 terracotta (C#): heavy, resonant
    pc(2) * (0.55 + 0.45 * intr * bright) + 0.12 * intr * change,            // 19 tourmaline (D): light, quick, two-sided
    pc(3) * (0.55 + 0.45 * calm * tonal) + 0.12 * calm * G,                  // 20 amber (D#): calm, enclosing
    pc(4) * (0.55 + 0.45 * A * pos) + 0.12 * pos * Dp,                       // 21 heliodor (E): radiant, ecstatic
    pc(5) * (0.55 + 0.45 * tonal * (1 - dens)) + 0.12 * tonal * calm,        // 22 peridot (F): clear, crystalline, sparse
    pc(6) * (0.55 + 0.45 * harm * reg) + 0.12 * harm * G,                    // 23 jade (F#): poised, balanced
    pc(7) * (0.55 + 0.45 * neg * bass) + 0.12 * neg * rough,                 // 24 malachite (G): dark, deep, changing
    pc(8) * (0.55 + 0.45 * change * harm) + 0.12 * Da * bright,              // 25 lazuli (G#): fire and water fusing
    pc(9) * (0.55 + 0.45 * bass * rough) + 0.12 * bass * A,                  // 26 basalt (A): heavy, rough, stark
    pc(10) * (0.55 + 0.45 * bright * vocal) + 0.12 * chill * bright,         // 27 amethyst (A#): bright, pouring light
    pc(11) * (0.55 + 0.45 * calm * (1 - reg)) + 0.12 * vocal * (1 - bright), // 28 selenite (B): misty, drifting
  ];
  // 29..38: the ten gems, each lit when two of its kin are strong together, plus a temperament of its own
  const syn = (sIdx) => {
    const inc = KIN[sIdx];
    let b1 = 0, b2 = 0;
    for (let i = 0; i < inc.length; i++) { const w = base[inc[i]] || 0; if (w > b1) { b2 = b1; b1 = w; } else if (w > b2) b2 = w; }
    return Math.sqrt(b1 * b2) * (0.45 + 0.55 * pGate);
  };
  const elBal = Math.pow(Math.max(0, base[6] * base[7] * base[8] * base[9]), 0.25);   // the four elements in balance, for the fourfold earth
  return [
    ...base,
    syn(0) + 0.32 * chill * tonal + 0.18 * L * bright * (1 - rough),         // 29 diamond: chills, crystalline brilliance
    syn(1) + 0.28 * pGate * bright * harm + 0.18 * Dp * pos,                 // 30 star sapphire: a starry vault, a spark
    syn(2) + 0.28 * pGate * calm * dens + 0.18 * neg * bass * (1 - tempo),   // 31 crimson sea: a deep, dark sea
    syn(3) + 0.28 * pGate * harm * pos + 0.18 * tonal * G,                   // 32 royal amethyst: broad, consonant, expansive
    syn(4) + 0.28 * pGate * rough * A + 0.18 * E * L * loud,                 // 33 ruby iron: a furnace, hard rhythm
    syn(5) + 0.32 * pGate * tonal * harm * (0.5 + 0.5 * L) + 0.15 * pos * G, // 34 rose gold: a warm heart, the most kin
    syn(6) + 0.28 * pGate * G * pos + 0.18 * vocal * Da,                     // 35 emerald amber: groove, lush
    syn(7) + 0.28 * pGate * intr * reg + 0.18 * change * tempo,              // 36 opal lattice: intricate, quick pattern
    syn(8) + 0.28 * pGate * bass * L + 0.18 * calm * tonal,                  // 37 violet quartz: deep bass, steady
    syn(9) + 0.55 * elBal + 0.22 * pGate * bass * reg * G,                   // 38 fourfold earth: the four elements in balance
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
        const a = (aff[i] || 0) + (o.dna ? o.dna[i] || 0 : 0) - 0.6 * h[i];
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
  [0.38, 0.28, 0.85], [0.85, 0.62, 0.8], [1, 0.22, 0.08], [1, 0.66, 0.2], [0.2, 1, 0.5], [1, 0.92, 0.3], [0.62, 0.76, 1],
  [1, 0.2, 0.08], [1, 0.38, 0.1], [1, 0.58, 0.12], [1, 0.76, 0.12],
  [0.92, 1, 0.12], [0.64, 0.85, 0.22], [0.15, 0.75, 0.38], [0.1, 0.68, 0.6],
  [0.18, 0.42, 1], [0.28, 0.2, 0.68], [0.6, 0.2, 1], [0.78, 0.12, 0.42],
  // 29..38: the ten gems
  [1, 0.98, 0.94], [0.55, 0.78, 1], [0.75, 0.12, 0.28], [0.45, 0.25, 1], [1, 0.32, 0.08],
  [1, 0.72, 0.68], [0.35, 0.92, 0.45], [0.85, 0.45, 0.95], [0.58, 0.28, 0.95], [0.85, 0.72, 0.32]];
/** the light the shown materials cast together, and how strongly (0..0.6) it should colour the being's light */
export function materialLight(shown) {
  let w = 0; const rgb = [0, 0, 0];
  for (let i = 0; i < shown.length; i++) { const c = MATERIAL_LIGHT[i]; if (!c || !(shown[i] > 0)) continue; w += shown[i]; for (let k = 0; k < 3; k++) rgb[k] += c[k] * shown[i]; }
  return w > 1e-4 ? { rgb: rgb.map((x) => x / w), w: Math.min(0.6, 0.6 * w) } : null;
}

