# 🧪 Protocolo de Testing — SMAA ERP

> Generado el 2026-07-29 después de los fixes de permisos, auto-PO, CSF parser y server actions gateadas.

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

## ✅ Tests automatizados (47/47 pasan)

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

### Test 2: Schema de DB (17/17)

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

**Output esperado:** `📊 Resumen: 17 pasaron, 0 fallaron (de 17 total)`

### Test 3: Lógica de server actions (11/11)

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

**Output esperado:** `📊 Resumen: 11 pasaron, 0 fallaron (de 11 total)`

### Resumen consolidado

```
🧪 Tests automatizados: 47 / 47 pasan ✅
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
| `src/app/actions/clients.ts` | 120 | Server actions gateadas: createClient, updateClient, deleteClient, viewClients |
| `src/app/actions/suppliers.ts` | 115 | Idem para suppliers + guard que rechaza delete si hay POs referenciando |
| `src/app/actions/purchases.ts` | 200 | createPO, updatePO, deletePO, receivePO, uploadEvidence |
| `src/app/purchases/[id]/page.client.tsx` | 470 | Refactor para usar updatePurchaseOrderAction y deletePurchaseOrderAction |
| `src/app/purchases/page.client.tsx` | (modificado) | handleReceive y handleUploadEvidence usan server actions |
| `src/lib/csfParser.ts` | 460 | Parser robusto PM+PF, régimen más reciente, email del SAT excluido |
| `src/lib/moduleCatalog.ts` | (limpieza) | Eliminado DASHBOARD_CARDS (código muerto) |
| `supabase/migrations/20260729000000_po_supplier_nullable.sql` | 20 | purchase_orders.supplier_id nullable + columna notes |
| `docs/permission-audit.md` | 270 | Audit completo con matriz módulo × acción + gaps |
| `docs/TESTING.md` | (este archivo) | Protocolo de testing automatizado + manual |
| `scripts/permission-tests.ts` | 350 | Tests de schema DB (17 casos) |
| `scripts/test-csf-parser.ts` | 270 | Tests del parser CSF (19 casos) |
| `scripts/test-server-actions.ts` | 320 | Tests de lógica de server actions (11 casos) |
| `scripts/apply-migration.ts` | 50 | Helper para aplicar la migration |

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

Si te truena cualquier test, mándame el output y lo arreglo. **No deployes a producción sin haber pasado los 47 tests automatizados + los 5 escenarios manuales.**
