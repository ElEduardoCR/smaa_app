-- Profit margin per quotation line.
-- After this change, quotation_items.unit_price / line_total (and the quotation
-- subtotal/vat_total/total) store the CLIENT price = cost + utility. The internal
-- cost is kept in cost_unit_price / cost_line_total so a line can be re-edited,
-- and margin_pct (default 38%) is the applied utility percentage per line.

ALTER TABLE public.quotation_items
  ADD COLUMN IF NOT EXISTS margin_pct NUMERIC NOT NULL DEFAULT 38,
  ADD COLUMN IF NOT EXISTS cost_unit_price NUMERIC,
  ADD COLUMN IF NOT EXISTS cost_line_total NUMERIC;
