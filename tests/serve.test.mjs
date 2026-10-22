import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveSafe } from '../tools/serve.mjs';

// a root with a sibling that shares its name as a prefix (root 'on', sibling 'on-x'): a startsWith(root) check let it through
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'being-serve-')), root = path.join(base, 'on');
fs.mkdirSync(path.join(base, 'on-x'), { recursive: true }); fs.writeFileSync(path.join(base, 'on-x', 'a'), 'secret');

test('paths outside the allowlist or the root are refused', () => {
  for (const p of ['/../on-x/a', '/..%2fon-x/a', '/being/../../on-x/a', '/.git/config', '/being/local/x.mjs', '/being/../.git/config',
    '/node_modules/electron/x', '/%2e%2e/x', '/being/index.html%00.png', '/being/%E0%A4%A', '/.setup/ready.json', '/scratch/a.cjs', '/lab/NOTEBOOK.md', '/lab/prototypes/../results/x.json', '/lab/results/e04.json', '/lab/organism/../NOTEBOOK.md',
    '/node_modules/three/examples/fonts/x.json', '/node_modules/three/package.json', '/', ''])
    assert.equal(resolveSafe(root, p), null, p);
  if (process.platform === 'win32') {
    assert.equal(resolveSafe(root, '/Being/Local/x.mjs'), null);
    assert.equal(resolveSafe(root, '/C:/Windows/win.ini'), null);
    assert.equal(resolveSafe(root, '/being\\..\\..\\on-x\\a'), null);
    assert.equal(resolveSafe(root, '/being%5c..%5c..%5con-x%5ca'), null);
  }
  // other names Windows gives the same folder: a stream, trailing dots or spaces, a short name
  for (const p of ['/being/local::$INDEX_ALLOCATION/page.mjs', '/being/local./page.mjs', '/being/local%20/page.mjs', '/being/LOCAL~1/page.mjs', '/being/index.html::$DATA'])
    assert.equal(resolveSafe(root, p), null, p);
});

test('a link inside an allowed folder cannot lead to a refused one', (t) => {
  const r = path.join(base, 'linked'), local = path.join(r, 'being', 'local');
  fs.mkdirSync(local, { recursive: true }); fs.writeFileSync(path.join(local, 'page.mjs'), 'secret');
  try { fs.symlinkSync(local, path.join(r, 'being', 'door'), 'junction'); } catch { t.skip('cannot make links here'); return; }
  assert.equal(resolveSafe(r, '/being/door/page.mjs'), null);
});

test('names that only start with two dots are still names', () => {
  assert.equal(resolveSafe(root, '/being/..foo.png'), path.join(root, 'being', '..foo.png'));
});

test('the page and the builds it imports are served', () => {
  assert.equal(resolveSafe(root, '/being/index.html'), path.join(root, 'being', 'index.html'));
  assert.equal(resolveSafe(root, '/node_modules/three/build/three.module.js'), path.join(root, 'node_modules', 'three', 'build', 'three.module.js'));
  assert.equal(resolveSafe(root, '/node_modules/onnxruntime-web/dist/ort.min.mjs'), path.join(root, 'node_modules', 'onnxruntime-web', 'dist', 'ort.min.mjs'));
  assert.equal(resolveSafe(root, '/lab/prototypes/nervous-system.html'), path.join(root, 'lab', 'prototypes', 'nervous-system.html'));
  assert.equal(resolveSafe(root, '/node_modules/three/examples/jsm/controls/OrbitControls.js'), path.join(root, 'node_modules', 'three', 'examples', 'jsm', 'controls', 'OrbitControls.js'));
  assert.equal(resolveSafe(root, '/being/my%20file.png'), path.join(root, 'being', 'my file.png'));
  assert.equal(resolveSafe(root, '/lab/organism/organism.mjs'), path.join(root, 'lab', 'organism', 'organism.mjs'));
  assert.equal(resolveSafe(root, '/lab/results/organism-best.json'), path.join(root, 'lab', 'results', 'organism-best.json'));
});
