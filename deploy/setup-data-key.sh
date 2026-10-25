#!/usr/bin/env bash
set -euo pipefail
test ! -e /etc/appgap-data.key
umask 077
ssh-keygen -q -t ed25519 -N '' -C appgap-private-data-readonly -f /etc/appgap-data.key
chmod 600 /etc/appgap-data.key
cat > /etc/appgap-github-known-hosts <<'HOSTS'
[ssh.github.com]:443 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl
HOSTS
chmod 644 /etc/appgap-github-known-hosts
ssh-keygen -lf /etc/appgap-github-known-hosts
echo APPGAP_DATA_KEY_READY
