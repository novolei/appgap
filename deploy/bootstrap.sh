#!/usr/bin/env bash
# Run as root on rainplay; modifies only AppGap's own paths and units.
set -euo pipefail
if ! id appgap >/dev/null 2>&1; then useradd --system --home-dir /var/lib/appgap --shell /usr/sbin/nologin appgap; fi
install -d -m 755 /opt/appgap/runtime /opt/appgap/releases
install -d -o appgap -g appgap -m 700 /var/lib/appgap /var/backups/appgap
version=24.19.0
name="node-v${version}-linux-x64"
if [ ! -x "/opt/appgap/runtime/$name/bin/node" ]; then
  stage=$(mktemp -d /opt/appgap/runtime/download.XXXXXX)
  trap 'rm -rf -- "$stage"' EXIT
  cd "$stage"
  curl -fS --retry 2 --connect-timeout 10 --max-time 240 -O "https://nodejs.org/dist/v${version}/${name}.tar.xz"
  curl -fsS --connect-timeout 10 --max-time 30 -O "https://nodejs.org/dist/v${version}/SHASUMS256.txt"
  grep " ${name}.tar.xz\$" SHASUMS256.txt | sha256sum -c -
  tar -xJf "${name}.tar.xz" -C /opt/appgap/runtime
fi
ln -sfn "$name" /opt/appgap/runtime/node
if [ ! -e /etc/appgap.env ]; then
  umask 077
  python3 - <<'PY'
import pathlib,secrets
p=pathlib.Path('/etc/appgap.env')
p.write_text('PORT=8790\nPUBLIC_ORIGIN=https://appgap.if2.ai\nAPPGAP_DB=/var/lib/appgap/appgap.sqlite\nSITE_PASSWORD='+secrets.token_urlsafe(24)+'\n')
p.chmod(0o600)
print('Created /etc/appgap.env with a random site password; value not displayed')
PY
fi
/opt/appgap/runtime/node/bin/node --version
