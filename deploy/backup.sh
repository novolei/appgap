#!/usr/bin/env bash
set -euo pipefail
export APPGAP_BACKUP="/var/backups/appgap/appgap-$(date -u +%Y%m%d-%H%M%S).sqlite"
/opt/appgap/runtime/node/bin/node dist-server/index.js --backup
find /var/backups/appgap -maxdepth 1 -type f -name 'appgap-*.sqlite' -mtime +30 -delete
