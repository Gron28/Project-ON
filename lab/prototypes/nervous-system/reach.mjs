// lab/prototypes/nervous-system/reach.mjs - what reaches the body: for each state of the nervous system, the lines of
// being/index.html that read it, fetched live (so it follows the page as it changes), sorted into lines that drive the body
// (uniforms, motion, layers), lines that only feed memory or voice, and readouts (dashboard snapshot, HUD text, lab hooks).
// Auto verdict by line count: 3+ body lines "shown", 1-2 "barely shown", none "not shown"; WEAK and STRONG correct it where reading
// the lines shows the effect is small (a small coefficient, held down by restraint) or large (one line that fans out). The note says how.

const M = (n) => `\\b(?:mind|m)\\.${n}\\b`;
export const STATES = [
  // organ, state, pattern, note (read from the page, 2026-10-21)
  ['mind', 'arousal', M('arousal'), 'light saturation, aura zoom and decay, nucleus, cymatics amplitude, skin flow, pressure, restraint'],
  ['mind', 'valence', M('valence'), 'light hue (only when the light follows the being), nucleus spin direction, aura rotation of 0.002'],
  ['mind', 'mood', M('mood'), 'added to valence for the light hue only'],
  ['mind', 'energy', M('energy'), 'slows the shader clock (0.65..1) and softens the pressure organ'],
  ['mind', 'bored', M('bored'), 'only the skin surfacing rate; its reform event regrows the form'],
  ['mind', 'confused', M('confused'), 'dashboard only'],
  ['mind', 'startle event', "type === 'startle'", 'flinch, kick, drops, jitter, tissue kick'],
  ['mind', 'habituation', M('habituation'), 'not drawn; it scales each startle'],
  ['mind', 'lock', M('lock'), 'beat pulse, dance, timing gate, nucleus spin'],
  ['mind', 'groove', M('groove'), 'dance size, aura gain, serpents, restraint climax'],
  ['mind', 'syncopation', M('sync'), 'dashboard only'],
  ['mind', 'beat error', M('beatError'), 'HUD text only'],
  ['mind', 'surprise', M('surprise'), 'only gates glints'],
  ['mind', 'dF/dt', M('dF'), 'inside the mind only (valence)'],
  ['mind', 'IC', M('IC'), 'inside the mind only'],
  ['mind', 'entropy', M('entropy'), 'inside the mind only (dopamine)'],
  ['mind', 'harmonic surprise', M('harmonicSurprise'), 'dashboard only'],
  ['mind', 'dopamine phasic', M('daPhasic'), 'glints and stars, glow, kept voice moments, love map'],
  ['mind', 'dopamine anticip.', M('daAnticipation'), 'size swell, tension, aura zoom, pressure'],
  ['mind', 'dopamine tonic', M('daTonic'), 'light lightness, song feeling'],
  ['mind', 'contagion', M('contagion'), 'not drawn; it weights arousal and valence'],
  ['mind', 'felt tempo', M('pulseHz'), 'timing grid, predicted hits, serpents'],
  ['mind', 'pulse phase', M('pulsePhase(?:Raw)?'), 'through the timing grid (SHOW.phase)'],
  ['mind', 'resonance bank', M('resonance'), 'dashboard only'],
  ['mind', 'regions', M('regions'), 'each region swells by how far it is out of step (uRegP)'],
  ['mind', 'order / cross', `${M('order')}|${M('crossPulse')}`, 'lab hook only'],
  ['mind', 'pitch', M('pitch'), 'note colours, palette, voice chroma'],
  ['mind', 'tissue coherence', M('tissueCoherence'), 'inside the mind only'],
  ['mind', 'proprio strain', M('proprioStrain'), 'inside the mind only'],
  ['ear', 'amplitudes', '\\b(?:e|earFrame)\\.amp\\b', 'cymatics: three bands excite l = 2, 3, 4'],
  ['ear', 'mu / hum', '\\b(?:e|d|earFrame)\\.(?:mu|hum)\\b', 'the hum in silence is not drawn on the body'],
  ['ear', 'onset', '\\b(?:e|earFrame)\\.onset\\b', 'through the mind (startle, resonance)'],
  ['ear', 'roughness', '\\b(?:e|earFrame)\\.rough\\b', 'spikes bristle (+0.07)'],
  ['ear', 'sub-bass', '\\b(?:e|earFrame)\\.sub\\b', 'bounce, physics, skin motion'],
  ['tissue', 'texture', '\\buTissue\\b', 'only its firing channel, at 0.3 x uTissueA; restraint holds it unless it leads the inner light'],
  ['tissue', 'activity', 'tissueStats\\.act\\b', 'aura warp, nucleus Julia w, tissue layer strength'],
  ['tissue', 'sigma / branching', 'tissueStats\\.(?:sigma|branching)\\b', 'dashboard only'],
  ['tissue', 'coherence', 'tissueStats\\.coherence|tissue: tissueStats', 'to the mind only'],
  ['timing', 'predicted hits', 'timing\\.predict\\(', 'drawn ahead of time as drum hits'],
  ['timing', 'share predicted', 'timing\\.predicted\\b', 'to the mind as reward; HUD'],
  ['timing', 'error / bias', 'timing\\.(?:errorMs|bias)\\b', 'shifts the grid (bias); error is HUD only'],
  ['body', 'l = 2 modes', 'phys\\.modes', 'added to the cymatics (x0.038)'],
  ['body', 'squash / position / spin', 'phys\\.(?:squash|pos|omega)\\b', 'width, scale, shift, spin'],
  ['body', 'slosh / strain / jolt', 'phys\\.(?:slosh|strain|jolt)|proprio: phys', 'to the mind only'],
  ['body', 'pressure', 'pressure\\.(?:step|pressure|state)\\b', 'bursts the body into beads'],
  ['body', 'restraint M', 'MAXIM\\.want', 'holds every other layer down'],
];
// where the line count misleads: read in the page, these land weakly (a small coefficient, or held down by restraint)
const WEAK = new Set(['mood', 'energy', 'bored', 'surprise', 'dopamine tonic', 'texture', 'mu / hum']);
const STRONG = new Set(['startle event', 'predicted hits', 'restraint M', 'pressure', 'amplitudes', 'pitch', 'regions', 'l = 2 modes', 'pulse phase']);
const READOUT = /mlLine|num\(|window\.__|meters|textContent|bSub|JSON\.stringify|devSnap|\bsnap\b|console\.|toFixed/;
const MEMORY = /MEM\.|VOICE\.|voiceKeep|loveUpdate|saveLife/;
// whole functions of the page that only read out (HUD dials, dashboard snapshot, lab hooks) or only remember
const FN = /^(?:async )?function (\w+)|^const (\w+) = (?:\(|\w+ =>)|^(window\.__\w+) =/;
const READ_FN = /^(?:drawBeing|devFrame|window\.__\w+)$/, MEMORY_FN = /^(?:memoryHear|voiceHear|voiceKeep)$/;

export async function readReach(url = '../../being/index.html') {
  const text = await (await fetch(url, { cache: 'no-store' })).text(), lines = text.split(/\r?\n/);
  return STATES.map(([organ, name, pat, note]) => {
    const re = new RegExp(pat), body = [], memory = [], readout = [], inner = [];
    let fn = '';
    lines.forEach((l, i) => {
      const f = FN.exec(l); if (f) fn = f[1] || f[2] || f[3];
      if (!re.test(l) || /^\s*\/\//.test(l)) return;
      const at = l.search(re), snip = l.slice(Math.max(0, at - 50), at + 80).trim();
      const u = [...new Set([...l.matchAll(/\b(?:U|FB|B2u)\.(u\w+)/g)].map((x) => x[1]))];
      const row = { line: i + 1, snip, u };
      if (/\bmind\.step\(/.test(l)) inner.push(row); else (READ_FN.test(fn) || (READOUT.test(l) && !u.length) ? readout : MEMORY_FN.test(fn) || (MEMORY.test(l) && !u.length) ? memory : body).push(row);
    });
    const auto = body.length >= 3 ? 'shown' : body.length ? 'barely shown' : 'not shown';
    const verdict = WEAK.has(name) && auto !== 'not shown' ? 'barely shown' : STRONG.has(name) && body.length ? 'shown' : auto;
    return { organ, name, note, verdict, auto, body, memory, readout, inner };
  });
}
