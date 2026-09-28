#!/bin/sh
# One-time: install Playwright + its browsers for the mobile-review scripts into ~/.local/share/mobile-review.
set -e
dir="$HOME/.local/share/mobile-review"
mkdir -p "$dir"
cd "$dir"
[ -f package.json ] || echo '{"name":"mobile-review","private":true,"type":"module"}' > package.json
[ -d node_modules/playwright ] || npm install --silent playwright
npx --yes playwright install chromium webkit
echo "mobile-review: Playwright ready in $dir"

# AXe (taps/swipes/typing in the iOS Simulator for sim.sh). Prebuilt release: Homebrew builds it from source,
# which fails while the Command Line Tools lag macOS.
if [ ! -x "$HOME/.local/share/axe/axe" ]; then
  mkdir -p "$HOME/.local/share/axe" && cd "$HOME/.local/share/axe"
  tag=$(gh release view -R cameroncooke/AXe --json tagName -q .tagName)
  gh release download "$tag" -R cameroncooke/AXe -p "AXe-macOS-$tag-universal.tar.gz" --clobber
  tar xzf "AXe-macOS-$tag-universal.tar.gz" && rm "AXe-macOS-$tag-universal.tar.gz"
fi
xcrun simctl list runtimes | grep -q '^iOS' || echo "mobile-review: no iOS Simulator runtime yet; for sim.sh run: xcodebuild -downloadPlatform iOS (~8 GB)"
echo "mobile-review: AXe ready"
