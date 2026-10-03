#!/bin/sh
# sim.sh: drive real Mobile Safari in the iOS Simulator (the "mobile-review" iPhone 17 Pro) with AXe.
#   sim.sh boot                 create (once) + boot the simulator, open Simulator.app
#   sim.sh open <url>           open a URL in Mobile Safari
#   sim.sh tap <x> <y>          tap at screen points (402×874 portrait; = screenshot px / 3)
#   sim.sh swipe <x1> <y1> <x2> <y2>
#   sim.sh type <text>          type into the focused field
#   sim.sh shot <name>          screenshot → /tmp/mobile-review/<name>.png (+ <name>s.png at point size)
#   sim.sh ui                   accessibility tree with frames (find tap targets without guessing)
#   sim.sh shutdown
# Needs: an iOS Simulator runtime (xcodebuild -downloadPlatform iOS) and AXe (setup.sh installs it to ~/.local/share/axe).
set -e
AXE="$HOME/.local/share/axe/axe"
NAME=mobile-review
OUT=/tmp/mobile-review
mkdir -p "$OUT"
udid() { xcrun simctl list devices -j | /usr/bin/python3 -c "import json,sys; d=json.load(sys.stdin)['devices']; print(next((x['udid'] for v in d.values() for x in v if x['name']=='$NAME' and x['isAvailable']), ''))"; }
U=$(udid)
case "$1" in
  boot)
    if [ -z "$U" ]; then
      rt=$(xcrun simctl list runtimes -j | /usr/bin/python3 -c "import json,sys; r=[x for x in json.load(sys.stdin)['runtimes'] if x['platform']=='iOS' and x['isAvailable']]; print(r[-1]['identifier'] if r else '')")
      [ -n "$rt" ] || { echo "No iOS runtime: run  xcodebuild -downloadPlatform iOS" >&2; exit 1; }
      U=$(xcrun simctl create "$NAME" "iPhone 17 Pro" "$rt")
    fi
    xcrun simctl boot "$U" 2>/dev/null || true
    xcrun simctl bootstatus "$U" -b >/dev/null
    open -g -a Simulator
    echo "$U" ;;
  open) xcrun simctl openurl "$U" "$2" ;;
  tap) "$AXE" tap -x "$2" -y "$3" --udid "$U" ;;
  swipe) "$AXE" swipe --start-x "$2" --start-y "$3" --end-x "$4" --end-y "$5" --udid "$U" ;;
  type) "$AXE" type "$2" --udid "$U" ;;
  ui) "$AXE" describe-ui --udid "$U" ;;
  shot)
    # right after a tap the first screenshot sometimes fails; retry
    for i in 1 2 3 4 5; do xcrun simctl io "$U" screenshot "$OUT/$2.png" >/dev/null 2>&1 && break; sleep 1; done
    sips -Z 874 "$OUT/$2.png" --out "$OUT/${2}s.png" >/dev/null && echo "$OUT/${2}s.png" ;;
  shutdown) xcrun simctl shutdown "$U" ;;
  *) sed -n '2,11p' "$0"; exit 2 ;;
esac
