-- Add new fields to quotations table
ALTER TABLE public.quotations ADD COLUMN IF NOT EXISTS seller TEXT;
ALTER TABLE public.quotations ADD COLUMN IF NOT EXISTS delivery_time TEXT;
ALTER TABLE public.quotations ADD COLUMN IF NOT EXISTS terms_conditions TEXT;
ALTER TABLE public.quotations ADD COLUMN IF NOT EXISTS client_po_url TEXT;
