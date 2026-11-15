#!/usr/bin/env bash
set -e

# Usage: ./tools/publish-release.sh <version> [--prerelease]
# Example: ./tools/publish-release.sh 1.18.0 --prerelease

DIR="$(cd "$(dirname "$0")/.." && pwd)"
VER="${1:-}"
IS_PRE="${2:-}"

if [ -z "$VER" ]; then
  echo "Uso: $0 <version> [--prerelease]"
  echo "Ejemplo: $0 1.18.0 --prerelease"
  exit 1
fi

TAG="v$VER"
PUB_REPO="tizenxupertv/TizenXuperTV"

echo "==> 1. Compilando React y empaquetando/firmando WGT..."
"$DIR/tools/build-and-sign.sh"

echo "==> 2. Generando manifiesto y bundle de auto-actualización..."
node "$DIR/tools/update-release.mjs" --version "$VER" --out "$DIR/build"

SIGNED_WGT="$DIR/build/TizenXuperTV_${VER}_signed.wgt"
PLAIN_WGT="$DIR/build/TizenXuperTV.wgt"
cp "$SIGNED_WGT" "$PLAIN_WGT"

BUNDLE="$DIR/build/update-bundle-${VER}.json"
MANIFEST="$DIR/build/update-manifest.json"

NOTES_FILE="$DIR/build/release-notes.md"
if [ ! -f "$NOTES_FILE" ]; then
  echo "TizenXuper TV $TAG" > "$NOTES_FILE"
fi

EXTRA_FLAGS=""
if [ "$IS_PRE" = "--prerelease" ]; then
  EXTRA_FLAGS="--prerelease"
fi

echo "==> 3. Publicando release $TAG en $PUB_REPO..."
gh release create "$TAG" \
  --repo "$PUB_REPO" \
  --title "TizenXuper TV $TAG" \
  --notes-file "$NOTES_FILE" \
  $EXTRA_FLAGS \
  "$SIGNED_WGT" \
  "$PLAIN_WGT" \
  "$BUNDLE" \
  "$MANIFEST"

echo "==> ¡Release $TAG publicada con éxito en https://github.com/$PUB_REPO/releases!"
