# Auditoría QA — octubre 2026

Revisión de la rama del tema claro/oscuro y auditoría funcional de la app
(requisiciones, permisos, compras, subida de archivos y el resto de módulos)
con pruebas de navegador y datos de ejemplo.

## Cómo se probó

- **Entorno**: réplica local, no producción. Postgres 16 con **todas** las
  migraciones del repo, PostgREST y un emulador de Supabase Storage que aplica
  las mismas validaciones que el real (bucket, tamaño, tipos MIME permitidos,
  nombres válidos y RLS de `storage.objects`). Delante de Next, un proxy que
  reproduce el límite de **4.5 MB** por request de las funciones de Vercel.
  Detalles y scripts en `qa/README.md`.
- **Usuarios de prueba** (creados desde Configuración → Empleados): master,
  admin/comprador, operador con sólo "Solicitar insumos", almacenista,
  finanzas, sólo cuentas por cobrar, inspector de calidad, controlador de
  documentos y alta dirección.
- **Cobertura**: alta de empleados y permisos; proveedores y clientes (CSF);
  requisiciones por rol y cierre de compra; compras (única, multicompra,
  recepción, edición, adjuntos, obsoletar/restaurar, PDF); cotizaciones;
  OT de soldadura completa (operador, pausas, fotos, firma) → calidad →
  entrega; expediente del empleado; declaraciones; facturas emitidas; logo;
  y un barrido de ~45 pantallas con cada usuario.
- **Producción**: no se tocó. El acceso directo a la base de producción quedó
  bloqueado por la política de permisos de la sesión de trabajo.

## Rama del tema (`feat/tema-claro-oscuro`)

Typecheck, lint (sin errores nuevos) y build de producción correctos. Se
corrigieron dos detalles antes de fusionar a `main`:

- El menú lateral (z-60) quedaba **encima** de los 12 modales y de los visores
  PDF/3D a pantalla completa (z-50): el fondo del modal no lo cubría y podía
  tapar parte de modales anchos en pantallas de 1024–1300 px.
- En tema claro los botones con degradado perdían el texto blanco.

## Hallazgos

Estado: ✅ corregido en `claude/jolly-darwin-41z8tm` · ⚠️ requiere acción en
producción · 📌 pendiente (recomendación).

### Subida de archivos

| # | Hallazgo | Dónde | Estado |
|---|---|---|---|
| 1 | Archivos de más de ~3.3 MB fallan con `FUNCTION_PAYLOAD_TOO_LARGE`: viajaban en base64 por *server actions* y Vercel topa el cuerpo en 4.5 MB (el `bodySizeLimit: 20mb` de `next.config.ts` no aplica en Vercel). Una foto de celular ya lo rebasa. | Compras → Recibir y adjuntos de la PO; Expediente del empleado; foto del empleado | ✅ ahora suben directo a Storage con URL firmada; el servidor sólo valida y registra rutas |
| 2 | Nombres de archivo con acentos, ñ, `º`, `″`, `#`… → `Invalid key`. El `#` además truncaba la ruta (se interpreta como ancla). | Planos de OT, fotos de pieza terminada, fotos de entrega, acuses del SAT | ✅ helper `safeStorageName` |
| 3 | RFC con Ñ (válido en el SAT) rompe la subida de la CSF. | Proveedores y Clientes | ✅ |
| 4 | El bucket `purchase_files` tiene en producción una lista blanca sólo PDF + imágenes: rechaza los XML de CFDI y los Excel/Word. Facturas emitidas guardaba la factura **sin XML y sin avisar**; el buzón de Gmail falla con los XML. | Facturas emitidas, buzón de facturas, adjuntos de PO | ✅ aviso en UI · ⚠️ aplicar migración `20261001120000_purchase_files_xml_office.sql` |
| 5 | La UI de planos prometía 200 MB y el bucket admite 100 MB. | Fabricación | ✅ |
| 6 | Al recibir una PO sin fotos nuevas se borraba la foto de evidencia anterior. | Compras | ✅ |

### Permisos

| # | Hallazgo | Estado |
|---|---|---|
| 7 | Un operador con sólo "Solicitar insumos" podía crear una requisición, pero al guardarla recibía **acceso denegado**; tampoco podía ver la lista ni sus requisiciones, y la tarjeta del Inicio no aparecía (el menú sí). | ✅ entra a "Mis requisiciones" y al detalle de las suyas |
| 8 | El middleware validaba `/documents/requests` contra el módulo *Documentos* y `/settings/employees` contra *Configuración*: el **Controlador de Documentos** no podía abrir las requisiciones de documentos. | ✅ se usa el prefijo de ruta más largo |
| 9 | Finanzas: el editor de permisos no permitía dar el permiso general, así que **sólo un master** podía entrar a nómina, checador, IVA, declaraciones y expediente. Un usuario de Cuentas por Cobrar veía una tarjeta que lo mandaba a "acceso denegado". | ✅ fila "General" en el editor; el enlace de CxC va directo a `/finance/receivable` |
| 10 | Calidad: el **operador podía liberar su propia OT** (la firma de liberación no pedía permiso de Calidad) y un inspector con sólo permiso de Calidad no podía abrir la OT desde su cola. | ✅ |
| 11 | Un admin podía cambiar la contraseña o desactivar a un master. | ✅ |
| 12 | Botones de Compras (Recibir, Obsoletar, Restaurar) visibles sin permiso; mensajes de error en inglés ("para edit compras"). | ✅ |
| 13 | Los cambios de permisos no aplican hasta que el usuario vuelve a iniciar sesión (el menú y el middleware leen la cookie). | ✅ aviso en el editor · 📌 refrescar la sesión al guardar |

### Flujos

| # | Hallazgo | Estado |
|---|---|---|
| 14 | Requisición → PO: si el operador escribía el nombre comercial del proveedor, la PO quedaba sin proveedor (sólo se buscaba por razón social). | ✅ busca por nombre, razón social o RFC |
| 15 | Reintentar "Marcar como comprada" después de un error podía duplicar la PO. | ✅ reutiliza la PO de la requisición |
| 16 | Las cotizaciones de una requisición se mostraban con el nombre interno (`1790…-uuid-Cotizaci_n.pdf`). | ✅ se guarda el nombre original |
| 17 | "Nueva orden de compra" abría en multicompra con dos proveedores vacíos y mensajes en inglés. | ✅ |
| 18 | El detalle de OT ignora los errores de la base al pausar, reanudar, terminar o liberar (fallas silenciosas). | 📌 |
| 19 | El folio de entrega se deriva sólo de los dígitos del folio de la OT; OTs antiguas de distintos módulos con el mismo número chocarían. | 📌 |

### Esquema y seguridad

| # | Hallazgo | Estado |
|---|---|---|
| 20 | Las migraciones no se pueden aplicar en una base limpia: falta el renombrado manual `employees → payroll_employees` (5 migraciones fallan). | ✅ migración idempotente `20260722145900` (en producción no hace nada) |
| 21 | `docs/TESTING.md` tenía la contraseña de la base de producción. | ✅ redactada · ⚠️ **rotar la contraseña** (sigue en el historial de git) |
| 22 | Sin `SESSION_SECRET` se usaba un secreto por defecto público: cualquiera podría firmar una sesión de master. | ✅ en producción falla cerrado |
| 23 | El login aceptaba `?redirect=` a sitios externos. | ✅ |
| 24 | **RLS "Allow all" en todas las tablas** con la llave anon (pública en el navegador): cualquiera con esa llave puede leer y escribir todo, incluidos `employees.password_hash` y `employee_permissions`. Además muchas pantallas escriben directo a la base desde el navegador (ventas, compras nuevas, fabricación, entregas), así que los permisos se pueden saltar. | 📌 mover escrituras a server actions con la llave de servicio y cerrar RLS |
| 25 | `supabase/apply_all_migrations.sql` está desactualizado (sólo las primeras migraciones). | 📌 |

## Acciones en producción

1. Aplicar `supabase/migrations/20261001120000_purchase_files_xml_office.sql`.
2. Rotar la contraseña de la base (la de `docs/TESTING.md` y la compartida
   durante la auditoría).
3. **Antes de desplegar estas correcciones**, verificar en Vercel
   `SESSION_SECRET` (sin él, ahora nadie puede iniciar sesión en producción)
   y `SUPABASE_SECRET_KEY` (o `SUPABASE_SERVICE_ROLE_KEY`, que usan el
   expediente y la nómina).
4. Quien tenga un permiso nuevo (p. ej. Finanzas general) debe cerrar sesión y
   volver a entrar.

## Datos de ejemplo

Todos los ejemplos usan usuarios `qa_*` y RFCs/nombres `QA`. Para borrarlos de
cualquier base: `scripts/qa-cleanup.sql` (termina en `ROLLBACK` hasta revisar
los conteos).
