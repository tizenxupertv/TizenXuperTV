#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "$0")/.." && pwd)"
CERT_DIR="$HOME/Library/Application Support/Apps2Samsung/Certificate/Jelly2Sams - Partner"
WORK_DIR="/tmp/xuper_sign_work"
TMP_WGT="/tmp/TizenXuperTV_unsigned.wgt"
SRC_DIR="$DIR/dist"
if [ ! -d "$SRC_DIR" ] || [ ! -f "$SRC_DIR/index.html" ]; then
  echo "==> Building React app..."
  npm run build
fi
echo "==> Packaging React build from: $SRC_DIR"

# Read version from config.xml if available
VER=$(grep '<widget' "$SRC_DIR/config.xml" 2>/dev/null | grep -o 'version="[^"]*"' | cut -d'"' -f2 || echo "1.6.71")
OUT_WGT="$DIR/build/TizenXuperTV_${VER}_signed.wgt"

rm -rf "$WORK_DIR" "$TMP_WGT"
mkdir -p "$WORK_DIR" "$DIR/build"

# Remove any stale signatures before packing
rm -f "$SRC_DIR/author-signature.xml" "$SRC_DIR/signature1.xml"

cd "$SRC_DIR"
zip -q -r "$TMP_WGT" . -x "*.DS_Store" "*__MACOSX*"

echo "==> Signing package with Apps2Samsung Partner certificate..."
python3 -I "$DIR/tools/resign_wgt.py" "$TMP_WGT" "$OUT_WGT" "$CERT_DIR" "$WORK_DIR"

echo "==> Success! Generated signed package:"
ls -lh "$OUT_WGT"
