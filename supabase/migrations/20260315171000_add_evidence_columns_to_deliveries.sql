-- ======================================
-- ADD EVIDENCE COLUMNS TO DELIVERIES
-- ======================================
ALTER TABLE public.deliveries
    ADD COLUMN IF NOT EXISTS evidence_photo_url TEXT,
    ADD COLUMN IF NOT EXISTS evidence_signed_url TEXT;
