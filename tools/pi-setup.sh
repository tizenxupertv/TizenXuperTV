#!/usr/bin/env bash
# =============================================================================
# TizenXuper Raspberry Pi Setup Script
# Raspberry Pi Model B+ (ARMv6, 32-bit) — Raspberry Pi OS Lite
#
# Instala Node.js, clona los scripts necesarios del proyecto y configura
# el cron que renueva el pool de sesiones del relay automáticamente.
#
# USO:
#   chmod +x pi-setup.sh && sudo ./pi-setup.sh
# =============================================================================
set -e

INSTALL_DIR="/home/pi/tizenxuper"
LOG_FILE="/home/pi/tizenxuper/relay-refresh.log"
CRON_SCHEDULE="0 */6 * * *"   # Cada 6 horas

echo "===> [1/5] Actualizando sistema..."
apt-get update -q
apt-get upgrade -y -q

echo "===> [2/5] Instalando dependencias del sistema..."
apt-get install -y -q curl git

echo "===> [3/5] Instalando Node.js 18.x (compatible ARMv6)..."
# Node.js 18 es el último con soporte armv6
# Usamos los binarios pre-compilados de unofficial-builds.nodejs.org
NODE_VERSION="18.20.5"
ARCH="armv6l"
NODE_URL="https://unofficial-builds.nodejs.org/download/release/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${ARCH}.tar.gz"

cd /tmp
curl -fsSL "$NODE_URL" -o node.tar.gz
tar -xzf node.tar.gz
cp -r node-v${NODE_VERSION}-linux-${ARCH}/bin/* /usr/local/bin/
cp -r node-v${NODE_VERSION}-linux-${ARCH}/lib/* /usr/local/lib/ 2>/dev/null || true
cp -r node-v${NODE_VERSION}-linux-${ARCH}/include/* /usr/local/include/ 2>/dev/null || true
rm -rf node.tar.gz node-v${NODE_VERSION}-linux-${ARCH}
echo "   Node.js: $(node --version)"
echo "   npm: $(npm --version)"

echo "===> [4/5] Creando directorio de trabajo: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
chown pi:pi "$INSTALL_DIR"

echo ""
echo "===> [5/5] TODO: copiar secrets y archivos del proyecto"
echo ""
echo "Pasos manuales que quedan (ver instrucciones en README-PI.md):"
echo "  1. Copiar .env.pi con CLOUDFLARE_API_TOKEN y CLOUDFLARE_ACCOUNT_ID"
echo "  2. Ejecutar: cd $INSTALL_DIR && sudo -u pi bash install-cron.sh"
echo ""
echo "INSTALACIÓN BASE COMPLETA."
