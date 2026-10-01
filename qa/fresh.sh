#!/usr/bin/env bash
# BD limpia + stack reiniciado + usuario master de prueba + proxy con límite Vercel.
QA=$(cd "$(dirname "$0")" && pwd)
"$QA/reset-db.sh" || exit 1
rm -rf "$QA/storage-data" "$QA/storage-errors.log" "$QA/vercel-sim.log"
"$QA/restart-stack.sh"
pkill -f "node vercel-sim.mjs" 2>/dev/null
(cd "$QA" && nohup node vercel-sim.mjs > "$QA/vercel-sim.out" 2>&1 &)
sleep 1
curl -s -X POST http://localhost:3000/api/setup -H 'Content-Type: application/json' \
  -H 'x-setup-secret: local-qa-setup-secret' \
  -d '{"username":"qa_master","password":"QaMaster#2026","full_name":"QA Master (prueba)"}'
echo
