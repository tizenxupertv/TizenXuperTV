#!/usr/bin/env bash
# =============================================================================
# Recorta los logs de ~/tizenxuper para que no llenen la tarjeta SD.
# Sin logrotate: los procesos tienen los archivos abiertos en modo append, así que
# se reescriben en el mismo archivo (como copytruncate) dejando las últimas líneas.
# Cron diario: 15 3 * * * /bin/bash ~/tizenxuper/rotate-logs.sh
# =============================================================================
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MAX_BYTES="${MAX_BYTES:-1048576}"
KEEP_LINES="${KEEP_LINES:-3000}"
now() {
  # Same format as log-time.mjs: "Nov 21, 2026 12:58:27 am", the Pi's local time
  local m=(Ene Feb Mar Abr May Jun Jul Ago Sep Oct Nov Dic) mo d y t p
  read -r mo d y t p <<< "$(LC_ALL=C date '+%-m %-d %Y %-I:%M:%S %p')"
  echo "${m[mo-1]} $d, $y $t ${p,,}"
}

for log in "$SCRIPT_DIR"/*.log; do
  [ -f "$log" ] || continue
  size=$(stat -c %s "$log")
  if [ "$size" -gt "$MAX_BYTES" ]; then
    tail -n "$KEEP_LINES" "$log" > "$log.tmp"
    cat "$log.tmp" > "$log"
    rm -f "$log.tmp"
    echo "[$(now)] recortado $(basename "$log"): $size bytes -> $(stat -c %s "$log")"
  fi
done
