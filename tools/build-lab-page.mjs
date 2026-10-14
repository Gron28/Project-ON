// build-lab-page.mjs - renders the lab notebook page (lab/site/lab.html) from lab/results/*.json.
// Re-run after every experiment, then republish the same file so the live page updates.
//   node tools/build-lab-page.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = (f) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'lab', 'results', f), 'utf8')); } catch { return null; } };

const e01 = R('01-auditory-anatomy.json');
const e02 = R('02-rhythm-transfer-g3.json');
const e03 = R('03-criticality.json');
const e04 = R('04-kinouchi.json');
const e05 = R('05-missing-pulse.json');
const STATUS = JSON.parse(fs.readFileSync(path.join(ROOT, 'lab', 'status.json'), 'utf8'));

// ---- chart data, small and explicit ----------------------------------------------------------------
const data = {};
if (e01) data.e01 = e01.layers.map((L) => ({ hop: L.hop, neurons: L.neurons, inhib: Math.round(L.inhibitoryShare * 1000) / 10 }));
if (e02) data.e02 = {
  vs: [1, 2, 3, 4].map((h) => ({ name: `Relay ${h}`, points: e02.am.map((r) => [r.f, r.layers[h].vs]).filter((p) => p[1] !== null) })),
  rate: e02.am[0].layers.map((L) => ({ hop: L.hop, hz: L.hz })),
};
if (e03) data.e03 = [1, 1.5, 2, 3].map((w) => ({ name: `Synapses ×${w}`, points: e03.runs.filter((r) => r.wScale === w && r.sigma !== null).map((r) => [r.earHz, r.sigma]) })).filter((s) => s.points.length);
if (e04) data.e04 = {
  dr: [{ name: 'Dynamic range', points: e04.curves.map((c) => [c.sigma, c.deltaDb]) }],
  resp: e04.curves.filter((c) => [0, 1, 1.5].includes(c.sigma)).map((c) => ({ name: `σ = ${c.sigma}`, points: e04.rates.map((r, i) => [r, c.F[i]]).filter((p) => p[1] > 0) })),
};
if (e05) {
  const k = (s, b, a) => e05.results[`${s}@${a}`]?.[b]?.contrast2Hz ?? null;
  data.e05 = ['linear', 'critical', 'motor'].map((b) => ({ bank: b, iso: k('isochronous', b, 0.03), miss: k('missingPulse', b, 0.03), beat: e05.results['missingPulse@0.03']?.[b]?.beatBand?.strongestHz }));
}

const html = fs.readFileSync(path.join(ROOT, 'tools', 'lab-page.template.html'), 'utf8')
  .replace('/*__DATA__*/null', JSON.stringify(data))
  .replace('/*__STATUS__*/null', JSON.stringify(STATUS))
  .replace('__UPDATED__', new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }));
fs.mkdirSync(path.join(ROOT, 'lab', 'site'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'lab', 'site', 'lab.html'), html);
console.log('wrote lab/site/lab.html', (html.length / 1024).toFixed(0), 'KB');
