// lab/prototypes/nervous-system/stimuli.mjs - synthetic sound for the nervous-system lab, generated sample by sample at 48 kHz.
// Modes are continuous sources (click, groove, tone, rough, build, poly, silence); burst, drop-a-beat and tempo jump are
// one-off overlays. Every drum onset is also logged with its time, so the lab can compare what was played with what was felt.

const SR = 48000, TAU = Math.PI * 2;

function oneShots() {
  let s = 12345; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296 * 2 - 1; };
  const mk = (sec, f) => { const n = Math.round(sec * SR), b = new Float32Array(n); for (let i = 0; i < n; i++) b[i] = f(i / SR, i); return b; };
  // kick: a falling sine (120 -> 45 Hz) with a fast decay and a click on top
  let ph = 0;
  const kick = mk(0.35, (t) => { ph += TAU * (45 + 75 * Math.exp(-t / 0.03)) / SR; return 0.9 * Math.sin(ph) * Math.exp(-t / 0.12) + 0.25 * rnd() * Math.exp(-t / 0.003); });
  // snare: a 190 Hz body plus noise, high-passed by a first difference
  let prev = 0;
  const snare = mk(0.25, (t) => { const n = rnd(), hp = n - prev; prev = n; return 0.35 * Math.sin(TAU * 190 * t) * Math.exp(-t / 0.05) + 0.4 * hp * Math.exp(-t / 0.08); });
  // hat: noise, twice differenced (bright), very short
  let p1 = 0, p2 = 0;
  const hat = mk(0.06, (t) => { const n = rnd(), d1 = n - p1, d2 = d1 - p2; p1 = n; p2 = d1; return 0.18 * d2 * Math.exp(-t / 0.012); });
  const click = mk(0.02, (t) => (0.6 * Math.sin(TAU * 2000 * t) + 0.3 * Math.sin(TAU * 1000 * t)) * Math.exp(-t / 0.004));
  const block = mk(0.05, (t) => 0.5 * Math.sin(TAU * 800 * t) * Math.exp(-t / 0.012));   // a woodblock, for the 3 of 3:2
  // startle: a quarter second of loud broadband noise with an instant attack
  const burst = mk(0.25, (t) => 0.95 * rnd() * Math.min(1, Math.exp(-(t - 0.05) / 0.08)));
  return { kick, snare, hat, click, block, burst };
}

export function createStimuli() {
  const S = oneShots();
  const voices = [];                  // { buf, i, amp }
  const log = [];                     // { t (s), type } onsets played (kick/snare/hat/click/burst), recent only
  let n = 0, mode = 'silence', modeAt = 0, nextStep = 0, step = 0;
  let tonePh = 0, amPh = 0, subPh = 0, ns = 777;
  const o = { bpm: 120, sync: 0.25, freq: 440, level: 0.8, skipKick: false };
  const play = (type, amp = 1) => { voices.push({ buf: S[type], i: 0, amp }); log.push({ t: n / SR, type }); if (log.length > 256) log.shift(); };
  const noise = () => { ns = (Math.imul(ns, 1103515245) + 12345) | 0; return (ns >>> 0) / 4294967296 * 2 - 1; };
  const kick = (amp) => { if (o.skipKick) { o.skipKick = false; log.push({ t: n / SR, type: 'omitted' }); return; } play('kick', amp); };

  // what plays on 16th step k (0..15 of a bar) in each rhythmic mode
  function onStep(k) {
    const sync = o.sync;
    if (mode === 'click') { play('click', k === 0 ? 1 : 0.6); return; }   // stepped in beats, see below
    if (mode === 'groove' || (mode === 'build' && buildPart() !== 'build')) {
      const drop = mode === 'build' && buildPart() === 'drop';
      if (k === 0 || (k === 8 && sync < 0.8)) kick(drop ? 1 : 0.9);
      if (sync > 0.3 && k === 10) kick(0.7);
      if (sync > 0.55 && k === 7) kick(0.6);
      if (sync > 0.8 && (k === 3 || k === 14)) kick(0.6);
      if (k === 4 || k === 12) play('snare', 0.9);
      if (sync > 0.65 && k === 15) play('snare', 0.35);
      if (k % 2 === 0) play('hat', k % 4 === 0 ? 0.9 : 0.6);
      if (drop && k % 2 === 1) play('hat', 0.5);
      return;
    }
    if (mode === 'build') {   // a snare roll that doubles every bar, kick gone, ending in one beat of silence before the drop
      const bar = barInMode() - 4;
      if (bar === 3 && k >= 12) return;
      const every = [4, 2, 1, 1][bar] ?? 1;
      if (k % every === 0) play('snare', 0.35 + 0.15 * bar + 0.03 * k / 4);
      return;
    }
    if (mode === 'poly') { if (k === 0 || k === 8) kick(0.9); }
  }
  const stepLen = () => SR * 60 / o.bpm / (mode === 'click' ? 1 : 4);
  const barInMode = () => Math.floor((n - modeAt) / (SR * 240 / o.bpm));
  const buildPart = () => { const b = barInMode() % 16; return b < 4 ? 'groove' : b < 8 ? 'build' : 'drop'; };

  function sample() {
    let x = 0;
    if (mode === 'click' || mode === 'groove' || mode === 'build' || mode === 'poly') {
      if (n >= nextStep) {
        const len = stepLen();
        onStep(mode === 'click' ? 0 : step % 16);
        step++; nextStep += len;
      }
      if (mode === 'poly') {   // three woodblocks against two kicks in each bar
        const bar = SR * 240 / o.bpm, u = ((n - modeAt) % bar) / bar, prevU = ((n - 1 - modeAt) % bar) / bar;
        for (let j = 0; j < 3; j++) { const at = j / 3; if (u >= at && (prevU < at || prevU > u)) play('block', 0.8); }
      }
      if (mode === 'build') {
        const part = buildPart(), bar = barInMode() % 16;
        if (part === 'build') { const u = (bar - 4 + ((n - modeAt) % (SR * 240 / o.bpm)) / (SR * 240 / o.bpm)) / 4; if (u < 0.94) x += 0.12 * u * u * noise(); }   // a rising wash
        if (part === 'drop') { subPh += TAU * 45 / SR; x += 0.35 * Math.sin(subPh); }                                                   // the drop's sub-bass
      }
    } else if (mode === 'tone') {
      tonePh += TAU * o.freq / SR; x += 0.3 * Math.sin(tonePh) * Math.min(1, (n - modeAt) / (0.05 * SR));
    } else if (mode === 'rough') {
      amPh += TAU * 40 / SR; x += 0.35 * noise() * (0.5 + 0.5 * Math.sin(amPh)) * Math.min(1, (n - modeAt) / (0.02 * SR));
    }
    for (let v = voices.length - 1; v >= 0; v--) {
      const vo = voices[v]; x += vo.buf[vo.i++] * vo.amp;
      if (vo.i >= vo.buf.length) voices.splice(v, 1);
    }
    n++;
    return x * o.level;
  }

  return {
    o, log,
    get mode() { return mode; }, get time() { return n / SR; },
    /** the tempo the stimulus is playing (0 when it has none) */
    get bpm() { return mode === 'click' || mode === 'groove' || mode === 'build' || mode === 'poly' ? o.bpm : 0; },
    setMode(m) { mode = m; modeAt = n; nextStep = n; step = 0; tonePh = 0; },
    burst() { play('burst', 1); },
    dropBeat() { o.skipKick = true; },
    tempoJump() { o.bpm = o.bpm >= 150 ? Math.round(o.bpm / 1.25) : Math.round(o.bpm * 1.25); },
    fill(out) { for (let i = 0; i < out.length; i++) out[i] = sample(); return out; },
  };
}
