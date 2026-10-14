// being/pressure.mjs - the body's own organ for bursting. Pure module (no DOM), so node --test can run it.
//
// Part of the distributed nervous system: the organ does not take orders from a central director. It reads the
// broadcast signals (arousal against the being's resting level, anticipation, groove, fatigue) and keeps its own state,
// like a charged drop. Charge builds from sustained excitement and leaks away (tau ~40 s). Surface tension holds the body
// together; fatigue weakens it, and after a burst it is much stronger for minutes (refractory). Pressure = charge / tension.
// Near the limit a charged drop sheds a few fine jets that carry off part of the charge (the Rayleigh limit: ~2% of the
// mass but ~15% of the charge; Duft et al. 2003), so small jets foreshadow a burst and keep it rare. At the limit, held
// for 1.5 s, or at a big drop in the music while pressure is high (an impact, the Weber-number analogue), the body bursts
// into a swarm. The swarm lives at least 20 s and gathers back into one body when pressure has fallen, or after 90 s.

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const clamp01 = (x) => clamp(x, 0, 1);
const fin = (x, d = 0) => (Number.isFinite(x) ? x : d);

export function createPressure({ rate = 0.03, leak = 40 } = {}) {
  let charge = 0, tension = 1, hold = 0, state = 'whole', since = 0, lastJet = -1e9, time = 0, bursts = 0;
  const events = [];
  const api = {
    get charge() { return charge; }, get tension() { return tension; }, get state() { return state; }, get bursts() { return bursts; },
    get pressure() { return charge / Math.max(0.2, tension); },
    /** how long the current state has lasted (s) */
    get since() { return time - since; },
    /**
     * @param s { arousal, aHome, anticipation, groove, energy (0..1), drop (a drop this frame), loud (0..1) }
     * @returns events: { type: 'jet', amount } | { type: 'burst' } | { type: 'gather' }
     */
    step(dt, s = {}) {
      events.length = 0;
      dt = clamp(fin(dt), 0, 0.1); time += dt;
      const A = clamp01(fin(s.arousal)), home = clamp01(fin(s.aHome, 0.4)), ant = clamp01(fin(s.anticipation)), groove = clamp01(fin(s.groove));
      const energy = clamp01(fin(s.energy, 0.8)), loud = clamp01(fin(s.loud, 0.5));
      // what charges it: excitement above its resting level, a build-up it anticipates, a long groove (only while it hears music)
      const drive = (Math.max(0, A - home - 0.1) * 2.2 + ant * 0.6 + groove * 0.5) * clamp01(loud * 4);
      const swarm = state === 'swarm';
      charge += dt * (rate * drive * (swarm ? 0.4 : 1)) - (dt / (swarm ? 15 : leak)) * charge;
      // tension: back to 1 after a burst (tau 2 min); fatigue (low energy) softens the skin
      tension += (1 - tension) * (dt / 120);
      const P = charge / Math.max(0.2, tension * (0.75 + 0.25 * energy));
      if (!swarm) {
        if (P > 0.7 && time - lastJet > 6) { lastJet = time; const amount = clamp01((P - 0.7) / 0.3); charge *= 0.85; events.push({ type: 'jet', amount }); }
        hold = P >= 1 ? hold + dt : 0;
        if (hold >= 1.5 || (s.drop && P > 0.6)) {
          state = 'swarm'; since = time; hold = 0; bursts++;
          charge *= 0.6; tension = 3;
          events.push({ type: 'burst' });
        }
      } else if (time - since > 20 && (P < 0.35 || time - since > 90)) {
        state = 'whole'; since = time; charge *= 0.5;
        events.push({ type: 'gather' });
      }
      if (!Number.isFinite(charge)) charge = 0; if (!Number.isFinite(tension)) tension = 1;
      return events;
    },
    /** the song changed or the listener asked: gather now */
    gather() { if (state === 'swarm') { state = 'whole'; since = time; charge *= 0.5; return true; } return false; },
    /** lab / listener: burst now (ignores the refractory skin) */
    burst() { if (state === 'whole') { state = 'swarm'; since = time; bursts++; charge *= 0.6; tension = 3; return true; } return false; },
    serialize() { return { v: 1, charge, tension: Math.max(1, tension) }; },
    restore(o) { if (o && o.v === 1) { charge = clamp(fin(o.charge), 0, 2); tension = clamp(fin(o.tension, 1), 1, 3); } },
  };
  return api;
}
