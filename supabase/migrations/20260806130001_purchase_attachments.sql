-- =====================================================
-- Adjuntos múltiples en Órdenes de Compra.
--
-- Una PO puede tener varios archivos adjuntos:
-- facturas (CFDI), fotos del material, PDFs extras, etc.
-- Antes el modelo era 1:1 con `purchase_orders.invoice_url` +
-- `purchase_orders.evidence_photo_url`, lo que no escalaba cuando
-- una compra tenía varias facturas o varios comprobantes.
--
-- Esta tabla es la fuente de verdad para adjuntos. Las columnas
-- viejas (invoice_url, evidence_photo_url, signed_invoice_url)
-- se conservan por retrocompatibilidad — la primera fila de
-- `kind = 'invoice'` se duplica en `invoice_url` para no romper
-- el módulo de AR / conciliación ni los PDFs generados.
-- =====================================================

CREATE TABLE IF NOT EXISTS public.purchase_order_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'invoice',  -- 'invoice' | 'evidence' | 'other'
    file_url TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size BIGINT,
    content_type TEXT,
    uploaded_by UUID REFERENCES public.employees(id),
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_po_attachments_po
    ON public.purchase_order_attachments (purchase_order_id, uploaded_at DESC);

ALTER TABLE public.purchase_order_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on purchase_order_attachments" ON public.purchase_order_attachments;
CREATE POLICY "Allow all on purchase_order_attachments"
    ON public.purchase_order_attachments FOR ALL USING (true) WITH CHECK (true);

-- Los proyectos creados con la exposición automática desactivada no
-- conceden acceso al Data API para tablas nuevas. La aplicación actual usa
-- la clave pública + permisos propios en Server Actions, por lo que esta tabla
-- necesita los mismos grants que el resto del módulo mientras se completa la
-- migración futura a Supabase Auth/RLS por usuario.
GRANT SELECT, INSERT, UPDATE, DELETE
    ON public.purchase_order_attachments
    TO anon, authenticated, service_role;

COMMENT ON TABLE public.purchase_order_attachments IS
    'Adjuntos de una PO: facturas, evidencia fotográfica, comprobantes extra. kind=invoice|evidence|other.';
COMMENT ON COLUMN public.purchase_order_attachments.kind IS
    'Tipo de adjunto. invoice = CFDI/factura del proveedor (cuenta para cerrar la compra). evidence = foto del material. other = otros docs.';
