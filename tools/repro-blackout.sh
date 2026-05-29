#!/usr/bin/env bash
# Reproduce the WebKitGTK black-surface bug on demand and find which nudge
# recovers it. Triggers DPMS (display sleep) — your monitor will go dark for
# ~8s, then come back. Yawp must already be running and visible.
#
# Usage: tools/repro-blackout.sh
set -uo pipefail

WID=$(xdotool search --class voice-app 2>/dev/null | tail -1)
[ -z "$WID" ] && WID=$(xdotool search --class yawp 2>/dev/null | tail -1)
if [ -z "$WID" ]; then echo "No Yawp window found — launch Yawp first."; exit 1; fi
echo "Yawp window: $WID"

luma() { # capture window -> mean luminance (0=black, ~249=healthy light UI)
  xwd -id "$WID" -out /tmp/_yawp.xwd 2>/dev/null &&
  ffmpeg -y -loglevel error -i /tmp/_yawp.xwd /tmp/_yawp.png 2>/dev/null &&
  python3 -c "from PIL import Image,ImageStat;print(f'{ImageStat.Stat(Image.open(\"/tmp/_yawp.png\").convert(\"L\")).mean[0]:.1f}')"
}

echo "baseline luma: $(luma)"
echo "Sleeping the display for 8s (screen goes dark)..."
xset dpms force off; sleep 8; xset dpms force on; sleep 2
xdotool windowactivate "$WID" 2>/dev/null; sleep 1
L=$(luma); echo "post-wake luma: $L"

awk "BEGIN{exit !($L < 40)}" || { echo "Did NOT reproduce a blackout this run. Try a longer sleep or repeat."; exit 0; }
echo ">>> BLACKOUT reproduced (luma $L). Testing recovery nudges:"

# Nudge A: 1px resize and back (the 'real re-render' WebKit respects)
G=$(xdotool getwindowgeometry "$WID" | awk '/Geometry/{print $2}'); W=${G%x*}; H=${G#*x}
xdotool windowsize "$WID" $((W+1)) "$H"; sleep 0.4; xdotool windowsize "$WID" "$W" "$H"; sleep 0.6
echo "after resize-nudge: $(luma)"

# Nudge B: unmap / remap
xdotool windowunmap "$WID"; sleep 0.4; xdotool windowmap "$WID"; xdotool windowactivate "$WID"; sleep 0.6
echo "after unmap/remap : $(luma)"
echo "Whichever line jumps back to ~249 is the nudge that fixes it."
