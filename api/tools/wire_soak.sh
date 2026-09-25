#!/usr/bin/env bash
# Post-deploy soak: watch outbox lag, session continuity, public health and adjacent domains.
# Prints one line per sample and a final verdict. Fails if any sample regresses.
set -euo pipefail

cd /root/vexorygram
SAMPLES=${1:-10}
INTERVAL=${2:-30}
failures=0

psql_one() {
  docker exec gram-postgres-1 psql -U gram -d gram -Atc "$1"
}

for index in $(seq 1 "$SAMPLES"); do
  unpub=$(psql_one "select count(*) from realtime_outbox where published_at is null;")
  errs=$(psql_one "select count(*) from realtime_outbox where last_error_class is not null;")
  stale=$(psql_one "select count(*) from realtime_outbox where published_at is null and created_at < now() - interval '60 seconds';")
  sessions=$(psql_one "select count(*) from refresh_sessions where revoked_at is null and expires_at>now();")
  api=$(docker inspect gram-api-1 --format '{{.State.Health.Status}}')
  gw=$(docker inspect gram-gateway-1 --format '{{.State.Health.Status}}')
  health=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 https://vexory.xyz/health || echo ERR)
  root=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 https://vexory.xyz/ || echo ERR)
  wire=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 https://vexory.xyz/wire || echo ERR)
  printf 'sample=%s unpub=%s stale=%s errs=%s sessions=%s api=%s gw=%s health=%s root=%s wire_plain=%s\n' \
    "$index" "$unpub" "$stale" "$errs" "$sessions" "$api" "$gw" "$health" "$root" "$wire"
  [ "$stale" = "0" ] || failures=$((failures + 1))
  [ "$errs" = "0" ] || failures=$((failures + 1))
  [ "$api" = "healthy" ] || failures=$((failures + 1))
  [ "$gw" = "healthy" ] || failures=$((failures + 1))
  [ "$health" = "200" ] || failures=$((failures + 1))
  [ "$root" = "200" ] || failures=$((failures + 1))
  # A plain GET must stay refused: /wire is a WSS-only route.
  [ "$wire" = "403" ] || failures=$((failures + 1))
  [ "$index" = "$SAMPLES" ] || sleep "$INTERVAL"
done

for url in https://sleryx.xyz/ https://chat.sleryx.xyz/ https://picksy.my/ https://mail.vexory.xyz/; do
  code=$(curl -k -sS -o /dev/null -w '%{http_code}' --max-time 10 "$url" || echo ERR)
  printf 'adjacent %s %s\n' "$url" "$code"
  case "$code" in 200|301|302|308) ;; *) failures=$((failures + 1)) ;; esac
done

api_errors=$(docker logs --since 20m gram-api-1 2>&1 | grep -ciE 'traceback|unhandled' || true)
printf 'api_tracebacks=%s\n' "$api_errors"
[ "$api_errors" = "0" ] || failures=$((failures + 1))

printf 'soak_failures=%s\n' "$failures"
[ "$failures" = "0" ] || exit 1
echo "soak=ok"
