#!/usr/bin/env bash
# =============================================================================
# TizenXuper — Renovación autónoma del pool de sesiones del Relay
# Ejecutar en la Raspberry Pi como: bash refresh-and-deploy.sh
# La salida va a stdout: el cron, el dashboard y el bot de Telegram la añaden a relay-refresh.log.
# =============================================================================
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env.pi"
POOL_FILE="$SCRIPT_DIR/relay-worker/src/sessionPool.js"
SESSION_COUNT="${SESSION_COUNT:-120}"
now() {
  # Same format as log-time.mjs: "Nov 21, 2026 12:58:27 am", the Pi's local time
  local m=(Ene Feb Mar Abr May Jun Jul Ago Sep Oct Nov Dic) mo d y t p
  read -r mo d y t p <<< "$(LC_ALL=C date '+%-m %-d %Y %-I:%M:%S %p')"
  echo "${m[mo-1]} $d, $y $t ${p,,}"
}

took() { local s=$(( $(date +%s) - START )); echo "$((s / 60)) min $((s % 60)) s"; }
# Portal calls, warnings and per-session lines are folded into summaries (log-filter.mjs)
quiet() { node "$SCRIPT_DIR/log-filter.mjs"; }

# Asegurar Node en PATH
export PATH="$HOME/.local/bin:$PATH"

# Una sola renovación a la vez (cron, dashboard y /refresh de Telegram)
exec 9>/tmp/tizenxuper-refresh.lock
if ! flock -n 9; then
  echo "[$(now)] Omitido: ya hay una renovación del pool en curso"
  exit 0
fi

# Cargar secrets
if [ ! -f "$ENV_FILE" ]; then
  echo "[$(now)] ERROR: Falta $ENV_FILE con CLOUDFLARE_API_TOKEN"
  exit 1
fi
# shellcheck source=/dev/null
source "$ENV_FILE"

if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  echo "[$(now)] ERROR: CLOUDFLARE_API_TOKEN vacío en $ENV_FILE"
  exit 1
fi

START=$(date +%s)
# A rule between runs, so each one stands apart in the log
echo "────────────────────────────────────────────────────────────"
echo "[$(now)] ▶ Pool: minando $SESSION_COUNT sesiones"

# 1. Minar sesiones (mint-worker sale con error y no toca el pool si no consigue suficientes)
node "$SCRIPT_DIR/mint-worker.mjs" "$SESSION_COUNT" 1 "$POOL_FILE" 2>&1 | quiet

# 2. Desplegar el Worker en Cloudflare directamente vía API REST
echo "[$(now)] Desplegando el Worker en Cloudflare"
node "$SCRIPT_DIR/deploy-via-api.mjs" 2>&1 | quiet

echo "[$(now)] ■ Pool renovado y desplegado en $(took)"
