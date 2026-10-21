#!/usr/bin/env bash
# launch.sh - starts ON on Linux (run ./setup.sh once first). Extra arguments go to the app (e.g. --dashboard).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON="$ROOT/node_modules/electron/dist/electron"
[ -x "$ELECTRON" ] || { echo "Not installed yet: run ./setup.sh"; exit 1; }
cd "$ROOT" && exec "$ELECTRON" "$ROOT" "$@"
