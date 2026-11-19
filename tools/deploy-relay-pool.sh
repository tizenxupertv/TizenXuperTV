#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "$0")/.." && pwd)"
RELAY_DIR="$DIR/../tizenxuper-relay"
BOT_VARS="$DIR/../TizenXuper Bot/.dev.vars"
COUNT="${1:-120}"

echo "==> 1. Generando $COUNT sesiones frescas..."
node "$DIR/tools/refresh-relay-pool.mjs" --count "$COUNT" --out "$RELAY_DIR/src/sessionPool.js"

TOKEN="${CLOUDFLARE_API_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -f "$BOT_VARS" ]; then
  TOKEN=$(grep "^CLOUDFLARE_API_TOKEN=" "$BOT_VARS" | cut -d= -f2- | tr -d "\"'")
fi

if [ -z "$TOKEN" ]; then
  echo "ERROR: CLOUDFLARE_API_TOKEN no encontrado."
  exit 1
fi

echo "==> 2. Desplegando tizenxuper-relay con $COUNT sesiones..."
cd "$RELAY_DIR"
CLOUDFLARE_API_TOKEN="$TOKEN" CLOUDFLARE_ACCOUNT_ID="0bc7ecd836f7da439e1e953e00df9da3" npx wrangler deploy
echo "==> ¡Listo!"
