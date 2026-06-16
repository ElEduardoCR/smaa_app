-- Quotation items can now be a "product" (fixed cost) or a "service".
-- A service is built from labor concepts (welding, design, machining, ...),
-- each with an hourly rate and a number of hours. The breakdown is stored in
-- service_concepts as JSON so the quotation can be reopened and edited.
-- item_type defaults to 'product' so existing rows keep working unchanged.

ALTER TABLE public.quotation_items
  ADD COLUMN IF NOT EXISTS item_type TEXT NOT NULL DEFAULT 'product',
  ADD COLUMN IF NOT EXISTS service_concepts JSONB;
