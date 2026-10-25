import test from 'node:test';
import assert from 'node:assert/strict';
import { bodyFragment } from '../being/page/shaders.mjs';
import { propCases, specialise, neededCases } from '../being/page/body-variants.mjs';

const SRC = bodyFragment({ EXT: { shader: { decl: '', screen: '', bubbles: '' } }, NOTES: 12, ND: 14, NT: 44, TP: 11, NS: 5 });

test('body variants: propShade has one case per proposed material, stone and gem (6..38)', () => {
  const pc = propCases(SRC);
  assert.ok(pc);
  assert.deepEqual([...pc.cases.keys()].sort((a, b) => a - b), Array.from({ length: 33 }, (_, i) => i + 6));
  for (const body of pc.cases.values()) assert.ok(body.includes('col =') || body.includes('col +='), 'each case sets its colour');
});

test('body variants: a specialised program keeps exactly the shown cases, every one of them whole', () => {
  const pc = propCases(SRC), all = specialise(SRC, [...pc.cases.keys()]);
  for (const body of pc.cases.values()) assert.ok(all.includes(body));
  const two = specialise(SRC, [21, 7]), pt = propCases(two);
  assert.deepEqual([...pt.cases.keys()], [7, 21]);
  assert.equal(pt.cases.get(7), pc.cases.get(7));
  assert.ok(!two.includes(pc.cases.get(6)) && !two.includes(pc.cases.get(38)));
  assert.equal(specialise(SRC, [38]).includes('if ( id == 38 )'), true);   // the final else becomes its own case
  assert.ok(specialise(SRC, []).length < two.length);
  assert.equal(specialise('no chain here', [7]), 'no chain here');
});

test('body variants: the needed cases follow matShade\'s slot test', () => {
  assert.deepEqual(neededCases([0, 7, 20, 3], [.6, .3, .1, 0], true), [7, 20]);
  assert.deepEqual(neededCases([0, 7, 20, 3], [.6, .3, .1, 0], false), [20]);   // elements and metals only through the proposals
  assert.deepEqual(neededCases([0, 7, 20, 3], [.6, .3, .001, 0], false), []);   // a slot at .002 or less is never shaded
  assert.deepEqual(neededCases([9, 9, 1, 2], [.5, .5, 0, 0], true), [9]);
});
