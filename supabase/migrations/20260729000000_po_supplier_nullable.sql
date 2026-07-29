-- =====================================================
-- PO supplier_id nullable: el PO auto-creado desde una
-- requisición puede no tener proveedor todavía. El
-- comprador (con purchases:edit) lo asigna después.
-- =====================================================

ALTER TABLE public.purchase_orders
    ALTER COLUMN supplier_id DROP NOT NULL;

-- =====================================================
-- PO notes: copiamos las notas de la requisición + las
-- notas de cierre de la compra para que el comprador las
-- vea al editar el PO.
-- =====================================================

ALTER TABLE public.purchase_orders
    ADD COLUMN IF NOT EXISTS notes TEXT;
