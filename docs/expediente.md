# Expediente del empleado

Pestaña **Expediente** en `/finance/employees/[id]`.

## Por qué no es un simple uploader

El valor no está en guardar archivos, sino en responder "¿qué le falta a Juan
y qué está por vencer?". Por eso hay un catálogo (`employee_document_types`)
que marca qué documentos son obligatorios y cuáles vencen, y una vista
(`v_employee_document_status`) que devuelve, por empleado y tipo:
`faltante | vigente | por_vencer | vencido`.

## Privacidad

Los archivos van al bucket **privado** `employee_files`, que no tiene policies
para `anon`. Nada se guarda como URL: la tabla almacena `file_path` y el
enlace se firma al momento desde una server action que ya verificó permisos,
con vigencia de 5 minutos. Es el único módulo del proyecto que funciona así, y
es a propósito: aquí viven INE, CURP, actas y documentos médicos.

Consecuencia práctica: **el expediente no funciona sin `SUPABASE_SECRET_KEY`
(o `SUPABASE_SERVICE_ROLE_KEY`) en el entorno.**

## Reemplazo en vez de sobrescritura

Subir un documento de un tipo que no admite varios (INE, CURP, comprobante de
domicilio) marca el anterior como `superseded_by` en lugar de borrarlo. Así se
puede auditar qué tenía el expediente en una fecha dada. Los tipos con
`allows_multiple` (contratos, constancias DC-3, cartas de recomendación)
acumulan.

Lo resuelve el trigger `tg_supersede_previous_employee_document`, no un índice
único: Postgres no admite subconsultas en el predicado de un índice parcial, y
además el trigger da mejor comportamiento (reemplaza en vez de rechazar).

## Constancia de Situación Fiscal

Subir la CSF hace dos cosas: la archiva y **llena los datos fiscales del
empleado** (`fiscal_name`, `rfc`, `fiscal_zip_code`, `fiscal_regime`)
reutilizando `src/lib/csfParser.ts`, el mismo parser que ya se usa para
proveedores. El parseo ocurre en el navegador; el servidor sólo guarda.

Esto ataca el motivo #1 de rechazo de timbrado en CFDI 4.0: que el nombre, el
código postal o el régimen del receptor no coincidan con el padrón del SAT.
Los datos se llenan pero **hay que verificarlos** antes del primer timbrado.

## Límites

- 25 MB por archivo (tope del bucket).
- Sólo PDF e imágenes (JPG, PNG, WEBP, HEIC).
- `next.config.ts` sube el límite de body de server actions a 20 MB; el
  default de 1 MB dejaba fuera casi cualquier PDF escaneado.

## Pendiente en esta fase

`document_templates` ya existe (cartas, contratos, credenciales) pero **falta
el motor de generación**. Cuando esté, lo generado se archiva como una fila más
de `employee_documents` con `source = 'generated'`, que ya está contemplado.
