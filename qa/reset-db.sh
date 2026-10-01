#!/usr/bin/env bash
# Recrea la BD local desde cero: bootstrap tipo Supabase + migraciones del repo.
# Uso: reset-db.sh [ruta_repo]
set -u
REPO=${1:-$(cd "$(dirname "$0")/.." && pwd)}
QA=$(cd "$(dirname "$0")" && pwd)
export PGHOST=127.0.0.1 PGPORT=54322 PGUSER=postgres
LOG=$QA/migrations.log
: > "$LOG"

psql -q -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='postgres' AND pid<>pg_backend_pid();" >/dev/null 2>&1
psql -q -d template1 -c "DROP DATABASE IF EXISTS postgres WITH (FORCE);" >>"$LOG" 2>&1
psql -q -d template1 -c "CREATE DATABASE postgres;" >>"$LOG" 2>&1
for r in anon authenticated service_role authenticator supabase_storage_admin; do
  psql -q -d template1 -c "DROP ROLE IF EXISTS $r;" >>"$LOG" 2>&1
done
export PGDATABASE=postgres
psql -q -v ON_ERROR_STOP=1 -f "$QA/bootstrap.sql" >>"$LOG" 2>&1 || { echo "BOOTSTRAP FAIL"; exit 1; }

fails=0
for f in "$REPO"/supabase/migrations/*.sql; do
  b=$(basename "$f")
  # Shim 2: según 20260918210804, en producción purchase_files tenía una lista
  # blanca "PDF-only" configurada a mano en el dashboard.
  if [[ "$b" == 20260918210804* ]]; then
    psql -q -c "UPDATE storage.buckets SET allowed_mime_types='{application/pdf}' WHERE id='purchase_files' AND allowed_mime_types IS NULL;" >>"$LOG" 2>&1
  fi
  echo "=== $b" >>"$LOG"
  opts=(-q -v ON_ERROR_STOP=1)
  grep -qiE '^\s*LOCK TABLE' "$f" && opts+=(-1)
  if psql "${opts[@]}" -f "$f" >>"$LOG" 2>&1; then :; else echo "FAIL $b"; fails=$((fails+1)); fi
done
echo "migraciones con error: $fails"
