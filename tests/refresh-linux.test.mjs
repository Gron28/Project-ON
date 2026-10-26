// native/refresh-linux.cjs: the display's refresh rate from xrandr, where Electron reports 0 (Linux X11)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { parseXrandr, rateAt } = createRequire(import.meta.url)('../native/refresh-linux.cjs');

const TWO = `Screen 0: minimum 320 x 200, current 4480 x 1440, maximum 16384 x 16384
DisplayPort-0 disconnected (normal left inverted right x axis y axis)
DisplayPort-1 connected primary 1920x1080+0+0 (normal left inverted right x axis y axis) 600mm x 340mm
   1920x1080     60.00*+  50.00    59.94
   1280x720      60.00
HDMI-A-0 connected 2560x1440+1920+0 (normal left inverted right x axis y axis) 600mm x 340mm
   2560x1440    143.97*+ 120.00    59.95
   1920x1080    119.88
`;

test('each connected output with its geometry and current rate', () => {
  const o = parseXrandr(TWO);
  assert.deepEqual(o.map((x) => [x.name, x.primary, x.x, x.w, x.hz]), [['DisplayPort-1', true, 0, 1920, 60], ['HDMI-A-0', false, 1920, 2560, 143.97]]);
});

test('the rate of the output under the window, else the primary', () => {
  const o = parseXrandr(TWO);
  assert.equal(rateAt(o, 500, 500), 60);
  assert.equal(rateAt(o, 3000, 700), 143.97);
  assert.equal(rateAt(o, -50, -50), 60);
});

test('no rate when the outputs are off (a sleeping monitor) or the text is empty', () => {
  const off = 'Screen 0: minimum 320 x 200\nDisplayPort-1 disconnected primary (normal left inverted right x axis y axis)\n   1920x1080     60.00 +\n';
  assert.equal(rateAt(parseXrandr(off), 0, 0), 0);
  assert.equal(rateAt(parseXrandr(''), 0, 0), 0);
});
