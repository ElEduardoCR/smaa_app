-- Advance/anticipo percentage for clients that require an advance payment.
-- Null when the client does not require an advance.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS advance_pct NUMERIC;
