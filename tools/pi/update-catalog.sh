#!/usr/bin/env bash
# =============================================================================
# TizenXuper Pi — Actualización del catálogo estático
#
# Reemplaza el GitHub Actions "update-static-catalog.yml".
# Genera portal-catalog.json y live-channels.json desde la Pi
# (IP residencial, no bloqueada) y hace push a la rama catalog-data.
#
# Cron (minuto 30, cuando la renovación del pool de las :00 ya terminó; la salida va al log desde el cron):
# 30 * * * * /bin/bash ~/tizenxuper/update-catalog.sh >> ~/tizenxuper/catalog.log 2>&1
# =============================================================================
set -eo pipefail

# cron runs with a minimal PATH; node lives in ~/.local/bin
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env.pi"
OUT_DIR="/tmp/tizenxuper-catalog"
now() { date '+%Y-%m-%d %H:%M:%S'; }

# One run at a time: overlapping runs on the single-core B+ make the portal time out
exec 9>/tmp/tizenxuper-catalog.lock
if ! flock -n 9; then
  echo "[$(now)] Omitido: ya hay una actualización del catálogo en curso"
  exit 0
fi
# refresh-and-deploy.sh holds this lock while it runs
exec 8>/tmp/tizenxuper-refresh.lock
if ! flock -n 8; then
  echo "[$(now)] Omitido: la renovación del pool está en curso"
  exit 0
fi
flock -u 8

# Cargar secrets
source "$ENV_FILE"

if [ -z "$GITHUB_TOKEN_TIZENXUPERTV" ]; then
  echo "[$(now)] ERROR: GITHUB_TOKEN_TIZENXUPERTV no encontrado en $ENV_FILE"
  exit 1
fi

echo "[$(now)] Generando catálogo estático..."

# Generar JSONs
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
node "$SCRIPT_DIR/generate-static-catalog.mjs" --out "$OUT_DIR" 2>&1

# First two See-all pages of every home row (a failure only leaves See-all to the portal)
node "$SCRIPT_DIR/generate-columns.mjs" "$OUT_DIR/portal-catalog.json" "$OUT_DIR/column" 2>&1 || echo "[$(now)] Páginas de «Ver todo» omitidas"

# Light copies of the 2-4 MB backdrops and previews, for the catalog and those pages (never fails the run)
node "$SCRIPT_DIR/optimize-images.mjs" "$OUT_DIR/portal-catalog.json" "$OUT_DIR"/column/*.json 2>&1

# Push a catalog-data en GitHub
echo "[$(now)] Push a catalog-data..."
rm -rf /tmp/pub-repo
git clone -q --depth 1 --branch catalog-data \
  "https://x-access-token:${GITHUB_TOKEN_TIZENXUPERTV}@github.com/tizenxupertv/TizenXuperTV.git" \
  /tmp/pub-repo 2>&1
cd /tmp/pub-repo
git config user.name "TizenXuper Pi"
git config user.email "pi@tizenxupertv.local"

# generatedAt changes on every run: compare the content without it, or every hour would publish the same catalog
same_content() {
  node -e '
    const fs = require("fs");
    const read = (f) => { try { const j = JSON.parse(fs.readFileSync(f, "utf8")); delete j.generatedAt; return JSON.stringify(j); } catch { return null; } };
    process.exit(read(process.argv[1]) !== null && read(process.argv[1]) === read(process.argv[2]) ? 0 : 1);
  ' "$1" "$2"
}
if same_content live-channels.json "$OUT_DIR/live-channels.json" && same_content portal-catalog.json "$OUT_DIR/portal-catalog.json"; then
  echo "[$(now)] Sin cambios en el catálogo"
else
  # One commit that replaces the branch, so the public repository does not grow by a catalog copy every hour
  git checkout -q --orphan catalog-new
  git rm -rfq . > /dev/null 2>&1 || true
  cp "$OUT_DIR/live-channels.json" .
  cp "$OUT_DIR/portal-catalog.json" .
  git add live-channels.json portal-catalog.json
  git commit -q -m "chore(data): auto-update catalog from Pi ($(date -u +'%Y-%m-%d %H:%M UTC'))"
  git push -q --force origin HEAD:catalog-data 2>&1
  echo "[$(now)] DONE — catálogo actualizado"
  # The same files for the Cloudflare Pages copy, which TVs read first (tizenxuper-tv.pages.dev/data redirects there)
  mkdir -p "$SCRIPT_DIR/site-data"
  cp "$OUT_DIR/live-channels.json" "$OUT_DIR/portal-catalog.json" "$SCRIPT_DIR/site-data/"
fi

# See-all pages for Pages: only the ones that changed are rewritten, so an unchanged hour triggers no deployment
mkdir -p "$SCRIPT_DIR/site-data/column"
for f in "$OUT_DIR"/column/*.json; do
  [ -f "$f" ] || continue
  dest="$SCRIPT_DIR/site-data/column/$(basename "$f")"
  cmp -s "$f" "$dest" || cp "$f" "$dest"
done

# Images and catalog to Cloudflare Pages: at most one deployment every 90 min, never fails the run
cd "$SCRIPT_DIR"
node "$SCRIPT_DIR/pages-site.mjs" 2>&1
