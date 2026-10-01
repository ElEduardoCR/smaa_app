#!/usr/bin/env bash
# Reinicia PostgREST y el gateway (después de un reset-db.sh).
QA=$(cd "$(dirname "$0")" && pwd)
POSTGREST_BIN=${POSTGREST_BIN:-postgrest}
pkill -f "$QA/postgrest.conf" 2>/dev/null
pkill -f "node gateway.mjs" 2>/dev/null
sleep 1
nohup "$POSTGREST_BIN" "$QA/postgrest.conf" > "$QA/postgrest.log" 2>&1 &
(cd "$QA" && nohup node gateway.mjs > "$QA/gateway.log" 2>&1 &)
for i in $(seq 1 30); do
  curl -s -o /dev/null http://127.0.0.1:54331/ && curl -s -o /dev/null http://127.0.0.1:54321/rest/v1/ && break
  sleep 0.5
done
echo "postgrest: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:54331/)  gateway: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:54321/rest/v1/)"
