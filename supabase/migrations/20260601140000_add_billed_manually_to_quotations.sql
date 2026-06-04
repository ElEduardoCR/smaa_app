-- ============================================================
-- COTIZACIONES: marca manual de "ya facturada"
-- ============================================================
-- Permite sacar del "por facturar" del dashboard a cotizaciones que
-- ya están entregadas y facturadas, aunque la IA no las haya ligado
-- (por ejemplo, si el XML no se subió o el RFC/nombre no coincidió).

ALTER TABLE public.quotations
    ADD COLUMN IF NOT EXISTS billed_manually BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS billed_manually_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_quotations_billed_manually
    ON public.quotations (billed_manually);
