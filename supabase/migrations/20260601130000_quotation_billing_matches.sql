-- ============================================================
-- RECONCILIACIÓN: cotizaciones aprobadas ↔ facturas emitidas
-- ============================================================
-- La IA corre diario y detecta, a nivel PARTIDA (quotation_items),
-- qué renglón de una cotización aprobada ya fue facturado en un CFDI
-- emitido. Cada match se guarda como 'pending' para revisión humana
-- (bandeja), y al confirmarse cuenta como "facturado".

CREATE TABLE IF NOT EXISTS public.quotation_billing_matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quotation_id UUID NOT NULL REFERENCES public.quotations(id) ON DELETE CASCADE,
    quotation_item_id UUID REFERENCES public.quotation_items(id) ON DELETE CASCADE,
    issued_invoice_id UUID REFERENCES public.issued_invoices(id) ON DELETE CASCADE,

    -- Datos denormalizados para mostrar en la bandeja sin más joins
    quotation_number TEXT,
    client_name TEXT,
    item_description TEXT,        -- partida cotizada
    invoice_uuid TEXT,
    invoice_folio TEXT,
    invoice_concept TEXT,         -- concepto del CFDI que la IA emparejó
    matched_amount NUMERIC(14,2), -- monto facturado atribuido a esta partida

    confidence NUMERIC,           -- 0..1 (confianza de la IA)
    ai_reason TEXT,               -- explicación corta de la IA
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'confirmed', 'rejected')),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Evita volver a proponer (o re-proponer tras rechazar) el mismo par partida↔factura
CREATE UNIQUE INDEX IF NOT EXISTS idx_qbm_item_invoice
    ON public.quotation_billing_matches (quotation_item_id, issued_invoice_id);
CREATE INDEX IF NOT EXISTS idx_qbm_quotation ON public.quotation_billing_matches (quotation_id);
CREATE INDEX IF NOT EXISTS idx_qbm_status ON public.quotation_billing_matches (status);

ALTER TABLE public.quotation_billing_matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all quotation_billing_matches" ON public.quotation_billing_matches;
CREATE POLICY "Allow all quotation_billing_matches" ON public.quotation_billing_matches
    FOR ALL USING (true) WITH CHECK (true);
