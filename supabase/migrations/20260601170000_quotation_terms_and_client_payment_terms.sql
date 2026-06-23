-- Generic quotation terms & conditions, shown by default on every new quotation.
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS default_quotation_terms TEXT;

-- Per-client payment conditions: number of credit days and whether the client
-- must pay an advance/anticipo.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS payment_days INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS requires_advance BOOLEAN NOT NULL DEFAULT false;
