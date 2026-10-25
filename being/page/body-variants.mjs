// being/page/body-variants.mjs - the body program specialised to the materials on show. Pure (strings).
// propShade (being/page/shaders.mjs) is one chain of cases, one per proposed material, stone and gem (ids 6..38, the last as
// the final else). A program carrying all 33 makes every pixel several times slower, taken or not. The body only ever shades
// the four shown slots, so a program with just their cases draws the same picture: specialise(src, ids) keeps those.
const FN = 'vec4 propShade(', HEAD = /\n    if \( id == \d+ \) \{/g, TAIL = "\n    // the light's four casts";
const MARK = /\n    (?:if|\} else if) \( id == (\d+) \) \{|\n    \} else \{/g;

/** the cases of propShade's chain: Map id -> body text (between its braces); null if the chain is not found */
export function propCases(src) {
  const f = src.indexOf(FN); if (f < 0) return null;
  HEAD.lastIndex = f; const h = HEAD.exec(src), a = h ? h.index : -1, b = a < 0 ? -1 : src.indexOf(TAIL, a);
  if (a < 0 || b < 0) return null;
  const chain = src.slice(a, b), marks = [];
  for (const m of chain.matchAll(MARK)) marks.push({ id: m[1] ? +m[1] : 38, at: m.index, open: m.index + m[0].length });
  const end = chain.lastIndexOf('\n    }'), cases = new Map();
  marks.forEach((m, i) => cases.set(m.id, chain.slice(m.open, i + 1 < marks.length ? marks[i + 1].at : end)));
  return { a, b, cases };
}

/** src with propShade's chain cut down to ids (any not in the chain are ignored); src itself when the chain is not found */
export function specialise(src, ids) {
  const pc = propCases(src);
  if (!pc) return src;
  const keep = [...new Set(ids)].filter((id) => pc.cases.has(id)).sort((x, y) => x - y);
  const chain = keep.map((id, i) => `\n    ${i ? '} else if' : 'if'} ( id == ${id} ) {${pc.cases.get(id)}`).join('') + (keep.length ? '\n    }' : '');
  return src.slice(0, pc.a) + chain + src.slice(pc.b);
}

/** the propShade cases the shown slots need ({ ids, w } as uMid/uMw; prop: the proposed materials on): sorted, [] for none.
 *  The same test as matShade's: a slot counts when its weight is over .002 */
export function neededCases(ids, w, prop) {
  const out = [];
  for (let s = 0; s < 4; s++) { const id = Math.round(ids[s]); if (w[s] > .002 && (id >= 17 || (prop && id >= 6)) && !out.includes(id)) out.push(id); }
  return out.sort((x, y) => x - y);
}
