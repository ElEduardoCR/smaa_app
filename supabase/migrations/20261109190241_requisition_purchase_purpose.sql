-- A common project/use can be overridden for each requisition line.
-- Nullable fields preserve historical requisitions without inventing a purpose.
ALTER TABLE public.requisitions ADD COLUMN IF NOT EXISTS purpose TEXT;
ALTER TABLE public.requisition_items ADD COLUMN IF NOT EXISTS purpose TEXT;
ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS notes TEXT;

COMMENT ON COLUMN public.requisitions.purpose IS 'Proyecto o uso general para el que se requiere la compra';
COMMENT ON COLUMN public.requisition_items.purpose IS 'Proyecto o uso del artículo; si está vacío hereda el propósito general';
COMMENT ON COLUMN public.purchase_order_items.notes IS 'Uso, proyecto y notas del artículo, conservados al convertir una requisición';
