#!/usr/bin/env bash
# Buduje rozszerzenie Findera PoufnikFinder.appex i dopisuje je do tauri.macos.conf.json
# (bundle.macOS.files → Contents/PlugIns), tak że Tauri wkłada je do Poufnik.app z DMG.
# Wersja z Mac App Store go nie dostaje: buduje się bez tego kroku.
#
# Użycie: build.sh <target-triple> <wersja>
#   np. build.sh aarch64-apple-darwin 1.3.0
# Z APPLE_SIGNING_IDENTITY podpisuje Developer ID z hardened runtime i znacznikiem czasu
# (notaryzacja); bez niej podpis ad hoc, jak reszta lokalnego buildu.
set -euo pipefail

target="${1:?target triple}"
version="${2:?wersja}"
case "$target" in
  aarch64-apple-darwin) arch=arm64 ;;
  x86_64-apple-darwin) arch=x86_64 ;;
  *) echo "Nieznany target: $target" >&2; exit 1 ;;
esac

here="$(cd "$(dirname "$0")" && pwd)"
tauri_dir="$(cd "$here/../.." && pwd)"
out="$tauri_dir/macos/build/PoufnikFinder.appex"
min_macos="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["bundle"]["macOS"]["minimumSystemVersion"])' "$tauri_dir/tauri.macos.conf.json")"

rm -rf "$out"
mkdir -p "$out/Contents/MacOS"
sed "s/__VERSION__/$version/g" "$here/Info.plist" > "$out/Contents/Info.plist"
plutil -lint "$out/Contents/Info.plist" > /dev/null

# Rozszerzenie startuje przez NSExtensionMain (jak w Xcode), nie przez main().
xcrun swiftc -O -parse-as-library \
  -target "$arch-apple-macos$min_macos" \
  -module-name PoufnikFinder \
  -framework FinderSync -framework AppKit \
  -Xlinker -e -Xlinker _NSExtensionMain \
  -Xlinker -rpath -Xlinker @executable_path/../../../../Frameworks \
  "$here/FinderSync.swift" -o "$out/Contents/MacOS/PoufnikFinder"

if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
  codesign --force --timestamp --options runtime \
    --entitlements "$here/Entitlements.plist" --sign "$APPLE_SIGNING_IDENTITY" "$out"
else
  codesign --force --entitlements "$here/Entitlements.plist" --sign - "$out"
fi
codesign --verify --strict "$out"

python3 - "$tauri_dir/tauri.macos.conf.json" <<'PY'
import json, pathlib, sys
path = pathlib.Path(sys.argv[1])
config = json.loads(path.read_text())
files = config["bundle"]["macOS"].setdefault("files", {})
files["PlugIns/PoufnikFinder.appex"] = "macos/build/PoufnikFinder.appex"
path.write_text(json.dumps(config, indent=2) + "\n")
PY
echo "PoufnikFinder.appex ($arch, macOS $min_macos+): $out"
