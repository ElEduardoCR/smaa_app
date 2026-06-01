-- ======================================
-- FACTURAS EMITIDAS (issued_invoices)
-- ======================================
-- Carga masiva de los CFDI que el negocio ha EMITIDO (ventas).
-- El emisor somos nosotros; el receptor es el cliente facturado.

CREATE TABLE IF NOT EXISTS public.issued_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    uuid TEXT,                       -- UUID del Timbre Fiscal Digital (CFDI)
    serie TEXT,
    folio TEXT,
    invoice_date TIMESTAMP WITH TIME ZONE,   -- fecha de emisión
    emisor_rfc TEXT,
    emisor_nombre TEXT,
    receptor_rfc TEXT,               -- cliente
    receptor_nombre TEXT,            -- cliente
    subtotal NUMERIC(14,2),
    vat_total NUMERIC(14,2),
    total NUMERIC(14,2),
    currency TEXT DEFAULT 'MXN',
    line_items JSONB,
    xml_url TEXT,
    pdf_url TEXT,
    file_name TEXT,
    source TEXT DEFAULT 'upload',     -- 'upload' | 'email' | 'manual'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Dedup por UUID (los NULL se permiten múltiples: Postgres trata NULL como distinto)
CREATE UNIQUE INDEX IF NOT EXISTS idx_issued_invoices_uuid ON public.issued_invoices (uuid);
CREATE INDEX IF NOT EXISTS idx_issued_invoices_date ON public.issued_invoices (invoice_date);
CREATE INDEX IF NOT EXISTS idx_issued_invoices_receptor ON public.issued_invoices (receptor_rfc);

ALTER TABLE public.issued_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all issued_invoices" ON public.issued_invoices;
CREATE POLICY "Allow all issued_invoices" ON public.issued_invoices
    FOR ALL USING (true) WITH CHECK (true);
