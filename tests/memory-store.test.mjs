import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const { createStore, segment } = createRequire(import.meta.url)('../being/memory-store.cjs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'being-mem-'));
const PNG = 'data:image/png;base64,' + Buffer.from('png').toString('base64');

test('songs are filed by artist and album, and load back by key', () => {
  const root = tmp(), s = createStore(root);
  s.save(7, 'spotify|Song A|Band', { meta: { title: 'Song A', artist: 'Band', album: 'First LP' } }, PNG);
  s.save(7, 'spotify|Song B|Band', { meta: { title: 'Song B', artist: 'Band' } }, PNG);
  const lp = path.join(root, '7', 'Band', 'First LP'), singles = path.join(root, '7', 'Band', 'Singles');
  assert.equal(fs.readdirSync(lp).filter((n) => n.endsWith('.png')).length, 1);
  assert.equal(fs.readdirSync(singles).filter((n) => n.endsWith('.json')).length, 1);
  assert.equal(createStore(root).load(7, 'spotify|Song A|Band').meta.album, 'First LP');
  assert.equal(s.list(7).length, 2);
});

test('a song moves folder when its album becomes known, leaving no empty folders', () => {
  const root = tmp(), s = createStore(root);
  s.save(1, 'k', { meta: { title: 'T', artist: 'A' } }, PNG);
  s.save(1, 'k', { meta: { title: 'T', artist: 'A', album: 'Al' } }, null);
  assert.ok(!fs.existsSync(path.join(root, '1', 'A', 'Singles')));
  const files = fs.readdirSync(path.join(root, '1', 'A', 'Al'));
  assert.deepEqual(files.map((n) => path.extname(n)).sort(), ['.json', '.png']);
});

test('old flat memories are migrated when loaded or listed', () => {
  const root = tmp(), d = path.join(root, '3');
  fs.mkdirSync(d, { recursive: true });
  const flat = (key, title) => {
    const h = crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
    fs.writeFileSync(path.join(d, h + '.json'), JSON.stringify({ meta: { title, artist: 'Someone' } }));
    fs.writeFileSync(path.join(d, h + '.png'), 'x');
    return h;
  };
  const h1 = flat('old|key', 'Old'); flat('other|key', 'Other');
  const s = createStore(root);
  assert.equal(s.load(3, 'old|key').meta.title, 'Old');
  assert.ok(!fs.existsSync(path.join(d, h1 + '.json')));
  assert.equal(s.list(3).length, 2);
  assert.deepEqual(fs.readdirSync(d).filter((n) => /^[0-9a-f]{16}\./.test(n)), []);
});

test('names are made safe for the file system', () => {
  assert.equal(segment('AC/DC: Live?', 'x'), 'AC DC Live');
  assert.equal(segment('con', 'x'), '_con');
  assert.equal(segment('  ...  ', 'fallback'), 'fallback');
});
