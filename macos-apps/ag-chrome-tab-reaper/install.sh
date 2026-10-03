#!/bin/zsh
# Build ag-chrome-tab-reaper.app into ~/Applications (only on the host, ag-mac). Idempotent: skips the rebuild when the
# source is unchanged, because a rebuilt ad-hoc app loses its Automation grant for Google Chrome.
set -euo pipefail
${0:A:h:h:h}/bin/dot-local/bin/ag-machine-role host extremity || { echo "ag-chrome-tab-reaper: host (ag-mac) only, skipped"; exit 0; }
src=${0:A:h}/main.applescript
app=~/Applications/ag-chrome-tab-reaper.app
if [[ -f $app/Contents/Resources/main.applescript ]] && cmp -s $src $app/Contents/Resources/main.applescript; then
  echo "ag-chrome-tab-reaper up to date: $app"; exit 0
fi
mkdir -p ~/Applications
rm -rf $app ~/Applications/ChromeTabReaper.app  # renamed from ChromeTabReaper (2026-10)
osacompile -o $app $src
cp $src $app/Contents/Resources/main.applescript
plutil -replace CFBundleIdentifier -string com.ag.chrometabreaper $app/Contents/Info.plist
plutil -replace LSUIElement -bool true $app/Contents/Info.plist
plutil -replace NSAppleEventsUsageDescription -string "Closes Chrome tabs on ag-mac that nobody has looked at for a while." $app/Contents/Info.plist
codesign --force --sign - $app >/dev/null 2>&1 || true
echo "ag-chrome-tab-reaper installed: $app (grant it Automation → Google Chrome on first run)"
