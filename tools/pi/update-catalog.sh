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
now() { date -u +%FT%TZ; }

# One run at a time: overlapping runs on the single-core B+ make the portal time out
exec 9>/tmp/tizenxuper-catalog.lock
if ! flock -n 9; then
  echo "[$(now)] Omitido: ya hay una actualización del catálogo en curso"
  exit 0
fi
if pgrep -f "refresh-and-deploy.sh|mint-worker.mjs" > /dev/null; then
  echo "[$(now)] Omitido: la renovación del pool está en curso"
  exit 0
fi

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

# Push a catalog-data en GitHub
echo "[$(now)] Push a catalog-data..."
rm -rf /tmp/pub-repo
git clone -q --depth 1 --branch catalog-data \
  "https://x-access-token:${GITHUB_TOKEN_TIZENXUPERTV}@github.com/tizenxupertv/TizenXuperTV.git" \
  /tmp/pub-repo 2>&1
cd /tmp/pub-repo
git config user.name "TizenXuper Pi"
git config user.email "pi@tizenxupertv.local"
git checkout catalog-data 2>/dev/null || git checkout --orphan catalog-data
git rm -rf . > /dev/null 2>&1 || true
cp "$OUT_DIR/live-channels.json" .
cp "$OUT_DIR/portal-catalog.json" .
git add live-channels.json portal-catalog.json
if ! git diff --cached --quiet; then
  git commit -m "chore(data): auto-update catalog from Pi ($(date -u +'%Y-%m-%d %H:%M UTC'))"
  git push -q origin catalog-data --force 2>&1
  echo "[$(now)] DONE — catálogo actualizado"
else
  echo "[$(now)] Sin cambios en el catálogo"
fi
