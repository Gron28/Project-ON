#!/usr/bin/env bash
# showcase.sh - a silent test run of every state and animation (being/showcase.mjs), in its own window and profile.
# Keys in the window: → next step, ← previous, space pause. Extra arguments go to the app.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON="$ROOT/node_modules/electron/dist/electron"
[ -x "$ELECTRON" ] || { echo "Not installed yet: run ./setup.sh"; exit 1; }
cd "$ROOT" && exec "$ELECTRON" "$ROOT" --showcase "$@"
