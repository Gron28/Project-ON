#!/usr/bin/env bash
# Records whatever plays into scratch/affect/songs/, one 48 kHz mono wav per track, named "<label> - <artist> - <title>.wav"
# (track changes come from MPRIS via playerctl). Pass a label for the batch: ./scratch/record-songs.sh chill
# Stop with Ctrl+C. Recordings of the same track are overwritten. Tracks shorter than 20 s are dropped.
label="${1:-song}"
dir="$(cd "$(dirname "$0")" && pwd)/affect/songs"; mkdir -p "$dir"
pid=""; cur=""; file=""
stop() { if [ -n "$pid" ]; then kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
  if [ -n "$file" ] && [ "$(stat -c %s "$file" 2>/dev/null || echo 0)" -lt 1920000 ]; then rm -f "$file"; fi; pid=""; fi; }
trap 'stop; echo; echo "saved in $dir"; exit 0' INT TERM
echo "recording into $dir (Ctrl+C to stop)"
while true; do
  pl=""; for p in $(playerctl -l 2>/dev/null); do [ "$(playerctl -p "$p" status 2>/dev/null)" = "Playing" ] && { pl="$p"; break; }; done
  st=""; t=""; [ -n "$pl" ] && { st="Playing"; t="$(playerctl -p "$pl" metadata --format '{{artist}} - {{title}}' 2>/dev/null)"; }
  if [ "$st" = "Playing" ] && [ -n "$t" ] && [ "$t" != "$cur" ]; then
    stop; cur="$t"
    file="$dir/$label - $(printf '%s' "$t" | tr '/:*?"<>|' '_________' | cut -c1-120).wav"
    parecord -d @DEFAULT_MONITOR@ --rate=48000 --channels=1 --format=s16le --file-format=wav "$file" & pid=$!
    echo "  > $label: $t"
  fi
  sleep 0.5
done
