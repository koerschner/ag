#!/bin/zsh
# Build "ag-dash.app" into ~/Applications (client Macs only): an Electron shell (shell/) that loads the app itself
# (app/: main.js, quick entry…) live from this checkout, so app changes need only a relaunch, which this does.
# AG_DASH_TESTBED=1 builds it on any Mac without launching it: agents test ag-dash (e.g. quick entry) on
# ag-mac this way instead of driving the client (`ag-mac run 'AG_DASH_TESTBED=1 zsh ~/ag/macos-apps/ag-dash/install.sh'`).
# Idempotent: rebuilds only when shell/ or the icon change, because a rebuilt ad-hoc app is a new identity to macOS,
# which then asks again for the microphone, Accessibility (quick entry's key chord) and Screen Recording (its screenshot).
set -euo pipefail
src=${0:A:h}
ag=${src:h:h}
testbed=${AG_DASH_TESTBED:-}
[[ -n $testbed ]] || $ag/bin/dot-local/bin/ag-machine-role client || { echo "ag-dash: client only, skipped"; exit 0; }
icon=$ag/ag-dash/dot-local/share/ag-dash/icon-512.png
app="$HOME/Applications/ag-dash.app"
state=~/.local/state/ag-dash.sum
appstate=~/.local/state/ag-dash.app.sum
sum=$(cat $src/shell/main.js $src/shell/package.json $icon | shasum | cut -d' ' -f1)
appsum=$(cat $src/app/* | shasum | cut -d' ' -f1)
if [[ -d $app && -f $state && $(<$state) == $sum ]]; then
  # Same shell: relaunch it if the app code changed (it runs from app/ in this checkout).
  if [[ -z $testbed && ( ! -f $appstate || $(<$appstate) != $appsum ) ]]; then
    if pgrep -qf "$app/Contents/MacOS/ag-dash"; then
      PATH=~/.bun/bin:$PATH ~/.local/bin/ag-telemetry send --severity info --kind update --source "ag-dash app" "relaunched (app code changed)" 2>/dev/null || true
      osascript -e 'quit app "ag-dash"' 2>/dev/null; sleep 2; open -g $app
    fi
    print -r -- $appsum >$appstate
    echo "ag-dash app code updated (relaunched): $app"
  else echo "ag-dash up to date: $app"; fi
  exit 0
fi

bun=~/.bun/bin/bun; [[ -x $bun ]] || bun=$(command -v bun)
build=~/.cache/ag-dash
rm -rf $build/out $build/ag-dash.iconset; mkdir -p $build/ag-dash.iconset
cp $src/shell/main.js $src/shell/package.json $build/
for s in 16 32 128 256 512; do
  sips -z $s $s $icon --out $build/ag-dash.iconset/icon_${s}x${s}.png >/dev/null
  sips -z $((s*2)) $((s*2)) $icon --out $build/ag-dash.iconset/icon_${s}x${s}@2x.png >/dev/null
done
iconutil -c icns $build/ag-dash.iconset -o $build/ag-dash.icns
(cd $build && $bun install --silent && $bun x @electron/packager . "ag-dash" --platform=darwin --arch=$(uname -m) \
  --out=out --overwrite --icon=ag-dash.icns --app-bundle-id=com.ag.agdesktop --app-category-type=public.app-category.productivity --protocol=agdash --protocol-name="ag-dash" \
  --asar.unpack='**/*.node' --ignore='^/(out|ag-dash\.iconset|ag-dash\.icns|bun\.lockb?)$' --quiet)
plutil -replace NSMicrophoneUsageDescription -string "ag-dash uses the microphone for dictation and voice messages to your agents." \
  "$build/out/ag-dash-darwin-$(uname -m)/ag-dash.app/Contents/Info.plist"
# Alerts, not banners: pinned alerts stay on screen until addressed (macOS reads this the first time the app notifies).
plutil -replace NSUserNotificationAlertStyle -string alert "$build/out/ag-dash-darwin-$(uname -m)/ag-dash.app/Contents/Info.plist"
codesign --force --deep --sign - "$build/out/ag-dash-darwin-$(uname -m)/ag-dash.app"

# Renamed from "Ag Desktop", then "AG Dash" (2026-10): retire the old apps and their login items, and keep their
# settings (window bounds, localStorage). The bundle id stays com.ag.agdesktop so macOS keeps its notification
# settings (Alerts, allowed in Do Not Disturb).
for name in "Ag Desktop" "AG Dash"; do
  old="$HOME/Applications/$name.app"
  if [[ -d $old ]]; then
    pgrep -qf "$old/Contents/MacOS/$name" && { osascript -e "quit app \"$name\"" 2>/dev/null; sleep 2; }
    [[ -n $testbed ]] || osascript -e "tell application \"System Events\" to delete login item \"$name\"" 2>/dev/null || true
    rm -rf $old
  fi
  olddata="$HOME/Library/Application Support/$name"; newdata="$HOME/Library/Application Support/ag-dash"
  if [[ -d $olddata && ! -e $newdata ]]; then mv $olddata $newdata; fi
done
rm -rf ~/.local/state/ag-desktop.sum ~/.cache/ag-desktop
# An update quits the running app: say so in ag-telemetry, so the window vanishing isn't mistaken for a crash.
pgrep -qf "$app/Contents/MacOS/ag-dash" && { [[ -n $testbed ]] || PATH=~/.bun/bin:$PATH ~/.local/bin/ag-telemetry send --severity info --kind update --source "ag-dash app" "rebuilt and relaunched (sources changed)" 2>/dev/null || true; osascript -e 'quit app "ag-dash"' 2>/dev/null; sleep 2; }
mkdir -p ~/Applications ${state:h}
rm -rf $app
mv "$build/out/ag-dash-darwin-$(uname -m)/ag-dash.app" $app
print -r -- $sum >$state
print -r -- $appsum >$appstate
# Register it with Launch Services now, so agdash:// (quick entry) resolves even before its first launch.
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f $app 2>/dev/null || true
[[ -n $testbed ]] && { echo "ag-dash test bed built: $app (not launched; quit it and remove its login item after testing)"; exit 0; }
open -g $app  # also registers it as a login item on first launch
echo "ag-dash installed: $app (Ctrl+Cmd+A)"
