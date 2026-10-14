// Everything the Tune window can change. Each value multiplies part of the entity (1 = the designed look);
// the renderer reads them by key (see the T object in blob.html).
const TUNE = [
  ['Response', [
    ['sens', 'Sensitivity', 'how easily the music counts as intense', 0, 3, 1],
    ['curve', 'Calm ↔ wild curve', 'above 1: calmer most of the time and wild only at peaks; below 1: wild sooner', .3, 3, 1],
    ['react', 'Reaction speed', 'how fast it rises and falls with the music', .3, 3, 1],
    ['absRel', 'Absolute ↔ relative', '0: intensity judged against each song (like before); 1: absolute, so chill songs stay calm and loud ones wild; 2: even more absolute', 0, 2, 1]
  ]],
  ['Learning', [
    ['learn', 'Learn my taste', 'how much what you liked, disliked and tuned for similar music shapes it (0: off)', 0, 2, 1],
    ['species', 'Species', 'how strongly each kind of music gets its own recognisable form', 0, 2, 1],
    ['mindAmt', 'The mind', 'how much the local AI mind steers its look and mood', 0, 2, 1],
    ['skinAmt', 'Living skin', 'cellular patterns growing over the metal, chosen by the mind', 0, 3, 1]
  ]],
  ['Character', [
    ['flow', 'Flowing tendrils', 'tonal, clean music grows long glassy tendrils', 0, 3, 1],
    ['grain', 'Grain / static', 'noisy music: sand-like grain, fizz and a speckled halo', 0, 3, 1],
    ['frac', 'Fracture / glitch', 'rough music: facets, shards, stutters and colour split', 0, 3, 1],
    ['harmony', 'Harmony structures', 'simple harmony: few big lobes; rich harmony: many small lobes and orbiting orbs', 0, 3, 1],
    ['drift', 'Free drift', 'irregular music: rubato swells and flowing rotation instead of a beat pulse', 0, 3, 1],
    ['detail', 'Detail', 'surface detail, ripples and micro-motion for dense, intricate music', 0, 3, 1],
    ['weight', 'Weight', 'heavy bass: sits lower, wider, denser, drops fall faster; light: floats and lets light through', 0, 3, 1],
    ['voice', 'Voice in the core', 'vocals make the core follow the lead syllable by syllable, with rays', 0, 3, 1],
    ['reorg', 'Reorganization rate', 'how often the form rearranges (0 keeps one form)', 0, 3, 1]
  ]],
  ['Body', [
    ['size', 'Size', '', .5, 1.6, 1],
    ['thick', 'Metal thickness', 'thin: more light breaks through', 0, 3, 1],
    ['visc', 'Viscosity', 'how much the metal blends and pools', .2, 3, 1],
    ['turb', 'Turbulence', 'how much the surface churns when the music is wild', 0, 2.5, 1],
    ['turbSpeed', 'Turbulence speed', '', 0, 3, 1],
    ['turbDetail', 'Turbulence detail', 'small: big slow waves; large: fine ripples', .3, 2.5, 1],
    ['wobble', 'Wobble', 'gentle movement even when calm', 0, 4, 1],
    ['lobes', 'Note lobe size', '', 0, 2.5, 1],
    ['reach', 'Note lobe reach', 'how far notes push the metal out', 0, 3, 1],
    ['spin', 'Spin', '', 0, 4, 1],
    ['sway', 'Sway on the beat', '', 0, 4, 1],
    ['pulse', 'Beat pulse', '', 0, 4, 1],
    ['jolt', 'Kick jolt', '', 0, 4, 1],
    ['jitter', 'Jitter on hard hits', '', 0, 4, 1]
  ]],
  ['Drops', [
    ['drops', 'Amount', '', 0, 4, 1],
    ['dropSize', 'Size', '', .2, 3, 1],
    ['fall', 'Fall speed', '', .1, 4, 1],
    ['swirl', 'Swirl', '', 0, 4, 1],
    ['burst', 'Burst on a drop', '', 0, 3, 1]
  ]],
  ['Light', [
    ['core', 'Core size', '', .3, 3, 1],
    ['bright', 'Core brightness', '', 0, 3, 1],
    ['glow', 'Glow', '', 0, 3, 1],
    ['halo', 'Halo', '', 0, 3, 1],
    ['open', 'Light breaking through', 'how much the lead and voice open the metal', 0, 3, 1],
    ['vibrato', 'Voice vibrato', '', 0, 4, 1],
    ['tremble', 'Build-up tremble', '', 0, 4, 1],
    ['reflect', 'Reflections', '', 0, 3, 1]
  ]],
  ['Effects', [
    ['spikes', 'Hi-hat spikes', '', 0, 4, 1],
    ['spikeDetail', 'Spike detail', '', .3, 2.5, 1],
    ['ring', 'Snare rings', '', 0, 3, 1],
    ['ringSpeed', 'Ring speed', '', .3, 3, 1],
    ['motes', 'Motes', '', 0, 4, 1],
    ['glints', 'Star glints', '', 0, 4, 1],
    ['film', 'Oil-film sheen', '', 0, 1.5, 1],
    ['tint', 'Lobe colour strength', '', 0, 1.6, 1]
  ]],
  ['Channel mix', [
    ['mixKick', 'Kick', 'how strongly each part of the music drives the visuals', 0, 3, 1],
    ['mixSnare', 'Snare / clap', '', 0, 3, 1],
    ['mixHat', 'Hi-hats', '', 0, 3, 1],
    ['mixBass', 'Bass', '', 0, 3, 1],
    ['mixLead', 'Lead / voice', '', 0, 3, 1],
    ['mixPads', 'Pads', '', 0, 3, 1],
    ['mixNotes', 'Notes / chords', '', 0, 3, 1]
  ]],
  ['Space', [
    ['pan', 'Follow left / right', 'note lobes and drops gather on the side the sound comes from', 0, 3, 1],
    ['width', 'Stereo width', 'wide mixes stretch the metal sideways', 0, 3, 1],
    ['height', 'Pitch height', 'lobes and drops lean up for bright sound, down for dark', 0, 3, 1]
  ]],
  ['View', [
    ['zoom', 'Zoom', '', .6, 1.6, 1],
    ['res', 'Render resolution', 'lower saves power', .4, 1.5, 1]
  ]]
];
const PRESETS = {
  Subtle: { sens: .8, curve: 1.5, turb: .55, spin: .5, sway: .6, pulse: .6, jolt: .6, jitter: .4, drops: .5, glow: .85, spikes: .6, ring: .7 },
  Default: {},
  Wild: { sens: 1.35, curve: .7, react: 1.3, turb: 1.7, turbSpeed: 1.3, spin: 1.6, sway: 1.5, pulse: 1.5, jolt: 1.6, jitter: 1.8, drops: 1.8, burst: 1.6, spikes: 1.6, ring: 1.4, glow: 1.2 },
  'Slow & syrupy': { react: .6, visc: 1.8, turbSpeed: .5, turbDetail: .6, spin: .4, fall: .5, swirl: .6, wobble: 2 },
  'Drums only': { mixNotes: 0, mixLead: .3, mixPads: .3, mixKick: 1.6, mixSnare: 1.6, mixHat: 1.6 }
};
module.exports = { TUNE, PRESETS };
