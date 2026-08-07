-- =====================================================
-- MULTI-PROVEEDOR / MULTICOMPRA
-- Una "compra" puede agrupar varias POs, una por proveedor,
-- cuando el usuario necesita repartir un mismo movimiento
-- de compra entre varios proveedores.
--
-- Modelo:
--   - Una fila en purchase_orders sigue siendo UNA PO
--     (un solo supplier, sus propios items, su propio PDF).
--   - Cuando el usuario escoge "Multicompra" en /purchases/new,
--     el sistema crea N filas en purchase_orders que comparten
--     el mismo `purchase_group_id`.
--   - El grupo no es una tabla aparte: un UUID compartido basta
--     para relacionarlas sin agregar joins costosos.
--
-- Esto es retrocompatible: las POs existentes quedan con
-- purchase_group_id = NULL y siguen funcionando como siempre.
-- =====================================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'purchase_orders') THEN
        ALTER TABLE public.purchase_orders
            ADD COLUMN IF NOT EXISTS purchase_group_id UUID;

        CREATE INDEX IF NOT EXISTS idx_purchase_orders_group
            ON public.purchase_orders (purchase_group_id)
            WHERE purchase_group_id IS NOT NULL;

        COMMENT ON COLUMN public.purchase_orders.purchase_group_id IS
            'Agrupa varias POs de una misma "multicompra" (un proveedor por PO). NULL en POsstandalone.';
    ELSE
        RAISE NOTICE 'purchase_orders no existe todavía — saltando migration de purchase_group_id.';
    END IF;
END $$;
