import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const { writeFileAtomic } = createRequire(import.meta.url)('../being/atomic.cjs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'being-atomic-'));

test('a write creates the file', () => {
  const dir = tmp(), f = path.join(dir, 'a.json');
  writeFileAtomic(f, '{"a":1}');
  assert.equal(fs.readFileSync(f, 'utf8'), '{"a":1}');
});

test('a write replaces an existing file whole, text or bytes', () => {
  const dir = tmp(), f = path.join(dir, 'a.json'), p = path.join(dir, 'a.png');
  fs.writeFileSync(f, 'x'.repeat(1000));
  writeFileAtomic(f, 'short');
  assert.equal(fs.readFileSync(f, 'utf8'), 'short');
  writeFileAtomic(p, Buffer.from([1, 2, 3]));
  assert.deepEqual([...fs.readFileSync(p)], [1, 2, 3]);
});

test('no temporary file is left behind, after success or failure', () => {
  const dir = tmp();
  writeFileAtomic(path.join(dir, 'a.json'), '1');
  writeFileAtomic(path.join(dir, 'a.json'), '2');
  fs.mkdirSync(path.join(dir, 'taken'));   // renaming a file over a directory fails
  assert.throws(() => writeFileAtomic(path.join(dir, 'taken'), '3'));
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp')), []);
});
