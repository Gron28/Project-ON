// lab/prototypes/cellab/rules.mjs - the automata in the gallery: what each is, how faithful it is to CelLab, the palette it
// starts with, and which of the mind's moods would choose it.
//
// The 2D rules come from CelLab / WebCA by Rudy Rucker and John Walker (Fourmilab, https://www.fourmilab.ch/cellab/), which
// they placed in the public domain ("All of these programs are in the public domain and may be used in any way without
// any restrictions whatsoever"). 'faithful' means the update is the CelLab rule definition line for line (8-bit state,
// neighbours seen through their bit-0 plane, the same evaluator semantics); 'adaptation' means the idea is kept but the
// mechanism changed to live on a closed sphere. The 3D rules are not in CelLab; they are volumetric relatives.

export const MOODS = ['calm', 'flowing', 'rough', 'wild'];

export const RULES_2D = [
  { id: 'rainzha', name: 'RainZha', tag: 'faithful', palette: 'default', mood: 'flowing', steps: 18, dens: 0.5, relief: 0.05,
    caption: 'Spiral chemical waves: a resting cell fires when two or three neighbours fire, then cools through eight steps before it can fire again.',
    note: 'NLUKY rule N=8 L=2 U=3 K=2 Y=2 (Rucker). Spirals out of random soup.' },
  { id: 'zhabo', name: 'Zhabotinsky', tag: 'faithful', palette: 'on-gold', mood: 'flowing', steps: 14, dens: 0.5, relief: 0.04,
    caption: 'Margolus and Toffoli\'s Zhabotinsky reaction: cells keep firing until their neighbours raise an alarm, then rest three steps.',
    note: 'Alarm bit 3, timer bits 1-2, temporal phase in the cell, exactly as zhabo.js.' },
  { id: 'brain', n: 128,  name: "Brian's Brain", tag: 'faithful', palette: 'on-ember', mood: 'rough', steps: 16, dens: 0.35, relief: 0.05,
    caption: 'Excitable neurons: a ready cell fires when exactly two neighbours fire, then is refractory for one step. Gliders everywhere.',
    note: 'Brian Silverman, Toffoli & Margolus 6.1.' },
  { id: 'faders', n: 160,  name: 'Faders', tag: 'faithful', palette: 'faders', mood: 'wild', steps: 20, dens: 0.6, relief: 0.05,
    caption: 'Brain with long memory: firing cells stay lit while exactly two neighbours fire, then fade through 127 shades before they can fire again.',
    note: 'NLUKY N=127 L=2 U=2 K=2 Y=2, Rucker\'s favourite.' },
  { id: 'rug', seedR: 2.5,  name: 'Rug', tag: 'faithful', palette: 'rainbow', mood: 'calm', steps: 10, dens: 1, relief: 0.035,
    caption: 'A melting average: each cell becomes one more than the average of its eight neighbours, so colours flow and wrap around.',
    note: 'semi8 evaluator, (sum >> 3) + 1 mod 256.' },
  { id: 'hodge', name: 'Hodge', tag: 'faithful', palette: 'autocad', mood: 'flowing', steps: 12, dens: 1, relief: 0.05,
    caption: 'The Hodgepodge machine: sick cells average their neighbours and get sicker until they are ill, then heal at once. Brain-like scrolls.',
    note: 'World type 10: neighbours seen through their low five bits, g = 5, n = 31.' },
  { id: 'venus', name: 'Venus', tag: 'faithful', palette: 'aurora', mood: 'rough', steps: 12, dens: 1, relief: 0.035,
    caption: 'Floating mats of vegetation: each cell looks one way, chosen by its own state, and copies a mix of the neighbours it sees.',
    note: 'Combinatoric rule by Rucker. Directional, so the cube seams turn its frame by 90 degrees.' },
  { id: 'life', n: 128,  name: 'Life', tag: 'faithful', palette: 'brailife', mood: 'wild', steps: 12, dens: 0.35, relief: 0.05,
    caption: 'Conway\'s Game of Life: born with three neighbours, survives with two or three.',
    note: 'Semitotalistic EightSum rule.' },
  { id: 'perfume', n: 192, seedR: 2,  name: 'Perfume', tag: 'adaptation', palette: 'on-violet', mood: 'wild', steps: 24, dens: 0.6, relief: 0.06,
    caption: 'A lattice gas: puffs of particles fly in four directions and bounce off each other at right angles, spreading like scent.',
    note: 'CelLab runs HPP gas on Margolus blocks; here it is the equivalent HPP gas with one bit per direction, so particles cross the cube seams. A slow leak keeps the sphere from filling.' },
  { id: 'pond', n: 192, seedR: 1.6,  name: 'Pond', tag: 'adaptation', palette: 'on-ice', mood: 'calm', steps: 20, dens: 0.45, relief: 0.06,
    caption: 'Two interpenetrating gases: a dense burst pushes through the sea of particles as a round pressure wave, like a stone in a pond.',
    note: 'CelLab Pond is two TM gases on Margolus blocks; here an orthogonal and a diagonal HPP gas share the cell (bits 0-3, 4-7).' },
];

export const RULES_3D = [
  { id: 'scroll3d', name: 'Scroll waves', tag: '3D', palette: 'on-ice', mood: 'flowing', steps: 14, dens: 0.5,
    caption: 'A 3D excitable medium: each beat breaks a wave in half, and the free edge curls into a scroll ring that drifts through the body.',
    note: 'Greenberg-Hastings on 26 neighbours weighted by distance (face 1, edge .6, corner .35) with a soft, noisy threshold near 2.2, so fronts grow round instead of as cubes; 1 excited step, 10 refractory.' },
  { id: 'brain3d', name: "Brian's Brain 3D", tag: '3D', palette: 'on-ember', mood: 'rough', steps: 14, dens: 0.4,
    caption: 'Neurons in a volume: a ready cell fires with four to six firing neighbours, then rests. Bursts die out unless the music feeds them.',
    note: 'Birth 4-6 of 26, four refractory steps: near criticality, so beats drive it.' },
  { id: 'life3d', name: 'Life 3D', tag: '3D', palette: 'on-moss', mood: 'wild', steps: 10, dens: 0.12,
    caption: 'Life in three dimensions with a fading memory: cells are born and survive by counts of their 26 neighbours, and dying cells glow out.',
    note: 'Generations rule; the variant picks the counts (Pyroclastic 4-7/6-8/10 lives on its own; Bays 4555 and 5766 need seeds).' },
  { id: 'rug3d', name: 'Rug 3D', tag: '3D', palette: 'on-violet', mood: 'calm', steps: 8, dens: 1,
    caption: 'The melting average in a volume: each cell becomes one more than the mean of its neighbours. Each beat drops ink that melts out in rings.',
    note: '(sum / n) + 1 mod 256 over the neighbours inside the body; shown where the value changes fast, so only the melting fronts glow.' },
];

export const LIFE3D_VARIANTS = {
  pyro: { name: 'Pyroclastic 4-7/6-8/10', S: [4, 5, 6, 7], B: [6, 7, 8], states: 10 },
  bays4555: { name: 'Bays 4555', S: [4, 5], B: [5], states: 2 },
  bays5766: { name: 'Bays 5766', S: [5, 6, 7], B: [6], states: 2 },
  amoeba: { name: 'Amoeba 9-26/5-7,12,13,15/5', S: [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26], B: [5, 6, 7, 12, 13, 15], states: 5 },
  crystal: { name: 'Crystal 0-6/1,3', S: [0, 1, 2, 3, 4, 5, 6], B: [1, 3], states: 2 },
};

export const RULE_INDEX_2D = Object.fromEntries(RULES_2D.map((r, i) => [r.id, i]));
export const RULE_INDEX_3D = Object.fromEntries(RULES_3D.map((r, i) => [r.id, i]));

// what each mood picks, in order of preference
export const MOOD_RULES = {
  '2d': { calm: ['pond', 'rug'], flowing: ['rainzha', 'hodge', 'zhabo'], rough: ['brain', 'venus'], wild: ['faders', 'perfume', 'life'] },
  '3d': { calm: ['rug3d'], flowing: ['scroll3d'], rough: ['brain3d'], wild: ['life3d'] },
};
