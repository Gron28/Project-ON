// being/showcase.mjs - a silent guided tour of everything the being can do (?showcase=1; main.cjs --showcase).
// A small synthesizer makes music-like sound in the page and feeds it straight to the being's ear (nothing reaches the
// speakers), in styles that pull its feelings around (silence, ambient, groove, aggressive, dub, bright, frantic, a
// build-up), while a timeline forces each material, the mixes, the rings, the serpent, glints and stars, every kind of
// particle, the drop, chills, a startle, beads, love, a station of the Sun, a flare, the sky ring, a new form, a section, and sleep.
// A caption says what is being shown. The tour loops. Keys: → next step, ← previous, space pause.
import { MATERIALS } from './materials.mjs';

const SR = 48000, CHUNK = 960;   // 20 ms
const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];   // Am F C G (MIDI)
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
const STYLES = {
  silence: {},
  ambient: { bpm: 70, pad: .55, bright: .3, lead: .08, bass: .15 },
  groove: { bpm: 112, kick: .8, snare: .5, hat: .4, bass: .6, pad: .3, lead: .25, bright: .5 },
  aggressive: { bpm: 150, kick: 1, snare: .9, hat: .7, bass: .8, noise: .35, rough: .85, bright: .85, lead: .3 },
  dub: { bpm: 74, kick: .9, snare: .35, hat: .15, bass: 1, pad: .2, bright: .15, half: 1 },
  bright: { bpm: 122, kick: .8, snare: .6, hat: .5, bass: .5, pad: .5, lead: .75, bright: .95 },
  frantic: { bpm: 172, kick: .5, snare: .5, hat: .85, bass: .4, lead: .85, bright: .75, sixteenth: 1 },
  build: { bpm: 126, kick: .5, hat: .5, bass: .3, pad: .4, bright: .6, riser: 1 },
  drop: { bpm: 126, kick: 1, snare: .8, hat: .6, bass: 1, pad: .4, lead: .5, bright: .8, rough: .3 },
};

function createSynth() {
  let n = 0, cur = { ...STYLES.silence }, to = cur, mixT = 1, lp = 0, padLp = 0, noiseLast = 0, riserT = 0;
  const ph = new Float64Array(16);
  const p = (k) => (cur[k] || 0) + ((to[k] || 0) - (cur[k] || 0)) * mixT;   // glide between styles over ~1 s
  return {
    style(name) { cur = Object.fromEntries(Object.keys({ ...cur, ...to }).map((k) => [k, p(k)])); to = { ...STYLES[name] }; mixT = 0; if (name === 'build') riserT = 0; },
    /** one 20 ms chunk of int16 stereo */
    chunk() {
      const out = new Int16Array(CHUNK * 2);
      for (let i = 0; i < CHUNK; i++, n++) {
        mixT = Math.min(1, mixT + 1 / SR);
        const bpm = p('bpm') || 100, beatLen = 60 / bpm * SR, beat = n / beatLen, b = Math.floor(beat), fb = beat - b;
        const bar = Math.floor(b / 4), chord = CHORDS[bar % 4], step = Math.floor(beat * 4), fs = beat * 4 - step;
        let x = 0, xl = 0, xr = 0;
        // kick (half time in dub), snare on 2 and 4, hats on eighths or sixteenths
        const kOn = p('half') > .5 ? b % 2 === 0 : true;
        if (kOn) { const tk = fb * beatLen / SR; x += Math.sin(2 * Math.PI * (45 * tk + 4 * (1 - Math.exp(-tk * 35)))) * Math.exp(-tk * 9) * p('kick'); }
        if (b % 2 === 1) { const ts = fb * beatLen / SR, nz = Math.random() * 2 - 1; x += (nz * .7 * Math.exp(-ts * 16) + Math.sin(2 * Math.PI * 185 * ts) * .4 * Math.exp(-ts * 30)) * p('snare'); }
        const hStep = p('sixteenth') > .5 ? fs : (beat * 2) % 1, th = hStep * (p('sixteenth') > .5 ? beatLen / 4 : beatLen / 2) / SR;
        const nz = Math.random() * 2 - 1, hp = nz - noiseLast; noiseLast = nz;
        const hat = hp * .35 * Math.exp(-th * 70) * p('hat'); xl += hat * .7; xr += hat;
        // bass: the chord's root, pulsing in eighths, through a soft low-pass
        ph[0] = (ph[0] + hz(chord[0] - 24) / SR) % 1;
        const saw = 2 * ph[0] - 1, gate = Math.exp(-((beat * 2) % 1) * 3);
        lp += (saw - lp) * (.02 + .1 * p('bright')); x += lp * .5 * gate * p('bass');
        // pad: three detuned saws per chord note
        let pad = 0;
        for (let k = 0; k < 3; k++) for (const d of [-.07, .07]) { const j = 1 + k * 2 + (d > 0 ? 1 : 0); ph[j] = (ph[j] + hz(chord[k]) * (1 + d / 100) / SR) % 1; pad += 2 * ph[j] - 1; }
        padLp += (pad / 6 - padLp) * (.008 + .05 * p('bright')); xl += padLp * .45 * p('pad'); xr += padLp * .4 * p('pad');
        // lead: an arpeggio of the chord, an octave up, sixteenths
        const note = chord[step % 3] + 12 + (step % 8 > 5 ? 12 : 0);
        ph[8] = (ph[8] + hz(note) / SR) % 1;
        const lead = (Math.sin(2 * Math.PI * ph[8]) + .3 * Math.sign(Math.sin(2 * Math.PI * ph[8])) * p('bright')) * Math.exp(-fs * 5) * .25 * p('lead');
        xl += lead; xr += lead * .8;
        // noise bed, and the riser of a build-up
        x += (Math.random() * 2 - 1) * .15 * p('noise');
        if (p('riser') > .01) { riserT += 1 / SR; ph[9] = (ph[9] + (200 + 120 * riserT * riserT) / SR) % 1; x += (Math.sin(2 * Math.PI * ph[9]) * .15 + (Math.random() * 2 - 1) * .08 * Math.min(1, riserT / 8)) * p('riser') * Math.min(1, riserT / 8); }
        // roughness: drive into a soft clipper
        const drive = 1 + 6 * p('rough'), sat = (v) => Math.tanh(v * drive) / Math.tanh(drive) * .8;
        out[2 * i] = Math.round(sat(x + xl) * 22000); out[2 * i + 1] = Math.round(sat(x + xr) * 22000);
      }
      return new Uint8Array(out.buffer);
    },
  };
}

const TEMPER = {
  'liquid metal': ['groove', 'its home'], glass: ['ambient', 'calm, consonant'], 'velvet flesh': ['ambient', 'tender, warm, dark'],
  obsidian: ['dub', 'dark, rough, heavy'], iridescent: ['bright', 'novel, shimmering (chills)'], fluorescent: ['groove', 'aroused, grooving, anticipating'],
  fire: ['aggressive', 'choleric: hot, dry, aggressive'], water: ['ambient', 'phlegmatic: calm, flowing, sad'], air: ['bright', 'sanguine: light, bright, sparse'],
  earth: ['dub', 'melancholic: heavy, steady bass'], 'saturn · lead': ['dub', 'slow, dark, grave'], 'jupiter · tin': ['bright', 'expansive, majestic, glad'],
  'mars · iron': ['aggressive', 'hot, rough, aggressive'], 'sun · gold': ['bright', 'the climax, radiance'], 'venus · copper': ['groove', 'sweet, consonant, sensual'],
  'mercury · quicksilver': ['frantic', 'quick, intricate, changeable'], 'moon · silver': ['ambient', 'dreamy, nocturnal, reflective'],
};

function timeline(a) {
  const st = [];
  const step = (secs, caption, style, enter, during) => st.push({ secs, caption, style, enter, during });
  const clear = () => { a.devCommand({ k: 'material', v: -1 }); window.__matSlots = null; a.DEV.matMix = undefined; for (const k of ['ring', 'ser']) delete a.FLO.force[k]; };
  step(9, 'silence: it falls asleep, breathing slowly', 'silence', clear);
  step(10, 'a quiet pad: it wakes', 'ambient');
  step(14, 'a groove: it finds the beat, locks in and dances', 'groove');
  MATERIALS.forEach((m, i) => step(5, `material ${i + 1}/17 · ${m} · ${TEMPER[m][1]}`, TEMPER[m][0], () => a.devCommand({ k: 'material', v: i })));
  step(8, 'mixing: fire, water, the Sun and the Moon marbled together', 'groove', () => { a.devCommand({ k: 'material', v: -1 }); window.__matSlots = { ids: [6, 7, 13, 16], w: [.3, .3, .2, .2] }; a.DEV.matMix = 1; });
  step(8, 'mixing: earth, Venus, Mercury and air', 'frantic', () => { window.__matSlots = { ids: [9, 14, 15, 8], w: [.3, .25, .25, .2] }; a.DEV.matMix = .9; });
  step(8, 'an even blend instead of territories', 'ambient', () => { a.DEV.matMix = 0; });
  step(14, 'free: it chooses what it is made of (aggressive music)', 'aggressive', clear);
  step(12, 'free: it chooses (calm music)', 'ambient');
  step(10, 'watery rings, like Saturn’s, crossing and merging', 'ambient', () => { a.devCommand({ k: 'material', v: 7 }); a.FLO.force.ring = 1; });
  const snake = (over) => () => { a.FLO.force.ring = 0; a.FLO.serp.show(a.U.uShellR.value, a.mind.pulseHz, { bars: 8, ...over }); };
  step(12, 'a serpent arrives: the figure of eight round the nucleus, its own rhythm and wandering', 'groove', () => { a.devCommand({ k: 'material', v: 15 }); snake({ kind: 'infinity', n: 1 })(); });
  step(10, 'a serpent on a Lissajous orbit', 'frantic', snake({ kind: 'lissajous', n: 1 }));
  step(10, 'a serpent on a trefoil knot', 'groove', snake({ kind: 'trefoil', n: 1 }));
  step(10, 'two serpents intertwined, half a loop apart', 'groove', snake({ kind: 'infinity', n: 2, twin: true }));
  step(12, 'three serpents on different orbits', 'drop', snake({ kind: 'torusknot', n: 3, twin: false }));
  step(10, 'rings and serpents together', 'groove', () => { a.devCommand({ k: 'material', v: 16 }); a.FLO.force.ring = 1; snake({ kind: 'rose', n: 2 })(); a.FLO.force.ring = 1; });
  step(7, 'glints: sunlight catching it', 'groove', () => { clear(); a.devCommand({ k: 'material', v: 13 }); }, (t) => { if ([.5, 2.2, 4].some((x) => t >= x && t < x + .021)) a.flourish('glint', 1, true); });
  step(6, 'a great star', 'bright', () => a.flourish('star', 1, true));
  step(5, 'glistening: facets catching the light', 'bright', () => a.flourish('glisten', 1, true));
  for (const [m, kind] of [[6, 'embers (fire)'], [7, 'bubbles in the water (water)'], [8, 'wind motes (air)'], [9, 'dust (earth)'], [13, 'star-dust (the Sun)'], [14, 'glimmers (Venus)']]) step(5, `particles: ${kind}`, TEMPER[MATERIALS[m]][0], () => a.devCommand({ k: 'material', v: m }));
  step(5, 'particles: sparks (fire on the kick)', 'aggressive', () => a.devCommand({ k: 'material', v: 12 }), (t) => { if (Math.floor(t * 2) !== Math.floor((t - .02) * 2)) a.particles.burst('spark', 14, a.U.uShellR.value); });
  step(10, 'a build-up… (anticipation)', 'build', () => { clear(); a.build(); });
  step(9, 'the drop', 'drop', () => a.drop());
  step(7, 'chills: the great star', 'bright', () => a.chill());
  step(3, '(silence…)', 'silence');
  step(5, 'startle: a sudden hit', 'drop', () => a.startle(1));
  step(7, 'it turns to beads', 'groove', () => a.beads());
  step(6, 'and melts back', 'groove', () => a.beads());
  step(5, 'love this: reward dopamine, a glint', 'groove', () => a.feedback(1));
  step(5, 'not this: punishment dopamine', 'groove', () => a.feedback(-1));
  step(6, 'a station of the Sun: it marks sunrise', 'ambient', () => a.cosmosEvent({ kind: 'station', text: 'Sunrise' }));
  step(6, 'a solar flare', 'bright', () => a.cosmosEvent({ kind: 'flare', text: 'an X1.2 solar flare' }));
  step(8, 'the sky around it (the ecliptic oriented to the horizon)', 'ambient', () => { a.COS.ring = true; a.drawSkyRing(); });
  step(7, 'bored: it grows a new form', 'groove', () => { a.COS.ring = false; a.drawSkyRing(); a.reform(); });
  step(7, 'a new section: its skin surfaces', 'bright', () => { a.morphSection(); a.skinFlush(.95, 'a new section'); });
  step(10, 'silence again: back to sleep (the tour starts over)', 'silence', clear);
  return st;
}

export function startShowcase(a) {
  const synth = createSynth(), steps = timeline(a);
  window.__noBurst = true;   // beads only at their own step, not whenever the synthetic music excites it
  // the caption
  const box = document.createElement('div');
  Object.assign(box.style, { position: 'fixed', left: '14px', right: '14px', bottom: '12px', zIndex: 50, font: '14px/1.4 system-ui, sans-serif', color: '#eee', textShadow: '0 1px 3px #000', pointerEvents: 'none' });
  box.innerHTML = '<div class="cap"></div><div style="height:3px;background:#ffffff22;margin-top:6px;border-radius:2px"><i style="display:block;height:100%;width:0;background:#d8b25a;border-radius:2px"></i></div><div class="hint" style="opacity:.55;font-size:11px;margin-top:4px">showcase · silent synthetic music · → next  ← back  space pause</div>';
  document.body.append(box);
  const cap = box.querySelector('.cap'), bar = box.querySelector('i');
  let i = -1, t = 0, paused = false;
  const go = (k) => {
    i = (k + steps.length) % steps.length; t = 0;
    const s = steps[i];
    synth.style(s.style);
    try { s.enter?.(); } catch (e) { console.error('showcase step', s.caption, e); }
    cap.textContent = `${i + 1}/${steps.length} · ${s.caption}`;
    console.log('[showcase]', cap.textContent);
  };
  addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') go(i + 1); else if (e.key === 'ArrowLeft') go(i - 1); else if (e.key === ' ') paused = !paused; });
  go(0);
  setInterval(() => {
    a.takePcm(synth.chunk());
    if (paused) return;
    t += CHUNK / SR;
    const s = steps[i];
    try { s.during?.(t); } catch {}
    bar.style.width = `${Math.min(100, (100 * t) / s.secs)}%`;
    if (t >= s.secs) go(i + 1);
  }, (CHUNK / SR) * 1000);
  window.__showcase = { go, get step() { return i; }, steps: steps.map((s) => s.caption), api: a };   // api: the page's handles, for lab harnesses
}
