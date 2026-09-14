#!/usr/bin/env bash
# Install a checksum-pinned native release; no credentials or exports live here.
set -euo pipefail

version=2.48
case "$(uname -s)/$(uname -m)" in
  Darwin/arm64) rid=osx-arm64; sha=623f9d2dce568e17a46b8fbd366a18dca49803d386216f4ba24507d2c000fee9 ;;
  Darwin/x86_64) rid=osx-x64; sha=91b4eae3525df85d084969004f3a287edad4eeaafd664e4869b26bb8422e2e88 ;;
  Linux/aarch64|Linux/arm64) rid=linux-arm64; sha=02a47fc8e0192fd509fbb082aadd9322035b18feae96849699fefc424a1e3379 ;;
  Linux/x86_64) rid=linux-x64; sha=3e253e28ec7ea034b2201443fa84571142945299296541ecbe196ffceef8bc3c ;;
  *) printf 'Unsupported platform. Download a matching official native release.\n' >&2; exit 1 ;;
esac

root="$HOME/.local/share/discord-chat-exporter"
dest="$root/$version-$rid"
if [[ -e "$root/current" && ! -L "$root/current" ]]; then
  printf 'Refusing to replace non-symlink %s/current\n' "$root" >&2
  exit 1
fi

if [[ ! -x "$dest/DiscordChatExporter.Cli" ]]; then
  command -v gh >/dev/null || { printf 'Install GitHub CLI (gh) first.\n' >&2; exit 1; }
  command -v python3 >/dev/null || { printf 'Install Python 3 first.\n' >&2; exit 1; }
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
  asset="DiscordChatExporter.Cli.$rid.zip"
  gh release download "$version" --repo Tyrrrz/DiscordChatExporter --pattern "$asset" --dir "$work"
  python3 - "$work/$asset" "$sha" "$dest" <<'PY'
import hashlib
from pathlib import Path
import sys
import zipfile
archive, expected, dest = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3])
if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
    raise SystemExit('Checksum mismatch: refusing to install')
with zipfile.ZipFile(archive) as z:
    root = dest.resolve()
    for info in z.infolist():
        target = (root / info.filename).resolve()
        if target != root and root not in target.parents:
            raise SystemExit('Unsafe archive path: refusing to extract')
    z.extractall(dest)
PY
  chmod u+x "$dest/DiscordChatExporter.Cli"
  if [[ "$rid" == osx-* ]]; then
    xattr -dr com.apple.quarantine "$dest"
  fi
fi

"$dest/DiscordChatExporter.Cli" --version
ln -sfn "$version-$rid" "$root/current"
printf 'Ready: %s/current/DiscordChatExporter.Cli\n' "$root"
