# Ventas y fabricación — cambios del 18 de septiembre de 2026

## Comportamiento

- La base genera un folio independiente de la cotización para cada OT. La secuencia empieza después del mayor folio existente y admite creaciones concurrentes. OT y asignación de WPS se guardan en una transacción.
- Ventas y compras buscan por varias palabras, sin distinguir acentos, en folio, descripción, razón social y alias. Ventas también busca por vendedor y nombre de cotización. Los formularios de cotización normal y rápida permiten buscar al cliente escribiendo.
- `clients.name` y `suppliers.name` son alias/nombres comerciales opcionales. La razón social fiscal se conserva en `business_name`.
- Las cotizaciones tienen un nombre opcional (`title`). Fabricación muestra ese nombre o, para registros anteriores, la primera descripción disponible.
- El panel «Fabricación y cobro» está en el detalle de cotización y en la OT para usuarios con acceso a ventas. «Agregar extra» requiere permiso de edición de ventas; el envío a cobranza requiere permiso de creación de cuentas por cobrar.
- Un extra agrega una partida identificada como `[Extra]`, con nota opcional visible en el detalle y PDF. Actualiza subtotal, IVA de 16% y total en una transacción. Si ya existe una cuenta por cobrar vinculada, actualiza su importe, conserva los pagos y recalcula el estado/saldo. Las cuentas canceladas o inactivas se deben restaurar primero.
- «Enviar a cuentas por cobrar» exige que todas las OT no canceladas estén terminadas (`Completed`, `QC` o `QC_Released`). Usa el cliente de la cotización y sus días de crédito desde la fecha del envío. El vínculo único y el bloqueo de la cotización impiden duplicar el cargo por reintentos.
- La edición general de una cotización vinculada a fabricación se bloquea antes de guardar para evitar el reemplazo de partidas. Las adiciones se hacen mediante «Agregar extra».
- Compras ya aceptaba PDF e imágenes en recepción y adjuntos. La etiqueta de factura ahora lo explicita; la migración amplía las listas MIME restringidas del bucket `purchase_files` a formatos de foto habituales y conserva los buckets sin restricción.

## Aplicación

Aplicar primero la migración previa pendiente de nombre de proveedor y fecha de entrega, si aún no está instalada:

```sh
npx tsx scripts/apply-migration.ts 20260909191356_supplier_name_and_quotation_delivery_date.sql
npx tsx scripts/apply-migration.ts 20260918210804_sales_manufacturing_workflow.sql
```

El script existente toma `DB_URL` del entorno o `.env.local`. Después desplegar esta versión del frontend/backend. Las funciones usan `SECURITY INVOKER` y las políticas RLS existentes; no agregan `SECURITY DEFINER` ni cambian la exposición de las tablas.

## Verificación realizada

```sh
npm run test:sales-manufacturing
npx tsc --noEmit
npm run build
```

La prueba usa PostgreSQL local, crea una base aislada con nombre propio y la elimina al terminar. No usa `DB_URL` de producción. Cubre 20 OT concurrentes, folios de más de cinco dígitos, rollback por WPS inválido, extras concurrentes, conservación de partidas, bloqueo de cobranza antes de terminar, diez envíos concurrentes con una sola cuenta, días de crédito, extras después de un pago, migración repetida, tipos MIME de fotos y búsqueda con acentos.

## Verificación en SMAA

El 18 de septiembre de 2026 se aplicó la migración en el proyecto `mvjrqgyrjoawdhpalbix` mediante el editor SQL de Supabase. Los campos de la migración previa (nombre de proveedor y fecha de entrega) ya estaban presentes.

Se probó el flujo real bajo el rol `anon`, dentro de una transacción con `ROLLBACK`: alta de cliente con alias, dos OT de la misma cotización, extra, envío idempotente a cobranza, 30 días de crédito y actualización del cargo por un extra posterior. Todos los registros de prueba se revirtieron. Se actualizaron las claves públicas locales con la clave publicada vigente; las claves privadas no se modificaron.

El Security Advisor conserva dos errores preexistentes en las vistas `v_monthly_sales_iva` y `v_monthly_purchases_iva`; esta migración no modifica esas vistas ni agrega funciones `SECURITY DEFINER`.
