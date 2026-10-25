#!/usr/bin/env bash
set -euo pipefail
version=${1:?release hash required}
[[ "$version" =~ ^[a-f0-9]{12,40}$ ]] || { echo 'invalid release version'; exit 1; }
archive="/tmp/appgap-${version}.tar.gz"
release="/opt/appgap/releases/$version"
test -f "$archive"
test ! -e "$release"
old=$(readlink -f /opt/appgap/current || true)
install -d -m 755 "$release"
tar -xzf "$archive" -C "$release"
find "$release/deploy" -type f -exec sed -i 's/\r$//' {} +
install -m 644 "$release"/deploy/appgap*.service "$release"/deploy/appgap*.timer /etc/systemd/system/
systemctl daemon-reload
ln -s "$release" /opt/appgap/.current-new
mv -Tf /opt/appgap/.current-new /opt/appgap/current
rollback() {
  if [ -n "$old" ] && [ -d "$old" ]; then
    ln -s "$old" /opt/appgap/.current-rollback
    mv -Tf /opt/appgap/.current-rollback /opt/appgap/current
    systemctl restart appgap
  else systemctl stop appgap; fi
  echo 'AppGap health check failed; previous application restored if available'
  exit 1
}
systemctl restart appgap || rollback
healthy=0
for _ in $(seq 1 20); do
  if curl -fsS --max-time 2 http://127.0.0.1:8790/api/health >/dev/null; then healthy=1; break; fi
  sleep 1
done
[ "$healthy" = 1 ] || rollback
if [ -n "$old" ]; then ln -sfn "$old" /opt/appgap/previous; fi
systemctl enable appgap appgap-ingest.timer appgap-backup.timer
systemctl start appgap-ingest.timer appgap-backup.timer
for legacy in appgap-steam.timer appgap-steam-sync.timer; do
  if systemctl cat "$legacy" >/dev/null 2>&1; then systemctl disable --now "$legacy"; fi
done
echo "APPGAP_DEPLOY_OK $version"
