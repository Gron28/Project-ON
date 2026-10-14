// setup/core.mjs pure parts: capabilities, error wording, shortcut location override, icon files.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { capabilities, explain, shortcutPaths, STEPS } from '../setup/core.mjs';
import { writeIcons } from '../setup/icon.mjs';

test('capabilities reports platform support and per-app capture', () => {
  const c = capabilities();
  assert.equal(c.supported, c.platform === 'win32' && c.arch === 'x64');
  assert.equal(typeof c.perApp, 'boolean');
  if (!c.supported) assert.equal(c.perApp, c.platform === 'win32' && c.build >= 20348);
});

test('explain turns npm output into one short sentence', () => {
  assert.match(explain('npm error code ENOTFOUND registry.npmjs.org'), /No connection/);
  assert.match(explain('EBUSY: resource busy or locked'), /Close ON/);
  assert.match(explain('ENOSPC: no space left'), /disk space/);
  assert.equal(explain('something odd', 'Packages failed. See details.'), 'Packages failed. See details.');
});

test('steps have an id and a short label', () => {
  for (const [id, label] of STEPS) { assert.match(id, /^[a-z]+$/); assert.ok(label.length < 14); }
});

test('BEING_SHORTCUTS_DIR keeps every shortcut inside one folder', () => {
  const dir = path.join(os.tmpdir(), 'being-sc');
  process.env.BEING_SHORTCUTS_DIR = dir;
  try { for (const p of Object.values(shortcutPaths())) assert.ok(p.startsWith(dir) && p.endsWith('Being.lnk')); }
  finally { delete process.env.BEING_SHORTCUTS_DIR; }
});

test('icons are a valid PNG and a PNG-compressed ICO', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'being-icon-'));
  try {
    const { png, ico } = await writeIcons(root);
    const p = await fs.readFile(png), i = await fs.readFile(ico);
    assert.deepEqual([...p.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(p.readUInt32BE(16), 256);
    for (let o = 8; o < p.length;) {   // every chunk's CRC matches
      const len = p.readUInt32BE(o), body = p.subarray(o + 4, o + 8 + len);
      assert.equal(p.readUInt32BE(o + 8 + len), zlib.crc32(body));
      o += 12 + len;
    }
    assert.equal(i.readUInt16LE(0), 0); assert.equal(i.readUInt16LE(2), 1);
    const n = i.readUInt16LE(4); assert.ok(n >= 3);
    for (let k = 0; k < n; k++) {
      const size = i.readUInt32LE(6 + k * 16 + 8), off = i.readUInt32LE(6 + k * 16 + 12);
      assert.ok(off + size <= i.length);
      assert.deepEqual([...i.subarray(off, off + 4)], [137, 80, 78, 71]);
    }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
