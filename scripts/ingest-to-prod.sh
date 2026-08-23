#!/usr/bin/env bash
# Fetch Apple charts from this machine (home IP) and write into production D1.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-8799}"
LOCK="/tmp/appgap-ingest.lock"
LOG="${APPGAP_INGEST_LOG:-$HOME/Library/Logs/appgap-ingest.log}"
mkdir -p "$(dirname "$LOG")"

export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY all_proxy no_proxy NO_PROXY

if [ -f "$ROOT/.env.prd" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env.prd"
  set +a
fi

if ! mkdir "$LOCK" 2>/dev/null; then
  echo "$(date '+%F %T') ingest already running" | tee -a "$LOG"
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

{
  echo "======== $(date '+%F %T') start ========"
  echo "node=$(command -v node) $(node -v 2>/dev/null || true)"
  echo "wrangler=$(command -v wrangler || echo "$ROOT/node_modules/.bin/wrangler")"
} >>"$LOG"

WRANGLER=("${ROOT}/node_modules/.bin/wrangler")
if [ ! -x "${WRANGLER[0]}" ]; then
  WRANGLER=(pnpm exec wrangler)
fi

"${WRANGLER[@]}" d1 migrations apply appgap --remote >>"$LOG" 2>&1

"${WRANGLER[@]}" dev -c wrangler.ingest.jsonc --port "$PORT" --ip 127.0.0.1 >>"$LOG" 2>&1 &
PID=$!
cleanup() {
  kill "$PID" 2>/dev/null || true
  wait "$PID" 2>/dev/null || true
  rmdir "$LOCK" 2>/dev/null || true
}
trap cleanup EXIT

ready=0
for _ in $(seq 1 90); do
  if curl -sf -m 3 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "wrangler exited before becoming ready" >>"$LOG"
    tail -n 40 "$LOG"
    exit 1
  fi
  sleep 1
done

if [ "$ready" != 1 ]; then
  echo "wrangler did not become ready" >>"$LOG"
  exit 1
fi

echo "$(date '+%F %T') posting ingest" >>"$LOG"
HTTP_CODE=""
BODY=""
for attempt in 1 2 3 4 5; do
  RESP="$(curl -sS -m 480 -w "\n%{http_code}" -X POST "http://127.0.0.1:${PORT}/api/ingest" || true)"
  HTTP_CODE="$(printf '%s' "$RESP" | tail -n 1)"
  BODY="$(printf '%s' "$RESP" | sed '$d')"
  printf '%s\n' "$BODY" | tee -a "$LOG"
  echo "http $HTTP_CODE attempt $attempt" >>"$LOG"
  if [ "$HTTP_CODE" = "200" ] && printf '%s' "$BODY" | grep -q '"stats"'; then
    break
  fi
  if [ "$HTTP_CODE" = "409" ]; then
    echo "$(date '+%F %T') ingest already running" >>"$LOG"
    exit 1
  fi
  sleep $((attempt * 2))
done
if [ "$HTTP_CODE" != "200" ] || ! printf '%s' "$BODY" | grep -q '"stats"'; then
  echo "$(date '+%F %T') ingest failed" >>"$LOG"
  exit 1
fi
echo >>"$LOG"
echo "$(date '+%F %T') done" >>"$LOG"
