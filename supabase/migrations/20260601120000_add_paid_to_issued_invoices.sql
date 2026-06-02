-- ======================================
-- FACTURAS EMITIDAS: estado de cobro
-- ======================================
-- Marca cuáles facturas ya fueron pagadas por el cliente.
-- Las no pagadas forman las "cuentas por cobrar".

ALTER TABLE public.issued_invoices
    ADD COLUMN IF NOT EXISTS paid BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_issued_invoices_paid ON public.issued_invoices (paid);
