# Audit de Permisos — SMAA ERP

> Generado como parte del fix #5 (rutina de testing de permisos). Última revisión: 2026-07-29.

## Resumen ejecutivo

El sistema usa **3 capas de defensa** para los permisos:

1. **Middleware** (`src/middleware.ts`) — bloquea URLs no autorizadas antes de cargar la página. Usa el `accessList` compacto del JWT.
2. **Server Components / Pages** — usan `requirePermission({ moduleCode, action })` o `can(...)` para gatear el render.
3. **Server Actions / API Routes** — usan `requireApiPermission(...)` o `can(...)` para gatear mutaciones.

El catálogo único de módulos está en `src/lib/moduleCatalog.ts` (`MODULE_CATALOG`). El JWT guarda un `accessList` (lista compacta de pares `module:sub`) que el middleware consulta sin ir a la BD.

**Hallazgo crítico**: muchas páginas y mutaciones NO chequean permisos finos (create/edit/delete) en server-side; confían en la RLS "Allow all" de Supabase, que es permisiva por diseño. Eso significa que un usuario con permiso `view` puede **modificar** datos vía la UI, porque la página no chequea `can(role, perms, 'module', 'edit')` antes de hacer `supabase.from('x').insert(...)`.

**Recomendación**: por cada mutación directa en una página cliente (`supabase.from('x').insert/update/delete`), agregar un check de permiso en server action o API route.

---

## Matriz módulo × acción × estado

Leyenda: ✅ checado, ⚠️ parcial / riesgo, ❌ falta

### Módulo: `dashboard`
| URL / acción | Server check | Estado |
|---|---|---|
| `/dashboard` | `requirePermission({ dashboard, view })` | ✅ |
| Mutaciones | (no hay mutaciones) | n/a |

### Módulo: `manufacturing` (con sub-módulos: maquinado / soldadura / automatizacion)
| URL / acción | Server check | Estado |
|---|---|---|
| `/manufacturing` | `canViewModule(...)` (considera subs) | ✅ |
| `/manufacturing/new` | `canCreateAnywhereInModule(...)` | ✅ (fix de hoy) |
| `/manufacturing/[code]` | `can(..., manufacturing, 'view', code)` por sub | ✅ |
| `/manufacturing/[code]/[id]` | `can(..., manufacturing, 'view', code)` por sub | ✅ |
| `start/pause/complete` OT | ¿chequeado en server? | ⚠️ revisar `manufacturing/[code]/[id]/page.tsx` (WorkOrderDetail) |
| Botón "Nueva OT" | `canCreateOT = canCreateAnywhereInModule(...)` | ✅ |

### Módulo: `quality`
| URL / acción | Server check | Estado |
|---|---|---|
| `/quality` | `requirePermission({ quality, view })` | ✅ |
| Mutaciones QC (release/reject) | ¿chequeadas? | ⚠️ el catálogo solo define `view, edit`; el UI usa `edit` para liberar/rechazar. Verificar que el server-side check use `edit`. |

### Módulo: `requisitions`
| URL / acción | Server check | Estado |
|---|---|---|
| `/requisitions` | `can(..., view)` | ✅ |
| `/requisitions/[id]` | `can(..., view)` | ✅ |
| `/requisitions/new` | `can(..., create) ‖ can(..., request_supplies)` | ✅ (fix de hoy) |
| `createRequisitionAction` | `can(..., create) ‖ can(..., request_supplies)` | ✅ (fix de hoy) |
| `cancelRequisitionAction` | owner ‖ `can(..., purchase)` | ✅ |
| `completePurchaseAction` | `can(..., purchase)` | ✅ |
| `uploadRequisitionFileAction` | `can(..., create) ‖ request_supplies ‖ edit ‖ purchase` | ✅ (fix de hoy) |
| `canViewAll` (ver requisiciones de todos) | `can(..., view)` | ✅ (fix anterior) |
| `canCreate` (botón "Nueva") | `create ‖ request_supplies` | ✅ (fix de hoy) |

### Módulo: `sales`
| URL / acción | Server check | Estado |
|---|---|---|
| `/sales` | ¿chequeado? | ⚠️ no encontré gate en `sales/page.tsx` (revisar) |
| `/sales/new` | ¿chequeado? | ⚠️ |
| `/sales/quick` | ¿chequeado? | ⚠️ |
| Mutaciones (cotizaciones) | ¿chequeadas? | ❌ — alto riesgo |

### Módulo: `purchases`
| URL / acción | Server check | Estado |
|---|---|---|
| `/purchases` | `requirePermission({ purchases, view })` | ✅ |
| `/purchases/new` | `requirePermission({ purchases, create })` | ✅ |
| `/purchases/[id]` (nueva edit page) | `view` (entry), `edit/delete` en acciones | ✅ (fix de hoy) |
| `/purchases/inbox` | ¿chequeado? | ⚠️ (revisar) |
| Mutaciones de la lista (`handleReceive`, `handleUploadPurchaseEvidence`) | ¿chequeadas? | ❌ — riesgo, cualquier user con view puede mutar |
| API `/api/invoice-inbox/approve` | `requireApiPermission({ purchases, edit })` | ✅ |
| API `/api/invoice-inbox/discard` | `requireApiPermission({ purchases, edit })` | ✅ |

### Módulo: `clients`
| URL / acción | Server check | Estado |
|---|---|---|
| `/clients` | `requirePermission({ clients, view })` | ✅ |
| Mutaciones (insert/update/delete) | ❌ — el cliente hace `supabase.from('clients').insert(...)` sin chequeo de create/edit/delete | ❌ ALTO RIESGO |

### Módulo: `suppliers`
| URL / acción | Server check | Estado |
|---|---|---|
| `/suppliers` | `requirePermission({ suppliers, view })` | ✅ |
| Tarjeta en dashboard | Agregada en fix de hoy (`ALL_MODULES` en `src/app/page.tsx`) | ✅ (fix de hoy) |
| Mutaciones (insert/update/delete) | ❌ — igual que clients, sin chequeo de create/edit/delete | ❌ ALTO RIESGO |
| Auto-extracción de CSF | UI agregada en fix de hoy | ✅ (fix de hoy, falta calibrar con PDF real) |

### Módulo: `deliveries`
| URL / acción | Server check | Estado |
|---|---|---|
| `/deliveries` | `requirePermission({ deliveries, view })` | ✅ |
| `/deliveries/new` | `requirePermission({ deliveries, create })` | ✅ |
| Mutaciones | ¿chequeadas? | ⚠️ |

### Módulo: `finance`
| URL / acción | Server check | Estado |
|---|---|---|
| `/finance` y sub-páginas | `requirePermission({ finance, view })` | ✅ |
| Mutaciones (payroll, checador, IVA, etc.) | ¿chequeadas? | ⚠️ requiere revisión página por página |

### Módulo: `documents` / `changes`
| URL / acción | Server check | Estado |
|---|---|---|
| `/documents` | `requirePermission({ documents, view })` | ✅ |
| `/documents/new` | ¿chequeado? | ⚠️ |
| `/changes` | `requirePermission({ documents, view })` | ✅ (reusa documents) |
| `/changes/settings` | `requirePermission({ documents, edit })` | ✅ |
| Mutaciones (cambio de status, firmas) | ¿chequeadas? | ⚠️ |

### Módulo: `settings` / `employees`
| URL / acción | Server check | Estado |
|---|---|---|
| `/settings/employees` | ¿chequeado en página? | ⚠️ (revisar) |
| `createEmployeeAction` | `can(..., employees, edit)` | ✅ |
| `updateEmployeeAction` | `can(..., employees, edit)` | ✅ |
| `deleteEmployeeAction` | `can(..., employees, edit)` | ✅ |
| `uploadEmployeePhotoAction` | `can(..., employees, edit)` | ✅ |
| `viewEmployeesAction` | `can(..., employees, view)` | ✅ |
| Solo master puede asignar rol master | chequeado en `createEmployeeAction` y `updateEmployeeAction` | ✅ |

### Módulo: `issued_invoices`
| URL / acción | Server check | Estado |
|---|---|---|
| `/issued-invoices` | `requirePermission({ sales, view })` | ⚠️ reusa módulo `sales` aunque conceptualmente es separado. Considerar agregar módulo propio o documentar la decisión. |

---

## Bugs / gaps encontrados

1. **🔴 ALTO: `clients` y `suppliers` permiten mutación sin chequear `create`/`edit`/`delete`** ✅ **RESUELTO**
   - **Fix aplicado:** `src/app/actions/clients.ts` y `src/app/actions/suppliers.ts` con `createClientAction`, `updateClientAction`, `deleteClientAction`, `viewClientAction` (idem para suppliers). Cada una llama a `requireCan('create' | 'edit' | 'delete')` que tira error si el user no tiene el flag.
   - **Verificado:** `scripts/test-server-actions.ts` C-001..C-005, S-001..S-002 (7 casos pasan).

2. **🟡 MEDIO: `purchases/page.client.tsx` (Recibir, evidencia) no chequea permiso** ✅ **RESUELTO**
   - **Fix aplicado:** `src/app/actions/purchases.ts` con `receivePurchaseOrderAction` y `uploadPurchaseEvidenceAction`. `handleReceive` y `handleUploadPurchaseEvidence` ahora las llaman.
   - **Verificado:** `scripts/test-server-actions.ts` P-001..P-004 (4 casos pasan).

3. **🟡 MEDIO: `sales/page.tsx` no tiene `requirePermission`** ✅ **YA EXISTÍA (audit incorrecto)**
   - Mi audit original decía que faltaba, pero al re-verificar con grep todas las páginas de sales ya tienen `requirePermission` desde antes.
   - **Estado real:** gate presente. No requiere cambio.

4. **🟢 BAJO: `issued_invoices` reusa `sales:view`**
   - Decisión: se queda como está. La Razón: las facturas emitidas viven en el flujo de ventas (cotización → venta → factura) y conceptualmente comparten permiso. Refactorizar esto sería trabajo sin valor.
   - **Estado:** documentado, no requiere cambio.

5. **🟢 BAJO: `DASHBOARD_CARDS` en `moduleCatalog.ts` es código muerto** ✅ **RESUELTO**
   - **Fix aplicado:** eliminado. Dejado un comment apuntando a `ALL_MODULES` en `src/app/page.tsx` como la fuente de verdad.

6. **🟢 BAJO: `lib/employees.ts` línea 37 — `listSuppliersForSelect` no chequea sesión** ⚠️ **PENDIENTE (bajo)**
   - **Estado:** sigue pendiente. Bajo riesgo (solo lectura, RLS allow all).

---

## Plan de remediación priorizado

1. **Esta semana** (alto riesgo):
   - Crear `src/app/actions/clients.ts` con `createClientAction`, `updateClientAction`, `deleteClientAction` que chequean `can(role, perms, 'clients', 'edit')`.
   - Crear `src/app/actions/suppliers.ts` con el mismo patrón.
   - Mover mutaciones de `purchases/page.client.tsx` a server actions con su `requirePermission`.

2. **Próxima semana** (medio riesgo):
   - Agregar `requirePermission` en `sales/page.tsx` y sub-páginas.
   - Auditar mutaciones de `deliveries`, `quality`, `finance`, `documents`.

3. **Backlog** (limpieza):
   - Eliminar o consolidar `DASHBOARD_CARDS`.
   - Considerar separar `issued_invoices` de `sales`.

---

## Cómo correr el test script

Una vez que se tengan las credenciales de Postgres (o Supabase), ejecutar:

```bash
DB_URL=postgresql://postgres:xxx@host:5432/postgres \
  npx tsx scripts/permission-tests.ts
```

Requisitos:
- `pg` instalado (para correr local: `npm install --prefix /tmp/pg-runner pg @types/pg` y exportar `NODE_PATH=/tmp/pg-runner/node_modules`)
- Las migraciones SQL aplicadas (incluyendo las de este PR)

El script:
1. Crea 5 empleados de prueba con permisos distintos (master, admin, operator con can_create, operator con request_supplies, buyer).
2. Para cada caso, ejecuta la operación real (insert, update, delete, view) y compara con el resultado esperado.
3. Imprime una tabla con ✅ / ❌ por caso.
4. Limpia automáticamente los registros de prueba al final.

Ver `scripts/permission-tests.ts` para el detalle.

## Resultado de la corrida (29 jul 2026)

```
📊 Resumen: 17 pasaron, 0 fallaron (de 17 total)
```

Casos cubiertos:
- **REQ-001/002**: usuarios con `can_create` o `can_request_supplies` pueden insertar requisiciones (fix #1)
- **REQ-003**: schema de `requisition_quotations` funciona para uploads
- **PO-001**: `purchase_orders.supplier_id` ahora es nullable (fix #2)
- **PO-002/003/004/005/006**: schema completo de POs soporta todos los flujos
- **SUP-001/002**: tabla `suppliers` es leíble y permite crear con todos los campos del CSF (fix #4)
- **EMP-001/002/003**: gestión de empleados y permisos por sub-módulo funciona
- **SCHEMA-001/002/003**: migrations aplicadas, schema consistente
