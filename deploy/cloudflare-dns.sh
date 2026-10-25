#!/usr/bin/env bash
# Execute on tx-vgm as the SSH user. The DNS token never leaves that server.
set -euo pipefail
zone=42f68fe79e7b1bc4459c835af58e9b18
target=b68c0640-2764-4b4d-80da-1fb4aaa766c6.cfargotunnel.com
token=$(sudo sed -n 's/^dns_cloudflare_api_token *= *//p' /etc/mini-tanks-certs/cloudflare.ini)
cf() {
  printf 'header = "Authorization: Bearer %s"\n' "$token" | curl -fsS --max-time 25 -K - "$@"
}
existing=$(cf "https://api.cloudflare.com/client/v4/zones/$zone/dns_records?name=appgap.if2.ai" | python3 -c '
import json,sys
x=json.load(sys.stdin); assert x["success"]
rows=x["result"]; assert len(rows)<=1
for r in rows:
 assert r["type"]=="CNAME" and r["content"]=="b68c0640-2764-4b4d-80da-1fb4aaa766c6.cfargotunnel.com" and r["proxied"]
 print(r["id"])
')
if [ -n "$existing" ]; then echo "CF_DNS_REUSED $existing"; exit 0; fi
cf -X POST "https://api.cloudflare.com/client/v4/zones/$zone/dns_records" \
  -H 'Content-Type: application/json' \
  --data-binary "{\"type\":\"CNAME\",\"name\":\"appgap\",\"content\":\"$target\",\"ttl\":1,\"proxied\":true}" |
  python3 -c 'import json,sys; x=json.load(sys.stdin); assert x["success"], x.get("errors"); r=x["result"]; print("CF_DNS_CREATED",r["id"],r["name"],r["content"],"proxied="+str(r["proxied"]))'
