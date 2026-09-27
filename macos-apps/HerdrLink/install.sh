#!/bin/zsh
# Build HerdrLink.app into ~/Applications and make it the gemini:// handler. Idempotent.
set -euo pipefail
src=${0:A:h}
app=~/Applications/HerdrLink.app
mkdir -p $app/Contents/MacOS
cp $src/Info.plist $app/Contents/Info.plist
swiftc -O -o $app/Contents/MacOS/HerdrLink $src/main.swift
codesign --force --sign - $app >/dev/null 2>&1 || true
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f $app
# Set the default gemini:// handler (Hammerspoon's API wraps LSSetDefaultHandlerForURLScheme).
if [[ -x /opt/homebrew/bin/hs ]]; then
  /opt/homebrew/bin/hs -c 'hs.urlevent.setDefaultHandler("gemini", "com.nathan.herdrlink")' >/dev/null 2>&1 || true
fi
echo "HerdrLink installed: $app"
