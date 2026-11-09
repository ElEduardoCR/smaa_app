# Mejoras operativas — noviembre de 2026

## Comportamiento

- Se puede enviar una cotización con OT activa a cuentas por cobrar antes de terminar fabricación o liberar Calidad. No cambia el estado de ninguna OT. Repetir la operación devuelve la misma cuenta y conserva pagos.
- Una OT liberada puede reabrirse por garantía con un motivo. Conserva su folio, documentos, asignaciones y el historial de la liberación anterior. Requiere otro ciclo de fabricación y Calidad. Una entrega posterior usa el sufijo `-G1`, `-G2`, etc.; las entregas previas permanecen en el historial.
- Compras, cotizaciones, extras y CxC permiten indicar si el importe capturado incluye IVA. Se almacena el precio base con precisión y se muestran bruto, IVA y total a centavos. El total capturado con IVA se conserva, incluso con fracciones de centavo al separar la base. Se mantiene la política existente que bloquea edición de una partida con pagos.
- La búsqueda de compras incluye notas generales, notas por artículo y descripciones. El contexto aparece en el listado, el detalle y el PDF.
- Las requisiciones aceptan un propósito general y uno por artículo. Cada artículo hereda el general cuando se deja vacío; un propósito específico tiene prioridad. Es obligatorio indicar al menos un destino aplicable a cada artículo nuevo. Las requisiciones anteriores siguen siendo válidas.
- El restablecimiento de contraseñas es una operación puntual. No agrega una contraseña universal ni cambia el proceso de autenticación. El script protege administradores, masters, Alta Dirección y roles futuros; sólo procesa roles operativos conocidos.

## Base de datos y publicación

Aplicar los tres archivos `20261109185938_work_order_warranty_and_early_receivables.sql`, `20261109190028_quotation_unit_price_precision.sql` y `20261109190241_requisition_purchase_purpose.sql` antes de servir la nueva interfaz.

Las acciones de garantía y cobro usan `SUPABASE_SECRET_KEY` o `SUPABASE_SERVICE_ROLE_KEY`, exclusivamente del lado servidor, después de validar la sesión y los permisos del empleado. Los RPC correspondientes no deben quedar accesibles a `anon` ni `authenticated`. Para una publicación gradual desde la versión anterior, que usa `anon` para cobro, se puede posponer únicamente la revocación de ese RPC hasta que esté activo el nuevo servidor.

El script `scripts/reset-standard-passwords.ts` verifica que el proyecto enlazado coincida con `.env.local`, hace una vista previa sin `--apply`, y aplica el cambio en una transacción si se proporciona `SMAA_RESET_PASSWORD`. Cada usuario recibe una sal distinta. No registra contraseñas ni hashes en la salida.

## Verificación

- `npx tsc --noEmit` y `npm run build -- --webpack`.
- `npx tsx scripts/test-pricing.ts`: 10,000 importes con IVA, líneas mixtas, cantidades fraccionarias y guardado/relectura.
- `npx tsx scripts/test-requisition-purchase-purpose.ts`: herencia, excepciones por partida, conservación y búsqueda sin acentos.
- `PGPORT=55432 PGUSER=postgres npx tsx scripts/test-sales-manufacturing.ts`: operaciones concurrentes sin duplicados ni alteración de pagos.
- `scripts/test-work-order-warranty.sql` y `scripts/test-pricing-migration.sql`: transacciones con `ROLLBACK` sobre una base local con todas las migraciones.
- `qa/e2e/e2e-11-work-order-warranty.mjs`: navegador local, cobro anticipado, garantía, firmas, liberación y nueva entrega. Acepta `PLAYWRIGHT_MODULE`, `CHROMIUM_PATH`, `BASE_URL`, `PGPORT` y `QA_MASTER_PASSWORD`.
- Navegador local: requisición con dos proyectos → factura adjunta → compra → precio con IVA → búsqueda por notas; vista móvil de requisiciones.
- Navegador local: CxC con $0.04 y $100.01, edición de concepto sin cambiar importes, pago parcial y saldo conservado.

Las pruebas funcionales usan registros QA exclusivamente locales. La revisión de seguridad de la base publicada encontró dos avisos previos en las vistas mensuales de IVA, fuera del alcance de estos cambios.
