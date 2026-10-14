// The published files speak plainly: no term from the local word list (being/local/words.txt, one regular expression
// per line) appears outside the folders .gitignore keeps out. Without the local folder there is nothing to check.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname, LIST = path.join(ROOT, 'being/local/words.txt');
const SKIP = new Set(['node_modules', '.runtime', '.setup', '.git', 'inspo', '.atl', 'being/local', 'being/models', 'data/raw']);
const TEXT = /\.(mjs|cjs|js|html|css|md|json|sh|ps1|py|cmd|desktop|txt|wgsl|glsl)$/;
// scratch/: only the harnesses are published (.gitignore)
const published = (rel) => !rel.startsWith('scratch/') || (/^scratch\/[^/]+\.(cjs|mjs|sh|py)$/.test(rel));

test('no local term in a published file', { skip: !fs.existsSync(LIST) && 'no local word list' }, () => {
  const terms = fs.readFileSync(LIST, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((t) => new RegExp(t, 'i'));
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (SKIP.has(rel) || SKIP.has(e.name)) continue;
      if (e.isDirectory()) { walk(rel); continue; }
      if (!TEXT.test(e.name) || !published(rel)) continue;
      const st = fs.statSync(path.join(ROOT, rel)); if (st.size > 4e6) continue;
      fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n').forEach((line, i) => { for (const re of terms) { const m = line.match(re); if (m) hits.push(`${rel}:${i + 1}: ${m[0]}`); } });
    }
  };
  walk('');
  assert.deepEqual(hits, [], `${hits.length} local terms in published files:\n${hits.slice(0, 400).join('\n')}`);
});
