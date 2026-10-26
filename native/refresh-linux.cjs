'use strict';
// The refresh rate of the display a window is on, for Linux X11 sessions. Electron's display.displayFrequency is 0 there, and
// the page's governor (being/page/quality.mjs) then has to learn the display's interval from its own frames. `xrandr --current`
// names each connected output's geometry (physical pixels) and marks its current mode's rate with '*'. Read once and kept
// until the displays change (forget()); nothing when xrandr is missing or the outputs are off (a sleeping monitor).
const { execFileSync } = require('node:child_process');

/** xrandr --current text -> [{ name, x, y, w, h, hz, primary }] for the connected outputs that show a mode */
function parseXrandr(text) {
  const outs = []; let cur = null;
  for (const line of String(text).split('\n')) {
    const o = line.match(/^(\S+) connected( primary)? (\d+)x(\d+)\+(-?\d+)\+(-?\d+)/);
    if (o) { cur = { name: o[1], primary: !!o[2], w: +o[3], h: +o[4], x: +o[5], y: +o[6], hz: 0 }; outs.push(cur); continue; }
    if (/^\S/.test(line)) { cur = null; continue; }
    if (cur && !cur.hz) { const m = line.match(/(\d+(?:\.\d+)?)\*/); if (m) cur.hz = +m[1]; }
  }
  return outs.filter((o) => o.hz > 0);
}

/** the rate of the output under a point (physical pixels), else the primary's, else 0 */
function rateAt(outs, px, py) {
  const hit = outs.find((o) => px >= o.x && px < o.x + o.w && py >= o.y && py < o.y + o.h) || outs.find((o) => o.primary) || outs[0];
  return hit ? hit.hz : 0;
}

function createRefresh() {
  let outs = null, at = 0;
  const read = () => { try { return parseXrandr(execFileSync('xrandr', ['--current'], { encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] })); } catch { return []; } };
  return {
    /** the rate at a window's centre; bounds in DIPs, scale = the display's scaleFactor */
    hzFor(bounds, scale = 1) {
      // retried every 10 s while empty (the outputs come back when the monitor wakes), not on every move of a drag
      if (!outs || (!outs.length && Date.now() - at > 10000)) { outs = read(); at = Date.now(); }
      return rateAt(outs, (bounds.x + bounds.width / 2) * scale, (bounds.y + bounds.height / 2) * scale);
    },
    forget() { outs = null; },
  };
}

module.exports = { parseXrandr, rateAt, createRefresh };
