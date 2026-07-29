# 🧪 Protocolo de Testing — SMAA ERP

> Generado el 2026-07-29 después de los fixes de permisos, auto-PO, CSF parser, server actions gateadas, soft-delete (obsolete/restore) en clientes/proveedores/empleados/POs, y módulo Cuentas por Cobrar.

Este documento te dice **exactamente** cómo probar el flujo end-to-end de los 5 fixes que aplicamos. Hay dos niveles:

1. **Tests automatizados** (los que YO corrí): corren sin browser, contra la DB real
2. **Tests manuales** (los que TÚ debes correr): necesitan browser, login real, click por click

---

## 🚀 Setup (una sola vez)

### 1. Instalar dependencias para los tests

Los scripts de test usan `pg` (driver de Postgres) y `server-only` (necesario para importar lógica de permisos). Hay que instalarlos en una carpeta temporal para no tocar el `package.json` del proyecto.

```powershell
New-Item -ItemType Directory -Force -Path "C:\tmp-pg-runner"
Set-Location "C:\tmp-pg-runner"
npm init -y
npm install pg @types/pg server-only
```

### 2. Configurar la variable de entorno

Los scripts leen `DB_URL` con la connection string directa a Supabase:

```powershell
$env:DB_URL = "postgresql://postgres:para1usodewibn2@db.mvjrqgyrjoawdhpalbix.supabase.co:5432/postgres"
$env:NODE_PATH = "C:\tmp-pg-runner\node_modules"
```

(Ajusta el password si lo cambiaste. NO commitees esta URL al repo — está solo en tu shell.)

---

## ✅ Tests automatizados (86/86 pasan)

Hay 3 scripts. Cada uno es independiente. Los puedes correr en cualquier orden.

### Test 1: Parser de CSF (19/19)

```powershell
Set-Location "C:\smaa app\smaa_app"
npx tsx scripts/test-csf-parser.ts
```

**Qué valida:**
- ✅ Extrae RFC de Persona Física (13 chars): `MATE8602263P8`
- ✅ Combina Nombre + Apellidos: `"Edel Argenis Maulas Torres"`
- ✅ Extrae CP fiscal: `31060`
- ✅ Detecta régimen más reciente en una lista (no el primero): `626` (RESICO)
- ✅ Concatena dirección completa: `"Tamborel, #3900, Col. Lealtad I, Chihuahua, Chihuahua"`
- ✅ Email y phone del SAT no se filtran (solo el del contribuyente)
- ✅ Texto vacío / no-CSF devuelve `null` en todos los campos
- ✅ Soporta formato PM (Razón Social en vez de Nombre+Apellidos)
- ✅ Mapea correctamente: 601, 605, 606, 625, 626

**Output esperado:** `📊 Resumen: 19 pasaron, 0 fallaron (de 19 total)`

### Test 2: Schema de DB (30/30)

```powershell
Set-Location "C:\smaa app\smaa_app"
npx tsx scripts/permission-tests.ts
```

**Qué valida:**
- ✅ Esquema `requisitions` + `requisition_items` + `requisition_quotations` (para uploads de cotizaciones)
- ✅ `purchase_orders.supplier_id` ahora es nullable (gracias a la migration)
- ✅ `purchase_orders.notes` existe
- ✅ `purchase_orders.requisition_id` FK linkea a requisitions
- ✅ Status "Received" es válido
- ✅ Se puede crear PO con/sin supplier
- ✅ Se puede linkear PO a requisición
- ✅ Tabla `suppliers` es legible y permite crear con todos los campos del CSF
- ✅ Esquema `manufacturing_modules` existe
- ✅ FKs de `employee_permissions` apuntan a `employees` (no `payroll_employees`)
- ✅ Se pueden asignar permisos por sub-módulo (manufacturing:maquinado, etc.)
- ✅ **SCHEMA-004** `clients.is_active` (boolean, NOT NULL, default true) — soft-delete
- ✅ **SCHEMA-005** `suppliers.is_active` (boolean, NOT NULL, default true) — soft-delete
- ✅ **SCHEMA-006** `purchase_orders.is_active` (boolean, NOT NULL, default true) — soft-delete
- ✅ **SCHEMA-007** Índices parciales `idx_*_is_active` existen en las 3 tablas
- ✅ **SCHEMA-008** Round-trip de `is_active` (crear → false → true)
- ✅ **AR-001** Las 6 tablas AR existen
- ✅ **AR-002** `ar_invoices.balance` es GENERATED ALWAYS (net - paid)
- ✅ **AR-003** Cálculo de IVA 16% server-side (round-trip)
- ✅ **AR-004** Trigger `ar_recalc_invoice` actualiza paid_amount + status al insertar allocation
- ✅ **AR-005** `ar_share_links.token_hash` se guarda como SHA-256 hex de 64 chars
- ✅ **AR-006** Promesas + items registran分配的分配的分配的facturas y total
- ✅ **AR-007** 11 índices AR parciales
- ✅ **AR-008** RLS habilitado en las 6 tablas

**Output esperado:** `📊 Resumen: 30 pasaron, 0 fallaron (de 30 total)`

### Test 3: Lógica de server actions (37/37)

```powershell
Set-Location "C:\smaa app\smaa_app"
npx tsx scripts/test-server-actions.ts
```

**Qué valida (simula la lógica de cada server action):**
- ✅ **C-001** master puede crear cliente
- ✅ **C-002** admin con `can_create` puede crear cliente
- ✅ **C-003** operator SOLO con `view` NO puede crear cliente (regression test del bug original)
- ✅ **C-004** operator con `view` puede ver clientes
- ✅ **C-005** operator sin `can_delete` NO puede eliminar cliente
- ✅ **S-001** admin puede crear supplier
- ✅ **S-002** operator sin `can_create` NO puede crear supplier
- ✅ **P-001** admin puede crear PO
- ✅ **P-002** operator sin `can_create` NO puede crear PO
- ✅ **P-003** admin puede Recibir PO (cambiar status + invoice_url)
- ✅ **P-004** operator sin `can_edit` NO puede Recibir PO
- ✅ **O-001** master puede obsoletar cliente (reusa `can_delete`)
- ✅ **O-002** admin con `can_delete` puede obsoletar cliente
- ✅ **O-003** viewer SIN `can_delete` NO puede obsoletar cliente
- ✅ **O-004** master puede restaurar cliente (reusa `can_edit`)
- ✅ **O-005** admin con `can_edit` puede restaurar cliente
- ✅ **O-006** viewer SIN `can_edit` NO puede restaurar cliente
- ✅ **O-007** admin puede obsoletar supplier
- ✅ **O-008** admin puede restaurar supplier
- ✅ **O-009** admin puede obsoletar PO (soft-delete via `is_active=false`)
- ✅ **O-010** viewer SIN `can_delete` NO puede obsoletar PO
- ✅ **O-011** admin puede restaurar PO
- ✅ **O-012** viewer SIN `can_edit` NO puede restaurar PO
- ✅ **O-013** Registro obsoletado sigue en la BD (no se borra físicamente) — preserva audit trail
- ✅ **AR-001..AR-003** Master/admin pueden crear partidas AR; viewer (solo view) NO
- ✅ **AR-004..AR-006** Master/admin pueden obsoletar; viewer NO
- ✅ **AR-007** Master puede restaurar partida
- ✅ **AR-008..AR-009** Master puede generar link público; viewer NO
- ✅ **AR-010** Master puede revocar link
- ✅ **AR-011** Master puede registrar pago + allocations
- ✅ **AR-012** Trigger recalcula paid_amount + status al insertar allocation
- ✅ **AR-013** `balance` es GENERATED correctamente

**Output esperado:** `📊 Resumen: 37 pasaron, 0 fallaron (de 37 total)`

### Resumen consolidado

```
🧪 Tests automatizados: 86 / 86 pasan ✅
```

---

## 🖐️ Tests manuales (hazlos tú en el browser)

Para estos tests **necesitas**:

1. **3 empleados de prueba** con permisos distintos (los creo con SQL abajo)
2. El servidor de Next.js corriendo (`npm run dev`)
3. Un browser

### 1. Crear empleados de prueba (en Supabase SQL Editor)

Abre el SQL Editor de Supabase y corre este script. Te crea 3 empleados con permisos específicos para probar los flujos.

```sql
-- 1. Limpiar empleados de prueba anteriores
DELETE FROM employee_permissions WHERE employee_id IN
  (SELECT id FROM employees WHERE username LIKE 'test_%');
DELETE FROM employees WHERE username LIKE 'test_%';

-- 2. Operador: solo requisiciones (create + edit + view, sin purchase, sin upload)
INSERT INTO employees (full_name, username, password_hash, role, position, is_active)
VALUES ('Test Operador Requis', 'test_op_requis', 'placeholder', 'operator', 'Operador', true);

INSERT INTO employee_permissions
  (employee_id, module_code, sub_code, can_view, can_create, can_edit, can_delete, can_request_supplies, can_purchase)
SELECT id, 'requisitions', NULL, true, true, true, false, true, false FROM employees WHERE username = 'test_op_requis';

-- 3. Operador: solo requisiciones con edit (regression test fix #1)
INSERT INTO employees (full_name, username, password_hash, role, position, is_active)
VALUES ('Test Op Solo Create', 'test_op_create', 'placeholder', 'operator', 'Operador', true);

INSERT INTO employee_permissions
  (employee_id, module_code, sub_code, can_view, can_create, can_edit, can_delete, can_request_supplies, can_purchase)
SELECT id, 'requisitions', NULL, true, true, false, false, false, false FROM employees WHERE username = 'test_op_create';

-- 4. Comprador: solo purchase (puede Recibir)
INSERT INTO employees (full_name, username, password_hash, role, position, is_active)
VALUES ('Test Comprador', 'test_buyer', 'placeholder', 'operator', 'Comprador', true);

INSERT INTO employee_permissions
  (employee_id, module_code, sub_code, can_view, can_create, can_edit, can_delete, can_purchase)
SELECT id, 'requisitions', NULL, true, false, false, false, true FROM employees WHERE username = 'test_buyer';

INSERT INTO employee_permissions
  (employee_id, module_code, sub_code, can_view, can_create, can_edit, can_delete)
SELECT id, 'purchases', NULL, true, true, true, false FROM employees WHERE username = 'test_buyer';
```

**Importante:** estos empleados tienen `password_hash = 'placeholder'` así que no pueden hacer login real. Para probar:

- **Opción A (rápida):** Tienes que actualizar el hash con uno real. Usa este script para generar el hash de `'test123'`:

```sql
-- En Node.js (o en una página de la app que ya esté logueada):
-- import { hashPassword } from '@/lib/password';
-- console.log(hashPassword('test123'));
-- Luego pega el hash aquí.
```

- **Opción B (más fácil):** Edita el password directamente en el form de empleados desde la app una vez que estés logueado como master/admin.

### 2. Arranca el servidor

```powershell
Set-Location "C:\smaa app\smaa_app"
npm run dev
```

Abre `http://localhost:3000`.

### 3. Tests por escenario

#### Escenario 1: Fix #1 — Upload de cotizaciones con `can_create`

**Objetivo:** verificar que un usuario con solo `can_create` (sin `can_request_supplies`) puede subir cotizaciones.

1. Login como `test_op_create`
2. Click "Requisiciones" → "Nueva requisición"
3. **Esperado:** entra al form (no te saca a `/?denied=1`)
4. Llena los campos, agrega 1 artículo
5. Click "Adjuntar cotización" → selecciona cualquier PDF o imagen
6. **Esperado:** sube OK, aparece en la lista de cotizaciones adjuntas
7. Click "Crear requisición"
8. **Esperado:** la requisición se crea

**Si falla:** te saca a `/?denied=1` al intentar entrar a /new o al subir el archivo → regression del fix #1.

#### Escenario 2: Fix #2 — Auto-crear PO al cerrar requisición

**Objetivo:** verificar que al marcar como comprada se crea un PO en Draft automáticamente.

1. Login como `test_op_requis` (puede crear requisiciones con `request_supplies`)
2. Crea una requisición SIN proveedor sugerido
3. Logout, login como `test_buyer` (puede purchase + purchases:edit)
4. Ve a /requisitions → click en la requisición que creó `test_op_requis`
5. Click "Marcar como comprada"
6. Sube una factura (PDF o imagen) — campo obligatorio
7. Opcional: agrega una foto y notas
8. Click "Confirmar compra"
9. **Esperado:** la requisición cambia a status "Comprada", y aparece un mensaje verde:
   - "Se creó la orden de compra PO-XXXXX en estado Draft"
   - Como NO había proveedor, debe salir el aviso ámbar:
     "⚠️ No se pudo asignar proveedor automáticamente..."
10. Click "Ir a Compras"
11. **Esperado:** ves la PO nueva en estado "Draft", con $0.00 totales
12. Click "Editar" en la PO
13. **Esperado:** puedes asignar proveedor, agregar líneas con precios
14. Guarda
15. **Esperado:** la PO ahora tiene totales correctos

**Si falla:** la requisición cambia a "Comprada" pero NO se crea la PO → fix #2 roto.

#### Escenario 3: Fix #3 — Tarjeta de Proveedores en dashboard

**Objetivo:** verificar que el módulo de Proveedores aparece en el dashboard.

1. Login como master
2. Mira el dashboard
3. **Esperado:** ves una tarjeta "Proveedores" en la categoría "Comercial"
4. Click en ella
5. **Esperado:** te lleva a /suppliers y puedes ver/crear/editar proveedores

**Si falla:** no hay tarjeta de Proveedores → fix #3 roto.

#### Escenario 4: Fix #4 — Auto-extraer datos de CSF

**Objetivo:** verificar que al subir una CSF, los campos del form se llenan automáticamente.

**Setup previo:** tienes que tener una CSF real en PDF. Si no tienes una a la mano, usa cualquiera de las que genera el SAT (descárgala de https://www.sat.gob.mx).

1. Login como master
2. Ve a /suppliers
3. Click "Agregar Proveedor"
4. **Esperado:** aparece el banner rosa "Subir CSF (auto-rellenar)"
5. Click "Subir CSF" → selecciona el PDF
6. Espera unos segundos mientras extrae
7. **Esperado:**
   - Banner rosa con chips verdes: RFC ✓, Razón Social ✓, Régimen ✓, CP ✓, Dirección ✓
   - Los campos del form se llenaron automáticamente
   - Mensaje verde: "✓ Datos extraídos de la CSF: rfc, business_name, ..."
8. Verifica que los datos son correctos (RFC, razón social, etc.)
9. Si falta algo, edita manualmente
10. Click "Guardar"
11. **Esperado:** el proveedor se guarda y aparece en la lista

**Si falla:**
- Sale error rojo "No pude leer la CSF" → el PDF está protegido o el parser no soporta ese formato
- Los campos NO se llenan → el parser tiene un bug
- Sale el email `denuncias@sat.gob.mx` → el parser tiene un bug (este email es del disclaimer del SAT, no del proveedor)

#### Escenario 5: Permissions — Mutaciones con permisos insuficientes

**Objetivo:** verificar que un usuario SIN permisos NO puede crear/editar/borrar clientes ni suppliers (fix de los gaps del audit).

**Parte A — Cliente:**
1. Login como `test_op_create` (NO tiene permisos de clients)
2. Ve a /clients
3. **Esperado:** ves la lista de clientes, pero el botón "Agregar Cliente" te da error al hacer click (o no aparece)
4. Intenta agregar uno igual
5. **Esperado:** el server action tira error "No tienes permisos para crear clientes."

**Parte B — Proveedor:**
1. Con el mismo usuario, ve a /suppliers
2. Intenta agregar un proveedor
3. **Esperado:** error "No tienes permisos para crear proveedores."

**Parte C — Compras (Recibir):**
1. Login como `test_op_requis` (NO tiene permissions de purchases)
2. Ve a /purchases
3. **Esperado:** ves la lista, pero el botón "Recibir" o "Subir Foto" no funciona (error al hacer click)
4. Intenta Recibir
5. **Esperado:** error "No tienes permisos para editar compras."

**Si falla:** un usuario sin permisos puede mutar datos → los server actions NO están gateando.

### 4. Limpiar empleados de prueba

Cuando termines, limpia los empleados de prueba:

```sql
DELETE FROM employee_permissions WHERE employee_id IN
  (SELECT id FROM employees WHERE username LIKE 'test_%');
DELETE FROM employees WHERE username LIKE 'test_%';
```

---

## 📊 Resumen de los cambios

| Archivo | Líneas | Qué hace |
|---|---|---|
| `src/app/actions/clients.ts` | 130 | Server actions gateadas: createClient, updateClient, deleteClient (soft-delete), restoreClient, viewClients |
| `src/app/actions/suppliers.ts` | 120 | Idem para suppliers + soft-delete + restore (sin guard de FK porque obsoletar no borra) |
| `src/app/actions/purchases.ts` | 220 | createPO, updatePO, deletePO (soft-delete), restorePurchaseOrder, receivePO, uploadEvidence |
| `src/app/actions/employees.ts` | 130 | + obsoleteEmployeeAction + restoreEmployeeAction (ambos protegen auto-obsolete) |
| `src/app/purchases/[id]/page.client.tsx` | 470 | Refactor + supplier dropdown con obsoletos tachados |
| `src/app/purchases/page.client.tsx` | (modificado) | handleReceive/Upload + handleObsolete/handleRestore, toggle "Mostrar obsoletos" |
| `src/app/purchases/new/page.client.tsx` | (modificado) | supplier dropdown con obsoletos tachados |
| `src/app/requisitions/new/NewRequisitionClient.tsx` | (modificado) | supplier dropdown con obsoletos tachados |
| `src/app/clients/page.client.tsx` | (rewrite) | Toggle obsoletos, search, obsoletar/restore, badges, strike-through |
| `src/app/suppliers/page.client.tsx` | (modificado) | Toggle obsoletos, obsoletar/restore, badges, strike-through |
| `src/app/settings/employees/EmployeesClient.tsx` | (modificado) | Toggle obsoletos, obsoletar/restore (auto-obsolete protegido) |
| `src/lib/csfParser.ts` | 460 | Parser robusto PM+PF, régimen más reciente, email del SAT excluido |
| `src/lib/moduleCatalog.ts` | (limpieza) | Eliminado DASHBOARD_CARDS (código muerto) |
| `supabase/migrations/20260729000000_po_supplier_nullable.sql` | 20 | purchase_orders.supplier_id nullable + columna notes |
| `supabase/migrations/20260729010000_add_is_active.sql` | 30 | is_active en clients/suppliers/purchase_orders + índices parciales |
| `docs/permission-audit.md` | 270 | Audit completo con matriz módulo × acción + gaps |
| `docs/TESTING.md` | (este archivo) | Protocolo de testing automatizado + manual + sección soft-delete |
| `scripts/permission-tests.ts` | 460 | Tests de schema DB (22 casos) |
| `scripts/test-csf-parser.ts` | 270 | Tests del parser CSF (19 casos) |
| `scripts/test-server-actions.ts` | 450 | Tests de lógica de server actions (24 casos) |
| `scripts/apply-migration.ts` | 50 | Helper para aplicar la migration (acepta filename opcional) |

---

## ❓ Si algo falla

1. **Tests automatizados fallan:** casi siempre es un problema de schema (migración no aplicada). Corre:
   ```powershell
   npx tsx scripts/apply-migration.ts
   ```
   Si persiste, pásame el output completo del test.

2. **Tests manuales fallan:** toma screenshot, anota:
   - Qué usuario estabas usando
   - Qué permisos tiene asignados
   - En qué paso se atascó
   - El mensaje de error exacto
   - La URL en el browser

3. **No puedes hacer login con un empleado de prueba:** asegúrate de haber actualizado `password_hash` con un hash real (no `'placeholder'`).

4. **CSF no extrae datos:** el parser está calibrado contra la CSF MATE8602263P8 (formato moderno del SAT). Si tienes una CSF de hace muchos años, el formato puede ser diferente. Compárteme el PDF y ajusto el parser.

---

## 🆘 Comandos de un vistazo

```powershell
# Setup (una vez)
New-Item -ItemType Directory -Force -Path "C:\tmp-pg-runner"
Set-Location "C:\tmp-pg-runner"
npm init -y
npm install pg @types/pg server-only

# Cada vez que quieras correr tests
$env:DB_URL = "postgresql://postgres:para1usodewibn2@db.mvjrqgyrjoawdhpalbix.supabase.co:5432/postgres"
$env:NODE_PATH = "C:\tmp-pg-runner\node_modules"
Set-Location "C:\smaa app\smaa_app"

# Test 1: CSF parser
npx tsx scripts/test-csf-parser.ts

# Test 2: DB schema
npx tsx scripts/permission-tests.ts

# Test 3: Server actions
npx tsx scripts/test-server-actions.ts

# Re-aplicar la migration si es necesario
npx tsx scripts/apply-migration.ts

# Limpiar datos de prueba huérfanos
npx tsx scripts/cleanup-test-data.ts
```

Si te truena cualquier test, mándame el output y lo arreglo. **No deployes a producción sin haber pasado los 86 tests automatizados + los 5 escenarios manuales.**

---

## 💰 Módulo Cuentas por Cobrar (`/finance/receivable`)

> Nuevo módulo completo. Permite asignar facturas a clientes (manual o vinculadas a CFDIs ya emitidos), registrar pagos parciales, generar estados de cuenta en PDF, y mandar links públicos para que el cliente vea su cuenta y mande promesas de pago.

### Arquitectura

- **Esquema BD (6 tablas nuevas)**:
  - `ar_invoices` — partidas/facturas con gross, vat (16% automático), net, paid, balance (GENERATED)
  - `ar_payments` — pagos recibidos
  - `ar_payment_allocations` — many-to-many pago↔factura (un pago cubre varias)
  - `ar_share_links` — links públicos con token hasheado (SHA-256, nunca el token crudo)
  - `ar_payment_promises` — promesas de pago del cliente
  - `ar_payment_promise_items` —分配的facturas de la promesa
- **Trigger `ar_recalc_invoice`**: al insertar/actualizar/borrar una allocation, recalcula paid_amount + status (pending/partial/paid) automáticamente.
- **Permisos**: sub-módulo `finance:receivable` con `view`/`create`/`edit`/`delete`. Master siempre entra.
- **Ruta pública `/ar/[token]`**: SIN login, sin middleware. El cliente ve sus facturas, selecciona, manda promesa, descarga PDF. Se valida con SHA-256 del token.
- **IVA siempre 16%** (computado server-side, no se confía en el cliente).

### Flujos

1. **Dashboard `/finance/receivable`** — Top 10 deudores + Top 10 facturas más vencidas + KPIs (total por cobrar, # clientes con deuda, # vencidas, total facturado).
2. **Detalle `/finance/receivable/[clientId]`** — Tabla de partidas con totales (bruto / IVA 16% / total / pagado / saldo) en sticky header. Acciones: nueva partida (manual o vinculada a CFDI existente), registrar pago (con分配的por factura), generar link, generar PDF, obsoletar.
3. **Pagos** — Al registrar un pago,分配的monto a una o varias facturas. El trigger actualiza balances y status automáticamente.
4. **Link público** — Botón con duración configurable (default 30 días). Se genera token random 32 bytes, se guarda SHA-256 en BD, se copia la URL completa al portapapeles. La URL tipo `https://smaa-app.vercel.app/ar/<43-chars>`.
5. **Vista del cliente** — Ve sus facturas pendientes con checkbox, totales en vivo (subtotal / IVA 16% / total) en sticky header, descarga PDF desde el link, llena fecha tentativa + notas, hace clic en "Enviar promesa" y ve confirmación.
6. **Cumplir promesa** — Cuando llega el pago, el equipo marca la promesa como `fulfilled` desde el detalle del cliente.

### Cómo probar el flujo

1. Login como master/admin
2. Ve a `/finance/receivable`
3. Click en "Cuentas por Cobrar" (o entra directo a `/finance/receivable`)
4. Click en un cliente → entra al detalle
5. Click "Nueva partida" → llena concepto + bruto → el sistema calcula IVA y total → guarda
6. Click "Vincular CFDI emitido" si quieres traer uno de los CFDIs ya cargados en `issued_invoices`
7. Click "Registrar pago" → llena monto + método +分配的por factura → guarda
8. El total, pagado y saldo del header se actualizan en vivo
9. Click "Generar link cliente" → 30 días default → se copia la URL al portapapeles
10. Comparte el link por WhatsApp/email (o pégalo en un browser en incognito)
11. En la vista del cliente, selecciona algunas facturas, ve los totales en vivo, llena fecha tentativa + notas, click "Enviar promesa"
12. Vuelve a la vista de SMAA → el detalle del cliente muestra la promesa pendiente
13. Cuando recibas el pago, registra el pago (paso 7) y luego marca la promesa como "Cumplida"

### Seguridad del link

- El token raw (32 bytes random, base64url) NUNCA se guarda en BD
- Solo se guarda su SHA-256 hex (64 chars)
- Si alguien dumpea la BD, no puede generar links
- Cada link tiene expiración configurable
- Se puede revocar manualmente
- El link solo expone: nombre/RFC/dirección del cliente, sus facturas pendientes, sus pagos históricos. NO expone notas internas, costos, ni otros clientes.
- El middleware ignora `/ar/*` (no requiere sesión) pero la server action `resolveShareLinkAction` valida token + status + expiración

---

## 🔄 Soft-delete (obsoletar / restaurar) — flujo completo

> Implementado el 2026-07-29 para clientes, proveedores, empleados y POs. Reemplaza el hard-delete anterior. Preserva audit trail (ventas, cotizaciones, facturas históricas, etc).

### Convención de permisos

- **Obsoletar** usa `can_delete` (no se introduce un permiso nuevo)
- **Restaurar** usa `can_edit`
- El toggle "Mostrar obsoletos" en cada lista filtra los registros con `is_active = false`

### Cómo probar el flujo

1. Login como master o admin
2. Ve a `/clients` (o `/suppliers`, `/settings/employees`, `/purchases`)
3. Click en el botón ámbar `<Archive/>` (icono de archivo) en una fila → confirmas → el registro se marca como obsoleto (no se borra)
4. La fila se atenúa (color gris + línea tachada en el nombre) y aparece el badge "Obsoleto" o "prov. obsoleto"
5. Marca el checkbox "Mostrar obsoletos" en el header/filtros para ver los registros obsoletos
6. Para restaurar: click en el botón verde `<ArchiveRestore/>` → confirmas → vuelve a la lista activa
7. **Empleados:** el botón obsoletar aparece deshabilitado para tu propio usuario (no te puedes obsoletar a ti mismo)

### Dropdowns siguen mostrando obsoletos (con tachado)

En `/purchases/new`, `/purchases/[id]`, `/requisitions/new`, los selectores de proveedor muestran los obsoletos con:
- Texto gris + tachado
- Sufijo "— Obsoleto" al final
- Siguen siendo seleccionables (para mantener referencias históricas en POs/requisiciones)

### Auditoría

- `is_active = false` significa obsoleto (no vigente)
- `is_active = true` (default) significa activo
- Los registros NUNCA se borran físicamente con este flujo → siempre se puede consultar el histórico
- Índices parciales `idx_*_is_active` en cada tabla optimizan las queries que filtran por activos
