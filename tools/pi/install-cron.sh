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

# 2. Actualizar catálogo cada hora, en el minuto 30 (la renovación de las :00 tarda ~15 min en la B+)
CATALOG_CRON="30 * * * * /bin/bash $SCRIPT_DIR/update-catalog.sh >> $SCRIPT_DIR/catalog.log 2>&1"
if crontab -l 2>/dev/null | grep -F "$SCRIPT_DIR/update-catalog.sh" | grep -qvxF "$CATALOG_CRON"; then
  crontab -l | grep -vF "$SCRIPT_DIR/update-catalog.sh" | crontab -
  echo "   Quitado el horario anterior del catálogo"
fi
add_cron "$CATALOG_CRON"

# 3. Recortar los logs cada noche para no llenar la tarjeta SD
add_cron "15 3 * * * /bin/bash $SCRIPT_DIR/rotate-logs.sh"

# 4. Los servicios permanentes ya no arrancan con @reboot: los lleva systemd (ver abajo)
if crontab -l 2>/dev/null | grep -qF "@reboot cd $SCRIPT_DIR &&"; then
  crontab -l | grep -vF "@reboot cd $SCRIPT_DIR &&" | crontab -
  echo "   Quitadas las líneas @reboot antiguas"
fi

echo ""
echo "==> Crons instalados:"
crontab -l | grep -v "^#" | grep -v "^$"

echo ""
echo "==> Servicio systemd (panel + monitor de salud + bot de Telegram en un solo proceso)..."

# Parar las instancias sueltas de la instalación anterior
pkill -f "node .*dashboard.mjs" 2>/dev/null || true
pkill -f "node .*health-monitor.mjs" 2>/dev/null || true
pkill -f "node .*tg-listener.mjs" 2>/dev/null || true
sleep 1

mkdir -p "$HOME/.config/systemd/user"
cp "$SCRIPT_DIR/tizenxuper-pi.service" "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable tizenxuper-pi.service
systemctl --user restart tizenxuper-pi.service
systemctl --user --no-pager status tizenxuper-pi.service | head -5

if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" != "yes" ]; then
  echo ""
  echo "   ⚠️  Para que arranque al encender la Pi sin iniciar sesión, ejecuta una vez:"
  echo "       sudo loginctl enable-linger $USER"
fi

echo ""
echo "==> ¡Todo listo! Panel: http://$(hostname -I | awk '{print $1}'):8080"
echo "   relay-refresh.log    — Renovación del pool cada 6h"
echo "   catalog.log          — Actualización del catálogo cada hora (:30)"
echo "   health-monitor.log   — Alertas de salud cada 15 min"
echo "   tg-listener.log      — Comandos de Telegram (/refresh, /status, /ping)"
echo "   pi-services.log      — Errores del proceso de servicios"
echo "   session-watcher.mjs  — Experimento opcional, no se arranca solo:"
echo "                          nohup node session-watcher.mjs >> session-watcher.log 2>&1 &"
