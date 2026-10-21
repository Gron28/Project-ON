// Runs the tests of the local word set (being/local/), when it is present; nothing otherwise.
import fs from 'node:fs';
const local = new URL('../being/local/', import.meta.url);
if (fs.existsSync(local)) for (const f of fs.readdirSync(local).filter((n) => n.endsWith('.test.mjs'))) await import(new URL(f, local));
