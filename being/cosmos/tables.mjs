// being/cosmos/tables.mjs - the fixed tables the sky modes read. Pure data (no DOM).
//   SEVEN        the seven bodies seen moving against the stars by the naked eye, slowest apparent motion first
//   WEEKDAY_BODY the body each weekday is named after (Latin dies Solis, Lunae, ...; Sunday = 0)
//   BODY         per body: its glyph, two colours from a historical colour table (names, with an approximate sRGB
//                rendering; the source gives names, not values) and the metal long paired with it
//   SECTORS      the ecliptic in twelve 30° sectors counted from the March equinox point: a colour each, and what the
//                'ecliptic' mode lends from it: a material (fire, earth, air, water, repeating) and a pace (quick, slow, ...)
//   METAL_RGB    measured base reflectance (F0, linear-ish sRGB) of the seven metals

export const SEVEN = ['Saturn', 'Jupiter', 'Mars', 'Sun', 'Venus', 'Mercury', 'Moon'];
export const WEEKDAY_BODY = ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn'];

export const METAL_RGB = {
  gold: [1.0, 0.766, 0.336], silver: [0.972, 0.96, 0.915], copper: [0.955, 0.638, 0.538], iron: [0.56, 0.57, 0.58],
  lead: [0.47, 0.48, 0.52], tin: [0.82, 0.83, 0.86], quicksilver: [0.78, 0.79, 0.8],
};

const B = (glyph, color, color2, metal, day) => ({ glyph, color, color2, metal, day });
export const BODY = {
  Saturn: B('♄', ['indigo', '#2e0a8c'], ['black', '#0b0b10'], 'lead', 6),
  Jupiter: B('♃', ['violet', '#8b00ff'], ['blue', '#1f4fff'], 'tin', 4),
  Mars: B('♂', ['scarlet', '#ff2400'], ['red', '#d00000'], 'iron', 2),
  Sun: B('☉', ['orange', '#ff8c00'], ['gold yellow', '#ffcc33'], 'gold', 0),
  Venus: B('♀', ['emerald green', '#00a651'], ['sky blue', '#87ceeb'], 'copper', 5),
  Mercury: B('☿', ['yellow', '#ffe600'], ['purple', '#6a0dad'], 'quicksilver', 3),
  Moon: B('☽', ['blue', '#0050ff'], ['silver', '#c4c6d0'], 'silver', 1),
};
export const OUTER = { Uranus: '♅', Neptune: '♆', Pluto: '♇' };

const MATS = ['Fire', 'Earth', 'Air', 'Water'];
const COLORS = ['#ff2400', '#ff5300', '#ff8c00', '#ffbf00', '#e5ff00', '#9acd32', '#00a651', '#00a693', '#0050ff', '#2e0a8c', '#8b00ff', '#b0004a'];
export const SECTORS = COLORS.map((color, i) => ({ index: i, from: i * 30, color, element: MATS[i % 4], quick: i % 2 === 0 }));

/** '#rrggbb' -> [r, g, b] in 0..1 */
export const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
