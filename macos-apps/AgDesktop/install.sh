#!/bin/zsh
# Build "Ag Desktop.app" (Electron shell around Ag Chat, see main.js) into ~/Applications. Client Macs only.
# Idempotent: skips the build when the sources (*.js, *.html, package.json) and the icon are unchanged, because a rebuilt ad-hoc
# app is a new identity to macOS and asks for the microphone again.
set -euo pipefail
src=${0:A:h}
ag=${src:h:h}
$ag/bin/dot-local/bin/machine-role client || { echo "Ag Desktop: client only, skipped"; exit 0; }
icon=$ag/ag-board/dot-local/share/ag-board/icon-512.png
app="$HOME/Applications/Ag Desktop.app"
state=~/.local/state/ag-desktop.sum
sum=$(cat $src/*.js $src/*.html $src/package.json $icon | shasum | cut -d' ' -f1)
if [[ -d $app && -f $state && $(<$state) == $sum ]]; then echo "Ag Desktop up to date: $app"; exit 0; fi

bun=~/.bun/bin/bun; [[ -x $bun ]] || bun=$(command -v bun)
build=~/.cache/ag-desktop
rm -rf $build/out $build/AgDesktop.iconset; mkdir -p $build/AgDesktop.iconset
cp $src/*.js $src/*.html $src/package.json $build/
for s in 16 32 128 256 512; do
  sips -z $s $s $icon --out $build/AgDesktop.iconset/icon_${s}x${s}.png >/dev/null
  sips -z $((s*2)) $((s*2)) $icon --out $build/AgDesktop.iconset/icon_${s}x${s}@2x.png >/dev/null
done
iconutil -c icns $build/AgDesktop.iconset -o $build/AgDesktop.icns
(cd $build && $bun install --silent && $bun x @electron/packager . "Ag Desktop" --platform=darwin --arch=$(uname -m) \
  --out=out --overwrite --icon=AgDesktop.icns --app-bundle-id=com.nathan.agdesktop --app-category-type=public.app-category.productivity --protocol=agdesktop --protocol-name="Ag Desktop" \
  --ignore='^/(out|AgDesktop\.iconset|AgDesktop\.icns|bun\.lockb?)$' --quiet)
plutil -replace NSMicrophoneUsageDescription -string "Ag Desktop uses the microphone for dictation and voice messages to your agents." \
  "$build/out/Ag Desktop-darwin-$(uname -m)/Ag Desktop.app/Contents/Info.plist"
# Alerts, not banners: pinned alerts stay on screen until addressed (macOS reads this the first time the app notifies).
plutil -replace NSUserNotificationAlertStyle -string alert "$build/out/Ag Desktop-darwin-$(uname -m)/Ag Desktop.app/Contents/Info.plist"
codesign --force --deep --sign - "$build/out/Ag Desktop-darwin-$(uname -m)/Ag Desktop.app"

pgrep -qf "$app/Contents/MacOS/Ag Desktop" && { osascript -e 'quit app "Ag Desktop"' 2>/dev/null; sleep 2; }
mkdir -p ~/Applications ${state:h}
rm -rf $app
mv "$build/out/Ag Desktop-darwin-$(uname -m)/Ag Desktop.app" $app
print -r -- $sum >$state
open -g $app  # also registers it as a login item on first launch
echo "Ag Desktop installed: $app (Ctrl+Cmd+A)"
