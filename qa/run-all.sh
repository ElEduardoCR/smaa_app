#!/usr/bin/env bash
# Corre toda la batería E2E desde una BD limpia y resume PASS/FAIL.
# Requiere: stack local arriba (ver qa/README.md) y Next en :3000.
QA=$(cd "$(dirname "$0")" && pwd)
export BASE_URL=${BASE_URL:-http://localhost:3001}   # 3001 = proxy con el límite de Vercel
export FIXED=${FIXED:-1}
OUT="$QA/run-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
"$QA/fresh.sh" > "$OUT/00-fresh.txt" 2>&1
cd "$QA/e2e"
for s in e2e-01-users e2e-02-req-purchases e2e-05-sales-mfg e2e-06-deliveries e2e-07-finance-settings e2e-08-declarations e2e-09-xml; do
  timeout 1500 node "$s.mjs" > "$OUT/$s.out" 2>&1
  echo "== $s (exit $?)"
done
USERS=qa_master,qa_admin,qa_operador,qa_almacen,qa_finanzas,qa_cxc,qa_calidad,qa_docs,qa_direccion \
  timeout 2400 node e2e-03-crawl.mjs > "$OUT/e2e-03-crawl.out" 2>&1
timeout 900 node e2e-04-navlinks.mjs > "$OUT/e2e-04-navlinks.out" 2>&1
node -e '
const fs=require("fs"); const dir=process.argv[1];
for (const f of fs.readdirSync(dir).filter(f=>/^e2e-0[125679]/.test(f)).sort()) {
  const o=fs.readFileSync(dir+"/"+f,"utf8"); const i=o.indexOf("{\n");
  console.log("\n### "+f);
  if (i<0) { console.log(o.slice(-1500)); continue; }
  try { const j=JSON.parse(o.slice(i)); for (const s of (j.steps||j.results||[])) console.log((s.ok?"PASS":"FAIL")+" | "+(s.name||s.user)+" | "+String(s.note||"").slice(0,220)); }
  catch(e){ console.log(o.slice(-1500)); }
}' "$OUT"
echo; echo "### e2e-08"; tail -6 "$OUT/e2e-08-declarations.out"
echo; echo "### e2e-09"; tail -6 "$OUT/e2e-09-xml.out"
echo; echo "### navlinks"; grep -E '^qa_|DENEGADO' "$OUT/e2e-04-navlinks.out"
echo "salida en $OUT"
