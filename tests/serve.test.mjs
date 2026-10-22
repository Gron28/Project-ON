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
    '/node_modules/electron/x', '/%2e%2e/x', '/being/index.html%00.png', '/being/%E0%A4%A', '/.setup/ready.json', '/scratch/a.cjs', '/lab/NOTEBOOK.md', '/lab/prototypes/../results/x.json',
    '/node_modules/three/examples/fonts/x.json', '/node_modules/three/package.json', '/', ''])
    assert.equal(resolveSafe(root, p), null, p);
  if (process.platform === 'win32') {
    assert.equal(resolveSafe(root, '/Being/Local/x.mjs'), null);
    assert.equal(resolveSafe(root, '/C:/Windows/win.ini'), null);
    assert.equal(resolveSafe(root, '/being\..\..\on-x\a'), null);
  }
});

test('the page and the builds it imports are served', () => {
  assert.equal(resolveSafe(root, '/being/index.html'), path.join(root, 'being', 'index.html'));
  assert.equal(resolveSafe(root, '/node_modules/three/build/three.module.js'), path.join(root, 'node_modules', 'three', 'build', 'three.module.js'));
  assert.equal(resolveSafe(root, '/node_modules/onnxruntime-web/dist/ort.min.mjs'), path.join(root, 'node_modules', 'onnxruntime-web', 'dist', 'ort.min.mjs'));
  assert.equal(resolveSafe(root, '/lab/prototypes/nervous-system.html'), path.join(root, 'lab', 'prototypes', 'nervous-system.html'));
  assert.equal(resolveSafe(root, '/node_modules/three/examples/jsm/controls/OrbitControls.js'), path.join(root, 'node_modules', 'three', 'examples', 'jsm', 'controls', 'OrbitControls.js'));
  assert.equal(resolveSafe(root, '/being/my%20file.png'), path.join(root, 'being', 'my file.png'));
});
