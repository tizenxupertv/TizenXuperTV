#!/usr/bin/env bash
# =============================================================================
# TizenXuper Pi — Actualización del catálogo estático
#
# Reemplaza el GitHub Actions "update-static-catalog.yml".
# Genera portal-catalog.json y live-channels.json desde la Pi
# (IP residencial, no bloqueada) y hace push a la rama catalog-data.
#
# Cron recomendado: cada hora (en vez de cada 4h como GitHub Actions)
# 0 * * * * /bin/bash ~/tizenxuper/update-catalog.sh >> ~/tizenxuper/catalog.log 2>&1
# =============================================================================
set -eo pipefail

# cron runs with a minimal PATH; node lives in ~/.local/bin
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env.pi"
LOG_FILE="$SCRIPT_DIR/catalog.log"
OUT_DIR="/tmp/tizenxuper-catalog"

# Cargar secrets
source "$ENV_FILE"

if [ -z "$GITHUB_TOKEN_TIZENXUPERTV" ]; then
  echo "[$(date -u +%FT%TZ)] ERROR: GITHUB_TOKEN_TIZENXUPERTV no encontrado en $ENV_FILE" | tee -a "$LOG_FILE"
  exit 1
fi

echo "[$(date -u +%FT%TZ)] Generando catálogo estático..." | tee -a "$LOG_FILE"

# Generar JSONs
mkdir -p "$OUT_DIR"
node "$SCRIPT_DIR/generate-static-catalog.mjs" --out "$OUT_DIR" 2>&1 | tee -a "$LOG_FILE"

# Push a catalog-data en GitHub
echo "[$(date -u +%FT%TZ)] Push a catalog-data..." | tee -a "$LOG_FILE"
rm -rf /tmp/pub-repo
git clone --depth 1 \
  "https://x-access-token:${GITHUB_TOKEN_TIZENXUPERTV}@github.com/tizenxupertv/TizenXuperTV.git" \
  /tmp/pub-repo 2>&1 | tee -a "$LOG_FILE"
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
  git push origin catalog-data --force
  echo "[$(date -u +%FT%TZ)] DONE — catálogo actualizado" | tee -a "$LOG_FILE"
else
  echo "[$(date -u +%FT%TZ)] Sin cambios en el catálogo" | tee -a "$LOG_FILE"
fi
