-- ======================================
-- EMAIL INTEGRATIONS (Gmail OAuth tokens)
-- ======================================
CREATE TABLE public.email_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL DEFAULT 'gmail',           -- 'gmail' | 'outlook' (futuro)
    email TEXT NOT NULL,                              -- correo conectado
    refresh_token_encrypted TEXT NOT NULL,            -- cifrado AES-256-GCM
    last_sync_at TIMESTAMP WITH TIME ZONE,            -- último mensaje procesado
    last_sync_status TEXT,                            -- 'ok' | 'error' | 'running'
    last_sync_error TEXT,
    last_sync_processed INTEGER DEFAULT 0,            -- conteo del último run
    backfill_completed_at TIMESTAMP WITH TIME ZONE,   -- NULL = aún no se ha hecho backfill
    backfill_months INTEGER,                          -- cuántos meses se cubrieron
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (provider, email)
);

ALTER TABLE public.email_integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on email_integrations" ON public.email_integrations FOR ALL USING (true) WITH CHECK (true);

-- ======================================
-- INVOICE INBOX (bandeja de revisión IA)
-- ======================================
CREATE TABLE public.invoice_inbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_id UUID NOT NULL REFERENCES public.email_integrations(id) ON DELETE CASCADE,

    -- Origen
    email_message_id TEXT NOT NULL,                   -- Gmail message id (idempotencia)
    email_from TEXT,
    email_subject TEXT,
    email_date TIMESTAMP WITH TIME ZONE,

    -- Adjuntos en storage
    pdf_url TEXT,
    xml_url TEXT,

    -- Datos extraídos (de CFDI o IA)
    detected_source TEXT,                             -- 'cfdi' | 'ai' | 'mixed'
    supplier_rfc TEXT,
    supplier_name TEXT,
    receiver_rfc TEXT,
    invoice_uuid TEXT,                                -- UUID del timbre CFDI
    invoice_folio TEXT,
    invoice_date TIMESTAMP WITH TIME ZONE,
    subtotal NUMERIC,
    vat_total NUMERIC,
    total NUMERIC,
    currency TEXT DEFAULT 'MXN',
    line_items JSONB,                                 -- [{description, quantity, unit_price, line_total}]

    -- Clasificación
    is_invoice BOOLEAN NOT NULL DEFAULT true,
    classification_confidence NUMERIC,                -- 0..1 (solo cuando proviene de IA)
    classification_notes TEXT,

    -- Estado revisión
    status TEXT NOT NULL DEFAULT 'pending',           -- 'pending' | 'approved' | 'discarded' | 'duplicate'
    approved_at TIMESTAMP WITH TIME ZONE,
    discarded_at TIMESTAMP WITH TIME ZONE,
    discard_reason TEXT,
    purchase_order_id UUID REFERENCES public.purchase_orders(id) ON DELETE SET NULL,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE (integration_id, email_message_id)
);

CREATE INDEX idx_invoice_inbox_status ON public.invoice_inbox(status);
CREATE INDEX idx_invoice_inbox_uuid ON public.invoice_inbox(invoice_uuid) WHERE invoice_uuid IS NOT NULL;
CREATE INDEX idx_invoice_inbox_integration ON public.invoice_inbox(integration_id);

ALTER TABLE public.invoice_inbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on invoice_inbox" ON public.invoice_inbox FOR ALL USING (true) WITH CHECK (true);

-- ======================================
-- PURCHASE_ORDERS: trazabilidad de origen email
-- ======================================
ALTER TABLE public.purchase_orders
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',  -- 'manual' | 'email'
    ADD COLUMN IF NOT EXISTS email_message_id TEXT,
    ADD COLUMN IF NOT EXISTS xml_url TEXT,
    ADD COLUMN IF NOT EXISTS invoice_uuid TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_po_invoice_uuid
    ON public.purchase_orders(invoice_uuid)
    WHERE invoice_uuid IS NOT NULL;
