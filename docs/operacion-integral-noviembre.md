# Operación integral — 24 de noviembre de 2026

Rama `feat/operacion-integral`, sobre `feat/documentos-canacintra-smaa` (incluye las mejoras del 9 y 17 de noviembre).

## Qué cambia

### 1. Cierre de OT por partes, en toda la cadena

- Cada OT tiene **cantidad de piezas** (y unidad: pza, juego, m…).
- Cada etapa se cierra por partes con firma (y fotos opcionales): «Cerrar piezas» pide cuántas. Si de 4 se cierran 2, la etapa sigue abierta para las otras 2.
- Las etapas son una cadena: una etapa sólo cierra las piezas que la anterior ya cerró.
- El cierre de la **última etapa** es un **lote** que llega a Calidad. Calidad libera todo o parte del lote; lo rechazado (con motivo obligatorio) regresa a la última etapa.
- **Entregas** por cantidad: se puede hacer nota de entrega de lo liberado aunque la OT no esté completa. La primera nota de la `OT-00030` es `NE-00030`, las siguientes `NE-00030-2`, `-3`…; el PDF de una entrega parcial dice «entrega parcial: 2 de 4».
- La lista de Calidad muestra lotes (no OT) y el Inicio cuenta «Lotes en Calidad».

### 2. Ventas → Cuentas por cobrar sin OT

«Enviar a cuentas por cobrar» ya no exige OT. Al enviarla se elige el origen:

| Origen | Uso |
| --- | --- |
| Trabajo fabricado | Tiene o tendrá OT; se puede cobrar antes de terminarla. |
| Venta directa | Material que sólo se compró y se entregó. |
| Trabajo ya realizado | Se hizo antes y apenas se da de alta. |

Se captura la **fecha de venta** (puede ser pasada, no futura); el vencimiento se calcula desde esa fecha con los días de crédito del cliente. Si la cotización estaba en borrador o enviada, queda aprobada. Repetir el envío devuelve la misma cuenta.

### 3. Notificaciones

Campana en el menú (y en la barra superior en móvil) con contador, panel y página `/notifications` («Ver todas»). Cada quien recibe avisos de los módulos que puede ver, nunca de lo que hizo él mismo:

- Requisición nueva (con prioridad y fecha); al solicitante, cuando su requisición se compra o se cancela.
- OT nueva, garantía/reparación abierta, piezas que llegan a Calidad, liberaciones (a Entregas) y rechazos (a Fabricación).
- Documento nuevo, nueva revisión, aprobado/obsoleto; registros digitales finalizados; solicitudes de documento (y al solicitante cuando cambia su estado).
- Compra nueva, recibida o editada después del borrador; cotización aprobada o editada después de aprobarse; cuenta por cobrar nueva; entrega confirmada.
- Vehículos: documento vencido o por vencer (30 días) y cambio de aceite próximo/vencido.

Opcional por usuario: «Avisos de escritorio» (notificación del navegador mientras la app está abierta). La campana consulta cada minuto y al volver a la pestaña.

### 4. Garantías y reparaciones

Nuevo apartado **Fabricación → Garantías y reparaciones** (`/manufacturing/garantias`):

- **OT cerradas / entregadas**: las OT con piezas liberadas; botón «Reabrir como garantía / reparación».
- **Registro**: cada garantía o reparación con OT original, OT nueva, piezas, motivo, quién y cuándo, y su estado.

Al reabrir se crea una **OT ligada** con folio de la original + `-G1` (garantía) o `-R1` (reparación), con sus propias piezas, etapas a repetir, Calidad y entregas. La OT original no cambia y muestra sus garantías. Las garantías del flujo anterior (la misma OT reabierta) siguen visibles en el registro.

### 5. Una sola lista de fabricación

- `/manufacturing` es una lista única con búsqueda y filtros por estado, proceso y tipo. Cada fila muestra la cadena de etapas con su avance («Maquinado 2/4 → Soldadura 1/4») y piezas liberadas/entregadas.
- Al crear la OT se eligen las etapas **en orden** (cualquier combinación: sólo soldadura, maquinado + soldadura, soldadura + automatización…). Soldadura sigue exigiendo WPS.
- Los permisos siguen siendo por proceso y aplican a la etapa: el soldador inicia/pausa/cierra la etapa de soldadura. Cada quien ve las OT que pasan por algún proceso suyo; Calidad ve todas.
- **Numeración nueva**: `OT-` y número, sin prefijo de módulo, continuando después del folio más alto existente. En producción el más alto al 24 de noviembre es el 29, así que la primera nueva será `OT-00030`. Los folios anteriores (`OT-MAQ-…`, `OT-SOLD-…`, `OT-AUTO-…`) no cambian y los enlaces viejos redirigen a `/manufacturing/ot/<id>`.
- Las OT existentes se migraron: cada una con la etapa de su módulo; las que estaban terminadas, en Calidad o liberadas, con un cierre equivalente. Sus entregas conservan cantidad.

### 6. Expediente de vehículos

Módulo **Vehículos** (permiso nuevo `vehicles`): por unidad, datos (marca, modelo, año, placas, VIN, responsable, kilometraje), fotos, documentos con vigencia (seguro/póliza con aseguradora, número y cobertura; tarjeta de circulación; verificación; tenencia; factura), servicios (aceite, filtros, frenos, llantas, batería…; fecha, km, taller, costo, próximo servicio) y gastos (combustible, casetas, refacciones…).

La ficha muestra el último cambio de aceite y de cada filtro, el próximo cambio (por fecha o km, lo que llegue primero, con el intervalo del vehículo si no se capturó), vencimientos y el gasto del mes/año/total por categoría. Los archivos van a un bucket **privado** con enlaces firmados.

### 7. «Agregar línea» abajo

En cotización normal, cotización rápida, compra nueva y edición de compra el botón quedó debajo de la última línea y el cursor pasa a la descripción de la línea nueva.

### 8. Edición con permisos e historial

- **Cotizaciones**: se edita cualquier cotización (también aprobadas, en fabricación o en CxC) con el permiso «Ventas → Editar». Si ya hay cuenta por cobrar, su importe sigue a la cotización y conserva los pagos; el total no puede quedar debajo de lo cobrado ni cambiarse el cliente. Las partidas se actualizan en su lugar (orden estable) y los extras conservan su marca.
- **Compras**: «Compras → Editar»; los artículos se actualizan en su lugar.
- **OT**: «Editar» (permiso «Editar OT» del proceso) cambia título, piezas, unidad, prioridad, cliente sin cotización y etapas sin actividad. Las etapas con actividad no se pueden quitar ni reordenar.
- Cada formulario de edición pide un **motivo** (opcional) que queda en el historial.
- **Historial de cambios** en la cotización, la compra, la OT y el vehículo: quién, cuándo, valor anterior → nuevo, partidas agregadas/eliminadas y motivo.
- **Bitácora de ediciones** (`/audit`, permiso nuevo `audit`): todo junto, con filtros por registro, usuario, fechas y «sólo cambios sin usuario verificado».

Cómo se evita la trampa: el historial lo escribe la base con triggers (también si alguien usa la API directo con la llave pública). La tabla no se puede editar ni borrar con las llaves de la app. Lo que entra por las acciones del servidor lleva el empleado verificado; un cambio que no pasó por el servidor aparece marcado «sin usuario verificado». Después de la publicación, las OT, cierres, decisiones de Calidad y pausas sólo se escriben desde el servidor, y las notas de OT ya no se pueden editar ni borrar.

## Permisos a asignar (Configuración → Empleados)

| Módulo | Para qué |
| --- | --- |
| Fabricación por proceso | Ver/Crear/Editar/Eliminar(cancelar)/Iniciar/Pausar/Terminar por etapa |
| Calidad → Liberar/Rechazar | Decidir lotes |
| Entregas → Crear | Notas de entrega parciales |
| Ventas → Editar | Editar cualquier cotización |
| Cuentas por Cobrar → Crear | Enviar cotizaciones a cobro |
| Vehículos (nuevo) | Ver / Registrar / Editar / Eliminar |
| Bitácora de ediciones (nuevo) | Ver la bitácora completa |

## Base de datos y publicación

Requiere las migraciones del 9 y 17 de noviembre ya aplicadas. Respaldar antes. Luego, en orden:

```sh
npx tsx scripts/apply-migration.ts 20261124170000_edit_audit_log.sql
npx tsx scripts/apply-migration.ts 20261124171000_unified_manufacturing_partial_closures.sql
npx tsx scripts/apply-migration.ts 20261124172000_quotation_editing_direct_receivables.sql
npx tsx scripts/apply-migration.ts 20261124173000_notifications.sql
npx tsx scripts/apply-migration.ts 20261124174000_vehicles.sql
```

Después **publicar esta versión** y, ya publicada, aplicar:

```sh
npx tsx scripts/apply-migration.ts 20261124175000_manufacturing_server_only_writes.sql
```

Esa última quita a la llave pública la escritura de OT; si se aplica antes de publicar, la versión anterior deja de poder iniciar/terminar OT. Todas las migraciones se pueden repetir sin efecto. Las vistas de avance usan `security_invoker` en PostgreSQL 15+. El servidor necesita `SUPABASE_SERVICE_ROLE_KEY` (o `SUPABASE_SECRET_KEY`), como ya lo usan garantías y CxC.

## Verificación realizada

En una base local PostgreSQL 14 con todas las migraciones (sin tocar producción):

- `scripts/test-unified-manufacturing.sql`: OT de 4 piezas con dos etapas, cierres parciales, límite por etapa, firma obligatoria, liberación parcial con rechazo, entregas parciales y folios, garantía `-G1` y reparación `-R1`, edición de piezas/etapas, pausas, bitácora con autor/motivo y bloqueos para la llave pública. Termina en `ROLLBACK`.
- `scripts/test-quotation-editing.sql`: alta y edición por partida, CxC por venta directa con fecha pasada, idempotencia, fecha futura rechazada, pago conservado, total menor a lo cobrado y cambio de cliente rechazados, historial. Termina en `ROLLBACK`.
- Migración de datos anteriores: OT en cada estado (abierta, en curso, pausada, terminada, en Calidad, liberada con entrega pendiente, cancelada y reabierta por garantía en el flujo anterior) quedan con etapa, lotes y entregas coherentes, sin registros en la bitácora por la migración. Las seis migraciones se aplicaron dos veces sin error.
- Navegador, con la réplica local (`qa/seed-operacion.mjs` crea usuarios por proceso): alta de OT Maquinado → Soldadura, cierre de 2 de 4, lote a Calidad, liberar 1 y rechazar 1, nota de entrega parcial, reparación desde el apartado, edición de OT con motivo, edición de cotización aprobada, envío a CxC «trabajo ya realizado», compra nueva y editada con historial, avisos filtrados por permisos, vehículo con servicio y alertas, bitácora general y botones de edición ocultos sin permiso.
- Bucket de vehículos: carga y descarga firmadas; la llave pública no puede subir ni hay URL pública.
- `npx tsc --noEmit` y `npm run build -- --webpack`.

## Pendiente

- `qa/e2e/e2e-05-sales-mfg.mjs` y `qa/e2e/e2e-11-work-order-warranty.mjs` usan la pantalla anterior de OT; hay que actualizarlas a la lista única y a los cierres por etapa.
- El cobro sigue siendo por cotización (no por entrega parcial).
- La subida de fotos de vehículos se probó por script; el selector de archivos del navegador no se pudo automatizar.
