#!/usr/bin/env bash
# =============================================================================
# TizenXuper — Renovación autónoma del pool de sesiones del Relay
# Ejecutar en la Raspberry Pi como: bash refresh-and-deploy.sh
# =============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env.pi"
LOG_FILE="$SCRIPT_DIR/relay-refresh.log"
SESSION_COUNT="${SESSION_COUNT:-120}"

# Asegurar Node en PATH
export PATH="$HOME/.local/bin:$PATH"

# Cargar secrets
if [ ! -f "$ENV_FILE" ]; then
  echo "[$(date -u +%FT%TZ)] ERROR: Falta $ENV_FILE con CLOUDFLARE_API_TOKEN" | tee -a "$LOG_FILE"
  exit 1
fi
# shellcheck source=/dev/null
source "$ENV_FILE"

if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  echo "[$(date -u +%FT%TZ)] ERROR: CLOUDFLARE_API_TOKEN vacío en $ENV_FILE" | tee -a "$LOG_FILE"
  exit 1
fi

echo "[$(date -u +%FT%TZ)] START — minando $SESSION_COUNT sesiones desde la Pi..." | tee -a "$LOG_FILE"

# 1. Minar sesiones usando el minero optimizado para ARMv6
node "$SCRIPT_DIR/mint-worker.mjs" \
  "$SESSION_COUNT" \
  1 \
  "$SCRIPT_DIR/relay-worker/src/sessionPool.js" 2>&1 | tee -a "$LOG_FILE"

# 2. Desplegar el Worker en Cloudflare directamente vía API REST (ultrarrápido, 0 esbuild)
echo "[$(date -u +%FT%TZ)] Desplegando Worker a Cloudflare..." | tee -a "$LOG_FILE"
node "$SCRIPT_DIR/deploy-via-api.mjs" 2>&1 | tee -a "$LOG_FILE"

echo "[$(date -u +%FT%TZ)] DONE — Pool renovado y desplegado con éxito" | tee -a "$LOG_FILE"
