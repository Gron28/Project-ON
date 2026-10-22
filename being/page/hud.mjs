// being/page/hud.mjs - the "what it hears" readout (look.hud): tempo, bar, section, channels, character, notes, models
export function createHud({ S, CHR, Q, mlLine, c01 }) {
  const hud = document.getElementById('hud'), NN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const CHB = [['Noise', 'noisiness', '#d9d9d9'], ['Rough', 'roughness', '#ff6b5e'], ['Tonal', 'tonality', '#5ec8ff'], ['Harmony', 'harmony', '#8f7bff'], ['Regular', 'regularity', '#6bd36b'], ['Dense', 'density', '#ffb347'], ['Intricate', 'intricacy', '#ff7bd5'], ['Loud', 'loudness', '#ffe66b'], ['Vocal', 'vocal', '#7bf0d0']];
  const CH = [['K', 'drums', 'kick', '#ff6b5e'], ['S', 'drums', 'snare', '#ffb347'], ['H', 'drums', 'hat', '#ffe66b'], ['B', 'st', 'bass', '#6bd36b'], ['L', 'st', 'lead', '#5ec8ff'], ['P', 'st', 'pads', '#8f7bff'], ['V', 'st', 'voice', '#ff7bd5'], ['I', 'st', 'intensity', '#ffffff'], ['W', 'st', 'width', '#7bf0d0']];
  hud.innerHTML = '<div class="r"><span class="bpm">--</span><span class="dots"><i class="dot"></i><i class="dot"></i><i class="dot"></i><i class="dot"></i></span><span class="sec">S0</span><span class="flash"></span></div>'
    + '<div class="bars">' + CH.map(c => `<div class="b"><i><u style="background:${c[3]}"></u></i><span>${c[0]}</span></div>`).join('') + '</div>'
    + '<div class="chr">' + CHB.map(c => `<div class="c"><span>${c[0]}</span><i><u style="background:${c[2]}"></u></i></div>`).join('') + '</div>'
    + '<div class="r"><span class="notes">·</span><span class="arch">-</span><span class="trk"><u></u></span></div>'
    + '<div class="r"><span class="ml">·</span></div>';
  const hBpm = hud.querySelector('.bpm'), hDots = hud.querySelectorAll('.dot'), hSec = hud.querySelector('.sec'), hFlash = hud.querySelector('.flash'), hBars = hud.querySelectorAll('.b u'), hNotes = hud.querySelector('.notes'), hTen = hud.querySelector('.trk u'), hChr = hud.querySelectorAll('.chr u'), hArch = hud.querySelector('.arch'), hMl = hud.querySelector('.ml');
  let lastDot = -1, lastTxt = '';
  function updateHud(now, st) {
    const bs = st.beat, conf = bs.confidence > .3;
    const txt = conf ? Math.round(bs.bpm) + ' bpm' : '-- bpm';
    if (txt !== lastTxt) { hBpm.textContent = txt; lastTxt = txt; }
    const di = conf ? Math.floor((((bs.barPhase % 1) + 1) % 1) * 4) % 4 : -1;
    if (di !== lastDot) { for (let i = 0; i < 4; i++) { hDots[i].classList.toggle('on', i === di); hDots[i].classList.toggle('d', i === 0); } lastDot = di; }
    hSec.textContent = 'S' + st.structure.section;
    for (let i = 0; i < CH.length; i++) { const c = CH[i], v = c[1] === 'drums' ? st.drums[c[2]] : st[c[2]]; hBars[i].style.transform = 'scaleY(' + Math.max(0, Math.min(1, v)).toFixed(2) + ')'; }
    for (let i = 0; i < CHB.length; i++) hChr[i].style.transform = 'scaleX(' + c01(CHR[CHB[i][1]]).toFixed(2) + ')';
    if (hArch.textContent !== Q.arch) hArch.textContent = Q.arch;
    hTen.style.transform = 'scaleX(' + Math.max(0, Math.min(1, st.structure.tension)).toFixed(2) + ')';
    let a = -1, b = -1, c3 = -1; const nt = st.notes;
    for (let i = 0; i < 12; i++) { const v = nt[i]; if (a < 0 || v > nt[a]) { c3 = b; b = a; a = i; } else if (b < 0 || v > nt[b]) { c3 = b; b = i; } else if (c3 < 0 || v > nt[c3]) c3 = i; }
    let s = ''; for (const i of [a, b, c3]) if (i >= 0 && nt[i] > .15) s += (s ? ' ' : '') + NN[i]; hNotes.textContent = s || '·';
    const f = now - S.flashT < 1400 ? S.flash : ''; if (hFlash.textContent !== f) hFlash.textContent = f;
    const ml = mlLine(); if (hMl.textContent !== ml) hMl.textContent = ml;
  }
  return updateHud;
}
