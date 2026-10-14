// being/cosmos/sky-worker.mjs - computes the sky off the main process thread (~50 ms with all the rise/set searches),
// so dragging the pet never stutters. Message in: { id, at (ms), place }; out: { id, sky } or { id, error }.
import { parentPort } from 'node:worker_threads';
import { skyAt, dayArcs } from './sky.mjs';

let arcs = null, arcsAt = 0, arcsKey = '';   // the day's arcs change slowly: every 5 minutes, or when the place changes

parentPort.on('message', ({ id, at, place }) => {
  try {
    const sky = skyAt(new Date(at), place), key = `${place.lat},${place.lon}`;
    if (!arcs || at - arcsAt > 5 * 60e3 || key !== arcsKey) { arcs = dayArcs(new Date(at), place); arcsAt = at; arcsKey = key; }
    // where each body is now, from the fresh sky (the arcs' curves stay from the last 5-minute pass)
    sky.arcs = { ...arcs, bodies: arcs.bodies.map((b) => { const now = sky.bodies.find((x) => x.name === b.name); return now && Number.isFinite(now.alt) ? { ...b, alt: +now.alt.toFixed(1), az: +now.az.toFixed(1) } : b; }) };
    parentPort.postMessage({ id, sky });
  }
  catch (e) { parentPort.postMessage({ id, error: String(e && e.message || e) }); }
});
