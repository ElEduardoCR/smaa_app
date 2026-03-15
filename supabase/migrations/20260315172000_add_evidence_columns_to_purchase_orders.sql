-- ======================================
-- ADD EVIDENCE COLUMNS TO PURCHASE_ORDERS
-- ======================================
ALTER TABLE public.purchase_orders
    ADD COLUMN IF NOT EXISTS evidence_photo_url TEXT,
    ADD COLUMN IF NOT EXISTS signed_invoice_url TEXT;
