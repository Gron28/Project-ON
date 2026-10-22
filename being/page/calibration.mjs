// being/page/calibration.mjs - tap to sync: tap on every beat, the median gap between tap and shown beat sets the speaker delay
export function createCalibration({ say, DIALS, pet }) {
  const C = { on: false, last: 0, deltas: [], pending: [] };
  const BEATS = new Float64Array(16); let beatN = 0;   // wall-clock moments at which beat events were shown
  function calibrate() { C.on = true; C.last = performance.now(); C.deltas.length = 0; C.pending.length = 0; say('tap the creature or Space on every beat you hear · 8 taps', 10000); }
  function cancelCal(msg) { C.on = false; say(msg); }
  function matched(delta) {
    C.deltas.push(delta); C.last = performance.now();
    if (C.deltas.length < 8) { say('tap ' + C.deltas.length + ' / 8', 1500); return; }
    const s = C.deltas.slice().sort((a, b) => a - b), med = (s[3] + s[4]) / 2, off = Math.round(Math.max(0, Math.min(400, DIALS.sync + med + 25)));
    C.on = false; DIALS.setSync(off); say('speaker delay set to ' + off + ' ms');
  }
  function tap(now) {
    C.last = now;
    let best = null;
    for (let i = 0; i < Math.min(beatN, 16); i++) { const b = BEATS[i], d = now - b; if (Math.abs(d) <= 400 && (best === null || Math.abs(d) < Math.abs(best))) best = d; }
    if (best !== null) matched(best); else C.pending.push(now);   // the beat may not have been shown yet
  }
  function beatShown(now) {
    BEATS[beatN++ % 16] = now;
    if (!C.on) return;
    for (let i = C.pending.length - 1; i >= 0; i--) if (now - C.pending[i] > 400) C.pending.splice(i, 1); else if (Math.abs(C.pending[i] - now) <= 400) { const d = C.pending[i] - now; C.pending.splice(i, 1); matched(d); if (!C.on) return; }
  }
  pet.onCalibrate(calibrate);
  addEventListener('keydown', e => { if (e.key === 'Escape' && C.on) cancelCal('calibration cancelled'); if (e.code === 'Space' && C.on) { e.preventDefault(); tap(performance.now()); } });
  return { C, calibrate, cancelCal, tap, beatShown };
}
