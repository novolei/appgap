#!/usr/bin/env bash
set -euo pipefail
export APPGAP_BACKUP="/var/backups/appgap/appgap-$(date -u +%Y%m%d-%H%M%S).sqlite"
/opt/appgap/runtime/node/bin/node dist-server/index.js --backup
gzip "$APPGAP_BACKUP"
python3 deploy/backup-steam.py "$APPGAP_BACKUP"
find /var/backups/appgap -maxdepth 1 -type f -name 'appgap-*.sqlite' -mtime +30 -delete
find /var/backups/appgap -maxdepth 1 -type f -name 'appgap-*.gz' -mtime +30 -delete
find /var/backups/appgap -maxdepth 1 -type f -name 'appgap-*.steam.*.gz' -mtime +7 -delete
