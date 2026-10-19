#!/bin/bash
# macOS (Intel) counterpart of build-release.ps1: tests, bundles Chess Lab.app and a DMG.
# Usage: scripts/build-release-mac.sh [--version X.Y.Z] [--install]
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
version="" install=0
while [ $# -gt 0 ]; do
  case "$1" in
    --version) version="$2"; shift 2 ;;
    --install) install=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
[ -n "$version" ] || version="$(tr -d '[:space:]' < VERSION)"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Use a MAJOR.MINOR.PATCH version." >&2; exit 1; }
python="$root/.venv/bin/python"
[ -x "$python" ] || { echo "Create .venv and install requirements-mac-intel.txt first." >&2; exit 1; }
[ -x engine/stockfish ] || scripts/build-stockfish-mac.sh

"$python" -m pip install -q -r requirements-mac-intel.txt -r requirements-build.txt
"$python" -m compileall -q app run.py maia3_uci.py
for script in app/static/app.js extension/content.js extension/background.js; do node --check "$script"; done
"$python" -m unittest discover -s tests -v
node tests/extension-sync.test.js
node tests/player-color.test.js
"$python" scripts/prepare-release.py --version "$version"

iconset="build/ChessLab.iconset"
rm -rf "$iconset" && mkdir -p "$iconset"
for size in 16 32 128 256 512; do
  sips -z $size $size app/static/icons/icon-1024.png --out "$iconset/icon_${size}x${size}.png" >/dev/null
  sips -z $((size * 2)) $((size * 2)) app/static/icons/icon-1024.png --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$iconset" -o build/ChessLab.icns

"$python" -m PyInstaller --noconfirm packaging/chesslab-mac.spec
app="dist/Chess Lab.app"

dmg="dist/ChessLab-$version-mac-intel.dmg"
staging="build/dmg"
rm -rf "$staging" "$dmg" && mkdir -p "$staging"
cp -R "$app" "$staging/"
ln -s /Applications "$staging/Applications"
hdiutil create -volname "Chess Lab $version" -srcfolder "$staging" -ov -format UDZO "$dmg" >/dev/null

(cd dist && shasum -a 256 "ChessLab-$version-mac-intel.dmg" "ChessLab-Sync-$version.zip" > "SHA256SUMS-$version-mac.txt")

if [ "$install" = 1 ]; then
  "$app/Contents/MacOS/ChessLab" --stop || true
  mkdir -p "$HOME/Applications"
  rm -rf "$HOME/Applications/Chess Lab.app"
  cp -R "$app" "$HOME/Applications/"
  echo "Installed to ~/Applications/Chess Lab.app"
fi
echo "Release $version built in $root/dist"
