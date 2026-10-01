-- purchase_files tiene en producción una lista blanca de tipos (configurada a
-- mano en el dashboard; 20260918210804 le agregó imágenes) que sólo acepta
-- PDF e imágenes. Eso rechaza con "mime type ... is not supported":
--   * los XML de CFDI: facturas emitidas, buzón de facturas de Gmail y la
--     recepción de compras (la factura del proveedor es PDF + XML);
--   * las cotizaciones en Excel/Word que la pantalla de la PO ofrece adjuntar.
-- Los buckets sin restricción (allowed_mime_types NULL) no se tocan.
BEGIN;
UPDATE storage.buckets SET allowed_mime_types = ARRAY(
    SELECT DISTINCT mime FROM unnest(allowed_mime_types || ARRAY[
        'application/xml', 'text/xml',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]) AS mime
) WHERE id = 'purchase_files' AND allowed_mime_types IS NOT NULL;
COMMIT;
