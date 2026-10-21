// being/cosmos/service.mjs - the sky and its feeds, gathered in the main process and broadcast to the being and the sky window.
//
//   sky       computed here (being/cosmos/sky.mjs, in a worker thread) every 20 s for the chosen place: no network
//   space     NOAA Space Weather Prediction Center JSON (services.swpc.noaa.gov), every 5 min: planetary K index (1-minute
//             estimate), real-time solar wind and magnetic field (the active spacecraft), GOES X-ray flux and the latest
//             flare, NOAA R/S/G scales.
//   rng       one 200-bit trial per second: ANU quantum random numbers (qrng.anu.edu.au, 1024 x 16 bits once a minute)
//             or, when that fails, the operating system's generator; kept for two hours on disk (being/cosmos/rng.mjs)
// Each feed backs off on failure and reports its source, age and last error; nothing is invented when a feed is down.
import { Worker } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createMonitor, trialsFromBytes } from './rng.mjs';

const SWPC = 'https://services.swpc.noaa.gov/';
const get = async (url, timeout = 15000) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { 'User-Agent': 'Being (desktop music visualizer)' } });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
};
const xclass = (flux) => { if (!(flux > 0)) return null; const L = ['A', 'B', 'C', 'M', 'X'], e = Math.min(4, Math.max(0, Math.floor(Math.log10(flux)) + 8)); return L[e] + (flux / 10 ** (e - 8)).toFixed(1); };

async function fetchSpace() {
  const [kp, wind, mag, xr, flares, scales] = await Promise.allSettled([
    get(SWPC + 'json/planetary_k_index_1m.json'), get(SWPC + 'json/rtsw/rtsw_wind_1m.json'), get(SWPC + 'json/rtsw/rtsw_mag_1m.json'),
    get(SWPC + 'json/goes/primary/xrays-6-hour.json'), get(SWPC + 'json/goes/primary/xray-flares-latest.json'), get(SWPC + 'products/noaa-scales.json')]);
  const v = (r) => (r.status === 'fulfilled' ? r.value : null);
  const latestActive = (arr) => { if (!Array.isArray(arr)) return null; const a = arr.filter((x) => x.active); const pool = a.length ? a : arr; return pool.reduce((m, x) => (!m || x.time_tag > m.time_tag ? x : m), null); };
  const k = v(kp), w = latestActive(v(wind)), m = latestActive(v(mag)), x = v(xr), f = v(flares), sc = v(scales);
  const k1 = Array.isArray(k) && k.length ? k[k.length - 1] : null;
  const long = Array.isArray(x) ? x.filter((e) => e.energy === '0.1-0.8nm').at(-1) : null;
  const fl = Array.isArray(f) && f[0] ? f[0] : null, big = fl && /^[MX]/.test(fl.max_class || '');
  const s0 = sc && sc['0'];
  if (!k1 && !w && !long) throw new Error('no space weather product answered');
  return { at: k1?.time_tag ?? w?.time_tag ?? null, kp: k1 ? +(k1.estimated_kp ?? k1.kp_index).toFixed(2) : null,
    windSpeed: w?.proton_speed ?? null, density: w?.proton_density ?? null, windSource: w?.source ?? null,
    bt: m?.bt ?? null, bz: m?.bz_gsm ?? null, xray: long ? xclass(long.flux) : null,
    lastFlare: fl ? { cls: fl.max_class, at: fl.max_time } : null, flare: big ? fl.max_class : null, flareAt: big ? fl.max_time : null,
    scales: s0 ? { R: +s0.R.Scale || 0, S: +s0.S.Scale || 0, G: +s0.G.Scale || 0 } : null, source: 'NOAA SWPC' };
}
async function fetchQuantum() {
  const j = await get('https://qrng.anu.edu.au/API/jsonI.php?length=1024&type=uint16', 20000);
  if (!j.success || !Array.isArray(j.data)) throw new Error('ANU QRNG did not answer');
  const b = Buffer.alloc(j.data.length * 2); j.data.forEach((x, i) => b.writeUInt16BE(x & 0xffff, i * 2));
  return trialsFromBytes(b).slice(0, 60);   // 81 trials in 2048 bytes; one minute of them
}

/**
 * @param {{ dir: string, place: () => object, wants: () => {space:boolean, rng:boolean}, onUpdate: (state) => void }} o
 */
export function createCosmos(o) {
  const rngFile = path.join(o.dir, 'being-rng.json');
  let rng; try { rng = createMonitor(JSON.parse(fs.readFileSync(rngFile, 'utf8'))); } catch { rng = createMonitor(); }
  const state = { sky: null, space: null, rng: rng.read(), feeds: {} };
  const feed = (name, patch) => { state.feeds[name] = { ...(state.feeds[name] || {}), ...patch }; };
  const worker = new Worker(new URL('./sky-worker.mjs', import.meta.url), { execArgv: [] });   // not the parent's flags
  let reqId = 0, stopped = false;
  const timers = [];
  worker.on('message', (m) => {
    if (m.id !== reqId) return;
    if (m.sky) { state.sky = m.sky; feed('sky', { ok: true, at: new Date().toISOString(), error: null, source: 'astronomy-engine (computed here)' }); }
    else feed('sky', { ok: false, error: m.error });
    o.onUpdate(state);
  });
  worker.on('error', (e) => feed('sky', { ok: false, error: e.message }));
  const sky = () => { if (!stopped) worker.postMessage({ id: ++reqId, at: Date.now(), place: o.place() }); };

  // a feed polled every `every` ms while wanted, backing off to 30 min on repeated failure
  function poll(name, every, wanted, run) {
    let fails = 0, timer = null, lastOk = 0;
    const tick = async () => {
      if (stopped) return;
      if (!wanted()) { timer = setTimeout(tick, 5000); return; }   // check again soon in case it is switched on
      if (Date.now() - lastOk < every && fails === 0) { timer = setTimeout(tick, Math.min(every, 5000)); return; }
      try { await run(); fails = 0; lastOk = Date.now(); feed(name, { ok: true, at: new Date().toISOString(), error: null }); }
      catch (e) { fails++; feed(name, { ok: false, error: String(e.message || e), failedAt: new Date().toISOString() }); }
      o.onUpdate(state);
      timer = setTimeout(tick, fails ? Math.min(30 * 60000, 15000 * 2 ** Math.min(fails, 7)) : Math.min(every, 5000));
    };
    timers.push({ stop: () => clearTimeout(timer), kick: () => { lastOk = 0; fails = 0; clearTimeout(timer); timer = setTimeout(tick, 50); } });
    timer = setTimeout(tick, 500);
    return timers.at(-1);
  }
  poll('space', 5 * 60000, () => o.wants().space, async () => { state.space = await fetchSpace(); });
  poll('rng', 60000, () => o.wants().rng, async () => {
    let source = 'quantum';
    try { rng.add(await fetchQuantum(), 'quantum'); }
    catch (e) { source = 'local'; rng.add(trialsFromBytes(crypto.randomBytes(25 * 60)), 'local'); feed('rng', { quantumError: String(e.message || e) }); }
    state.rng = { ...rng.read(), source };
    try { fs.writeFileSync(rngFile, JSON.stringify(rng.save())); } catch {}
  });
  sky(); const skyTimer = setInterval(sky, 20000);

  return {
    state: () => state,
    /** the place changed: recompute the sky at once */
    moved() { sky(); },
    refresh: sky,
    stop() { stopped = true; clearInterval(skyTimer); timers.forEach((t) => t.stop()); worker.terminate(); },
  };
}
