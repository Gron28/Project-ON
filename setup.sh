#!/usr/bin/env bash
# setup.sh - installs ON on Linux into this folder (no root): packages (npm ci, scripts off), Electron for Linux
# (its own checksum verification), the icon, an applications-menu entry, a fingerprinted ready marker.
#   ./setup.sh                 install (or repair), add the menu entry and a desktop shortcut
#   ./setup.sh --autostart     also start it on login
#   ./setup.sh --no-desktop    no desktop shortcut (removes one made earlier)
#   ./setup.sh --no-shortcuts  leave the menu entry, desktop shortcut and autostart untouched
#   ./setup.sh --uninstall     remove the menu entry, desktop shortcut, icon and autostart (the folder and memories stay)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
AUTOSTART="${XDG_CONFIG_HOME:-$HOME/.config}/autostart"
DESKTOP="$(xdg-user-dir DESKTOP 2>/dev/null || true)"; [ -n "$DESKTOP" ] && [ "$DESKTOP" != "$HOME" ] || DESKTOP="$HOME/Desktop"
ICONS="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor"
ICON=being-entity   # themed icon name (unique, so no other app's 'being' can shadow it)
ELECTRON="$ROOT/node_modules/electron/dist/electron"
SHORTCUTS=1 AUTO=0 DESK=1
for a in "$@"; do case "$a" in
  --autostart) AUTO=1 ;;
  --no-desktop) DESK=0 ;;
  --no-shortcuts) SHORTCUTS=0 ;;
  --uninstall)
    rm -f "$APPS/being.desktop" "$AUTOSTART/being.desktop" "$DESKTOP/being.desktop" "$ICONS"/*/apps/$ICON.png
    command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -t "$ICONS" 2>/dev/null || true
    echo "Removed the menu entry, desktop shortcut, icon and autostart. The folder and its memories are untouched."; exit 0 ;;
  *) echo "unknown option: $a"; exit 2 ;;
esac; done

say() { printf '\033[1m%s\033[0m\n' "$*"; }

say "Checking"
case "$(uname -m)" in x86_64|aarch64) ;; *) echo "ON needs x64 or arm64 Linux."; exit 1 ;; esac
command -v node >/dev/null && command -v npm >/dev/null || { echo "Node.js 20+ and npm are needed (e.g. via nvm)."; exit 1; }
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] || { echo "Node.js 20+ is needed (found $(node -v))."; exit 1; }
if ! command -v parec >/dev/null || ! command -v pactl >/dev/null; then
  echo "Audio capture needs pactl and parec: sudo apt install pulseaudio-utils"; exit 1
fi
pactl info >/dev/null 2>&1 || echo "warning: no PulseAudio/PipeWire server answered; ON will hear nothing until one runs."
command -v playerctl >/dev/null || echo "note: install playerctl for song titles (sudo apt install playerctl)."
[ "$(df -Pk "$ROOT" | awk 'NR==2{print $4}')" -ge 819200 ] || { echo "Free at least 800 MB on this drive."; exit 1; }

FP="$(cat package.json package-lock.json | sha256sum | cut -d' ' -f1)"
PLAT="linux-$(node -p process.arch)"
if [ -x "$ELECTRON" ] && grep -q "\"$FP\"" .setup/ready.json 2>/dev/null && grep -q "\"$PLAT\"" .setup/ready.json 2>/dev/null; then
  say "Already installed"
else
  mkdir -p .setup; rm -f .setup/ready.json
  say "Packages"
  npm ci --ignore-scripts --omit=optional --include=dev --no-audit --no-fund
  say "Runtime (Electron for Linux)"
  node node_modules/electron/install.js
  [ -x "$ELECTRON" ] || { echo "Electron did not install."; exit 1; }
fi

say "Audio"
node -e "const c=require('./native/capture.cjs').loadCapture(); console.log('capture ok,', c.getVisibleWindows().length, 'app stream(s) playing')"

say "Icon"
# the orb at every size the desktop asks for, into the user's icon theme
node --input-type=module -e "
import fs from 'node:fs'; import path from 'node:path'; import { writeIcons, png, orb } from './setup/icon.mjs';
const [root, dir, name] = process.argv.slice(1); await writeIcons(root);
for (const n of [16, 24, 32, 48, 64, 128, 256, 512]) { const d = path.join(dir, n + 'x' + n, 'apps'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, name + '.png'), png(orb(n), n)); }
" "$ROOT" "$ICONS" "$ICON"
[ -f "$ICONS/index.theme" ] || [ ! -f /usr/share/icons/hicolor/index.theme ] || cp /usr/share/icons/hicolor/index.theme "$ICONS/"
command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -t "$ICONS" 2>/dev/null || true

if [ "$SHORTCUTS" = 1 ]; then
  say "Shortcuts"
  esc() { printf '"%s"' "$(printf '%s' "$1" | sed 's/[\\"`$]/\\\\&/g')"; }
  entry() {
    printf '%s\n' '[Desktop Entry]' 'Type=Application' 'Name=ON' 'Comment=A living music visualizer' \
      "Exec=$(esc "$ELECTRON") $(esc "$ROOT")" "Path=$ROOT" "Icon=$ICON" \
      'Terminal=false' 'Categories=AudioVideo;Audio;' 'Keywords=music;visualizer;audio;pet;' \
      'StartupNotify=false' 'StartupWMClass=entity-alive' \
      'Actions=dashboard;showcase;' '' '[Desktop Action dashboard]' 'Name=Open the dashboard' \
      "Exec=$(esc "$ELECTRON") $(esc "$ROOT") --dashboard" '' '[Desktop Action showcase]' 'Name=Showcase (silent test run)' \
      "Exec=$(esc "$ELECTRON") $(esc "$ROOT") --showcase" "$@"
  }
  mkdir -p "$APPS"; entry > "$APPS/being.desktop"; chmod +x "$APPS/being.desktop"
  command -v update-desktop-database >/dev/null && update-desktop-database "$APPS" >/dev/null 2>&1 || true
  echo "  applications menu: $APPS/being.desktop"
  if [ "$DESK" = 1 ] && [ -d "$DESKTOP" ]; then
    entry > "$DESKTOP/being.desktop"; chmod +x "$DESKTOP/being.desktop"
    gio set "$DESKTOP/being.desktop" metadata::trusted true 2>/dev/null || true   # GNOME desktop icons launch only trusted entries
    echo "  desktop: $DESKTOP/being.desktop"
  elif [ "$DESK" = 0 ]; then rm -f "$DESKTOP/being.desktop"; fi
  if [ "$AUTO" = 1 ]; then mkdir -p "$AUTOSTART"; entry > "$AUTOSTART/being.desktop"; echo "  starts on login"; fi
fi

printf '{"fingerprint":"%s","platform":"linux","arch":"%s","plat":"%s","completed":"%s"}\n' "$FP" "$(node -p process.arch)" "$PLAT" "$(date -u +%FT%TZ)" > .setup/ready.json
say "Ready. Start it from the applications menu, or ./launch.sh"
