# QA end-to-end (entorno local)

Batería de pruebas de navegador (Playwright) que recorre los flujos de la app
con usuarios y datos de ejemplo marcados `QA` / `qa_*`. Corre contra un
entorno **local** que imita a Supabase, así que no toca producción.

## Qué levanta

| Pieza | Puerto | Qué hace |
| --- | --- | --- |
| Postgres 16 | 54322 | `reset-db.sh` aplica `bootstrap.sql` (roles y esquemas de Supabase) y **todas** las migraciones del repo |
| PostgREST | 54331 | API REST, igual que Supabase |
| `gateway.mjs` | 54321 | `/rest/v1` → PostgREST; `/storage/v1` → emulador de Storage con las mismas validaciones que Supabase: bucket, `file_size_limit` (y límite global de 50 MB), `allowed_mime_types`, nombres válidos (`Invalid key`) y RLS real de `storage.objects` |
| Next (`npm run dev`) | 3000 | la app |
| `vercel-sim.mjs` | 3001 | proxy delante de Next con el límite de **4.5 MB** por request de las funciones de Vercel |

`reset-db.sh` además reproduce la configuración manual de producción del bucket
`purchase_files` (lista blanca sólo-PDF antes de 20260918210804).

## Primera vez

```bash
npm install
npm install --no-save playwright           # el navegador lo trae Playwright o usa CHROMIUM_PATH
docker run -d --name smaa-qa-pg -p 54322:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16
# PostgREST v12: binario de https://github.com/PostgREST/postgrest/releases (o POSTGREST_BIN=...)
node qa/setup.mjs                          # llaves JWT locales, postgrest.conf y .env.local
npm run dev &                              # Next en :3000
```

## Correr todo

```bash
qa/run-all.sh          # BD limpia + usuarios + todos los flujos + barrido de pantallas
```

Cada corrida deja su salida en `qa/run-<fecha>/` y capturas de las fallas en
`qa/e2e/shots/`. Los errores de Storage quedan en `qa/storage-errors.log` y los
rechazos por tamaño (simulación de Vercel) en `qa/vercel-sim.log`.

## Scripts

| Script | Cubre |
| --- | --- |
| `e2e-01-users` | alta de empleados desde la UI, foto, rol y matriz de permisos (8 usuarios `qa_*`; `qa_master` lo crea `fresh.sh`) |
| `e2e-02-req-purchases` | proveedores (CSF, RFC con Ñ), requisiciones por rol, cierre de compra → PO, compras (única, multicompra, recepción con fotos grandes, edición, adjuntos, obsoletar, PDF) |
| `e2e-03-crawl` | abre las ~45 pantallas con cada usuario: acceso, errores de render/JS/HTTP |
| `e2e-04-navlinks` | que las tarjetas del Inicio y el menú lateral no lleven a "acceso denegado" |
| `e2e-05-sales-mfg` | clientes, cotización, OT de soldadura con WPS, operador (iniciar/pausar/terminar con fotos y firma), liberación por Calidad, entrega |
| `e2e-06-deliveries` | fotos de embalaje, PDF, firma de entrega |
| `e2e-07-finance-settings` | expediente (bucket privado, PDF de 4 MB), logo de la empresa |
| `e2e-08-declarations` | acuse del SAT con acentos en el nombre |
| `e2e-09-xml` | importación de XML de facturas emitidas |
| `theme-check` | tema claro/oscuro, móvil y modales sobre el menú lateral |

## Limpiar datos de ejemplo en otra base

`scripts/qa-cleanup.sql` borra sólo los registros ligados a los identificadores
exactos de esta batería (usuarios `qa_*`, RFCs QA, UUID del CFDI de prueba).
Termina en `ROLLBACK`: revisa los conteos y cámbialo a `COMMIT`.
