#!/bin/zsh
# Build ChromeTabReaper.app into ~/Applications (only on ag). Idempotent: skips the rebuild when the
# source is unchanged, because a rebuilt ad-hoc app loses its Automation grant for Google Chrome.
set -euo pipefail
[[ $(scutil --get LocalHostName) == ag ]] || { echo "ChromeTabReaper: ag only, skipped"; exit 0; }
src=${0:A:h}/main.applescript
app=~/Applications/ChromeTabReaper.app
if [[ -f $app/Contents/Resources/main.applescript ]] && cmp -s $src $app/Contents/Resources/main.applescript; then
  echo "ChromeTabReaper up to date: $app"; exit 0
fi
mkdir -p ~/Applications
rm -rf $app
osacompile -o $app $src
cp $src $app/Contents/Resources/main.applescript
plutil -replace CFBundleIdentifier -string com.nathan.chrometabreaper $app/Contents/Info.plist
plutil -replace LSUIElement -bool true $app/Contents/Info.plist
plutil -replace NSAppleEventsUsageDescription -string "Closes Chrome tabs on ag that nobody has looked at for a while." $app/Contents/Info.plist
codesign --force --sign - $app >/dev/null 2>&1 || true
echo "ChromeTabReaper installed: $app (grant it Automation → Google Chrome on first run)"
