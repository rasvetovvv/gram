#!/usr/bin/env bash
# Public WSS canary for GRAM Wire social events, using an isolated synthetic account.
#
# Mints a real one-minute ticket through the public API, connects to wss://vexory.xyz/wire with
# Ed25519 identity pinning, drains replay, then enqueues one social outbox row and proves it
# arrives as a live encrypted event. Prints only markers — never the ticket or the token.
set -euo pipefail

cd /root/vexorygram
ACCOUNT_FILE=.rollback/canary-account.tmp
TICKET_FILE=$(mktemp)
PROBE_LOG=$(mktemp)
chmod 600 "$TICKET_FILE" "$PROBE_LOG"
trap 'rm -f "$TICKET_FILE" "$PROBE_LOG"' EXIT

USER_ID=$(grep -E '^user_id=' "$ACCOUNT_FILE" | cut -d= -f2)

# Access tokens expire in minutes, so mint a fresh one per run instead of reusing the one
# printed at account creation.
docker cp api/tools/wire_canary_account.py gram-api-1:/tmp/wire_canary_account.py >/dev/null
ACCESS_TOKEN=$(docker exec -w /app gram-api-1 sh -lc \
  "PYTHONPATH=/app /app/.venv/bin/python /tmp/wire_canary_account.py token ${USER_ID}" \
  | grep -E '^access_token=' | cut -d= -f2-)

http_code=$(curl -sS -o "$TICKET_FILE" -w '%{http_code}' --max-time 10 \
  -X POST https://vexory.xyz/api/auth/wire-ticket \
  -H "Authorization: Bearer ${ACCESS_TOKEN}")
printf 'ticket_http=%s\n' "$http_code"
[ "$http_code" = "200" ] || { echo "canary=failed stage=ticket"; exit 1; }

python3 - "$TICKET_FILE" <<'PY'
import json, sys
path = sys.argv[1]
with open(path) as handle:
    ticket = json.load(handle)["ticket"]
with open(path, "w") as handle:
    handle.write(ticket)
PY

export WIRE_PROBE_IDENTITY_PUBLIC_KEY_FILE=/root/vexorygram/secrets/wire_identity_public_key_b64
export WIRE_PROBE_URL=wss://vexory.xyz/wire
export WIRE_PROBE_ORIGIN=https://vexory.xyz
export WIRE_PROBE_EXPECT_LIVE_EVENT=true

./.rollback/wire-wss-probe < "$TICKET_FILE" > "$PROBE_LOG" 2>&1 &
probe_pid=$!

for _ in $(seq 1 40); do
  grep -q awaiting_live_event "$PROBE_LOG" && break
  sleep 0.5
done

docker exec -w /app gram-api-1 sh -lc \
  "PYTHONPATH=/app /app/.venv/bin/python /tmp/wire_canary_account.py enqueue ${USER_ID} post_created"

set +e
wait "$probe_pid"
probe_exit=$?
set -e
sed -e 's/[A-Za-z0-9_-]\{40,\}/<redacted>/g' "$PROBE_LOG"
printf 'probe_exit=%s\n' "$probe_exit"
exit "$probe_exit"
