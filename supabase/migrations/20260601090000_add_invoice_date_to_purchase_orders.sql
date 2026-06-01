-- ======================================
-- PURCHASE_ORDERS: fecha de emisión de la factura
-- ======================================
-- La PO se crea hoy, pero la factura puede ser de hace años.
-- Guardamos la fecha real del CFDI para ordenar y agrupar estadísticas.

ALTER TABLE public.purchase_orders
    ADD COLUMN IF NOT EXISTS invoice_date TIMESTAMP WITH TIME ZONE;

-- Backfill desde la bandeja para POs ya aprobadas por correo
UPDATE public.purchase_orders po
SET invoice_date = ii.invoice_date
FROM public.invoice_inbox ii
WHERE po.id = ii.purchase_order_id
  AND ii.invoice_date IS NOT NULL
  AND po.invoice_date IS NULL;

CREATE INDEX IF NOT EXISTS idx_po_invoice_date ON public.purchase_orders(invoice_date);
