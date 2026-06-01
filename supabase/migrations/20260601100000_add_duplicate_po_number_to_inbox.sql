-- ======================================
-- INVOICE_INBOX: referencia a PO duplicada
-- ======================================
-- Cuando una factura detectada ya existe como orden de compra,
-- guardamos el número de PO para mostrar "Factura igual a PO-XXXX".

ALTER TABLE public.invoice_inbox
    ADD COLUMN IF NOT EXISTS duplicate_po_number TEXT;
