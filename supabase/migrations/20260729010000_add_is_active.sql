-- =====================================================
-- Agregar is_active (soft-delete) a clients, suppliers y
-- purchase_orders. Los empleados ya lo tienen.
--
-- Convención: is_active = true (default) significa "vigente".
-- Cuando se marca como obsoleto, is_active = false. La fila
-- NO se borra físicamente — preserva audit trail y permite
-- seguir mostrando históricos en POs, requisiciones, etc.
-- =====================================================

ALTER TABLE public.clients
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_clients_is_active
    ON public.clients (is_active) WHERE is_active = true;

ALTER TABLE public.suppliers
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_suppliers_is_active
    ON public.suppliers (is_active) WHERE is_active = true;

ALTER TABLE public.purchase_orders
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_purchase_orders_is_active
    ON public.purchase_orders (is_active) WHERE is_active = true;

COMMENT ON COLUMN public.clients.is_active       IS 'Vigente. false = obsoleto (no aparece en dropdowns por defecto)';
COMMENT ON COLUMN public.suppliers.is_active     IS 'Vigente. false = obsoleto (no aparece en dropdowns por defecto)';
COMMENT ON COLUMN public.purchase_orders.is_active IS 'Vigente. false = obsoleto (oculto de listas y reportes)';
