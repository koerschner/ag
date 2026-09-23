#!/usr/bin/env zsh
# Register dotfiles-managed Herdr plugins (the registry, plugins.json, holds
# absolute paths so it isn't tracked) and verify agent integrations.
# Integration files themselves are stowed from pi/, claude/, codex/.
set -e
here=${0:A:h}
for p in $here/plugins/*(/); do herdr plugin link $p >/dev/null && echo "linked ${p:t}"; done
herdr integration status | grep -E '^(pi|claude|codex):'
