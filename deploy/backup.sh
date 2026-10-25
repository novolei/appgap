#!/usr/bin/env bash
set -euo pipefail
export APPGAP_BACKUP="/var/backups/appgap/appgap-$(date -u +%Y%m%d-%H%M%S).sqlite"
/opt/appgap/runtime/node/bin/node dist-server/index.js --backup
gzip "$APPGAP_BACKUP"
python3 deploy/backup-steam.py "$APPGAP_BACKUP"
if [ -f "${APPGAP_DB%/*}/donations/qr.png" ]; then
  gzip -c "${APPGAP_DB%/*}/donations/qr.png" > "${APPGAP_BACKUP}.donation-qr.png.gz"
fi
find /var/backups/appgap -maxdepth 1 -type f -name 'appgap-*.sqlite' -mtime +30 -delete
find /var/backups/appgap -maxdepth 1 -type f -name 'appgap-*.gz' -mtime +30 -delete
find /var/backups/appgap -maxdepth 1 -type f -name 'appgap-*.steam.*.gz' -mtime +7 -delete
