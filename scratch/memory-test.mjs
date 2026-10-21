// does a song's map converge to the song, and is a returning song recognised faster?
import { createEar } from '../being/ear.mjs';
import { createMap, dnaWeights, featureOf, blend, DIM } from '../being/memory.mjs';
const SR = 48000;
const songA = (t) => { const ph = t % 0.5; return 0.5 * Math.exp(-ph * 30) * Math.sin(2 * Math.PI * 55 * ph) + 0.06 * Math.sin(2 * Math.PI * 330 * t) * (1 + Math.sin(t)) + (t % 4 < 2 ? 0.05 * Math.sin(2 * Math.PI * 880 * t) : 0); };
const songB = (t) => 0.08 * (Math.sin(2 * Math.PI * 147 * t) + Math.sin(2 * Math.PI * 185 * t)) * (0.6 + 0.4 * Math.sin(t * 0.7)) + (Math.random() - 0.5) * 0.02;
function listen(map, gen, sec, label) {
  const ear = createEar(); const x = new Float32Array(DIM); let qeSum = 0, n = 0; const out = [];
  for (let t = 0, f = 0; t < sec; t += 0.1, f++) {
    for (let i = 0; i < 4800; i++) ear.sample(gen(t + i / SR));
    featureOf(ear.frame(), x);
    const r = map.learn(x, 0.1); qeSum += r.qe; n++;
    if (f % 100 === 99) { out.push(`${label} t=${(t + 0.1).toFixed(0)}s qe ${(qeSum / n).toFixed(3)} familiarity ${map.familiarity.toFixed(2)}`); qeSum = 0; n = 0; }
  }
  return out;
}
const dna = dnaWeights(42);
const general = createMap({ weights: dna, fast: false });
const a1 = createMap({ weights: blend(general.weights, dna, 0.15) });
console.log(listen(a1, songA, 60, 'song A, first time').join('\n'));
// the general map learns slowly from everything
listen(general, songA, 60, '');
const b1 = createMap({ weights: blend(general.weights, dna, 0.15) });
console.log(listen(b1, songB, 30, 'song B, first time').join('\n'));
// song A returns: starts from its memory
const a2 = createMap({ weights: blend(a1.weights, general.weights, 0.15), meta: { experience: a1.experience } });
console.log(listen(a2, songA, 20, 'song A, returning').join('\n'));
const fresh = createMap({ weights: blend(general.weights, dna, 0.15) });
console.log(listen(fresh, songA, 20, 'song A, if forgotten').join('\n'));
