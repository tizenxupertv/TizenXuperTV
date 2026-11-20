# Raspberry Pi Setup — TizenXuper Relay

## Qué hace esta Pi
Renueva automáticamente el pool de sesiones del Worker `tizenxuper-relay` en Cloudflare
cada 6 horas, usando tu IP residencial (que Magis no tiene bloqueada).

## Pasos de instalación

### En tu Mac (desde el proyecto TizenXuper TV)

```bash
# 1. Copiar los scripts a la Pi (sustituye IP_DE_TU_PI)
PI_IP=192.168.1.X

# Scripts de renovación
scp -r tools/pi/ pi@$PI_IP:~/tizenxuper/

# Archivos del relay y herramientas (los que ya usa tools/deploy-relay-pool.sh)
scp tools/refresh-relay-pool.mjs             pi@$PI_IP:~/tizenxuper/
scp public/js/magis-client.js                pi@$PI_IP:~/tizenxuper/public/js/
scp public/js/crypto-js.min.js              pi@$PI_IP:~/tizenxuper/public/js/
scp -r tools/relay-worker/                   pi@$PI_IP:~/tizenxuper/

# 2. Crear el archivo de secrets en la Pi
ssh pi@$PI_IP "cp ~/tizenxuper/.env.pi.example ~/tizenxuper/.env.pi"
ssh pi@$PI_IP "nano ~/tizenxuper/.env.pi"   # Escribir el token real
```

### En la Raspberry Pi (vía SSH)

```bash
ssh pi@192.168.1.X

# Instalar Node.js 18 (ARMv6, unofficial builds)
NODE_VERSION="18.20.5"
curl -fsSL "https://unofficial-builds.nodejs.org/download/release/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-armv6l.tar.gz" -o /tmp/node.tar.gz
sudo tar -xzf /tmp/node.tar.gz -C /usr/local --strip-components=1
node --version  # Debe mostrar v18.20.5

# Instalar wrangler (una sola vez)
cd ~/tizenxuper/relay-worker
npm install

# Dar permisos de ejecución
chmod +x ~/tizenxuper/refresh-and-deploy.sh
chmod +x ~/tizenxuper/install-cron.sh

# Probar manualmente (primera vez)
bash ~/tizenxuper/refresh-and-deploy.sh

# Si funcionó, instalar el cron automático
bash ~/tizenxuper/install-cron.sh

# Verificar el cron
crontab -l
```

## Monitorear

```bash
# Ver log de la última ejecución del cron
tail -50 ~/tizenxuper/cron.log

# Ver log detallado de refresh
tail -50 ~/tizenxuper/relay-refresh.log

# Forzar una renovación manual ahora
bash ~/tizenxuper/refresh-and-deploy.sh
```

## Notas
- **ARMv6**: La Pi Model B+ usa ARMv6. Node.js oficial no lo soporta desde la v11.
  Usamos los binarios de https://unofficial-builds.nodejs.org (builds de confianza de la comunidad Node.js).
- **IP residencial**: Magis bloquea IPs de GitHub/Azure/Cloudflare. La Pi en tu casa
  tiene tu IP de ISP que sí está permitida, igual que tu Mac.
- **Consumo**: La Pi usa ~2 W encendida. El script de renovación tarda ~3 minutos
  y se ejecuta 4 veces al día (00:00, 06:00, 12:00, 18:00 UTC).
