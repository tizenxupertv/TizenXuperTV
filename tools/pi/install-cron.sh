#!/usr/bin/env bash
# =============================================================================
# Instala los crons y los servicios en la Raspberry Pi
# Ejecutar como el usuario pi: bash install-cron.sh
# =============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Instalando crons..."

# 1. Renovar pool de sesiones cada 6 horas (00:00, 06:00, 12:00, 18:00 UTC)
add_cron() {
  local cron_line="$1"
  if crontab -l 2>/dev/null | grep -qxF "$cron_line"; then
    echo "   Ya existe: $cron_line"
  else
    (crontab -l 2>/dev/null; echo "$cron_line") | crontab -
    echo "   Instalado: $cron_line"
  fi
}

add_cron "0 */6 * * * /bin/bash $SCRIPT_DIR/refresh-and-deploy.sh >> $SCRIPT_DIR/relay-refresh.log 2>&1"

# 2. Actualizar catálogo cada hora
add_cron "5 * * * * /bin/bash $SCRIPT_DIR/update-catalog.sh >> $SCRIPT_DIR/catalog.log 2>&1"

# 3. Arrancar dashboard y servicios al encender la Pi (cron no tiene ~/.local/bin en PATH)
NODE_BIN="$(command -v node || echo "$HOME/.local/bin/node")"
for svc in dashboard health-monitor tg-listener session-watcher; do
  add_cron "@reboot cd $SCRIPT_DIR && $NODE_BIN $svc.mjs >> $SCRIPT_DIR/$svc.log 2>&1"
done

echo ""
echo "==> Crons instalados:"
crontab -l | grep -v "^#" | grep -v "^$"

echo ""
echo "==> Iniciando servicios en background (health monitor + telegram listener + session watcher)..."

# Matar instancias anteriores si las hay
pkill -f "health-monitor.mjs" 2>/dev/null || true
pkill -f "tg-listener.mjs" 2>/dev/null || true
pkill -f "session-watcher.mjs" 2>/dev/null || true
pkill -f "dashboard.mjs" 2>/dev/null || true
sleep 1

nohup node "$SCRIPT_DIR/dashboard.mjs" >> "$SCRIPT_DIR/dashboard.log" 2>&1 &
echo "   dashboard PID: $! (http://$(hostname -I | awk '{print $1}'):8080)"

# Iniciar los 3 servicios en background con nohup
nohup node "$SCRIPT_DIR/health-monitor.mjs" >> "$SCRIPT_DIR/health-monitor.log" 2>&1 &
echo "   health-monitor PID: $!"

nohup node "$SCRIPT_DIR/tg-listener.mjs" >> "$SCRIPT_DIR/tg-listener.log" 2>&1 &
echo "   tg-listener PID: $!"

nohup node "$SCRIPT_DIR/session-watcher.mjs" >> "$SCRIPT_DIR/session-watcher.log" 2>&1 &
echo "   session-watcher PID: $!"

echo ""
echo "==> ¡Todo listo! Logs disponibles en:"
echo "   relay-refresh.log    — Renovación del pool cada 6h"
echo "   catalog.log          — Actualización del catálogo cada 1h"
echo "   health-monitor.log   — Alertas de salud cada 15 min"
echo "   tg-listener.log      — Comandos de Telegram (/refresh, /status, /ping)"
echo "   session-watcher.log  — Medición de vida útil de sesiones"
